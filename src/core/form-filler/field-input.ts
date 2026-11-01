import type { Page, Frame } from 'playwright';
import type { FormField } from '../../types';
import type { FormFillerOptions } from './field-classifier';
import { findInputBySemanticSearch } from '../semantic-selectors';
import {
  handleReactSelect,
  handleChakraSelect,
  handleMaterialUISelect,
  handleFileUpload,
  waitForFileUploaded,
} from '../platform-handlers';
import { FIELD_PATTERNS, normalizeLocationInput } from './field-classifier';
import { findQuestionContainer, findInputByLabel } from './question-filler';

export async function fillTextInput(
  page: Page,
  root: Page | Frame,
  selector: string,
  value: string,
  field: FormField,
  humanDelay: () => Promise<void>
) {
  try {
    let element = await root.$(selector);

    if (!element && field.label) {
      element = (await findInputBySemanticSearch(
        page,
        field.label,
        field.type as 'text' | 'email' | 'tel' | undefined
      )) as typeof element;
    }

    if (!element && field.label) {
      element = await findInputByLabel(root, field.label);
    }

    if (!element) {
      return false;
    }

    const fieldContext = `${field.label || ''} ${field.name || ''}`.toLowerCase();
    const role = (await element.getAttribute('role'))?.toLowerCase() ?? '';
    const ariaAutocomplete = (await element.getAttribute('aria-autocomplete'))?.toLowerCase() ?? '';
    const isLocationField = FIELD_PATTERNS.location.test(fieldContext);
    const isAutocompleteField =
      isLocationField ||
      role === 'combobox' ||
      ariaAutocomplete === 'list' ||
      ariaAutocomplete === 'both';

    if (isAutocompleteField) {
      const inputValue = isLocationField ? normalizeLocationInput(value) : value;

      await element.click();
      await element.fill('');
      await element.type(inputValue, { delay: 40 });
      await page
        .waitForSelector(
          '[role="listbox"] [role="option"], [role="option"], [class*="autocomplete"] li, [class*="typeahead"] li, [class*="suggestion"]',
          { timeout: 2000 }
        )
        .catch(() => {});

      const optionSelectors = [
        '[role="listbox"] [role="option"]',
        '[role="option"]',
        '[class*="autocomplete"] li',
        '[class*="typeahead"] li',
        '[class*="suggestion"]',
      ];

      for (const optionSelector of optionSelectors) {
        const option = await page.$(optionSelector);
        if (!option) continue;

        const isVisible = await option.isVisible().catch(() => false);
        if (!isVisible) continue;

        await option.click().catch(() => {});
        await humanDelay();

        const finalValue = await element.inputValue().catch(() => '');
        if (finalValue.trim()) {
          return true;
        }
      }

      await element.press('ArrowDown').catch(() => {});
      await element.press('Enter').catch(() => {});
      await element.press('Tab').catch(() => {});
      await humanDelay();

      const finalValue = await element.inputValue().catch(() => '');
      return finalValue.trim().length > 0;
    }

    // Clear existing value and type new one
    await element.click();
    await page.keyboard.press('Control+a').catch(() => {});
    await element.fill(value);
    await humanDelay();

    return true;
  } catch {
    return false;
  }
}

export async function fillTextarea(
  root: Page | Frame,
  selector: string,
  value: string,
  humanDelay: () => Promise<void>
) {
  try {
    const element = await root.$(selector);
    if (!element) return false;

    await element.click();
    await element.fill(value);
    await humanDelay();

    return true;
  } catch {
    return false;
  }
}

export async function fillSelect(
  page: Page,
  root: Page | Frame,
  selector: string,
  value: string,
  field: FormField,
  findBestMatchingOption: (val: string, opts: string[]) => string | null,
  humanDelay: () => Promise<void>
) {
  try {
    const element = await root.$(selector);
    if (!element) return false;

    const options = field.options || [];
    const matchedOption = findBestMatchingOption(value, options);
    const targetValue = matchedOption || value;

    const isReactSelect = await element.evaluate((el) => {
      const parent = el.closest('[class*="react-select"], [class*="Select"]');
      return parent !== null;
    });

    if (isReactSelect) {
      const filled = await handleReactSelect(page, element, targetValue);
      if (filled) return true;
    }

    const isChakraSelect = await element.evaluate((el) => {
      const parent = el.closest('[class*="chakra"]');
      return parent !== null;
    });

    if (isChakraSelect) {
      const filled = await handleChakraSelect(page, element, targetValue);
      if (filled) return true;
    }

    const isMuiSelect = await element.evaluate((el) => {
      const parent = el.closest('[class*="MuiSelect"], [class*="MuiInput"]');
      return parent !== null;
    });

    if (isMuiSelect) {
      const filled = await handleMaterialUISelect(page, element, targetValue);
      if (filled) return true;
    }

    if (matchedOption) {
      await element.selectOption({ label: matchedOption });
    } else {
      await element.selectOption(value);
    }

    await humanDelay();
    return true;
  } catch {
    return false;
  }
}

