import { Command } from 'commander';
import { confirm } from '@inquirer/prompts';
import { profileRepository } from '../../db/repositories/profile';
import { configRepository } from '../../db/repositories/config';
import { promptForProfile, promptForPreferences } from '../prompts/profile';
import { logger } from '../../utils/logger';
import { DEFAULT_CONFIG } from '../../types';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { getDb, ensureAutoplyDir, getAutoplyDir, getDbPath } from '../../db';
import { existsSync } from 'fs';
import { join } from 'path';
import { extractTextFromFile } from '../../utils/document-extractor';
import { extractProfileFromResume } from '../../ai/profile-extractor';
import { createAIProvider } from '../../ai/provider';

export const initCommand = new Command('init')
  .description('Initialize Autoply with your profile')
  .option('--resume <path>', 'Path to resume file (PDF, MD, or TXT)')
  .option('--cover-letter <path>', 'Path to cover letter file (PDF, MD, or TXT)')
  .action(async (options: { resume?: string; coverLetter?: string }) => {
    try {
      // Ensure directories exist
      ensureAutoplyDir();

      // Initialize database
      getDb();

      // Check if profile already exists
      const existingProfile = profileRepository.findFirst();
      if (existingProfile) {
        logger.warning('A profile already exists. Use "autoply profile edit" to modify it.');
        logger.info(`Current profile: ${existingProfile.name} <${existingProfile.email}>`);
        return;
      }

      // Extract documents from file flags if provided
      let resumeText: string | undefined;
      let coverLetterText: string | undefined;

      if (options.resume) {
        const result = await extractTextFromFile(options.resume);
        if (!result.success) {
          logger.error(`Resume: ${result.error}`);
          process.exit(1);
        }
        resumeText = result.content;
        logger.success(`Loaded resume from ${options.resume}`);
      }

      if (options.coverLetter) {
        const result = await extractTextFromFile(options.coverLetter);
        if (!result.success) {
          logger.error(`Cover letter: ${result.error}`);
          process.exit(1);
        }
        coverLetterText = result.content;
        logger.success(`Loaded cover letter from ${options.coverLetter}`);
      }

      // Try AI extraction if resume is provided
      let aiExtractedProfile: Awaited<ReturnType<typeof extractProfileFromResume>> | null = null;

      if (resumeText) {
        try {
          const config = configRepository.loadAppConfig();
          const provider = createAIProvider(config.ai);

          if (await provider.isAvailable()) {
            logger.info('Extracting profile from resume with AI...');
            aiExtractedProfile = await extractProfileFromResume(provider, resumeText);

            logger.newline();
            logger.success('Profile extracted!');
            logger.keyValue('Name', aiExtractedProfile.name);
            logger.keyValue('Email', aiExtractedProfile.email);
            if (aiExtractedProfile.phone) logger.keyValue('Phone', aiExtractedProfile.phone);
            if (aiExtractedProfile.location)
              logger.keyValue('Location', aiExtractedProfile.location);
            logger.keyValue(
              'Skills',
              aiExtractedProfile.skills.slice(0, 5).join(', ') +
                (aiExtractedProfile.skills.length > 5 ? '...' : '')
            );
            logger.keyValue('Experience', `${aiExtractedProfile.experience.length} entries`);
            logger.keyValue('Education', `${aiExtractedProfile.education.length} entries`);
            logger.newline();

            const useExtracted = await confirm({
              message: 'Does this look correct?',
              default: true,
            });
            if (useExtracted) {
              const preferences = await promptForPreferences();
              const profileData = {
                ...aiExtractedProfile,
                preferences,
                base_resume: resumeText,
                base_cover_letter: coverLetterText ?? '',
              };

              const profile = profileRepository.create(profileData);
              // Only initialize config if no config file exists yet
              const configPath = join(getAutoplyDir(), 'config.json');
              if (!existsSync(configPath)) {
                configRepository.saveAppConfig(DEFAULT_CONFIG);
              }

              logger.newline();
              logger.success('Profile created successfully!');
              logger.newline();
              logger.keyValue('Name', profile.name);
              logger.keyValue('Email', profile.email);
              logger.keyValue('Skills', profile.skills.join(', ') || 'None');
              logger.keyValue('Education', `${profile.education.length} entries`);
              logger.newline();
              logger.info(`Data stored in: ${getAutoplyDir()}`);
              logger.newline();
              logger.info('Next steps:');
              logger.info('  1. Configure AI provider: autoply config set ai.provider ollama');
              logger.info('  2. Apply to a job: autoply apply <job-url>');
              return;
            }
          } else {
            logger.warning(
              'AI provider not configured. Set up with: autoply config set ai.provider ollama'
            );
            logger.info('Continuing with manual setup...');
          }
        } catch (error) {
          logger.warning(
            `AI extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}. Using manual setup.`
          );
        }
      }

      // Prompt for profile information
      const profileData = await promptForProfile({
        resumeText,
        coverLetterText,
        aiDefaults: aiExtractedProfile ?? undefined,
      });

      // Create profile
      const profile = profileRepository.create(profileData);

      // Only initialize config if no config file exists yet
      const configPath = join(getAutoplyDir(), 'config.json');
      if (!existsSync(configPath)) {
        configRepository.saveAppConfig(DEFAULT_CONFIG);
      }

      logger.newline();
      logger.success('Profile created successfully!');
      logger.newline();
      logger.keyValue('Name', profile.name);
      logger.keyValue('Email', profile.email);
      logger.keyValue('Skills', profile.skills.join(', ') || 'None');
      logger.keyValue('Education', `${profile.education.length} entries`);
      logger.newline();
      logger.info(`Data stored in: ${getAutoplyDir()}`);
      logger.newline();
      logger.info('Next steps:');
      logger.info('  1. Configure AI provider: autoply config set ai.provider ollama');
      logger.info('  2. Apply to a job: autoply apply <job-url>');
    } catch (error) {
      if (error instanceof Error && error.message.includes('ExitPromptError')) {
        logger.info('Setup cancelled.');
        return;
      }
      logger.error(
        `Initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      process.exit(1);
    }
  });
