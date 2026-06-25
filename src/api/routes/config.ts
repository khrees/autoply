import type { FastifyInstance } from 'fastify';
import { configRepository } from '../../db/repositories/config';
import { credentialStore } from '../../db/repositories/secure-credentials';
import { createAIProvider, testProvider } from '../../ai/provider';
import type { AppConfig, AIConfig } from '../../types';

export function registerConfigRoutes(app: FastifyInstance): void {
  app.get('/config', async () => {
    const config = configRepository.loadAppConfig();
    if (config.ai) {
      config.ai.apiKey = undefined;
    }
    return config;
  });

  app.post('/config', async (request) => {
    const data = request.body as AppConfig;

    if (data.ai.apiKey) {
      const provider = data.ai.provider;
      if (provider === 'openai' || provider === 'anthropic' || provider === 'google') {
        await credentialStore.setApiKey(provider, data.ai.apiKey);
        data.ai.apiKey = undefined;
      }
    }

    configRepository.saveAppConfig(data);
    return { success: true };
  });

  app.post('/config/test', async (request, reply) => {
    const config = request.body as { ai: AIConfig };
    try {
      const provider = createAIProvider(config.ai);
      const result = await testProvider(provider);
      return result;
    } catch (error) {
      return reply.status(400).send({ success: false, error: (error as Error).message });
    }
  });

  // Credential management
  app.post('/credentials/store', async (request, reply) => {
    const { provider, apiKey } = request.body as {
      provider: 'openai' | 'anthropic' | 'google';
      apiKey: string;
    };
    if (!provider || !apiKey) {
      return reply.status(400).send({ success: false, error: 'Provider and API key required' });
    }
    const success = await credentialStore.setApiKey(provider, apiKey);
    return { success };
  });

  app.post('/credentials/delete', async (request, reply) => {
    const { provider } = request.body as { provider: 'openai' | 'anthropic' | 'google' };
    if (!provider) {
      return reply.status(400).send({ success: false, error: 'Provider required' });
    }
    const success = await credentialStore.deleteApiKey(provider);
    return { success };
  });

  app.get('/credentials/status', async () => {
    const keys = await credentialStore.getAllApiKeys();
    return {
      openai: !!keys.openai,
      anthropic: !!keys.anthropic,
      google: !!keys.google,
    };
  });
}
