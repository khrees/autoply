import type { FastifyInstance } from 'fastify';
import { join, resolve, basename } from 'path';
import { tmpdir } from 'os';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';
import { applicationOrchestrator } from '../../core/application';
import { profileRepository } from '../../db/repositories/profile';
import { checkDocGenRateLimit } from '../../utils/rate-limiter';

const TEMP_DOC_DIR = join(tmpdir(), 'autoply-extension');
const TEMP_FILE_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

/**
 * Periodic cleanup of stale temp documents — runs every 15 minutes.
 * Replaces the old per-request cleanupTempDocs() call.
 */
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

export function startTempDocCleanup(intervalMs: number = 15 * 60 * 1000): void {
  if (cleanupInterval) return; // already started
  cleanupInterval = setInterval(() => {
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
  }, intervalMs);
}

export function stopTempDocCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

/**
 * Resolve a client-supplied filename to an absolute path inside TEMP_DOC_DIR.
 * Returns null if the resolved path escapes the directory (traversal attempt).
 */
function safeDocPath(filename: string): string | null {
  // basename strips any ../ or subdirectory components from the input.
  const safe = join(TEMP_DOC_DIR, basename(filename));
  // Double-check with resolve in case of edge cases.
  const resolved = resolve(safe);
  if (!resolved.startsWith(TEMP_DOC_DIR + '/') && resolved !== TEMP_DOC_DIR) {
    return null;
  }
  return resolved;
}

export function registerDocumentRoutes(app: FastifyInstance): void {
  app.post('/documents/generate', async (request, reply) => {
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
      // Ensure temp dir exists (cleanup runs on interval, not per-request)
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
        resumeContent: result.resumeContent,
        coverLetterContent: result.coverLetterContent,
      });
    } catch (error) {
      return reply.status(500).send({ error: (error as Error).message });
    }
  });

  app.get('/documents/download/:filename', async (request, reply) => {
    const { filename } = request.params as { filename: string };
    const filePath = safeDocPath(filename);

    if (!filePath) {
      return reply.status(400).send({ error: 'Invalid filename' });
    }

    try {
      if (!existsSync(filePath)) {
        return reply.status(404).send({ error: 'File not found' });
      }
      const fs = await import('fs');
      const stream = fs.createReadStream(filePath);
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `attachment; filename="${basename(filename)}"`);
      return reply.send(stream);
    } catch (error) {
      return reply.status(500).send({ error: (error as Error).message });
    }
  });

  app.get('/documents/preview/:filename', async (request, reply) => {
    const { filename } = request.params as { filename: string };
    const filePath = safeDocPath(filename);

    if (!filePath) {
      return reply.status(400).send({ error: 'Invalid filename' });
    }

    try {
      if (!existsSync(filePath)) {
        return reply.status(404).send({ error: 'File not found' });
      }
      const fs = await import('fs');
      const stream = fs.createReadStream(filePath);
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `inline; filename="${basename(filename)}"`);
      return reply.send(stream);
    } catch (error) {
      return reply.status(500).send({ error: (error as Error).message });
    }
  });
}
