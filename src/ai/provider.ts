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

export interface AIConfigExtended extends AIConfig {
  apiKey?: string;
}

type CloudProvider = 'openai' | 'anthropic' | 'google';

async function resolveApiKey(provider: AIProviderType): Promise<string | null> {
  if (!['openai', 'anthropic', 'google'].includes(provider)) {
    return null;
  }

  const cloudProvider = provider as CloudProvider;

  // Priority 1: Environment variable (most secure - never stored)
  const envKey = API_KEY_ENV_VARS[cloudProvider];
  if (envKey && process.env[envKey]) {
    return process.env[envKey] ?? null;
  }

  // Priority 2: Secure keychain storage
  const keychainKey = await credentialStore.getApiKey(cloudProvider);
  if (keychainKey) {
    return keychainKey;
  }

  // Priority 3: Config file (deprecated - warn user)
  const config = configRepository.loadAppConfig();
  if (config.ai.apiKey && config.ai.provider === cloudProvider) {
    console.warn(
      `[Deprecation Warning] Storing API keys in config.json is deprecated. ` +
        `Use environment variable ${envKey} or the secure keychain instead.`
    );
    return config.ai.apiKey;
  }

  return null;
}

async function createModel(config: AIConfigExtended) {
  const modelId = config.model || MODEL_DEFAULTS[config.provider];

  // Resolve API key from secure storage (priority: env > keychain > config)
  const apiKey = await resolveApiKey(config.provider);

  const isCloudProvider = ['openai', 'anthropic', 'google'].includes(config.provider);
  if (isCloudProvider && !apiKey) {
    throw new Error(
      `Missing API Key for ${config.provider}. Set ${API_KEY_ENV_VARS[config.provider]} env var or store securely.`
    );
  }

  switch (config.provider) {
    case 'openai': {
      const openai = createOpenAI({
        apiKey: apiKey!,
        headers: {
          'OpenAI-Beta': 'prompt-caching=v1',
        },
      });
      return openai(modelId);
    }
    case 'anthropic': {
      const anthropic = createAnthropic({
        apiKey: apiKey!,
        headers: {
          'anthropic-beta': 'prompt-caching-2024-07-31',
        },
      });
      return anthropic(modelId);
    }
    case 'google': {
      const google = createGoogleGenerativeAI({
        apiKey: apiKey!,
      });
      return google(modelId);
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
      return ollama(modelId);
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
      return lmstudio(modelId);
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
      const model = await createModel(this.config);
      await generateText({
        model,
        prompt: 'Hi',
        maxTokens: 50,
      });
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
              logger.warn(`AI call retry ${attempt}/3: ${error.message}`, {
                provider: this.name,
                attempt,
              }, 'ai');
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
    const available = await provider.isAvailable();
    if (!available) {
      return { success: false, error: 'Provider is not available or not running' };
    }

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
