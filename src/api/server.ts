import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { applicationRepository } from '../db/repositories/application';

// ── Route modules ─────────────────────────────────────────────────────────────
import { registerHealthRoutes } from './routes/health';
import { registerProfileRoutes } from './routes/profile';
import { registerConfigRoutes } from './routes/config';
import { registerAIRoutes } from './routes/ai';
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

// ── Register domain routes ────────────────────────────────────────────────────
registerHealthRoutes(fastify);
registerProfileRoutes(fastify);
registerConfigRoutes(fastify);
registerAIRoutes(fastify);
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

    // Start periodic cleanup of stale temp documents (every 15 min)
    startTempDocCleanup();

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
