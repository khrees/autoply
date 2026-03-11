import { BaseScraper, type SubmissionOptions, type SubmissionResult } from './base';
import type { JobData, CustomQuestion, Platform } from '../types';
import { FormFiller } from '../core/form-filler';

export class SmartRecruitersScraper extends BaseScraper {
  platform: Platform = 'smartrecruiters';

  protected async waitForContent(): Promise<void> {
    if (!this.page) return;
    await this.page.waitForSelector('.job-sections, .job-ad-container', {
      timeout: 10000,
    }).catch(() => { });
  }

  // ============ SmartRecruiters Form Submission ============

  override async submitApplication(url: string, options: SubmissionOptions): Promise<SubmissionResult> {
    const errors: string[] = [];

    try {
      await this.initialize();
      if (!this.page) throw new Error('Browser not initialized');

      await this.humanDelay();
      await this.page.goto(url, { waitUntil: 'domcontentloaded' });
      await this.humanDelay(true);
      await this.humanScroll();

      // Navigate to application
      await this.navigateToApplication();
      await this.waitForApplicationForm();

      // Fill form
      await this.fillSmartRecruitersForm(options, errors);

      // Submit
      const submitted = await this.clickSubmit();
      if (!submitted) {
        return { success: false, message: 'Could not find submit button', errors };
      }

      // Wait for confirmation
      const confirmation = await this.waitForConfirmation();

      // Screenshot
      const { configRepository } = await import('../db/repositories/config');
      const config = configRepository.loadAppConfig();
      let screenshotPath: string | undefined;
      if (config.application.saveScreenshots) {
        const { getAutoplyDir } = await import('../db');
        const { join } = await import('path');
        screenshotPath = join(getAutoplyDir(), 'screenshots', `smartrecruiters_${Date.now()}.png`);
        await this.takeScreenshot(screenshotPath);
      }

      return { success: confirmation.success, message: confirmation.message, screenshotPath, errors };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Unknown error');
      return { success: false, message: 'SmartRecruiters submission failed', errors };
    } finally {
      await this.cleanup();
    }
  }

  private async navigateToApplication(): Promise<void> {
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

    await this.page.waitForSelector('form, .application-form', { timeout: 10000 }).catch(() => { });
    await this.humanDelay(true);
  }

  private async fillSmartRecruitersForm(options: SubmissionOptions, errors: string[]): Promise<void> {
    if (!this.page) return;

    const { profile } = options;
    const filler = new FormFiller(this.page, profile, options.jobData, {
      resumePath: options.resumePath,
      coverLetterPath: options.coverLetterPath,
      answeredQuestions: options.answeredQuestions,
      autoMode: options.autoMode,
    });

    // Extract form fields from the live application form and fill via FormFiller
    const liveFormFields = await this.extractFormFields();
    if (liveFormFields.length > 0) {
      const formResult = await filler.fillForm(liveFormFields);
      errors.push(...formResult.errors);
    } else {
      // Fallback: fill basic fields manually if extraction found nothing
      await this.fillInput('input[name*="firstName"]', profile.name.split(' ')[0]);
      await this.fillInput('input[name*="lastName"]', profile.name.split(' ').slice(1).join(' '));
      await this.fillInput('input[name*="email"], input[type="email"]', profile.email);
      if (profile.phone) {
        await this.fillInput('input[name*="phone"], input[type="tel"]', profile.phone);
      }
    }

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

  private async clickSubmit(): Promise<boolean> {
    if (!this.page) return false;

    const selectors = ['button[type="submit"]', 'button:has-text("Submit")', 'button:has-text("Apply")'];

    for (const selector of selectors) {
      const button = await this.page.$(selector);
      if (button) {
        const isEnabled = await button.isEnabled();
        if (isEnabled) {
          await this.humanDelay(true);
          await button.click();
          return true;
        }
      }
    }
    return false;
  }

  private async waitForConfirmation(): Promise<{ success: boolean; message: string }> {
    if (!this.page) return { success: false, message: 'Page not initialized' };

    try {
      await this.page.waitForTimeout(3000);

      const successElement = await this.page.$('[class*="success"], :has-text("Thank you"), :has-text("submitted")');
      if (successElement) {
        return { success: true, message: 'SmartRecruiters application submitted' };
      }

      return { success: false, message: 'Could not confirm submission status (no clear success indicator found)' };
    } catch {
      return { success: false, message: 'Confirmation check failed' };
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

    const questions: CustomQuestion[] = [];
    const questionContainers = await this.page.$$(
      '.question-container, [class*="application-question"]'
    );

    for (let i = 0; i < questionContainers.length; i++) {
      const container = questionContainers[i];

      const questionText = await container.$eval(
        'label, .question-label',
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
        id: `sr_q_${i}`,
        question: questionText,
        type,
        required,
        options,
      });
    }

    return questions;
  }
}
