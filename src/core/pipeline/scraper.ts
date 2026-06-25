import type { Platform, JobData } from '../../types';
import { parseJobUrl } from '../../utils/url-parser';
import { scrapeJob } from '../../scrapers';
import { validateJobData } from '../../utils/validation';
import { scraperRateLimiter, withRateLimit } from '../../utils/rate-limiter';

export type ScrapeResult =
  | { success: true; jobData: JobData; platform: Platform }
  | { success: false; error: string };

/**
 * Pipeline step 1: Scrape job data from a URL.
 */
export async function scrapeJobForApplication(url: string): Promise<ScrapeResult> {
  const parsedUrl = parseJobUrl(url);
  if (!parsedUrl.isValid) {
    return { success: false, error: parsedUrl.error ?? 'Invalid URL' };
  }

  try {
    const jobData = await withRateLimit(scraperRateLimiter, () =>
      scrapeJob(url, parsedUrl.platform)
    );

    // Validate scraped job data against schema
    const jobValidation = validateJobData(jobData);
    if (!jobValidation.success) {
      const { logger } = await import('../../utils/logger');
      logger.warn('Scraped job data has issues', { errors: jobValidation.errors }, 'scraper');
    }

    return { success: true, jobData, platform: parsedUrl.platform };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      error: `[${parsedUrl.platform}] Scraping failed for ${url}: ${msg}. Check that the URL is accessible in a browser.`,
    };
  }
}
