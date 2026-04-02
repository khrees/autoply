import { BaseScraper, type SubmissionOptions, type SubmissionResult } from './base';
import type { JobData, CustomQuestion, Platform } from '../types';
import { FormFiller } from '../core/form-filler';

export class WorkdayScraper extends BaseScraper {
  platform: Platform = 'workday';

  protected async waitForContent(): Promise<void> {
    if (!this.page) return;
    await this.page.waitForSelector('[data-automation-id="jobPostingHeader"], .css-1q2dra3, [data-automation-id="jobPostingDescription"]', {
      timeout: 15000,
    }).catch(() => { });
  }

  // ============ Workday Form Submission ============

  override async submitApplication(url: string, options: SubmissionOptions): Promise<SubmissionResult> {
    const errors: string[] = [];

    try {
      await this.initialize(url);
      if (!this.page) throw new Error('Browser not initialized');

      await this.humanDelay();
      await this.page.goto(url, { waitUntil: 'domcontentloaded' });
      await this.humanDelay(true);
      await this.humanScroll();

      // Click Apply button
      await this.navigateToWorkdayApplication();
      await this.waitForWorkdayApplicationForm();

      // Check if sign-in is required
      const needsSignIn = await this.checkWorkdaySignIn();
      if (needsSignIn) {
        return {
          success: false,
          message: 'Workday requires sign-in. Use "autoply login" to store credentials.',
          errors: ['Authentication required'],
        };
      }

      // Process multi-step form
      const result = await this.processWorkdaySteps(options);
      errors.push(...result.errors);

      // Screenshot
      const { takeScreenshotIfEnabled } = await import('./helpers');
      const { configRepository } = await import('../db/repositories/config');
      const { getAutoplyDir } = await import('../db');
      
      const screenshotPath = await takeScreenshotIfEnabled(
        this.page, 
        `workday_${Date.now()}`, 
        configRepository.loadAppConfig, 
        getAutoplyDir
      );

      return { success: result.success, message: result.message, screenshotPath, errors };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Unknown error');
      return { success: false, message: 'Workday submission failed', errors };
    } finally {
      await this.cleanup();
    }
  }

