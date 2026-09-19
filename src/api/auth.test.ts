import { describe, expect, test } from 'bun:test';
import { isValidBearerToken, isValidTokenValue, isPublicPath } from './auth';

describe('API auth', () => {
  test('accepts the correct bearer token', () => {
    expect(isValidBearerToken('Bearer abc123', 'abc123')).toBe(true);
    expect(isValidTokenValue('abc123', 'abc123')).toBe(true);
  });

  test('rejects wrong, missing, or malformed tokens', () => {
    expect(isValidBearerToken('Bearer wrong', 'abc123')).toBe(false);
    expect(isValidBearerToken(undefined, 'abc123')).toBe(false);
    expect(isValidBearerToken('Token abc123', 'abc123')).toBe(false);
    expect(isValidTokenValue('', 'abc123')).toBe(false);
  });

  test('only /health is public', () => {
    expect(isPublicPath('/health')).toBe(true);
    expect(isPublicPath('/health?x=1')).toBe(true);
    expect(isPublicPath('/profile')).toBe(false);
    expect(isPublicPath(undefined)).toBe(false);
  });
});
