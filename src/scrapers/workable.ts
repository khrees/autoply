import { BaseScraper, type SubmissionOptions } from './base';
import type { JobData, CustomQuestion, Platform, Profile } from '../types';

export class WorkableScraper extends BaseScraper {
  platform: Platform = 'workable';

  protected override async waitForContent(): Promise<void> {
    if (!this.page) return;

    const contentSelectors = [
      '[data-test="job-header"]',
      '[data-test="job-description"]',
      '.job-details',
      '.job-info',
      'h1',
    ];

    for (const selector of contentSelectors) {
      try {
        await this.page.waitForSelector(selector, { timeout: 10000 });
        return;
      } catch {
        continue;
      }
    }

    await this.page.waitForTimeout(2000);
  }

  protected override async extractJobData(url: string): Promise<JobData> {
    if (!this.page) {
      return this.createEmptyJobData(url);
    }

    const title = await this.extractJobTitle();
    const company = await this.extractCompany(url);
    const description = await this.extractDescription();
    const location = await this.extractLocation();
    const requirements = this.extractRequirements(description);
    const qualifications = this.extractQualifications(description);
    const formFields = await this.extractWorkableFormFields();
    const customQuestions = await this.extractCustomQuestions();

    return {
      url,
      platform: this.platform,
      title,
      company,
      description,
      requirements,
      qualifications,
      location,
      form_fields: formFields,
      custom_questions: customQuestions,
    };
  }

  private async extractJobTitle(): Promise<string> {
    const selectors = [
      'h1[data-test="job-title"]',
      '[data-test="job-header"] h1',
      '.job-header h1',
      '.job-title',
      'h1',
    ];

    for (const selector of selectors) {
      const title = await this.extractText(selector);
      if (title) return title;
    }

    return 'Unknown Position';
  }

  private async extractCompany(url: string): Promise<string> {
    const selectors = [
      '[data-test="company-name"]',
      '[data-test="company"]',
      '.company-name',
      '.employer-name',
      '[class*="company-name"]',
      '[class*="employer"]',
    ];

    for (const selector of selectors) {
      const company = await this.extractText(selector);
      if (company && company.length > 1) return company;
    }

    const jobTitle = await this.extractText('h1, [data-test="job-title"]');
    if (jobTitle) {
      const atMatch = jobTitle.match(/\bat\s+(.+?)(?:\s*[-|]|$)/i);
      if (atMatch) {
        return atMatch[1].trim();
      }
    }

    const urlMatch = url.match(/apply\.workable\.com\/([^/]+)/);
    if (urlMatch) {
      let companySlug = urlMatch[1];
      companySlug = companySlug.replace(/-\d+$/, '');
      return companySlug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    }

    return 'Unknown Company';
  }

  private async extractDescription(): Promise<string> {
    const selectors = [
      '[data-test="job-description"]',
      '.job-description',
      '.job-details',
      '[class*="description"]',
    ];

    for (const selector of selectors) {
      const description = await this.extractText(selector);
      if (description) return description;
    }

    const fullPageText = await this.page?.evaluate(() => {
      const sections = document.querySelectorAll(
        '[data-test="job-section"], .job-section, section[class*="job"]'
      );
      return Array.from(sections)
        .map((s) => s.textContent?.trim())
        .filter(Boolean)
        .join('\n\n');
    });

    return fullPageText || '';
  }

  private async extractLocation(): Promise<string | undefined> {
    const selectors = [
      '[data-test="location"]',
      '.location',
      '.job-location',
      '[class*="location"]',
    ];

    for (const selector of selectors) {
      const location = await this.extractText(selector);
      if (location) return location;
    }

    return undefined;
  }

