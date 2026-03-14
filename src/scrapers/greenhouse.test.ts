import { describe, expect, test } from 'bun:test';
import { normalizeGreenhouseCompanyName } from './greenhouse';

describe('normalizeGreenhouseCompanyName', () => {
  test('strips a leading "At" prefix from embedded Greenhouse headers', () => {
    expect(normalizeGreenhouseCompanyName('At HYPR')).toBe('HYPR');
  });

  test('preserves uppercase acronyms', () => {
    expect(normalizeGreenhouseCompanyName('OKTA')).toBe('OKTA');
  });

  test('title-cases standard company names', () => {
    expect(normalizeGreenhouseCompanyName('acme corp')).toBe('Acme Corp');
  });

  test('returns Unknown Company for empty values', () => {
    expect(normalizeGreenhouseCompanyName('   ')).toBe('Unknown Company');
  });
});
