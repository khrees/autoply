import type { JobData } from '../types';
import { generateCoverLetter } from '../ai/cover-letter';
import { evaluateJobFit } from '../ai/job-matcher';
import { tailorResume } from '../ai/resume';
import { answerAllQuestions } from '../ai/cover-letter';
import { profileRepository } from '../db/repositories/profile';
import { applicationRepository } from '../db/repositories/application';
import { configRepository } from '../db/repositories/config';
import { savedAnswersRepository } from '../db/repositories/saved-answers';
import { ApplicationQueue } from './queue';
import { getDeterministicFieldValue } from './form-filler';
import { generateResumePdf, generateCoverLetterPdf, generateDocumentFilename, markdownToPdf } from './document';
import { logger, createSpinner, withCorrelationId, generateCorrelationId } from '../utils/logger';

// ── Re-export pipeline types for external consumers ───────────────────────────
export type {
  ApplicationResult,
  PassiveProcessResult,
  GeneratedDocumentPaths,
  DetectedFormField,
  AutoModeOptions,
  ApplyOptions,
  JobFitResult,
} from './pipeline/types';
export { resolveAutoMode, summarizeSubmissionFailure } from './pipeline/types';

// ── Import pipeline processors ────────────────────────────────────────────────
import { scrapeJobForApplication } from './pipeline/scraper';
import { evaluateFitForJob } from './pipeline/fit-evaluator';
import { generateApplicationDocuments } from './pipeline/document-generator';
import { handleCustomQuestions } from './pipeline/question-handler';
import { submitApplicationWithRetries, fillApplicationForm } from './pipeline/form-submitter';
import type {
  ApplicationResult,
  PassiveProcessResult,
  GeneratedDocumentPaths,
  AutoModeOptions,
  ApplyOptions,
} from './pipeline/types';

import { parseJobUrl } from '../utils/url-parser';
import { scrapeJob } from '../scrapers';
import { createAIProvider } from '../ai/provider';
import { join } from 'path';
import { mkdir } from 'fs/promises';
import type { Platform } from '../types';

export class ApplicationOrchestrator {
  private queue: ApplicationQueue;

  constructor() {
    this.queue = new ApplicationQueue();
  }

  async applyToJob(url: string, options: ApplyOptions = {}): Promise<ApplicationResult> {
    const correlationId = generateCorrelationId();
    return withCorrelationId(correlationId, async () => {
      return this._applyToJobInner(url, options, correlationId);
    });
  }

