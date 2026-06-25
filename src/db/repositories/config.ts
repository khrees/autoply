import { getDb, getAutoplyDir } from '../index';
import { dirname, join } from 'path';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import type { AppConfig } from '../../types';
import { DEFAULT_CONFIG } from '../../types';

function mergeAppConfig(config: Partial<AppConfig> | null | undefined): AppConfig {
  return {
    ...DEFAULT_CONFIG,
    ...config,
    ai: {
      ...DEFAULT_CONFIG.ai,
      ...config?.ai,
    },
    browser: {
      ...DEFAULT_CONFIG.browser,
      ...config?.browser,
    },
    application: {
      ...DEFAULT_CONFIG.application,
      ...config?.application,
    },
    cachedAnswers: config?.cachedAnswers ?? DEFAULT_CONFIG.cachedAnswers,
  };
}

export class ConfigRepository {
  constructor(private readonly configPath = join(getAutoplyDir(), 'config.json')) {}

  // Database-based config (for key-value pairs)
  get(key: string): string | null {
    const db = getDb();
    const row = db
      .query<{ value: string }, [string]>('SELECT value FROM config WHERE key = ?')
      .get(key);
    return row?.value ?? null;
  }

  set(key: string, value: string): void {
    const db = getDb();
    db.run(
      'INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?',
      [key, value, value]
    );
  }

  delete(key: string): boolean {
    const db = getDb();
    const result = db.run('DELETE FROM config WHERE key = ?', [key]);
    return result.changes > 0;
  }

  getAll(): Record<string, string> {
    const db = getDb();
    const rows = db
      .query<{ key: string; value: string }, []>('SELECT key, value FROM config')
      .all();
    const config: Record<string, string> = {};
    for (const row of rows) {
      config[row.key] = row.value;
    }
    return config;
  }

  // File-based config (for AppConfig object)
  loadAppConfig(): AppConfig {
    if (existsSync(this.configPath)) {
      try {
        const content = readFileSync(this.configPath, 'utf-8');
        return mergeAppConfig(JSON.parse(content) as Partial<AppConfig>);
      } catch {
        return mergeAppConfig(undefined);
      }
    }
    return mergeAppConfig(undefined);
  }

  saveAppConfig(config: AppConfig): void {
    mkdirSync(dirname(this.configPath), { recursive: true });
    writeFileSync(this.configPath, JSON.stringify(config, null, 2));
  }

  updateAppConfig(updates: Partial<AppConfig>): AppConfig {
    const current = this.loadAppConfig();
    const updated = {
      ...current,
      ...updates,
      ai: { ...current.ai, ...updates.ai },
      browser: { ...current.browser, ...updates.browser },
      application: { ...current.application, ...updates.application },
    };
    this.saveAppConfig(updated);
    return updated;
  }

  setConfigValue(path: string, value: unknown): AppConfig {
    const config = this.loadAppConfig();
    const parts = path.split('.');

    // Navigate to the nested location
    let current: Record<string, unknown> = config as unknown as Record<string, unknown>;
    for (let i = 0; i < parts.length - 1; i++) {
      if (typeof current[parts[i]] !== 'object' || current[parts[i]] === null) {
        current[parts[i]] = {};
      }
      current = current[parts[i]] as Record<string, unknown>;
    }

    // Set the value
    const lastKey = parts[parts.length - 1];

    // Try to parse as JSON if it's a string
    if (typeof value === 'string') {
      try {
        value = JSON.parse(value);
      } catch {
        // Keep as string
      }
    }

    current[lastKey] = value;
    this.saveAppConfig(config);
    return config;
  }

  getConfigValue(path: string): unknown {
    const config = this.loadAppConfig();
    const parts = path.split('.');

    let current: unknown = config;
    for (const part of parts) {
      if (typeof current !== 'object' || current === null) {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }

    return current;
  }
}

export const configRepository = new ConfigRepository();
