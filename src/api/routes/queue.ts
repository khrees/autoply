import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { applicationQueue } from '../../core/queue';
import { applicationOrchestrator } from '../../core/application';
import { profileRepository } from '../../db/repositories/profile';

// Background queue jobs — keyed by a random ID so clients can poll /queue/jobs/:id
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

export function registerQueueRoutes(app: FastifyInstance): void {
  app.get('/queue', async () => {
    return {
      stats: applicationQueue.getStats(),
      items: applicationQueue.getAll(),
      hasPersisted: applicationQueue.hasPersisted(),
      persistedInfo: applicationQueue.getPersistedInfo(),
    };
  });

  const QueueAddSchema = z.object({
    urls: z.array(z.string().url()).min(1, 'urls must be a non-empty array'),
  });

  app.post('/queue/add', async (request, reply) => {
    const parsed = QueueAddSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten().fieldErrors });
    }
    const { urls } = parsed.data;

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

  app.post('/queue/clear', async () => {
    applicationQueue.clear();
    return { success: true };
  });

  const QueueProcessSchema = z.object({
    autoSubmit: z.boolean().optional().default(false),
    delaySeconds: z.number().min(0).optional().default(0),
  });

  app.post('/queue/process', async (request, reply) => {
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

    const alreadyRunning = [...runningQueueJobs.values()].some((j) => j.status === 'running');
    if (alreadyRunning) {
      return reply.status(409).send({ success: false, error: 'Queue is already processing' });
    }

    applicationQueue.load();

    const jobId = crypto.randomUUID();
    const job: QueueJob = { id: jobId, status: 'running', startedAt: new Date().toISOString() };
    runningQueueJobs.set(jobId, job);

    (async () => {
      const results: unknown[] = [];
      try {
        while (applicationQueue.hasNext()) {
          const item = applicationQueue.getNext();
          if (!item) break;

          applicationQueue.updateStatus(item.id, 'processing');

          try {
            const result = await applicationOrchestrator.applyToJob(item.url, {
              autoMode: autoSubmit,
            });
            applicationQueue.setResult(item.id, result.application);
            applicationQueue.updateStatus(
              item.id,
              result.success ? 'completed' : 'failed',
              result.error
            );
            results.push({
              id: item.id,
              url: item.url,
              status: result.success ? 'completed' : 'failed',
              result,
            });
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

  app.get('/queue/jobs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = runningQueueJobs.get(id);
    if (!job) return reply.status(404).send({ error: 'Job not found' });
    return job;
  });

  app.get('/queue/stats', async () => {
    return applicationQueue.getStats();
  });
}
