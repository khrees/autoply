import { Command } from 'commander';
import { profileRepository } from '../../db/repositories/profile';
import { promptForProfileUpdate } from '../prompts/profile';
import { logger, chalk } from '../../utils/logger';

export const profileCommand = new Command('profile').description('Manage your profile');

profileCommand
  .command('show')
  .description('Display your profile')
  .action(() => {
    const profile = profileRepository.findFirst();
    if (!profile) {
      logger.error('No profile found. Run "autoply init" to create one.');
      process.exit(1);
    }

    logger.header('Your Profile');

    logger.keyValue('Name', profile.name);
    logger.keyValue('Email', profile.email);
    if (profile.phone) logger.keyValue('Phone', profile.phone);
    if (profile.location) logger.keyValue('Location', profile.location);
    if (profile.linkedin_url) logger.keyValue('LinkedIn', profile.linkedin_url);
    if (profile.github_url) logger.keyValue('GitHub', profile.github_url);
    if (profile.portfolio_url) logger.keyValue('Portfolio', profile.portfolio_url);

    logger.newline();
    logger.keyValue('Skills', profile.skills.join(', ') || 'None');

    if (profile.experience.length > 0) {
      logger.newline();
      console.log(chalk.bold('Experience:'));
      for (const exp of profile.experience) {
        console.log(`  ${chalk.cyan(exp.title)} at ${exp.company}`);
        console.log(`    ${exp.start_date} - ${exp.end_date ?? 'Present'}`);
        if (exp.highlights.length > 0) {
          for (const highlight of exp.highlights.slice(0, 2)) {
            console.log(`    • ${highlight}`);
          }
        }
      }
    }

    if (profile.education.length > 0) {
      logger.newline();
      console.log(chalk.bold('Education:'));
      for (const edu of profile.education) {
        console.log(`  ${chalk.cyan(edu.degree)}${edu.field ? ` in ${edu.field}` : ''}`);
        console.log(`    ${edu.institution}`);
      }
    }

    if (profile.preferences) {
      logger.newline();
      console.log(chalk.bold('Preferences:'));
      logger.keyValue('  Remote only', profile.preferences.remote_only ? 'Yes' : 'No');
      if (profile.preferences.min_salary) {
        logger.keyValue('  Min salary', `$${profile.preferences.min_salary.toLocaleString()}`);
      }
      if (profile.preferences.job_types.length > 0) {
        logger.keyValue('  Job types', profile.preferences.job_types.join(', '));
      }
    }

    logger.newline();
  });

profileCommand
  .command('edit')
  .description('Edit your profile')
  .action(async () => {
    const profile = profileRepository.findFirst();
    if (!profile) {
      logger.error('No profile found. Run "autoply init" to create one.');
      process.exit(1);
    }

    try {
      const updates = await promptForProfileUpdate(profile);
      if (profile.id !== undefined) {
        profileRepository.update(profile.id, updates);
        logger.success('Profile updated successfully!');
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('ExitPromptError')) {
        logger.info('Edit cancelled.');
        return;
      }
      logger.error(
        `Failed to update profile: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  });

profileCommand
  .command('delete')
  .description('Delete your profile')
  .action(async () => {
    const profile = profileRepository.findFirst();
    if (!profile) {
      logger.error('No profile found.');
      return;
    }

    const { confirm } = await import('@inquirer/prompts');
    const confirmed = await confirm({
      message: `Are you sure you want to delete your profile (${profile.name})?`,
      default: false,
    });

    if (confirmed) {
      if (profile.id !== undefined) {
        profileRepository.delete(profile.id);
      }
      logger.success('Profile deleted.');
    } else {
      logger.info('Deletion cancelled.');
    }
  });

profileCommand
  .command('import <file>')
  .description('Import profile from a resume file (PDF/text/markdown)')
  .action(async (file: string) => {
    const { extractTextFromFile } = await import('../../utils/document-extractor');
    const { extractProfileFromResume } = await import('../../ai/profile-extractor');
    const { createAIProvider } = await import('../../ai/provider');
    const ora = (await import('ora')).default;

    const extractSpinner = ora(`Reading document "${file}"...`).start();
    const result = await extractTextFromFile(file);

    if (!result.success || !result.content) {
      extractSpinner.fail(result.error || 'Failed to read file');
      process.exit(1);
    }
    extractSpinner.succeed('Document text extracted successfully.');

    const aiSpinner = ora('Parsing profile with AI...').start();
    try {
      const provider = createAIProvider();
      const extracted = await extractProfileFromResume(provider, result.content);
      aiSpinner.succeed('Profile parsed successfully!');

      const existingProfile = profileRepository.findFirst();
      if (existingProfile && existingProfile.id !== undefined) {
        profileRepository.update(existingProfile.id, {
          ...extracted,
          base_resume: result.content,
        });
        logger.success('Profile updated with extracted resume data.');
      } else {
        profileRepository.create({
          ...extracted,
          base_resume: result.content,
        });
        logger.success('New profile created from resume.');
      }
    } catch (error) {
      aiSpinner.fail();
      logger.error(
        `Failed to parse resume: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      process.exit(1);
    }
  });

profileCommand
  .command('sync-linkedin [url]')
  .description('Sync experience, education, and skills from a LinkedIn profile URL')
  .action(async (url?: string) => {
    const existingProfile = profileRepository.findFirst();
    const targetUrl = url || existingProfile?.linkedin_url;

    if (!targetUrl) {
      logger.error('No LinkedIn URL provided and none set in profile.');
      logger.info('Usage: autoply profile sync-linkedin https://linkedin.com/in/username');
      process.exit(1);
    }

    const ora = (await import('ora')).default;
    const spinner = ora(`Fetching LinkedIn profile from ${targetUrl}...`).start();

    try {
      const { scrapeLinkedInProfile } = await import('../../scrapers/linkedin-profile');
      const linkedinData = await scrapeLinkedInProfile(targetUrl);
      spinner.succeed('LinkedIn profile data extracted!');

      const expUpdates = linkedinData.experience.map((e) => ({
        title: e.title,
        company: e.company,
        location: e.location,
        start_date: e.startDate || '',
        end_date: e.endDate,
        description: e.description,
        highlights: [],
      }));

      const eduUpdates = linkedinData.education.map((e) => ({
        institution: e.institution,
        degree: e.degree || 'Degree',
        field: e.field,
        start_date: e.startDate,
        end_date: e.endDate,
      }));

      const mergedSkills = Array.from(
        new Set([...(existingProfile?.skills || []), ...linkedinData.skills])
      );

      const updates = {
        linkedin_url: targetUrl,
        location: linkedinData.location || existingProfile?.location,
        skills: mergedSkills,
        experience: expUpdates.length > 0 ? expUpdates : existingProfile?.experience || [],
        education: eduUpdates.length > 0 ? eduUpdates : existingProfile?.education || [],
      };

      if (existingProfile && existingProfile.id !== undefined) {
        profileRepository.update(existingProfile.id, updates);
        logger.success('Profile synced with LinkedIn data.');
      } else {
        logger.error('Please create a base profile first with "autoply init".');
      }
    } catch (error) {
      spinner.fail();
      logger.error(
        `LinkedIn sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      process.exit(1);
    }
  });
