import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { applicationRepository } from '../db/repositories/application';
import { profileRepository } from '../db/repositories/profile';
import { configRepository } from '../db/repositories/config';
import { applicationOrchestrator } from '../core/application';
import { createAIProvider, testProvider } from '../ai/provider';
import type { Platform, Profile, AppConfig, ApplicationStatus, AIConfig } from '../types';

const DEFAULT_API_PORT = 8088;

const fastify = Fastify({
  logger: true,
  bodyLimit: 10 * 1024 * 1024, // 10MB
});

// Plugins
fastify.register(cors, {
  origin: '*', // For extension development (can be restricted in prod)
});
fastify.register(multipart);

// --- Health Check ---
fastify.get('/health', async () => {
  return { status: 'ok', version: '1.0.0' };
});

// --- Profile Routes ---
fastify.get('/profile', async () => {
  const profile = profileRepository.findFirst();
  if (!profile) return { error: 'No profile found' };
  return profile;
});

fastify.post('/profile', async (request, reply) => {
  const data = request.body as Profile;
  try {
    if (data.id === undefined) return reply.status(400).send({ error: 'Profile ID is required' });
    const updated = profileRepository.update(data.id, data);
    return updated;
  } catch (error) {
    return reply.status(400).send({ error: (error as Error).message });
  }
});

// --- Config Routes ---
fastify.get('/config', async () => {
  return configRepository.loadAppConfig();
});

fastify.post('/config', async (request) => {
  const data = request.body as AppConfig;
  
  // Update environment variables for API keys if provided
  if (data.ai.provider === 'openai' && data.ai.apiKey) {
    process.env.OPENAI_API_KEY = data.ai.apiKey;
  } else if (data.ai.provider === 'anthropic' && data.ai.apiKey) {
    process.env.ANTHROPIC_API_KEY = data.ai.apiKey;
  } else if (data.ai.provider === 'google' && data.ai.apiKey) {
    process.env.GOOGLE_API_KEY = data.ai.apiKey;
  }

  configRepository.saveAppConfig(data);
  return { success: true };
});

fastify.post('/config/test', async (request, reply) => {
  const config = request.body as { ai: AIConfig };
  try {
    const provider = createAIProvider(config.ai);
    const result = await testProvider(provider);
    return result;
  } catch (error) {
    return reply.status(400).send({ success: false, error: (error as Error).message });
  }
});

// --- Application Routes ---
interface ApplicationQueryParams {
  status?: ApplicationStatus;
  company?: string;
}

fastify.get('/applications', async (request) => {
  const { status, company } = request.query as ApplicationQueryParams;
  return applicationRepository.findAll({ status, company });
});

fastify.post('/applications/evaluate', async (request, reply) => {
  const { url: _url } = request.body as { url: string; platform: Platform };

  const profile = profileRepository.findFirst();
  if (!profile) return reply.status(400).send({ error: 'No profile found' });

  try {
    createAIProvider();
    // In a real scenario, we might want to scrape the job first if not provided
    // For now, assume this is called after scraping or with job data
    return { message: 'Use /jobs/scrape first' };
  } catch (error) {
    return reply.status(500).send({ error: (error as Error).message });
  }
});

// --- Scraper & Action Routes ---
fastify.post('/jobs/passive-process', async (request, reply) => {
  const { html, url, platform } = request.body as { html: string; url: string; platform: Platform };
  try {
    const result = await applicationOrchestrator.processJobPassively(html, url, platform);
    return result;
  } catch (error) {
    return reply.status(500).send({ error: (error as Error).message });
  }
});

fastify.post('/jobs/scrape', async (request, reply) => {
  const { url } = request.body as { url: string };
  try {
    // This is a heavy operation, might eventually need a queue
    // For now, direct call
    const result = await applicationOrchestrator.applyToJob(url, { dryRun: true });
    return result;
  } catch (error) {
    return reply.status(500).send({ error: (error as Error).message });
  }
});

fastify.post('/applications/apply', async (request, reply) => {
  const { url, autoSubmit } = request.body as { url: string; autoSubmit?: boolean };
  try {
    const result = await applicationOrchestrator.applyToJob(url, {
      autoMode: autoSubmit,
    });
    return result;
  } catch (error) {
    return reply.status(500).send({ error: (error as Error).message });
  }
});

// --- Start Server ---
const start = async () => {
  try {
    const parsedPort = Number.parseInt(process.env.PORT ?? '', 10);
    const port = Number.isFinite(parsedPort) ? parsedPort : DEFAULT_API_PORT;
    const host = process.env.HOST || '0.0.0.0';
    await fastify.listen({ port, host });
    const displayHost = host === '0.0.0.0' ? 'localhost' : host;
    console.log(`Autoply API server running at http://${displayHost}:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
