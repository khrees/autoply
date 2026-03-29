import type { Profile, JobData, Application, GeneratedDocuments, Platform } from '../types';
import { parseJobUrl } from '../utils/url-parser';
import { scrapeJob, createScraper, BaseScraper } from '../scrapers';
import { createAIProvider } from '../ai/provider';
import { tailorResume } from '../ai/resume';
import { generateCoverLetter, answerAllQuestions } from '../ai/cover-letter';
import { evaluateJobFit, type JobFitResult } from '../ai/job-matcher';
import { verifySubmissionScreenshot, type VerificationResult } from '../ai/screenshot-verifier';
export type { JobFitResult } from '../ai/job-matcher';
import { profileRepository } from '../db/repositories/profile';
import { applicationRepository } from '../db/repositories/application';
import { configRepository } from '../db/repositories/config';
import { ApplicationQueue } from './queue';
import {
  requiresHumanAnswer,
  shouldAllowAIAnswer,
  getDeterministicFieldValue,
} from './form-filler';
import { generateResumePdf, generateCoverLetterPdf, generateDocumentFilename } from './document';
import { logger, createSpinner } from '../utils/logger';
import { join } from 'path';
import { mkdir } from 'fs/promises';
import { getAutoplyDir, ensureAutoplyDir } from '../db';
import type { SubmissionResult } from '../scrapers/base';

export interface ApplicationResult {
  success: boolean;
  application?: Application;
  error?: string;
  documents?: GeneratedDocuments;
  fitResult?: JobFitResult;
}

export interface GeneratedDocumentPaths {
  resumePath?: string;
  coverLetterPath?: string;
}

export interface PassiveProcessResult extends ApplicationResult {
  jobData?: JobData;
  fillPlan?: Record<string, string>;
}

export interface ApplyOptions {
  dryRun?: boolean;
  profile?: Profile;
  generateOnly?: boolean;
  autoMode?: boolean;
  resumePath?: string;
  coverLetterPath?: string;
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

export class ApplicationOrchestrator {
  private queue: ApplicationQueue;

  constructor() {
    this.queue = new ApplicationQueue();
  }

