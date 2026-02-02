import { BaseScraper, type SubmissionOptions, type SubmissionResult } from './base';
import type { JobData, CustomQuestion, Platform } from '../types';
import { FormFiller } from '../core/form-filler';

export class TeamtailorScraper extends BaseScraper {
  platform: Platform = 'teamtailor';

  protected async waitForContent(): Promise<void> {
    if (!this.page) return;
    await this.page.waitForSelector('.job-ad, .careersite-job, [class*="job-page"]', {
      timeout: 10000,
    }).catch(() => {});
  }

  // ============ Teamtailor Form Submission ============

  override async submitApplication(url: string, options: SubmissionOptions): Promise<SubmissionResult> {
    const errors: string[] = [];

    try {
      await this.initialize();
      if (!this.page) throw new Error('Browser not initialized');

      await this.humanDelay();
      await this.page.goto(url, { waitUntil: 'networkidle' });
      await this.humanDelay(true);
      await this.humanScroll();

      // Navigate to application
      await this.navigateToApplication();
      await this.waitForApplicationForm();

      // Fill form
      await this.fillTeamtailorForm(options, errors);

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
        screenshotPath = join(getAutoplyDir(), 'screenshots', `teamtailor_${Date.now()}.png`);
        await this.takeScreenshot(screenshotPath);
      }

      return { success: confirmation.success, message: confirmation.message, screenshotPath, errors };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Unknown error');
      return { success: false, message: 'Teamtailor submission failed', errors };
    } finally {
      await this.cleanup();
    }
  }

  private async navigateToApplication(): Promise<void> {
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
        await this.page.waitForLoadState('networkidle');
        return;
      }
    }
  }

  protected override async waitForApplicationForm(): Promise<void> {
    if (!this.page) return;

    await this.page.waitForSelector('form, .application-form', { timeout: 10000 }).catch(() => {});
    await this.humanDelay(true);
  }

  private async fillTeamtailorForm(options: SubmissionOptions, errors: string[]): Promise<void> {
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

    const selectors = ['button[type="submit"]', 'button:has-text("Submit")', 'button:has-text("Send application")'];

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
        return { success: true, message: 'Teamtailor application submitted' };
      }

      return { success: true, message: 'Submission completed' };
    } catch {
      return { success: false, message: 'Confirmation check failed' };
    }
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
      location.toLowerCase().includes('remote') ||
      jobType.toLowerCase().includes('remote');

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

    const questions: CustomQuestion[] = [];
    const questionContainers = await this.page.$$(
      '.application-form__question, [class*="custom-question"], [class*="form-group"]'
    );

    for (let i = 0; i < questionContainers.length; i++) {
      const container = questionContainers[i];

      const questionText = await container.$eval(
        'label, .question-label',
        (el) => el.textContent?.trim() ?? ''
      ).catch(() => '');

      if (!questionText) continue;

      // Skip common form labels that aren't questions
      const skipLabels = ['name', 'email', 'phone', 'resume', 'cv', 'cover letter'];
      if (skipLabels.some((skip) => questionText.toLowerCase().includes(skip))) {
        continue;
      }

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
        id: `teamtailor_q_${i}`,
        question: questionText,
        type,
        required,
        options,
      });
    }

    return questions;
  }
}
