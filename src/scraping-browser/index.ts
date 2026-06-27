import { chromium } from 'playwright-core';
import type { BrowserServer } from 'playwright-core';
import { randomUUID } from 'crypto';

const STEALTH_LAUNCH_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--disable-features=IsolateOrigins,site-per-process',
  '--disable-dev-shm-usage',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-infobars',
  '--ignore-certificate-errors',
];

export const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Apple Silicon Mac OS X 14_4_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
];

/**
 * Init script clients should apply on every new BrowserContext to mask
 * automation indicators at the JS level. Mirrors browser-manager.ts behaviour.
 */
export const STEALTH_INIT_SCRIPT = `
(function () {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

  Object.defineProperty(navigator, 'plugins', {
    get: () => [
      { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
      { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
      { name: 'Native Client', filename: 'internal-nacl-plugin' },
    ],
  });

  Object.defineProperty(navigator, 'languages', {
    get: () => (navigator.language ? [navigator.language, 'en'] : ['en-US', 'en']),
  });

  const originalQuery = window.navigator.permissions.query;
  window.navigator.permissions.query = (parameters) => {
    if (parameters.name === 'notifications') {
      return Promise.resolve({ state: 'prompt', onchange: null });
    }
    return originalQuery(parameters);
  };

  window.chrome = { runtime: {} };
})();
`;

interface ManagedSession {
  id: string;
  server: BrowserServer;
  wsEndpoint: string;
  createdAt: Date;
  ttlTimer: ReturnType<typeof setTimeout> | null;
}

export interface SessionInfo {
  id: string;
  wsEndpoint: string;
  createdAt: string;
  ageSeconds: number;
}

export interface CreateSessionOptions {
  /** Auto-destroy after this many ms. 0 = no TTL. Default: 30 minutes. */
  ttlMs?: number;
  headless?: boolean;
}

const DEFAULT_SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_SESSIONS = 10;

class ScrapingBrowserPool {
  private sessions = new Map<string, ManagedSession>();

  async createSession(
    options: CreateSessionOptions = {}
  ): Promise<{ id: string; wsEndpoint: string }> {
    if (this.sessions.size >= MAX_SESSIONS) {
      throw new Error(
        `Session limit reached (max ${MAX_SESSIONS}). Destroy an existing session first.`
      );
    }

    const id = randomUUID();
    const headless = options.headless ?? true;
    const ttlMs = options.ttlMs !== undefined ? options.ttlMs : DEFAULT_SESSION_TTL_MS;

    const server = await chromium.launchServer({
      headless,
      args: STEALTH_LAUNCH_ARGS,
    });

    const wsEndpoint = server.wsEndpoint();

    const ttlTimer =
      ttlMs > 0
        ? setTimeout(() => {
            void this.destroySession(id);
          }, ttlMs)
        : null;

    this.sessions.set(id, { id, server, wsEndpoint, createdAt: new Date(), ttlTimer });
    return { id, wsEndpoint };
  }

  async destroySession(id: string): Promise<boolean> {
    const session = this.sessions.get(id);
    if (!session) return false;

    if (session.ttlTimer) clearTimeout(session.ttlTimer);
    this.sessions.delete(id);

    try {
      await session.server.close();
    } catch {
      // best-effort
    }

    return true;
  }

  listSessions(): SessionInfo[] {
    const now = Date.now();
    return [...this.sessions.values()].map((s) => ({
      id: s.id,
      wsEndpoint: s.wsEndpoint,
      createdAt: s.createdAt.toISOString(),
      ageSeconds: Math.floor((now - s.createdAt.getTime()) / 1000),
    }));
  }

  async destroyAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((id) => this.destroySession(id)));
  }

  get count(): number {
    return this.sessions.size;
  }
}

export const scrapingBrowserPool = new ScrapingBrowserPool();
