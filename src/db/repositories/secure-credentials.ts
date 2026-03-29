import { getPassword, setPassword, deletePassword, findCredentials } from 'keytar';

const SERVICE_NAME = 'autoply';

const CREDENTIAL_KEYS = {
  openai: 'openai_api_key',
  anthropic: 'anthropic_api_key',
  google: 'google_api_key',
} as const;

export class SecureCredentialStore {
  async getApiKey(provider: 'openai' | 'anthropic' | 'google'): Promise<string | null> {
    const key = CREDENTIAL_KEYS[provider];
    if (!key) return null;

    try {
      const value = await getPassword(SERVICE_NAME, key);
      return value;
    } catch (error) {
      console.error(`Failed to retrieve API key from keychain:`, error);
      return null;
    }
  }

  async setApiKey(provider: 'openai' | 'anthropic' | 'google', apiKey: string): Promise<boolean> {
    const key = CREDENTIAL_KEYS[provider];
    if (!key) return false;

    try {
      await setPassword(SERVICE_NAME, key, apiKey);
      return true;
    } catch (error) {
      console.error(`Failed to store API key in keychain:`, error);
      return false;
    }
  }

  async deleteApiKey(provider: 'openai' | 'anthropic' | 'google'): Promise<boolean> {
    const key = CREDENTIAL_KEYS[provider];
    if (!key) return false;

    try {
      await deletePassword(SERVICE_NAME, key);
      return true;
    } catch (error) {
      console.error(`Failed to delete API key from keychain:`, error);
      return false;
    }
  }

  async getAllApiKeys(): Promise<Record<string, string | null>> {
    try {
      const credentials = await findCredentials(SERVICE_NAME);
      const keys: Record<string, string | null> = {
        openai: null,
        anthropic: null,
        google: null,
      };

      for (const cred of credentials) {
        if (cred.account === CREDENTIAL_KEYS.openai) keys.openai = cred.password;
        if (cred.account === CREDENTIAL_KEYS.anthropic) keys.anthropic = cred.password;
        if (cred.account === CREDENTIAL_KEYS.google) keys.google = cred.password;
      }

      return keys;
    } catch (error) {
      console.error(`Failed to retrieve API keys from keychain:`, error);
      return { openai: null, anthropic: null, google: null };
    }
  }
}

export const credentialStore = new SecureCredentialStore();
