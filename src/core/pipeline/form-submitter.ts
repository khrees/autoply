import type { Profile, JobData, Application, GeneratedDocuments, Platform } from '../../types';
import type { SubmissionResult } from '../../scrapers/base';
import type { AutoModeOptions } from './types';
import type { VerificationResult } from '../../ai/screenshot-verifier';
import { createScraper, BaseScraper } from '../../scrapers';
import { verifySubmissionScreenshot } from '../../ai/screenshot-verifier';
import { applicationRepository } from '../../db/repositories/application';
import { configRepository } from '../../db/repositories/config';
import { logger, createSpinner } from '../../utils/logger';
import { generateResumePdf, generateCoverLetterPdf, generateDocumentFilename } from '../document';
import { getAutoplyDir, ensureAutoplyDir } from '../../db';
import { join } from 'path';
import { mkdir } from 'fs/promises';

export interface FormSubmissionResult {
  success: boolean;
  application?: Application;
  error?: string;
}

/**
 * Pipeline step 5: Submit the application with retry logic.
 */
export async function submitApplicationWithRetries(
  application: Application,
  jobData: JobData,
  profile: Profile,
  documents: GeneratedDocuments,
  autoOpts: AutoModeOptions,
  resumePath: string | undefined,
  coverLetterPath: string | undefined,
  platform: Platform,
  url: string,
  correlationId: string,
  spinner: ReturnType<typeof createSpinner>,
  _fitResult?: unknown
): Promise<FormSubmissionResult> {
  const config = configRepository.loadAppConfig();
  const maxRetries = Math.max(1, config.application.retryAttempts ?? 3);
  const attemptErrors: string[] = [];
  let lastScreenshotPath: string | undefined;
  const scraper = createScraper(application.platform);
  scraper.keepAlive = true;

  try {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      logger.debug(
        `Submitting application to ${platform} at ${url} (attempt ${attempt}/${maxRetries})`,
        { correlationId }
      );
      spinner.start(
        attempt === 1
          ? 'Submitting application...'
          : `Retrying submission (attempt ${attempt}/${maxRetries})...`
      );

      if (!autoOpts.skipPrompts) {
        spinner.info(
          attempt === 1
            ? 'Filling application form...'
            : `Retrying submission (attempt ${attempt}/${maxRetries})...`
        );
      }

      try {
        const submissionResult = await performSubmission(
          application,
          jobData,
          profile,
          documents,
          autoOpts,
          resumePath,
          coverLetterPath,
          scraper
        );
        lastScreenshotPath = submissionResult.screenshotPath;

        if (submissionResult.success && application.id) {
          const submittedApplication = applicationRepository.update(application.id, {
            status: 'submitted',
            applied_at: new Date().toISOString(),
          });
          spinner.succeed('Application submitted!');
          return {
            success: true,
            application: submittedApplication ?? application,
          };
        }

        let verification: VerificationResult | undefined;
        if (submissionResult.screenshotPath) {
          spinner.start('Collecting submission diagnostics...');
          await new Promise((r) => setTimeout(r, 2000));
          verification = await verifySubmissionScreenshot(submissionResult.screenshotPath);
          logger.debug(`Screenshot diagnostic (${verification.confidence}): ${verification.reason}`);
        }

        const attemptError = summarizeSubmissionFailure(submissionResult, verification);
        attemptErrors.push(`attempt ${attempt}: ${attemptError}`);
        spinner.warn(`Submission not confirmed (attempt ${attempt}/${maxRetries}): ${attemptError}`);

        if (attempt < maxRetries) {
          logger.info('Retrying submission...');
          await new Promise((r) => setTimeout(r, 2000));
        }
      } catch (error) {
        const attemptError = error instanceof Error ? error.message : 'Unknown error';
        attemptErrors.push(`attempt ${attempt}: ${attemptError}`);
        spinner.warn(`Submission attempt ${attempt} failed: ${attemptError}`);

        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    }
  } finally {
    await scraper.close();
  }

  const errorSummary = attemptErrors.join(' | ');
  const failedApplication = application.id
    ? applicationRepository.update(application.id, {
        status: 'failed',
        error_message: errorSummary,
      })
    : undefined;
  spinner.fail(`Submission failed after ${maxRetries} attempt${maxRetries > 1 ? 's' : ''}`);
  if (lastScreenshotPath) {
    logger.info(`Screenshot saved to: ${lastScreenshotPath}`);
  }
  return {
    success: false,
    application: failedApplication ?? application,
    error: `[${platform}] Submission failed after ${maxRetries} attempt${maxRetries > 1 ? 's' : ''}: ${errorSummary}`,
  };
}

/**
 * Fill the application form without submitting (leaves browser open for review).
 */
