import type { Browser, Page, BrowserContext } from 'playwright';
import type {
  JobData,
  FormField,
  CustomQuestion,
  Platform,
  Profile,
  GeneratedDocuments,
  AIProvider,
} from '../types';
import { configRepository } from '../db/repositories/config';
import { logger } from '../utils/logger';
import {
  FormFiller,
  type IdentityAssertionKey,
  type FormFillerOptions,
  type FillResult,
  getExpectedIdentityValue,
  getIdentityAssertionKey,
  matchesIdentityFieldValue,
  shouldAllowAIAnswer,
} from '../core/form-filler';
import { extractJobDataWithAI, mergeJobData } from '../ai/job-extractor';
import { browserManager, type BrowserSession } from '../core/browser-manager';

export interface SubmissionResult {
  success: boolean;
  message: string;
  screenshotPath?: string;
  errors: string[];
}

export interface FillApplicationResult {
  success: boolean;
  message: string;
  screenshotPath?: string;
  filledFields: string[];
  skippedFields: string[];
  errors: string[];
}

export interface SubmissionOptions {
  profile: Profile;
  jobData: JobData;
  documents: GeneratedDocuments;
  resumePath?: string;
  coverLetterPath?: string;
  answeredQuestions?: CustomQuestion[];
  autoMode?: boolean;
  /** When true, fill the form but do not click submit — leave the browser open for the user */
  fillOnly?: boolean;
}