  private async navigateToWorkdayApplication(): Promise<void> {
    if (!this.page) return;

    const selectors = [
      '[data-automation-id="jobPostingApplyButton"]',
      'button:has-text("Apply")',
      'a:has-text("Apply")',
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

  private async waitForWorkdayApplicationForm(): Promise<void> {
    if (!this.page) return;

    await this.page.waitForSelector('[data-automation-id="applicationForm"], [data-automation-id*="input"]', {
      timeout: 15000,
    }).catch(() => { });
    await this.humanDelay(true);
  }

  private async checkWorkdaySignIn(): Promise<boolean> {
    if (!this.page) return true;

    const signInElement = await this.page.$('[data-automation-id="signInLink"], button:has-text("Sign In")');
    if (signInElement) {
      const isVisible = await signInElement.isVisible();
      return isVisible;
    }
    return false;
  }

  private async processWorkdaySteps(options: SubmissionOptions): Promise<{ success: boolean; message: string; errors: string[] }> {
    if (!this.page) return { success: false, message: 'Page not initialized', errors: [] };

    const errors: string[] = [];
    let stepCount = 0;
    const maxSteps = 15;

    while (stepCount < maxSteps) {
      stepCount++;
      await this.fillWorkdayStep(options, errors);

      // Check for submit
      const submitButton = await this.page.$('[data-automation-id="submit"], button:has-text("Submit")');
      if (submitButton) {
        const isEnabled = await submitButton.isEnabled();
        if (isEnabled) {
          await this.humanDelay(true);
          await submitButton.click();
          return this.waitForWorkdayConfirmation();
        }
      }

      // Check for field-level validation errors before advancing
      const hasErrors = await this.checkWorkdayValidationErrors();
      if (hasErrors) {
        errors.push('Validation errors on current step — some required fields may not have been filled');
        // Do not advance; break out so the caller knows something is wrong
        break;
      }

      // Next button
      const nextButton = await this.page.$('[data-automation-id="bottom-navigation-next-button"], button:has-text("Next")');
      if (nextButton) {
        const isEnabled = await nextButton.isEnabled();
        if (isEnabled) {
          await this.humanDelay(true);
          await nextButton.click();
          await this.page.waitForTimeout(2000);
          continue;
        }
      }
      break;
    }

    return { success: false, message: 'Could not complete Workday application', errors };
  }

  private async fillWorkdayStep(options: SubmissionOptions, errors: string[]): Promise<void> {
    if (!this.page) return;

    const { profile } = options;

    // Fill all detected form fields via FormFiller (handles prompts for unfillable required fields)
    const filler = new FormFiller(this.page, profile, options.jobData, {
      resumePath: options.resumePath,
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
      await this.fillWorkdayInput('[data-automation-id="legalNameSection_firstName"]', profile.name.split(' ')[0]);
      await this.fillWorkdayInput('[data-automation-id="legalNameSection_lastName"]', profile.name.split(' ').slice(1).join(' '));
      await this.fillWorkdayInput('[data-automation-id="email"]', profile.email);

      if (profile.phone) {
        await this.fillWorkdayInput('[data-automation-id="phone-number"]', profile.phone);
      }
    }

    // Resume upload
    if (options.resumePath) {
      const fileInput = await this.page.$('[data-automation-id="file-upload-input-ref"], input[type="file"]');
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

  private async fillWorkdayInput(selector: string, value: string): Promise<boolean> {
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

  private async waitForWorkdayConfirmation(): Promise<{ success: boolean; message: string; errors: string[] }> {
    if (!this.page) return { success: false, message: 'Page not initialized', errors: [] };

    try {
      await this.page.waitForTimeout(3000);

      const successElement = await this.page.$('[data-automation-id="confirmationMessage"], :has-text("Thank you")');
      if (successElement) {
        return { success: true, message: 'Workday application submitted', errors: [] };
      }

      return { success: false, message: 'Could not confirm submission status (no clear success indicator found)', errors: [] };
    } catch {
      return { success: false, message: 'Confirmation check failed', errors: [] };
    }
  }

  protected async extractJobData(url: string): Promise<JobData> {
    if (!this.page) throw new Error('Page not initialized');

    // Extract job title
    const title = await this.extractText(
      '[data-automation-id="jobPostingHeader"] h2, [data-automation-id="jobTitle"], h1[data-automation-id]'
    );

    // Extract company name from URL or page
    let company = await this.extractText(
      '[data-automation-id="jobPostingCompanyName"], .css-1q2dra3 [data-automation-id="companyName"]'
    );
    if (!company) {
      // Try to extract from URL (company.myworkdayjobs.com)
      const urlMatch = url.match(/([^.]+)\.myworkdayjobs\.com/);
      company = urlMatch ? this.formatCompanyName(urlMatch[1]) : 'Unknown Company';
    }

    // Extract job description
    const description = await this.extractText(
      '[data-automation-id="jobPostingDescription"], [data-automation-id="jobDescription"], .job-description'
    );

    // Extract location
    const location = await this.extractText(
      '[data-automation-id="locations"], [data-automation-id="jobPostingLocation"], [data-automation-id="location"]'
    );

    // Extract form fields
    const formFields = await this.extractFormFields();

    // Extract custom questions
    const customQuestions = await this.extractCustomQuestions();

    // Extract requirements and qualifications from description
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

  private formatCompanyName(name: string): string {
    return name
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  private async checkWorkdayValidationErrors(): Promise<boolean> {
    if (!this.page) return false;
    try {
      const errorSelectors = [
        '[data-automation-id*="error"]:not([style*="display: none"])',
        '.css-1or5op7', // Workday inline error class
        '[class*="WDAI_Error"]:not([style*="display: none"])',
        '[aria-invalid="true"]',
        '.wd-error',
      ];
      for (const selector of errorSelectors) {
        const errorEl = await this.page.$(selector);
        if (errorEl) {
          const isVisible = await errorEl.isVisible().catch(() => false);
          if (isVisible) return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  private async extractCustomQuestions(): Promise<CustomQuestion[]> {
    if (!this.page) return [];

    const questions: CustomQuestion[] = [];

    // Workday uses data-automation-id for form elements
    const customFields = await this.page.$$(
      '[data-automation-id*="question"], [data-automation-id*="formField"], .css-1mog1xl'
    );

    for (let i = 0; i < customFields.length; i++) {
      const field = customFields[i];
      const questionText = await field.$eval(
        'label, [data-automation-id*="label"]',
        (el) => el.textContent?.trim() ?? ''
      ).catch(() => '');

      if (!questionText) continue;

      // Determine question type
      const hasTextarea = (await field.$('textarea')) !== null;
      const hasSelect = (await field.$('select, [data-automation-id="selectWidget"]')) !== null;
      const hasRadio = (await field.$('input[type="radio"]')) !== null;
      const hasCheckbox = (await field.$('input[type="checkbox"]')) !== null;

      let type: CustomQuestion['type'] = 'text';
      let options: string[] | undefined;

      if (hasTextarea) {
        type = 'textarea';
      } else if (hasSelect) {
        type = 'select';
        options = await field.$$eval('[data-automation-id*="option"], option', (opts) =>
          opts.map((o) => o.textContent?.trim() ?? '').filter(Boolean)
        ).catch(() => []);
      } else if (hasRadio) {
        type = 'radio';
        options = await field.$$eval('input[type="radio"]', (inputs) =>
          inputs.map((inp) => inp.getAttribute('value') ?? '').filter(Boolean)
        ).catch(() => []);
      } else if (hasCheckbox) {
        type = 'checkbox';
        options = await field.$$eval('input[type="checkbox"]', (inputs) =>
          inputs.map((inp) => inp.getAttribute('value') ?? '').filter(Boolean)
        ).catch(() => []);
      }

      const required = (await field.$('[required], [data-automation-id*="required"]')) !== null;

      questions.push({
        id: `question_${i}`,
        question: questionText,
        type,
        required,
        options,
      });
    }

    return questions;
  }
}
