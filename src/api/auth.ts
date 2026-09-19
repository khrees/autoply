import { existsSync, readFileSync, writeFileSync, chmodSync } from 'fs';
import { join } from 'path';
import { randomBytes, timingSafeEqual } from 'crypto';
import { getAutoplyDir, ensureAutoplyDir } from '../db';

const TOKEN_FILE = 'api-token';
const TOKEN_ENV_VAR = 'AUTOPLY_API_TOKEN';

/**
 * Returns the configured API token, generating and persisting one on first run.
 * Priority: env var > persisted file > newly generated.
 */
export function getOrCreateApiToken(): string {
  const fromEnv = process.env[TOKEN_ENV_VAR]?.trim();
  if (fromEnv) return fromEnv;

  ensureAutoplyDir();
  const tokenPath = join(getAutoplyDir(), TOKEN_FILE);
  try {
    if (existsSync(tokenPath)) {
      const saved = readFileSync(tokenPath, 'utf-8').trim();
      if (saved.length >= 16) return saved;
    }
  } catch {
    // Fall through to generation
  }

  const token = randomBytes(32).toString('hex');
  try {
    writeFileSync(tokenPath, `${token}\n`, { mode: 0o600 });
    try {
      chmodSync(tokenPath, 0o600);
    } catch {
      // Best-effort on platforms without chmod
    }
  } catch {
    // Ephemeral fallback — still better than no auth
  }
  return token;
}

/**
 * Constant-time bearer token comparison.
 * Accepts the standard `Authorization: Bearer` header or, for iframe/embed
 * previews and plain `<a download>` links that cannot set headers,
 * a `?token=` query parameter.
 */
export function isValidBearerToken(authorizationHeader: unknown, expectedToken: string): boolean {
  if (typeof authorizationHeader !== 'string') return false;
  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  return isValidTokenValue(match[1].trim(), expectedToken);
}

export function isValidTokenValue(provided: string, expectedToken: string): boolean {
  if (!provided || !expectedToken) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expectedToken);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Paths that never require auth (liveness probes).
 */
export function isPublicPath(url: string | undefined): boolean {
  if (!url) return false;
  const path = url.split('?')[0];
  return path === '/health';
}
