import { Command } from 'commander';
import { join } from 'path';
import { existsSync, mkdirSync, copyFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { getAutoplyDir, ensureAutoplyDir } from '../../db';
import { configRepository } from '../../db/repositories/config';

const STORAGE_STATE_PATH = join(getAutoplyDir(), 'browser-state.json');

/**
 * Return the path to the user's real Chrome/Chromium install, or null if not
 * found. Playwright will fall back to its own bundled Chromium when this is
 * null.
 */
function findRealChrome(): string | null {
  const candidates: string[] = [];

  if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      `${process.env.HOME}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
    );
  } else if (process.platform === 'linux') {
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium'
    );
  } else if (process.platform === 'win32') {
    const programFiles = process.env['PROGRAMFILES'] ?? 'C:\\Program Files';
    const programFilesX86 = process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)';
    const localAppData = process.env['LOCALAPPDATA'] ?? '';
    candidates.push(
      join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe')
    );
  }

  return candidates.find(existsSync) ?? null;
}

/**
 * Return the path to the user's default Chrome user profile directory.
 */
function findChromeProfileDir(): string | null {
  const home = homedir();
  const candidates: string[] = [];

  if (process.platform === 'darwin') {
    candidates.push(
      join(home, 'Library', 'Application Support', 'Google', 'Chrome', 'Default'),
      join(home, 'Library', 'Application Support', 'Google', 'Chrome', 'Profile 1')
    );
  } else if (process.platform === 'linux') {
    candidates.push(
      join(home, '.config', 'google-chrome', 'Default'),
      join(home, '.config', 'chromium', 'Default')
    );
  } else if (process.platform === 'win32') {
    const localAppData = process.env['LOCALAPPDATA'] ?? '';
    candidates.push(join(localAppData, 'Google', 'Chrome', 'User Data', 'Default'));
  }

  return candidates.find(existsSync) ?? null;
}

/**
 * Sync cookies and saved passwords from the user's real Chrome profile
 * into a dedicated Autoply profile directory.
 *
 * Running Chrome directly against the active Chrome directory fails because of
 * Chrome's single-process lock (SingletonLock). Copying the sqlite files allows
 * a new Chrome process to boot cleanly while retaining saved sessions and
 * decrypted passwords via macOS Keychain / OS credential store.
 */
function syncChromeCredentials(srcDefaultDir: string, destDefaultDir: string): void {
  mkdirSync(destDefaultDir, { recursive: true });

  const filesToCopy = ['Cookies', 'Login Data', 'Login Data For Account', 'Affiliation Database'];

  for (const file of filesToCopy) {
    const src = join(srcDefaultDir, file);
    const dest = join(destDefaultDir, file);
    try {
      if (existsSync(src)) {
        copyFileSync(src, dest);
      }
    } catch {
      // Best-effort copy (e.g. if file is locked)
    }
  }

  const srcNetworkCookies = join(srcDefaultDir, 'Network', 'Cookies');
  if (existsSync(srcNetworkCookies)) {
    try {
      const destNetwork = join(destDefaultDir, 'Network');
      mkdirSync(destNetwork, { recursive: true });
      copyFileSync(srcNetworkCookies, join(destNetwork, 'Cookies'));
      copyFileSync(srcNetworkCookies, join(destDefaultDir, 'Cookies'));
    } catch {
      // Best-effort
    }
  }
}

export const loginCommand = new Command('login')
  .description('Login to job platforms and save browser session')
  .argument('[platform]', 'Platform to login to (linkedin, etc.)', 'linkedin')
  .option(
    '-c, --cookie <token>',
    'Directly provide session cookie value (e.g. li_at for LinkedIn) without opening browser'
  )
  .action(async (platform: string, options: { cookie?: string }) => {
    const urls: Record<string, string> = {
      linkedin: 'https://www.linkedin.com/login',
      greenhouse: 'https://www.greenhouse.io',
      lever: 'https://www.lever.co',
    };

    const loginUrl = urls[platform];
    if (!loginUrl) {
      console.error(`Unknown platform: ${platform}`);
      console.log(`Supported platforms: ${Object.keys(urls).join(', ')}`);
      process.exit(1);
    }

    // Direct cookie input mode
    if (options.cookie) {
      const cookieValue = options.cookie.trim();
      const domain = platform === 'linkedin' ? '.linkedin.com' : `.${platform}.com`;
      const cookieName = platform === 'linkedin' ? 'li_at' : 'session';
      const storageState = {
        cookies: [
          {
            name: cookieName,
            value: cookieValue,
            domain,
            path: '/',
            expires: Math.floor(Date.now() / 1000) + 365 * 24 * 3600,
            httpOnly: true,
            secure: true,
            sameSite: 'None' as const,
          },
          {
            name: cookieName,
            value: cookieValue,
            domain: `.www${domain}`,
            path: '/',
            expires: Math.floor(Date.now() / 1000) + 365 * 24 * 3600,
            httpOnly: true,
            secure: true,
            sameSite: 'None' as const,
          },
        ],
        origins: [],
      };
      ensureAutoplyDir();
      writeFileSync(STORAGE_STATE_PATH, JSON.stringify(storageState, null, 2));
      configRepository.updateAppConfig({
        browser: {
          ...configRepository.loadAppConfig().browser,
          storageState: STORAGE_STATE_PATH,
        },
      });
      console.log(`\nSession cookie for ${platform} saved to: ${STORAGE_STATE_PATH}`);
      console.log('Config updated to use saved session.');
      return;
    }

    ensureAutoplyDir();
    const chromePath = findRealChrome();
    const chromeProfileDir = findChromeProfileDir();
    const persistentProfileDir = join(getAutoplyDir(), 'chrome-profile');
    const persistentDefaultDir = join(persistentProfileDir, 'Default');

    if (chromeProfileDir) {
      syncChromeCredentials(chromeProfileDir, persistentDefaultDir);
    }

    if (chromePath) {
      console.log(`Using your installed Chrome: ${chromePath}`);
    } else {
      console.log('Using bundled Chromium fallback.');
    }

    const { chromium } = await import('playwright');
    // Launch persistent context with Keychain and Password Manager enabled
    const context = await chromium.launchPersistentContext(persistentProfileDir, {
      headless: false,
      executablePath: chromePath ?? undefined,
      viewport: { width: 1920, height: 1080 },
      locale: Intl.DateTimeFormat().resolvedOptions().locale || 'en-US',
      timezoneId: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      ignoreDefaultArgs: ['--use-mock-keychain', '--password-store=basic', '--enable-automation'],
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
      ],
    });

    // Remove webdriver detection flag
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    const page = context.pages()[0] || (await context.newPage());

    console.log(`\nNavigating to ${platform}...`);
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });

    // Check if already authenticated via synced Chrome cookies
    let alreadyLoggedIn = false;
    if (platform === 'linkedin') {
      await page.waitForTimeout(1500);
      const currentUrl = page.url();
      try {
        const { pathname } = new URL(currentUrl);
        if (
          !pathname.startsWith('/login') &&
          !pathname.startsWith('/checkpoint') &&
          !pathname.startsWith('/uas/')
        ) {
          alreadyLoggedIn = true;
        }
      } catch {
        // ignore URL parse errors
      }
    }

    if (alreadyLoggedIn) {
      console.log(`✓ Active ${platform} session detected from your Chrome profile!`);
    } else {
      console.log('Please login manually in the browser window.');
      console.log('Saved passwords in Chrome Password Manager (PWM) are available.');
      console.log('The browser will automatically save your session and close once logged in.\n');

      if (platform === 'linkedin') {
        try {
          // Accept any post-login destination: /feed/, /, /in/username, /jobs/, etc.
          await page.waitForURL(
            (url) => {
              const { pathname } = new URL(url);
              return (
                !pathname.startsWith('/login') &&
                !pathname.startsWith('/checkpoint') &&
                !pathname.startsWith('/uas/')
              );
            },
            { timeout: 300000 } // 5 min timeout
          );
        } catch (err) {
          const isClosed =
            err instanceof Error &&
            (err.message.includes('closed') || err.message.includes('Target page'));

          if (!isClosed) throw err;

          // User closed the browser — check if they logged in before closing
          console.log('\nBrowser was closed.');
          const lastUrl = page.isClosed() ? '' : page.url();
          if (lastUrl) {
            try {
              const { pathname } = new URL(lastUrl);
              if (
                pathname.startsWith('/login') ||
                pathname.startsWith('/checkpoint') ||
                pathname.startsWith('/uas/')
              ) {
                console.error(
                  'Browser was closed before finishing login. Run "autoply login" again.'
                );
                process.exit(1);
              }
            } catch {
              // ignore
            }
          }
          console.log('Detected successful login before browser closed.');
        }
      } else {
        console.log('Press Enter in this terminal when you have finished logging in...');
        await new Promise<void>((resolve) => {
          process.stdin.once('data', () => resolve());
        });
      }
    }

    // Save storage state for headless scrapers — strictly scoped to target platform
    try {
      const targetDomain = platform === 'linkedin' ? 'linkedin.com' : `${platform}.com`;
      const fullState = await context.storageState();

      // Principle of least privilege: only retain cookies & origins for the target platform.
      // All other websites (Google, banking, personal) are completely discarded.
      const scopedCookies = fullState.cookies.filter(
        (c) => c.domain && c.domain.toLowerCase().includes(targetDomain)
      );
      const scopedOrigins = (fullState.origins || []).filter(
        (o) => o.origin && o.origin.toLowerCase().includes(targetDomain)
      );

      const scopedState = {
        cookies: scopedCookies,
        origins: scopedOrigins,
      };

      // Write with restrictive 0600 permissions (owner read/write only)
      writeFileSync(STORAGE_STATE_PATH, JSON.stringify(scopedState, null, 2), { mode: 0o600 });
      try {
        const { chmodSync } = await import('fs');
        chmodSync(STORAGE_STATE_PATH, 0o600);
      } catch {
        // Best-effort on non-posix
      }

      console.log(
        `\nSession saved to: ${STORAGE_STATE_PATH} (${scopedCookies.length} ${platform} cookies)`
      );
    } catch {
      console.error('\nCould not capture session — the browser closed too quickly.');
      await context.close().catch(() => {});
      process.exit(1);
    }

    // Update config to use the storage state
    configRepository.updateAppConfig({
      browser: {
        ...configRepository.loadAppConfig().browser,
        storageState: STORAGE_STATE_PATH,
      },
    });
    console.log('Config updated to use saved session.');

    await context.close();

    // Clean up temporary profile to leave zero credential duplicates on disk
    try {
      const { rmSync } = await import('fs');
      if (existsSync(persistentProfileDir)) {
        rmSync(persistentProfileDir, { recursive: true, force: true });
      }
    } catch {
      // Best-effort cleanup
    }

    console.log('\nLogin complete! Your session will be reused for future scraping.');
    process.exit(0);
  });
