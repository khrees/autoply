import { describe, test, expect } from 'bun:test';
import { normalizeUrl } from './url-parser';

describe('normalizeUrl', () => {
  test('strips trailing slash', () => {
    expect(normalizeUrl('https://boards.greenhouse.io/company/jobs/123/')).toBe(
      'https://boards.greenhouse.io/company/jobs/123'
    );
  });

  test('strips fragment', () => {
    expect(normalizeUrl('https://example.com/job#apply')).toBe('https://example.com/job');
  });

  test('strips utm params but keeps job params', () => {
    expect(normalizeUrl('https://example.com/job?gh_jid=123&utm_source=google')).toBe(
      'https://example.com/job?gh_jid=123'
    );
  });

  test('strips multiple tracking params', () => {
    expect(normalizeUrl('https://example.com/job?fbclid=abc&gclid=def&ref=twitter&id=42')).toBe(
      'https://example.com/job?id=42'
    );
  });

  test('sorts query params', () => {
    expect(normalizeUrl('https://example.com/job?b=2&a=1')).toBe('https://example.com/job?a=1&b=2');
  });

  test('returns original on invalid URL', () => {
    expect(normalizeUrl('not-a-url')).toBe('not-a-url');
  });

  test('handles URL with no path beyond root', () => {
    expect(normalizeUrl('https://example.com')).toBe('https://example.com/');
  });
});