// Random delay to mimic human behavior
function randomDelay(min: number, max: number): Promise<void> {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

export abstract class BaseScraper {
  abstract platform: Platform;
  protected browser: Browser | null = null;
  protected context: BrowserContext | null = null;
  protected page: Page | null = null;
  protected browserSession: BrowserSession | null = null;
  protected browserSelectionUrl: string | null = null;
  public keepAlive: boolean = false;
  protected isScraping = false;

  async initialize(url?: string): Promise<void> {
    if (this.browser && this.context && this.page) return;

    const config = configRepository.loadAppConfig();
    this.browserSession = await browserManager.createSession(
      this.platform,
      this.browserSelectionUrl ?? url
    );
    this.browser = this.browserSession.browser;
    this.context = this.browserSession.context;
    this.page = this.browserSession.page;
    this.page.setDefaultTimeout(config.browser.timeout);
  }

  // Add human-like delay between actions
  protected async humanDelay(short = false): Promise<void> {
    if (short) {
      await randomDelay(300, 800);
    } else {
      await randomDelay(1000, 3000);
    }
  }

  // Simulate human-like scrolling
  protected async humanScroll(): Promise<void> {
    if (!this.page) return;

    const scrolls = Math.floor(Math.random() * 3) + 2; // 2-4 scrolls
    for (let i = 0; i < scrolls; i++) {
      const scrollAmount = Math.floor(Math.random() * 300) + 100;
      await this.page.mouse.wheel(0, scrollAmount);
      await randomDelay(500, 1500);
    }
  }

  async cleanup(): Promise<void> {
    if (this.keepAlive) return;

    if (this.browserSession) {
      await this.browserSession.release();
      this.browserSession = null;
    }

    this.context = null;
    this.browser = null;
    this.page = null;
  }

  async close(): Promise<void> {
    const wasKeepAlive = this.keepAlive;
    this.keepAlive = false;
    await this.cleanup();
    this.keepAlive = wasKeepAlive;
  }

  async waitForBrowserClose(): Promise<void> {
    if (!this.browserSession) return;
    await this.browserSession.waitForClose();
  }

  async scrape(url: string, aiProvider?: AIProvider): Promise<JobData> {
    this.isScraping = true;
    try {
      await this.initialize(url);
      if (!this.page) throw new Error('Browser not initialized');

      // Random delay before navigation
      await this.humanDelay();

      await this.page.goto(url, { waitUntil: 'domcontentloaded' });

      // Simulate human behavior: mouse movement and scrolling
      await this.humanDelay(true);
      await this.page.mouse.move(Math.random() * 500 + 100, Math.random() * 300 + 100);
      await this.humanScroll();

      await this.waitForContent();

      let jobData = await this.extractJobData(url);

      // Use AI fallback if extraction was incomplete
      if (aiProvider && this.needsAIFallback(jobData)) {
        try {
          const rawHtml = await this.page.content();
          const extracted = await extractJobDataWithAI(aiProvider, rawHtml, url);
          jobData = mergeJobData(jobData, extracted);
        } catch {
          // AI fallback failed, continue with original data
        }
      }

      return jobData;
    } finally {
      this.isScraping = false;
      if (!this.keepAlive) {
        await this.cleanup();
      }
    }
  }

  protected needsAIFallback(jobData: JobData): boolean {
    return (
      jobData.title === 'Unknown Position' ||
      !jobData.title ||
      !jobData.description ||
      jobData.description.trim() === ''
    );
  }

  protected abstract waitForContent(): Promise<void>;
  protected abstract extractJobData(url: string): Promise<JobData>;

  protected async extractText(selector: string): Promise<string> {
    if (!this.page) return '';
    try {
      const element = await this.page.$(selector);
      if (!element) return '';
      return (await element.textContent()) ?? '';
    } catch {
      return '';
    }
  }

  protected async extractAllText(selector: string): Promise<string[]> {
    if (!this.page) return [];
    try {
      const elements = await this.page.$$(selector);
      const texts: string[] = [];
      for (const element of elements) {
        const text = await element.textContent();
        if (text) texts.push(text.trim());
      }
      return texts;
    } catch {
      return [];
    }
  }

  protected async extractFormFields(): Promise<FormField[]> {
    if (!this.page) return [];

    const fields: FormField[] = [];

    // Extract input fields
    const inputs = await this.page.$$('input:not([type="hidden"]):not([type="submit"])');
    for (const input of inputs) {
      const name = (await input.getAttribute('name')) ?? '';
      const type = ((await input.getAttribute('type')) ?? 'text') as FormField['type'];
      const label = await this.findLabelForInput(input);
      const required = (await input.getAttribute('required')) !== null;
      const value = await input.inputValue().catch(() => '');

      if (name || label) {
        fields.push({ name, type, label, required, value: value || undefined });
      }
    }

    // Extract textareas
    const textareas = await this.page.$$('textarea');
    for (const textarea of textareas) {
      const name = (await textarea.getAttribute('name')) ?? '';
      const label = await this.findLabelForInput(textarea);
      const required = (await textarea.getAttribute('required')) !== null;
      const value = await textarea.inputValue().catch(() => '');

      if (name || label) {
        fields.push({ name, type: 'textarea', label, required, value: value || undefined });
      }
    }

    // Extract selects
    const selects = await this.page.$$('select');
    for (const select of selects) {
      const name = (await select.getAttribute('name')) ?? '';
      const label = await this.findLabelForInput(select);
      const required = (await select.getAttribute('required')) !== null;
      const options = await select.$$eval('option', (opts) =>
        opts.map((o) => o.textContent?.trim() ?? '').filter(Boolean)
      );
      const value = await select.inputValue().catch(() => '');

      if (name || label) {
        fields.push({ name, type: 'select', label, required, options, value: value || undefined });
      }
    }

    return fields;
  }

  protected async findLabelForInput(input: import('playwright').ElementHandle): Promise<string> {
    if (!this.page) return '';

    try {
      // Try to find associated label by id
      const id = await input.getAttribute('id');
      if (id) {
        const label = await this.page.$(`label[for="${id}"]`);
        if (label) {
          const text = await label.textContent();
          if (text) return text.trim();
        }
      }

      // Try to find parent label
      const parentLabel = await this.page.evaluate((el) => {
        const parent = (el as HTMLElement).closest('label');
        return parent?.textContent?.trim() ?? '';
      }, input);

      if (parentLabel) return parentLabel;

      // Try aria-label
      const ariaLabel = await input.getAttribute('aria-label');
      if (ariaLabel) return ariaLabel;

      // Try placeholder
      const placeholder = await input.getAttribute('placeholder');
      if (placeholder) return placeholder;

      return '';
    } catch {
      return '';
    }
  }

  protected extractRequirements(description: string): string[] {
    const lines = description.split('\n');
    const requirements: string[] = [];
    let inRequirements = false;

    for (const line of lines) {
      const trimmed = line.trim();
      const lower = trimmed.toLowerCase();
      const isBullet =
        trimmed.startsWith('-') || trimmed.startsWith('•') || trimmed.startsWith('*');

      if (
        !isBullet &&
        (lower.includes('requirement') ||
          lower.includes('must have') ||
          lower.includes('you will need'))
      ) {
        inRequirements = true;
        continue;
      }

      if (
        inRequirements &&
        !isBullet &&
        (lower.includes('nice to have') ||
          lower.includes('preferred') ||
          lower.includes('bonus') ||
          lower.includes('what we offer'))
      ) {
        inRequirements = false;
      }

      if (inRequirements && isBullet) {
        requirements.push(trimmed.replace(/^[-•*]\s*/, ''));
      }
    }

    return requirements;
  }

  protected extractQualifications(description: string): string[] {
    const lines = description.split('\n');
    const qualifications: string[] = [];
    let inQualifications = false;

    for (const line of lines) {
      const trimmed = line.trim();
      const lower = trimmed.toLowerCase();
      const isBullet =
        trimmed.startsWith('-') || trimmed.startsWith('•') || trimmed.startsWith('*');

      if (
        !isBullet &&
        (lower.includes('qualification') ||
          lower.includes('nice to have') ||
          lower.includes('preferred'))
      ) {
        inQualifications = true;
        continue;
      }

      if (
        inQualifications &&
        !isBullet &&
        (lower.includes('responsibilit') ||
          lower.includes('what we offer') ||
          lower.includes('benefit'))
      ) {
        inQualifications = false;
      }

      if (inQualifications && isBullet) {
        qualifications.push(trimmed.replace(/^[-•*]\s*/, ''));
      }
    }

    return qualifications;
  }

  async takeScreenshot(path: string): Promise<void> {
    if (this.page) {
      await this.page.screenshot({ path, fullPage: true });
    }
  }

  // ============ AI Field Answering ============

  /**
   * Use AI to answer a form question based on user profile and job data.
   * Can be used by subclasses when standard form-filling fails.
   */
  protected async getAIAnswer(
    profile: Profile,
    jobData: JobData,
    label: string,
    options?: { type?: CustomQuestion['type']; choices?: string[] }
  ): Promise<string | null> {
    if (!shouldAllowAIAnswer({ label, type: options?.type, options: options?.choices })) {
      return null;
    }

    try {
      const { createAIProvider } = await import('../ai/provider');
      const { answerApplicationQuestion } = await import('../ai/cover-letter');
      const provider = createAIProvider();
      const answer = await answerApplicationQuestion(provider, profile, jobData, label, options);
      return answer?.trim() || null;
    } catch {
      return null;
    }
  }

  // ============ Form Submission Methods ============

  /**
   * Submit an application to this platform.
   * This method initializes the browser, navigates to the job URL,
   * fills the form, and submits it.
   */
  async submitApplication(url: string, options: SubmissionOptions): Promise<SubmissionResult> {
    const errors: string[] = [];

    try {
      await this.initialize(url);
      if (!this.page) throw new Error('Browser not initialized');

      // Navigate to job posting
      await this.humanDelay();
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await this.humanDelay(true);
      await this.humanScroll();
      await this.waitForContent();

      // Navigate to application form (platform-specific)
      await this.navigateToApplicationForm();
      await this.waitForApplicationForm();

      // Create form filler
      const fillerOptions: FormFillerOptions = {
        resumePath: options.resumePath,
        coverLetterPath: options.coverLetterPath,
        answeredQuestions: options.answeredQuestions,
        autoMode: options.autoMode,
      };

      const filler = new FormFiller(this.page, options.profile, options.jobData, fillerOptions);

      // Extract form fields from the live form, fall back to pre-scraped data
      const liveFormFields = await this.extractFormFields();
      const formFields = liveFormFields.length > 0 ? liveFormFields : options.jobData.form_fields;
      const formResult = await filler.fillForm(formFields);
      if (formResult.errors.length > 0) {
        errors.push(...formResult.errors);
      }

      // Upload resume
      if (options.resumePath) {
        const uploaded = await this.uploadFile(options.resumePath, 'resume');
        if (!uploaded) {
          errors.push('Failed to upload resume');
        }
      }

      // Upload cover letter
      if (options.coverLetterPath) {
        await this.uploadFile(options.coverLetterPath, 'cover_letter');
      }

      // Fill custom questions
      if (options.answeredQuestions && options.answeredQuestions.length > 0) {
        const questionsResult = await filler.fillCustomQuestions(options.answeredQuestions);
        if (questionsResult.errors.length > 0) {
          errors.push(...questionsResult.errors);
        }
      }

      // Perform any platform-specific custom form filling
      await this.postFormFill(options, filler, errors);

      // Perform any pre-submit actions (e.g., handling specific validations or captchas)
      await this.preSubmitActions(options, errors);

      const integrityResult = await this.validateProfileIntegrity(options.profile);
      if (!integrityResult.valid) {
        errors.push(...integrityResult.errors);
        return {
          success: false,
          message: 'Profile integrity validation failed',
          errors,
        };
      }

      // Platform-specific pre-submit validation
      const validationResult = await this.validateBeforeSubmit();
      if (!validationResult.valid) {
        errors.push(...validationResult.errors);
        return {
          success: false,
          message: 'Form validation failed',
          errors,
        };
      }

      // If fillOnly mode, skip submission — leave browser open for user
      if (options.fillOnly) {
        // Take screenshot for records
        const { takeScreenshotIfEnabled } = await import('./helpers');
        const { getAutoplyDir } = await import('../db');
        const screenshotPath = await takeScreenshotIfEnabled(
          this.page,
          `filled_${this.platform}`,
          configRepository.loadAppConfig,
          getAutoplyDir
        );

        return {
          success: true,
          message: 'Form filled successfully. Review and submit manually in the browser.',
          screenshotPath,
          errors,
        };
      }

      // Submit the form
      const submitted = await this.clickSubmitButton();
      if (!submitted) {
        return {
          success: false,
          message: 'Could not find or click submit button',
          errors,
        };
      }

      // Wait for submission confirmation
      const confirmationResult = await this.waitForSubmissionConfirmation();

      // Take screenshot for records
      const { takeScreenshotIfEnabled } = await import('./helpers');
      const { getAutoplyDir } = await import('../db');
      const screenshotPath = await takeScreenshotIfEnabled(
        this.page,
        `submission_${this.platform}`,
        configRepository.loadAppConfig,
        getAutoplyDir
      );

      return {
        success: confirmationResult.success,
        message: confirmationResult.message,
        screenshotPath,
        errors,
      };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Unknown error');
      return {
        success: false,
        message: 'Submission failed with error',
        errors,
      };
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Fill an application form without submitting it.
   * Navigates to the job page, fills all form fields,
   * then keeps the browser open for the user to review and submit manually.
   */
  async fillApplication(url: string, options: SubmissionOptions): Promise<FillApplicationResult> {
    const errors: string[] = [];
    const filledFields: string[] = [];
    const skippedFields: string[] = [];

    try {
      await this.initialize(url);
      if (!this.page) throw new Error('Browser not initialized');

      // Navigate to job posting
      await this.humanDelay();
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await this.humanDelay(true);
      await this.humanScroll();
      await this.waitForContent();

      // Navigate to application form (platform-specific)
      await this.navigateToApplicationForm();
      await this.waitForApplicationForm();

      // Create form filler
      const fillerOptions: FormFillerOptions = {
        resumePath: options.resumePath,
        coverLetterPath: options.coverLetterPath,
        answeredQuestions: options.answeredQuestions,
        autoMode: options.autoMode,
      };

      const filler = new FormFiller(this.page, options.profile, options.jobData, fillerOptions);

      // Extract form fields from the live form, fall back to pre-scraped data
      const liveFormFields = await this.extractFormFields();
      const formFields = liveFormFields.length > 0 ? liveFormFields : options.jobData.form_fields;
      const formResult = await filler.fillForm(formFields);
      filledFields.push(...formResult.filledFields);
      skippedFields.push(...formResult.skippedFields);
      if (formResult.errors.length > 0) {
        errors.push(...formResult.errors);
      }

      // Upload resume
      if (options.resumePath) {
        await this.uploadFile(options.resumePath, 'resume');
      }

      // Upload cover letter
      if (options.coverLetterPath) {
        await this.uploadFile(options.coverLetterPath, 'cover_letter');
      }

      // Fill custom questions
      if (options.answeredQuestions && options.answeredQuestions.length > 0) {
        const questionsResult = await filler.fillCustomQuestions(options.answeredQuestions);
        filledFields.push(...questionsResult.filledFields);
        skippedFields.push(...questionsResult.skippedFields);
        if (questionsResult.errors.length > 0) {
          errors.push(...questionsResult.errors);
        }
      }

      // Perform any platform-specific custom form filling
      await this.postFormFill(options, filler, errors);

      // Perform any pre-submit actions (e.g., handling specific validations or captchas)
      await this.preSubmitActions(options, errors);

      const integrityResult = await this.validateProfileIntegrity(options.profile);
      if (!integrityResult.valid) {
        errors.push(...integrityResult.errors);
      }

      // Platform-specific pre-submit validation
      const validationResult = await this.validateBeforeSubmit();
      if (!validationResult.valid) {
        errors.push(...validationResult.errors);
      }

      // Take screenshot for records
      const { takeScreenshotIfEnabled } = await import('./helpers');
      const { getAutoplyDir } = await import('../db');
      const screenshotPath = await takeScreenshotIfEnabled(
        this.page,
        `filled_${this.platform}`,
        configRepository.loadAppConfig,
        getAutoplyDir
      );

      // Do NOT submit — leave browser open for user to review
      // Do NOT call cleanup — keep the browser alive

      return {
        success: true,
        message: 'Form filled successfully. Review and submit manually in the browser.',
        screenshotPath,
        filledFields,
        skippedFields,
        errors,
      };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Unknown error');
      return {
        success: false,
        message: 'Form filling failed with error',
        filledFields,
        skippedFields,
        errors,
      };
    }
    // Note: no finally/cleanup — browser stays open for user to submit manually
  }

  /**
   * Shared setup for both submitApplication and fillApplication.
   * Navigates to the page, waits for content, opens the application form,
   * and creates a form filler ready for use.
   */
  private async prepareApplicationForm(
    url: string,
    options: SubmissionOptions
  ): Promise<{
    filler: FormFiller;
    liveFormFields: FormField[];
    formFields: FormField[];
  }> {
    await this.initialize(url);
    if (!this.page) throw new Error('Browser not initialized');

    // Navigate to job posting
    await this.humanDelay();
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await this.humanDelay(true);
    await this.humanScroll();
    await this.waitForContent();

    // Navigate to application form (platform-specific)
    await this.navigateToApplicationForm();
    await this.waitForApplicationForm();

    // Create form filler
    const fillerOptions: FormFillerOptions = {
      resumePath: options.resumePath,
      coverLetterPath: options.coverLetterPath,
      answeredQuestions: options.answeredQuestions,
      autoMode: options.autoMode,
    };

    const filler = new FormFiller(this.page, options.profile, options.jobData, fillerOptions);

    // Extract form fields from the live form, fall back to pre-scraped data
    const liveFormFields = await this.extractFormFields();
    const formFields = liveFormFields.length > 0 ? liveFormFields : options.jobData.form_fields;

    return { filler, liveFormFields, formFields };
  }

  /**
   * Shared form-filling logic: fills fields, uploads docs, fills questions,
   * runs platform-specific hooks, and validates.
   */
  private async fillAllForms(
    filler: FormFiller,
    formFields: FormField[],
    options: SubmissionOptions
  ): Promise<{
    formResult: FillResult;
    questionsResult: FillResult;
    postFillErrors: string[];
    integrityErrors: string[];
    validationErrors: string[];
  }> {
    const postFillErrors: string[] = [];

    // Fill standard form fields
    const formResult = await filler.fillForm(formFields);

    // Upload resume
    if (options.resumePath) {
      const uploaded = await this.uploadFile(options.resumePath, 'resume');
      if (!uploaded) postFillErrors.push('Failed to upload resume');
    }

    // Upload cover letter
    if (options.coverLetterPath) {
      await this.uploadFile(options.coverLetterPath, 'cover_letter');
    }

    // Fill custom questions
    const questionsResult =
      options.answeredQuestions && options.answeredQuestions.length > 0
        ? await filler.fillCustomQuestions(options.answeredQuestions)
        : { success: true, filledFields: [], skippedFields: [], errors: [] };

    // Platform-specific post-form-fill
    await this.postFormFill(options, filler, postFillErrors);

    // Platform-specific pre-submit actions
    await this.preSubmitActions(options, postFillErrors);

    // Profile integrity validation
    const integrityResult = await this.validateProfileIntegrity(options.profile);

    // Platform-specific pre-submit validation
    const validationResult = await this.validateBeforeSubmit();

    return {
      formResult,
      questionsResult,
      postFillErrors,
      integrityErrors: integrityResult.errors,
      validationErrors: validationResult.errors,
    };
  }

  /**
   * Navigate to the application form from the job posting page.
   * Override in platform-specific scrapers.
   */
  protected async navigateToApplicationForm(): Promise<void> {
    if (!this.page) return;

    // Common apply button selectors
    const applyButtonSelectors = [
      'a[href*="apply"]',
      'button:has-text("Apply")',
      '[class*="apply-button"]',
      '[data-test*="apply"]',
      'a:has-text("Apply Now")',
      'a:has-text("Apply for this job")',
      'button:has-text("Apply Now")',
      '.apply-btn',
      '#apply-button',
    ];

    for (const selector of applyButtonSelectors) {
      try {
        const button = await this.page.$(selector);
        if (button) {
          await this.humanDelay(true);
          await button.click();
          await this.page.waitForLoadState('domcontentloaded', { timeout: 60000 });
          return;
        }
      } catch {
        continue;
      }
    }
  }

  /**
   * Wait for the application form to load.
   * Override in platform-specific scrapers for better selectors.
   */
  protected async waitForApplicationForm(): Promise<void> {
    if (!this.page) return;

    const formSelectors = [
      'form[class*="application"]',
      'form[id*="application"]',
      'form[class*="apply"]',
      '[class*="application-form"]',
      'form',
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

  /**
   * Validate the form before submission.
   * Override in platform-specific scrapers for custom validation.
   */
  protected async validateBeforeSubmit(): Promise<{ valid: boolean; errors: string[] }> {
    if (!this.page) return { valid: false, errors: ['Page not initialized'] };

    const errors: string[] = [];

    // Check for any visible error messages
    const errorSelectors = [
      '.error-message',
      '[class*="error"]',
      '[role="alert"]',
      '.field-error',
      '.validation-error',
    ];

    for (const selector of errorSelectors) {
      const errorElements = await this.page.$$(selector);
      for (const el of errorElements) {
        const isVisible = await el.isVisible();
        if (isVisible) {
          const text = await el.textContent();
          if (text?.trim()) {
            errors.push(text.trim());
          }
        }
      }
    }

    // Check for required fields that are empty
    const requiredInputs = await this.page.$$(
      'input[required], textarea[required], select[required]'
    );
    for (const input of requiredInputs) {
      const value = await input.inputValue().catch(() => '');
      if (!value) {
        const label = await this.findLabelForInput(input);
        if (label) {
          errors.push(`Required field "${label}" is empty`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  protected async validateProfileIntegrity(
    profile: Profile
  ): Promise<{ valid: boolean; errors: string[] }> {
    const liveFormFields = await this.extractFormFields();
    const candidateFields = new Map<IdentityAssertionKey, FormField>();

    for (const field of liveFormFields) {
      const key = getIdentityAssertionKey(field);
      if (!key) continue;

      const existing = candidateFields.get(key);
      const currentValueLength = (field.value ?? '').trim().length;
      const existingValueLength = (existing?.value ?? '').trim().length;

      if (!existing || currentValueLength > existingValueLength) {
        candidateFields.set(key, field);
      }
    }

    const errors: string[] = [];
    for (const [key, field] of candidateFields) {
      const actualValue = field.value?.trim();
      if (!actualValue) continue;

      const expectedValue = getExpectedIdentityValue(profile, key);
      if (!expectedValue) continue;

      if (!matchesIdentityFieldValue(key, expectedValue, actualValue)) {
        const label = field.label || field.name || key;
        errors.push(`Identity field "${label}" does not match the saved profile`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Find and click the submit button.
   * Override in platform-specific scrapers for custom submit behavior.
   */
  protected async clickSubmitButton(): Promise<boolean> {
    if (!this.page) return false;

    const submitSelectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button:has-text("Submit")',
      'button:has-text("Submit Application")',
      'button:has-text("Apply")',
      'button:has-text("Send Application")',
      '[class*="submit-button"]',
      '[data-test*="submit"]',
      '#submit-button',
      '.btn-submit',
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

  /**
   * Check for a CAPTCHA challenge. Tries automated solving first, then falls
   * back to waiting for manual input.
   *
   * - Cloudflare JS challenges: solved automatically by the real Chromium
   *   browser, no API key required.
   * - reCAPTCHA v2/v3, hCaptcha: automated via 2captcha (requires
   *   TWOCAPTCHA_API_KEY env var), otherwise manual fallback.
   */
  protected async waitForCaptchaSolved(): Promise<boolean> {
    if (!this.page) return false;

    try {
      const { createCaptchaSolver, CaptchaSolver } =
        await import('../scraping-browser/captcha-solver');

      // --- Cloudflare full-page challenge (no iframe, just a title check) ---
      const isCFChallenge = await this.page.evaluate(() => {
        const title = document.title.toLowerCase();
        const bodyText = (document.body?.innerText ?? '').toLowerCase();
        const inlineScripts = Array.from(document.querySelectorAll('script:not([src])'))
          .map((s) => s.textContent ?? '')
          .join(' ');
        return (
          title === 'just a moment...' ||
          document.getElementById('challenge-running') !== null ||
          document.getElementById('challenge-form') !== null ||
          document.getElementById('challenge-error-text') !== null ||
          bodyText.includes('performing security verification') ||
          bodyText.includes('verifying you are human') ||
          bodyText.includes('enable javascript and cookies to continue') ||
          bodyText.includes('performance and security by cloudflare') ||
          inlineScripts.includes('_cf_chl_opt')
        );
      });

      if (isCFChallenge) {
        logger.info('Cloudflare challenge detected. Waiting for browser to pass it...');
        const solved = await CaptchaSolver.solveCloudflare(this.page);
        if (solved) {
          logger.success('Cloudflare challenge passed. Continuing...');
          await this.humanDelay(true);
          return true;
        }
        logger.warning('Cloudflare challenge did not resolve in time. Continuing anyway...');
        return false;
      }

      // --- Iframe-based CAPTCHAs (reCAPTCHA, hCaptcha, CF Turnstile widget) ---
      const captchaSelectors = [
        'iframe[src*="hcaptcha.com"]',
        'iframe[title*="hCaptcha"]',
        'iframe[src*="recaptcha"]',
        'iframe[title*="recaptcha" i]',
        'iframe[src*="challenges.cloudflare.com"]',
      ];

      let captchaIframe: import('playwright-core').ElementHandle | null = null;
      for (const selector of captchaSelectors) {
        const iframes = await this.page.$$(selector);
        for (const iframe of iframes) {
          if (await iframe.isVisible()) {
            captchaIframe = iframe;
            break;
          }
        }
        if (captchaIframe) break;
      }

      if (!captchaIframe) return false;

      // --- Automated solving ---
      const solver = createCaptchaSolver();
      if (solver) {
        logger.info('CAPTCHA detected. Attempting automated solve...');
        try {
          const solved = await solver.solvePage(this.page);
          if (solved) {
            logger.success('CAPTCHA solved automatically. Continuing...');
            await this.humanDelay(true);
            return true;
          }
          logger.warning('Automated CAPTCHA solve failed. Falling back to manual...');
        } catch (err) {
          logger.debug(`Automated CAPTCHA error: ${err}`);
        }
      }

      // --- Manual fallback ---
      logger.info('CAPTCHA detected! Please solve it manually in the browser window.');
      try {
        await captchaIframe.waitForElementState('hidden', { timeout: 120000 });
        logger.success('CAPTCHA appears to be solved! Continuing submission...');
        await this.humanDelay(true);
        return true;
      } catch {
        logger.warning('Timed out waiting for CAPTCHA to be solved manually. Continuing anyway...');
        return false;
      }
    } catch (error) {
      logger.debug(`Error checking for captcha: ${error}`);
      return false;
    }
  }

  /**
   * Wait for and verify submission confirmation.
   * Override in platform-specific scrapers for custom confirmation detection.
   */
  protected async waitForSubmissionConfirmation(): Promise<{ success: boolean; message: string }> {
    if (!this.page) return { success: false, message: 'Page not initialized' };

    try {
      // Wait for either success or error indicators
      const successSelectors = [
        '[class*="success"]',
        '[class*="confirmation"]',
        '[class*="thank"]',
        ':has-text("Application submitted")',
        ':has-text("Thank you")',
        ':has-text("successfully")',
        ':has-text("received your application")',
      ];

      const errorSelectors = [
        '[class*="error"]',
        '[role="alert"]',
        ':has-text("error")',
        ':has-text("failed")',
        ':has-text("try again")',
      ];

      // Wait for page to stabilize after submit
      await this.page.waitForLoadState('domcontentloaded').catch(() => {});
      await this.humanDelay();

      // Check for success indicators
      for (const selector of successSelectors) {
        try {
          const element = await this.page.$(selector);
          if (element) {
            const isVisible = await element.isVisible();
            if (isVisible) {
              const text = await element.textContent();
              return {
                success: true,
                message: text?.trim() || 'Application submitted successfully',
              };
            }
          }
        } catch {
          continue;
        }
      }

      // Check for error indicators
      for (const selector of errorSelectors) {
        try {
          const element = await this.page.$(selector);
          if (element) {
            const isVisible = await element.isVisible();
            if (isVisible) {
              const text = await element.textContent();
              return {
                success: false,
                message: text?.trim() || 'Submission may have failed',
              };
            }
          }
        } catch {
          continue;
        }
      }

      // Check if URL changed (common after successful submission)
      const currentUrl = this.page.url();
      if (
        currentUrl.includes('thank') ||
        currentUrl.includes('success') ||
        currentUrl.includes('confirm')
      ) {
        return { success: true, message: 'Application submitted (URL indicates success)' };
      }

      // No clear indicator found
      return {
        success: false,
        message: 'Could not confirm submission status (no clear success or error indicators found)',
      };
    } catch (error) {
      return {
        success: false,
        message: `Confirmation check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Handle multi-step application forms.
   * Some platforms (LinkedIn, Workday) have paginated forms.
   */
  protected async handleMultiStepForm(
    filler: FormFiller,
    formFields: FormField[],
    customQuestions: CustomQuestion[]
  ): Promise<FillResult> {
    if (!this.page) {
      return {
        success: false,
        filledFields: [],
        skippedFields: [],
        errors: ['Page not initialized'],
      };
    }

    const totalResult: FillResult = {
      success: true,
      filledFields: [],
      skippedFields: [],
      errors: [],
    };

    let hasNextButton = true;
    let stepCount = 0;
    const maxSteps = 10; // Prevent infinite loops

    while (hasNextButton && stepCount < maxSteps) {
      stepCount++;

      // Fill current page
      const pageResult = await filler.fillForm(formFields);
      totalResult.filledFields.push(...pageResult.filledFields);
      totalResult.skippedFields.push(...pageResult.skippedFields);
      totalResult.errors.push(...pageResult.errors);

      // Fill questions on current page
      const questionsResult = await filler.fillCustomQuestions(customQuestions);
      totalResult.filledFields.push(...questionsResult.filledFields);
      totalResult.skippedFields.push(...questionsResult.skippedFields);
      totalResult.errors.push(...questionsResult.errors);

      // Look for next/continue button
      const nextButton = await this.findNextButton();
      if (nextButton) {
        await this.humanDelay(true);
        await nextButton.click();
        await this.page.waitForLoadState('domcontentloaded').catch(() => {});
        await this.humanDelay(true);
      } else {
        hasNextButton = false;
      }
    }

    totalResult.success = totalResult.errors.length === 0;
    return totalResult;
  }

  /**
   * Find next/continue button in multi-step forms.
   */
  protected async findNextButton(): Promise<ReturnType<Page['$']>> {
    if (!this.page) return null;

    const nextSelectors = [
      'button:has-text("Next")',
      'button:has-text("Continue")',
      'button:has-text("Proceed")',
      '[class*="next-button"]',
      '[data-test*="next"]',
      'button[aria-label*="next"]',
    ];

    // Exclude submit buttons
    const submitTexts = ['submit', 'apply', 'send'];

    for (const selector of nextSelectors) {
      try {
        const button = await this.page.$(selector);
        if (button) {
          const isVisible = await button.isVisible();
          const isEnabled = await button.isEnabled();
          const text = await button.textContent();

          // Make sure it's not actually a submit button
          const isSubmit = submitTexts.some((t) => text?.toLowerCase().includes(t));
          if (isVisible && isEnabled && !isSubmit) {
            return button;
          }
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  /**
   * Upload a file to a dropzone or file input.
   */
  protected async uploadFile(filePath: string, type: 'resume' | 'cover_letter'): Promise<boolean> {
    if (!this.page) return false;

    // Determine selectors based on file type
    const patterns =
      type === 'resume' ? ['resume', 'cv', 'curriculum'] : ['cover', 'letter', 'motivation'];

    try {
      // Try to find specific file input
      const fileInputs = await this.page.$$('input[type="file"]');

      for (const input of fileInputs) {
        const name = await input.getAttribute('name');
        const id = await input.getAttribute('id');
        const accept = await input.getAttribute('accept');
        const label = await this.findLabelForInput(input);

        const combined = `${name} ${id} ${label}`.toLowerCase();
        const isMatch = patterns.some((p) => combined.includes(p));

        if (isMatch || (accept && (accept.includes('pdf') || accept.includes('doc')))) {
          await input.setInputFiles(filePath);
          await this.humanDelay(true);
          return true;
        }
      }

      // Try generic file input as fallback
      if (fileInputs.length > 0) {
        await fileInputs[0].setInputFiles(filePath);
        await this.humanDelay(true);
        return true;
      }

      // Try dropzone
      const dropzones = await this.page.$$(
        '[class*="dropzone"], [class*="upload"], [class*="drop-area"]'
      );
      for (const dropzone of dropzones) {
        const text = await dropzone.textContent();
        const isMatch = patterns.some((p) => text?.toLowerCase().includes(p));

        if (isMatch) {
          // Click to trigger file dialog
          const [fileChooser] = await Promise.all([
            this.page.waitForEvent('filechooser'),
            dropzone.click(),
          ]);
          await fileChooser.setFiles(filePath);
          await this.humanDelay(true);
          return true;
        }
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Hook for platform-specific post-form-fill actions (e.g., custom dropdowns).
   * Override in subclass.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected async postFormFill(
    _options: SubmissionOptions,
    _filler: FormFiller,
    _errors: string[]
  ): Promise<void> {
    // Override in platform-specific scrapers
  }

  /**
   * Hook for pre-submit validations and final touches (e.g., waiting for specific validations or captchas).
   * Override in subclass.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected async preSubmitActions(_options: SubmissionOptions, _errors: string[]): Promise<void> {
    // Override in platform-specific scrapers
  }
}

export interface ScraperConstructor {
  new (): BaseScraper;
}
