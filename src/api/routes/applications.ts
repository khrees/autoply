import type { FastifyInstance } from 'fastify';
import { applicationRepository } from '../../db/repositories/application';
import { profileRepository } from '../../db/repositories/profile';
import { applicationOrchestrator } from '../../core/application';
import type { ApplicationStatus } from '../../types';

export function registerApplicationRoutes(app: FastifyInstance): void {
  interface ApplicationQueryParams {
    status?: ApplicationStatus;
    company?: string;
  }

  app.get('/applications', async (request) => {
    const { status, company } = request.query as ApplicationQueryParams;
    return applicationRepository.findAll({ status, company });
  });

  app.post('/applications/cleanup', async (request) => {
    const { hours } = request.body as { hours?: number };
    const staleHours = hours || 24;
    const count = applicationRepository.markStaleAsFailed(staleHours);
    return { success: true, cleaned: count };
  });

  app.delete<{ Params: { id: string } }>('/applications/:id', async (request, reply) => {
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

  app.post('/applications/apply', async (request, reply) => {
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
}
