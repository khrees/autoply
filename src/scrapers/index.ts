import type { Platform, JobData } from '../types';
import { BaseScraper } from './base';
import { GreenhouseScraper } from './greenhouse';
import { LeverScraper } from './lever';
import { LinkedInScraper } from './linkedin';
import { AshbyScraper } from './ashby';
import { GenericScraper } from './generic';

const scraperMap: Record<Platform, new () => BaseScraper> = {
  greenhouse: GreenhouseScraper,
  lever: LeverScraper,
  linkedin: LinkedInScraper,
  ashby: AshbyScraper,
  generic: GenericScraper,
};

export function createScraper(platform: Platform): BaseScraper {
  const ScraperClass = scraperMap[platform];
  if (!ScraperClass) {
    throw new Error(`No scraper available for platform: ${platform}`);
  }
  return new ScraperClass();
}

export async function scrapeJob(url: string, platform: Platform): Promise<JobData> {
  const scraper = createScraper(platform);
  return scraper.scrape(url);
}

export {
  BaseScraper,
  GreenhouseScraper,
  LeverScraper,
  LinkedInScraper,
  AshbyScraper,
  GenericScraper,
};

export type { SubmissionResult, SubmissionOptions, FillApplicationResult } from './base';
