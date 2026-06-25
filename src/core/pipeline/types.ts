import type { Profile, JobData, Application, GeneratedDocuments, Platform } from '../../types';
import type { SubmissionResult } from '../../scrapers/base';
import type { VerificationResult } from '../../ai/screenshot-verifier';
import type { JobFitResult } from '../../ai/job-matcher';

// Re-export for external consumers
export type { JobFitResult };

// ── Main application result ───────────────────────────────────────────────────
export interface ApplicationResult {
  success: boolean;
  application?: Application;
  error?: string;
  documents?: GeneratedDocuments;
  fitResult?: JobFitResult;
}

// ── Passive processing result (used by the extension) ─────────────────────────
export interface PassiveProcessResult extends ApplicationResult {
  jobData?: JobData;
  fillPlan?: Record<string, string>;
  profileData?: Record<string, string>;
}

// ── Document generation result ────────────────────────────────────────────────
export interface GeneratedDocumentPaths {
  resumePath?: string;
  coverLetterPath?: string;
  resumeContent?: string;
  coverLetterContent?: string;
}

// ── Form field ────────────────────────────────────────────────────────────────
export interface DetectedFormField {
  key: string;
  type: string;
  label: string;
}

// ── Automation flags ──────────────────────────────────────────────────────────
export interface AutoModeOptions {
  skipPrompts: boolean;
  useAIForOptionalQuestions: boolean;
  submitWithoutConfirmation: boolean;
}

// ── apply() options ───────────────────────────────────────────────────────────
export interface ApplyOptions {
  dryRun?: boolean;
  profile?: Profile;
  generateOnly?: boolean;
  autoMode?: boolean | Partial<AutoModeOptions>;
  resumePath?: string;
  coverLetterPath?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
export function resolveAutoMode(autoMode: ApplyOptions['autoMode']): AutoModeOptions {
  if (!autoMode)
    return { skipPrompts: false, useAIForOptionalQuestions: false, submitWithoutConfirmation: false };
  if (autoMode === true)
    return { skipPrompts: true, useAIForOptionalQuestions: true, submitWithoutConfirmation: true };
  return {
    skipPrompts: false,
    useAIForOptionalQuestions: false,
    submitWithoutConfirmation: false,
    ...autoMode,
  };
}

export function summarizeSubmissionFailure(
  submissionResult: SubmissionResult,
  verification?: VerificationResult
): string {
  let message =
    submissionResult.errors.length > 0
      ? `${submissionResult.message}: ${submissionResult.errors.join(', ')}`
      : submissionResult.message;

  if (verification) {
    const screenshotDetail = verification.errors?.length
      ? `${verification.reason}: ${verification.errors.join(', ')}`
      : verification.reason;
    message = `${message} | Screenshot check: ${screenshotDetail}`;
  }

  return message;
}