  private async _applyToJobInner(
    url: string,
    options: ApplyOptions,
    correlationId: string
  ): Promise<ApplicationResult> {
    const { dryRun = false, generateOnly = false, resumePath, coverLetterPath } = options;
    const autoOpts = this._resolveAutoMode(options.autoMode);
    const config = configRepository.loadAppConfig();

    const provider = createAIProvider();

    // Step 1: Get profile
    const profile = options.profile ?? profileRepository.findFirst();
    if (!profile) {
      return { success: false, error: 'No profile found. Run "autoply init" to create one.' };
    }

    logger.debug('Starting application', { url, correlationId }, 'cli');
    const spinner = createSpinner('Scraping job...');
    spinner.start();

    // Step 2: Scrape job
    const scrapeResult = await scrapeJobForApplication(url);
    if (!scrapeResult.success) {
      spinner.fail('Failed to scrape job');
      return { success: false, error: scrapeResult.error };
    }
    const { jobData, platform } = scrapeResult;
    spinner.succeed(`Scraped: ${jobData.title} at ${jobData.company}`);

    // Don't submit applications with unknown job titles
    if (jobData.title === 'Unknown Position' && !dryRun && !generateOnly) {
      return {
        success: false,
        error:
          'Cannot submit application: job title could not be scraped. Try with --dry-run to generate documents only.',
      };
    }

    // Step 3: Evaluate job fit
    spinner.start('Evaluating job fit...');
    const fitResult = await evaluateFitForJob(provider, profile, jobData, config.application.minFitScore);
    if (fitResult.belowThreshold) {
      spinner.fail(`Fit score below threshold`);
      return { success: false, error: `Fit score below threshold`, fitResult: fitResult.fitResult };
    }
    if (fitResult.fitResult) {
      spinner.succeed(`Fit score: ${fitResult.fitResult.score}%`);
    } else {
      spinner.stop();
    }

    // Step 4: Generate documents
    const docResult = await generateApplicationDocuments(
      provider, profile, jobData, jobData.title, jobData.company, url, platform, spinner
    );
    if (!docResult.success) {
      return { success: false, error: docResult.error };
    }
    const documents = docResult.documents;

    // Step 5: Handle generate-only / dry-run
    if (generateOnly || dryRun) {
      if (dryRun) {
        logger.info('Dry run mode - not submitting application');
        logger.newline();
        logger.debug('Generated Resume Preview', {
          content: documents.resume.slice(0, 500) + '...',
        });
        logger.debug('Generated Cover Letter Preview', {
          content: documents.coverLetter.slice(0, 500) + '...',
        });
      }

      const application = applicationRepository.create({
        profile_id: profile.id || 0,
        url,
        platform,
        company: jobData.company,
        job_title: jobData.title,
        status: 'pending',
        generated_resume: documents.resume,
        generated_cover_letter: documents.coverLetter,
      });

      return { success: true, application, documents, fitResult: fitResult.fitResult };
    }

    // Step 6: Answer custom questions
    await handleCustomQuestions(jobData, profile, provider, config, spinner);

    // Step 7: Create application record
    const application = applicationRepository.create({
      profile_id: profile.id || 0,
      url,
      platform,
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

    // Step 8: Auto-submit or fill-only
    if (config.application.autoSubmit) {
      return submitApplicationWithRetries(
        application, jobData, profile, documents, autoOpts,
        resumePath, coverLetterPath, platform, url, correlationId, spinner,
        fitResult.fitResult
      );
    } else {
      logger.info('Auto-submit disabled. Filling application form...');
      return fillApplicationForm(
        application, jobData, profile, documents, autoOpts,
        resumePath, coverLetterPath, platform, url, spinner
      );
    }
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
        const resumeContent = await tailorResume(provider, profile, jobData);
        const resumePath = join(
          outputDir,
          generateDocumentFilename(profile.name, 'resume', jobData.company)
        );
        await generateResumePdf(resumeContent, resumePath, profile.name);
        result.resumePath = resumePath;
        result.resumeContent = resumeContent;
        spinner.succeed(`Resume saved to: ${resumePath}`);
      } catch (error) {
        spinner.fail('Failed to generate tailored resume');
        throw new Error(error instanceof Error ? error.message : 'Unknown resume generation error');
      }
    }

    if (type === 'cover-letter' || type === 'both') {
      spinner.start('Generating cover letter...');
      try {
        const coverLetterContent = await generateCoverLetter(provider, profile, jobData);
        const coverLetterPath = join(
          outputDir,
          generateDocumentFilename(profile.name, 'cover_letter', jobData.company)
        );
        await generateCoverLetterPdf(coverLetterContent, coverLetterPath, profile.name);
        result.coverLetterPath = coverLetterPath;
        result.coverLetterContent = coverLetterContent;
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
    options: ApplyOptions = {},
    detectedFields?: Array<{ key: string; type: string; label: string }>
  ): Promise<PassiveProcessResult> {
    const profile = options.profile ?? profileRepository.findFirst();
    if (!profile) {
      return { success: false, error: 'No profile found' };
    }

    const provider = createAIProvider();
    if (!(await provider.isAvailable())) {
      return { success: false, error: 'AI provider not available' };
    }

    // Strip HTML tags before sending to the LLM to prevent prompt injection
    // embedded in page content (e.g. <!-- ignore previous instructions -->)
    const safeText = html
      .replace(/<!--[\s\S]*?-->/g, '')      // remove HTML comments first
      .replace(/<script[\s\S]*?<\/script>/gi, '')   // strip script blocks
      .replace(/<style[\s\S]*?<\/style>/gi, '')      // strip style blocks
      .replace(/<[^>]+>/g, ' ')              // remove remaining tags
      .replace(/&[a-z]+;/gi, ' ')            // decode common entities roughly
      .replace(/\s{2,}/g, ' ')               // collapse whitespace
      .trim()
      .slice(0, 100_000);                    // hard cap at 100k chars

    try {
      // 1. Extract job data from page text using AI
      const { extractJobDataWithAI, mergeJobData } = await import('../ai/job-extractor');
      const extracted = await extractJobDataWithAI(provider, safeText, url);

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

      const resumeBytes = await markdownToPdf(resumeMd, { title: 'Resume' });
      const coverLetterBytes = await markdownToPdf(coverLetterMd, { title: 'Cover Letter' });

      const resumeBase64 = `data:application/pdf;base64,${Buffer.from(resumeBytes).toString('base64')}`;
      const coverLetterBase64 = `data:application/pdf;base64,${Buffer.from(coverLetterBytes).toString('base64')}`;

      const documents = {
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

      // 5. Build profile data map for extension to use
      const profileData: Record<string, string> = {
        firstName: profile.name.split(' ')[0] || '',
        lastName: profile.name.split(' ').slice(1).join(' ') || '',
        fullName: profile.name,
        email: profile.email,
        phone: profile.phone || '',
        location: profile.location || '',
        linkedin: profile.linkedin_url || '',
        github: profile.github_url || '',
        portfolio: profile.portfolio_url || '',
      };

      // 6. Calculate Fill Plan (Field mappings)
      const fillPlan: Record<string, string> = {};

      if (detectedFields && detectedFields.length > 0) {
        for (const field of detectedFields) {
          const fieldKey = field.key || field.label;
          const normalizedFieldKey = fieldKey.toLowerCase().replace(/[^a-z0-9]/g, '');

          for (const [profileKey, profileValue] of Object.entries(profileData)) {
            const normalizedProfileKey = profileKey.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (
              normalizedFieldKey.includes(normalizedProfileKey) ||
              normalizedProfileKey.includes(normalizedFieldKey) ||
              normalizedFieldKey === normalizedProfileKey
            ) {
              if (profileValue) {
                fillPlan[fieldKey] = profileValue;
              }
              break;
            }
          }

          if (!fillPlan[fieldKey]) {
            const value = getDeterministicFieldValue(profile, {
              label: field.label,
              name: field.key,
              type: field.type as 'text' | 'select' | 'checkbox' | 'radio',
            });
            if (value) {
              fillPlan[fieldKey] = value;
            }
          }
        }
      } else {
        for (const field of jobData.form_fields || []) {
          const value = getDeterministicFieldValue(profile, field);
          if (value) fillPlan[field.name || field.label || ''] = value;
        }
      }

      // AI questions
      if (jobData.custom_questions && jobData.custom_questions.length > 0) {
        const unanswered = jobData.custom_questions.filter((q) => !q.answer);
        const needsAI: typeof unanswered = [];

        for (const q of unanswered) {
          const saved = savedAnswersRepository.findSimilar(profile.id || 0, q.question, 1);
          if (saved.length > 0) {
            fillPlan[q.question] = saved[0].answer;
          } else {
            needsAI.push(q);
          }
        }

        if (needsAI.length > 0) {
          const answers = await answerAllQuestions(provider, profile, jobData, needsAI, []);
          for (const [q, a] of answers.entries()) {
            fillPlan[q] = a;
            savedAnswersRepository.upsert(profile.id || 0, q, a);
          }
        }
      }

      return {
        success: true,
        application,
        documents,
        fitResult,
        jobData,
        fillPlan,
        profileData,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Processing failed',
      };
    }
  }

  private _resolveAutoMode(autoMode: ApplyOptions['autoMode']): AutoModeOptions {
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
}

export const applicationOrchestrator = new ApplicationOrchestrator();
