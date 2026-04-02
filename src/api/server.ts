import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
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
import type { Platform, Profile, AppConfig, ApplicationStatus, AIConfig } from '../types';

const DEFAULT_API_PORT = 8088;
const TEMP_DOC_DIR = join(tmpdir(), 'autoply-extension');
const TEMP_FILE_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

// Simple in-memory rate limiter for document generation
const docGenRateLimit = new Map<string, { count: number; resetAt: number }>();
const DOC_GEN_LIMIT = 10; // max requests per window
const DOC_GEN_WINDOW_MS = 60 * 1000; // 1 minute

function checkDocGenRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = docGenRateLimit.get(ip);
  if (!entry || now > entry.resetAt) {
    docGenRateLimit.set(ip, { count: 1, resetAt: now + DOC_GEN_WINDOW_MS });
    return true;
  }
  if (entry.count >= DOC_GEN_LIMIT) return false;
  entry.count++;
  return true;
}

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
  origin: (_origin, callback) => {
    callback(null, true);
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

fastify.post('/profile', async (request, reply) => {
  const data = request.body as Profile;
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

fastify.post('/queue/add', async (request, reply) => {
  const { urls } = request.body as { urls: string[] };

  if (!Array.isArray(urls) || urls.length === 0) {
    return reply.status(400).send({ error: 'urls must be a non-empty array' });
  }

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

fastify.post('/queue/process', async (request, reply) => {
  const { autoSubmit = false, delaySeconds = 0 } = request.body as {
    autoSubmit?: boolean;
    delaySeconds?: number;
  };

  const profile = profileRepository.findFirst();
  if (!profile) {
    return reply.status(400).send({
      success: false,
      error: 'No profile found. Please run "autoply init" first.',
    });
  }

  // Load persisted queue if exists
  applicationQueue.load();

  const results: Array<{
    id: string;
    url: string;
    status: string;
    result?: unknown;
    error?: string;
  }> = [];

  while (applicationQueue.hasNext()) {
    const item = applicationQueue.getNext();
    if (!item) break;

    try {
      applicationQueue.updateStatus(item.id, 'processing');

      const result = await applicationOrchestrator.applyToJob(item.url, {
        autoMode: autoSubmit,
      });

      applicationQueue.setResult(item.id, result.application);
      applicationQueue.updateStatus(item.id, result.success ? 'completed' : 'failed', result.error);

      results.push({
        id: item.id,
        url: item.url,
        status: result.success ? 'completed' : 'failed',
        result,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      applicationQueue.updateStatus(item.id, 'failed', errorMessage);
      results.push({
        id: item.id,
        url: item.url,
        status: 'failed',
        error: errorMessage,
      });
    }

    // Apply delay if configured
    if (delaySeconds > 0 && applicationQueue.hasNext()) {
      await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));
    }
  }

  return {
    success: true,
    processed: results.length,
    results,
    stats: applicationQueue.getStats(),
  };
});

fastify.get('/queue/stats', async () => {
  return applicationQueue.getStats();
});

// --- Scraper & Action Routes ---
fastify.post('/jobs/passive-process', async (request, reply) => {
  const { html, url, platform, detectedFields } = request.body as {
    html: string;
    url: string;
    platform: Platform;
    detectedFields?: Array<{ key: string; type: string; label: string }>;
  };
  try {
    const result = await applicationOrchestrator.processJobPassively(
      html,
      url,
      platform,
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

// --- Start Server ---
const start = async () => {
  try {
    const parsedPort = Number.parseInt(process.env.PORT ?? '', 10);
    const port = Number.isFinite(parsedPort) ? parsedPort : DEFAULT_API_PORT;
    const host = process.env.HOST || '0.0.0.0';
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
