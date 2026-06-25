import type { FastifyInstance } from 'fastify';

export function registerScrapingBrowserRoutes(app: FastifyInstance): void {
  // Lazy-import scraping-browser module only when these routes are hit
  const getPool = () =>
    import('../../scraping-browser/index').then((m) => ({
      pool: m.scrapingBrowserPool,
      STEALTH_INIT_SCRIPT: m.STEALTH_INIT_SCRIPT,
      USER_AGENTS: m.USER_AGENTS,
    }));

  app.get('/scraping-browser/sessions', async () => {
    const { pool } = await getPool();
    return { sessions: pool.listSessions(), count: pool.count };
  });

  app.post('/scraping-browser/sessions', async (request, reply) => {
    const { ttlMs, headless } =
      (request.body as { ttlMs?: number; headless?: boolean }) ?? {};
    try {
      const { pool } = await getPool();
      const session = await pool.createSession({ ttlMs, headless });
      return { success: true, ...session };
    } catch (error) {
      return reply.status(503).send({ success: false, error: (error as Error).message });
    }
  });

  app.delete('/scraping-browser/sessions/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { pool } = await getPool();
    const destroyed = await pool.destroySession(id);
    if (!destroyed) {
      return reply.status(404).send({ success: false, error: 'Session not found' });
    }
    return { success: true };
  });

  app.delete('/scraping-browser/sessions', async () => {
    const { pool } = await getPool();
    await pool.destroyAll();
    return { success: true };
  });

  app.get('/scraping-browser/stealth', async () => {
    const { USER_AGENTS, STEALTH_INIT_SCRIPT } = await getPool();
    const userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    return { initScript: STEALTH_INIT_SCRIPT, userAgent };
  });
}
