import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { applicationRepository } from '../db/repositories/application';
import { getOrCreateApiToken, isValidBearerToken, isValidTokenValue, isPublicPath } from './auth';
import { applicationQueue } from '../core/queue';

// ── Route modules ─────────────────────────────────────────────────────────────
import { registerHealthRoutes } from './routes/health';
import { registerProfileRoutes } from './routes/profile';
import { registerConfigRoutes } from './routes/config';
import { registerAIRoutes } from './routes/ai';
import { registerChatRoutes } from './routes/chat';
import { registerApplicationRoutes } from './routes/applications';
import { registerQueueRoutes } from './routes/queue';
import { registerExtensionRoutes } from './routes/extension';
import { registerJobRoutes } from './routes/jobs';
import { registerDocumentRoutes, startTempDocCleanup } from './routes/documents';
import { registerScrapingBrowserRoutes } from './routes/scraping-browser';

const DEFAULT_API_PORT = 8088;

const fastify = Fastify({
  logger: true,
  bodyLimit: 10 * 1024 * 1024, // 10MB
});

// ── Plugins ───────────────────────────────────────────────────────────────────
fastify.register(cors, {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
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

// ── Auth + CSRF guard ─────────────────────────────────────────────────────────
// Every route except /health requires `Authorization: Bearer <token>`.
// The token is generated on first run and stored at ~/.autoply/api-token
// (override with AUTOPLY_API_TOKEN). Mutating requests must use
// `Content-Type: application/json`, which forces a CORS preflight and
// prevents simple `text/plain` CSRF posts from background tabs.
const apiToken = getOrCreateApiToken();
fastify.addHook('onRequest', async (request, reply) => {
  if (isPublicPath(request.url)) return;

  const queryToken = (request.query as { token?: unknown } | undefined)?.token;
  const authorized =
    isValidBearerToken(request.headers.authorization, apiToken) ||
    (typeof queryToken === 'string' && isValidTokenValue(queryToken, apiToken));
  if (!authorized) {
    return reply.status(401).send({ error: 'Unauthorized: valid Bearer token required' });
  }

  if (request.method === 'POST' || request.method === 'PUT' || request.method === 'PATCH') {
    const contentType = String(request.headers['content-type'] || '');
    // Allow multipart form uploads (documents) which carry their own boundary;
    // otherwise require JSON to force preflight.
    if (!contentType.includes('application/json') && !contentType.includes('multipart/form-data')) {
      return reply
        .status(415)
        .send({ error: 'Unsupported Media Type: Content-Type must be application/json' });
    }
  }
});

// ── Register domain routes ────────────────────────────────────────────────────
registerHealthRoutes(fastify);
registerProfileRoutes(fastify);
registerConfigRoutes(fastify);
registerAIRoutes(fastify);
registerChatRoutes(fastify);
registerApplicationRoutes(fastify);
registerQueueRoutes(fastify);
registerExtensionRoutes(fastify);
registerJobRoutes(fastify);
registerDocumentRoutes(fastify);
registerScrapingBrowserRoutes(fastify);

// ── Start server ──────────────────────────────────────────────────────────────
const start = async () => {
  try {
    const parsedPort = Number.parseInt(process.env.PORT ?? '', 10);
    const port = Number.isFinite(parsedPort) ? parsedPort : DEFAULT_API_PORT;
    const host = process.env.HOST || '127.0.0.1';
    await fastify.listen({ port, host });
    const displayHost = host === '0.0.0.0' ? 'localhost' : host;
    console.log(`Autoply API server running at http://${displayHost}:${port}`);
    if (host === '0.0.0.0') {
      console.log('Remote binding detected: API auth is enforced via AUTOPLY_API_TOKEN.');
    }

    // Start periodic cleanup of stale temp documents (every 15 min)
    startTempDocCleanup();

    // Auto-cleanup stale pending applications on startup
    const cleaned = applicationRepository.markStaleAsFailed(24);
    if (cleaned > 0) {
      console.log(`Auto-cleaned ${cleaned} stale application(s)`);
    }

    // Reconcile queue.json against SQLite so a crash between "queue says
    // completed" and "SQLite write" doesn't leave them permanently out of sync.
    if (applicationQueue.hasPersisted()) {
      applicationQueue.load();
      applicationQueue.reconcileWithApplications((url) => {
        const rows = applicationRepository.findByUrl(url);
        return rows[0]; // newest row for this URL
      });
      console.log('Queue reconciled with application records.');
    }
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
