import { BaseScraper, type SubmissionOptions, type SubmissionResult } from './base';
import type { JobData, CustomQuestion, Platform } from '../types';
import { FormFiller, normalizeLocationInput } from '../core/form-filler';
import { configRepository } from '../db/repositories/config';

const LEVER_URL_FIELD_PATTERNS = [
  /linkedin/i,
  /github/i,
  /twitter/i,
  /portfolio/i,
  /website/i,
  /google\s*scholar/i,
  /design\s*portfolio/i,
  /personal\s*site/i,
  /blog\s*url/i,
];

const LEVER_STANDARD_FIELD_PATTERNS = [
  /resume|cv|cover[\s_-]?letter/i,
  /full[\s_-]?name|preferred[\s_-]?name|candidate[\s_-]?name/i,
  /e?[\s_-]?mail/i,
  /phone|tel|mobile|contact[\s_-]?number/i,
  /current[\s_-]?location|where.*based/i,
  /current[\s_-]?company|current[\s_-]?employer/i,
];

const LEVER_SYSTEM_FIELD_NAME_PATTERNS = [
  /^(?:resume|name|email|phone|location|org)$/i,
  /^urls\[/i,
];

export function shouldSkipLeverCustomQuestion(questionText: string, fieldName = ''): boolean {
  return (
    LEVER_URL_FIELD_PATTERNS.some((pattern) => pattern.test(questionText)) ||
    LEVER_STANDARD_FIELD_PATTERNS.some((pattern) => pattern.test(questionText)) ||
    LEVER_SYSTEM_FIELD_NAME_PATTERNS.some((pattern) => pattern.test(fieldName))
  );
}

export class LeverScraper extends BaseScraper {
  platform: Platform = 'lever';

  protected async waitForContent(): Promise<void> {
    if (!this.page) return;
    await this.page.waitForSelector('.posting-headline, .content', {
      timeout: 10000,
    }).catch(() => { });
  }

  // ============ Lever-specific Form Submission ============

  protected override async navigateToApplicationForm(): Promise<void> {
    if (!this.page) return;

    // Lever has an "Apply" button that leads to the application form
    const applyButtonSelectors = [
      'a.posting-btn-submit',
      'a[href*="apply"]',
      '.apply-button',
      'a:has-text("Apply for this job")',
      'a:has-text("Apply now")',
      '.postings-btn-wrapper a',
    ];

    for (const selector of applyButtonSelectors) {
      try {
        const button = await this.page.$(selector);
        if (button) {
          const isVisible = await button.isVisible();
          if (isVisible) {
            await this.humanDelay(true);
            await button.click();
            await this.page.waitForLoadState('domcontentloaded', { timeout: 60000 });
            return;
          }
        }
      } catch {
        continue;
      }
    }
  }

  protected override async waitForApplicationForm(): Promise<void> {
    if (!this.page) return;

    const formSelectors = [
      '.application-form',
      '#application-form',
      'form[class*="application"]',
      '.posting-application',
    ];

    for (const selector of formSelectors) {
      try {
        await this.page.waitForSelector(selector, { timeout: 10000 });
        await this.humanDelay(true);
        return;
      } catch {
        continue;
      }
    }
  }

  override async submitApplication(url: string, options: SubmissionOptions): Promise<SubmissionResult> {
    const errors: string[] = [];

    try {
      await this.initialize(url);
      if (!this.page) throw new Error('Browser not initialized');

      // Navigate to job posting
      await this.humanDelay();
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await this.waitForContent();
      await this.humanDelay(true);
      await this.humanScroll();

      // Navigate to application form
      await this.navigateToApplicationForm();
      await this.waitForApplicationForm();

      // Create form filler
      const filler = new FormFiller(this.page, options.profile, options.jobData, {
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
        await this.fillLeverBasicFields(options);
      }

      await this.fillLeverLocation(options);

      // Upload resume
      if (options.resumePath) {
        const resumeUploaded = await this.uploadLeverResume(options.resumePath);
        if (!resumeUploaded) {
          errors.push('Failed to upload resume');
        }
      }

      // Upload cover letter
      if (options.coverLetterPath) {
        await this.uploadLeverCoverLetter(options.coverLetterPath);
      }

      // Fill URLs
      await this.fillLeverUrls(options);

      // Fill custom questions
      if (options.answeredQuestions && options.answeredQuestions.length > 0) {
        const questionsResult = await filler.fillCustomQuestions(options.answeredQuestions);
        if (questionsResult.errors.length > 0) {
          errors.push(...questionsResult.errors);
        }
      }

      // Handle additional info textarea if present
      await this.fillLeverAdditionalInfo(options);

      const integrityResult = await this.validateProfileIntegrity(options.profile);
      if (!integrityResult.valid) {
        errors.push(...integrityResult.errors);
        return {
          success: false,
          message: 'Profile integrity validation failed',
          errors,
        };
      }

      // Validate
      const validation = await this.validateBeforeSubmit();
      if (!validation.valid) {
        errors.push(...validation.errors);
      }

      // If fillOnly mode, skip submission — leave browser open for user
      if (options.fillOnly) {
        const { configRepository } = await import('../db/repositories/config');
        const config = configRepository.loadAppConfig();
        let screenshotPath: string | undefined;
        if (config.application.saveScreenshots) {
          const { getAutoplyDir } = await import('../db');
          const { join } = await import('path');
          screenshotPath = join(getAutoplyDir(), 'screenshots', `lever_filled_${Date.now()}.png`);
          await this.takeScreenshot(screenshotPath);
        }
        return {
          success: true,
          message: 'Form filled successfully. Review and submit manually in the browser.',
          screenshotPath,
          errors,
        };
      }

      // Submit
      const submitted = await this.clickLeverSubmit();
      if (!submitted) {
        return {
          success: false,
          message: 'Could not find or click submit button',
          errors,
        };
      }

      // Give the system a moment to show captcha if it exists
      await this.page.waitForTimeout(2000);

      // Handle captcha if it appears
      await this.waitForCaptchaSolved();

      // Wait for confirmation
      const confirmation = await this.waitForLeverConfirmation();

      // Take screenshot
      const { configRepository } = await import('../db/repositories/config');
      const config = configRepository.loadAppConfig();
      let screenshotPath: string | undefined;
      if (config.application.saveScreenshots) {
        const { getAutoplyDir } = await import('../db');
        const { join } = await import('path');
        screenshotPath = join(getAutoplyDir(), 'screenshots', `lever_${Date.now()}.png`);
        await this.takeScreenshot(screenshotPath);
      }

      return {
        success: confirmation.success,
        message: confirmation.message,
        screenshotPath,
        errors,
      };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Unknown error');
      return {
        success: false,
        message: 'Lever submission failed',
        errors,
      };
    } finally {
      await this.cleanup();
    }
  }

  private async fillLeverBasicFields(options: SubmissionOptions): Promise<void> {
    if (!this.page) return;

    const { profile } = options;

    // Full name
    await this.fillInputBySelector(
      'input[name="name"], input[name="fullName"], input[id*="name"]',
      profile.name
    );

    // Email
    await this.fillInputBySelector(
      'input[name="email"], input[type="email"]',
      profile.email
    );

    // Phone
    if (profile.phone) {
      await this.fillInputBySelector(
        'input[name="phone"], input[type="tel"]',
        profile.phone
      );
    }

    if (this.shouldFillOptionalFields()) {
      const latestExperience = profile.experience[0];
      if (latestExperience) {
        await this.fillInputBySelector(
          'input[name="org"], input[name="company"], input[name*="current"]',
          latestExperience.company
        );
      }
    }
  }

  private async fillInputBySelector(selector: string, value: string): Promise<boolean> {
    if (!this.page || !value) return false;

    try {
      const input = await this.page.$(selector);
      if (input) {
        await input.click();
        await input.fill(value);
        await this.humanDelay(true);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  private async uploadLeverResume(resumePath: string): Promise<boolean> {
    if (!this.page) return false;

    try {
      // Lever uses a specific resume upload area
      const resumeSelectors = [
        'input[type="file"][name="resume"]',
        '.resume-upload input[type="file"]',
        '#resume-upload input[type="file"]',
        '[class*="resume"] input[type="file"]',
      ];

      for (const selector of resumeSelectors) {
        const fileInput = await this.page.$(selector);
        if (fileInput) {
          await fileInput.setInputFiles(resumePath);
          await this.page.waitForTimeout(2000);
          await this.humanDelay(true);
          return true;
        }
      }

      // Try dropzone approach
      const dropzone = await this.page.$('.resume-upload-area, [class*="dropzone"], .drop-area');
      if (dropzone) {
        try {
          const [fileChooser] = await Promise.all([
            this.page.waitForEvent('filechooser', { timeout: 5000 }),
            dropzone.click(),
          ]);
          await fileChooser.setFiles(resumePath);
          await this.page.waitForTimeout(2000);
          return true;
        } catch {
          // Continue to next method
        }
      }

      // Generic file input as fallback
      const fileInputs = await this.page.$$('input[type="file"]');
      if (fileInputs.length > 0) {
        await fileInputs[0].setInputFiles(resumePath);
        await this.page.waitForTimeout(2000);
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  private async uploadLeverCoverLetter(coverLetterPath: string): Promise<boolean> {
    if (!this.page) return false;

    try {
      // Lever may have a separate cover letter upload
      const coverLetterSelectors = [
        'input[type="file"][name*="cover"]',
        '[class*="cover-letter"] input[type="file"]',
        '#cover-letter-upload input[type="file"]',
      ];

      for (const selector of coverLetterSelectors) {
        const fileInput = await this.page.$(selector);
        if (fileInput) {
          await fileInput.setInputFiles(coverLetterPath);
          await this.page.waitForTimeout(2000);
          await this.humanDelay(true);
          return true;
        }
      }

      return false;
    } catch {
      return false;
    }
  }

  private async fillLeverUrls(options: SubmissionOptions): Promise<void> {
    if (!this.page || !this.shouldFillOptionalFields()) return;

    const { profile } = options;

    // LinkedIn
    if (profile.linkedin_url) {
      await this.fillInputBySelector(
        'input[name*="linkedin"], input[name="urls[LinkedIn]"], input[placeholder*="LinkedIn"]',
        profile.linkedin_url
      );
    }

    // GitHub
    if (profile.github_url) {
      await this.fillInputBySelector(
        'input[name*="github"], input[name="urls[GitHub]"], input[placeholder*="GitHub"]',
        profile.github_url
      );
    }

    // Portfolio
    if (profile.portfolio_url) {
      await this.fillInputBySelector(
        'input[name*="portfolio"], input[name*="website"], input[name="urls[Portfolio]"]',
        profile.portfolio_url
      );
    }
  }

  private async fillLeverAdditionalInfo(options: SubmissionOptions): Promise<void> {
    if (!this.page || !this.shouldFillOptionalFields()) return;

    // Lever often has an "Additional Information" textarea
    const additionalInfoSelectors = [
      'textarea[name="comments"]',
      'textarea[name="additionalInfo"]',
      'textarea[name*="additional"]',
      '#additional-information textarea',
    ];

    // Only fill if the cover letter is available as text
    if (!options.documents.coverLetter) return;

    for (const selector of additionalInfoSelectors) {
      const textarea = await this.page.$(selector);
      if (textarea) {
        // Put a brief note, not the full cover letter
        const note = `Please see my attached cover letter for more details about my interest in this position.`;
        await textarea.fill(note);
        await this.humanDelay(true);
        return;
      }
    }
  }

  private async fillLeverLocation(options: SubmissionOptions): Promise<void> {
    if (!this.page || !options.profile.location) return;

    const locationSelectors = [
      'input[name="location"]',
      'input[name*="location" i]',
      'input[aria-label*="location" i]',
      'input[placeholder*="location" i]',
    ];

    const normalizedLocation = normalizeLocationInput(options.profile.location);

    for (const selector of locationSelectors) {
      const inputs = await this.page.$$(selector);
      for (const input of inputs) {
        const isVisible = await input.isVisible().catch(() => false);
        if (!isVisible) continue;

        await input.click().catch(() => { });
        await input.fill('').catch(() => { });
        await input.type(normalizedLocation, { delay: 40 }).catch(() => { });
        await this.page.waitForTimeout(800);

        const optionSelectors = [
          '[role="listbox"] [role="option"]',
          '[role="option"]',
          '[class*="autocomplete"] li',
          '[class*="typeahead"] li',
          '[class*="suggestion"]',
        ];

        for (const optionSelector of optionSelectors) {
          const option = await this.page.$(optionSelector);
          if (!option) continue;

          const optionVisible = await option.isVisible().catch(() => false);
          if (!optionVisible) continue;

          await option.click().catch(() => { });
          await this.humanDelay(true);
          return;
        }

        await input.press('ArrowDown').catch(() => { });
        await input.press('Enter').catch(() => { });
        await input.press('Tab').catch(() => { });
        await this.humanDelay(true);
        return;
      }
    }
  }

  private async clickLeverSubmit(): Promise<boolean> {
    if (!this.page) return false;

    const submitSelectors = [
      'button[type="submit"]',
      'button:has-text("Submit application")',
      'button:has-text("Submit")',
      '.postings-btn[type="submit"]',
      'input[type="submit"]',
      '.application-form button[type="submit"]',
    ];

    for (const selector of submitSelectors) {
      try {
        const buttons = await this.page.$$(selector);
        for (const button of buttons) {
          const isVisible = await button.isVisible();
          const isEnabled = await button.isEnabled();

          if (isVisible && isEnabled) {
            await this.humanDelay(true);
            await button.scrollIntoViewIfNeeded();
            await button.click();
            return true;
          }
        }
      } catch {
        continue;
      }
    }

    return false;
  }

  private async waitForLeverConfirmation(): Promise<{ success: boolean; message: string }> {
    if (!this.page) return { success: false, message: 'Page not initialized' };

    try {
      await this.page.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(() => { });
      await this.humanDelay();

      // Check for confirmation
      const confirmationSelectors = [
        '.application-confirmation',
        '.thank-you',
        '[class*="success"]',
        'h1:has-text("Thank")',
        'h2:has-text("Thank")',
        ':has-text("Application submitted")',
        ':has-text("received your application")',
      ];

      for (const selector of confirmationSelectors) {
        try {
          const element = await this.page.$(selector);
          if (element) {
            const isVisible = await element.isVisible();
            if (isVisible) {
              const text = await element.textContent();
              return {
                success: true,
                message: text?.trim() || 'Application submitted to Lever',
              };
            }
          }
        } catch {
          continue;
        }
      }

      // Check URL
      const currentUrl = this.page.url();
      if (currentUrl.includes('thank') || currentUrl.includes('success') || currentUrl.includes('confirmation')) {
        return { success: true, message: 'Application submitted successfully' };
      }

      // Check for errors
      const errorElement = await this.page.$('.error, [class*="error"], .flash-error');
      if (errorElement) {
        const isVisible = await errorElement.isVisible();
        if (isVisible) {
          const errorText = await errorElement.textContent();
          if (errorText?.trim()) {
            return { success: false, message: errorText.trim() };
          }
        }
      }

      return { success: false, message: 'Could not confirm submission status (no clear success indicator found)' };
    } catch (error) {
      return {
        success: false,
        message: `Confirmation check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  protected async extractJobData(url: string): Promise<JobData> {
    if (!this.page) throw new Error('Page not initialized');

    // Extract job title
    const title = await this.extractText('.posting-header h2, .posting-headline h2, h1.posting-title');

    // Extract company name
    let company = await this.extractText('.posting-header .company, .posting-headline .company, .main-header-content h1');
    if (!company) {
      // Try to get from logo alt text
      const logoAlt = await this.page.$eval('.main-header-logo img', (img) => (img as HTMLImageElement).alt).catch(() => '');
      if (logoAlt) {
        company = logoAlt.replace(/logo/i, '').trim();
      }
    }
    if (!company) {
      // Extract from URL: jobs.lever.co/companyname
      const urlMatch = url.match(/jobs\.lever\.co\/([^/]+)/);
      company = urlMatch ? urlMatch[1].replace(/-/g, ' ') : 'Unknown Company';
    }

    // Extract location
    const location = await this.extractText('.posting-categories .location, .sort-by-commitment');

    // Extract job description
    const descriptionSections = await this.extractAllText('.posting-description, .section-wrapper');
    const description = descriptionSections.join('\n\n');

    // Extract form fields
    const formFields = await this.extractFormFields();

    // Extract custom questions from application page
    const customQuestions = await this.extractCustomQuestions();

    // Parse requirements and qualifications
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

    // Look for custom question containers
    const questionContainers = await this.page.$$(
      '.custom-question, .application-question, li.application-question, [class*="custom-field"]'
    );

    for (let i = 0; i < questionContainers.length; i++) {
      const container = questionContainers[i];

      const questionText = await container.$eval(
        'label, .question-label, .application-label .text, .application-label',
        (el) => el.textContent?.trim() ?? ''
      ).catch(() => '');

      if (!questionText) continue;

      const fieldName = await container.$eval(
        'input, textarea, select',
        (el) => (el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).name ?? ''
      ).catch(() => '');

      // Skip standard profile fields — they are filled elsewhere and should not be AI-answered.
      if (shouldSkipLeverCustomQuestion(questionText, fieldName)) continue;

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
        options = await container.$$eval('label', (labels) =>
          labels
            .filter((l) => l.querySelector('input[type="radio"]'))
            .map((l) => l.textContent?.trim() ?? '')
            .filter(Boolean)
        );
      }

      const required = (await container.$('[required], .required, [aria-required="true"]')) !== null;

      questions.push({
        id: `lever_q_${i}`,
        question: questionText,
        type,
        required,
        options,
      });
    }

    return questions;
  }

  private shouldFillOptionalFields(): boolean {
    return configRepository.loadAppConfig().application.fillOptionalFields ?? false;
  }
}
