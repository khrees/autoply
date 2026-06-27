import { describe, expect, test } from 'bun:test';
import { selectBrowserEngine } from './browser-manager';
import { DEFAULT_CONFIG, type AppConfig } from '../types';

function createConfig(overrides?: Partial<AppConfig['browser']>): AppConfig {
  return {
    ...DEFAULT_CONFIG,
    browser: {
      ...DEFAULT_CONFIG.browser,
      ...overrides,
    },
  };
}

describe('selectBrowserEngine', () => {
  test('defaults to playwright', () => {
    const config = createConfig();

    expect(
      selectBrowserEngine(config, 'greenhouse', 'https://boards.greenhouse.io/company/jobs/1')
    ).toBe('playwright');
  });

  test('uses patchright when configured as the global engine', () => {
    const config = createConfig({ engine: 'patchright' });

    expect(
      selectBrowserEngine(config, 'greenhouse', 'https://boards.greenhouse.io/company/jobs/1')
    ).toBe('patchright');
  });

  test('uses patchright for configured hosts and their subdomains', () => {
    const config = createConfig({ patchrightHosts: ['hypr.com'] });

    expect(selectBrowserEngine(config, 'greenhouse', 'https://www.hypr.com/company/careers')).toBe(
      'patchright'
    );
  });

  test('uses patchright for configured platforms', () => {
    const config = createConfig({ patchrightPlatforms: ['linkedin'] });

    expect(selectBrowserEngine(config, 'linkedin', 'https://www.linkedin.com/jobs/view/1')).toBe(
      'patchright'
    );
  });
});