export async function fillApplicationForm(
  application: Application,
  jobData: JobData,
  profile: Profile,
  documents: GeneratedDocuments,
  autoOpts: Pick<AutoModeOptions, 'skipPrompts'>,
  resumePath: string | undefined,
  coverLetterPath: string | undefined,
  platform: Platform,
  url: string,
  spinner: ReturnType<typeof createSpinner>
): Promise<FormSubmissionResult> {
  const scraper = createScraper(application.platform);

  ensureAutoplyDir();
  const docsDir = join(getAutoplyDir(), 'documents');
  await mkdir(docsDir, { recursive: true });

  const resumePdfPath =
    resumePath ??
    join(docsDir, generateDocumentFilename(profile.name, 'resume', jobData.company));
  const coverLetterPdfPath =
    coverLetterPath ??
    join(docsDir, generateDocumentFilename(profile.name, 'cover_letter', jobData.company));

  if (!resumePath) {
    await generateResumePdf(documents.resume, resumePdfPath, profile.name);
  }
  if (!coverLetterPath) {
    await generateCoverLetterPdf(documents.coverLetter, coverLetterPdfPath, profile.name);
  }

  scraper.keepAlive = true;
  try {
    const fillResult = await scraper.fillApplication(url, {
      profile,
      jobData,
      documents,
      resumePath: resumePdfPath,
      coverLetterPath: coverLetterPdfPath,
      answeredQuestions: jobData.custom_questions,
      autoMode: autoOpts.skipPrompts,
      fillOnly: true,
    });

    if (fillResult.success) {
      spinner.succeed('Application prepared for manual review.');
      logger.info('Browser left open. You can review and submit manually.');
      logger.info('Close the browser window when you are done.');

      if (application.id) {
        applicationRepository.update(application.id, { status: 'filled' });
      }

      await scraper.waitForBrowserClose();
      await scraper.close();

      return { success: true, application };
    }

    const errorMessage =
      fillResult.errors.length > 0
        ? `${fillResult.message}: ${fillResult.errors.join(', ')}`
        : fillResult.message;
    spinner.fail('Failed to fill application form.');
    logger.error(`Error: ${errorMessage}`);

    if (application.id) {
      applicationRepository.update(application.id, {
        status: 'failed',
        error_message: errorMessage,
      });
    }
    await scraper.close();
    return { success: false, application, error: `[${platform}] ${errorMessage}` };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    spinner.fail(`Failed during form filling: ${errorMessage}`);
    if (application.id) {
      applicationRepository.update(application.id, {
        status: 'failed',
        error_message: errorMessage,
      });
    }
    await scraper.close();
    return {
      success: false,
      application,
      error: `[${platform}] Form filling failed: ${errorMessage}`,
    };
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Submit the application using the platform-specific scraper.
 */
async function performSubmission(
  application: Application,
  jobData: JobData,
  profile: Profile,
  documents: GeneratedDocuments,
  autoOpts: AutoModeOptions,
  resumePathOverride: string | undefined,
  coverLetterPathOverride: string | undefined,
  scraperOverride?: BaseScraper
): Promise<SubmissionResult> {
  ensureAutoplyDir();
  const docsDir = join(getAutoplyDir(), 'documents');
  const screenshotsDir = join(getAutoplyDir(), 'screenshots');
  await mkdir(docsDir, { recursive: true });
  await mkdir(screenshotsDir, { recursive: true });

  const resumeMdPath = join(docsDir, `${application.id}_resume.md`);
  const coverLetterMdPath = join(docsDir, `${application.id}_cover_letter.md`);
  const resumePdfPath =
    resumePathOverride ??
    join(docsDir, generateDocumentFilename(profile.name, 'resume', jobData.company));
  const coverLetterPdfPath =
    coverLetterPathOverride ??
    join(docsDir, generateDocumentFilename(profile.name, 'cover_letter', jobData.company));

  await Bun.write(resumeMdPath, documents.resume);
  await Bun.write(coverLetterMdPath, documents.coverLetter);

  if (!resumePathOverride) {
    await generateResumePdf(documents.resume, resumePdfPath, profile.name);
  }
  if (!coverLetterPathOverride) {
    await generateCoverLetterPdf(documents.coverLetter, coverLetterPdfPath, profile.name);
  }

  const scraper = scraperOverride ?? createScraper(application.platform);
  return scraper.submitApplication(application.url, {
    profile,
    jobData,
    documents,
    resumePath: resumePdfPath,
    coverLetterPath: coverLetterPdfPath,
    answeredQuestions: jobData.custom_questions,
    autoMode: autoOpts.skipPrompts,
  });
}

function summarizeSubmissionFailure(
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
