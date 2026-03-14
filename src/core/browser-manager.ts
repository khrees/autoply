import type { Browser, BrowserContext, BrowserContextOptions, LaunchOptions, Page } from 'playwright';
import { existsSync } from 'fs';
import type { AppConfig, Platform } from '../types';
import { configRepository } from '../db/repositories/config';
import { logger } from '../utils/logger';

export type BrowserEngine = 'playwright' | 'patchright';

interface BrowserAutomationModule {
  chromium: {
    launch(options?: LaunchOptions): Promise<Browser>;
  };
}

interface PooledBrowser {
  id: string;
  browser: Browser;
  engine: BrowserEngine;
  headless: boolean;
  activeSessions: number;
  totalPagesCreated: number;
  retired: boolean;
  reusable: boolean;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  engine: BrowserEngine;
  release(): Promise<void>;
  waitForClose(): Promise<void>;
}

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Apple Silicon Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const DEFAULT_LAUNCH_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--disable-features=IsolateOrigins,site-per-process',
];

function maskAutomationIndicators(): void {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

  Object.defineProperty(navigator, 'plugins', {
    get: () => [
      { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
      { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
      { name: 'Native Client', filename: 'internal-nacl-plugin' },
    ],
  });

  Object.defineProperty(navigator, 'languages', {
    get: () => (navigator.language ? [navigator.language, 'en'] : ['en']),
  });

  const originalQuery = window.navigator.permissions.query;
  window.navigator.permissions.query = (parameters: PermissionDescriptor) => {
    if (parameters.name === 'notifications') {
      return Promise.resolve({ state: 'prompt', onchange: null } as PermissionStatus);
    }
    return originalQuery(parameters);
  };

  (window as unknown as { chrome: unknown }).chrome = { runtime: {} };
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/^\.+|\.+$/g, '');
}

function hostMatches(host: string, configuredHost: string): boolean {
  const normalizedHost = normalizeHost(host);
  const normalizedConfiguredHost = normalizeHost(configuredHost);

  return (
    normalizedHost === normalizedConfiguredHost ||
    normalizedHost.endsWith(`.${normalizedConfiguredHost}`)
  );
}

function getUrlHost(url?: string): string | null {
  if (!url) return null;

  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export function selectBrowserEngine(
  config: AppConfig,
  platform: Platform,
  url?: string
): BrowserEngine {
  if (config.browser.engine === 'patchright') {
    return 'patchright';
  }

  if (config.browser.patchrightPlatforms.includes(platform)) {
    return 'patchright';
  }

  const host = getUrlHost(url);
  if (host && config.browser.patchrightHosts.some((configuredHost) => hostMatches(host, configuredHost))) {
    return 'patchright';
  }

  return 'playwright';
}

function buildContextOptions(config: AppConfig): BrowserContextOptions {
  return {
    userAgent: DEFAULT_USER_AGENT,
    storageState:
      config.browser.storageState && existsSync(config.browser.storageState)
        ? config.browser.storageState
        : undefined,
    viewport: { width: 1920, height: 1080 },
    locale: Intl.DateTimeFormat().resolvedOptions().locale || 'en-US',
    timezoneId: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  };
}

async function loadAutomationModule(engine: BrowserEngine): Promise<BrowserAutomationModule> {
  if (engine === 'patchright') {
    try {
      return (await import('patchright')) as BrowserAutomationModule;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(
        `Patchright is configured but unavailable (${message}). Install it with "bun add patchright", or remove the host/platform from browser.patchrightHosts/browser.patchrightPlatforms.`
      );
    }
  }

  return (await import('playwright')) as BrowserAutomationModule;
}

class BrowserManager {
  private browsers: PooledBrowser[] = [];
  private nextId = 1;

  async createSession(platform: Platform, url?: string): Promise<BrowserSession> {
    const config = configRepository.loadAppConfig();
    const engine = selectBrowserEngine(config, platform, url);
    const pooledBrowser = await this.acquireBrowser(config, engine);
    const context = await pooledBrowser.browser.newContext(buildContextOptions(config));
    await context.addInitScript(maskAutomationIndicators);
    const page = await context.newPage();
    page.setDefaultTimeout(config.browser.timeout);

    pooledBrowser.activeSessions += 1;
    pooledBrowser.totalPagesCreated += 1;
    pooledBrowser.retired =
      pooledBrowser.retired ||
      pooledBrowser.totalPagesCreated >= Math.max(1, config.browser.retireBrowserAfterPageCount);

    let released = false;

    const release = async (): Promise<void> => {
      if (released) return;
      released = true;

      try {
        await context.close();
      } catch {
        // Best-effort cleanup
      }

      pooledBrowser.activeSessions = Math.max(0, pooledBrowser.activeSessions - 1);

      if (!pooledBrowser.reusable || pooledBrowser.retired) {
        if (pooledBrowser.activeSessions === 0) {
          await this.destroyBrowser(pooledBrowser);
        }
        return;
      }

      this.scheduleIdleCleanup(
        pooledBrowser,
        Math.max(0, config.browser.closeInactiveBrowserAfterMillis)
      );
    };

    return {
      browser: pooledBrowser.browser,
      context,
      page,
      engine,
      release,
      waitForClose: async () => {
        if (page.isClosed()) return;

        await Promise.race([
          new Promise<void>((resolve) => page.once('close', () => resolve())),
          new Promise<void>((resolve) => context.once('close', () => resolve())),
        ]);
      },
    };
  }

  async closeAll(): Promise<void> {
    const currentBrowsers = [...this.browsers];
    await Promise.all(currentBrowsers.map((pooledBrowser) => this.destroyBrowser(pooledBrowser)));
  }

  private async acquireBrowser(config: AppConfig, engine: BrowserEngine): Promise<PooledBrowser> {
    const reusable = config.browser.reuseSessions;
    const maxOpenPagesPerBrowser = Math.max(1, config.browser.maxOpenPagesPerBrowser);

    const pooledBrowser = reusable
      ? this.browsers.find(
          (candidate) =>
            candidate.engine === engine &&
            candidate.headless === config.browser.headless &&
            candidate.reusable &&
            !candidate.retired &&
            candidate.activeSessions < maxOpenPagesPerBrowser
        )
      : undefined;

    if (pooledBrowser) {
      if (pooledBrowser.idleTimer) {
        clearTimeout(pooledBrowser.idleTimer);
        pooledBrowser.idleTimer = null;
      }

      logger.debug(`Reusing ${engine} browser #${pooledBrowser.id}`);
      return pooledBrowser;
    }

    const automation = await loadAutomationModule(engine);
    const browser = await automation.chromium.launch({
      headless: config.browser.headless,
      args: DEFAULT_LAUNCH_ARGS,
    });

    const createdBrowser: PooledBrowser = {
      id: `${engine}-${this.nextId++}`,
      browser,
      engine,
      headless: config.browser.headless,
      activeSessions: 0,
      totalPagesCreated: 0,
      retired: false,
      reusable,
      idleTimer: null,
    };

    this.browsers.push(createdBrowser);
    logger.debug(`Launched ${engine} browser #${createdBrowser.id}`);
    return createdBrowser;
  }

  private scheduleIdleCleanup(
    pooledBrowser: PooledBrowser,
    closeInactiveBrowserAfterMillis: number
  ): void {
    if (!pooledBrowser.reusable || pooledBrowser.activeSessions > 0) return;

    if (pooledBrowser.idleTimer) {
      clearTimeout(pooledBrowser.idleTimer);
      pooledBrowser.idleTimer = null;
    }

    if (closeInactiveBrowserAfterMillis === 0) {
      void this.destroyBrowser(pooledBrowser);
      return;
    }

    pooledBrowser.idleTimer = setTimeout(() => {
      void this.destroyBrowser(pooledBrowser);
    }, closeInactiveBrowserAfterMillis);
  }

  private async destroyBrowser(pooledBrowser: PooledBrowser): Promise<void> {
    const index = this.browsers.indexOf(pooledBrowser);
    if (index >= 0) {
      this.browsers.splice(index, 1);
    }

    if (pooledBrowser.idleTimer) {
      clearTimeout(pooledBrowser.idleTimer);
      pooledBrowser.idleTimer = null;
    }

    try {
      if (pooledBrowser.browser.isConnected()) {
        await pooledBrowser.browser.close();
      }
    } catch {
      // Best-effort cleanup
    }
  }
}

export const browserManager = new BrowserManager();