  private async extractWorkableFormFields(): Promise<JobData['form_fields']> {
    if (!this.page) return [];

    const fields: JobData['form_fields'] = [];

    const inputs = await this.page.$$('input:not([type="hidden"]):not([type="submit"])');
    for (const input of inputs) {
      const name = (await input.getAttribute('name')) ?? '';
      const type = ((await input.getAttribute('type')) ??
        'text') as JobData['form_fields'][0]['type'];
      const label = await this.findLabelForInput(input);
      const required = (await input.getAttribute('required')) !== null;

      if (name || label) {
        fields.push({ name, type, label, required });
      }
    }

    const textareas = await this.page.$$('textarea');
    for (const textarea of textareas) {
      const name = (await textarea.getAttribute('name')) ?? '';
      const label = await this.findLabelForInput(textarea);
      const required = (await textarea.getAttribute('required')) !== null;

      if (name || label) {
        fields.push({ name, type: 'textarea', label, required });
      }
    }

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

  private async extractCustomQuestions(): Promise<CustomQuestion[]> {
    if (!this.page) return [];

    const questions: CustomQuestion[] = [];

    const questionContainers = await this.page.$$(
      '[data-test="question"], .question, [class*="question"], fieldset'
    );

    for (const container of questionContainers) {
      const questionText = await container.evaluate((el) => {
        const label = el.querySelector('label, legend, [class*="label"]');
        return label?.textContent?.trim() || '';
      });

      if (!questionText) continue;

      const input = await container.$('input, select, textarea');
      let type: CustomQuestion['type'] = 'text';
      let options: string[] | undefined;

      if (input) {
        const inputType = await input.getAttribute('type');
        const tagName = await input.evaluate((el) => el.tagName);

        if (tagName === 'SELECT') {
          type = 'select';
          options = await input.$$eval('option', (opts) =>
            opts.map((o) => o.textContent?.trim() ?? '').filter(Boolean)
          );
        } else if (inputType === 'radio') {
          type = 'radio';
          options = await container.$$eval('input[type="radio"]', (radios) =>
            radios.map((r) => r.getAttribute('value') || '').filter(Boolean)
          );
        } else if (inputType === 'checkbox') {
          type = 'checkbox';
        } else if (tagName === 'TEXTAREA') {
          type = 'textarea';
        } else {
          type = 'text';
        }
      }

      const required = await container.evaluate((el) => {
        const requiredInput = el.querySelector(
          'input[required], select[required], textarea[required]'
        );
        return requiredInput !== null;
      });

      const id = questionText
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .slice(0, 50);

      questions.push({ id, question: questionText, type, required, options });
    }

    return questions;
  }

  protected override async navigateToApplicationForm(): Promise<void> {
    if (!this.page) return;

    const applyButtonSelectors = [
      'button:has-text("Apply")',
      'a:has-text("Apply")',
      '[data-test="apply-button"]',
      '.apply-button',
      'button[type="submit"]',
    ];

    for (const selector of applyButtonSelectors) {
      try {
        const button = await this.page.$(selector);
        if (button) {
          const isVisible = await button.isVisible();
          if (isVisible) {
            await this.humanDelay(true);
            await button.click();
            await this.page.waitForTimeout(1000);
            return;
          }
        }
      } catch {
        continue;
      }
    }

    await this.page.evaluate(() => {
      const form = document.querySelector('form');
      if (form) {
        form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
    await this.humanDelay(true);
  }

  protected override async waitForApplicationForm(): Promise<void> {
    if (!this.page) return;

    const formSelectors = [
      'form',
      '[data-test="application-form"]',
      '.application-form',
      '.job-application',
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

  protected override async postFormFill(
    options: SubmissionOptions,
    _filler: unknown,
    _errors: string[]
  ): Promise<void> {
    await this.fillWorkableUrls(options.profile);
    await this.fillCheckboxFields();
  }

  private async fillWorkableUrls(profile: Profile): Promise<void> {
    if (!this.page) return;

    if (profile.linkedin_url) {
      await this.fillInputBySelector(
        '[name*="linkedin"], [id*="linkedin"], [placeholder*="LinkedIn"]',
        profile.linkedin_url
      );
    }

    if (profile.github_url) {
      await this.fillInputBySelector(
        '[name*="github"], [id*="github"], [placeholder*="GitHub"]',
        profile.github_url
      );
    }

    if (profile.portfolio_url) {
      await this.fillInputBySelector(
        '[name*="portfolio"], [id*="portfolio"], [placeholder*="portfolio"]',
        profile.portfolio_url
      );
    }
  }

  private async fillCheckboxFields(): Promise<void> {
    if (!this.page) return;

    const consentCheckboxes = await this.page.$$(
      'input[type="checkbox"][name*="consent"], input[type="checkbox"][name*="agree"], input[type="checkbox"][name*="terms"]'
    );

    for (const checkbox of consentCheckboxes) {
      try {
        const isChecked = await checkbox.isChecked();
        if (!isChecked) {
          await checkbox.check();
          await this.humanDelay();
        }
      } catch {
        continue;
      }
    }
  }

  private async fillInputBySelector(selector: string, value: string): Promise<boolean> {
    if (!this.page) return false;

    try {
      const input = await this.page.$(selector);
      if (input) {
        await input.fill(value);
        await this.humanDelay();
        return true;
      }
    } catch {
      return false;
    }

    return false;
  }

  protected override async uploadFile(
    filePath: string,
    type: 'resume' | 'cover_letter'
  ): Promise<boolean> {
    if (!this.page) return false;

    const typeSelectors =
      type === 'resume'
        ? ['[name*="resume"], [name*="cv"], [id*="resume"]']
        : ['[name*="cover"], [name*="letter"], [id*="cover"]'];

    for (const selector of typeSelectors) {
      try {
        const fileInput = await this.page.$(selector);
        if (fileInput) {
          await fileInput.setInputFiles(filePath);
          await this.humanDelay(true);
          return true;
        }
      } catch {
        continue;
      }
    }

    const genericFileInput = await this.page.$('input[type="file"]');
    if (genericFileInput) {
      await genericFileInput.setInputFiles(filePath);
      await this.humanDelay(true);
      return true;
    }

    const uploadButtons = await this.page.$$(
      '[class*="upload"], [class*="attach"], button:has-text("Upload"), button:has-text("Attach")'
    );

    for (const button of uploadButtons) {
      try {
        const [fileChooser] = await Promise.all([
          this.page.waitForEvent('filechooser', { timeout: 5000 }),
          button.click(),
        ]);
        await fileChooser.setFiles(filePath);
        await this.humanDelay(true);
        return true;
      } catch {
        continue;
      }
    }

    return false;
  }

  protected override async clickSubmitButton(): Promise<boolean> {
    if (!this.page) return false;

    const submitSelectors = [
      'button[type="submit"]',
      'button:has-text("Submit")',
      'button:has-text("Apply")',
      'button:has-text("Send")',
      '[data-test="submit"]',
    ];

    for (const selector of submitSelectors) {
      try {
        const buttons = await this.page.$$(selector);
        for (const button of buttons) {
          const isVisible = await button.isVisible();
          const isEnabled = await button.isEnabled();
          const text = await button.textContent();

          if (isVisible && isEnabled && text) {
            const isSubmit = /submit|apply|send/i.test(text);
            if (isSubmit) {
              await this.humanDelay(true);
              await button.scrollIntoViewIfNeeded();
              await button.click();
              return true;
            }
          }
        }
      } catch {
        continue;
      }
    }

    return false;
  }

  protected override async waitForSubmissionConfirmation(): Promise<{
    success: boolean;
    message: string;
  }> {
    if (!this.page) return { success: false, message: 'Page not initialized' };

    try {
      const successSelectors = [
        '[data-test="success"]',
        '[class*="success"]',
        '[class*="thank"]',
        ':has-text("Application submitted")',
        ':has-text("Thank you")',
      ];

      for (const selector of successSelectors) {
        try {
          const element = await this.page.$(selector);
          if (element && (await element.isVisible())) {
            const text = await element.textContent();
            return { success: true, message: text?.trim() || 'Application submitted successfully' };
          }
        } catch {
          continue;
        }
      }

      const currentUrl = this.page.url();
      if (
        currentUrl.includes('thank') ||
        currentUrl.includes('success') ||
        currentUrl.includes('confirm')
      ) {
        return { success: true, message: 'Application submitted (URL indicates success)' };
      }

      return { success: false, message: 'Could not confirm submission' };
    } catch (error) {
      return {
        success: false,
        message: `Confirmation check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  private createEmptyJobData(url: string): JobData {
    return {
      url,
      platform: this.platform,
      title: 'Unknown Position',
      company: 'Unknown Company',
      description: '',
      requirements: [],
      qualifications: [],
      form_fields: [],
      custom_questions: [],
    };
  }
}
