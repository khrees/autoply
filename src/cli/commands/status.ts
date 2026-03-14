import { Command } from 'commander';
import { applicationRepository } from '../../db/repositories/application';
import { normalizeUrl, parseJobUrl } from '../../utils/url-parser';
import { logger, chalk } from '../../utils/logger';

/**
 * Command to check application status for a specific URL
 */
export const statusCommand = new Command('status')
  .description('Check if you have already applied to a job')
  .argument('<url>', 'Job URL to check')
  .action(async (url: string) => {
    // Validate URL
    const parsedUrl = parseJobUrl(url);
    if (!parsedUrl.isValid) {
      logger.error(parsedUrl.error || 'Invalid URL');
      process.exit(1);
    }

    // Look up existing applications for this URL
    const normalizedUrl = normalizeUrl(url);
    const applications = Array.from(
      new Map(
        [...applicationRepository.findByUrl(url), ...applicationRepository.findByUrl(normalizedUrl)].map((app) => [
          app.id,
          app,
        ])
      ).values()
    );

    if (applications.length === 0) {
      logger.info('No application found for this URL.');
      logger.info(`Platform: ${parsedUrl.platform}`);
      logger.info('You have not applied to this job yet.');
      return;
    }

    // Show application details
    logger.header('Application Found');

    for (const app of applications) {
      logger.newline();
      logger.keyValue('Job Title', app.job_title);
      logger.keyValue('Company', app.company);
      logger.keyValue('Platform', app.platform);
      logger.keyValue('Status', formatStatus(app.status));
      logger.keyValue('Created', formatDate(app.created_at));

      if (app.applied_at) {
        logger.keyValue('Applied', formatDate(app.applied_at));
      }

      if (app.error_message) {
        logger.keyValue('Error', chalk.red(app.error_message));
      }
    }

    logger.newline();
    logger.info(
      `Found ${applications.length} application(s) for this URL.`
    );
  });

/**
 * Format application status with color
 */
function formatStatus(status: string): string {
  switch (status) {
    case 'submitted':
      return chalk.green('Submitted');
    case 'pending':
      return chalk.yellow('Pending');
    case 'filled':
      return chalk.cyan('Filled');
    case 'failed':
      return chalk.red('Failed');
    default:
      return status;
  }
}

/**
 * Format date string for display
 */
function formatDate(dateStr?: string): string {
  if (!dateStr) return 'N/A';

  try {
    const date = new Date(dateStr);
    return date.toLocaleString();
  } catch {
    return dateStr;
  }
}
