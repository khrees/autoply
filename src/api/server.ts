import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { z } from 'zod';
import { join } from 'path';
import { tmpdir } from 'os';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';
import { applicationRepository } from '../db/repositories/application';
import { profileRepository } from '../db/repositories/profile';
import { configRepository } from '../db/repositories/config';
import { credentialStore } from '../db/repositories/secure-credentials';
import { applicationOrchestrator } from '../core/application';
import { createAIProvider, testProvider } from '../ai/provider';
import { applicationQueue } from '../core/queue';
import { checkDocGenRateLimit } from '../utils/rate-limiter';
import type { Platform, Profile, AppConfig, ApplicationStatus, AIConfig } from '../types';

const DEFAULT_API_PORT = 8088;
const TEMP_DOC_DIR = join(tmpdir(), 'autoply-extension');
const TEMP_FILE_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

// ── Background queue jobs ─────────────────────────────────────────────────────
// Keyed by a random job ID so clients can poll /queue/jobs/:id for results.
interface QueueJob {
  id: string;
  status: 'running' | 'done' | 'error';
  startedAt: string;
  finishedAt?: string;
  processed?: number;
  results?: unknown[];
  error?: string;
}
const runningQueueJobs = new Map<string, QueueJob>();

function cleanupTempDocs(): void {
  if (!existsSync(TEMP_DOC_DIR)) return;
  const now = Date.now();
  try {
    for (const file of readdirSync(TEMP_DOC_DIR)) {
      const filePath = join(TEMP_DOC_DIR, file);
      try {
        const { mtimeMs } = statSync(filePath);
        if (now - mtimeMs > TEMP_FILE_MAX_AGE_MS) unlinkSync(filePath);
      } catch {
        // ignore individual file errors
      }
    }
  } catch {
    // ignore cleanup errors
  }
}

const fastify = Fastify({
  logger: true,
  bodyLimit: 10 * 1024 * 1024, // 10MB
});

// Plugins
fastify.register(cors, {
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, Postman, same-origin)
    if (!origin) return callback(null, true);
    // Allow browser extensions and localhost only
    const allowed =
      origin.startsWith('chrome-extension://') ||
      origin.startsWith('moz-extension://') ||
      /^https?:\/\/localhost(:\d+)?$/.test(origin) ||
      /^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin);
    callback(allowed ? null : new Error('CORS: origin not allowed'), allowed);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
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

const ProfileBodySchema = z.object({
  id: z.number().optional(),
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  location: z.string().optional(),
  linkedin_url: z.string().url().optional().or(z.literal('')),
  github_url: z.string().url().optional().or(z.literal('')),
  portfolio_url: z.string().url().optional().or(z.literal('')),
  base_resume: z.string().optional(),
  base_cover_letter: z.string().optional(),
  preferences: z.record(z.unknown()).optional(),
  skills: z.array(z.string()).optional(),
  experience: z.array(z.record(z.unknown())).optional(),
  education: z.array(z.record(z.unknown())).optional(),
});

fastify.post('/profile', async (request, reply) => {
  const parsed = ProfileBodySchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: parsed.error.flatten().fieldErrors });
  }
  const data = parsed.data as Profile;
  try {
    // If ID provided, update existing; otherwise create new
    if (data.id !== undefined) {
      const updated = profileRepository.update(data.id, data);
      return updated;
    }
    // Create new profile
    const created = profileRepository.create({
      name: data.name,
      email: data.email,
      phone: data.phone,
      location: data.location,
      linkedin_url: data.linkedin_url,
      github_url: data.github_url,
      portfolio_url: data.portfolio_url,
      base_resume: data.base_resume,
      base_cover_letter: data.base_cover_letter,
      preferences: data.preferences,
      skills: data.skills,
      experience: data.experience,
      education: data.education,
    });
    return { success: true, profile: created };
  } catch (error) {
    return reply.status(400).send({ error: (error as Error).message });
  }
});

