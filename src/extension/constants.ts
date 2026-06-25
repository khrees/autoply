/**
 * Shared constants for the Autoply extension.
 * Centralised to avoid duplication and the (globalThis as any).__API_BASE__ pattern.
 */

/** Base URL for the Autoply API server */
export const API_BASE: string =
  (typeof globalThis !== 'undefined' && (globalThis as any).__API_BASE__) || 'http://localhost:8088';

/** URL protocols where the extension cannot inject content scripts */
export const NON_SCRIPTABLE_PROTOCOLS = [
  'chrome:',
  'chrome-extension:',
  'devtools:',
  'edge:',
  'about:',
  'moz-extension:',
] as const;

/** Hostnames that are not valid for autofill */
export const UNSUPPORTED_HOSTNAMES = ['chromewebstore.google.com'] as const;

/** Default toast durations (ms) */
export const TOAST_DURATION = {
  SUCCESS: 4000,
  ERROR: 6000,
  WARNING: 4000,
  INFO: 4000,
} as const;

/** Maximum number of applications shown without filtering */
export const MAX_RECENT_APPS = 10;

/** Maximum retries for application submission */
export const MAX_SUBMIT_RETRIES = 3;
