import { BaseScraper } from './base';
import type { JobData, CustomQuestion, Platform } from '../types';
import { logger } from '../utils/logger';

export class TeamtailorScraper extends BaseScraper {
  platform: Platform = 'teamtailor';

  protected async waitForContent(): Promise<void> {
    if (!this.page) return;
    await this.page
      .waitForSelector('.job-ad, .careersite-job, [class*="job-page"]', {
        timeout: 10000,
      })
      .catch(() => {});
  }

  protected override async navigateToApplicationForm(): Promise<void> {
    if (!this.page) return;

    const selectors = [
      'a:has-text("Apply")',
      'button:has-text("Apply")',
      '[class*="apply-button"]',
      '.apply-btn',
    ];

    for (const selector of selectors) {
      const button = await this.page.$(selector);
      if (button) {
        await this.humanDelay(true);
        await button.click();
        await this.page.waitForLoadState('domcontentloaded');
        return;
      }
    }
  }

  protected override async waitForApplicationForm(): Promise<void> {
    if (!this.page) return;

    await this.page.waitForSelector('form, .application-form', { timeout: 10000 }).catch(() => {
      logger.debug(
        'Teamtailor application form not found within timeout — proceeding anyway',
        {},
        'scraper'
      );
    });
    await this.humanDelay(true);
  }

  protected async extractJobData(url: string): Promise<JobData> {
    if (!this.page) throw new Error('Page not initialized');

    // Extract job title
    const title = await this.extractText(
      'h1[class*="title"], .job-header h1, .careersite-job__title'
    );

    // Extract company from URL
    const urlMatch = url.match(/([^.]+)\.teamtailor\.com/);
    const company = urlMatch ? urlMatch[1].replace(/-/g, ' ') : 'Unknown Company';

    // Extract location
    const location = await this.extractText(
      '[class*="location"], .job-header__location, .careersite-job__location'
    );

    // Extract job type
    const jobType = await this.extractText(
      '[class*="employment-type"], .job-header__employment-type'
    );

    // Extract description
    const descriptionParts = await this.extractAllText(
      '.job-ad__content, .careersite-job__content, [class*="job-description"]'
    );
    const description = descriptionParts.join('\n\n');

    // Check remote
    const remote =
      location.toLowerCase().includes('remote') || jobType.toLowerCase().includes('remote');

    // Extract form fields
    const formFields = await this.extractFormFields();

    // Extract custom questions
    const customQuestions = await this.extractCustomQuestions();

    // Parse requirements
    const requirements = this.extractRequirements(description);
    const qualifications = this.extractQualifications(description);

    return {
      url,
      platform: this.platform,
      title: title.trim() || 'Unknown Position',
      company: this.capitalizeWords(company),
      description: description.trim(),
      requirements,
      qualifications,
      location: location.trim() || undefined,
      job_type: jobType.trim() || undefined,
      remote,
      form_fields: formFields,
      custom_questions: customQuestions,
    };
  }

  private capitalizeWords(str: string): string {
    return str
      .split(' ')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  private async extractCustomQuestions(): Promise<CustomQuestion[]> {
    if (!this.page) return [];

    const { extractCustomQuestionsFromContainers } = await import('./helpers');
    const questionContainers = await this.page.$$(
      '.application-form__question, [class*="custom-question"], [class*="form-group"]'
    );

    return extractCustomQuestionsFromContainers(this.page, questionContainers, 'teamtailor');
  }
}
