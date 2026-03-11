import { BaseScraper, type SubmissionOptions, type SubmissionResult } from './base';
import type { JobData, CustomQuestion, Platform } from '../types';
import { FormFiller } from '../core/form-filler';

export class JobviteScraper extends BaseScraper {
  platform: Platform = 'jobvite';

  protected async waitForContent(): Promise<void> {
    if (!this.page) return;
    await this.page.waitForSelector('.jv-page-body, .jv-job-detail', {
      timeout: 10000,
    }).catch(() => {});
  }

  // ============ Jobvite Form Submission ============

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
      await this.fillJobviteForm(options, errors);

      // Submit
      const submitted = await this.clickSubmit();
      if (!submitted) {
        return { success: false, message: 'Could not find submit button', errors };
      }

      const confirmation = await this.waitForConfirmation();

      // Screenshot
      const { configRepository } = await import('../db/repositories/config');
      const config = configRepository.loadAppConfig();
      let screenshotPath: string | undefined;
      if (config.application.saveScreenshots) {
        const { getAutoplyDir } = await import('../db');
        const { join } = await import('path');
        screenshotPath = join(getAutoplyDir(), 'screenshots', `jobvite_${Date.now()}.png`);
        await this.takeScreenshot(screenshotPath);
      }

      return { success: confirmation.success, message: confirmation.message, screenshotPath, errors };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Unknown error');
      return { success: false, message: 'Jobvite submission failed', errors };
    } finally {
      await this.cleanup();
    }
  }

  protected async navigateToApplication(): Promise<void> {
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

  private async fillJobviteForm(options: SubmissionOptions, errors: string[]): Promise<void> {
    if (!this.page) return;

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
  }

  private async clickSubmit(): Promise<boolean> {
    if (!this.page) return false;

    const selectors = ['button[type="submit"]', '.jv-submit-button', 'button:has-text("Submit")'];

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

      const successElement = await this.page.$('[class*="success"], :has-text("Thank you"), .jv-confirmation');
      if (successElement) {
        return { success: true, message: 'Jobvite application submitted' };
      }

      return { success: false, message: 'Could not confirm submission status (no clear success indicator found)' };
    } catch {
      return { success: false, message: 'Confirmation check failed' };
    }
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

    const questions: CustomQuestion[] = [];
    const questionContainers = await this.page.$$('.jv-question, [class*="custom-question"]');

    for (let i = 0; i < questionContainers.length; i++) {
      const container = questionContainers[i];

      const questionText = await container.$eval(
        'label, .question-text',
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
        id: `jobvite_q_${i}`,
        question: questionText,
        type,
        required,
        options,
      });
    }

    return questions;
  }
}