fastify.post('/profile/import', async (request, reply) => {
  const { resumeText } = request.body as { resumeText?: string };
  if (!resumeText) {
    return reply.status(400).send({ error: 'resumeText is required' });
  }

  try {
    const { extractProfileFromResume } = await import('../ai/profile-extractor');
    const provider = createAIProvider();
    const extractedProfile = await extractProfileFromResume(provider, resumeText);

    // Check if we have an existing profile to update
    const existingProfile = profileRepository.findFirst();
    if (existingProfile && existingProfile.id !== undefined) {
      const updated = profileRepository.update(existingProfile.id, extractedProfile);
      return { success: true, profile: updated, action: 'updated' };
    }

    // Create new profile
    const created = profileRepository.create(extractedProfile);
    return { success: true, profile: created, action: 'created' };
  } catch (error) {
    return reply.status(500).send({ error: (error as Error).message });
  }
});

fastify.delete('/profile/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  try {
    const numId = parseInt(id, 10);
    if (isNaN(numId)) {
      return reply.status(400).send({ error: 'Invalid profile ID' });
    }
    const deleted = profileRepository.delete(numId);
    return { success: deleted };
  } catch (error) {
    return reply.status(400).send({ error: (error as Error).message });
  }
});

// --- Config Routes ---
fastify.get('/config', async () => {
  const config = configRepository.loadAppConfig();
  // Don't return API keys in config response
  if (config.ai) {
    config.ai.apiKey = undefined;
  }
  return config;
});

fastify.post('/config', async (request) => {
  const data = request.body as AppConfig;

  // Store API keys securely in keychain instead of config
  if (data.ai.apiKey) {
    const provider = data.ai.provider;
    if (provider === 'openai' || provider === 'anthropic' || provider === 'google') {
      await credentialStore.setApiKey(provider, data.ai.apiKey);
      // Remove from config - we store it securely
      data.ai.apiKey = undefined;
    }
  }

  configRepository.saveAppConfig(data);
  return { success: true };
});

