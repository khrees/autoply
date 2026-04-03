import { RateLimiterMemory, RateLimiterQueue } from 'rate-limiter-flexible';
import { logger } from './logger';

// ============================================================================
// Rate Limiting with Token Bucket Algorithm
// ============================================================================

/**
 * Rate limiter configuration
 */
export interface RateLimiterConfig {
  /** Number of allowed requests per window */
  points: number;
  /** Time window in seconds */
  duration: number;
  /** Optional queue for handling burst traffic */
  queue?: boolean;
}

/**
 * Create a rate limiter instance
 */
export function createRateLimiter(
  _key: string,
  config: RateLimiterConfig
): RateLimiterMemory | RateLimiterQueue {
  const options = {
    points: config.points,
    duration: config.duration,
  };

  if (config.queue) {
    return new RateLimiterQueue(
      new RateLimiterMemory({
        ...options,
        execEvenly: true, // Distribute requests evenly over time
      }),
      {
        maxQueueSize: config.points * 2,
      }
    );
  }

  return new RateLimiterMemory(options);
}

// ============================================================================
// Pre-configured Rate Limiters
// ============================================================================

// AI Provider rate limiter - prevents API rate limit errors
export const aiRateLimiter = createRateLimiter('ai-provider', {
  points: 20, // 20 requests
  duration: 60, // per minute
  queue: true,
});

// Scraper rate limiter - prevents IP bans from job sites
export const scraperRateLimiter = createRateLimiter('scraper', {
  points: 10, // 10 requests
  duration: 60, // per minute
  queue: true,
});

// Document generation rate limiter
export const docGenRateLimiter = createRateLimiter('doc-generation', {
  points: 5, // 5 documents
  duration: 60, // per minute
  queue: false,
});

// Application submission rate limiter - respectful submission pacing
export const submissionRateLimiter = createRateLimiter('submission', {
  points: 3, // 3 submissions
  duration: 60, // per minute
  queue: true,
});

// ============================================================================
// Rate Limiter Helper Functions
// ============================================================================

/**
 * Consume a rate limit token, waiting if necessary
 * @throws {RateLimiterRes} When rate limit exceeded and queue is full
 */
export async function consumeRateLimit(
  limiter: RateLimiterMemory | RateLimiterQueue,
  key: string = 'default',
  points: number = 1
): Promise<void> {
  try {
    if (limiter instanceof RateLimiterQueue) {
      await limiter.removeTokens(points);
    } else {
      await limiter.consume(key, points);
    }
  } catch (error) {
    const rateLimitError = error as { msBeforeNext?: number; remainingPoints?: number };
    const waitTime = rateLimitError.msBeforeNext ?? 0;

    logger.warn('Rate limit exceeded', {
      key,
      waitTime: `${waitTime}ms`,
      remainingPoints: rateLimitError.remainingPoints ?? 0,
    });

    throw error;
  }
}

/**
 * Execute a function with rate limiting
 * Waits in queue if rate limit is exceeded
 */
export async function withRateLimit<T>(
  limiter: RateLimiterMemory | RateLimiterQueue,
  fn: () => Promise<T>,
  key: string = 'default',
  points: number = 1
): Promise<T> {
  await consumeRateLimit(limiter, key, points);
  return fn();
}

/**
 * Get current rate limit status (only available for RateLimiterMemory)
 */
export async function getRateLimitStatus(
  limiter: RateLimiterMemory,
  key: string = 'default'
): Promise<{
  remainingPoints: number;
  msBeforeNext: number;
  consumedPoints: number;
}> {
  const status = await limiter.get(key);
  return {
    remainingPoints: status?.remainingPoints ?? 0,
    msBeforeNext: status?.msBeforeNext ?? 0,
    consumedPoints: status?.consumedPoints ?? 0,
  };
}

// ============================================================================
// Backpressure Handler for Queue Processing
// ============================================================================

export interface BackpressureConfig {
  /** Maximum concurrent operations */
  maxConcurrent: number;
  /** Delay between operations in milliseconds */
  delayMs: number;
  /** Pause when queue depth exceeds this threshold */
  pauseThreshold: number;
}

export class BackpressureController {
  private activeOperations = 0;
  private paused = false;
  private readonly config: BackpressureConfig;

  constructor(config: Partial<BackpressureConfig> = {}) {
    this.config = {
      maxConcurrent: config.maxConcurrent ?? 3,
      delayMs: config.delayMs ?? 1000,
      pauseThreshold: config.pauseThreshold ?? 100,
    };
  }

  /**
   * Check if we should pause due to backpressure
   */
  shouldPause(queueDepth: number): boolean {
    return (
      this.paused ||
      this.activeOperations >= this.config.maxConcurrent ||
      queueDepth >= this.config.pauseThreshold
    );
  }

  /**
   * Acquire a slot for processing (waits if necessary)
   */
  async acquire(): Promise<() => void> {
    while (this.shouldPause(0)) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    this.activeOperations++;
    return () => {
      this.activeOperations--;
    };
  }

  /**
   * Get current backpressure status
   */
  getStatus(): {
    activeOperations: number;
    maxConcurrent: number;
    paused: boolean;
    utilization: number;
  } {
    return {
      activeOperations: this.activeOperations,
      maxConcurrent: this.config.maxConcurrent,
      paused: this.paused,
      utilization: this.activeOperations / this.config.maxConcurrent,
    };
  }

  /**
   * Manually pause or resume processing
   */
  setPaused(paused: boolean): void {
    this.paused = paused;
  }
}

// ============================================================================
// Global Rate Limit State for Extension API
// ============================================================================

// Simple in-memory rate limiter for document generation (legacy, kept for API compatibility)
const docGenRateLimit = new Map<string, { count: number; resetAt: number }>();
const DOC_GEN_LIMIT = 10;
const DOC_GEN_WINDOW_MS = 60 * 1000;

export function checkDocGenRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = docGenRateLimit.get(ip);

  if (!entry || now > entry.resetAt) {
    docGenRateLimit.set(ip, { count: 1, resetAt: now + DOC_GEN_WINDOW_MS });
    return true;
  }

  if (entry.count >= DOC_GEN_LIMIT) {
    return false;
  }

  entry.count++;
  return true;
}

// Cleanup old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of docGenRateLimit.entries()) {
    if (now > entry.resetAt) {
      docGenRateLimit.delete(ip);
    }
  }
}, 60000);
