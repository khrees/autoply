import { BaseScraper, type SubmissionOptions, type SubmissionResult } from './base';
import type { JobData, CustomQuestion, Platform } from '../types';
import { FormFiller } from '../core/form-filler';

export class LinkedInScraper extends BaseScraper {
  platform: Platform = 'linkedin';

  protected async waitForContent(): Promise<void> {
    if (!this.page) return;
    await this.page.waitForSelector('.job-view-layout, .jobs-unified-top-card', {
      timeout: 15000,
    }).catch(() => {});
  }

  // ============ LinkedIn Easy Apply Form Submission ============

  /**
   * LinkedIn Easy Apply is a multi-step modal flow.
   * Requires the user to be logged in (browser storage state).
   */
  override async submitApplication(url: string, options: SubmissionOptions): Promise<SubmissionResult> {
    const errors: string[] = [];

    try {
      await this.initialize();
      if (!this.page) throw new Error('Browser not initialized');

      // Navigate to job posting
      await this.humanDelay();
      await this.page.goto(url, { waitUntil: 'networkidle' });
      await this.humanDelay(true);
      await this.humanScroll();

      // Check if logged in
      const isLoggedIn = await this.checkLinkedInLogin();
      if (!isLoggedIn) {
        return {
          success: false,
          message: 'Not logged in to LinkedIn. Run "autoply login" first to save your session.',
          errors: ['LinkedIn login required'],
        };
      }

      // Check if Easy Apply is available
      const hasEasyApply = await this.hasEasyApplyButton();
      if (!hasEasyApply) {
        return {
          success: false,
          message: 'This job does not support Easy Apply. External application required.',
          errors: ['Easy Apply not available'],
        };
      }

      // Click Easy Apply button to open modal
      await this.clickEasyApplyButton();
      await this.waitForEasyApplyModal();

      // Process multi-step form
      const result = await this.processEasyApplySteps(options);
      errors.push(...result.errors);

      // Take screenshot
      const { configRepository } = await import('../db/repositories/config');
      const config = configRepository.loadAppConfig();
      let screenshotPath: string | undefined;
      if (config.application.saveScreenshots) {
        const { getAutoplyDir } = await import('../db');
        const { join } = await import('path');
        screenshotPath = join(getAutoplyDir(), 'screenshots', `linkedin_${Date.now()}.png`);
        await this.takeScreenshot(screenshotPath);
      }

      return {
        success: result.success,
        message: result.message,
        screenshotPath,
        errors,
      };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Unknown error');
      return {
        success: false,
        message: 'LinkedIn submission failed',
        errors,
      };
    } finally {
      await this.cleanup();
    }
  }

  private async checkLinkedInLogin(): Promise<boolean> {
    if (!this.page) return false;

    try {
      // Check for logged-in indicators
      const profileMenu = await this.page.$('.global-nav__me, .nav-item--profile, #ember[class*="profile"]');
      if (profileMenu) return true;

      // Check for login button (means not logged in)
      const loginButton = await this.page.$('a[href*="login"], .nav__button-secondary');
      if (loginButton) {
        const isVisible = await loginButton.isVisible();
        return !isVisible;
      }

      // Check for feed link (logged in)
      const feedLink = await this.page.$('a[href*="/feed"]');
      return feedLink !== null;
    } catch {
      return false;
    }
  }

  private async hasEasyApplyButton(): Promise<boolean> {
    if (!this.page) return false;

    const easyApplySelectors = [
      'button.jobs-apply-button',
      'button:has-text("Easy Apply")',
      '.jobs-apply-button--top-card',
      '[class*="jobs-apply-button"]',
    ];

    for (const selector of easyApplySelectors) {
      const button = await this.page.$(selector);
      if (button) {
        const text = await button.textContent();
        if (text?.toLowerCase().includes('easy apply')) {
          return true;
        }
      }
    }

    return false;
  }

  private async clickEasyApplyButton(): Promise<void> {
    if (!this.page) return;

    const easyApplySelectors = [
      'button.jobs-apply-button',
      'button:has-text("Easy Apply")',
      '.jobs-apply-button--top-card',
      '[class*="jobs-apply-button"]',
    ];

    for (const selector of easyApplySelectors) {
      try {
        const button = await this.page.$(selector);
        if (button) {
          const isVisible = await button.isVisible();
          if (isVisible) {
            await this.humanDelay(true);
            await button.click();
            return;
          }
        }
      } catch {
        continue;
      }
    }
  }

