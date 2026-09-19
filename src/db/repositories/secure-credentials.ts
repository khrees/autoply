import { getPassword, setPassword, deletePassword, findCredentials } from 'keytar';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'fs';
import { join } from 'path';
import { getAutoplyDir, ensureAutoplyDir } from '../index';

const SERVICE_NAME = 'autoply';

const CREDENTIAL_KEYS = {
  openai: 'openai_api_key',
  anthropic: 'anthropic_api_key',
  google: 'google_api_key',
} as const;

const FILE_STORE = 'credentials.json';

function readFileStore(): Record<string, string> {
  try {
    const path = join(getAutoplyDir(), FILE_STORE);
    if (!existsSync(path)) return {};
    const raw = readFileSync(path, 'utf-8');
    const data = JSON.parse(raw);
    if (data && typeof data === 'object') return data as Record<string, string>;
    return {};
  } catch {
    return {};
  }
}

function writeFileStore(data: Record<string, string>): void {
  ensureAutoplyDir();
  const path = join(getAutoplyDir(), FILE_STORE);
  writeFileSync(path, JSON.stringify(data, null, 2), { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // Best-effort
  }
}

function warnKeychainFallback(operation: string): void {
  console.warn(
    `[autoply] Keychain unavailable (${operation}); using encrypted-at-rest file fallback at ~/.autoply/${FILE_STORE} with 0600 permissions. ` +
      `Set the key via env var for containers without a keychain.`
  );
}

export class SecureCredentialStore {
  async getApiKey(provider: 'openai' | 'anthropic' | 'google'): Promise<string | null> {
    const key = CREDENTIAL_KEYS[provider];
    if (!key) return null;

    try {
      const value = await getPassword(SERVICE_NAME, key);
      if (value) return value;
    } catch (error) {
      warnKeychainFallback(`get ${provider}`);
    }
    // File fallback (containers without a keychain/D-Bus)
    return readFileStore()[key] ?? null;
  }

  async setApiKey(provider: 'openai' | 'anthropic' | 'google', apiKey: string): Promise<boolean> {
    const key = CREDENTIAL_KEYS[provider];
    if (!key) return false;

    try {
      await setPassword(SERVICE_NAME, key, apiKey);
      return true;
    } catch (error) {
      warnKeychainFallback(`set ${provider}`);
    }
    try {
      const store = readFileStore();
      store[key] = apiKey;
      writeFileStore(store);
      return true;
    } catch (error) {
      console.error(`Failed to store API key in file fallback:`, error);
      return false;
    }
  }

  async deleteApiKey(provider: 'openai' | 'anthropic' | 'google'): Promise<boolean> {
    const key = CREDENTIAL_KEYS[provider];
    if (!key) return false;

    let keychainOk = true;
    try {
      await deletePassword(SERVICE_NAME, key);
    } catch (error) {
      keychainOk = false;
      warnKeychainFallback(`delete ${provider}`);
    }
    try {
      const store = readFileStore();
      if (key in store) {
        delete store[key];
        writeFileStore(store);
      }
      return true;
    } catch (error) {
      console.error(`Failed to delete API key from file fallback:`, error);
      return keychainOk;
    }
  }

  async getAllApiKeys(): Promise<Record<string, string | null>> {
    const keys: Record<string, string | null> = {
      openai: null,
      anthropic: null,
      google: null,
    };
    try {
      const credentials = await findCredentials(SERVICE_NAME);
      for (const cred of credentials) {
        if (cred.account === CREDENTIAL_KEYS.openai) keys.openai = cred.password;
        if (cred.account === CREDENTIAL_KEYS.anthropic) keys.anthropic = cred.password;
        if (cred.account === CREDENTIAL_KEYS.google) keys.google = cred.password;
      }
    } catch (error) {
      warnKeychainFallback('list');
    }
    // Overlay file fallback for any missing keys
    const fileStore = readFileStore();
    for (const [provider, account] of Object.entries(CREDENTIAL_KEYS)) {
      if (!keys[provider] && fileStore[account]) {
        keys[provider] = fileStore[account];
      }
    }

    return keys;
  }
}

export const credentialStore = new SecureCredentialStore();
