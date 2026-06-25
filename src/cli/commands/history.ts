import { Command } from 'commander';
import { applicationRepository } from '../../db/repositories/application';
import { logger, chalk } from '../../utils/logger';
import type { ApplicationStatus } from '../../types';

const VALID_STATUSES: ApplicationStatus[] = ['pending', 'filled', 'submitted', 'failed'];

export const historyCommand = new Command('history')
  .description('View application history')
  .option('-s, --status <status>', 'Filter by status (pending, filled, submitted, failed)')
  .option('-c, --company <name>', 'Filter by company name')
  .option('-l, --limit <number>', 'Limit number of results', '20')
  .action((options: { status?: string; company?: string; limit: string }) => {
    const filters: { status?: ApplicationStatus; company?: string } = {};

    if (options.status) {
      if (!VALID_STATUSES.includes(options.status as ApplicationStatus)) {
        logger.error(`Invalid status. Use: ${VALID_STATUSES.join(', ')}`);
        process.exit(1);
      }
      filters.status = options.status as ApplicationStatus;
    }

    if (options.company) {
      filters.company = options.company;
    }

    const applications = applicationRepository.findAll(filters);
    const limit = parseInt(options.limit, 10);
    const limited = applications.slice(0, limit);

    if (applications.length === 0) {
      logger.info('No applications found.');
      if (filters.status || filters.company) {
        logger.info('Try removing filters to see all applications.');
      }
      return;
    }

    logger.header('Application History');

    for (const app of limited) {
      const statusColor =
        app.status === 'submitted'
          ? chalk.green
          : app.status === 'failed'
            ? chalk.red
            : app.status === 'filled'
              ? chalk.cyan
              : chalk.yellow;

      console.log(`${chalk.bold(app.job_title)} at ${chalk.cyan(app.company)}`);
      console.log(`  Status: ${statusColor(app.status)}`);
      console.log(`  Platform: ${app.platform}`);
      console.log(`  URL: ${chalk.dim(app.url)}`);
      if (app.applied_at) {
        console.log(`  Applied: ${new Date(app.applied_at).toLocaleDateString()}`);
      }
      if (app.error_message) {
        console.log(`  Error: ${chalk.red(app.error_message)}`);
      }
      console.log();
    }

    if (applications.length > limit) {
      logger.info(
        `Showing ${limit} of ${applications.length} applications. Use --limit to see more.`
      );
    }

    // Summary stats
    const stats = {
      total: applications.length,
      submitted: applications.filter((a) => a.status === 'submitted').length,
      pending: applications.filter((a) => a.status === 'pending').length,
      filled: applications.filter((a) => a.status === 'filled').length,
      failed: applications.filter((a) => a.status === 'failed').length,
    };

    logger.newline();
    console.log(chalk.bold('Statistics:'));
    logger.keyValue('  Total', stats.total.toString());
    logger.keyValue('  Submitted', chalk.green(stats.submitted.toString()));
    logger.keyValue('  Pending', chalk.yellow(stats.pending.toString()));
    logger.keyValue('  Filled', chalk.cyan(stats.filled.toString()));
    logger.keyValue('  Failed', chalk.red(stats.failed.toString()));
  });

historyCommand
  .command('clear')
  .description('Clear application history')
  .option('-s, --status <status>', 'Only clear applications with specific status')
  .action(async (options: { status?: string }) => {
    const { confirm } = await import('@inquirer/prompts');

    if (options.status && !VALID_STATUSES.includes(options.status as ApplicationStatus)) {
      logger.error(`Invalid status. Use: ${VALID_STATUSES.join(', ')}`);
      process.exit(1);
    }

    const applications = applicationRepository.findAll(
      options.status ? { status: options.status as ApplicationStatus } : undefined
    );

    if (applications.length === 0) {
      logger.info('No applications to clear.');
      return;
    }

    const message = options.status
      ? `Clear ${applications.length} ${options.status} application(s)?`
      : `Clear all ${applications.length} application(s)?`;

    const confirmed = await confirm({
      message,
      default: false,
    });

    if (confirmed) {
      for (const app of applications) {
        if (app.id) {
          applicationRepository.delete(app.id);
        }
      }
      logger.success(`Cleared ${applications.length} application(s).`);
    } else {
      logger.info('Cancelled.');
    }
  });

historyCommand
  .command('cleanup')
  .description('Mark (or delete) pending applications older than N hours')
  .option('-h, --hours <hours>', 'Hours after which to consider stale', '24')
  .option('-d, --delete', 'Permanently delete stale records instead of marking as failed')
  .action(async (options: { hours: string; delete?: boolean }) => {
    const hours = parseInt(options.hours, 10);
    if (isNaN(hours) || hours < 1) {
      logger.error('Hours must be a positive number');
      process.exit(1);
    }

    if (options.delete) {
      const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
      const stale = applicationRepository
        .findAll({ status: 'pending' })
        .filter((a) => !!a.created_at && a.created_at < cutoff);
      if (stale.length === 0) {
        logger.info('No stale applications to delete.');
        return;
      }
      const { confirm } = await import('@inquirer/prompts');
      const confirmed = await confirm({
        message: `Permanently delete ${stale.length} stale application(s)?`,
        default: false,
      });
      if (!confirmed) {
        logger.info('Cancelled.');
        return;
      }
      for (const app of stale) {
        if (app.id) applicationRepository.delete(app.id);
      }
      logger.success(`Deleted ${stale.length} stale application(s).`);
    } else {
      const count = applicationRepository.markStaleAsFailed(hours);
      if (count > 0) {
        logger.success(`Marked ${count} stale application(s) as failed.`);
      } else {
        logger.info('No stale applications found.');
      }
    }
  });

historyCommand
  .command('show <id>')
  .description('Show details of a specific application')
  .action((id: string) => {
    const app = applicationRepository.findById(parseInt(id, 10));

    if (!app) {
      logger.error(`Application #${id} not found.`);
      process.exit(1);
    }

    logger.header(`Application #${app.id}`);

    logger.keyValue('Job Title', app.job_title);
    logger.keyValue('Company', app.company);
    logger.keyValue('Platform', app.platform);
    logger.keyValue('URL', app.url);
    logger.keyValue('Status', app.status);

    if (app.applied_at) {
      logger.keyValue('Applied At', new Date(app.applied_at).toLocaleString());
    }

    if (app.error_message) {
      logger.newline();
      console.log(chalk.bold('Error:'));
      console.log(chalk.red(app.error_message));
    }

    if (app.generated_resume) {
      logger.newline();
      console.log(chalk.bold('Generated Resume:'));
      console.log(chalk.dim('─'.repeat(50)));
      console.log(app.generated_resume.slice(0, 1000));
      if (app.generated_resume.length > 1000) {
        console.log(chalk.dim(`... (${app.generated_resume.length - 1000} more characters)`));
      }
    }

    if (app.generated_cover_letter) {
      logger.newline();
      console.log(chalk.bold('Generated Cover Letter:'));
      console.log(chalk.dim('─'.repeat(50)));
      console.log(app.generated_cover_letter.slice(0, 1000));
      if (app.generated_cover_letter.length > 1000) {
        console.log(chalk.dim(`... (${app.generated_cover_letter.length - 1000} more characters)`));
      }
    }
  });
