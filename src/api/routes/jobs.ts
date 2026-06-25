import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { applicationOrchestrator } from '../../core/application';
import type { Platform } from '../../types';

const PassiveProcessSchema = z.object({
  html: z.string().min(1).max(500_000, 'HTML payload too large (max 500 KB)'),
  url: z.string().url(),
  platform: z.enum([
    'greenhouse', 'linkedin', 'lever', 'jobvite', 'smartrecruiters',
    'pinpoint', 'teamtailor', 'workday', 'ashby', 'bamboohr',
    'workable', 'generic',
  ]),
  detectedFields: z
    .array(z.object({ key: z.string(), type: z.string(), label: z.string() }))
    .optional(),
});

export function registerJobRoutes(app: FastifyInstance): void {
  app.post('/jobs/passive-process', async (request, reply) => {
    const parsed = PassiveProcessSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten().fieldErrors });
    }
    const { html, url, platform, detectedFields } = parsed.data;
    try {
      const result = await applicationOrchestrator.processJobPassively(
        html, url, platform as Platform, {}, detectedFields
      );
      return result;
    } catch (error) {
      return reply.status(500).send({ error: (error as Error).message });
    }
  });

  app.post('/jobs/scrape', async (request, reply) => {
    const { url } = request.body as { url: string };
    try {
      const result = await applicationOrchestrator.applyToJob(url, { dryRun: true });
      return result;
    } catch (error) {
      return reply.status(500).send({ error: (error as Error).message });
    }
  });
}
