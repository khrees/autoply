import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import pino, { type LogFn } from 'pino';
import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';

// ============================================================================
// Correlation ID context management
// ============================================================================

const correlationStorage = new AsyncLocalStorage<{ correlationId: string }>();

export function getCorrelationId(): string | undefined {
  return correlationStorage.getStore()?.correlationId;
}

export function withCorrelationId<T>(correlationId: string, fn: () => T): T {
  return correlationStorage.run({ correlationId }, fn);
}

export function generateCorrelationId(): string {
  return randomUUID().slice(0, 8);
}

// ============================================================================
// Pino structured logger
// ============================================================================

const baseLogger = pino({
  level: process.env.LOG_LEVEL || (process.env.DEBUG ? 'debug' : 'info'),
  transport:
    process.env.NODE_ENV === 'production'
      ? undefined
      : {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        },
  formatters: {
    level: (label) => ({ level: label.toUpperCase() }),
  },
});

export const pinoLogger = baseLogger;

export const loggerContext = {
  cli: baseLogger.child({ component: 'cli' }),
  api: baseLogger.child({ component: 'api' }),
  scraper: baseLogger.child({ component: 'scraper' }),
  ai: baseLogger.child({ component: 'ai' }),
  formFiller: baseLogger.child({ component: 'form-filler' }),
  queue: baseLogger.child({ component: 'queue' }),
};

// ============================================================================
// Verbose flag (for debug output)
// ============================================================================

let _verbose = false;

export function setVerbose(enabled: boolean) {
  _verbose = enabled;
}

export function isVerbose(): boolean {
  return _verbose || !!process.env.DEBUG;
}

// ============================================================================
// Unified logger — structured pino calls + chalk CLI helpers
// ============================================================================

function structuredLog(
  level: 'info' | 'warn' | 'error' | 'debug',
  message: string,
  data?: Record<string, unknown>,
  component: keyof typeof loggerContext = 'cli'
): void {
  const correlationId = getCorrelationId();
  const logData = { ...data, ...(correlationId && { correlationId }) };
  const logFn: LogFn = loggerContext[component][level].bind(loggerContext[component]);
  logFn(logData, message);
}

export const logger = {
  // ── Structured methods (support optional data + component) ──────────────
  // All output goes through pino — no manual console.log echoes,
  // which would cause double-printing when pino-pretty transport is active.

  info: (
    message: string,
    data?: Record<string, unknown>,
    component?: keyof typeof loggerContext
  ) => {
    structuredLog('info', message, data, component);
  },

  warn: (
    message: string,
    data?: Record<string, unknown>,
    component?: keyof typeof loggerContext
  ) => {
    structuredLog('warn', message, data, component);
  },

  error: (
    message: string,
    data?: Record<string, unknown> & { err?: Error },
    component?: keyof typeof loggerContext
  ) => {
    structuredLog('error', message, data, component);
  },

  debug: (
    message: string,
    data?: Record<string, unknown>,
    component?: keyof typeof loggerContext
  ) => {
    if (_verbose || process.env.DEBUG) {
      structuredLog('debug', message, data, component);
    }
  },

  // ── CLI-only helpers (no structured data) ────────────────────────────────

  success: (message: string) => console.log(chalk.green('✔'), message),

  /** @deprecated Use logger.warn() */
  warning: (message: string) => console.log(chalk.yellow('⚠'), message),

  // ── Styled text helpers ──────────────────────────────────────────────────

  bold: (text: string) => chalk.bold(text),
  dim: (text: string) => chalk.dim(text),
  cyan: (text: string) => chalk.cyan(text),
  green: (text: string) => chalk.green(text),
  yellow: (text: string) => chalk.yellow(text),
  red: (text: string) => chalk.red(text),

  keyValue: (key: string, value: string) => {
    console.log(`  ${chalk.gray(key + ':')} ${value}`);
  },

  newline: () => console.log(),

  header: (text: string) => {
    console.log();
    console.log(chalk.bold.underline(text));
    console.log();
  },

  // ── Operation tracing ────────────────────────────────────────────────────

  startOperation: (
    operation: string,
    data?: Record<string, unknown>
  ): { correlationId: string; end: (result?: { success: boolean; error?: string }) => void } => {
    const correlationId = generateCorrelationId();
    const startTime = Date.now();

    structuredLog('info', `Starting: ${operation}`, { ...data, correlationId });

    return {
      correlationId,
      end: (result?: { success: boolean; error?: string }) => {
        const duration = Date.now() - startTime;
        if (result?.error) {
          structuredLog('error', `Failed: ${operation}`, {
            ...data,
            correlationId,
            duration: `${duration}ms`,
            error: result.error,
          });
        } else {
          structuredLog('info', `Completed: ${operation}`, {
            ...data,
            correlationId,
            duration: `${duration}ms`,
            success: result?.success ?? true,
          });
        }
      },
    };
  },
};

export function createSpinner(text: string): Ora {
  return ora({ text, color: 'cyan' });
}

export { chalk };
