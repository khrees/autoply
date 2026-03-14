import { BaseScraper } from './base';
import type { JobData, CustomQuestion, Platform } from '../types';

export class JobviteScraper extends BaseScraper {
  platform: Platform = 'jobvite';

  protected async waitForContent(): Promise<void> {
    if (!this.page) return;
    await this.page.waitForSelector('.jv-page-body, .jv-job-detail', {
      timeout: 10000,
    }).catch(() => {});
  }

  protected override async navigateToApplicationForm(): Promise<void> {
    if (!this.page) return;

    const selectors = ['.jv-apply-button', 'a:has-text("Apply")', 'button:has-text("Apply")'];

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

    await this.page.waitForSelector('form, .jv-application-form', { timeout: 10000 }).catch(() => {});
    await this.humanDelay(true);
  }

  protected async extractJobData(url: string): Promise<JobData> {
    if (!this.page) throw new Error('Page not initialized');

    // Extract job title
    const title = await this.extractText('.jv-header h1, .jv-job-detail-name, h1.job-title');

    // Extract company
    let company = await this.extractText('.jv-company-name, .company-name');
    if (!company) {
      const urlMatch = url.match(/jobs\.jobvite\.com\/([^/]+)/);
      company = urlMatch ? urlMatch[1].replace(/-/g, ' ') : 'Unknown Company';
    }

    // Extract location
    const location = await this.extractText('.jv-job-detail-location, .job-location');

    // Extract description
    const description = await this.extractText('.jv-job-detail-description, .job-description');

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
      company: company.trim(),
      description: description.trim(),
      requirements,
      qualifications,
      location: location.trim() || undefined,
      form_fields: formFields,
      custom_questions: customQuestions,
    };
  }

  private async extractCustomQuestions(): Promise<CustomQuestion[]> {
    if (!this.page) return [];

    const { extractCustomQuestionsFromContainers } = await import('./helpers');
    const questionContainers = await this.page.$$('.jv-question, [class*="custom-question"]');
    
    return extractCustomQuestionsFromContainers(this.page, questionContainers, 'jobvite');
  }
}
