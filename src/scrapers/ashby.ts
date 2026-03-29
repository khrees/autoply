import { BaseScraper, type SubmissionOptions, type SubmissionResult } from './base';
import type { JobData, CustomQuestion, Platform } from '../types';
import { FormFiller } from '../core/form-filler';

export class AshbyScraper extends BaseScraper {
  platform: Platform = 'ashby';

  protected async waitForContent(): Promise<void> {
    if (!this.page) return;
    await this.page.waitForSelector('[data-testid="job-post-title"], .ashby-job-posting-heading, h1', {
      timeout: 10000,
    }).catch(() => { });
  }

  // ============ Ashby Form Submission ============

  override async submitApplication(url: string, options: SubmissionOptions): Promise<SubmissionResult> {
    const errors: string[] = [];

    try {
      await this.initialize(url);
      if (!this.page) throw new Error('Browser not initialized');

      await this.humanDelay();
      await this.page.goto(url, { waitUntil: 'domcontentloaded' });
      await this.humanDelay(true);
      await this.humanScroll();

      // Navigate to application form
      await this.navigateToAshbyApplication();
      await this.waitForAshbyApplicationForm();

      const context = await this.getAshbyContext();
      const filler = new FormFiller(this.page, options.profile, options.jobData, {
        resumePath: options.resumePath,
        coverLetterPath: options.coverLetterPath,
        answeredQuestions: options.answeredQuestions,
        autoMode: options.autoMode,
      }, context);

      // Fill form
      await this.fillAshbyForm(options, errors, context, filler);

      // Submit
      const submitted = await this.clickAshbySubmit(context);
      if (!submitted) {
        return { success: false, message: 'Could not find submit button', errors };
      }

      // Wait for confirmation
      let confirmation = await this.waitForAshbyConfirmation(context);
      if (!confirmation.success && confirmation.message.includes('Missing entry for required field')) {
        const missingLabels = confirmation.message
          .split('Missing entry for required field:')
          .slice(1)
          .map((s) => s.trim())
          .filter(Boolean);

        if (missingLabels.length > 0) {
          await this.fillByMissingLabels(context, options, missingLabels, errors, filler);
          // Retry submit once after attempting to fill missing fields
          const retrySubmitted = await this.clickAshbySubmit(context);
          if (retrySubmitted) {
            confirmation = await this.waitForAshbyConfirmation(context);
          }
        }
      }

      // Screenshot
      const { configRepository } = await import('../db/repositories/config');
      const config = configRepository.loadAppConfig();
      let screenshotPath: string | undefined;
      if (config.application.saveScreenshots) {
        const { getAutoplyDir } = await import('../db');
        const { join } = await import('path');
        screenshotPath = join(getAutoplyDir(), 'screenshots', `ashby_${Date.now()}.png`);
        await this.takeScreenshot(screenshotPath);
      }

      return { success: confirmation.success, message: confirmation.message, screenshotPath, errors };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Unknown error');
      return { success: false, message: 'Ashby submission failed', errors };
    } finally {
      await this.cleanup();
    }
  }

