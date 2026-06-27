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
  .description('Import profile from a resume file (PDF/text)')
  .action(async (_file: string) => {
    logger.warning('Resume import feature is not yet implemented.');
    logger.info('Please use "autoply init" to create your profile manually.');
  });
