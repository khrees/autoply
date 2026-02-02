import { BaseScraper, type SubmissionOptions, type SubmissionResult } from './base';
import type { JobData, CustomQuestion, Platform } from '../types';
import { FormFiller } from '../core/form-filler';

export class GenericScraper extends BaseScraper {
  platform: Platform = 'generic';

  protected async waitForContent(): Promise<void> {
    if (!this.page) return;
    await this.page.waitForLoadState('networkidle');
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

      const cleaned = response.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
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

  override async submitApplication(url: string, options: SubmissionOptions): Promise<SubmissionResult> {
    const errors: string[] = [];

    try {
      await this.initialize();
      if (!this.page) throw new Error('Browser not initialized');

      await this.humanDelay();
      await this.page.goto(url, { waitUntil: 'networkidle' });
      await this.humanDelay(true);
      await this.humanScroll();

      // Try to find and click apply button
      await this.findAndClickApplyButton();
      await this.waitForApplicationForm();

      // Fill form
      const { profile } = options;
      const filler = new FormFiller(this.page, profile, options.jobData, {
        resumePath: options.resumePath,
        coverLetterPath: options.coverLetterPath,
        answeredQuestions: options.answeredQuestions,
        autoMode: options.autoMode,
      });

      // Extract form fields from the live form, fall back to pre-scraped data
      const liveFormFields = await this.extractFormFields();
      const formFields = liveFormFields.length > 0 ? liveFormFields : options.jobData.form_fields;
      const formResult = await filler.fillForm(formFields);
      errors.push(...formResult.errors);

      // Upload resume
      if (options.resumePath) {
        const fileInput = await this.page.$('input[type="file"]');
        if (fileInput) {
          await fileInput.setInputFiles(options.resumePath);
          await this.page.waitForTimeout(2000);
        }
      }

      // Custom questions
      if (options.answeredQuestions) {
        const result = await filler.fillCustomQuestions(options.answeredQuestions);
        errors.push(...result.errors);
      }

      await this.humanDelay(true);

      // Submit
      const submitted = await this.clickSubmitButton();
      if (!submitted) {
        return { success: false, message: 'Could not find submit button', errors };
      }

      await this.page.waitForTimeout(3000);

      // Screenshot
      const { configRepository } = await import('../db/repositories/config');
      const config = configRepository.loadAppConfig();
      let screenshotPath: string | undefined;
      if (config.application.saveScreenshots) {
        const { getAutoplyDir } = await import('../db');
        const { join } = await import('path');
        screenshotPath = join(getAutoplyDir(), 'screenshots', `generic_${Date.now()}.png`);
        await this.takeScreenshot(screenshotPath);
      }

      const confirmation = await this.waitForSubmissionConfirmation();
      return { success: confirmation.success, message: confirmation.message, screenshotPath, errors };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Unknown error');
      return { success: false, message: 'Generic submission failed', errors };
    } finally {
      await this.cleanup();
    }
  }

  private async findAndClickApplyButton(): Promise<void> {
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
        if (el && await el.isVisible()) {
          await this.humanDelay(true);
          await el.click();
          await this.page.waitForLoadState('networkidle');
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
    await this.page.waitForSelector('form, [class*="application"], [class*="apply"]', {
      timeout: 10000,
    }).catch(() => {});
    await this.humanDelay(true);
  }

  private async extractCustomQuestions(): Promise<CustomQuestion[]> {
    if (!this.page) return [];

    const questions: CustomQuestion[] = [];
    const questionContainers = await this.page.$$('[class*="question"], [class*="custom-field"], .field-group');

    for (let i = 0; i < questionContainers.length; i++) {
      const container = questionContainers[i];

      const questionText = await container.$eval(
        'label, .question-text, [class*="label"]',
        (el) => el.textContent?.trim() ?? ''
      ).catch(() => '');

      if (!questionText) continue;

      const hasTextarea = (await container.$('textarea')) !== null;
      const hasSelect = (await container.$('select')) !== null;
      const hasRadio = (await container.$('input[type="radio"]')) !== null;

      let type: CustomQuestion['type'] = 'text';
      let options: string[] | undefined;

      if (hasTextarea) {
        type = 'textarea';
      } else if (hasSelect) {
        type = 'select';
        options = await container.$$eval('select option', (opts) =>
          opts.map((o) => o.textContent?.trim() ?? '').filter(Boolean)
        );
      } else if (hasRadio) {
        type = 'radio';
      }

      const required = (await container.$('[required]')) !== null;

      questions.push({
        id: `generic_q_${i}`,
        question: questionText,
        type,
        required,
        options,
      });
    }

    return questions;
  }
}
