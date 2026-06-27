import { BaseScraper, type SubmissionOptions } from './base';
import type { JobData, CustomQuestion, Platform } from '../types';

export class SmartRecruitersScraper extends BaseScraper {
  platform: Platform = 'smartrecruiters';

  protected async waitForContent(): Promise<void> {
    if (!this.page) return;
    await this.page
      .waitForSelector('.job-sections, .job-ad-container', {
        timeout: 10000,
      })
      .catch(() => {});
  }

  protected override async navigateToApplicationForm(): Promise<void> {
    if (!this.page) return;

    const selectors = ['a.apply-button', 'button:has-text("Apply")', 'a:has-text("Apply now")'];

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

    await this.page.waitForSelector('form, .application-form', { timeout: 10000 }).catch(() => {});
    await this.humanDelay(true);
  }

  protected override async postFormFill(options: SubmissionOptions): Promise<void> {
    if (!this.page) return;

    const { profile } = options;

    // Extract form fields from the live application form and fill via FormFiller
    const liveFormFields = await this.extractFormFields();
    if (liveFormFields.length === 0) {
      // Fallback: fill basic fields manually if extraction found nothing
      await this.fillInput('input[name*="firstName"]', profile.name.split(' ')[0]);
      await this.fillInput('input[name*="lastName"]', profile.name.split(' ').slice(1).join(' '));
      await this.fillInput('input[name*="email"], input[type="email"]', profile.email);
      if (profile.phone) {
        await this.fillInput('input[name*="phone"], input[type="tel"]', profile.phone);
      }
    }
  }

  private async fillInput(selector: string, value: string): Promise<boolean> {
    if (!this.page || !value) return false;
    try {
      const input = await this.page.$(selector);
      if (input) {
        await input.fill(value);
        await this.humanDelay(true);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  protected async extractJobData(url: string): Promise<JobData> {
    if (!this.page) throw new Error('Page not initialized');

    // Extract job title
    const title = await this.extractText('h1.job-title, .job-details h1, h1[class*="title"]');

    // Extract company
    let company = await this.extractText('.company-name, h2[class*="company"]');
    if (!company) {
      const urlMatch = url.match(/jobs\.smartrecruiters\.com\/([^/]+)/);
      company = urlMatch ? urlMatch[1].replace(/-/g, ' ') : 'Unknown Company';
    }

    // Extract location
    const location = await this.extractText('.job-location, [class*="location"]');

    // Extract description
    const descriptionParts = await this.extractAllText(
      '.job-sections .job-section, .job-description, [class*="description"]'
    );
    const description = descriptionParts.join('\n\n');

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
    const questionContainers = await this.page.$$(
      '.question-container, [class*="application-question"]'
    );

    return extractCustomQuestionsFromContainers(this.page, questionContainers, 'sr');
  }
}