export async function fillRadio(
  page: Page,
  root: Page | Frame,
  field: FormField,
  value: string,
  findBestMatchingOption: (val: string, opts: string[]) => string | null,
  humanDelay: () => Promise<void>
) {
  try {
    const options = field.options || [];
    const matchedOption = findBestMatchingOption(value, options);
    const targetValue = matchedOption || value;

    // Collect all candidate radio buttons from multiple strategies
    let radios: Awaited<ReturnType<Page['$$']>> = [];

    // Strategy 1: by name attribute
    if (field.name) {
      radios = await root.$$(`input[type="radio"][name="${field.name}"]`);
    }

    // Strategy 2: find radios near the label text (for forms without name attributes)
    if (radios.length === 0 && field.label) {
      const container = await findQuestionContainer(root, field.label);
      if (container) {
        radios = await container.$$('input[type="radio"]');
      }
    }

    // Strategy 3: broad search by label text
    if (radios.length === 0 && field.label) {
      radios = await root.$$('input[type="radio"]');
    }

    for (const radio of radios) {
      const radioValue = await radio.getAttribute('value');
      const radioLabel = await root.evaluate((el) => {
        const label = el.closest('label') || document.querySelector(`label[for="${el.id}"]`);
        return label?.textContent?.trim() || '';
      }, radio);

      if (
        radioValue?.toLowerCase() === targetValue.toLowerCase() ||
        radioLabel.toLowerCase().includes(targetValue.toLowerCase()) ||
        targetValue.toLowerCase().includes(radioLabel.toLowerCase())
      ) {
        await radio.check();
        await humanDelay();
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

export async function fillCheckbox(
  page: Page,
  root: Page | Frame,
  field: FormField,
  value: string,
  humanDelay: () => Promise<void>
) {
  try {
    const shouldCheck = ['yes', 'true', '1', 'checked'].includes(value.toLowerCase());

    // Strategy 1: by name attribute
    let checkbox = field.name ? await root.$(`input[type="checkbox"][name="${field.name}"]`) : null;

    // Strategy 2: find checkbox near the label text
    if (!checkbox && field.label) {
      const container = await findQuestionContainer(root, field.label);
      if (container) {
        checkbox = await container.$('input[type="checkbox"]');
      }
    }

    // Strategy 3: find by label association
    if (!checkbox && field.label) {
      checkbox = await findInputByLabel(root, field.label);
    }

    if (!checkbox) return false;

    if (shouldCheck) {
      await checkbox.check();
    } else {
      await checkbox.uncheck();
    }

    await humanDelay();
    return true;
  } catch {
    return false;
  }
}

export async function fillFileInput(
  page: Page,
  root: Page | Frame,
  selector: string,
  field: FormField,
  options: FormFillerOptions,
  _humanDelay: () => Promise<void>
) {
  const label = (field.label || '').toLowerCase();
  const name = (field.name || '').toLowerCase();
  const combined = `${label} ${name}`;

  let filePath: string | null = null;

  // Determine which file to upload
  if (FIELD_PATTERNS.resume.test(combined)) {
    filePath = options.resumePath || null;
  } else if (FIELD_PATTERNS.coverLetter.test(combined)) {
    filePath = options.coverLetterPath || null;
  }

  if (!filePath) {
    return false;
  }

  try {
    let fileInput = await root.$(selector);

    if (!fileInput) {
      fileInput = await root.$('input[type="file"]');
    }

    if (!fileInput) {
      // No file input found — try clicking an upload button to trigger a file chooser
      const uploadButton = await root.$(
        '[class*="upload"], [class*="attach"], button:has-text("Upload")'
      );
      if (uploadButton) {
        const [fileChooser] = await Promise.all([
          page.waitForEvent('filechooser'),
          uploadButton.click(),
        ]);
        await fileChooser.setFiles(filePath);
        await waitForFileUploaded(page);
        return true;
      }
      return false;
    }

    const uploaded = await handleFileUpload(
      page,
      fileInput as unknown as import('playwright').ElementHandle<HTMLInputElement>,
      filePath
    );
    if (uploaded) {
      await waitForFileUploaded(page);
      return true;
    }

    await fileInput.setInputFiles(filePath);
    await waitForFileUploaded(page);
    return true;
  } catch {
    return false;
  }
}