  async applyToJob(url: string, options: ApplyOptions = {}): Promise<ApplicationResult> {
    const {
      dryRun = false,
      generateOnly = false,
      autoMode = false,
      resumePath,
      coverLetterPath,
    } = options;

    // Validate URL
    const parsedUrl = parseJobUrl(url);
    if (!parsedUrl.isValid) {
      return { success: false, error: parsedUrl.error };
    }

    // Get profile
    const profile = options.profile ?? profileRepository.findFirst();
    if (!profile) {
      return { success: false, error: 'No profile found. Run "autoply init" to create one.' };
    }

    const spinner = createSpinner(`Scraping job from ${parsedUrl.platform}...`);
    spinner.start();

    let jobData: JobData;
    try {
      logger.debug(`Scraping ${parsedUrl.platform} job at ${url}`);
      jobData = await scrapeJob(url, parsedUrl.platform);
      spinner.succeed(`Scraped: ${jobData.title} at ${jobData.company}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      spinner.fail(`Failed to scrape job from ${parsedUrl.platform}`);
      return {
        success: false,
        error: `[${parsedUrl.platform}] Scraping failed for ${url}: ${msg}. Check that the URL is accessible in a browser.`,
      };
    }

    // Don't submit applications with unknown job titles
    if (jobData.title === 'Unknown Position' && !dryRun && !generateOnly) {
      return {
        success: false,
        error:
          'Cannot submit application: job title could not be scraped. Try with --dry-run to generate documents only.',
      };
    }

    // Evaluate job fit
    let fitResult: JobFitResult | undefined;
    try {
      const provider = createAIProvider();
      if (await provider.isAvailable()) {
        spinner.start('Evaluating job fit...');
        fitResult = await evaluateJobFit(provider, profile, jobData);
        spinner.succeed(`Fit score: ${fitResult.score}% (${fitResult.recommendation})`);

        if (fitResult.strongMatches.length > 0) {
          logger.info(`  Strong: ${fitResult.strongMatches.slice(0, 3).join(', ')}`);
        }
        if (fitResult.missingSkills.length > 0) {
          logger.info(`  Gaps: ${fitResult.missingSkills.slice(0, 3).join(', ')}`);
        }

        // Check minimum fit score threshold
        const config = configRepository.loadAppConfig();
        if (config.application.minFitScore && fitResult.score < config.application.minFitScore) {
          logger.warning(
            `Skipping: fit score ${fitResult.score}% below threshold ${config.application.minFitScore}%`
          );
          return { success: false, error: `Fit score below threshold`, fitResult };
        }
      }
    } catch {
      // Fit evaluation is optional, continue without it
    }

    // Generate documents
    logger.debug(`Generating documents for ${jobData.title} at ${jobData.company}`);
    spinner.start('Generating tailored resume...');
    let documents: GeneratedDocuments;
    try {
      const provider = createAIProvider();
      const isAvailable = await provider.isAvailable();
      if (!isAvailable) {
        spinner.fail('AI provider not available');
        return { success: false, error: 'AI provider is not running or configured' };
      }

      const resume = await tailorResume(provider, profile, jobData);
      spinner.succeed('Resume generated');

      spinner.start('Generating cover letter...');
      const coverLetter = await generateCoverLetter(provider, profile, jobData);
      spinner.succeed('Cover letter generated');

      documents = { resume, coverLetter };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      spinner.fail(`Document generation failed for ${url}`);
      return {
        success: false,
        error: `[${parsedUrl.platform}] AI generation failed for ${url}: ${msg}. Check your AI provider is running ("ollama serve" or API key set).`,
      };
    }

    // If generate only or dry run, save and return
    if (generateOnly || dryRun) {
      if (dryRun) {
        logger.info('Dry run mode - not submitting application');
        logger.newline();
        logger.header('Generated Resume Preview');
        console.log(documents.resume.slice(0, 500) + '...');
        logger.newline();
        logger.header('Generated Cover Letter Preview');
        console.log(documents.coverLetter.slice(0, 500) + '...');
      }

      // Create application record
      const application = applicationRepository.create({
        profile_id: profile.id || 0,
        url,
        platform: parsedUrl.platform,
        company: jobData.company,
        job_title: jobData.title,
        status: 'pending',
        generated_resume: documents.resume,
        generated_cover_letter: documents.coverLetter,
      });

      return { success: true, application, documents, fitResult };
    }

    // Answer custom questions
    if (jobData.custom_questions.length > 0) {
      spinner.start(`Answering ${jobData.custom_questions.length} custom questions...`);
      try {
        const provider = createAIProvider();
        const config = configRepository.loadAppConfig();
        const aiAnswerableQuestions = jobData.custom_questions.filter(
          (question) =>
            !question.answer &&
            (question.required || config.application.fillOptionalFields) &&
            !requiresHumanAnswer(question.question) &&
            shouldAllowAIAnswer({
              label: question.question,
              name: question.id,
              type: question.type,
              options: question.options,
            })
        );

        // Get previous answers from DB for few-shot learning
        const previousApps = applicationRepository.findAll({
          profile_id: profile.id,
          status: 'submitted',
        });
        const previousAnswers: Array<{ question: string; answer: string }> = [];
        for (const app of previousApps.slice(0, 5)) {
          const questions = app.form_data?.questions as
            | Array<{ question: string; answer?: string }>
            | undefined;
          if (questions) {
            for (const q of questions) {
              if (q.answer && previousAnswers.length < 10) {
                previousAnswers.push({ question: q.question, answer: q.answer });
              }
            }
          }
        }

        if (aiAnswerableQuestions.length > 0) {
          const answers = await answerAllQuestions(
            provider,
            profile,
            jobData,
            aiAnswerableQuestions,
            previousAnswers
          );
          for (const q of aiAnswerableQuestions) {
            if (!q.answer) {
              q.answer = answers.get(q.question);
            }
          }
        }
        spinner.succeed('Custom questions answered');
      } catch (error) {
        spinner.warn('Some questions could not be auto-answered');
      }
    }

    // Create application record
    const application = applicationRepository.create({
      profile_id: profile.id || 0,
      url,
      platform: parsedUrl.platform,
      company: jobData.company,
      job_title: jobData.title,
      status: 'pending',
      generated_resume: documents.resume,
      generated_cover_letter: documents.coverLetter,
      form_data: {
        fields: jobData.form_fields,
        questions: jobData.custom_questions,
      },
    });

    // Check if auto-submit is enabled
    const config = configRepository.loadAppConfig();
    if (config.application.autoSubmit) {
      const maxRetries = Math.max(1, config.application.retryAttempts ?? 3);
      let lastError = '';
      let lastScreenshotPath: string | undefined;
      // Create scraper once for reuse in retries
      const scraper = createScraper(application.platform);
      scraper.keepAlive = true;

      try {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          logger.debug(
            `Submitting application to ${parsedUrl.platform} at ${url} (attempt ${attempt}/${maxRetries})`
          );
          spinner.start(
            attempt === 1
              ? 'Submitting application...'
              : `Retrying submission (attempt ${attempt}/${maxRetries})...`
          );
          // Stop spinner so interactive prompts for unfillable fields can display on stdin
          if (!autoMode) {
            spinner.info(
              attempt === 1
                ? 'Filling application form...'
                : `Retrying submission (attempt ${attempt}/${maxRetries})...`
            );
          }

          try {
            const submissionResult = await this.submitApplication(
              application,
              jobData,
              profile,
              documents,
              autoMode,
              resumePath,
              coverLetterPath,
              scraper
            );
            lastScreenshotPath = submissionResult.screenshotPath;

            // Trust the scraper's DOM confirmation when it reports success.
            if (submissionResult.success && application.id) {
              const submittedApplication = applicationRepository.update(application.id, {
                status: 'submitted',
                applied_at: new Date().toISOString(),
              });
              spinner.succeed('Application submitted!');
              return {
                success: true,
                application: submittedApplication ?? application,
                documents,
                fitResult,
              };
            }

            let verification: VerificationResult | undefined;
            if (submissionResult.screenshotPath) {
              spinner.start('Collecting submission diagnostics...');

              // Brief pause to let confirmation page fully render before verification
              await new Promise((r) => setTimeout(r, 2000));

              verification = await verifySubmissionScreenshot(submissionResult.screenshotPath);
              logger.debug(
                `Screenshot diagnostic (${verification.confidence}): ${verification.reason}`
              );
            }

            lastError = summarizeSubmissionFailure(submissionResult, verification);
            spinner.warn(
              `Submission not confirmed (attempt ${attempt}/${maxRetries}): ${lastError}`
            );

            if (attempt < maxRetries) {
              logger.info('Retrying submission...');
              await new Promise((r) => setTimeout(r, 2000)); // Wait before retry
            }
          } catch (error) {
            lastError = error instanceof Error ? error.message : 'Unknown error';
            spinner.warn(`Submission attempt ${attempt} failed: ${lastError}`);

            if (attempt < maxRetries) {
              await new Promise((r) => setTimeout(r, 2000));
            }
          }
        }
      } finally {
        // Explicitly close scraper after loop
        await scraper.close();
      }

      // All retries exhausted
      const failedApplication = application.id
        ? applicationRepository.update(application.id, {
            status: 'failed',
            error_message: lastError,
          })
        : undefined;
      spinner.fail(`Submission failed after ${maxRetries} attempts`);
      if (lastScreenshotPath) {
        logger.info(`Screenshot saved to: ${lastScreenshotPath}`);
      }
      return {
        success: false,
        application: failedApplication ?? application,
        error: `[${parsedUrl.platform}] Submission failed after ${maxRetries} attempts: ${lastError}`,
        documents,
        fitResult,
      };
    } else {
      logger.info('Auto-submit disabled. Filling application form...');

      const scraper = createScraper(application.platform);

      // Ensure directories exist
      ensureAutoplyDir();
      const docsDir = join(getAutoplyDir(), 'documents');
      await mkdir(docsDir, { recursive: true });

      const resumePdfPath =
        resumePath ?? join(docsDir, generateDocumentFilename(profile.name, 'resume'));
      const coverLetterPdfPath =
        coverLetterPath ?? join(docsDir, generateDocumentFilename(profile.name, 'cover_letter'));

      // Generate PDFs for uploading if they don't exist
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
          autoMode,
          fillOnly: true,
        });

        if (fillResult.success) {
          spinner.succeed('Application prepared for manual review.');
          logger.info('Browser left open. You can review and submit manually.');
          logger.info('Close the browser window when you are done.');

          if (application.id) {
            applicationRepository.update(application.id, {
              status: 'filled',
            });
          }

          await scraper.waitForBrowserClose();
          await scraper.close();

          return {
            success: true,
            application,
            documents,
            fitResult,
          };
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
        return {
          success: false,
          application,
          error: `[${parsedUrl.platform}] ${errorMessage}`,
          documents,
          fitResult,
        };
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
          error: `[${parsedUrl.platform}] Form filling failed: ${errorMessage}`,
          documents,
          fitResult,
        };
      }
    }
  }

  private async submitApplication(
    application: Application,
    jobData: JobData,
    profile: Profile,
    documents: GeneratedDocuments,
    autoMode = false,
    resumePathOverride?: string,
    coverLetterPathOverride?: string,
    scraperOverride?: BaseScraper
  ): Promise<SubmissionResult> {
    // Ensure directories exist
    ensureAutoplyDir();
    const docsDir = join(getAutoplyDir(), 'documents');
    const screenshotsDir = join(getAutoplyDir(), 'screenshots');

    await mkdir(docsDir, { recursive: true });
    await mkdir(screenshotsDir, { recursive: true });

    // Save documents (markdown and PDF)
    const resumeMdPath = join(docsDir, `${application.id}_resume.md`);
    const coverLetterMdPath = join(docsDir, `${application.id}_cover_letter.md`);
    const resumePdfPath =
      resumePathOverride ?? join(docsDir, generateDocumentFilename(profile.name, 'resume'));
    const coverLetterPdfPath =
      coverLetterPathOverride ??
      join(docsDir, generateDocumentFilename(profile.name, 'cover_letter'));

    // Save markdown versions
    await Bun.write(resumeMdPath, documents.resume);
    await Bun.write(coverLetterMdPath, documents.coverLetter);

    // Generate PDFs for uploading
    if (!resumePathOverride) {
      await generateResumePdf(documents.resume, resumePdfPath, profile.name);
    }
    if (!coverLetterPathOverride) {
      await generateCoverLetterPdf(documents.coverLetter, coverLetterPdfPath, profile.name);
    }

    // Create scraper for this platform (if not provided)
    const scraper = scraperOverride ?? createScraper(application.platform);

    // Prepare answered questions
    const answeredQuestions = jobData.custom_questions;

    // Submit the application using platform-specific scraper
    const result = await scraper.submitApplication(application.url, {
      profile,
      jobData,
      documents,
      resumePath: resumePdfPath,
      coverLetterPath: coverLetterPdfPath,
      answeredQuestions,
      autoMode,
    });

    return result;
  }

  async generateDocuments(
    url: string,
    outputDir: string,
    type: 'resume' | 'cover-letter' | 'both' = 'both'
  ): Promise<GeneratedDocumentPaths> {
    const parsedUrl = parseJobUrl(url);
    if (!parsedUrl.isValid) {
      throw new Error(parsedUrl.error || 'Invalid URL');
    }

    const profile = profileRepository.findFirst();
    if (!profile) {
      throw new Error('No profile found. Run "autoply init" first.');
    }

    await mkdir(outputDir, { recursive: true });

    const provider = createAIProvider();
    if (!(await provider.isAvailable())) {
      throw new Error('AI provider is not running or configured');
    }

    const spinner = createSpinner('Scraping job...');
    spinner.start();

    let jobData: JobData;
    try {
      jobData = await scrapeJob(url, parsedUrl.platform);
      spinner.succeed(`Scraped: ${jobData.title} at ${jobData.company}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      spinner.fail(`Failed to scrape job from ${parsedUrl.platform}`);
      throw new Error(
        `[${parsedUrl.platform}] Scraping failed for ${url}: ${message}. Check that the URL is accessible in a browser.`
      );
    }

    const result: GeneratedDocumentPaths = {};

    if (type === 'resume' || type === 'both') {
      spinner.start('Generating tailored resume...');
      try {
        const resume = await tailorResume(provider, profile, jobData);
        const resumePath = join(outputDir, generateDocumentFilename(profile.name, 'resume'));
        await generateResumePdf(resume, resumePath, profile.name);
        result.resumePath = resumePath;
        spinner.succeed(`Resume saved to: ${resumePath}`);
      } catch (error) {
        spinner.fail('Failed to generate tailored resume');
        throw new Error(error instanceof Error ? error.message : 'Unknown resume generation error');
      }
    }

    if (type === 'cover-letter' || type === 'both') {
      spinner.start('Generating cover letter...');
      try {
        const coverLetter = await generateCoverLetter(provider, profile, jobData);
        const coverLetterPath = join(
          outputDir,
          generateDocumentFilename(profile.name, 'cover_letter')
        );
        await generateCoverLetterPdf(coverLetter, coverLetterPath, profile.name);
        result.coverLetterPath = coverLetterPath;
        spinner.succeed(`Cover letter saved to: ${coverLetterPath}`);
      } catch (error) {
        spinner.fail('Failed to generate cover letter');
        throw new Error(
          error instanceof Error ? error.message : 'Unknown cover letter generation error'
        );
      }
    }

    return result;
  }

  async processJobPassively(
    html: string,
    url: string,
    platform: Platform,
    options: ApplyOptions = {}
  ): Promise<PassiveProcessResult> {
    const profile = options.profile ?? profileRepository.findFirst();
    if (!profile) {
      return { success: false, error: 'No profile found' };
    }

    const provider = createAIProvider();
    if (!(await provider.isAvailable())) {
      return { success: false, error: 'AI provider not available' };
    }

    try {
      // 1. Extract job data from HTML using AI
      const { extractJobDataWithAI, mergeJobData } = await import('../ai/job-extractor');
      const extracted = await extractJobDataWithAI(provider, html, url);

      // Create full JobData with defaults
      const jobData: JobData = mergeJobData(
        {
          url,
          platform,
          title: 'Unknown Position',
          company: '',
          description: '',
          requirements: [],
          qualifications: [],
          form_fields: [],
          custom_questions: [],
        },
        extracted
      );

      // 2. Evaluate Fit
      const fitResult = await evaluateJobFit(provider, profile, jobData);

      // 3. Generate Documents
      const resumeMd = await tailorResume(provider, profile, jobData);
      const coverLetterMd = await generateCoverLetter(provider, profile, jobData);

      // Convert to PDF and then to base64
      const { markdownToPdf } = await import('./document');
      const resumeBytes = await markdownToPdf(resumeMd, { title: 'Resume' });
      const coverLetterBytes = await markdownToPdf(coverLetterMd, { title: 'Cover Letter' });

      const resumeBase64 = `data:application/pdf;base64,${Buffer.from(resumeBytes).toString('base64')}`;
      const coverLetterBase64 = `data:application/pdf;base64,${Buffer.from(coverLetterBytes).toString('base64')}`;

      const documents: GeneratedDocuments = {
        resume: resumeBase64,
        coverLetter: coverLetterBase64,
      };

      // 4. Create record
      const application = applicationRepository.create({
        profile_id: profile.id || 0,
        url,
        platform,
        company: jobData.company,
        job_title: jobData.title,
        status: 'pending',
        generated_resume: resumeMd,
        generated_cover_letter: coverLetterMd,
        form_data: {
          fields: jobData.form_fields,
          questions: jobData.custom_questions,
        },
      });

      // 5. Calculate Fill Plan (Field mappings)
      const fillPlan: Record<string, string> = {};

      // Deterministic fields
      for (const field of jobData.form_fields || []) {
        const value = getDeterministicFieldValue(profile, field);
        if (value) fillPlan[field.name || field.label || ''] = value;
      }

      // AI questions
      if (jobData.custom_questions && jobData.custom_questions.length > 0) {
        const answers = await answerAllQuestions(
          provider,
          profile,
          jobData,
          jobData.custom_questions,
          []
        );
        for (const [q, a] of answers.entries()) {
          fillPlan[q] = a;
        }
      }

      return {
        success: true,
        application,
        documents,
        fitResult,
        jobData,
        fillPlan,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Processing failed',
      };
    }
  }
}

export const applicationOrchestrator = new ApplicationOrchestrator();