  private async navigateToAshbyApplication(): Promise<void> {
    if (!this.page) return;

    const selectors = [
      '[data-testid="apply-button"]',
      'button:has-text("Apply")',
      'a:has-text("Apply for this job")',
      'a[href*="apply"]',
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

  private async getAshbyContext(): Promise<import('playwright').Page | import('playwright').Frame> {
    if (!this.page) throw new Error('Browser not initialized');
    const frames = this.page.frames();
    for (const frame of frames) {
      if (frame === this.page.mainFrame()) continue;
      const hasForm = await frame.$('form, [data-testid*="application"], .ashby-application-form');
      if (hasForm) return frame;
    }
    return this.page;
  }

  private async waitForAshbyApplicationForm(): Promise<void> {
    if (!this.page) return;

    await this.page.waitForSelector('form, [data-testid*="application"], .ashby-application-form', {
      timeout: 10000,
    }).catch(() => { });
    await this.humanDelay(true);
  }

  private async fillAshbyForm(
    options: SubmissionOptions,
    errors: string[],
    context: import('playwright').Page | import('playwright').Frame,
    filler: FormFiller
  ): Promise<void> {
    if (!this.page) return;

    const { profile } = options;

    // Extract form fields from the LIVE application form (not from pre-scraped data,
    // since Ashby only shows form fields after clicking Apply)
    const liveFormFields = await this.extractAshbyFormFields(context);
    const liveCustomQuestions = await this.extractCustomQuestions(context);

    // Fill all detected form fields via FormFiller (handles prompts for unfillable required fields)
    if (liveFormFields.length > 0) {
      const formResult = await filler.fillForm(liveFormFields);
      errors.push(...formResult.errors);
    } else {
      // Fallback: fill basic fields manually if extraction found nothing
      await this.fillInput(context, 'input[name*="name"], input[data-testid*="name"]', profile.name);
      await this.fillInput(context, 'input[name*="email"], input[type="email"]', profile.email);
      if (profile.phone) {
        await this.fillInput(context, 'input[name*="phone"], input[type="tel"]', profile.phone);
      }
      if (profile.linkedin_url) {
        await this.fillInput(context, 'input[name*="linkedin"], input[placeholder*="LinkedIn"]', profile.linkedin_url);
      }
    }

    // Upload resume
    if (options.resumePath) {
      const fileInput = await context.$('input[type="file"]');
      if (fileInput) {
        await fileInput.setInputFiles(options.resumePath);
        await this.page.waitForTimeout(2000);
      }
    }

    // Custom questions — use live-extracted questions merged with AI-answered ones
    const questionsToFill = liveCustomQuestions.length > 0 ? liveCustomQuestions : (options.answeredQuestions ?? []);
    // Merge AI answers into live questions
    if (options.answeredQuestions) {
      for (const liveQ of questionsToFill) {
        const answered = options.answeredQuestions.find(
          (aq) => aq.question.toLowerCase().trim() === liveQ.question.toLowerCase().trim()
        );
        if (answered?.answer) {
          liveQ.answer = answered.answer;
        }
      }
    }
    if (questionsToFill.length > 0) {
      const result = await filler.fillCustomQuestions(questionsToFill);
      errors.push(...result.errors);
    }

    // Handle Ashby custom UI controls (comboboxes, button radios, etc.)
    await this.fillAshbyCustomControls(options, errors, context, filler);

    await this.humanDelay(true);
  }

  private async fillInput(
    context: import('playwright').Page | import('playwright').Frame,
    selector: string,
    value: string
  ): Promise<boolean> {
    if (!this.page || !value) return false;
    try {
      const input = await context.$(selector);
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

  private async fillAshbyCustomControls(
    options: SubmissionOptions,
    errors: string[],
    context: import('playwright').Page | import('playwright').Frame,
    filler: FormFiller
  ): Promise<void> {
    if (!this.page) return;

    const { profile, jobData } = options;

    // Helper to get a reasonable label for a field container
    const getLabelText = async (container: Awaited<ReturnType<typeof this.page.$>>): Promise<string> => {
      if (!container) return '';
      const label = await container.$('label, [data-testid*="label"], [class*="label"]');
      if (label) {
        const text = await label.textContent();
        if (text) return text.trim();
      }
      const text = await container.textContent();
      return text?.trim().split('\n')[0] ?? '';
    };

    const isRequired = async (container: Awaited<ReturnType<typeof this.page.$>>): Promise<boolean> => {
      if (!container) return false;
      const requiredFlag = await container.$('[required], [aria-required="true"]');
      if (requiredFlag) return true;
      const label = await getLabelText(container);
      return /\*\s*$/.test(label);
    };

    const containers = await context.$$('.ashby-application-form-field, [data-testid*="application"], [data-testid*="field"]');

    const { getOptionLabel } = await import('./helpers');

    for (const container of containers) {
      try {
        const label = await getLabelText(container);
        if (!label) continue;

        const required = await isRequired(container);
        if (!required) continue;

        // Text input / textarea fallback
        const textInput = await container.$('input[type="text"], input:not([type]), textarea');
        if (textInput) {
          const currentVal = await textInput.inputValue().catch(() => '');
          if (!currentVal) {
            const answer = await this.getAIAnswer(profile, jobData, label, { type: 'text' });
            if (answer) {
              await textInput.fill(answer);
              await this.humanDelay(true);
              continue;
            }
          } else {
            continue;
          }
        }

        // Combobox/select (Ashby custom)
        const combobox = await container.$('[role="combobox"], [aria-haspopup="listbox"], [data-testid*="select"]');
        if (combobox) {
          const existingValue = await combobox.textContent().catch(() => '');
          if (!existingValue || /select|choose/i.test(existingValue)) {
            await combobox.click().catch(() => { });
            await this.page.waitForTimeout(300);

            const optionElements = await context.$$('li[role="option"], [role="option"], [data-testid*="option"]');
            const dropdownOptions = [];
            for (const opt of optionElements) {
              const text = await opt.textContent();
              if (text) {
                const clean = text.trim();
                if (clean) dropdownOptions.push(clean);
              }
            }

            if (dropdownOptions.length > 0) {
              const defaultAnswer = filler.getValueForLabel(label, 'select', dropdownOptions);
              const answer = defaultAnswer ?? (await this.getAIAnswer(profile, jobData, label, { type: 'select', choices: dropdownOptions }));
              if (answer) {
                const target = filler.findBestMatchingOption(answer, dropdownOptions);
                const clickText = target ?? answer;
                let clicked = false;
                for (const el of optionElements) {
                  const t = await el.textContent();
                  if (t?.trim().toLowerCase() === clickText.toLowerCase()) {
                    await el.click();
                    clicked = true;
                    break;
                  }
                }
                if (!clicked) {
                  await optionElements[0].click().catch(() => { });
                }
                await this.humanDelay(true);
                continue;
              }
              if (options.autoMode) {
                await optionElements[0].click().catch(() => { });
                await this.humanDelay(true);
                continue;
              }
              if (filler.isInteractive()) {
                const userAnswer = await filler.promptForField({
                  name: '',
                  type: 'select',
                  label,
                  required: true,
                  options: dropdownOptions,
                });
                if (userAnswer) {
                  const target = filler.findBestMatchingOption(userAnswer, dropdownOptions);
                  const clickText = target ?? userAnswer;
                  for (const el of optionElements) {
                    const t = await el.textContent();
                    if (t?.trim().toLowerCase() === clickText.toLowerCase()) {
                      await el.click();
                      await this.humanDelay(true);
                      break;
                    }
                  }
                }
              }
            }
          }
        }

        // Radio groups or button choices
        const radioGroup = await container.$('[role="radiogroup"], input[type="radio"]');
        if (radioGroup) {
          const radioOptions = await container.$$('input[type="radio"], [role="radio"], button');
          const optionData: { el: import('playwright').ElementHandle; label: string }[] = [];
          for (const opt of radioOptions) {
            const text = await getOptionLabel(opt);
            if (text) optionData.push({ el: opt, label: text });
          }

          const optionLabels = optionData.map((o) => o.label);

          if (optionLabels.length > 0) {
            const defaultAnswer = filler.getValueForLabel(label, 'radio', optionLabels);
            const answer = defaultAnswer ?? (await this.getAIAnswer(profile, jobData, label, { type: 'radio', choices: optionLabels }));
            const target = answer ? filler.findBestMatchingOption(answer, optionLabels) : null;
            if (target) {
              for (const opt of optionData) {
                if (opt.label.toLowerCase() === target.toLowerCase()) {
                  await opt.el.click().catch(() => { });
                  await this.humanDelay(true);
                  break;
                }
              }
              continue;
            }
            if (options.autoMode) {
              await optionData[0].el.click().catch(() => { });
              await this.humanDelay(true);
              continue;
            }
            if (filler.isInteractive()) {
              const userAnswer = await filler.promptForField({
                name: '',
                type: 'radio',
                label,
                required: true,
                options: optionLabels,
              });
              if (userAnswer) {
                const targetAnswer = filler.findBestMatchingOption(userAnswer, optionLabels) ?? userAnswer;
                for (const opt of optionData) {
                  if (opt.label.toLowerCase() === targetAnswer.toLowerCase()) {
                    await opt.el.click().catch(() => { });
                    await this.humanDelay(true);
                    break;
                  }
                }
              }
            }
          }
        }
      } catch (err) {
        errors.push(`Ashby custom control fill failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }

    // Second pass: handle labels directly (some Ashby fields are outside standard containers)
    const labels = await context.$$('label, [data-testid*="label"], [class*="label"]');
    for (const labelEl of labels) {
      try {
        const labelText = (await labelEl.textContent())?.trim() || '';
        if (!labelText) continue;
        const required = /\*\s*$/.test(labelText);
        if (!required) continue;

        const forId = await labelEl.getAttribute('for');
        const fieldContainer = await labelEl.evaluateHandle((el) =>
          el.closest('.ashby-application-form-field, [data-testid*="field"], fieldset') || el.parentElement
        );
        let fieldEl = forId ? await context.$(`#${forId}`) : null;
        if (!fieldEl && fieldContainer) {
          fieldEl = await (fieldContainer.asElement() ?? context).$('input, textarea, select, [role="combobox"], [role="radiogroup"]');
        }
        if (!fieldEl) continue;

        const tag = await fieldEl.evaluate((el) => el.tagName.toLowerCase());
        const role = await fieldEl.getAttribute('role');

        if (tag === 'input' || tag === 'textarea') {
          const currentVal = await fieldEl.inputValue().catch(() => '');
          if (!currentVal) {
            const answer = await this.getAIAnswer(profile, jobData, labelText, { type: 'text' });
            if (answer) {
              await fieldEl.fill(answer);
              await this.humanDelay(true);
            }
          }
        } else if (tag === 'select' || role === 'combobox') {
          await fieldEl.click().catch(() => { });
          await this.page.waitForTimeout(300);
          const optionElements = await context.$$('li[role="option"], [role="option"], [data-testid*="option"]');
          const options = [];
          for (const opt of optionElements) {
            const text = await opt.textContent();
            if (text) {
              const clean = text.trim();
              if (clean) options.push(clean);
            }
          }
          if (options.length > 0) {
            const answer = await this.getAIAnswer(profile, jobData, labelText, { type: 'select', choices: options });
            if (answer) {
              let clicked = false;
              for (const el of optionElements) {
                const t = await el.textContent();
                if (t?.trim().toLowerCase() === answer.toLowerCase()) {
                  await el.click();
                  clicked = true;
                  break;
                }
              }
              if (!clicked) {
                await optionElements[0].click().catch(() => { });
              }
              await this.humanDelay(true);
            }
          }
        }
      } catch (err) {
        errors.push(`Ashby label-based fill failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }
  }

  private async clickAshbySubmit(context: import('playwright').Page | import('playwright').Frame): Promise<boolean> {
    if (!this.page) return false;

    const selectors = [
      'button[type="submit"]',
      'button:has-text("Submit")',
      '[data-testid="submit-button"]',
    ];

    for (const selector of selectors) {
      const button = await context.$(selector);
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

  private async waitForAshbyConfirmation(
    context: import('playwright').Page | import('playwright').Frame
  ): Promise<{ success: boolean; message: string }> {
    if (!this.page) return { success: false, message: 'Page not initialized' };

    try {
      // Wait for page to settle after submit — try to detect navigation or DOM change first
      await this.page.waitForLoadState('domcontentloaded').catch(() => { });
      await this.page.waitForTimeout(5000);

      const errorSelectors = [
        'text="needs corrections"',
        'text="Missing entry for required field"',
        'text="Please fill"',
        '[data-testid*="error"]',
        '[aria-invalid="true"]',
      ];

      for (const selector of errorSelectors) {
        const element = await context.$(selector);
        if (element) {
          const errorText = await element.textContent().catch(() => null);
          return { success: false, message: errorText?.trim() || 'Form has validation errors' };
        }
      }

      // Check for error class elements — only if text looks like an actual error
      const classErrorElements = await context.$$('[class*="error"]');
      for (const el of classErrorElements) {
        const text = await el.textContent().catch(() => null);
        if (text && text.trim().length > 5 && /error|required|missing|invalid|correction/i.test(text)) {
          return { success: false, message: text.trim() };
        }
      }

      // Check for success indicators
      const successSelectors = [
        'text="Thank you"',
        'text="thanks for applying"',
        'text="Application submitted"',
        'text="application has been received"',
        'text="successfully submitted"',
        'text="successfully"',
        '[data-testid*="success"]',
        '[data-testid*="confirmation"]',
      ];

      for (const selector of successSelectors) {
        const element = await context.$(selector);
        if (element) {
          return { success: true, message: 'Ashby application submitted' };
        }
      }

      // Check if the form is gone (likely navigated to a thank-you page)
      const formStillPresent = await context.$('form, [data-testid*="application"]');
      const submitButton = await context.$('button[type="submit"], button:has-text("Submit")');
      if (!formStillPresent && !submitButton) {
        // Form disappeared — likely a successful submission that redirected
        return { success: true, message: 'Application form no longer visible (likely submitted)' };
      }

      // No confirmation found - assume failure
      return { success: false, message: 'No submission confirmation found' };
    } catch {
      return { success: false, message: 'Confirmation check failed' };
    }
  }

  private async fillByMissingLabels(
    context: import('playwright').Page | import('playwright').Frame,
    options: SubmissionOptions,
    labels: string[],
    errors: string[],
    filler: FormFiller
  ): Promise<void> {
    const { normalizeLabel: normalize, getOptionLabel, getAccessibleName, clickMatchingOption } = await import('./helpers');

    const pickBestOption = (label: string, optionsList: string[]): string | null => {
      const candidates: string[] = [];
      const defaultAnswer = filler.getValueForLabel(label, 'select', optionsList);
      if (defaultAnswer) candidates.push(defaultAnswer);
      if (options.profile.preferences?.preferred_locations?.length) {
        candidates.push(...options.profile.preferences.preferred_locations);
      }
      if (options.profile.location) candidates.push(options.profile.location);

      if (optionsList.length === 0) {
        return candidates[0] ?? null;
      }

      for (const candidate of candidates) {
        const match = filler.findBestMatchingOption(candidate, optionsList);
        if (match) return match;
      }
      return optionsList[0] ?? null;
    };

    const selectFromOpenList = async (label: string, forceFirst = false): Promise<boolean> => {
      const optionElements = await context.$$('li[role="option"], [role="option"], [data-testid*="option"]');
      if (optionElements.length === 0) return false;
      const optionTexts: string[] = [];
      for (const opt of optionElements) {
        const t = await opt.textContent();
        if (t?.trim()) optionTexts.push(t.trim());
      }
      const target = pickBestOption(label, optionTexts);
      if (!target && forceFirst) {
        await optionElements[0].click().catch(() => { });
        await this.humanDelay(true);
        return true;
      }
      if (!target) return false;
      
      const clicked = await clickMatchingOption(optionElements, target, false, async (el) => (await el.textContent())?.trim() ?? '');
      if (clicked) await this.humanDelay(true);
      return clicked;
    };

    const findComboboxByLabel = async (label: string): Promise<import('playwright').ElementHandle | null> => {
      const normalizedLabel = normalize(label);
      const comboboxes = await context.$$('[role="combobox"], [aria-haspopup="listbox"]');
      for (const combobox of comboboxes) {
        const name = await getAccessibleName(combobox);
        if (!name) continue;
        const normalized = normalize(name);
        if (normalized.includes(normalizedLabel) || normalizedLabel.includes(normalized)) {
          return combobox;
        }
      }
      return null;
    };

    const findRadioContainerByLabel = async (label: string): Promise<import('playwright').ElementHandle | null> => {
      const normalizedLabel = normalize(label);
      const containers = await context.$$(
        '[role="radiogroup"], fieldset, .ashby-application-form-field, [data-testid*="question"], [data-testid*="field"]'
      );
      for (const container of containers) {
        const text = (await container.textContent()) ?? '';
        const normalized = normalize(text);
        if (normalized.includes(normalizedLabel)) return container;
        const name = await getAccessibleName(container);
        if (name) {
          const normalizedName = normalize(name);
          if (normalizedName.includes(normalizedLabel) || normalizedLabel.includes(normalizedName)) {
            return container;
          }
        }
      }
      return null;
    };

    const selectFromRadioContainer = async (container: import('playwright').ElementHandle, label: string): Promise<boolean> => {
      const radioOptions = await container.$$(
        'input[type="radio"], [role="radio"], button, input[type="checkbox"]'
      );
      if (radioOptions.length === 0) return false;

      const optionData: { el: import('playwright').ElementHandle; label: string }[] = [];
      for (const opt of radioOptions) {
        const text = await getOptionLabel(opt);
        if (text) optionData.push({ el: opt, label: text });
      }
      if (optionData.length === 0) {
        if (options.autoMode) {
          await radioOptions[0].click().catch(() => { });
          await this.humanDelay(true);
          return true;
        }
        return false;
      }

      const optionLabels = optionData.map((o) => o.label);
      const target = pickBestOption(label, optionLabels);
      
      const getLabelFn = async (el: import('playwright').ElementHandle) => optionData.find(o => o.el === el)?.label ?? '';
      
      if (target) {
        const clicked = await clickMatchingOption(
          optionData.map(o => o.el),
          target,
          false,
          getLabelFn
        );
        if (clicked) {
          await this.humanDelay(true);
          return true;
        }
      }

      if (options.autoMode) {
        await optionData[0].el.click().catch(() => { });
        await this.humanDelay(true);
        return true;
      }

      if (filler.isInteractive()) {
        const userAnswer = await filler.promptForField({
          name: '',
          type: 'radio',
          label,
          required: true,
          options: optionLabels,
        });
        if (userAnswer) {
          const targetAnswer = filler.findBestMatchingOption(userAnswer, optionLabels) ?? userAnswer;
          const clicked = await clickMatchingOption(
            optionData.map(o => o.el),
            targetAnswer,
            false,
            getLabelFn
          );
          if (clicked) {
            await this.humanDelay(true);
            return true;
          }
        }
      }
      return false;
    };

    const tryFillKeywordField = async (keyword: string, label: string): Promise<boolean> => {
      const selector = [
        `[name*="${keyword}" i]`,
        `[id*="${keyword}" i]`,
        `[aria-label*="${keyword}" i]`,
        `[placeholder*="${keyword}" i]`,
        `[data-testid*="${keyword}" i]`,
      ].join(', ');
      const field = await context.$(selector);
      if (!field) return false;
      await field.click().catch(() => { });
      await this.page?.waitForTimeout(200);

      let didFill = false;
      const answer = pickBestOption(label, []) ?? filler.getValueForLabel(label, 'text') ?? options.profile.location ?? '';
      const tag = await field.evaluate((el) => el.tagName.toLowerCase());
      if (tag === 'input' || tag === 'textarea') {
        if (answer) {
          await field.fill(answer);
          await this.humanDelay(true);
          didFill = true;
        }
      }

      if (await selectFromOpenList(label, options.autoMode)) return true;

      // Fallback: keyboard select first option if list exists but options not matched.
      const listbox = await context.$('[role="listbox"]');
      if (this.page && listbox) {
        await this.page.keyboard.press('ArrowDown').catch(() => { });
        await this.page.keyboard.press('Enter').catch(() => { });
        await this.humanDelay(true);
        return true;
      }
      return didFill;
    };

    for (const label of labels) {
      try {
        const normalizedLabel = normalize(label);
        const isLocation = /location/i.test(label);
        const isOffice = /office/i.test(label);

        if (isLocation || isOffice) {
          const keyword = isOffice ? 'office' : 'location';
          const keywordFilled = await tryFillKeywordField(keyword, label);
          if (keywordFilled) continue;
          const combobox = await findComboboxByLabel(label);
          if (combobox) {
            await combobox.click().catch(() => { });
            await this.page?.waitForTimeout(200);
            const picked = await selectFromOpenList(label, options.autoMode);
            if (picked) continue;
            if (options.autoMode && this.page) {
              await this.page.keyboard.press('ArrowDown').catch(() => { });
              await this.page.keyboard.press('Enter').catch(() => { });
              await this.humanDelay(true);
              continue;
            }
          }
          if (isOffice) {
            const radioContainer = await findRadioContainerByLabel(label);
            if (radioContainer) {
              const picked = await selectFromRadioContainer(radioContainer, label);
              if (picked) continue;
            }
          }
        }

        let labelEl: import('playwright').ElementHandle | null = null;
        const labelCandidates = await context.$$('label, [data-testid*="label"], [class*="label"]');
        for (const candidate of labelCandidates) {
          const text = (await candidate.textContent()) ?? '';
          const normalized = normalize(text);
          if (
            normalized === normalizedLabel ||
            normalized.includes(normalizedLabel) ||
            normalizedLabel.includes(normalized)
          ) {
            labelEl = candidate;
            break;
          }
        }

        let container = labelEl
          ? await labelEl.evaluateHandle((el) => {
            const element = el as HTMLElement;
            return element.closest('.ashby-application-form-field, [data-testid*="field"], [data-testid*="question"], fieldset') || element.parentElement;
          })
          : null;

        if (!container) {
          const containers = await context.$$('.ashby-application-form-field, [data-testid*="field"], [data-testid*="question"], fieldset');
          for (const candidate of containers) {
            const text = (await candidate.textContent()) ?? '';
            const normalized = normalize(text);
            if (normalized.includes(normalizedLabel)) {
              container = candidate;
              break;
            }
          }
        }

        if (!container) {
          if (/location/i.test(label)) {
            const fallbackField = await context.$('[name*="location" i], [id*="location" i], [aria-label*="location" i], [placeholder*="location" i]');
            if (fallbackField) {
              const answer = filler.getValueForLabel(label, 'text') ?? options.profile.location ?? '';
              if (answer) {
                await fallbackField.fill(answer).catch(() => { });
                await this.humanDelay(true);
                const optionElements = await context.$$('li[role="option"], [role="option"], [data-testid*="option"]');
                if (optionElements.length > 0) {
                  const optionTexts: string[] = [];
                  for (const opt of optionElements) {
                    const t = await opt.textContent();
                    if (t?.trim()) optionTexts.push(t.trim());
                  }
                  const target = filler.findBestMatchingOption(answer, optionTexts);
                  if (target) {
                    for (const opt of optionElements) {
                      const t = await opt.textContent();
                      if (t?.trim().toLowerCase() === target.toLowerCase()) {
                        await opt.click().catch(() => { });
                        await this.humanDelay(true);
                        break;
                      }
                    }
                  } else if (options.autoMode) {
                    await optionElements[0].click().catch(() => { });
                    await this.humanDelay(true);
                  }
                }
              }
            }
          } else if (/office/i.test(label)) {
            const fallbackField = await context.$('[name*="office" i], [id*="office" i], [aria-label*="office" i], [placeholder*="office" i]');
            if (fallbackField) {
              await fallbackField.click().catch(() => { });
              await this.page?.waitForTimeout(300);
              const optionElements = await context.$$('li[role="option"], [role="option"], [data-testid*="option"]');
              if (optionElements.length > 0) {
                await optionElements[0].click().catch(() => { });
                await this.humanDelay(true);
              }
            }
          }
          continue;
        }

        let fieldEl: import('playwright').ElementHandle | null = null;
        if (labelEl) {
          const forId = await labelEl.getAttribute('for');
          const safeForId = forId ? forId.replace(/"/g, '\\"') : null;
          fieldEl = safeForId ? await context.$(`[id="${safeForId}"]`) : null;
          if (!fieldEl) {
            fieldEl = await labelEl.evaluateHandle((el) => {
              const parent = el.parentElement;
              return parent?.querySelector('input, textarea, select, [role="combobox"], [aria-haspopup="listbox"], [role="radiogroup"]') || null;
            }).then((h) => h.asElement());
          }
        }
        if (!fieldEl) {
          fieldEl = await (container.asElement() ?? context).$(
            'input, textarea, select, [role="combobox"], [aria-haspopup="listbox"], [role="radiogroup"]'
          );
        }
        if (!fieldEl) continue;

        const tag = await fieldEl.evaluate((el) => (el as Element).tagName.toLowerCase());
        const role = await fieldEl.getAttribute('role');

        if (tag === 'input' || tag === 'textarea') {
          const currentVal = await fieldEl.inputValue().catch(() => '');
          if (!currentVal) {
            const defaultAnswer = filler.getValueForLabel(label, 'text');
            const answer = defaultAnswer ?? (await this.getAIAnswer(options.profile, options.jobData, label, { type: 'text' }));
            if (answer) {
              await fieldEl.fill(answer);
              await this.humanDelay(true);
              const optionElements = await context.$$('li[role="option"], [role="option"], [data-testid*="option"]');
              if (optionElements.length > 0) {
                const optionTexts: string[] = [];
                for (const opt of optionElements) {
                  const t = await opt.textContent();
                  if (t?.trim()) optionTexts.push(t.trim());
                }
                const target = filler.findBestMatchingOption(answer, optionTexts);
                if (target) {
                  for (const opt of optionElements) {
                    const t = await opt.textContent();
                    if (t?.trim().toLowerCase() === target.toLowerCase()) {
                      await opt.click().catch(() => { });
                      await this.humanDelay(true);
                      break;
                    }
                  }
                } else if (options.autoMode) {
                  await optionElements[0].click().catch(() => { });
                  await this.humanDelay(true);
                }
              }
            } else if (filler.isInteractive()) {
              const userAnswer = await filler.promptForField({
                name: '',
                type: 'text',
                label,
                required: true,
              });
              if (userAnswer) {
                await fieldEl.fill(userAnswer);
                await this.humanDelay(true);
              }
            }
          }
        } else if (tag === 'select' || role === 'combobox') {
          await fieldEl.click().catch(() => { });
          await this.page?.waitForTimeout(300);
          const optionElements = await context.$$('li[role="option"], [role="option"], [data-testid*="option"]');
          const optionTexts: string[] = [];
          for (const opt of optionElements) {
            const t = await opt.textContent();
            if (t?.trim()) optionTexts.push(t.trim());
          }
          if (optionTexts.length > 0) {
            const defaultAnswer = filler.getValueForLabel(label, 'select', optionTexts);
            const answer = defaultAnswer ?? (await this.getAIAnswer(options.profile, options.jobData, label, { type: 'select', choices: optionTexts }));
            const target = answer ? filler.findBestMatchingOption(answer, optionTexts) : null;
            if (target) {
              let clicked = false;
              for (const opt of optionElements) {
                const t = await opt.textContent();
                if (t?.trim().toLowerCase() === target.toLowerCase()) {
                  await opt.click().catch(() => { });
                  clicked = true;
                  break;
                }
              }
              if (!clicked) {
                await optionElements[0].click().catch(() => { });
              }
              await this.humanDelay(true);
            } else if (options.autoMode) {
              await optionElements[0].click().catch(() => { });
              await this.humanDelay(true);
            } else if (filler.isInteractive()) {
              const userAnswer = await filler.promptForField({
                name: '',
                type: 'select',
                label,
                required: true,
                options: optionTexts,
              });
              if (userAnswer) {
                const targetAnswer = filler.findBestMatchingOption(userAnswer, optionTexts) ?? userAnswer;
                for (const opt of optionElements) {
                  const t = await opt.textContent();
                  if (t?.trim().toLowerCase() === targetAnswer.toLowerCase()) {
                    await opt.click().catch(() => { });
                    await this.humanDelay(true);
                    break;
                  }
                }
              }
            }
          }
        }

        const radioOptions = await (container.asElement() ?? context).$$('input[type="radio"], [role="radio"], button');
        if (radioOptions.length > 0) {
          const optionData: { el: import('playwright').ElementHandle; label: string }[] = [];
          for (const opt of radioOptions) {
            const text = await getOptionLabel(opt);
            if (text) optionData.push({ el: opt, label: text });
          }
          const optionLabels = optionData.map((o) => o.label);
          if (optionLabels.length > 0) {
            const defaultAnswer = filler.getValueForLabel(label, 'radio', optionLabels);
            const answer = defaultAnswer ?? (await this.getAIAnswer(options.profile, options.jobData, label, { type: 'radio', choices: optionLabels }));
            const target = answer ? filler.findBestMatchingOption(answer, optionLabels) : null;
            if (target) {
              for (const opt of optionData) {
                if (opt.label.toLowerCase() === target.toLowerCase()) {
                  await opt.el.click().catch(() => { });
                  await this.humanDelay(true);
                  break;
                }
              }
            } else if (options.autoMode) {
              await optionData[0].el.click().catch(() => { });
              await this.humanDelay(true);
            } else if (filler.isInteractive()) {
              const userAnswer = await filler.promptForField({
                name: '',
                type: 'radio',
                label,
                required: true,
                options: optionLabels,
              });
              if (userAnswer) {
                const targetAnswer = filler.findBestMatchingOption(userAnswer, optionLabels) ?? userAnswer;
                for (const opt of optionData) {
                  if (opt.label.toLowerCase() === targetAnswer.toLowerCase()) {
                    await opt.el.click().catch(() => { });
                    await this.humanDelay(true);
                    break;
                  }
                }
              }
            }
          }
        }
      } catch (err) {
        errors.push(`Ashby missing-label fill failed for "${label}": ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }
  }

  protected async extractJobData(url: string): Promise<JobData> {
    if (!this.page) throw new Error('Page not initialized');

    // Extract job title
    const title = await this.extractText(
      '[data-testid="job-post-title"], .ashby-job-posting-heading h1, h1'
    );

    // Extract company name from URL or page
    let company = await this.extractText(
      '[data-testid="company-name"], .ashby-company-name, [class*="companyName"]'
    );
    if (!company) {
      // Try to extract from URL (jobs.ashbyhq.com/companyname)
      const urlMatch = url.match(/jobs\.ashbyhq\.com\/([^/]+)/);
      company = urlMatch ? this.formatCompanyName(urlMatch[1]) : 'Unknown Company';
    }

    // Extract job description
    const description = await this.extractText(
      '[data-testid="job-post-description"], .ashby-job-posting-description, [class*="jobDescription"]'
    );

    // Extract location
    const location = await this.extractText(
      '[data-testid="job-post-location"], .ashby-job-posting-location, [class*="location"]'
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

  private async extractAshbyFormFields(
    context: import('playwright').Page | import('playwright').Frame
  ): Promise<JobData['form_fields']> {
    const fields: JobData['form_fields'] = [];
    const inputs = await context.$$('input:not([type="hidden"]):not([type="submit"])');
    for (const input of inputs) {
      const name = (await input.getAttribute('name')) ?? '';
      const type = ((await input.getAttribute('type')) ?? 'text') as JobData['form_fields'][number]['type'];
      const label = await this.findLabelForInputInContext(context, input);
      const required = (await input.getAttribute('required')) !== null || (await input.getAttribute('aria-required')) === 'true';
      if (name || label) {
        fields.push({ name, type, label, required });
      }
    }
    const textareas = await context.$$('textarea');
    for (const textarea of textareas) {
      const name = (await textarea.getAttribute('name')) ?? '';
      const label = await this.findLabelForInputInContext(context, textarea);
      const required = (await textarea.getAttribute('required')) !== null || (await textarea.getAttribute('aria-required')) === 'true';
      if (name || label) {
        fields.push({ name, type: 'textarea', label, required });
      }
    }
    const selects = await context.$$('select');
    for (const select of selects) {
      const name = (await select.getAttribute('name')) ?? '';
      const label = await this.findLabelForInputInContext(context, select);
      const required = (await select.getAttribute('required')) !== null || (await select.getAttribute('aria-required')) === 'true';
      const options = await select.$$eval('option', (opts) =>
        opts.map((o) => o.textContent?.trim() ?? '').filter(Boolean)
      );
      if (name || label) {
        fields.push({ name, type: 'select', label, required, options });
      }
    }
    return fields;
  }

  private async findLabelForInputInContext(
    context: import('playwright').Page | import('playwright').Frame,
    input: unknown
  ): Promise<string> {
    try {
      const id = await (input as { getAttribute: (attr: string) => Promise<string | null> }).getAttribute('id');
      if (id) {
        const label = await context.$(`label[for="${id}"]`);
        if (label) {
          const text = await label.textContent();
          if (text) return text.trim();
        }
      }

      const parentLabel = await (input as import('playwright').ElementHandle).evaluate((el) => {
        const parent = (el as HTMLElement).closest('label');
        return parent?.textContent?.trim() ?? '';
      });
      if (parentLabel) return parentLabel;

      const ariaLabel = await (input as { getAttribute: (attr: string) => Promise<string | null> }).getAttribute('aria-label');
      if (ariaLabel) return ariaLabel;

      const placeholder = await (input as { getAttribute: (attr: string) => Promise<string | null> }).getAttribute('placeholder');
      if (placeholder) return placeholder;
    } catch {
      // fall through
    }
    return '';
  }

  private async extractCustomQuestions(
    context?: import('playwright').Page | import('playwright').Frame
  ): Promise<CustomQuestion[]> {
    const activeContext = context || this.page;
    if (!activeContext) return [];

    const questions: CustomQuestion[] = [];

    // Ashby uses specific patterns for custom questions in their application forms
    const customFields = await activeContext.$$(
      '[data-testid*="question"], [class*="customQuestion"], .ashby-application-form-field'
    );

    for (let i = 0; i < customFields.length; i++) {
      const field = customFields[i];
      const questionText = await field.$eval(
        'label, [class*="label"], [data-testid*="label"]',
        (el) => el.textContent?.trim() ?? ''
      ).catch(() => '');

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
        ).catch(() => []);
      } else if (hasRadio) {
        type = 'radio';
        options = await field.$$eval('input[type="radio"]', (inputs) =>
          inputs.map((inp) => {
            const id = inp.getAttribute('id');
            if (id) {
              const label = document.querySelector(`label[for="${id}"]`);
              if (label?.textContent?.trim()) return label.textContent.trim();
            }
            const parentLabel = inp.closest('label');
            if (parentLabel?.textContent?.trim()) return parentLabel.textContent.trim();
            return inp.getAttribute('aria-label')?.trim() || inp.getAttribute('value')?.trim() || '';
          }).filter(Boolean)
        ).catch(() => []);
      } else if (hasCheckbox) {
        type = 'checkbox';
        options = await field.$$eval('input[type="checkbox"]', (inputs) =>
          inputs.map((inp) => {
            const id = inp.getAttribute('id');
            if (id) {
              const label = document.querySelector(`label[for="${id}"]`);
              if (label?.textContent?.trim()) return label.textContent.trim();
            }
            const parentLabel = inp.closest('label');
            if (parentLabel?.textContent?.trim()) return parentLabel.textContent.trim();
            return inp.getAttribute('aria-label')?.trim() || inp.getAttribute('value')?.trim() || '';
          }).filter(Boolean)
        ).catch(() => []);
      }

      const required = (await field.$('[required], [aria-required="true"]')) !== null;

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
