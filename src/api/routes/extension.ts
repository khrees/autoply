import type { FastifyInstance } from 'fastify';
import { profileRepository } from '../../db/repositories/profile';
import { configRepository } from '../../db/repositories/config';
import { createAIProvider, testProvider } from '../../ai/provider';

export function registerExtensionRoutes(app: FastifyInstance): void {
  app.get('/extension/status', async () => {
    const profile = profileRepository.findFirst();
    const config = configRepository.loadAppConfig();

    let aiProviderStatus: { available: boolean; error?: string } = { available: false };

    try {
      const provider = createAIProvider();
      aiProviderStatus = await testProvider(provider)
        .then((result) => ({ available: result.success, error: result.error }))
        .catch((error) => ({ available: false, error: error.message }));
    } catch (error) {
      aiProviderStatus = { available: false, error: (error as Error).message };
    }

    return {
      hasProfile: !!profile,
      profileName: profile?.name || null,
      aiProvider: config.ai.provider,
      aiProviderStatus,
      autoSubmitEnabled: config.application.autoSubmit,
    };
  });
}
