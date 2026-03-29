import { BaseScraper, type SubmissionOptions, type SubmissionResult } from './base';
import type { JobData, CustomQuestion, Platform, Profile } from '../types';
import { FormFiller } from '../core/form-filler';

export class BambooHRScraper extends BaseScraper {
  platform: Platform = 'bamboohr';

  protected async waitForContent(): Promise<void> {
    if (!this.page) return;
    // BambooHR career pages are JS-rendered React apps
    await this.page.waitForSelector('[class*="JobDetails"], [class*="jobDetails"], h2, .fab-Page', {
      timeout: 15000,
    }).catch(() => { });
    await this.page.waitForTimeout(2000);
  }

  protected async extractJobData(url: string): Promise<JobData> {
    if (!this.page) throw new Error('Page not initialized');

    const pageText = await this.page.evaluate(() => document.body.innerText);
    const pageTitle = await this.page.title();

    // Extract company from subdomain (e.g., fullbay.bamboohr.com -> Fullbay)
    const companyMatch = url.match(/\/\/([^.]+)\.bamboohr\.com/);
    let company = companyMatch ? companyMatch[1].charAt(0).toUpperCase() + companyMatch[1].slice(1) : 'Unknown Company';

    let title = 'Unknown Position';
    let description = pageText.slice(0, 4000);
    let requirements: string[] = [];
    let qualifications: string[] = [];
    let location: string | undefined;

    // Try AI extraction for better results
    try {
      const { createAIProvider } = await import('../ai/provider');
      const { configRepository } = await import('../db/repositories/config');
      const config = configRepository.loadAppConfig();
      const aiProvider = createAIProvider(config.ai);

      const response = await aiProvider.generateText(
        `Extract job posting data from this BambooHR page. Return ONLY valid JSON with these fields:
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
      // Fallback: try to extract title from page
      const h2Text = await this.extractText('h2');
      if (h2Text) title = h2Text;
      requirements = this.extractRequirements(description);
      qualifications = this.extractQualifications(description);
    }

    const formFields = await this.extractFormFields();
    const customQuestions = await this.extractBambooHRQuestions();

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
      const _profile = options.profile; // Unused for now
      await this.initialize(url);
      if (!this.page) throw new Error('Browser not initialized');

      // Navigate to job posting
      await this.humanDelay();
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await this.waitForContent();
      await this.humanDelay(true);
      await this.humanScroll();

      // Click "Apply for this Job" button
      await this.clickApplyButton();

      // Wait for application form to appear
      await this.waitForApplicationForm();
      await this.humanDelay(true);

      // Fill all detected form fields via FormFiller (handles prompts for unfillable required fields)
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
        await this.fillBambooHRBasicFields(options);
      }

      // Upload resume
      if (options.resumePath) {
        const uploaded = await this.uploadBambooHRResume(options.resumePath);
        if (!uploaded) {
          errors.push('Failed to upload resume');
        }
      }

      // Upload cover letter
      if (options.coverLetterPath) {
        await this.uploadBambooHRCoverLetter(options.coverLetterPath);
      }

      // Fill custom questions using FormFiller
      if (options.answeredQuestions && options.answeredQuestions.length > 0) {
        const questionsResult = await filler.fillCustomQuestions(options.answeredQuestions);
        if (questionsResult.errors.length > 0) {
          errors.push(...questionsResult.errors);
        }
      }

      // Fill remaining required fields (dropdowns, radios)
      await this.fillRemainingFields(options.profile);

      // Fill radio button questions (work authorization, sponsorship, etc.)
      await this.fillRadioQuestions();

      // Fill education fields (College/University)
      await this.fillBambooHREducation(options.profile);

      // Force-fill the State dropdown (BambooHR-specific)
      await this.forceSelectState();

      // Final pass: fill any remaining empty required fields
      await this.fillAllEmptyRequiredFields();

      await this.humanDelay(true);

      // Scroll to bottom to make sure all fields are visible/rendered
      await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await this.humanDelay(true);

      // Try to submit once to trigger validation, then fill any fields with errors
      await this.clickSubmitBtn();
      await this.page.waitForTimeout(2000);

      // Find error fields and fill them
      await this.fillErrorFields();

      // Scroll back up
      await this.page.evaluate(() => window.scrollTo(0, 0));
      await this.humanDelay(true);

      // Take a pre-submit screenshot for debugging
      const { configRepository: preConfig } = await import('../db/repositories/config');
      const preAppConfig = preConfig.loadAppConfig();
      if (preAppConfig.application.saveScreenshots) {
        const { getAutoplyDir: preDir } = await import('../db');
        const { join: preJoin } = await import('path');
        const preScreenshot = preJoin(preDir(), 'screenshots', `bamboohr_pre_${Date.now()}.png`);
        await this.takeScreenshot(preScreenshot);
      }

      // Submit
      const submitted = await this.clickSubmitBtn();
      if (!submitted) {
        return { success: false, message: 'Could not find or click submit button', errors };
      }

      // Wait for confirmation
      const confirmation = await this.waitForBambooHRConfirmation();

      // Take screenshot
      const { configRepository } = await import('../db/repositories/config');
      const config = configRepository.loadAppConfig();
      let screenshotPath: string | undefined;
      if (config.application.saveScreenshots) {
        const { getAutoplyDir } = await import('../db');
        const { join } = await import('path');
        screenshotPath = join(getAutoplyDir(), 'screenshots', `bamboohr_${Date.now()}.png`);
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
      return { success: false, message: 'BambooHR submission failed', errors };
    } finally {
      await this.cleanup();
    }
  }

  private async clickApplyButton(): Promise<void> {
    if (!this.page) return;

    const selectors = [
      'button:has-text("Apply for this Job")',
      'a:has-text("Apply for this Job")',
      'button:has-text("Apply")',
      'a:has-text("Apply")',
      '[class*="apply"] button',
      '[class*="Apply"]',
    ];

    for (const selector of selectors) {
      try {
        const button = await this.page.$(selector);
        if (button && await button.isVisible()) {
          await this.humanDelay(true);
          await button.click();
          await this.page.waitForLoadState('domcontentloaded').catch(() => { });
          await this.page.waitForTimeout(2000);
          return;
        }
      } catch {
        continue;
      }
    }
  }

  protected override async waitForApplicationForm(): Promise<void> {
    if (!this.page) return;

    const formSelectors = [
      'form',
      '[class*="ApplicationForm"]',
      '[class*="applicationForm"]',
      '[class*="application-form"]',
      '#applicationForm',
      'input[name*="firstName"], input[name*="first_name"]',
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

  private async fillBambooHRBasicFields(options: SubmissionOptions): Promise<void> {
    if (!this.page) return;
    const { profile } = options;

    const nameParts = profile.name.split(' ');
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(' ');

    // BambooHR uses various input patterns
    const fieldMappings: Array<{ selectors: string[]; value: string }> = [
      {
        selectors: [
          'input[name*="firstName"], input[name*="first_name"], input[id*="firstName"]',
          'input[placeholder*="First"], input[aria-label*="First"]',
        ],
        value: firstName,
      },
      {
        selectors: [
          'input[name*="lastName"], input[name*="last_name"], input[id*="lastName"]',
          'input[placeholder*="Last"], input[aria-label*="Last"]',
        ],
        value: lastName,
      },
      {
        selectors: [
          'input[name*="email"], input[type="email"], input[id*="email"]',
          'input[placeholder*="Email"], input[aria-label*="Email"]',
        ],
        value: profile.email,
      },
      {
        selectors: [
          'input[name*="phone"], input[type="tel"], input[id*="phone"]',
          'input[placeholder*="Phone"], input[aria-label*="Phone"]',
        ],
        value: profile.phone || '',
      },
      {
        selectors: [
          'input[name*="linkedin"], input[placeholder*="LinkedIn"], input[aria-label*="LinkedIn"]',
        ],
        value: profile.linkedin_url || '',
      },
      {
        selectors: [
          'input[name*="website"], input[name*="portfolio"], input[placeholder*="Website"]',
        ],
        value: profile.portfolio_url || '',
      },
    ];

    for (const { selectors, value } of fieldMappings) {
      if (!value) continue;
      for (const selector of selectors) {
        try {
          const input = await this.page.$(selector);
          if (input && await input.isVisible()) {
            await input.click();
            await input.fill(value);
            await this.humanDelay(true);
            break;
          }
        } catch {
          continue;
        }
      }
    }

    // BambooHR has separate address fields: Address, City, State (dropdown), ZIP, Country
    await this.fillBambooHRAddressFields(profile);

    // Fill Date Available (BambooHR date input)
    await this.fillDateAvailable();

    // Fill Desired Pay if present
    await this.fillInputIfEmpty(
      'input[name*="desiredPay" i], input[name*="desired_pay" i], input[name*="salary" i], input[id*="desiredPay" i]',
      '$25/hr'
    );
    // Also try by label text
    await this.fillFieldByLabel(/desired.*pay|salary|compensation/i, '$25/hr');

    // Fill expected graduation date
    await this.fillFieldByLabel(/graduation.*date|expected.*graduation/i, '2023');
    // Also try: "What is your expected graduation date?"
    await this.fillFieldByLabel(/graduation/i, '2023');

    // Fill any "how did you hear" or referral field
    await this.fillFieldByLabel(/who.*referred|referr/i, 'N/A');
  }

  private async fillDateAvailable(): Promise<void> {
    if (!this.page) return;

    try {
      const today = new Date();
      const isoDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const usDate = `${String(today.getMonth() + 1).padStart(2, '0')}/${String(today.getDate()).padStart(2, '0')}/${today.getFullYear()}`;

      // Find date input by label or type
      const dateInputs = await this.page.$$('input[type="date"]');
      for (const input of dateInputs) {
        if (await input.isVisible()) {
          const currentVal = await input.inputValue().catch(() => '');
          if (currentVal) continue;
          // Use JS to set value directly for date inputs
          await input.evaluate((el, val) => {
            (el as HTMLInputElement).value = val;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }, isoDate);
          await this.humanDelay(true);
          return;
        }
      }

      // Try text inputs with date-related labels
      await this.fillFieldByLabel(/date.*available|available.*date|start.*date/i, usDate);
    } catch {
      // ignore
    }
  }

  private async fillFieldByLabel(labelPattern: RegExp, value: string): Promise<boolean> {
    if (!this.page) return false;

    try {
      // Find all labels matching the pattern
      const labels = await this.page.$$('label');
      for (const label of labels) {
        const text = await label.textContent();
        if (!text || !labelPattern.test(text)) continue;

        const forId = await label.getAttribute('for');
        if (forId) {
          const input = await this.page.$(`#${forId}`);
          if (input && await input.isVisible()) {
            const currentVal = await input.inputValue().catch(() => '');
            if (!currentVal) {
              await input.click();
              await input.fill(value);
              await this.humanDelay(true);
              return true;
            }
          }
        }

        // Try sibling/child input
        const container = await label.evaluateHandle(el => el.closest('[class*="field"], .form-group, fieldset') || el.parentElement);
        const containerEl = container.asElement();
        if (containerEl) {
          const input = await containerEl.$('input:not([type="hidden"]):not([type="submit"]), textarea');
          if (input && await input.isVisible()) {
            const currentVal = await input.inputValue().catch(() => '');
            if (!currentVal) {
              await input.click();
              await input.fill(value);
              await this.humanDelay(true);
              return true;
            }
          }
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  private async fillBambooHRAddressFields(profile: Profile): Promise<void> {
    if (!this.page) return;

    // Parse location - e.g. "Lagos State, Nigeria"
    const location = profile.location || '';

    // Fill Address field (street address)
    await this.fillInputIfEmpty(
      'input[name*="address" i]:not([name*="email"]), input[id*="address" i]:not([id*="email"])',
      location || 'N/A'
    );

    // Fill City field
    await this.fillInputIfEmpty(
      'input[name*="city" i], input[id*="city" i]',
      location.split(',')[0]?.trim() || location
    );

    // Fill ZIP/Postal code
    await this.fillInputIfEmpty(
      'input[name*="zip" i], input[name*="postal" i], input[id*="zip" i]',
      '00000'
    );

    // Handle State and Country dropdowns
    // First change Country so State dropdown may update
    await this.handleCountryAndStateDropdowns(profile);
  }

  private async handleCountryAndStateDropdowns(profile: Profile): Promise<void> {
    if (!this.page) return;

    const location = profile.location || '';
    const country = location.split(',').pop()?.trim() || '';

    // Find all selects and identify them by label
    const selects = await this.page.$$('select');
    let countrySelect: typeof selects[0] | null = null;
    let stateSelect: typeof selects[0] | null = null;

    for (const select of selects) {
      const labelText = await this.page.evaluate((el) => {
        const id = el.id;
        const label = id ? document.querySelector(`label[for="${id}"]`) : null;
        if (label) return label.textContent?.trim() || '';
        const container = el.closest('[class*="field"], .form-group, fieldset');
        if (container) {
          const lbl = container.querySelector('label');
          if (lbl) return lbl.textContent?.trim() || '';
        }
        return el.getAttribute('aria-label') || '';
      }, select);

      if (/country/i.test(labelText?.trim() || '')) countrySelect = select;
      if (/^state/i.test(labelText?.trim() || '')) stateSelect = select;
    }

    // Change country first (may be a custom dropdown, not native select)
    if (countrySelect) {
      try {
        const options = await countrySelect.$$eval('option', (opts) =>
          opts.map((o) => ({ value: o.value, text: o.textContent?.trim() || '' }))
        );
        const match = country ? options.find((o) =>
          o.text.toLowerCase().includes(country.toLowerCase())
        ) : null;
        if (match?.value) {
          await countrySelect.selectOption(match.value);
          await this.humanDelay(true);
          if (this.page) {
            await this.page.waitForTimeout(1000);
          }
        }
      } catch {
        // Country might be a custom Fabric/React dropdown instead of native select
        // Try clicking and selecting from a custom dropdown
        await this.handleCustomCountryDropdown(country);
      }
    } else {
      // BambooHR often uses a custom dropdown for Country (not a native select)
      await this.handleCustomCountryDropdown(country);
    }

    // Handle State - try all selects with "State" in label or nearby text
    // Also try by direct attribute matching since label detection might miss it
    if (stateSelect) {
      try {
        const currentVal = await stateSelect.inputValue();
        if (!currentVal) {
          const options = await stateSelect.$$eval('option', (opts) =>
            opts.map((o) => ({ value: o.value, text: o.textContent?.trim() || '' }))
          );
          const validOption = options.find((o) =>
            o.value && !o.text.toLowerCase().includes('select') && !o.text.startsWith('--')
          );
          if (validOption) {
            await stateSelect.selectOption(validOption.value);
            await this.humanDelay(true);
          }
        }
      } catch {
        // ignore
      }
    } else {
      // Fallback: find select by looking at all selects with --Select-- placeholder
      for (const select of selects) {
        try {
          const currentVal = await select.inputValue();
          if (currentVal) continue;
          const placeholder = await select.$eval('option:first-child', (o) => o.textContent?.trim() || '');
          if (placeholder.toLowerCase().includes('select')) {
            const options = await select.$$eval('option', (opts) =>
              opts.map((o) => ({ value: o.value, text: o.textContent?.trim() || '' }))
            );
            const validOption = options.find((o) =>
              o.value && !o.text.toLowerCase().includes('select') && !o.text.startsWith('--')
            );
            if (validOption) {
              await select.selectOption(validOption.value);
              await this.humanDelay(true);
            }
          }
        } catch {
          continue;
        }
      }
    }
  }

  private async handleCustomCountryDropdown(country: string): Promise<void> {
    if (!this.page || !country) return;

    try {
      // BambooHR uses Fabric UI dropdowns - look for country-related custom dropdowns
      const countryContainers = await this.page.$$('[class*="Country"], [class*="country"]');
      for (const container of countryContainers) {
        // Click the dropdown trigger (the X button or the dropdown itself)
        const trigger = await container.$('[class*="indicator"], [class*="control"], [role="combobox"]');
        if (trigger) {
          await trigger.click();
          await this.humanDelay(true);

          // Type to search
          await this.page.keyboard.type(country, { delay: 50 });
          await this.page.waitForTimeout(500);

          // Select first matching option
          const option = await this.page.$('[class*="option"]:first-child, [role="option"]:first-child');
          if (option) {
            await option.click();
            await this.humanDelay(true);
            return;
          }

          await this.page.keyboard.press('Escape');
        }
      }
    } catch {
      // ignore
    }
  }

  private async fillInputIfEmpty(selector: string, value: string): Promise<boolean> {
    if (!this.page || !value) return false;

    try {
      const inputs = await this.page.$$(selector);
      for (const input of inputs) {
        if (await input.isVisible()) {
          const currentVal = await input.inputValue().catch(() => '');
          if (currentVal) continue;
          await input.click();
          await input.fill(value);
          await this.humanDelay(true);
          return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  private async uploadBambooHRResume(resumePath: string): Promise<boolean> {
    if (!this.page) return false;

    try {
      // Try file input directly
      const fileInputs = await this.page.$$('input[type="file"]');
      for (const input of fileInputs) {
        const parent = await input.evaluateHandle(el =>
          el.closest('[class*="resume"], [class*="Resume"], [class*="cv"], [class*="CV"], [class*="upload"], [class*="Upload"], .field')
        );
        const parentEl = parent.asElement();
        if (parentEl) {
          const text = await parentEl.textContent();
          if (text?.toLowerCase().match(/resume|cv|upload/)) {
            await input.setInputFiles(resumePath);
            await this.page.waitForTimeout(2000);
            return true;
          }
        }
      }

      // Try clicking upload areas
      const uploadSelectors = [
        'button:has-text("Upload")',
        '[class*="dropzone"]',
        '[class*="upload"]',
        '[class*="Dropzone"]',
        'label:has-text("Resume")',
        'label:has-text("CV")',
      ];

      for (const selector of uploadSelectors) {
        try {
          const el = await this.page.$(selector);
          if (el && await el.isVisible()) {
            const [fileChooser] = await Promise.all([
              this.page.waitForEvent('filechooser', { timeout: 5000 }),
              el.click(),
            ]);
            await fileChooser.setFiles(resumePath);
            await this.page.waitForTimeout(2000);
            return true;
          }
        } catch {
          continue;
        }
      }

      // Fallback: first file input
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

  private async uploadBambooHRCoverLetter(coverLetterPath: string): Promise<boolean> {
    if (!this.page) return false;

    try {
      const fileInputs = await this.page.$$('input[type="file"]');
      for (const input of fileInputs) {
        const parent = await input.evaluateHandle(el =>
          el.closest('[class*="cover"], [class*="Cover"], [class*="letter"], .field')
        );
        const parentEl = parent.asElement();
        if (parentEl) {
          const text = await parentEl.textContent();
          if (text?.toLowerCase().match(/cover|letter/)) {
            await input.setInputFiles(coverLetterPath);
            await this.page.waitForTimeout(2000);
            return true;
          }
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  private async fillRemainingFields(_profile: Profile): Promise<void> {
    if (!this.page) return;

    // Common BambooHR dropdown questions
    const questionPatterns = [
      { pattern: /authorized.*work|legally.*work|eligible.*work/i, answer: 'Yes' },
      { pattern: /sponsor|visa.*sponsor|require.*sponsor/i, answer: 'No' },
      { pattern: /relocat/i, answer: 'Yes' },
      { pattern: /18.*years|legal.*age/i, answer: 'Yes' },
      { pattern: /background.*check/i, answer: 'Yes' },
      { pattern: /gender|pronouns/i, answer: 'Decline to self identify' },
      { pattern: /veteran|military/i, answer: 'I am not' },
      { pattern: /disability|disabled/i, answer: "I don't wish to answer" },
      { pattern: /race|ethnicity|hispanic/i, answer: 'Decline to self identify' },
      { pattern: /how.*hear|where.*find|source/i, answer: 'Job Board' },
      { pattern: /salary|compensation|desired.*pay/i, answer: '' },
    ];

    // Handle select dropdowns
    const selects = await this.page.$$('select');
    for (const select of selects) {
      try {
        const value = await select.inputValue();
        if (value) continue;

        const labelText = await this.page.evaluate((el) => {
          const id = el.id;
          let label = id ? document.querySelector(`label[for="${id}"]`) : null;
          if (label) return label.textContent?.trim() || '';
          const container = el.closest('.field, .form-group, fieldset, [class*="field"], [class*="question"]');
          if (container) {
            label = container.querySelector('label, .field-label, legend');
            if (label) return label.textContent?.trim() || '';
          }
          return el.getAttribute('aria-label') || el.getAttribute('placeholder') || '';
        }, select);

        if (!labelText) continue;

        for (const { pattern, answer } of questionPatterns) {
          if (pattern.test(labelText) && answer) {
            const options = await select.$$eval('option', (opts) =>
              opts.map((o) => ({ value: o.value, text: o.textContent?.trim() || '' }))
            );
            const match = options.find((opt) => {
              const t = opt.text.toLowerCase();
              const a = answer.toLowerCase();
              return t === a || t.includes(a) || a.includes(t);
            });
            if (match?.value) {
              await select.selectOption(match.value);
              await this.humanDelay(true);
            }
            break;
          }
        }
      } catch {
        continue;
      }
    }
  }

  private async fillRadioQuestions(): Promise<void> {
    if (!this.page) return;

    const radioPatterns = [
      { pattern: /authorized.*work|legally.*work/i, answer: 'yes' },
      { pattern: /sponsor|visa.*sponsor|require.*sponsor|H-1B/i, answer: 'yes' },
      { pattern: /comfortable.*part.?time|part.?time.*capacity/i, answer: 'yes' },
      { pattern: /18.*years|legal.*age/i, answer: 'yes' },
      { pattern: /background.*check/i, answer: 'yes' },
      { pattern: /relocat/i, answer: 'yes' },
      { pattern: /interviewed.*before|applied.*before/i, answer: 'no' },
      { pattern: /reside.*following.*states|currently.*reside/i, answer: 'no' },
      { pattern: /criminal|conviction|felony/i, answer: 'no' },
      { pattern: /drug.*test/i, answer: 'yes' },
      { pattern: /non.?compete|non.?disclosure/i, answer: 'no' },
    ];

    // Find all radio question groups by looking for question text followed by radio buttons
    const allRadios = await this.page.$$('input[type="radio"]');
    const processedNames = new Set<string>();

    for (const radio of allRadios) {
      try {
        const name = await radio.getAttribute('name');
        if (!name || processedNames.has(name)) continue;
        processedNames.add(name);

        // Check if already answered
        const checked = await this.page.$(`input[name="${name}"]:checked`);
        if (checked) continue;

        // Find the question text — look at parent containers
        const questionText = await radio.evaluate((el) => {
          let container = el.closest('fieldset, [class*="question"], [class*="field"], .form-group');
          if (!container) container = el.parentElement?.parentElement?.parentElement ?? null;
          if (!container) return '';

          // Get text that's NOT from radio labels
          const legend = container.querySelector('legend, h3, h4, p, [class*="label"]');
          if (legend) return legend.textContent?.trim() || '';
          return container.textContent?.trim().split('\n')[0] || '';
        });

        if (!questionText) continue;

        // Match against patterns
        for (const { pattern, answer } of radioPatterns) {
          if (pattern.test(questionText)) {
            // Find the matching radio button
            const radios = await this.page.$$(`input[name="${name}"]`);
            for (const r of radios) {
              const value = await r.getAttribute('value');
              const label = await r.evaluate((el) => {
                const lbl = el.closest('label') || document.querySelector(`label[for="${el.id}"]`);
                return lbl?.textContent?.trim().toLowerCase() || el.getAttribute('value')?.toLowerCase() || '';
              });

              if (label === answer || value?.toLowerCase() === answer) {
                await r.scrollIntoViewIfNeeded();
                await r.check({ force: true });
                await this.humanDelay(true);
                break;
              }
            }
            break;
          }
        }
      } catch {
        continue;
      }
    }
  }

  private async forceSelectState(): Promise<void> {
    if (!this.page) return;

    try {
      // BambooHR uses Fabric UI dropdowns - the visible "--Select--" is a custom
      // div-based dropdown, not the native <select>. The native <select> has only 1 option.
      // We need to find the Fabric UI dropdown trigger and interact with it.

      // Find all Fabric dropdown triggers that show "--Select--"
      const dropdownTriggers = await this.page.$$('[class*="fab-Select"] [class*="trigger"], [class*="fab-Select"] button, [class*="Select__control"], [role="combobox"]');

      for (const trigger of dropdownTriggers) {
        try {
          if (!await trigger.isVisible()) continue;
          const text = await trigger.textContent();
          if (!text?.includes('Select')) continue;

          // Check if this is the State dropdown by looking at the label
          const labelText = await trigger.evaluate((el) => {
            const container = el.closest('[class*="field"], [class*="Field"], .form-group, [class*="fab-FormField"]');
            if (container) {
              const label = container.querySelector('label');
              return label?.textContent?.trim() || '';
            }
            return '';
          });

          if (/state/i.test(labelText)) {
            await trigger.scrollIntoViewIfNeeded();
            await trigger.click();
            await this.page.waitForTimeout(500);

            // Look for dropdown options
            const option = await this.page.$('[class*="fab-SelectOption"]:not([class*="disabled"]), [class*="option"]:not([class*="disabled"]), [role="option"]');
            if (option) {
              await option.click();
              await this.humanDelay(true);
              continue;
            }

            // Try keyboard
            await this.page.keyboard.press('ArrowDown');
            await this.page.waitForTimeout(200);
            await this.page.keyboard.press('Enter');
            await this.humanDelay(true);
          }
        } catch {
          continue;
        }
      }

      // Also try: find elements with text "--Select--" that look like dropdown buttons
      const selectButtons = await this.page.$$('button, [role="button"], [tabindex="0"]');
      for (const btn of selectButtons) {
        try {
          if (!await btn.isVisible()) continue;
          const text = await btn.textContent();
          if (!text?.includes('Select')) continue;

          // Check parent for "State" label
          const isState = await btn.evaluate((el) => {
            const container = el.closest('[class*="field"], [class*="Field"]');
            if (container) {
              const label = container.querySelector('label');
              return /state/i.test(label?.textContent || '');
            }
            return false;
          });

          if (isState) {
            await btn.scrollIntoViewIfNeeded();
            await btn.click();
            await this.page.waitForTimeout(500);

            // Select first option in the dropdown menu
            const menuOption = await this.page.$('[role="option"], [class*="Option"], [class*="option"], li[class*="item"]');
            if (menuOption) {
              await menuOption.click();
              await this.humanDelay(true);
            } else {
              await this.page.keyboard.press('ArrowDown');
              await this.page.waitForTimeout(200);
              await this.page.keyboard.press('Enter');
              await this.humanDelay(true);
            }
          }
        } catch {
          continue;
        }
      }
    } catch {
      // ignore
    }
  }

  private async fillBambooHREducation(_profile: Profile): Promise<void> {
    if (!this.page) return;

    const education = _profile.education?.[0];
    const institution = education?.institution || 'Ladoke Akintola University of Technology';
    const degree = education?.degree || 'B.Tech in Computer Science';

    // Fill College/University field
    await this.fillFieldByLabel(/college|university|school|institution/i, institution);

    // Fill Degree field if present
    await this.fillFieldByLabel(/degree|qualification/i, degree);

    // Fill field of study if present
    if (education?.field) {
      await this.fillFieldByLabel(/field.*study|major|discipline/i, education.field);
    }
  }

  private async fillAllEmptyRequiredFields(): Promise<void> {
    if (!this.page) return;

    // Find all visible required inputs that are still empty
    const requiredInputs = await this.page.$$('input[required]:not([type="hidden"]):not([type="file"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"])');
    for (const input of requiredInputs) {
      try {
        if (!await input.isVisible()) continue;
        const currentVal = await input.inputValue().catch(() => '');
        if (currentVal) continue;

        // Get the type to determine what value to fill
        const type = await input.getAttribute('type') || 'text';
        const labelText = await this.findLabelForInput(input);

        if (type === 'date') {
          const today = new Date();
          const isoDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
          await input.evaluate((el, val) => {
            (el as HTMLInputElement).value = val;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }, isoDate);
        } else {
          // Fill with a sensible default based on label
          let defaultVal = 'N/A';
          if (/college|university|school/i.test(labelText)) defaultVal = 'Ladoke Akintola University of Technology';
          else if (/degree/i.test(labelText)) defaultVal = 'B.Tech in Computer Science';
          else if (/gpa/i.test(labelText)) defaultVal = '3.5';
          else if (/graduation/i.test(labelText)) defaultVal = '2023';
          await input.fill(defaultVal);
        }
        await this.humanDelay(true);
      } catch {
        continue;
      }
    }

    // Handle required selects that are still empty
    const requiredSelects = await this.page.$$('select[required], select');
    for (const select of requiredSelects) {
      try {
        if (!await select.isVisible()) continue;
        const currentVal = await select.inputValue();
        if (currentVal) continue;

        // Select first non-placeholder option
        const options = await select.$$eval('option', (opts) =>
          opts.map((o) => ({ value: o.value, text: o.textContent?.trim() || '' }))
        );
        const validOption = options.find((o) =>
          o.value && !o.text.toLowerCase().includes('select') && !o.text.startsWith('--') && o.text !== ''
        );
        if (validOption) {
          await select.selectOption(validOption.value);
          await this.humanDelay(true);
        }
      } catch {
        continue;
      }
    }

    // Handle required textareas that are still empty
    const requiredTextareas = await this.page.$$('textarea[required]');
    for (const textarea of requiredTextareas) {
      try {
        if (!await textarea.isVisible()) continue;
        const currentVal = await textarea.inputValue().catch(() => '');
        if (currentVal) continue;
        await textarea.fill('N/A');
        await this.humanDelay(true);
      } catch {
        continue;
      }
    }
  }

  private async fillErrorFields(): Promise<void> {
    if (!this.page) return;

    try {
      // BambooHR shows "Please fill in this field." errors next to empty required fields
      // Find all visible inputs/textareas that are empty and near error messages
      const emptyInputs = await this.page.$$('input:not([type="hidden"]):not([type="file"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"])');

      for (const input of emptyInputs) {
        try {
          if (!await input.isVisible()) continue;
          const val = await input.inputValue().catch(() => '');
          if (val) continue;

          // Get label text to determine what to fill
          const labelText = await input.evaluate((el) => {
            // Look for label in the parent container
            const container = el.closest('[class*="field"], [class*="Field"], .form-group') || el.parentElement;
            if (container) {
              const label = container.querySelector('label, [class*="label"], [class*="Label"]');
              if (label) return label.textContent?.trim() || '';
            }
            // Try previous sibling text
            const prev = el.previousElementSibling;
            if (prev) return prev.textContent?.trim() || '';
            return el.getAttribute('placeholder') || el.getAttribute('aria-label') || '';
          });

          let value = 'N/A';
          if (/graduation/i.test(labelText)) value = '2023';
          else if (/date/i.test(labelText)) value = '01/30/2026';
          else if (/salary|pay|compensation/i.test(labelText)) value = '$25/hr';
          else if (/college|university/i.test(labelText)) value = 'Ladoke Akintola University of Technology';

          await input.scrollIntoViewIfNeeded();
          await input.click();
          await input.fill(value);
          await this.humanDelay(true);
        } catch {
          continue;
        }
      }
    } catch {
      // ignore
    }
  }

  private async clickSubmitBtn(): Promise<boolean> {
    if (!this.page) return false;

    const submitSelectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button:has-text("Submit")',
      'button:has-text("Submit Application")',
      'button:has-text("Save")',
      '[class*="submit"] button',
      'button:has-text("Apply")',
    ];

    for (const selector of submitSelectors) {
      try {
        const button = await this.page.$(selector);
        if (button && await button.isVisible() && await button.isEnabled()) {
          await this.humanDelay(true);
          await button.click();
          return true;
        }
      } catch {
        continue;
      }
    }
    return false;
  }

  private async waitForBambooHRConfirmation(): Promise<{ success: boolean; message: string }> {
    if (!this.page) return { success: false, message: 'Page not initialized' };

    try {
      await this.page.waitForLoadState('domcontentloaded').catch(() => { });
      await this.humanDelay();

      const successSelectors = [
        '[class*="success"]',
        '[class*="confirmation"]',
        '[class*="thank"]',
        ':has-text("Thank you")',
        ':has-text("Application submitted")',
        ':has-text("successfully")',
        ':has-text("received your application")',
        ':has-text("We have received")',
      ];

      for (const selector of successSelectors) {
        try {
          const el = await this.page.$(selector);
          if (el && await el.isVisible()) {
            const text = await el.textContent();
            return { success: true, message: text?.trim() || 'Application submitted to BambooHR' };
          }
        } catch {
          continue;
        }
      }

      const currentUrl = this.page.url();
      if (currentUrl.includes('thank') || currentUrl.includes('success') || currentUrl.includes('confirm')) {
        return { success: true, message: 'Application submitted successfully' };
      }

      return { success: false, message: 'Could not confirm submission status (no clear success indicator found)' };
    } catch (error) {
      return {
        success: false,
        message: `Confirmation check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  private async extractBambooHRQuestions(): Promise<CustomQuestion[]> {
    if (!this.page) return [];

    const questions: CustomQuestion[] = [];
    const questionContainers = await this.page.$$(
      '[class*="question"], [class*="custom-field"], .field-group, [class*="Question"]'
    );

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
      let opts: string[] | undefined;

      if (hasTextarea) {
        type = 'textarea';
      } else if (hasSelect) {
        type = 'select';
        opts = await container.$$eval('select option', (o) =>
          o.map((e) => e.textContent?.trim() ?? '').filter(Boolean)
        );
      } else if (hasRadio) {
        type = 'radio';
      }

      const required = (await container.$('[required]')) !== null;
      questions.push({ id: `bamboohr_q_${i}`, question: questionText, type, required, options: opts });
    }

    return questions;
  }
}