  private async waitForEasyApplyModal(): Promise<void> {
    if (!this.page) return;

    const modalSelectors = [
      '.jobs-easy-apply-modal',
      '[class*="easy-apply-modal"]',
      '.jobs-easy-apply-content',
      '[data-test-modal]',
    ];

    for (const selector of modalSelectors) {
      try {
        await this.page.waitForSelector(selector, { timeout: 10000 });
        await this.humanDelay(true);
        return;
      } catch {
        continue;
      }
    }
  }

  private async processEasyApplySteps(options: SubmissionOptions): Promise<{ success: boolean; message: string; errors: string[] }> {
    if (!this.page) return { success: false, message: 'Page not initialized', errors: [] };

    const errors: string[] = [];
    let stepCount = 0;
    const maxSteps = 10;

    while (stepCount < maxSteps) {
      stepCount++;

      // Fill current step
      await this.fillCurrentEasyApplyStep(options, errors);

      // Check for submit button (final step)
      const submitButton = await this.page.$('button[aria-label*="Submit"], button:has-text("Submit application")');
      if (submitButton) {
        const isVisible = await submitButton.isVisible();
        const isEnabled = await submitButton.isEnabled();

        if (isVisible && isEnabled) {
          await this.humanDelay(true);
          await submitButton.click();

          // Wait for confirmation
          return this.waitForLinkedInConfirmation();
        }
      }

      // Look for next/continue button
      const nextButton = await this.findLinkedInNextButton();
      if (nextButton) {
        await this.humanDelay(true);
        await nextButton.click();
        await this.page.waitForTimeout(1500);
      } else {
        // No next button and no submit button - might be stuck
        break;
      }
    }

    return {
      success: false,
      message: 'Could not complete all Easy Apply steps',
      errors,
    };
  }

  private async fillCurrentEasyApplyStep(options: SubmissionOptions, errors: string[]): Promise<void> {
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
      // Fallback: fill contact info manually if extraction found nothing
      await this.fillLinkedInContactInfo(profile);
    }

    // Upload resume if on resume step
    if (options.resumePath) {
      await this.uploadLinkedInResume(options.resumePath);
    }

    // Fill work experience if on that step
    await this.fillLinkedInWorkExperience(profile);

    // Fill education if on that step
    await this.fillLinkedInEducation(profile);

    // Answer custom questions
    if (options.answeredQuestions) {
      const result = await filler.fillCustomQuestions(options.answeredQuestions);
      errors.push(...result.errors);
    }

    // Handle radio button questions (Yes/No style)
    await this.handleLinkedInRadioQuestions();

    // Handle select dropdowns
    await this.handleLinkedInSelectQuestions(profile);

