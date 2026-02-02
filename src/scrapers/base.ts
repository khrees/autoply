import type { Browser, Page, BrowserContext } from 'playwright';
import { existsSync } from 'fs';
import type { JobData, FormField, CustomQuestion, Platform, Profile, GeneratedDocuments, AIProvider } from '../types';
import { configRepository } from '../db/repositories/config';
import { FormFiller, type FormFillerOptions, type FillResult } from '../core/form-filler';
import { extractJobDataWithAI, mergeJobData } from '../ai/job-extractor';

export interface SubmissionResult {
  success: boolean;
  message: string;
  screenshotPath?: string;
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

  async initialize(): Promise<void> {
    const config = configRepository.loadAppConfig();
    const { chromium } = await import('playwright');
    this.browser = await chromium.launch({
      headless: config.browser.headless,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
      ],
    });
    this.context = await this.browser.newContext({
      userAgent:
        'Mozilla/5.0 (Macintosh; Apple Silicon Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      storageState: config.browser.storageState && existsSync(config.browser.storageState)
        ? config.browser.storageState
        : undefined,
      viewport: { width: 1920, height: 1080 },
      locale: Intl.DateTimeFormat().resolvedOptions().locale || 'en-US',
      timezoneId: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    });

    // Mask automation indicators
    await this.context.addInitScript(() => {
      // Remove webdriver flag
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

      // Mock plugins (real browsers have these)
      Object.defineProperty(navigator, 'plugins', {
        get: () => [
          { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
          { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
          { name: 'Native Client', filename: 'internal-nacl-plugin' },
        ],
      });

      // Mock languages
      Object.defineProperty(navigator, 'languages', {
        get: () => navigator.language ? [navigator.language, 'en'] : ['en'],
      });

      // Hide automation-related Chrome properties
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters: PermissionDescriptor) => {
        if (parameters.name === 'notifications') {
          return Promise.resolve({ state: 'prompt', onchange: null } as PermissionStatus);
        }
        return originalQuery(parameters);
      };

      // Mask Chrome property
      (window as unknown as { chrome: unknown }).chrome = { runtime: {} };
    });

    this.page = await this.context.newPage();
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
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
    this.page = null;
  }

  async scrape(url: string, aiProvider?: AIProvider): Promise<JobData> {
    try {
      await this.initialize();
      if (!this.page) throw new Error('Browser not initialized');

      // Random delay before navigation
      await this.humanDelay();

      await this.page.goto(url, { waitUntil: 'networkidle' });

      // Simulate human behavior: mouse movement and scrolling
      await this.humanDelay(true);
      await this.page.mouse.move(
        Math.random() * 500 + 100,
        Math.random() * 300 + 100
      );
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
      await this.cleanup();
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

      if (name || label) {
        fields.push({ name, type, label, required });
      }
    }

    // Extract textareas
    const textareas = await this.page.$$('textarea');
    for (const textarea of textareas) {
      const name = (await textarea.getAttribute('name')) ?? '';
      const label = await this.findLabelForInput(textarea);
      const required = (await textarea.getAttribute('required')) !== null;

      if (name || label) {
        fields.push({ name, type: 'textarea', label, required });
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

      if (name || label) {
        fields.push({ name, type: 'select', label, required, options });
      }
    }

    return fields;
  }

  protected async findLabelForInput(input: unknown): Promise<string> {
    if (!this.page) return '';

    try {
      // Try to find associated label by id
      const id = await (input as { getAttribute: (attr: string) => Promise<string | null> }).getAttribute('id');
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
      const ariaLabel = await (input as { getAttribute: (attr: string) => Promise<string | null> }).getAttribute('aria-label');
      if (ariaLabel) return ariaLabel;

      // Try placeholder
      const placeholder = await (input as { getAttribute: (attr: string) => Promise<string | null> }).getAttribute('placeholder');
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

      if (
        lower.includes('requirement') ||
        lower.includes('must have') ||
        lower.includes('you will need')
      ) {
        inRequirements = true;
        continue;
      }

      if (
        inRequirements &&
        (lower.includes('nice to have') ||
          lower.includes('preferred') ||
          lower.includes('bonus') ||
          lower.includes('what we offer'))
      ) {
        inRequirements = false;
      }

      if (inRequirements && (trimmed.startsWith('-') || trimmed.startsWith('•') || trimmed.startsWith('*'))) {
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

      if (
        lower.includes('qualification') ||
        lower.includes('nice to have') ||
        lower.includes('preferred')
      ) {
        inQualifications = true;
        continue;
      }

      if (
        inQualifications &&
        (lower.includes('responsibilit') || lower.includes('what we offer') || lower.includes('benefit'))
      ) {
        inQualifications = false;
      }

      if (
        inQualifications &&
        (trimmed.startsWith('-') || trimmed.startsWith('•') || trimmed.startsWith('*'))
      ) {
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

  // ============ Form Submission Methods ============

  /**
   * Submit an application to this platform.
   * This method initializes the browser, navigates to the job URL,
   * fills the form, and submits it.
   */
  async submitApplication(url: string, options: SubmissionOptions): Promise<SubmissionResult> {
    const errors: string[] = [];

    try {
      await this.initialize();
      if (!this.page) throw new Error('Browser not initialized');

      // Navigate to job posting
      await this.humanDelay();
      await this.page.goto(url, { waitUntil: 'networkidle' });
      await this.humanDelay(true);
      await this.humanScroll();

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

      // Fill custom questions
      if (options.answeredQuestions && options.answeredQuestions.length > 0) {
        const questionsResult = await filler.fillCustomQuestions(options.answeredQuestions);
        if (questionsResult.errors.length > 0) {
          errors.push(...questionsResult.errors);
        }
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
      const config = configRepository.loadAppConfig();
      let screenshotPath: string | undefined;
      if (config.application.saveScreenshots) {
        const { getAutoplyDir } = await import('../db');
        const { join } = await import('path');
        screenshotPath = join(getAutoplyDir(), 'screenshots', `submission_${Date.now()}.png`);
        await this.takeScreenshot(screenshotPath);
      }

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
          await this.page.waitForLoadState('networkidle');
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
    const requiredInputs = await this.page.$$('input[required], textarea[required], select[required]');
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
        const button = await this.page.$(selector);
        if (button) {
          const isVisible = await button.isVisible();
          const isEnabled = await button.isEnabled();

          if (isVisible && isEnabled) {
            await this.humanDelay(true);
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
      await this.page.waitForLoadState('networkidle').catch(() => {});
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
      if (currentUrl.includes('thank') || currentUrl.includes('success') || currentUrl.includes('confirm')) {
        return { success: true, message: 'Application submitted (URL indicates success)' };
      }

      // No clear indicator - assume success if no errors
      return { success: true, message: 'Submission completed (no errors detected)' };
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
      return { success: false, filledFields: [], skippedFields: [], errors: ['Page not initialized'] };
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
        await this.page.waitForLoadState('networkidle').catch(() => {});
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
    const patterns = type === 'resume'
      ? ['resume', 'cv', 'curriculum']
      : ['cover', 'letter', 'motivation'];

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
      const dropzones = await this.page.$$('[class*="dropzone"], [class*="upload"], [class*="drop-area"]');
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
}

export interface ScraperConstructor {
  new (): BaseScraper;
}
