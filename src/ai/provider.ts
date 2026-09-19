import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { AIProvider, AIProviderType, AIConfig } from '../types';
import { configRepository } from '../db/repositories/config';
import { credentialStore } from '../db/repositories/secure-credentials';
import { withRetry } from '../utils/retry';
import { circuitBreakers } from '../utils/retry';
import { aiRateLimiter, withRateLimit } from '../utils/rate-limiter';
import { logger } from '../utils/logger';

// Model mappings for each provider
const MODEL_DEFAULTS: Record<AIProviderType, string> = {
  openai: 'gpt-5.4-mini',
  anthropic: 'claude-sonnet-4-6',
  google: 'gemini-3.1-flash-lite-preview',
  ollama: 'llama3.2',
  lmstudio: 'local-model',
};

const API_KEY_ENV_VARS: Partial<Record<AIProviderType, string>> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  google: 'GOOGLE_API_KEY',
};

interface AIConfigExtended extends AIConfig {
  apiKey?: string;
}

type CloudProvider = 'openai' | 'anthropic' | 'google';

async function resolveApiKey(provider: AIProviderType): Promise<string | null> {
  if (!['openai', 'anthropic', 'google'].includes(provider)) {
    return null;
  }

  const cloudProvider = provider as CloudProvider;

  // Precedence: env var > keychain/file store. The deprecated config-file
  // key is intentionally not read — env and secure storage are the only
  // sources, so `config.ai.apiKey` is never persisted.
  const envKey = API_KEY_ENV_VARS[cloudProvider];
  if (envKey && process.env[envKey]) {
    return process.env[envKey] ?? null;
  }

  // Priority 2: Secure keychain storage
  const keychainKey = await credentialStore.getApiKey(cloudProvider);
  if (keychainKey) {
    return keychainKey;
  }

  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const modelCache = new Map<string, any>();

function hashKey(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

/**
 * Clears cached model clients. Called after credential writes so a fixed
 * API key takes effect without a process restart.
 */
export function clearModelCache(): void {
  modelCache.clear();
}

async function createModel(config: AIConfigExtended) {
  const modelId = config.model || MODEL_DEFAULTS[config.provider];

  // Resolve API key first so the cache key binds to the credential.
  // A rotated key must not reuse a client built with the stale key.
  const apiKey = await resolveApiKey(config.provider);
  const keyFingerprint = apiKey ? hashKey(apiKey) : 'nokey';
  const cacheKey = `${config.provider}:${modelId}:${config.baseUrl ?? ''}:${keyFingerprint}`;

  const cached = modelCache.get(cacheKey);
  if (cached) return cached;

  const isCloudProvider = ['openai', 'anthropic', 'google'].includes(config.provider);
  if (isCloudProvider && !apiKey) {
    throw new Error(
      `Missing API Key for ${config.provider}. Set ${API_KEY_ENV_VARS[config.provider]} env var or store securely.`
    );
  }

  switch (config.provider) {
    case 'openai': {
      const openai = createOpenAI({
        apiKey: apiKey ?? '',
        headers: {
          'OpenAI-Beta': 'prompt-caching=v1',
        },
      });
      const openaiModel = openai(modelId);
      modelCache.set(cacheKey, openaiModel);
      return openaiModel;
    }
    case 'anthropic': {
      const anthropic = createAnthropic({
        apiKey: apiKey ?? '',
        headers: {
          'anthropic-beta': 'prompt-caching-2024-07-31',
        },
      });
      const anthropicModel = anthropic(modelId);
      modelCache.set(cacheKey, anthropicModel);
      return anthropicModel;
    }
    case 'google': {
      const google = createGoogleGenerativeAI({
        apiKey: apiKey ?? '',
      });
      const googleModel = google(modelId);
      modelCache.set(cacheKey, googleModel);
      return googleModel;
    }
    case 'ollama': {
      // Ollama uses OpenAI-compatible API
      let baseUrl = config.baseUrl ?? 'http://localhost:11434';
      if (!baseUrl.endsWith('/v1')) {
        baseUrl = baseUrl.replace(/\/$/, '') + '/v1';
      }
      const ollama = createOpenAI({
        baseURL: baseUrl,
        apiKey: 'ollama',
      });
      const ollamaModel = ollama(modelId);
      modelCache.set(cacheKey, ollamaModel);
      return ollamaModel;
    }
    case 'lmstudio': {
      // LMStudio uses OpenAI-compatible API
      let lmBaseUrl = config.baseUrl ?? 'http://localhost:1234';
      if (!lmBaseUrl.endsWith('/v1')) {
        lmBaseUrl = lmBaseUrl.replace(/\/$/, '') + '/v1';
      }
      const lmstudio = createOpenAI({
        baseURL: lmBaseUrl,
        apiKey: 'lmstudio',
      });
      const lmModel = lmstudio(modelId);
      modelCache.set(cacheKey, lmModel);
      return lmModel;
    }
    default:
      throw new Error(`Unknown AI provider: ${config.provider}`);
  }
}

class UnifiedAIProvider implements AIProvider {
  name: AIProviderType;
  private config: AIConfig;

  constructor(config: AIConfig) {
    this.name = config.provider;
    this.config = config;
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Local providers: cheap TCP probe, no billed completion.
      if (this.name === 'ollama' || this.name === 'lmstudio') {
        const model = await createModel(this.config);
        await generateText({
          model,
          prompt: 'Hi',
          maxTokens: 50,
        });
        return true;
      }
      // Cloud providers: "available" means a syntactically valid key is
      // configured. A full completion here would bill the user on every
      // health check / test click, so avoid it.
      const apiKey = await resolveApiKey(this.name);
      if (!apiKey || apiKey.length < 8) return false;
      // createModel throws when the key is missing/misconfigured.
      await createModel(this.config);
      return true;
    } catch {
      return false;
    }
  }

  async generateText(prompt: string, systemPrompt?: string): Promise<string> {
    return withRateLimit(aiRateLimiter, async () => {
      return circuitBreakers.ai.execute(async () => {
        return withRetry(
          async () => {
            const model = await createModel(this.config);
            const result = await generateText({
              model,
              system: systemPrompt,
              prompt,
              temperature: this.config.temperature ?? 0.7,
            });
            return result.text;
          },
          {
            maxRetries: 3,
            minTimeout: 1000,
            maxTimeout: 15000,
            operationName: `AI generateText (${this.name})`,
            onRetry: (error, attempt) => {
              logger.warn(
                `AI call retry ${attempt}/3: ${error.message}`,
                {
                  provider: this.name,
                  attempt,
                },
                'ai'
              );
            },
          }
        );
      });
    });
  }
}

export function createAIProvider(config?: AIConfig): AIProvider {
  const aiConfig = config ?? configRepository.loadAppConfig().ai;
  return new UnifiedAIProvider(aiConfig);
}

export function getAvailableProviders(): AIProviderType[] {
  return ['openai', 'anthropic', 'google', 'ollama', 'lmstudio'];
}

export async function testProvider(
  provider: AIProvider
): Promise<{ success: boolean; error?: string }> {
  try {
    // Single billed completion doubles as the availability check.
    // Do not call isAvailable() first — that would bill twice.
    const response = await provider.generateText('Say "hello" and nothing else.');
    if (!response || response.length === 0) {
      return { success: false, error: 'Provider returned empty response' };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export type { AIProvider };