    await this.humanDelay(true);
  }

  private async fillLinkedInContactInfo(profile: SubmissionOptions['profile']): Promise<void> {
    if (!this.page) return;

    // Email
    const emailInput = await this.page.$('input[name*="email"], input[type="email"]');
    if (emailInput) {
      const currentValue = await emailInput.inputValue();
      if (!currentValue) {
        await emailInput.fill(profile.email);
      }
    }

    // Phone
    if (profile.phone) {
      const phoneInput = await this.page.$('input[name*="phone"], input[type="tel"]');
      if (phoneInput) {
        const currentValue = await phoneInput.inputValue();
        if (!currentValue) {
          await phoneInput.fill(profile.phone);
        }
      }
    }

    // Phone country code if separate
    const countryCodeSelect = await this.page.$('select[name*="country"], select[id*="phoneCountry"]');
    if (countryCodeSelect) {
      const countryCode = this.deriveCountryCodeFromLocation(profile.location);
      if (countryCode) {
        await countryCodeSelect.selectOption({ value: countryCode }).catch(() => {});
      }
    }
  }

  private deriveCountryCodeFromLocation(location?: string): string | null {
    if (!location) return null;
    const normalized = location.toLowerCase();

    if (normalized.includes('united states') || normalized.includes('usa') || normalized.includes('us') || normalized.includes('america')) {
      return 'US';
    }
    if (normalized.includes('canada')) return 'CA';
    if (normalized.includes('united kingdom') || normalized.includes('uk') || normalized.includes('england') || normalized.includes('scotland') || normalized.includes('wales') || normalized.includes('northern ireland')) {
      return 'GB';
    }
    if (normalized.includes('australia')) return 'AU';
    if (normalized.includes('india')) return 'IN';
    if (normalized.includes('nigeria')) return 'NG';
    if (normalized.includes('germany')) return 'DE';
    if (normalized.includes('france')) return 'FR';
    if (normalized.includes('spain')) return 'ES';
    if (normalized.includes('italy')) return 'IT';
    if (normalized.includes('netherlands') || normalized.includes('holland')) return 'NL';
    if (normalized.includes('sweden')) return 'SE';
    if (normalized.includes('norway')) return 'NO';
    if (normalized.includes('denmark')) return 'DK';
    if (normalized.includes('switzerland')) return 'CH';
    if (normalized.includes('ireland')) return 'IE';
    if (normalized.includes('singapore')) return 'SG';
    if (normalized.includes('new zealand')) return 'NZ';

    return null;
  }

  private async uploadLinkedInResume(resumePath: string): Promise<boolean> {
    if (!this.page) return false;

    try {
      // LinkedIn resume upload
      const fileInputSelectors = [
        'input[type="file"][name*="resume"]',
        'input[type="file"][accept*="pdf"]',
        '.jobs-document-upload input[type="file"]',
        '[class*="resume-upload"] input[type="file"]',
      ];

      for (const selector of fileInputSelectors) {
        const fileInput = await this.page.$(selector);
        if (fileInput) {
          await fileInput.setInputFiles(resumePath);
          await this.page.waitForTimeout(2000);
          return true;
        }
      }

      // Try upload button approach
      const uploadButton = await this.page.$('button:has-text("Upload resume"), button:has-text("Upload")');
      if (uploadButton) {
        try {
          const [fileChooser] = await Promise.all([
            this.page.waitForEvent('filechooser', { timeout: 5000 }),
            uploadButton.click(),
          ]);
          await fileChooser.setFiles(resumePath);
          await this.page.waitForTimeout(2000);
          return true;
        } catch {
          // Continue
        }
      }

      return false;
    } catch {
      return false;
    }
  }

  private async fillLinkedInWorkExperience(profile: SubmissionOptions['profile']): Promise<void> {
    if (!this.page) return;

    const latestExperience = profile.experience[0];
    if (!latestExperience) return;

    // Current title
    const titleInput = await this.page.$('input[name*="title"], input[id*="jobTitle"]');
    if (titleInput) {
      const currentValue = await titleInput.inputValue();
      if (!currentValue) {
        await titleInput.fill(latestExperience.title);
      }
    }

    // Current company
    const companyInput = await this.page.$('input[name*="company"], input[id*="companyName"]');
    if (companyInput) {
      const currentValue = await companyInput.inputValue();
      if (!currentValue) {
        await companyInput.fill(latestExperience.company);
        // Wait for autocomplete and potentially select first option
        await this.page.waitForTimeout(1000);
        const autocompleteOption = await this.page.$('[class*="autocomplete"] li:first-child, [class*="typeahead"] li:first-child');
        if (autocompleteOption) {
          await autocompleteOption.click().catch(() => {});
        }
      }
    }
  }

  private async fillLinkedInEducation(profile: SubmissionOptions['profile']): Promise<void> {
    if (!this.page) return;

    const latestEducation = profile.education[0];
    if (!latestEducation) return;

    // School
    const schoolInput = await this.page.$('input[name*="school"], input[id*="school"]');
    if (schoolInput) {
      const currentValue = await schoolInput.inputValue();
      if (!currentValue) {
        await schoolInput.fill(latestEducation.institution);
        await this.page.waitForTimeout(1000);
        const autocompleteOption = await this.page.$('[class*="autocomplete"] li:first-child');
        if (autocompleteOption) {
          await autocompleteOption.click().catch(() => {});
        }
      }
    }

    // Degree
    const degreeInput = await this.page.$('input[name*="degree"], select[name*="degree"]');
    if (degreeInput) {
      const tagName = await degreeInput.evaluate((el) => el.tagName.toLowerCase());
      if (tagName === 'select') {
        await degreeInput.selectOption({ label: latestEducation.degree }).catch(() => {});
      } else {
        const currentValue = await degreeInput.inputValue();
        if (!currentValue) {
          await degreeInput.fill(latestEducation.degree);
        }
      }
    }
  }

  private async handleLinkedInRadioQuestions(): Promise<void> {
    if (!this.page) return;

    // Find all radio button groups and try to answer them intelligently
    const radioGroups = await this.page.$$('fieldset, [role="radiogroup"], [class*="radio-group"]');

    for (const group of radioGroups) {
      const questionText = await group.textContent();
      const lower = questionText?.toLowerCase() || '';

      // Determine appropriate answer based on question content
      let selectYes = false;

      // Work authorization questions - typically Yes
      if (lower.includes('authorized to work') || lower.includes('legally authorized') || lower.includes('right to work')) {
        selectYes = true;
      }

      // Sponsorship - typically No
      if (lower.includes('require sponsor') || lower.includes('need sponsor') || lower.includes('visa sponsor')) {
        selectYes = false;
      }

      // Willing to relocate - depend on profile
      // For now, default to Yes
      if (lower.includes('relocate') || lower.includes('relocation')) {
        selectYes = true;
      }

      // Experience level questions - typically Yes if asking if you meet requirements
      if (lower.includes('years of experience') || lower.includes('do you have')) {
        selectYes = true;
      }

      // Select the appropriate radio button
      const yesRadio = await group.$('input[value*="Yes"], input[value="true"], label:has-text("Yes") input');
      const noRadio = await group.$('input[value*="No"], input[value="false"], label:has-text("No") input');

      if (selectYes && yesRadio) {
        await yesRadio.check().catch(() => {});
      } else if (!selectYes && noRadio) {
        await noRadio.check().catch(() => {});
      }
    }
  }

  private async handleLinkedInSelectQuestions(profile: SubmissionOptions['profile']): Promise<void> {
    if (!this.page) return;

    const selects = await this.page.$$('select');

    for (const select of selects) {
      const name = await select.getAttribute('name');
      const id = await select.getAttribute('id');
      const label = await this.findLabelForInput(select);
      const combined = `${name} ${id} ${label}`.toLowerCase();

      // Years of experience
      if (combined.includes('experience') || combined.includes('years')) {
        const years = this.calculateYearsExperience(profile);
        // Try to select the option that best matches
        const options = await select.$$eval('option', (opts) =>
          opts.map((o) => ({ value: o.value, text: o.textContent?.trim() || '' }))
        );

        for (const opt of options) {
          const optText = opt.text.toLowerCase();
          if (optText.includes(years.toString()) || optText.includes(`${years}+`) || optText.includes(`${years} `)) {
            await select.selectOption({ value: opt.value });
            break;
          }
        }
      }

      // Location preferences, etc. can be added similarly
    }
  }

  private calculateYearsExperience(profile: SubmissionOptions['profile']): number {
    if (!profile.experience || profile.experience.length === 0) return 0;

    let totalMonths = 0;
    for (const exp of profile.experience) {
      const start = new Date(exp.start_date);
      const end = exp.end_date ? new Date(exp.end_date) : new Date();
      const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
      totalMonths += Math.max(0, months);
    }

    return Math.round(totalMonths / 12);
  }

  private async findLinkedInNextButton(): Promise<Awaited<ReturnType<NonNullable<typeof this.page>['$']>> | null> {
    if (!this.page) return null;

    const nextSelectors = [
      'button[aria-label*="Continue"], button[aria-label*="Next"]',
      'button:has-text("Next")',
      'button:has-text("Continue")',
      'button:has-text("Review")',
      '.jobs-easy-apply-footer button[data-easy-apply-next]',
      '[class*="easy-apply"] button[type="button"]:has-text("Next")',
    ];

    for (const selector of nextSelectors) {
      try {
        const button = await this.page.$(selector);
        if (button) {
          const isVisible = await button.isVisible();
          const isEnabled = await button.isEnabled();
          const text = await button.textContent();

          // Make sure it's not submit
          if (isVisible && isEnabled && !text?.toLowerCase().includes('submit')) {
            return button;
          }
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  private async waitForLinkedInConfirmation(): Promise<{ success: boolean; message: string; errors: string[] }> {
    if (!this.page) return { success: false, message: 'Page not initialized', errors: [] };

    try {
      await this.page.waitForTimeout(3000);

      // Check for success indicators
      const successSelectors = [
        '.jobs-easy-apply-modal--success',
        '[class*="success"]',
        ':has-text("Application sent")',
        ':has-text("Your application was sent")',
        ':has-text("application submitted")',
        'h2:has-text("Done")',
      ];

      for (const selector of successSelectors) {
        try {
          const element = await this.page.$(selector);
          if (element) {
            const isVisible = await element.isVisible();
            if (isVisible) {
              return {
                success: true,
                message: 'LinkedIn Easy Apply application submitted successfully',
                errors: [],
              };
            }
          }
        } catch {
          continue;
        }
      }

      // Check for dismiss button (success state)
      const dismissButton = await this.page.$('button:has-text("Done"), button:has-text("Dismiss")');
      if (dismissButton) {
        const isVisible = await dismissButton.isVisible();
        if (isVisible) {
          return {
            success: true,
            message: 'Application submitted via LinkedIn Easy Apply',
            errors: [],
          };
        }
      }

      // Check for errors
      const errorElement = await this.page.$('.error, [class*="error"], [role="alert"]');
      if (errorElement) {
        const isVisible = await errorElement.isVisible();
        if (isVisible) {
          const text = await errorElement.textContent();
          return {
            success: false,
            message: text?.trim() || 'Application may have failed',
            errors: [text?.trim() || 'Unknown error'],
          };
        }
      }

      return {
        success: true,
        message: 'Submission completed (no errors detected)',
        errors: [],
      };
    } catch (error) {
      return {
        success: false,
        message: `Confirmation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        errors: [error instanceof Error ? error.message : 'Unknown error'],
      };
    }
  }

  protected async extractJobData(url: string): Promise<JobData> {
    if (!this.page) throw new Error('Page not initialized');

    // Extract job title
    const title = await this.extractText(
      '.job-details-jobs-unified-top-card__job-title, .jobs-unified-top-card__job-title, h1.t-24'
    );

    // Extract company name
    const company = await this.extractText(
      '.job-details-jobs-unified-top-card__company-name, .jobs-unified-top-card__company-name, a.ember-view.t-black.t-normal'
    );

    // Extract location
    const location = await this.extractText(
      '.job-details-jobs-unified-top-card__primary-description-container, .jobs-unified-top-card__bullet'
    );

    // Extract job description
    const description = await this.extractText(
      '.jobs-description-content__text, .jobs-box__html-content, .description__text'
    );

    // Extract job type
    const jobType = await this.extractText(
      '.job-details-jobs-unified-top-card__job-insight, .jobs-unified-top-card__workplace-type'
    );

    // Check if remote
    const remote = jobType.toLowerCase().includes('remote') || location.toLowerCase().includes('remote');

    // Form fields for LinkedIn are typically handled through their Easy Apply flow
    const formFields = await this.extractFormFields();

    // Custom questions in Easy Apply
    const customQuestions = await this.extractCustomQuestions();

    // Extract requirements and qualifications
    const requirements = this.extractRequirements(description);
    const qualifications = this.extractQualifications(description);

    return {
      url,
      platform: this.platform,
      title: title.trim() || 'Unknown Position',
      company: company.trim() || 'Unknown Company',
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

  private async extractCustomQuestions(): Promise<CustomQuestion[]> {
    if (!this.page) return [];

    const questions: CustomQuestion[] = [];

    // LinkedIn Easy Apply questions
    const questionContainers = await this.page.$$(
      '.jobs-easy-apply-form-section__grouping, [class*="fb-form-element"]'
    );

    for (let i = 0; i < questionContainers.length; i++) {
      const container = questionContainers[i];

      const questionText = await container.$eval(
        'label, .fb-form-element-label, [class*="artdeco-text-input--label"]',
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
        options = await container.$$eval('[class*="fb-radio-button"] label', (labels) =>
          labels.map((l) => l.textContent?.trim() ?? '').filter(Boolean)
        );
      }

      const required = (await container.$('[required], [aria-required="true"]')) !== null;

      questions.push({
        id: `linkedin_q_${i}`,
        question: questionText,
        type,
        required,
        options,
      });
    }

    return questions;
  }
}
