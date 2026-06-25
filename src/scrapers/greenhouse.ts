import { BaseScraper, type SubmissionOptions, type SubmissionResult } from './base';
import type { AIProvider, JobData, CustomQuestion, Platform, Profile } from '../types';
import { FormFiller } from '../core/form-filler';
import { analyzeAndFillFormFields } from '../ai/form-analyzer';
import { createAIProvider } from '../ai/provider';
import { logger } from '../utils/logger';

export function normalizeGreenhouseCompanyName(company: string): string {
  const trimmed = company.trim().replace(/\s+/g, ' ');
  if (!trimmed) return 'Unknown Company';

  const strippedLeadingAt = trimmed.match(/^at\s+([^\s].*)$/i)?.[1] ?? trimmed;

  return strippedLeadingAt
    .split(' ')
    .map((word) => {
      if (!word) return word;
      if (word === word.toUpperCase()) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

export class GreenhouseScraper extends BaseScraper {
  platform: Platform = 'greenhouse';
  private autoMode = false;

  protected override async waitForContent(): Promise<void> {
    if (!this.page) return;

    // Check if we need to navigate into an iframe for embedded Greenhouse forms
    const currentUrl = this.page.url();
    // During scraping, we want to stay on the host page to get better metadata (company, title, description)
    // We only redirect to the actual Greenhouse form URL during filling/submission
    if (!this.isScraping && !currentUrl.includes('greenhouse.io')) {
      const ghFrame = this.page.frames().find((f) => f.url().includes('greenhouse.io'));
      if (ghFrame) {
        await this.page.goto(ghFrame.url(), { waitUntil: 'domcontentloaded' });
        await this.humanDelay(true);
      }
    }

    await this.page
      .waitForSelector('#app_body, .app-body, [data-mapped="true"], h1', {
        timeout: 10000,
      })
      .catch(() => {});
    // Wait for JS rendering to settle
    await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  }

  override async scrape(url: string, aiProvider?: AIProvider): Promise<JobData> {
    this.browserSelectionUrl = url;
    try {
      return await super.scrape(this.resolveGreenhouseUrl(url), aiProvider);
    } finally {
      this.browserSelectionUrl = null;
    }
  }

  override async submitApplication(
    url: string,
    options: SubmissionOptions
  ): Promise<SubmissionResult> {
    this.browserSelectionUrl = url;
    try {
      const resolvedUrl = this.resolveGreenhouseUrl(url);
      this.autoMode = !!options.autoMode;
      return await super.submitApplication(resolvedUrl, options);
    } finally {
      this.browserSelectionUrl = null;
    }
  }

  override async fillApplication(
    url: string,
    options: SubmissionOptions
  ): Promise<import('./base').FillApplicationResult> {
    this.browserSelectionUrl = url;
    try {
      const resolvedUrl = this.resolveGreenhouseUrl(url);
      this.autoMode = !!options.autoMode;
      return await super.fillApplication(resolvedUrl, options);
    } finally {
      this.browserSelectionUrl = null;
    }
  }

  // ============ Greenhouse-specific Form Submission ============

  /**
   * Greenhouse typically has the application form on the same page as the job posting,
   * or accessible via an "Apply" button that scrolls to or reveals the form.
   */
  protected override async navigateToApplicationForm(): Promise<void> {
    if (!this.page) return;

    // Greenhouse forms are usually embedded on the page
    // Look for "Apply for this job" or similar buttons
    const applyButtonSelectors = [
      '#apply_button',
      'a[href*="#app"]',
      'button:has-text("Apply")',
      'a:has-text("Apply for this job")',
      '.application-button',
      '[data-test="apply-button"]',
    ];

    for (const selector of applyButtonSelectors) {
      try {
        const button = await this.page.$(selector);
        if (button) {
          const isVisible = await button.isVisible();
          if (isVisible) {
            await this.humanDelay(true);
            await button.click();
            await this.page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
            return;
          }
        }
      } catch (e) {
        logger.debug(
          `Apply button selector "${selector}" failed: ${e instanceof Error ? e.message : e}`,
          {},
          'scraper'
        );
        continue;
      }
    }

    // If no apply button, scroll to the form (it might already be visible)
    await this.page.evaluate(() => {
      const form = document.querySelector(
        '#application_form, form[id*="application"], form[class*="application"]'
      );
      if (form) {
        form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
    await this.humanDelay(true);
  }

  protected override async waitForApplicationForm(): Promise<void> {
    if (!this.page) return;

    const formSelectors = [
      '#application_form',
      '#application',
      'form[id*="application"]',
      '.application-form',
      '#main_fields',
    ];

    for (const selector of formSelectors) {
      try {
        await this.page.waitForSelector(selector, { timeout: 5000 });
        return;
      } catch {
        continue;
      }
    }
  }

  protected override async postFormFill(
    options: SubmissionOptions,
    _filler: FormFiller,
    _errors: string[]
  ): Promise<void> {
    // Fill LinkedIn/Website fields
    await this.fillGreenhouseUrls(options);

    // Handle education and work history sections if they exist
    await this.fillGreenhouseEducation(options);

    // Handle any remaining required fields (select dropdowns, radio buttons)
    await this.fillRemainingRequiredFields(options.profile);

    // Fill checkboxes (Acknowledge, GDPR consent, "How did you hear")
    await this.fillCheckboxFields();

    // Fill "Preferred First Name" if present
    await this.fillPreferredFirstName(options.profile);

    // Fill any remaining empty text inputs with smart defaults
    await this.fillRemainingEmptyInputs(options.profile);

    // Fill Gender dropdown specifically (often missed by generic handlers)
    await this.fillGenderDropdown();

    // Use AI to analyze and fill any remaining unfilled fields
    await this.fillUnfilledFieldsWithAI(options.profile);

    // Try to solve reCAPTCHA checkbox
    await this.handleRecaptcha();

    // Scroll through the form to ensure all fields are visible
    if (this.page) {
      await this.page.evaluate(() => {
        const form = document.querySelector('#application_form, form');
        if (form) form.scrollIntoView({ behavior: 'instant', block: 'end' });
      });
      await this.humanDelay(true);
      await this.page.evaluate(() => window.scrollTo(0, 0));
      await this.humanDelay(true);
    }
  }

  protected override async preSubmitActions(
    _options: SubmissionOptions,
    _errors: string[]
  ): Promise<void> {
    if (!this.page) return;

    if (process.env.DEBUG_GREENHOUSE || process.env.DEBUG) {
      try {
        const { getAutoplyDir } = await import('../db');
        const { join } = await import('path');
        const preSubmitPath = join(
          getAutoplyDir(),
          'screenshots',
          `greenhouse_pre_submit_${Date.now()}.png`
        );
        await this.takeScreenshot(preSubmitPath);

        const emptyFields = await this.page.evaluate(() => {
          const results: string[] = [];
          document
            .querySelectorAll(
              'input:not([type="hidden"]):not([type="file"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"])'
            )
            .forEach((el) => {
              const input = el as HTMLInputElement;
              if (input.offsetParent !== null && !input.value) {
                const label =
                  input
                    .closest('.field, .form-group, div')
                    ?.querySelector('label')
                    ?.textContent?.trim() ||
                  input.name ||
                  input.id;
                results.push(`Empty input: ${label}`);
              }
            });
          document.querySelectorAll('input[type="checkbox"]:not(:checked)').forEach((el) => {
            const cb = el as HTMLInputElement;
            if (cb.offsetParent !== null) {
              const label =
                cb.closest('label')?.textContent?.trim() ||
                document.querySelector(`label[for="${cb.id}"]`)?.textContent?.trim() ||
                cb.name;
              results.push(`Unchecked checkbox: ${label}`);
            }
          });
          document.querySelectorAll('select').forEach((el) => {
            const sel = el as HTMLSelectElement;
            if (sel.offsetParent !== null && !sel.value) {
              results.push(`Empty select: ${sel.name || sel.id}`);
            }
          });
          document.querySelectorAll('[class*="placeholder"]').forEach((el) => {
            if ((el as HTMLElement).offsetParent !== null) {
              const container = el.closest('.field, .form-group, div');
              const label = container?.querySelector('label')?.textContent?.trim() || 'unknown';
              const classes = el.className;
              const parentClasses = el.parentElement?.className || '';
              results.push(
                `Unfilled React Select: label="${label}" classes="${classes}" parentClasses="${parentClasses}"`
              );
            }
          });
          return results;
        });
        logger.debug('Greenhouse empty fields before submit', { emptyFields }, 'scraper');
      } catch (err) {
        logger.debug('Error collecting Greenhouse debug info', { err }, 'scraper');
      }
    }
  }

  protected override async uploadFile(
    filePath: string,
    type: 'resume' | 'cover_letter'
  ): Promise<boolean> {
    if (!this.page) return false;

    if (type === 'resume') {
      try {
        // First try: Find any file input and check if it's for resume
        const allFileInputs = await this.page.$$('input[type="file"]');
        for (const input of allFileInputs) {
          // Check if this input is related to resume by looking at parent/sibling elements
          const parent = await input.evaluateHandle((el) =>
            el.closest('[class*="resume"], [id*="resume"], [data-field*="resume"], .field')
          );
          const parentEl = parent.asElement();
          if (parentEl) {
            const text = await parentEl.textContent();
            if (text?.toLowerCase().includes('resume') || text?.toLowerCase().includes('cv')) {
              await input.setInputFiles(filePath);
              await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
              await this.humanDelay(true);
              return true;
            }
          }
        }

        // Second try: Use specific selectors
        const resumeSelectors = [
          '#resume_upload input[type="file"]',
          '#s3_upload_for_resume input[type="file"]',
          'input[type="file"][name*="resume"]',
          '#resume input[type="file"]',
          '[data-field="resume"] input[type="file"]',
          '.field:has-text("Resume") input[type="file"]',
          '.field:has-text("CV") input[type="file"]',
        ];

        for (const selector of resumeSelectors) {
          try {
            const fileInput = await this.page.$(selector);
            if (fileInput) {
              await fileInput.setInputFiles(filePath);
              await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
              await this.humanDelay(true);
              return true;
            }
          } catch {
            continue;
          }
        }

        // Third try: Click on upload area and use file chooser
        const uploadAreas = await this.page.$$(
          '[class*="resume"] [class*="upload"], #resume_upload, .attach-or-paste, button:has-text("Attach"), button:has-text("Upload")'
        );
        for (const area of uploadAreas) {
          try {
            const [fileChooser] = await Promise.all([
              this.page.waitForEvent('filechooser', { timeout: 5000 }),
              area.click(),
            ]);
            await fileChooser.setFiles(filePath);
            await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
            return true;
          } catch {
            continue;
          }
        }

        // Fourth try: Just use the first file input on the page
        if (allFileInputs.length > 0) {
          await allFileInputs[0].setInputFiles(filePath);
          await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
          return true;
        }

        return false;
      } catch {
        return false;
      }
    } else if (type === 'cover_letter') {
      try {
        const coverLetterSelectors = [
          '#cover_letter_upload input[type="file"]',
          '#s3_upload_for_cover_letter input[type="file"]',
          'input[type="file"][name*="cover"]',
          '[data-field="cover_letter"] input[type="file"]',
        ];

        for (const selector of coverLetterSelectors) {
          const fileInput = await this.page.$(selector);
          if (fileInput) {
            await fileInput.setInputFiles(filePath);
            await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
            await this.humanDelay(true);
            return true;
          }
        }

        return false;
      } catch {
        return false;
      }
    }
    return false;
  }

  private async fillGreenhouseUrls(options: SubmissionOptions): Promise<void> {
    if (!this.page) return;

    const { profile } = options;

    // LinkedIn
    if (profile.linkedin_url) {
      await this.fillInputBySelector(
        'input[name*="linkedin"], input[id*="linkedin"], input[placeholder*="LinkedIn"]',
        profile.linkedin_url
      );
    }

    // GitHub
    if (profile.github_url) {
      await this.fillInputBySelector(
        'input[name*="github"], input[id*="github"], input[placeholder*="GitHub"]',
        profile.github_url
      );
    }

    // Portfolio/Website
    if (profile.portfolio_url) {
      await this.fillInputBySelector(
        'input[name*="website"], input[name*="portfolio"], input[id*="website"], input[placeholder*="Website"]',
        profile.portfolio_url
      );
    }
  }

  private async fillGreenhouseEducation(options: SubmissionOptions): Promise<void> {
    if (!this.page) return;

    const { profile } = options;
    if (!profile.education || profile.education.length === 0) return;

    // Greenhouse sometimes has education fields
    const education = profile.education[0];

    await this.fillInputBySelector(
      'input[name*="school"], input[name*="institution"], input[id*="school"]',
      education.institution
    );

    await this.fillInputBySelector('input[name*="degree"], input[id*="degree"]', education.degree);

    if (education.field) {
      await this.fillInputBySelector(
        'input[name*="field"], input[name*="major"], input[id*="discipline"]',
        education.field
      );
    }
  }

  /**
   * Fill React Select custom dropdowns commonly used by Greenhouse.
   * These are div-based dropdowns, not native <select> elements.
   * Greenhouse uses .select-shell containers with .select__control inside.
   */
  private async fillReactSelectDropdowns(
    questionPatterns: Array<{ pattern: RegExp; answer: string }>,
    profile: Profile
  ): Promise<void> {
    if (!this.page) return;

    // Find all React Select controls directly
    const controls = await this.page.$$('.select__control');

    for (const control of controls) {
      try {
        // Check if already has a value
        const hasValue = await control.$('.select__single-value, .select__multi-value');
        if (hasValue) continue;

        // Get label by walking up the DOM from the control
        const labelText = await control.evaluate((el) => {
          let current: Element | null = el;
          for (let i = 0; i < 10 && current; i++) {
            current = current.parentElement;
            if (!current) break;
            const label = current.querySelector('label');
            if (label) return label.textContent?.trim() || '';
          }
          return '';
        });

        // Try to determine field type from context if no label found
        let fieldContext = labelText;
        if (!fieldContext) {
          // Try to get context from nearby elements or input ID
          fieldContext = await control.evaluate((el) => {
            // Check for hidden input with ID inside the container
            const container = el.closest('.field, .form-group, div');
            const hiddenInput = container?.querySelector('input[type="hidden"], input[id]');
            if (hiddenInput) {
              const id = hiddenInput.id || '';
              const name = hiddenInput.getAttribute('name') || '';
              return `${id} ${name}`;
            }
            // Check placeholder text
            const placeholder = el.querySelector('.select__placeholder');
            return placeholder?.textContent?.trim() || '';
          });
        }

        if (!fieldContext) continue;

        // Find matching pattern
        let answerToSelect: string | null = null;
        for (const { pattern, answer } of questionPatterns) {
          if (pattern.test(fieldContext)) {
            answerToSelect = answer;
            break;
          }
        }

        // Special handling for known field IDs
        if (!answerToSelect) {
          const fieldContextLower = fieldContext.toLowerCase();
          if (fieldContextLower.includes('country')) {
            answerToSelect = this.deriveCountryFromProfile(profile);
          } else if (fieldContextLower.includes('location') || fieldContextLower.includes('city')) {
            answerToSelect = this.deriveCityFromProfile(profile);
          } else if (fieldContextLower.includes('gender')) {
            answerToSelect = 'Decline';
          }
        }

        if (!answerToSelect) continue;

        // Click the control to open dropdown
        await control.click();
        await this.humanDelay(true);

        // Wait for menu
        await this.page.waitForSelector('.select__menu', { timeout: 3000 }).catch(() => {});

        // For searchable selects (like Country, Location), type the answer
        const input = await control.$('input');
        if (input) {
          // Use type instead of fill to better trigger search results
          const value = answerToSelect;
          for (const char of value) {
            await input.type(char, { delay: 50 });
          }
          // Wait for search results to appear
          await this.page.waitForSelector('.select__option', { timeout: 3000 }).catch(() => {});
        }

        // Find and click matching option
        const options = await this.page.$$('.select__option');
        let matched = false;

        for (const option of options) {
          const optionText = await option.textContent();
          if (!optionText) continue;

          const optTextLower = optionText.toLowerCase().trim();
          const answerLower = answerToSelect.toLowerCase();

          if (
            optTextLower === answerLower ||
            optTextLower.includes(answerLower) ||
            answerLower.includes(optTextLower) ||
            (answerLower === 'yes' && /^(yes|true|y)$/i.test(optTextLower)) ||
            (answerLower === 'no' && /^(no|false|n)$/i.test(optTextLower)) ||
            (answerLower.includes('decline') && optTextLower.includes('decline')) ||
            (answerLower.includes('prefer not') && optTextLower.includes('prefer not')) ||
            (answerLower.includes("don't wish") && optTextLower.includes("don't wish")) ||
            (answerLower.includes('i am not') && optTextLower.includes('i am not')) ||
            (answerLower.includes('acknowledge') && optTextLower.includes('acknowledge'))
          ) {
            await option.click();
            await this.humanDelay(true);
            matched = true;
            break;
          }
        }

        // If still no match, select first available option
        if (!matched && options.length > 0) {
          await options[0].click();
          await this.humanDelay(true);
        }
      } catch {
        continue;
      }
    }
  }

  /**
   * Fill any remaining required fields that weren't handled by the standard flow.
   * This catches common questions like relocation, work authorization, etc.
   * Handles both native <select> elements and React Select custom dropdowns.
   */
  private async fillRemainingRequiredFields(profile: Profile): Promise<void> {
    if (!this.page) return;

    // Common question patterns and their default answers
    const questionPatterns: Array<{ pattern: RegExp; answer: string }> = [];
    const country = this.deriveCountryFromProfile(profile);
    const city = this.deriveCityFromProfile(profile);
    if (country) {
      questionPatterns.push({ pattern: /\bcountry\b/i, answer: country });
    }
    if (city) {
      questionPatterns.push({ pattern: /\blocation\b|\bcity\b/i, answer: city });
    }
    questionPatterns.push(
      { pattern: /source.*right.*work|right.*work.*source/i, answer: 'Citizen' },
      { pattern: /relocation|relocate|willing.*move|open.*move/i, answer: 'Yes' },
      { pattern: /open.*working.*in-person|work.*office|hybrid/i, answer: 'Yes' },
      { pattern: /authorized.*work|legally.*work|eligible.*work|right.*work/i, answer: 'Yes' },
      { pattern: /sponsor|visa.*sponsor|require.*sponsor/i, answer: 'No' },
      { pattern: /18.*years|legal.*age|at.*least.*18/i, answer: 'Yes' },
      { pattern: /background.*check|consent.*check/i, answer: 'Yes' },
      { pattern: /how.*hear|where.*find|referral|source/i, answer: 'Job Board' },
      { pattern: /gender|pronouns/i, answer: 'Decline to Self-Identify' },
      { pattern: /voluntary.*self.*identification.*gender/i, answer: 'Decline to Self-Identify' },
      { pattern: /self.*identification/i, answer: 'Decline to Self-Identify' },
      { pattern: /veteran|military/i, answer: 'I am not' },
      { pattern: /disability|disabled/i, answer: "I don't wish to answer" },
      { pattern: /race|ethnicity|hispanic|latino/i, answer: 'Decline to self identify' },
      { pattern: /ai.*policy|acknowledge|agree.*policy|consent.*ai/i, answer: 'I acknowledge' },
      { pattern: /interviewed.*before|applied.*before/i, answer: 'No' },
      { pattern: /built.*developer.*tools|maintained.*developer.*tools/i, answer: 'Yes' },
      { pattern: /experience.*typescript|typescript.*production/i, answer: 'Yes' },
      { pattern: /react.*hooks|component.*architecture/i, answer: 'Yes' },
      { pattern: /cli.*tools|ide.*extension|plugin/i, answer: 'Yes' },
      { pattern: /ai.*ml.*component|machine.*learning/i, answer: 'Yes' }
    );

    // Handle React Select custom dropdowns (used by Greenhouse)
    await this.fillReactSelectDropdowns(questionPatterns, profile);

    // Also handle native select elements as fallback
    const selects = await this.page.$$('select[required], select');
    for (const select of selects) {
      try {
        const value = await select.inputValue();
        if (value) continue; // Already filled

        // Get the label text for this select - try multiple approaches
        const labelText = await this.page.evaluate((el) => {
          const id = el.id;
          const name = el.getAttribute('name');

          // Try to find label by for attribute
          let label = id ? document.querySelector(`label[for="${id}"]`) : null;
          if (label) return label.textContent?.trim() || '';

          // Try to find label as parent/sibling
          const fieldContainer = el.closest(
            '.field, .form-group, fieldset, [class*="field"], [class*="question"]'
          );
          if (fieldContainer) {
            label = fieldContainer.querySelector('label, .field-label, legend');
            if (label) return label.textContent?.trim() || '';
            // Sometimes the text is directly in the container
            const containerText = fieldContainer.textContent?.trim() || '';
            // Remove option texts from container text
            const options = Array.from(el.querySelectorAll('option')).map(
              (o) => o.textContent?.trim() || ''
            );
            let cleanText = containerText;
            for (const opt of options) {
              cleanText = cleanText.replace(opt, '');
            }
            if (cleanText.trim()) return cleanText.trim();
          }

          // Try previous sibling
          let prevSibling = el.previousElementSibling;
          while (prevSibling) {
            if (prevSibling.tagName === 'LABEL' || prevSibling.classList?.contains('field-label')) {
              return prevSibling.textContent?.trim() || '';
            }
            prevSibling = prevSibling.previousElementSibling;
          }

          // Try aria-label
          return el.getAttribute('aria-label') || el.getAttribute('placeholder') || name || '';
        }, select);

        if (!labelText) continue;

        // Check if this matches any of our patterns
        for (const { pattern, answer } of questionPatterns) {
          if (pattern.test(labelText)) {
            // Get available options
            const options = await select.$$eval('option', (opts) =>
              opts.map((o) => ({ value: o.value, text: o.textContent?.trim() || '' }))
            );

            // Find best matching option
            const matchingOption = options.find((opt) => {
              const optText = opt.text.toLowerCase().trim();
              const answerLower = answer.toLowerCase();
              // Skip empty/placeholder options
              if (
                !optText ||
                optText === 'select' ||
                optText === 'select...' ||
                optText === '-- select --' ||
                optText.startsWith('select')
              ) {
                return false;
              }
              return (
                optText === answerLower ||
                optText.includes(answerLower) ||
                answerLower.includes(optText) ||
                (answerLower === 'yes' &&
                  /^(yes|true|y|affirmative|i agree|agree)$/i.test(optText)) ||
                (answerLower === 'no' &&
                  /^(no|false|n|negative|i (do not|don't) agree)$/i.test(optText)) ||
                (answerLower === 'prefer not to say' &&
                  /prefer|decline|not (to )?disclose|not (to )?answer/i.test(optText))
              );
            });

            if (matchingOption && matchingOption.value) {
              await select.selectOption(matchingOption.value);
              await this.humanDelay(true);
              break;
            }
          }
        }

        // If still not filled and it's a required field, select first valid option as fallback
        const isRequired = await select.evaluate((el) => el.hasAttribute('required'));
        const currentValue = await select.inputValue();
        if (isRequired && !currentValue) {
          const options = await select.$$eval('option', (opts) =>
            opts.map((o) => ({ value: o.value, text: o.textContent?.trim() || '' }))
          );
          // Find first non-empty, non-placeholder option
          const fallbackOption = options.find((opt) => {
            const text = opt.text.toLowerCase();
            return opt.value && !text.startsWith('select') && text !== '--' && text !== '';
          });
          if (fallbackOption) {
            await select.selectOption(fallbackOption.value);
            await this.humanDelay(true);
          }
        }
      } catch {
        continue;
      }
    }

    // Handle required radio buttons — use a broad selector to catch all Greenhouse question containers,
    // then deduplicate by keeping only the innermost container for each radio input group.
    const radioGroupHandles = await this.page.$$(
      'fieldset:has(input[type="radio"]), .field:has(input[type="radio"]), li:has(input[type="radio"]), [class*="question"]:has(input[type="radio"])'
    );
    // Deduplicate: for each radio name group, keep only the smallest (most specific) container
    const seenRadioNames = new Set<string>();
    const radioGroups = (
      await Promise.all(
        radioGroupHandles.map(async (handle) => {
          const names = await handle.$$eval('input[type="radio"]', (inputs) => [
            ...new Set(inputs.map((i) => (i as HTMLInputElement).name).filter(Boolean)),
          ]);
          const key = names.sort().join('|');
          if (!key || seenRadioNames.has(key)) return null;
          seenRadioNames.add(key);
          return handle;
        })
      )
    ).filter((h): h is NonNullable<typeof h> => h !== null);
    for (const group of radioGroups) {
      try {
        // Check if any radio in this group is already selected
        const checkedRadio = await group.$('input[type="radio"]:checked');
        if (checkedRadio) continue; // Already answered

        // Get the question text — try multiple label selectors
        const questionText = await group
          .$eval(
            'legend, .field-label, [class*="label"], > label, label:first-of-type',
            (el) => el.textContent?.trim() || ''
          )
          .catch(() => '');

        if (!questionText) continue;

        // Check if this matches any of our patterns
        for (const { pattern, answer } of questionPatterns) {
          if (pattern.test(questionText)) {
            // Find the radio button with matching value
            const radios = await group.$$('input[type="radio"]');
            for (const radio of radios) {
              const radioValue = await radio.getAttribute('value');
              const radioLabel = await this.page.evaluate((el) => {
                const label =
                  el.closest('label') || document.querySelector(`label[for="${el.id}"]`);
                return label?.textContent?.trim() || '';
              }, radio);

              const valueToMatch = (radioValue || radioLabel).toLowerCase();
              const answerLower = answer.toLowerCase();

              if (
                valueToMatch === answerLower ||
                valueToMatch.includes(answerLower) ||
                (answerLower === 'yes' && /^(yes|true|y|affirmative)$/i.test(valueToMatch)) ||
                (answerLower === 'no' && /^(no|false|n|negative)$/i.test(valueToMatch))
              ) {
                await radio.check();
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

  /**
   * Fill checkbox fields: Acknowledge boxes, GDPR consent, "How did you hear about us" checkbox groups.
   */
  private async fillCheckboxFields(): Promise<void> {
    if (!this.page) return;

    try {
      // Strategy: find all unchecked checkboxes, determine context, and check appropriately
      const allUnchecked = await this.page.$$('input[type="checkbox"]:not(:checked)');
      let howDidYouHearChecked = false;

      // Preferred labels for "How did you hear" - in order of preference
      const preferredHowDidYouHearLabels = [
        'linkedin',
        'job board',
        'career',
        'website',
        'indeed',
        'glassdoor',
      ];

      for (const cb of allUnchecked) {
        try {
          if (!(await cb.isVisible())) continue;

          // Get label and surrounding context
          const context = await this.page.evaluate((el) => {
            const lbl = el.closest('label') || document.querySelector(`label[for="${el.id}"]`);
            const lblText = lbl?.textContent?.trim() || '';
            // Walk up to find question/field container
            let container = el.parentElement;
            let containerText = '';
            for (let i = 0; i < 5 && container; i++) {
              containerText = container.textContent?.trim() || '';
              if (containerText.length > 20) break;
              container = container.parentElement;
            }
            return {
              label: lblText,
              container: containerText,
              name: el.getAttribute('name') || '',
            };
          }, cb);

          const ctxLower = context.container.toLowerCase();
          const lblLower = context.label.toLowerCase();
          const nameLower = context.name.toLowerCase();

          // Acknowledge / consent / agree / GDPR / demographic data — always check
          if (
            lblLower.includes('acknowledge') ||
            lblLower.includes('consent') ||
            lblLower.includes('agree') ||
            lblLower.includes('gdpr') ||
            lblLower.includes('i certify') ||
            lblLower.includes('i understand') ||
            lblLower.includes('checking this box') ||
            lblLower.includes('by checking') ||
            lblLower.includes('demographic') ||
            lblLower.includes('collecting') ||
            ctxLower.includes('consent') ||
            ctxLower.includes('demographic') ||
            nameLower.includes('gdpr') ||
            nameLower.includes('consent') ||
            nameLower.includes('acknowledge') ||
            nameLower.includes('demographic')
          ) {
            await cb.check();
            await this.humanDelay(true);
            continue;
          }

          // "How did you hear" group — check one (prefer LinkedIn, then Job Board, etc.)
          const isHowDidYouHear =
            ctxLower.includes('how did you hear') ||
            ctxLower.includes('where did you find') ||
            ctxLower.includes('how did you find') ||
            ctxLower.includes('how did you learn') ||
            nameLower.includes('source') ||
            nameLower.includes('referral');

          if (isHowDidYouHear && !howDidYouHearChecked) {
            // Check if this is a preferred option
            const isPreferred = preferredHowDidYouHearLabels.some((pref) =>
              lblLower.includes(pref)
            );
            if (isPreferred) {
              await cb.check();
              await this.humanDelay(true);
              howDidYouHearChecked = true;
              continue;
            }
          }
        } catch {
          continue;
        }
      }

      // Try to directly find and check LinkedIn checkbox by various methods
      if (!howDidYouHearChecked) {
        try {
          // Method 1: by ID/value/name attribute
          let linkedinCheckbox = await this.page.$(
            'input[type="checkbox"][id*="linkedin" i], input[type="checkbox"][value*="linkedin" i], input[type="checkbox"][name*="linkedin" i]'
          );

          // Method 2: by label text using page context
          if (!linkedinCheckbox) {
            const handle = await this.page.evaluateHandle(() => {
              const labels = Array.from(document.querySelectorAll('label'));
              for (const label of labels) {
                if (label.textContent?.toLowerCase().includes('linkedin')) {
                  const checkbox =
                    label.querySelector('input[type="checkbox"]') ||
                    document.getElementById(label.getAttribute('for') || '');
                  if (checkbox && (checkbox as HTMLInputElement).type === 'checkbox')
                    return checkbox;
                }
              }
              return null;
            });
            linkedinCheckbox = handle.asElement() as typeof linkedinCheckbox;
          }

          if (
            linkedinCheckbox &&
            (await linkedinCheckbox.isVisible()) &&
            !(await linkedinCheckbox.isChecked())
          ) {
            await linkedinCheckbox.check();
            await this.humanDelay(true);
            howDidYouHearChecked = true;
          }
        } catch {
          // Continue to fallback
        }
      }

      // If no "how did you hear" option was checked via preferred labels, check first one
      if (!howDidYouHearChecked) {
        const howDidYouHearInputs = await this.page.$$eval('input[type="checkbox"]', (els) => {
          return els
            .filter((el) => {
              if ((el as HTMLInputElement).checked) return false;
              let container = el.parentElement;
              for (let i = 0; i < 5 && container; i++) {
                const text = container.textContent?.toLowerCase() || '';
                if (
                  text.includes('how did you hear') ||
                  text.includes('where did you find') ||
                  text.includes('how did you learn')
                ) {
                  return true;
                }
                container = container.parentElement;
              }
              return false;
            })
            .map((el) => el.id || el.getAttribute('name') || '');
        });

        // Check if any in the group is already checked
        const anyCheckedInGroup = await this.page.$$eval(
          'input[type="checkbox"]:checked',
          (els) => {
            return els.some((el) => {
              let container = el.parentElement;
              for (let i = 0; i < 5 && container; i++) {
                const text = container.textContent?.toLowerCase() || '';
                if (
                  text.includes('how did you hear') ||
                  text.includes('where did you find') ||
                  text.includes('how did you learn')
                ) {
                  return true;
                }
                container = container.parentElement;
              }
              return false;
            });
          }
        );

        if (!anyCheckedInGroup && howDidYouHearInputs.length > 0) {
          // Check the first unchecked one in the group
          const firstId = howDidYouHearInputs[0];
          if (firstId) {
            const cb = await this.page.$(
              `input[type="checkbox"][id="${firstId}"], input[type="checkbox"][name="${firstId}"]`
            );
            if (cb && (await cb.isVisible())) {
              await cb.check();
              await this.humanDelay(true);
            }
          }
        }
      }
    } catch {
      // Non-critical
    }
  }

  /**
   * Fill "Preferred First Name" field if present.
   */
  private async fillPreferredFirstName(profile: Profile): Promise<void> {
    if (!this.page) return;

    try {
      const firstName = profile.name.split(' ')[0];

      // Try by label text
      const labels = await this.page.$$('label');
      for (const label of labels) {
        const text = (await label.textContent()) || '';
        if (/preferred.*first.*name|preferred.*name/i.test(text)) {
          const forAttr = await label.getAttribute('for');
          if (forAttr) {
            const input = await this.page.$(`#${forAttr}`);
            if (input && (await input.isVisible())) {
              const val = await input.inputValue();
              if (!val) {
                await input.fill(firstName);
                await this.humanDelay(true);
              }
              return;
            }
          }
          // Try sibling/child input
          const parent = await label.evaluateHandle((el) => el.closest('.field, .form-group, div'));
          const parentEl = parent.asElement();
          if (parentEl) {
            const input = await parentEl.$('input[type="text"], input:not([type])');
            if (input && (await input.isVisible())) {
              const val = await input.inputValue();
              if (!val) {
                await input.fill(firstName);
                await this.humanDelay(true);
              }
              return;
            }
          }
        }
      }

      // Try by placeholder
      const prefInput = await this.page.$(
        'input[placeholder*="Preferred"], input[name*="preferred"]'
      );
      if (prefInput && (await prefInput.isVisible())) {
        const val = await prefInput.inputValue();
        if (!val) {
          await prefInput.fill(firstName);
          await this.humanDelay(true);
        }
      }
    } catch {
      // Non-critical
    }
  }

  /**
   * Fill the Gender/Self-Identification dropdown specifically.
   * This field is often missed because its label text varies widely.
   */
  private async fillGenderDropdown(): Promise<void> {
    if (!this.page) return;

    try {
      // Find all React Select controls that don't have a value
      const controls = await this.page.$$('.select__control');

      for (const control of controls) {
        // Check if already has a value
        const hasValue = await control.$('.select__single-value');
        if (hasValue) continue;

        // Check if this might be a gender/demographic field
        const fieldContext = await control.evaluate((el) => {
          let current: Element | null = el;
          let text = '';
          for (let i = 0; i < 10 && current; i++) {
            current = current.parentElement;
            if (!current) break;
            const label = current.querySelector('label');
            if (label) {
              text = label.textContent?.trim() || '';
              break;
            }
          }
          // Also check for section headers
          if (!text) {
            const container = el.closest('.field, .form-group, fieldset, section');
            const heading = container?.querySelector('h2, h3, h4, legend, .section-header');
            text = heading?.textContent?.trim() || '';
          }
          return text.toLowerCase();
        });

        // Check if this is a gender/demographic field
        if (
          fieldContext.includes('gender') ||
          fieldContext.includes('self-identification') ||
          fieldContext.includes('voluntary') ||
          fieldContext.includes('demographic')
        ) {
          // Click to open
          await control.click();
          await this.humanDelay(true);

          // Wait for menu
          await this.page.waitForSelector('.select__menu', { timeout: 3000 }).catch(() => {});

          // Look for "Decline" option
          const options = await this.page.$$('.select__option');
          for (const option of options) {
            const optionText = await option.textContent();
            if (optionText?.toLowerCase().includes('decline')) {
              await option.click();
              await this.humanDelay(true);
              return;
            }
          }

          // If no "decline" option, select first non-placeholder option
          if (options.length > 0) {
            await options[0].click();
            await this.humanDelay(true);
          }
        }
      }
    } catch {
      // Non-critical
    }
  }

  /**
   * Fill any remaining empty text/email/tel inputs with smart defaults based on label/name.
   */
  private async fillRemainingEmptyInputs(profile: Profile): Promise<void> {
    if (!this.page) return;

    try {
      const emptyInputs = await this.page.$$(
        'input:not([type="hidden"]):not([type="file"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"])'
      );

      for (const input of emptyInputs) {
        try {
          if (!(await input.isVisible())) continue;
          const val = await input.inputValue();
          if (val) continue; // Already filled

          const info = await this.page.evaluate((el) => {
            const name = (el.getAttribute('name') || '').toLowerCase();
            const id = (el.id || '').toLowerCase();
            const placeholder = (el.getAttribute('placeholder') || '').toLowerCase();
            const autocomplete = (el.getAttribute('autocomplete') || '').toLowerCase();
            const requiredAttr =
              el.getAttribute('required') !== null || el.getAttribute('aria-required') === 'true';
            // Check if this is a React Select internal input
            const isReactSelect =
              !!el.closest('[class*="select__"]') || !!el.closest('[class*="Select"]');
            // Get label
            let labelText = '';
            const label = el.id ? document.querySelector(`label[for="${el.id}"]`) : null;
            if (label) labelText = label.textContent?.trim() || '';
            if (!labelText) {
              const container = el.closest('.field, .form-group, div');
              const containerLabel = container?.querySelector('label');
              labelText = containerLabel?.textContent?.trim() || '';
            }
            const required = requiredAttr || labelText.includes('*') || !!el.closest('.required');
            return {
              name,
              id,
              placeholder,
              autocomplete,
              label: labelText.toLowerCase(),
              isReactSelect,
              required,
            };
          }, input);

          // Skip React Select internal inputs — they're handled by fillReactSelectDropdowns
          if (info.isReactSelect) continue;

          const combined = `${info.name} ${info.id} ${info.placeholder} ${info.autocomplete} ${info.label}`;

          let value = '';
          let isFallback = false;
          if (combined.includes('linkedin')) {
            value = profile.linkedin_url || '';
          } else if (combined.includes('github')) {
            value = profile.github_url || '';
          } else if (combined.includes('portfolio') || combined.includes('website')) {
            value = profile.portfolio_url || '';
          } else if (combined.includes('country')) {
            value = this.deriveCountryFromProfile(profile) || '';
          } else if (combined.includes('location') || combined.includes('city')) {
            value = this.deriveCityFromProfile(profile) || '';
          } else if (combined.includes('preferred') && combined.includes('name')) {
            value = profile.name.split(' ')[0];
          } else if (combined.includes('phone') || combined.includes('tel')) {
            value = profile.phone || '';
          } else if (
            combined.includes('salary') ||
            combined.includes('compensation') ||
            combined.includes('pay')
          ) {
            value = 'Negotiable';
            isFallback = true;
          } else if (combined.includes('referral') || combined.includes('referred')) {
            value = 'N/A';
            isFallback = true;
          } else if (combined.includes('address')) {
            value = profile.location || '';
          }

          if (value) {
            if (!info.required && isFallback) continue;
            // Handle autocomplete dropdowns (location fields)
            if (combined.includes('location') || combined.includes('city')) {
              try {
                // For location autocomplete, using type instead of fill helps trigger suggestions
                await input.click();
                await input.focus();

                // Clear existing text if any
                const existingValue = await input.evaluate((el: HTMLInputElement) => el.value);
                if (existingValue) {
                  await input.click({ clickCount: 3 });
                  await input.press('Backspace');
                }

                // Type slowly to trigger suggestions
                for (const char of value) {
                  await input.type(char, { delay: 50 });
                }

                // Wait for suggestions to appear
                if (this.page) {
                  await this.page.waitForSelector(
                    '[class*="autocomplete"] li, [class*="suggestion"], [role="option"], [role="listbox"] [role="option"], .select__option',
                    { timeout: 4000 }
                  );

                  const firstOption = await this.page.$(
                    '[class*="autocomplete"] li:first-child, [class*="suggestion"]:first-child, [role="option"]:first-child, .select__option:first-child'
                  );

                  if (firstOption) {
                    await firstOption.click();
                    await this.humanDelay(true);
                  } else {
                    await input.press('Enter');
                  }
                }
              } catch {
                await input.press('Tab');
              }
            } else {
              await input.click();
              await input.fill(value);
              await this.humanDelay(true);
            }
          }
        } catch {
          continue;
        }
      }
    } catch {
      // Non-critical
    }
  }

  /**
   * Use AI to analyze and fill any remaining unfilled form fields.
   * This is a fallback that catches fields missed by pattern matching.
   */
  private async fillUnfilledFieldsWithAI(profile: Profile): Promise<void> {
    if (!this.page) return;

    try {
      // Collect all unfilled visible text inputs and their labels
      const unfilledFields = await this.page.evaluate(() => {
        const fields: Array<{
          id: string;
          type: 'text' | 'select' | 'checkbox' | 'textarea';
          label: string;
          options?: string[];
          required: boolean;
        }> = [];

        // Find unfilled text inputs
        document.querySelectorAll('input[type="text"], input:not([type])').forEach((el) => {
          const input = el as HTMLInputElement;
          if (input.type === 'hidden' || input.type === 'file' || input.type === 'submit') return;
          if (!input.offsetParent) return; // Not visible
          if (input.value) return; // Already filled
          if (input.closest('[class*="select__"]')) return; // React Select internal

          // Get label
          let label = '';
          const labelEl = input.id ? document.querySelector(`label[for="${input.id}"]`) : null;
          if (labelEl) label = labelEl.textContent?.trim() || '';
          if (!label) {
            const container = input.closest('.field, .form-group, div');
            const containerLabel = container?.querySelector('label');
            label = containerLabel?.textContent?.trim() || '';
          }

          if (label) {
            fields.push({
              id: input.id || input.name || `input_${fields.length}`,
              type: 'text',
              label,
              required: input.required || !!input.closest('.required') || label.includes('*'),
            });
          }
        });

        // Find unfilled React Selects
        document.querySelectorAll('.select__control').forEach((el, i) => {
          if (
            !el.querySelector('.select__single-value') &&
            !el.querySelector('.select__multi-value')
          ) {
            // Get label
            let label = '';
            let current: Element | null = el;
            for (let j = 0; j < 10 && current; j++) {
              current = current.parentElement;
              if (!current) break;
              const labelEl = current.querySelector('label');
              if (labelEl) {
                label = labelEl.textContent?.trim() || '';
                break;
              }
            }

            if (label) {
              fields.push({
                id: `react_select_${i}`,
                type: 'select',
                label,
                required: label.includes('*'),
              });
            }
          }
        });

        return fields;
      });

      if (unfilledFields.length === 0) return;

      const requiredFields = unfilledFields.filter((field) => field.required);
      if (requiredFields.length === 0) return;

      // Use AI to get answers
      const provider = createAIProvider();
      if (!(await provider.isAvailable())) return;

      const answers = await analyzeAndFillFormFields(provider, profile, requiredFields);

      // Apply answers to the form, track what's still unfilled
      const stillUnfilled: typeof requiredFields = [];

      for (const field of requiredFields) {
        const answer = answers.get(field.id);
        if (!answer) {
          if (field.required) stillUnfilled.push(field);
          continue;
        }

        let filled = false;

        if (field.type === 'text') {
          // Find and fill the text input
          const input = await this.page.$(`#${field.id}, input[name="${field.id}"]`);
          if (input && (await input.isVisible())) {
            const currentVal = await input.inputValue();
            if (!currentVal) {
              await input.fill(answer);
              await this.humanDelay(true);
              filled = true;
            }
          }
        } else if (field.type === 'select' && field.id.startsWith('react_select_')) {
          // This is a React Select - we need to find and fill it
          const index = parseInt(field.id.replace('react_select_', ''));
          const controls = await this.page.$$('.select__control');
          if (controls[index]) {
            const hasValue = await controls[index].$('.select__single-value');
            if (!hasValue) {
              await controls[index].click();
              await this.humanDelay(true);

              await this.page.waitForSelector('.select__menu', { timeout: 3000 }).catch(() => {});

              // Type answer if there's an input
              const input = await this.page.$('.select__input input');
              if (input) {
                await input.fill(answer);
                await this.page
                  .waitForSelector('.select__option', { timeout: 2000 })
                  .catch(() => {});
              }

              // Find and click matching option
              const options = await this.page.$$('.select__option');
              let matched = false;
              for (const option of options) {
                const optionText = await option.textContent();
                if (optionText?.toLowerCase().includes(answer.toLowerCase())) {
                  await option.click();
                  await this.humanDelay(true);
                  matched = true;
                  break;
                }
              }

              // If no match, click first option
              if (!matched && options.length > 0) {
                await options[0].click();
                await this.humanDelay(true);
              }
              filled = true;
            }
          }
        }

        if (!filled && field.required) {
          stillUnfilled.push(field);
        }
      }

      // Interactive fallback: prompt user for remaining required fields AI couldn't fill
      if (stillUnfilled.length > 0) {
        await this.promptForUnfilledFields(stillUnfilled);
      }
    } catch {
      // Non-critical - AI assistance is optional
    }
  }

  /**
   * Prompt the user for fields that neither profile data nor AI could fill.
   * Answers are cached so the user is only asked once per unique field label.
   */
  private async promptForUnfilledFields(
    fields: Array<{
      id: string;
      type: string;
      label: string;
      options?: string[];
      required: boolean;
    }>
  ): Promise<void> {
    if (!this.page) return;

    const { configRepository: configRepo } = await import('../db/repositories/config');
    const config = configRepo.loadAppConfig();

    if (!config.application.interactivePrompts) return;

    // Check cache first, prompt only for truly unknown fields
    const cachedAnswers = config.cachedAnswers ?? {};
    const toAsk = fields.filter((f) => {
      const key = f.label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '');
      return !cachedAnswers[key];
    });

    if (toAsk.length === 0) {
      // All answers are cached — apply them
      for (const field of fields) {
        const key = field.label
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_|_$/g, '');
        const cached = cachedAnswers[key];
        if (cached) {
          await this.applyAnswerToField(field, cached);
        }
      }
      return;
    }

    console.log('\n  Some required fields need your input:\n');

    const { input: promptInput, select: promptSelect } = await import('@inquirer/prompts');
    let configChanged = false;

    for (const field of fields) {
      const key = field.label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '');
      let answer = cachedAnswers[key];

      if (!answer) {
        try {
          if (field.type === 'select' && field.options && field.options.length > 0) {
            answer = await promptSelect({
              message: `  ${field.label}:`,
              choices: field.options.map((opt) => ({ name: opt, value: opt })),
            });
          } else {
            answer = await promptInput({
              message: `  ${field.label}:`,
            });
            answer = answer.trim();
          }
        } catch {
          continue;
        }

        if (answer) {
          // Cache for future applications
          if (!config.cachedAnswers) config.cachedAnswers = {};
          config.cachedAnswers[key] = answer;
          configChanged = true;
        }
      }

      if (answer) {
        await this.applyAnswerToField(field, answer);
      }
    }

    if (configChanged) {
      configRepo.saveAppConfig(config);
    }
  }

  /** Apply a single answer to a form field by its ID and type */
  private async applyAnswerToField(
    field: { id: string; type: string; label: string; options?: string[] },
    answer: string
  ): Promise<void> {
    if (!this.page) return;

    try {
      if (field.type === 'text') {
        const input = await this.page.$(`#${field.id}, input[name="${field.id}"]`);
        if (input && (await input.isVisible())) {
          await input.fill(answer);
          await new Promise((r) => setTimeout(r, 200));
        }
      } else if (field.type === 'select' && field.id.startsWith('react_select_')) {
        const index = parseInt(field.id.replace('react_select_', ''));
        const controls = await this.page.$$('.select__control');
        if (controls[index]) {
          await controls[index].click();
          await new Promise((r) => setTimeout(r, 300));
          await this.page.waitForSelector('.select__menu', { timeout: 3000 }).catch(() => {});

          const searchInput = await this.page.$('.select__input input');
          if (searchInput) {
            await searchInput.fill(answer);
            await new Promise((r) => setTimeout(r, 500));
          }

          const options = await this.page.$$('.select__option');
          for (const option of options) {
            const text = await option.textContent();
            if (text?.toLowerCase().includes(answer.toLowerCase())) {
              await option.click();
              break;
            }
          }
        }
      }
    } catch {
      // Non-critical
    }
  }

  /**
   * Attempt to click the reCAPTCHA checkbox if present.
   * This only works for the "I'm not a robot" checkbox, not invisible reCAPTCHA.
   */
  private async handleRecaptcha(): Promise<void> {
    if (!this.page) return;

    try {
      // reCAPTCHA is in an iframe
      const recaptchaFrame = this.page
        .frames()
        .find((f) => f.url().includes('recaptcha') || f.url().includes('google.com/recaptcha'));

      if (recaptchaFrame) {
        const checkbox = await recaptchaFrame.$('#recaptcha-anchor, .recaptcha-checkbox');
        if (checkbox && (await checkbox.isVisible())) {
          await checkbox.click();
          // Wait for challenge to resolve (may show image challenge)
          await this.page.waitForTimeout(3000);
        }
      }
    } catch {
      // reCAPTCHA handling is best-effort
    }
  }

  private async clickGreenhouseSubmit(): Promise<boolean> {
    if (!this.page) return false;

    const submitSelectors = [
      '#submit_app',
      'button[type="submit"]',
      'input[type="submit"]',
      'button:has-text("Submit Application")',
      '#application_form button[type="submit"]',
      '.application-form button[type="submit"]',
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

  private async waitForGreenhouseConfirmation(): Promise<{ success: boolean; message: string }> {
    if (!this.page) return { success: false, message: 'Page not initialized' };

    try {
      // Wait for page to load after submit
      await this.page.waitForLoadState('domcontentloaded').catch(() => {});
      await this.humanDelay();

      // Check for email verification step before checking for confirmation
      const verificationResult = await this.handleEmailVerification();
      if (verificationResult) {
        return verificationResult;
      }

      // Check for confirmation page
      const confirmationSelectors = [
        '.confirmation',
        '#confirmation',
        '[class*="success"]',
        '[class*="thank"]',
        'h1:has-text("Thank")',
        'h2:has-text("Thank")',
        ':has-text("application has been submitted")',
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
                message: text?.trim() || 'Application submitted to Greenhouse',
              };
            }
          }
        } catch {
          continue;
        }
      }

      // Check URL for confirmation
      const currentUrl = this.page.url();
      if (
        currentUrl.includes('thank') ||
        currentUrl.includes('confirmation') ||
        currentUrl.includes('success')
      ) {
        return { success: true, message: 'Application submitted successfully' };
      }

      // Check for error messages - be specific to avoid false positives
      const errorSelectors = [
        '.error-message',
        '.field-error',
        '.form-error',
        '.flash-error',
        '[role="alert"]',
        '.application--error',
      ];

      for (const selector of errorSelectors) {
        const errorElement = await this.page.$(selector);
        if (errorElement) {
          const isVisible = await errorElement.isVisible();
          if (isVisible) {
            const errorText = await errorElement.textContent();
            // Only treat as error if it looks like an actual error message
            if (errorText?.trim() && !errorText.includes('required field')) {
              return { success: false, message: errorText.trim() };
            }
          }
        }
      }

      // Check if the application form is still visible — means submission failed
      const formStillVisible = await this.page.$(
        '#application_form, form[id*="application"], #main_fields, #submit_app'
      );
      if (formStillVisible) {
        const isVisible = await formStillVisible.isVisible().catch(() => false);
        if (isVisible) {
          return {
            success: false,
            message:
              'Form is still visible after submit — submission likely failed (check for unfilled required fields or reCAPTCHA)',
          };
        }
      }

      return {
        success: false,
        message: 'Could not confirm submission status (no clear success indicator found)',
      };
    } catch (error) {
      return {
        success: false,
        message: `Confirmation check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Detects and handles Greenhouse email verification step.
   * After submission, Greenhouse may show a "check your email" page with a code input.
   * This pauses the CLI, prompts the user for the code, fills it in, and completes submission.
   */
  private async handleEmailVerification(): Promise<{ success: boolean; message: string } | null> {
    if (!this.page) return null;
    const { configRepository } = await import('../db/repositories/config');
    const config = configRepository.loadAppConfig();

    // Detect verification page — Greenhouse shows a code/pin input after emailing a confirmation code
    const verificationSelectors = [
      'input[name*="verification" i]',
      'input[name*="confirm" i][type="text"]',
      'input[name*="code" i]',
      'input[name*="pin" i]',
      'input[placeholder*="code" i]',
      'input[placeholder*="verification" i]',
      'input[aria-label*="verification" i]',
      'input[aria-label*="code" i]',
    ];

    const verificationTextSelectors = [
      ':has-text("check your email")',
      ':has-text("verification code")',
      ':has-text("confirm your email")',
      ':has-text("sent you a code")',
      ':has-text("enter the code")',
      ':has-text("we sent a")',
    ];

    let codeInput = null;
    let isVerificationPage = false;

    // Check for verification text on the page
    for (const selector of verificationTextSelectors) {
      try {
        const el = await this.page.$(selector);
        if (el && (await el.isVisible())) {
          isVerificationPage = true;
          break;
        }
      } catch {
        continue;
      }
    }

    if (!isVerificationPage) return null;

    // Find the code input field
    for (const selector of verificationSelectors) {
      try {
        const el = await this.page.$(selector);
        if (el && (await el.isVisible())) {
          codeInput = el;
          break;
        }
      } catch {
        continue;
      }
    }

    // Also try generic single text input on the verification page
    if (!codeInput) {
      const inputs = await this.page.$$(
        'input[type="text"]:visible, input[type="number"]:visible, input:not([type]):visible'
      );
      for (const inp of inputs) {
        const isVisible = await inp.isVisible().catch(() => false);
        if (isVisible) {
          codeInput = inp;
          break;
        }
      }
    }

    if (!codeInput) {
      return {
        success: false,
        message:
          'Email verification required but could not find code input field. Check your email and complete verification manually.',
      };
    }

    if (this.autoMode || !config.application.interactivePrompts) {
      return {
        success: false,
        message:
          'Email verification required. Run without --auto and ensure interactive prompts are enabled to enter the code.',
      };
    }

    if (!process.stdin.isTTY) {
      return {
        success: false,
        message:
          'Email verification required but no interactive TTY is available to enter the code.',
      };
    }

    // Prompt user for the verification code
    console.log('\n');
    console.log('  ┌─────────────────────────────────────────────┐');
    console.log('  │  Email verification required by Greenhouse  │');
    console.log('  │  Check your email for a verification code   │');
    console.log('  └─────────────────────────────────────────────┘');
    console.log('');

    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const code = await this.promptForVerificationCode(attempt, maxAttempts);
      if (!code) {
        return {
          success: false,
          message:
            'Email verification required but no code was entered. Complete verification manually.',
        };
      }

      // Fill the code
      await codeInput.fill('');
      await codeInput.type(code, { delay: 50 });
      await this.humanDelay();

      // Look for and click a verify/confirm/submit button
      const verifyButtonSelectors = [
        'button:has-text("Verify")',
        'button:has-text("Confirm")',
        'button:has-text("Submit")',
        'input[type="submit"]',
        'button[type="submit"]',
      ];

      for (const btnSelector of verifyButtonSelectors) {
        try {
          const btn = await this.page.$(btnSelector);
          if (btn && (await btn.isVisible())) {
            await btn.click();
            break;
          }
        } catch {
          continue;
        }
      }

      // Wait for response
      await this.page.waitForLoadState('domcontentloaded').catch(() => {});
      await this.humanDelay();

      // Check if we got through to a confirmation/thank-you page
      const pageText = await this.page.evaluate(() => document.body.innerText.toLowerCase());
      if (
        pageText.includes('thank') ||
        pageText.includes('submitted') ||
        pageText.includes('received your application')
      ) {
        return { success: true, message: 'Application submitted (email verified)' };
      }

      // Check if verification page is gone (URL changed)
      const newUrl = this.page.url();
      if (
        newUrl.includes('thank') ||
        newUrl.includes('confirmation') ||
        newUrl.includes('success')
      ) {
        return { success: true, message: 'Application submitted (email verified)' };
      }

      // Check for error on the verification itself
      const errorVisible = await this.page.$('.error, [class*="error"], [role="alert"]');
      if (errorVisible && (await errorVisible.isVisible().catch(() => false))) {
        const errorText = await errorVisible.textContent();
        if (
          errorText?.toLowerCase().includes('invalid') ||
          errorText?.toLowerCase().includes('incorrect') ||
          errorText?.toLowerCase().includes('expired')
        ) {
          console.log(`  Invalid code: ${errorText.trim()}`);
          if (attempt < maxAttempts) {
            // Re-find the input in case page re-rendered
            for (const selector of verificationSelectors) {
              try {
                const el = await this.page.$(selector);
                if (el && (await el.isVisible())) {
                  codeInput = el;
                  break;
                }
              } catch {
                continue;
              }
            }
            continue;
          }
        }
      }

      // If we're still on a verification-like page, the code might be wrong
      const stillVerifying = await this.page.evaluate(() => {
        const text = document.body.innerText.toLowerCase();
        return (
          text.includes('verification') ||
          text.includes('check your email') ||
          text.includes('enter the code')
        );
      });

      if (stillVerifying && attempt < maxAttempts) {
        console.log('  Code not accepted. Try again.');
        continue;
      }

      // If page changed but no clear confirmation, assume success
      if (!stillVerifying) {
        return { success: true, message: 'Application submitted (verification completed)' };
      }
    }

    return {
      success: false,
      message: 'Email verification failed after 3 attempts. Complete verification manually.',
    };
  }

  private async promptForVerificationCode(
    attempt: number,
    maxAttempts: number
  ): Promise<string | null> {
    const message = `Verification code${attempt > 1 ? ` (attempt ${attempt}/${maxAttempts})` : ''}:`;

    try {
      const { input } = await import('@inquirer/prompts');
      const code = await input({
        message,
        validate: (value) => {
          if (!value.trim()) return 'Code is required';
          return true;
        },
      });
      return code.trim() || null;
    } catch {
      try {
        const { createInterface } = await import('readline');
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        try {
          const answer = await new Promise<string>((resolve) => {
            rl.question(`${message} `, (result) => resolve(result));
          });
          const trimmed = answer.trim();
          return trimmed || null;
        } finally {
          rl.close();
        }
      } catch {
        return null;
      }
    }
  }

  protected async extractJobData(url: string): Promise<JobData> {
    if (!this.page) throw new Error('Page not initialized');

    // Extract job title - try multiple selectors
    // boards.greenhouse.io uses h1.app-title; job-boards.greenhouse.io uses h1 inside main content
    let title = await this.extractText('h1.app-title, h1[class*="job-title"], .job-title h1');
    if (!title || title.toLowerCase().includes('open positions')) {
      title = (await this.extractText('.app-title, [data-mapped="true"] h1')) || title;
    }

    // Fallback: If title is generic or missing, look into any Greenhouse iframe
    if (!title || title.toLowerCase().includes('open positions')) {
      const ghFrame = this.page.frames().find((f) => f.url().includes('greenhouse.io'));
      if (ghFrame) {
        const frameTitle = await (
          await ghFrame.$('h1.app-title, h1[class*="job-title"], .job-title h1, h1')
        )?.textContent();
        if (frameTitle) title = frameTitle.trim();
      }
    }

    if (!title) {
      // Final fallback: get any h1 on the page
      title = await this.extractText('h1');
    }

    // Extract company name (usually in the page or URL)
    let company = await this.extractText('.company-name, [class*="company-name"]');
    if (!company || company === 'Unknown Company') {
      // Try to extract from URL: boards.greenhouse.io/companyname or job-boards.greenhouse.io/companyname
      const urlMatch = url.match(/(?:boards|job-boards)\.greenhouse\.io\/([^/]+)/);
      if (urlMatch) {
        company = urlMatch[1].replace(/-/g, ' ');
      } else {
        // Fallback for embedded forms: use hostname
        try {
          const domain = new URL(url).hostname;
          if (!domain.includes('greenhouse.io')) {
            company = domain.replace(/^(www\.)?([^.]+)\..*$/, '$2');
          }
        } catch {
          // Keep the scraped company fallback if URL parsing fails.
        }
      }
    }

    company = normalizeGreenhouseCompanyName(company);

    // Extract job description — try platform-specific selectors first, then broader ones
    // job-boards.greenhouse.io wraps content in sections/divs with varied classes
    let description = await this.extractText('#content, .content, [class*="job-description"]');
    if (!description || description.trim().length < 50) {
      // Try broader extraction for job-boards.greenhouse.io
      const sections = await this.extractAllText(
        'section, .section, [class*="section"], .body, .job__description, ' +
          '[data-mapped="true"], .posting-page, article'
      );
      const joined = sections.join('\n\n').trim();
      if (joined.length > (description?.trim().length ?? 0)) {
        description = joined;
      }
    }
    if (!description || description.trim().length < 50) {
      // Final fallback: get all text from main content area
      description = await this.page.evaluate(() => {
        // Exclude form elements, nav, header, footer from extraction
        const excludeSelectors = 'form, nav, header, footer, [class*="application"], script, style';
        const mainContent =
          document.querySelector('main, #app_body, .app-body, [role="main"]') || document.body;
        const clone = mainContent.cloneNode(true) as HTMLElement;
        clone.querySelectorAll(excludeSelectors).forEach((el) => el.remove());
        return clone.textContent?.trim() ?? '';
      });
    }

    // Extract location
    let location = await this.extractText('.location, [class*="location"]');
    if (!location) {
      // job-boards.greenhouse.io may store location in meta or different elements
      location = await this.page.evaluate(() => {
        const meta = document.querySelector('meta[property="og:description"]');
        return meta?.getAttribute('content') ?? '';
      });
    }

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

  private async extractCustomQuestions(): Promise<CustomQuestion[]> {
    if (!this.page) return [];

    const questions: CustomQuestion[] = [];

    // Greenhouse uses various field patterns - try multiple selectors
    // Custom questions often appear after the main fields (name, email, resume)
    const customFields = await this.page.$$(
      '[class*="custom-question"], [data-question], ' +
        '#custom_fields .field, #custom_fields > div, ' +
        '.field:has(select), .field:has(input[type="radio"]), ' +
        '#additional_fields .field, .additional-fields .field, ' +
        '[id*="question"], [class*="question"]'
    );

    for (let i = 0; i < customFields.length; i++) {
      const field = customFields[i];
      const questionText = await field
        .$eval('label, .field-label', (el) => el.textContent?.trim() ?? '')
        .catch(() => '');

      if (!questionText) continue;

      // Determine question type
      const hasTextarea = (await field.$('textarea')) !== null;
      const hasSelect = (await field.$('select')) !== null;
      const hasRadio = (await field.$('input[type="radio"]')) !== null;
      const hasCheckbox = (await field.$('input[type="checkbox"]')) !== null;

      let type: CustomQuestion['type'] = 'text';
      let options: string[] | undefined;

      if (hasTextarea) {
        type = 'textarea';
      } else if (hasSelect) {
        type = 'select';
        options = await field.$$eval('select option', (opts) =>
          opts.map((o) => o.textContent?.trim() ?? '').filter(Boolean)
        );
      } else if (hasRadio) {
        type = 'radio';
        options = await field.$$eval('input[type="radio"]', (inputs) =>
          inputs.map((inp) => inp.getAttribute('value') ?? '').filter(Boolean)
        );
      } else if (hasCheckbox) {
        type = 'checkbox';
        options = await field.$$eval('input[type="checkbox"]', (inputs) =>
          inputs.map((inp) => inp.getAttribute('value') ?? '').filter(Boolean)
        );
      }

      const required = (await field.$('[required], .required')) !== null;

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

  /**
   * Resolve a URL with gh_jid param to a direct Greenhouse application URL.
   * Many companies embed Greenhouse jobs on their own domain with ?gh_jid=<id>.
   * The actual Greenhouse form is at boards.greenhouse.io/embed/job_app?token=<id>.
   */
  private resolveGreenhouseUrl(url: string): string {
    try {
      const parsed = new URL(url);
      // Already a greenhouse.io URL (boards.greenhouse.io or job-boards.greenhouse.io)
      if (parsed.hostname.includes('greenhouse.io')) return url;

      const ghJid = parsed.searchParams.get('gh_jid');
      if (ghJid) {
        // Use token-only URL — the "for" param is unreliable from external domains
        return `https://boards.greenhouse.io/embed/job_app?token=${ghJid}`;
      }
    } catch {
      // Fall through
    }
    return url;
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

  private matchCountryName(location: string): string | null {
    const normalized = location.toLowerCase();
    const mappings: Array<{ pattern: RegExp; name: string }> = [
      { pattern: /\b(united states|usa|us)\b/i, name: 'United States' },
      { pattern: /\b(canada)\b/i, name: 'Canada' },
      {
        pattern: /\b(united kingdom|uk|england|scotland|wales|northern ireland)\b/i,
        name: 'United Kingdom',
      },
      { pattern: /\b(australia)\b/i, name: 'Australia' },
      { pattern: /\b(india)\b/i, name: 'India' },
      { pattern: /\b(nigeria)\b/i, name: 'Nigeria' },
      { pattern: /\b(germany)\b/i, name: 'Germany' },
      { pattern: /\b(france)\b/i, name: 'France' },
      { pattern: /\b(spain)\b/i, name: 'Spain' },
      { pattern: /\b(italy)\b/i, name: 'Italy' },
      { pattern: /\b(netherlands|holland)\b/i, name: 'Netherlands' },
      { pattern: /\b(sweden)\b/i, name: 'Sweden' },
      { pattern: /\b(norway)\b/i, name: 'Norway' },
      { pattern: /\b(denmark)\b/i, name: 'Denmark' },
      { pattern: /\b(switzerland)\b/i, name: 'Switzerland' },
      { pattern: /\b(ireland)\b/i, name: 'Ireland' },
      { pattern: /\b(singapore)\b/i, name: 'Singapore' },
      { pattern: /\b(new zealand)\b/i, name: 'New Zealand' },
    ];

    for (const { pattern, name } of mappings) {
      if (pattern.test(normalized)) return name;
    }
    return null;
  }

  private deriveCountryFromProfile(profile: Profile): string | null {
    if (!profile.location) return null;
    // Check parts from the end — country is usually last in "City, State, Country" format
    const parts = profile.location
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    for (let i = parts.length - 1; i >= 0; i--) {
      const match = this.matchCountryName(parts[i]);
      if (match) return match;
    }
    return this.matchCountryName(profile.location);
  }

  private deriveCityFromProfile(profile: Profile): string | null {
    const location = profile.location?.trim();
    if (!location) return null;

    const parts = location
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length === 0) return null;

    // Return the first part (city/locality). For "Lagos, Lagos State, Nigeria" → "Lagos"
    // If it's a single-part location that is a country name, return as-is
    if (parts.length === 1) return parts[0];
    return parts[0];
  }
}
