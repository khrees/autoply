import { BaseScraper } from './base';
import type { JobData, CustomQuestion, Platform } from '../types';

export class GenericScraper extends BaseScraper {
  platform: Platform = 'generic';

  protected async waitForContent(): Promise<void> {
    if (!this.page) return;
    await this.page.waitForLoadState('domcontentloaded');
  }

  protected async extractJobData(url: string): Promise<JobData> {
    if (!this.page) throw new Error('Page not initialized');

    const pageText = await this.page.evaluate(() => document.body.innerText);
    const pageTitle = await this.page.title();

    let title = pageTitle || 'Unknown Position';
    let company = new URL(url).hostname.replace(/^www\./, '');
    let description = pageText.slice(0, 4000);
    let requirements: string[] = [];
    let qualifications: string[] = [];
    let location: string | undefined;

    // Try AI extraction
    try {
      const { createAIProvider } = await import('../ai/provider');
      const { configRepository } = await import('../db/repositories/config');
      const config = configRepository.loadAppConfig();
      const aiProvider = createAIProvider(config.ai);

      const response = await aiProvider.generateText(
        `Extract job posting data from this page content. Return ONLY valid JSON with these fields:
{"title": "...", "company": "...", "description": "...", "requirements": ["..."], "qualifications": ["..."], "location": "..."}

Page title: ${pageTitle}
Page content (truncated):
${pageText.slice(0, 6000)}`,
        'You extract structured job data from web pages. Return valid JSON only, no markdown fences.'
      );

      const cleaned = response
        .replace(/```json?\n?/g, '')
        .replace(/```/g, '')
        .trim();
      const parsed = JSON.parse(cleaned);

      title = parsed.title || title;
      company = parsed.company || company;
      description = parsed.description || description;
      requirements = parsed.requirements || [];
      qualifications = parsed.qualifications || [];
      location = parsed.location;
    } catch {
      // Fall back to basic extraction
      const h1Text = await this.extractText('h1');
      if (h1Text) title = h1Text;
      requirements = this.extractRequirements(description);
      qualifications = this.extractQualifications(description);
    }

    const formFields = await this.extractFormFields();
    const customQuestions = await this.extractCustomQuestions();

    return {
      url,
      platform: this.platform,
      title: title.trim(),
      company: company.trim(),
      description: description.trim(),
      requirements,
      qualifications,
      location,
      form_fields: formFields,
      custom_questions: customQuestions,
    };
  }

  protected override async navigateToApplicationForm(): Promise<void> {
    if (!this.page) return;

    const selectors = [
      'a:has-text("Apply")',
      'button:has-text("Apply")',
      '[class*="apply"]',
      'a[href*="apply"]',
      'button:has-text("Submit Application")',
      'a:has-text("Submit Application")',
    ];

    for (const selector of selectors) {
      try {
        const el = await this.page.$(selector);
        if (el && (await el.isVisible())) {
          await this.humanDelay(true);
          await el.click();
          await this.page.waitForLoadState('domcontentloaded');
          return;
        }
      } catch {
        continue;
      }
    }

    // No apply button found - assume we're already on the form page
  }

  protected override async waitForApplicationForm(): Promise<void> {
    if (!this.page) return;
    await this.page
      .waitForSelector('form, [class*="application"], [class*="apply"]', {
        timeout: 10000,
      })
      .catch(() => {});
    await this.humanDelay(true);
  }

  private async extractCustomQuestions(): Promise<CustomQuestion[]> {
    if (!this.page) return [];

    const { extractCustomQuestionsFromContainers } = await import('./helpers');
    const questionContainers = await this.page.$$(
      '[class*="question"], [class*="custom-field"], .field-group'
    );

    return extractCustomQuestionsFromContainers(this.page, questionContainers, 'generic');
  }
}