// Secure credential management endpoints
fastify.post('/credentials/store', async (request, reply) => {
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

fastify.post('/credentials/delete', async (request, reply) => {
  const { provider } = request.body as { provider: 'openai' | 'anthropic' | 'google' };

  if (!provider) {
    return reply.status(400).send({ success: false, error: 'Provider required' });
  }

  const success = await credentialStore.deleteApiKey(provider);
  return { success };
});

fastify.get('/credentials/status', async () => {
  const keys = await credentialStore.getAllApiKeys();
  return {
    openai: !!keys.openai,
    anthropic: !!keys.anthropic,
    google: !!keys.google,
  };
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

// --- AI Model Listing ---
fastify.get('/ai/models', async (request, reply) => {
  const config = configRepository.loadAppConfig();

  // Only supported for local providers
  if (config.ai.provider !== 'ollama' && config.ai.provider !== 'lmstudio') {
    return reply.status(400).send({
      success: false,
      error: 'Model listing only supported for Ollama and LM Studio',
    });
  }

  try {
    const baseUrl = config.ai.baseUrl ||
      (config.ai.provider === 'ollama' ? 'http://localhost:11434' : 'http://localhost:1234');

    if (config.ai.provider === 'ollama') {
      // Ollama native API
      const response = await fetch(`${baseUrl}/api/tags`);
      if (!response.ok) {
        throw new Error(`Ollama returned ${response.status}`);
      }
      const data = await response.json() as { models?: Array<{ name: string; size?: number; modified_at?: string }> };
      const models = (data.models || [])
        .map((m) => m.name)
        .filter(Boolean)
        .sort();
      return { success: true, models, provider: 'ollama' };
    } else {
      // LM Studio uses OpenAI-compatible /v1/models
      const lmBaseUrl = baseUrl.replace(/\/$/, '') + '/v1';
      const response = await fetch(`${lmBaseUrl}/models`);
      if (!response.ok) {
        throw new Error(`LM Studio returned ${response.status}`);
      }
      const data = await response.json() as { data?: Array<{ id: string }> };
      const models = (data.data || [])
        .map((m) => m.id)
        .filter(Boolean)
        .sort();
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

// --- Application Routes ---
interface ApplicationQueryParams {
  status?: ApplicationStatus;
  company?: string;
}

fastify.get('/applications', async (request) => {
  const { status, company } = request.query as ApplicationQueryParams;
  return applicationRepository.findAll({ status, company });
});

fastify.post('/applications/cleanup', async (request) => {
  const { hours } = request.body as { hours?: number };
  const staleHours = hours || 24;
  const count = applicationRepository.markStaleAsFailed(staleHours);
  return { success: true, cleaned: count };
});

fastify.delete<{ Params: { id: string } }>('/applications/:id', async (request, reply) => {
  const id = parseInt(request.params.id, 10);
  if (isNaN(id)) {
    return reply.status(400).send({ success: false, error: 'Invalid application ID' });
  }

  const deleted = applicationRepository.delete(id);
  if (!deleted) {
    return reply.status(404).send({ success: false, error: 'Application not found' });
  }

  return { success: true };
});

// --- Extension Routes ---
fastify.get('/extension/status', async () => {
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

fastify.post('/applications/apply', async (request, reply) => {
  const { url, autoSubmit } = request.body as { url: string; autoSubmit?: boolean };

  const profile = profileRepository.findFirst();
  if (!profile) {
    return reply.status(400).send({
      success: false,
      error: 'No profile found. Please run "autoply init" first.',
    });
  }

  try {
    const result = await applicationOrchestrator.applyToJob(url, {
      autoMode: autoSubmit,
    });
    return result;
  } catch (error) {
    return reply.status(500).send({ success: false, error: (error as Error).message });
  }
});

// --- Queue/Bulk Routes ---
fastify.get('/queue', async () => {
  const queue = applicationQueue;
  return {
    stats: queue.getStats(),
    items: queue.getAll(),
    hasPersisted: queue.hasPersisted(),
    persistedInfo: queue.getPersistedInfo(),
  };
});

const QueueAddSchema = z.object({
  urls: z.array(z.string().url()).min(1, 'urls must be a non-empty array'),
});

fastify.post('/queue/add', async (request, reply) => {
  const parsed = QueueAddSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: parsed.error.flatten().fieldErrors });
  }
  const { urls } = parsed.data;

  // Load persisted queue if exists
  applicationQueue.load();

  const items = applicationQueue.addMany(urls);
  applicationQueue.persist();

  return {
    success: true,
    added: items.length,
    items,
    stats: applicationQueue.getStats(),
  };
});

fastify.post('/queue/clear', async () => {
  applicationQueue.clear();
  return { success: true };
});

const QueueProcessSchema = z.object({
  autoSubmit: z.boolean().optional().default(false),
  delaySeconds: z.number().min(0).optional().default(0),
});

// Returns immediately with a jobId; processing happens in the background.
fastify.post('/queue/process', async (request, reply) => {
  const parsed = QueueProcessSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return reply.status(400).send({ error: parsed.error.flatten().fieldErrors });
  }
  const { autoSubmit, delaySeconds } = parsed.data;

  const profile = profileRepository.findFirst();
  if (!profile) {
    return reply.status(400).send({
      success: false,
      error: 'No profile found. Please run "autoply init" first.',
    });
  }

  // Prevent starting a second concurrent run
  const alreadyRunning = [...runningQueueJobs.values()].some((j) => j.status === 'running');
  if (alreadyRunning) {
    return reply.status(409).send({ success: false, error: 'Queue is already processing' });
  }

  applicationQueue.load();

  const jobId = crypto.randomUUID();
  const job: QueueJob = { id: jobId, status: 'running', startedAt: new Date().toISOString() };
  runningQueueJobs.set(jobId, job);

  // Fire-and-forget — client polls /queue/jobs/:id
  (async () => {
    const results: unknown[] = [];
    try {
      while (applicationQueue.hasNext()) {
        const item = applicationQueue.getNext();
        if (!item) break;

        applicationQueue.updateStatus(item.id, 'processing');

        try {
          const result = await applicationOrchestrator.applyToJob(item.url, { autoMode: autoSubmit });
          applicationQueue.setResult(item.id, result.application);
          applicationQueue.updateStatus(item.id, result.success ? 'completed' : 'failed', result.error);
          results.push({ id: item.id, url: item.url, status: result.success ? 'completed' : 'failed', result });
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          applicationQueue.updateStatus(item.id, 'failed', msg);
          results.push({ id: item.id, url: item.url, status: 'failed', error: msg });
        }

        if (delaySeconds > 0 && applicationQueue.hasNext()) {
          await new Promise((r) => setTimeout(r, delaySeconds * 1000));
        }
      }
      job.status = 'done';
      job.processed = results.length;
      job.results = results;
    } catch (err) {
      job.status = 'error';
      job.error = err instanceof Error ? err.message : 'Unknown error';
    } finally {
      job.finishedAt = new Date().toISOString();
    }
  })();

  return reply.status(202).send({ success: true, jobId });
});

fastify.get('/queue/jobs/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  const job = runningQueueJobs.get(id);
  if (!job) return reply.status(404).send({ error: 'Job not found' });
  return job;
});

fastify.get('/queue/stats', async () => {
  return applicationQueue.getStats();
});

// --- Scraper & Action Routes ---
const PassiveProcessSchema = z.object({
  html: z.string().min(1).max(500_000, 'HTML payload too large (max 500 KB)'),
  url: z.string().url(),
  platform: z.enum([
    'greenhouse', 'linkedin', 'lever', 'jobvite', 'smartrecruiters',
    'pinpoint', 'teamtailor', 'workday', 'ashby', 'bamboohr', 'workable', 'generic',
  ]),
  detectedFields: z.array(z.object({
    key: z.string(),
    type: z.string(),
    label: z.string(),
  })).optional(),
});

fastify.post('/jobs/passive-process', async (request, reply) => {
  const parsed = PassiveProcessSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: parsed.error.flatten().fieldErrors });
  }
  const { html, url, platform, detectedFields } = parsed.data;
  try {
    const result = await applicationOrchestrator.processJobPassively(
      html,
      url,
      platform as Platform,
      {},
      detectedFields
    );
    return result;
  } catch (error) {
    return reply.status(500).send({ error: (error as Error).message });
  }
});

fastify.post('/jobs/scrape', async (request, reply) => {
  const { url } = request.body as { url: string };
  try {
    const result = await applicationOrchestrator.applyToJob(url, { dryRun: true });
    return result;
  } catch (error) {
    return reply.status(500).send({ error: (error as Error).message });
  }
});

// --- Profile Field Mapping (lightweight, no AI) ---
fastify.post('/profile/map-fields', async (request, reply) => {
  const { fields } = request.body as {
    fields: Array<{ key: string; type: string; label: string }>;
  };

  if (!Array.isArray(fields) || fields.length === 0) {
    return reply.status(400).send({ error: 'fields must be a non-empty array' });
  }

  const profile = profileRepository.findFirst();
  if (!profile) {
    return reply.status(400).send({ error: 'No profile found' });
  }

  const { getDeterministicFieldValue } = await import('../core/form-filler');

  const profileData: Record<string, string> = {
    firstName: profile.name.split(' ')[0] || '',
    lastName: profile.name.split(' ').slice(1).join(' ') || '',
    fullName: profile.name,
    email: profile.email,
    phone: profile.phone || '',
    location: profile.location || '',
    linkedin: profile.linkedin_url || '',
    github: profile.github_url || '',
    portfolio: profile.portfolio_url || '',
  };

  const fillPlan: Record<string, string> = {};

  for (const field of fields) {
    const fieldKey = field.key || field.label;
    const normalized = fieldKey.toLowerCase().replace(/[^a-z0-9]/g, '');

    // Direct profile key match
    for (const [profileKey, profileValue] of Object.entries(profileData)) {
      const normalizedProfileKey = profileKey.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (
        normalized.includes(normalizedProfileKey) ||
        normalizedProfileKey.includes(normalized) ||
        normalized === normalizedProfileKey
      ) {
        if (profileValue) {
          fillPlan[fieldKey] = profileValue;
          break;
        }
      }
    }

    // Fallback: deterministic field matching
    if (!fillPlan[fieldKey]) {
      const value = getDeterministicFieldValue(profile, {
        label: field.label,
        name: field.key,
        type: field.type as 'text' | 'select' | 'checkbox' | 'radio',
      });
      if (value) fillPlan[fieldKey] = value;
    }
  }

  return { fillPlan };
});

// --- Document Generation Routes ---

fastify.post('/documents/generate', async (request, reply) => {
  const { url, type } = request.body as { url: string; type: 'resume' | 'cover-letter' | 'both' };

  if (!url) {
    return reply.status(400).send({ error: 'URL is required' });
  }

  const ip = request.ip || 'unknown';
  if (!checkDocGenRateLimit(ip)) {
    return reply
      .status(429)
      .send({ error: 'Too many document generation requests. Try again in a minute.' });
  }

  const profile = profileRepository.findFirst();
  if (!profile) {
    return reply.status(400).send({
      error: 'No profile found. Please set up your profile first.',
    });
  }

  try {
    cleanupTempDocs();
    if (!existsSync(TEMP_DOC_DIR)) {
      mkdirSync(TEMP_DOC_DIR, { recursive: true });
    }
    const result = await applicationOrchestrator.generateDocuments(
      url,
      TEMP_DOC_DIR,
      type ?? 'both'
    );
    return reply.send({
      success: true,
      resumePath: result.resumePath,
      coverLetterPath: result.coverLetterPath,
    });
  } catch (error) {
    return reply.status(500).send({ error: (error as Error).message });
  }
});

fastify.get('/documents/download/:filename', async (request, reply) => {
  const { filename } = request.params as { filename: string };
  const filePath = join(TEMP_DOC_DIR, filename);

  try {
    if (!existsSync(filePath)) {
      return reply.status(404).send({ error: 'File not found' });
    }

    const fs = await import('fs');
    const stream = fs.createReadStream(filePath);
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    return reply.send(stream);
  } catch (error) {
    return reply.status(500).send({ error: (error as Error).message });
  }
});

// --- Scraping Browser Routes ---
// A lightweight local alternative to Bright Data's Scraping Browser.
// Launches stealth-configured browser instances and exposes them via
// Playwright's WebSocket protocol so callers can connect with:
//   const browser = await playwright.chromium.connect(wsEndpoint)
{
  const { scrapingBrowserPool, STEALTH_INIT_SCRIPT, USER_AGENTS } = await import(
    '../scraping-browser/index'
  );

  fastify.get('/scraping-browser/sessions', async () => {
    return {
      sessions: scrapingBrowserPool.listSessions(),
      count: scrapingBrowserPool.count,
    };
  });

  fastify.post('/scraping-browser/sessions', async (request, reply) => {
    const { ttlMs, headless } = (request.body as {
      ttlMs?: number;
      headless?: boolean;
    }) ?? {};

    try {
      const session = await scrapingBrowserPool.createSession({ ttlMs, headless });
      return { success: true, ...session };
    } catch (error) {
      return reply.status(503).send({ success: false, error: (error as Error).message });
    }
  });

  fastify.delete('/scraping-browser/sessions/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const destroyed = await scrapingBrowserPool.destroySession(id);
    if (!destroyed) {
      return reply.status(404).send({ success: false, error: 'Session not found' });
    }
    return { success: true };
  });

  fastify.delete('/scraping-browser/sessions', async () => {
    await scrapingBrowserPool.destroyAll();
    return { success: true };
  });

  // Returns the JS stealth init-script and a random user-agent so callers can
  // apply them to every new BrowserContext:
  //   await context.addInitScript(initScript)
  //   await context.setExtraHTTPHeaders({ 'User-Agent': userAgent })
  fastify.get('/scraping-browser/stealth', async () => {
    const userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    return { initScript: STEALTH_INIT_SCRIPT, userAgent };
  });
}

// --- Start Server ---
const start = async () => {
  try {
    const parsedPort = Number.parseInt(process.env.PORT ?? '', 10);
    const port = Number.isFinite(parsedPort) ? parsedPort : DEFAULT_API_PORT;
    const host = process.env.HOST || '127.0.0.1';
    await fastify.listen({ port, host });
    const displayHost = host === '0.0.0.0' ? 'localhost' : host;
    console.log(`Autoply API server running at http://${displayHost}:${port}`);
    // Auto-cleanup stale pending applications on startup
    const cleaned = applicationRepository.markStaleAsFailed(24);
    if (cleaned > 0) {
      console.log(`Auto-cleaned ${cleaned} stale application(s)`);
    }
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
