import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ConfigRepository } from './config';
import { DEFAULT_CONFIG } from '../../types';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'autoply-config-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('ConfigRepository', () => {
  test('loadAppConfig deep merges nested defaults', () => {
    const tempDir = createTempDir();
    const configPath = join(tempDir, 'config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        application: {
          autoSubmit: true,
        },
      })
    );

    const repo = new ConfigRepository(configPath);
    const config = repo.loadAppConfig();

    expect(config.application.autoSubmit).toBe(true);
    expect(config.application.fillOptionalFields).toBe(DEFAULT_CONFIG.application.fillOptionalFields);
    expect(config.application.retryAttempts).toBe(DEFAULT_CONFIG.application.retryAttempts);
    expect(config.browser.timeout).toBe(DEFAULT_CONFIG.browser.timeout);
    expect(config.browser.engine).toBe(DEFAULT_CONFIG.browser.engine);
    expect(config.browser.patchrightHosts).toEqual(DEFAULT_CONFIG.browser.patchrightHosts);
    expect(config.ai.provider).toBe(DEFAULT_CONFIG.ai.provider);
  });

  test('setConfigValue does not mutate DEFAULT_CONFIG', () => {
    const tempDir = createTempDir();
    const repo = new ConfigRepository(join(tempDir, 'config.json'));

    repo.setConfigValue('application.autoSubmit', true);

    expect(DEFAULT_CONFIG.application.autoSubmit).toBe(false);
  });

  test('saveAppConfig creates the config directory', () => {
    const tempDir = createTempDir();
    const configPath = join(tempDir, 'nested', 'config.json');
    const repo = new ConfigRepository(configPath);

    repo.saveAppConfig(DEFAULT_CONFIG);

    expect(existsSync(configPath)).toBe(true);
  });
});
