import type { FastifyInstance } from 'fastify';
import { configRepository } from '../../db/repositories/config';

export function registerAIRoutes(app: FastifyInstance): void {
  app.get('/ai/models', async (request, reply) => {
    const config = configRepository.loadAppConfig();

    if (config.ai.provider !== 'ollama' && config.ai.provider !== 'lmstudio') {
      return reply.status(400).send({
        success: false,
        error: 'Model listing only supported for Ollama and LM Studio',
      });
    }

    try {
      const baseUrl =
        config.ai.baseUrl ||
        (config.ai.provider === 'ollama' ? 'http://localhost:11434' : 'http://localhost:1234');

      if (config.ai.provider === 'ollama') {
        const response = await fetch(`${baseUrl}/api/tags`);
        if (!response.ok) {
          throw new Error(`Ollama returned ${response.status}`);
        }
        const data = (await response.json()) as {
          models?: Array<{ name: string; size?: number; modified_at?: string }>;
        };
        const models = (data.models || []).map((m) => m.name).filter(Boolean).sort();
        return { success: true, models, provider: 'ollama' };
      } else {
        const lmBaseUrl = baseUrl.replace(/\/$/, '') + '/v1';
        const response = await fetch(`${lmBaseUrl}/models`);
        if (!response.ok) {
          throw new Error(`LM Studio returned ${response.status}`);
        }
        const data = (await response.json()) as { data?: Array<{ id: string }> };
        const models = (data.data || []).map((m) => m.id).filter(Boolean).sort();
        return { success: true, models, provider: 'lmstudio' };
      }
    } catch (error) {
      return reply.status(503).send({
        success: false,
        error: `Failed to fetch models: ${(error as Error).message}`,
        models: [],
      });
    }
  });
}
