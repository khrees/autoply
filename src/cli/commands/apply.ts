import { Command } from 'commander';
import { confirm, input } from '@inquirer/prompts';
import { applicationOrchestrator } from '../../core/application';
import {
  validateUrls,
  readUrlsFromFile,
  getSupportedPlatforms,
  normalizeUrl,
} from '../../utils/url-parser';
import { profileRepository } from '../../db/repositories/profile';
import { applicationRepository } from '../../db/repositories/application';
import { configRepository } from '../../db/repositories/config';
import { logger, chalk } from '../../utils/logger';
import { applicationQueue } from '../../core/queue';
import { getAutoplyDir } from '../../db';
import { existsSync } from 'fs';
import { join } from 'path';
import { extractTextFromFile } from '../../utils/document-extractor';
import { createAIProvider } from '../../ai/provider';
import { extractProfileFromResume } from '../../ai/profile-extractor';
import { DEFAULT_CONFIG } from '../../types';

export const applyCommand = new Command('apply')
  .description('Apply to job(s)')
  .argument('[urls...]', 'Job URL(s) to apply to')
  .option('-f, --file <path>', 'Read URLs from file (one per line)')
  .option('-d, --dry-run', 'Generate documents without submitting')
  .option('-r, --resume', 'Resume interrupted bulk application')
  .option('--resume-file <path>', 'Use a specific resume PDF for submission')
  .option('--cover-letter-file <path>', 'Use a specific cover letter PDF for submission')
  .option('--auto', 'Skip confirmations and apply with smart defaults')
  .action(
    async (
      urls: string[],
      options: {
        file?: string;
        dryRun?: boolean;
        resume?: boolean;
        auto?: boolean;
        resumeFile?: string;
        coverLetterFile?: string;
      }
    ) => {
      // Check for profile
      let profile = profileRepository.findFirst();
      if (!profile) {
        logger.error('No profile found.');

        if (options.auto) {
          logger.error('Cannot use --auto without a profile. Run "autoply init" first.');
          process.exit(1);
        }

        const createNow = await confirm({
          message: 'Would you like to create one now?',
          default: true,
        });
        if (createNow) {
          const resumePath = await input({
            message: 'Path to your resume (drag & drop or type path):',
            validate: (value) => {
              if (!value.trim()) return 'Resume path is required';
              const cleaned = value.trim().replace(/^['"]|['"]$/g, '');
              if (!existsSync(cleaned)) return 'File not found';
              return true;
            },
          });

          const cleanedPath = resumePath.trim().replace(/^['"]|['"]$/g, '');
          const result = await extractTextFromFile(cleanedPath);
          if (!result.success) {
            logger.error(`Failed to extract resume: ${result.error}`);
            process.exit(1);
          }

          logger.info('Extracting profile from resume...');
          const provider = createAIProvider();
          const isAvailable = await provider.isAvailable();
          if (!isAvailable) {
            logger.error('AI provider not available.');
            logger.info(
              'Fix: Run "ollama serve" for local AI, or set OPENAI_API_KEY / ANTHROPIC_API_KEY for cloud.'
            );
            process.exit(1);
          }

          const profileData = await extractProfileFromResume(provider, result.content || '');
          profile = profileRepository.create(profileData);
          // Only initialize config if no config file exists yet
          const configPath = join(getAutoplyDir(), 'config.json');
          if (!existsSync(configPath)) {
            configRepository.saveAppConfig(DEFAULT_CONFIG);
          }
          logger.success(`Profile created for ${profile.name}`);
          logger.newline();
        }

        if (!profile) {
          process.exit(1);
        }
      }

      // Validate provided document paths (if any)
      const resumeFilePath = options.resumeFile?.trim();
      const coverLetterFilePath = options.coverLetterFile?.trim();
      if (resumeFilePath && !existsSync(resumeFilePath)) {
        logger.error(`Resume file not found: ${resumeFilePath}`);
        process.exit(1);
      }
      if (coverLetterFilePath && !existsSync(coverLetterFilePath)) {
        logger.error(`Cover letter file not found: ${coverLetterFilePath}`);
        process.exit(1);
      }

      // Handle resume mode
      if (options.resume) {
        const persistedInfo = applicationQueue.getPersistedInfo();
        if (persistedInfo && persistedInfo.pending > 0) {
          logger.info(
            `Found ${persistedInfo.pending} pending job(s) from ${persistedInfo.savedAt}`
          );
          applicationQueue.load();
        } else {
          logger.info('No interrupted queue found.');
          process.exit(0);
        }
      } else {
        // Collect URLs
        let allUrls: string[] = urls || [];

        // Read from file if specified
        if (options.file) {
          if (!existsSync(options.file)) {
            logger.error(`File not found: ${options.file}`);
            process.exit(1);
          }
          const fileUrls = await readUrlsFromFile(options.file);
          allUrls = [...allUrls, ...fileUrls];
        }

        // Check if we have URLs
        if (allUrls.length === 0) {
          logger.error(
            'No URLs provided. Usage: autoply apply <url> or autoply apply --file urls.txt'
          );
          logger.newline();
          logger.info('Supported platforms:');
          for (const platform of getSupportedPlatforms()) {
            console.log(`  - ${platform}`);
          }
          process.exit(1);
        }

        // Validate URLs
        const { valid, invalid } = validateUrls(allUrls);

        if (invalid.length > 0) {
          logger.warning(`${invalid.length} invalid URL(s):`);
          for (const inv of invalid) {
            logger.error(`  ${inv.url}: ${inv.error}`);
          }
          logger.newline();
        }

        if (valid.length === 0) {
          logger.error('No valid URLs to process.');
          process.exit(1);
        }

        // Filter out duplicates and already-applied URLs
        const seen = new Set<string>();
        const newUrls: typeof valid = [];
        const skippedUrls: { url: string; reason: string }[] = [];

        for (const v of valid) {
          const normalized = normalizeUrl(v.url);
          if (seen.has(normalized)) {
            skippedUrls.push({ url: v.url, reason: 'Duplicate in current batch' });
          } else if (
            applicationRepository.existsByUrl(normalized) ||
            applicationRepository.existsByUrl(v.url)
          ) {
            skippedUrls.push({ url: v.url, reason: 'Already applied' });
            seen.add(normalized);
          } else {
            seen.add(normalized);
            newUrls.push({ ...v, url: normalized });
          }
        }

        if (skippedUrls.length > 0) {
          logger.info(`Skipping ${skippedUrls.length} URL(s):`);
          for (const s of skippedUrls) {
            logger.debug(`  ${s.url} — ${s.reason}`);
          }
        }

        if (newUrls.length === 0) {
          logger.info('All URLs have already been applied to or are duplicates.');
          process.exit(0);
        }

        // Add to queue for persistence
        applicationQueue.addMany(newUrls.map((v) => v.url));
        applicationQueue.persist();
      }

      const pendingCount = applicationQueue.getPending().length;
      logger.info(`Processing ${pendingCount} job(s)...`);

      if (options.dryRun) {
        logger.info(chalk.yellow('Dry run mode - applications will not be submitted'));
      }
      logger.newline();

      // Process applications
      const results = [];
      while (applicationQueue.hasNext()) {
        const item = applicationQueue.getNext();
        if (!item) break;
        applicationQueue.updateStatus(item.id, 'processing');

        const result = await applicationOrchestrator.applyToJob(item.url, {
          dryRun: options.dryRun,
          profile,
          autoMode: options.auto,
          resumePath: resumeFilePath,
          coverLetterPath: coverLetterFilePath,
        });

        results.push(result);

        if (result.success) {
          applicationQueue.updateStatus(item.id, 'completed');
          applicationQueue.setResult(item.id, result.application);
          const outcome = result.application?.status === 'filled' ? 'Prepared' : 'Completed';
          logger.success(
            `${outcome}: ${result.application?.job_title} at ${result.application?.company}`
          );
        } else {
          applicationQueue.updateStatus(item.id, 'failed', result.error);
          logger.error(`Failed: ${result.error}`);
        }

        logger.newline();

        // Rate limit between applications
        if (applicationQueue.hasNext()) {
          const config = configRepository.loadAppConfig();
          const delay = config.application.rateLimitDelay ?? 0;
          if (delay > 0) {
            logger.info(chalk.dim(`Waiting ${delay}s before next application...`));
            logger.debug(`Rate limiting: sleeping ${delay}s between applications`);
            await Bun.sleep(delay * 1000);
          }
        }
      }

      // Clear the persisted queue on completion
      applicationQueue.clear();

      // Summary
      logger.header('Summary');
      const successful = results.filter((r) => r.success);
      const failed = results.filter((r) => !r.success);

      logger.keyValue('Total', results.length.toString());
      logger.keyValue('Successful', chalk.green(successful.length.toString()));
      logger.keyValue('Failed', failed.length > 0 ? chalk.red(failed.length.toString()) : '0');

      if (successful.length > 0) {
        logger.newline();
        console.log(chalk.bold('Processed:'));
        for (const result of successful) {
          const label =
            result.application?.status === 'filled'
              ? chalk.yellow('Prepared')
              : chalk.green('Completed');
          console.log(
            `  ${label} ${result.application?.job_title} at ${result.application?.company}`
          );
        }
      }

      if (failed.length > 0) {
        logger.newline();
        console.log(chalk.bold('Failed:'));
        for (const result of failed) {
          console.log(`  ${chalk.red('✖')} ${result.error}`);
        }
      }
    }
  );
