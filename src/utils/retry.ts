import pRetry, { type Options as PRetryOptions } from 'p-retry';

import { logger } from './logger';

// ============================================================================
// Retry with Exponential Backoff and Jitter
// ============================================================================

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Initial delay in milliseconds (default: 1000) */
  minTimeout?: number;
  /** Maximum delay in milliseconds (default: 10000) */
  maxTimeout?: number;
  /** Exponential backoff factor (default: 2) */
  factor?: number;
  /** Enable random jitter (default: true) */
  jitter?: boolean;
  /** Custom error messages that should trigger a retry */
  retryableErrors?: string[];
  /** Custom error messages that should NOT trigger a retry */
  nonRetryableErrors?: string[];
  /** Callback invoked before each retry */
  onRetry?: (error: Error, attemptNumber: number) => void;
  /** Operation name for logging */
  operationName?: string;
}

const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  minTimeout: 1000,
  maxTimeout: 10000,
  factor: 2,
  jitter: true,
  retryableErrors: [],
  nonRetryableErrors: [],
  onRetry: () => {},
  operationName: 'Operation',
};

/**
 * Check if an error should be retried based on configuration
 */
function shouldRetry(error: Error, options: Required<RetryOptions>): boolean {
  // Check non-retryable patterns first
  const errorMessage = error.message.toLowerCase();

  if (options.nonRetryableErrors.some((pattern) => errorMessage.includes(pattern.toLowerCase()))) {
    return false;
  }

  // Check retryable patterns (if specified, only these trigger retry)
  if (options.retryableErrors.length > 0) {
    return options.retryableErrors.some((pattern) => errorMessage.includes(pattern.toLowerCase()));
  }

  // Default: retry on most errors except known non-retryable ones
  const nonRetryablePatterns = [
    'invalid api key',
    'authentication',
    'authorization',
    'permission',
    'not found',
    '404',
    '401',
    '403',
    'invalid request',
    'bad request',
  ];

  return !nonRetryablePatterns.some((pattern) => errorMessage.includes(pattern));
}

/**
 * Execute a function with exponential backoff retry logic
 *
 * @example
 * ```typescript
 * const result = await withRetry(
 *   () => aiProvider.generateText(prompt),
 *   {
 *     maxRetries: 3,
 *     operationName: 'AI text generation',
 *     onRetry: (error, attempt) => {
 *       logger.warn(`Retry ${attempt}/3: ${error.message}`);
 *     }
 *   }
 * );
 * ```
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const opts: Required<RetryOptions> = { ...DEFAULT_RETRY_OPTIONS, ...options };

  const pRetryOptions: PRetryOptions = {
    retries: opts.maxRetries,
    minTimeout: opts.minTimeout,
    maxTimeout: opts.maxTimeout,
    factor: opts.factor,
    randomize: opts.jitter, // Adds jitter to prevent thundering herd
    onFailedAttempt: ({ error, attemptNumber }) => {
      if (shouldRetry(error, opts)) {
        opts.onRetry(error, attemptNumber);
        logger.debug(`${opts.operationName} attempt ${attemptNumber} failed: ${error.message}`, {
          attempt: attemptNumber,
          retriesLeft: opts.maxRetries - attemptNumber + 1,
        });
      }
    },
  };

  return pRetry(fn, pRetryOptions);
}

/**
 * Retry specifically for rate limit errors (HTTP 429)
 * Uses longer timeouts and more retries
 */
export async function withRateLimitRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  return withRetry(fn, {
    maxRetries: 5,
    minTimeout: 2000,
    maxTimeout: 30000,
    factor: 2,
    operationName: options.operationName ?? 'Rate-limited operation',
    ...options,
  });
}

/**
 * Circuit breaker state
 */
interface CircuitBreakerState {
  failures: number;
  lastFailureTime: number | null;
  state: 'closed' | 'open' | 'half-open';
}

/**
 * Simple circuit breaker to prevent cascading failures
 */
export class CircuitBreaker {
  private state: CircuitBreakerState = {
    failures: 0,
    lastFailureTime: null,
    state: 'closed',
  };

  private readonly failureThreshold: number;
  private readonly resetTimeout: number;

  constructor(options: { failureThreshold?: number; resetTimeout?: number } = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeout = options.resetTimeout ?? 60000; // 1 minute
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state.state === 'open') {
      if (Date.now() - (this.state.lastFailureTime ?? 0) > this.resetTimeout) {
        this.state.state = 'half-open';
      } else {
        throw new Error('Circuit breaker is open - service unavailable');
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.state.failures = 0;
    this.state.state = 'closed';
  }

  private onFailure(): void {
    this.state.failures++;
    this.state.lastFailureTime = Date.now();

    if (this.state.failures >= this.failureThreshold) {
      this.state.state = 'open';
      logger.warn('Circuit breaker opened', {
        failures: this.state.failures,
        threshold: this.failureThreshold,
      });
    }
  }

  getState(): CircuitBreakerState {
    return { ...this.state };
  }

  reset(): void {
    this.state = {
      failures: 0,
      lastFailureTime: null,
      state: 'closed',
    };
  }
}

// Shared circuit breakers for different services
export const circuitBreakers = {
  ai: new CircuitBreaker({ failureThreshold: 5, resetTimeout: 60000 }),
  scraper: new CircuitBreaker({ failureThreshold: 3, resetTimeout: 30000 }),
};
