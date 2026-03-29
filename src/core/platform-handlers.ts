import type { Page, ElementHandle } from 'playwright';

export interface ReactSelectOption {
  value: string;
  label: string;
}

export async function handleReactSelect(
  page: Page,
  container: ElementHandle<Element>,
  value: string
): Promise<boolean> {
  try {
    const trigger = await container.$(
      '.css-1waevz9-LegacySelect__placeholder, [class*="react-select"] [class*="placeholder"], [class*="Select-placeholder"]'
    );
    if (trigger) {
      await trigger.click();
      await page.waitForTimeout(300);
    }

    const options = await page.$$('[role="option"], [role="listbox"] [class*="option"]');
    for (const option of options) {
      const text = await option.textContent();
      if (text?.toLowerCase().includes(value.toLowerCase())) {
        await option.click();
        return true;
      }
    }

    await page.keyboard.type(value, { delay: 50 });
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter');
    return true;
  } catch {
    return false;
  }
}

export async function handleChakraSelect(
  page: Page,
  container: ElementHandle<Element>,
  value: string
): Promise<boolean> {
  try {
    const trigger = await container.$(
      '[data-testid*="select"], [class*="chakra-select"], button[aria-haspopup="listbox"]'
    );
    if (trigger) {
      await trigger.click();
      await page.waitForTimeout(300);
    }

    const options = await page.$$('[role="option"]');
    for (const option of options) {
      const text = await option.textContent();
      if (text?.toLowerCase().includes(value.toLowerCase())) {
        await option.click();
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

export async function handleMaterialUISelect(
  page: Page,
  container: ElementHandle<Element>,
  value: string
): Promise<boolean> {
  try {
    const input = await container.$(
      'input[class*="MuiSelect-select"], [class*="MuiSelect-nativeInput"]'
    );
    if (input) {
      await input.click();
      await page.waitForTimeout(300);
    }

    const menu = await page.$('[role="listbox"], [class*="MuiMenu"]');
    if (menu) {
      const options = await menu.$$('[role="option"], li');
      for (const option of options) {
        const text = await option.textContent();
        if (text?.toLowerCase().includes(value.toLowerCase())) {
          await option.click();
          return true;
        }
      }
    }

    return false;
  } catch {
    return false;
  }
}

export async function handleFileUpload(
  page: Page,
  fileInput: ElementHandle<HTMLInputElement>,
  filePath: string,
  maxRetries = 3
): Promise<boolean> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const isVisible = await fileInput.isVisible();
      const isHidden = await fileInput.evaluate((el) => {
        const style = window.getComputedStyle(el);
        return (
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          el.getAttribute('type') === 'hidden'
        );
      });

      if (!isHidden || isVisible) {
        await fileInput.setInputFiles(filePath);
        await page.waitForTimeout(500);
        return true;
      }

      const dropzone = await findDropzoneForInput(page, fileInput);
      if (dropzone) {
        const [fileChooser] = await Promise.all([
          page.waitForEvent('filechooser'),
          dropzone.click(),
        ]);
        await fileChooser.setFiles(filePath);
        return true;
      }

      return false;
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }
      await page.waitForTimeout(500 * attempt);
    }
  }

  return false;
}

async function findDropzoneForInput(
  page: Page,
  fileInput: ElementHandle<HTMLInputElement>
): Promise<ElementHandle<Element> | null> {
  const inputLabel = await fileInput.evaluate((el) => {
    const id = el.id;
    if (id) {
      const label = document.querySelector(`label[for="${id}"]`);
      return label?.textContent || '';
    }
    const parent = el.closest('label');
    return parent?.textContent || '';
  });

  if (inputLabel) {
    const dropzones = await page.$$(
      '[class*="dropzone"], [class*="upload"], [class*="attach"], [class*="file-upload"]'
    );
    for (const dz of dropzones) {
      const text = await dz.textContent();
      if (text?.toLowerCase().includes(inputLabel.toLowerCase())) {
        return dz;
      }
    }
  }

  return page.$('[class*="dropzone"], [class*="upload-zone"]');
}

export async function findHiddenFileInput(
  page: Page,
  label: string
): Promise<ElementHandle<HTMLInputElement> | null> {
  const normalizedLabel = label.toLowerCase();

  const selectors = ['input[type="file"]', '[class*="file-input"]', '[data-test*="file"]'];

  for (const selector of selectors) {
    const inputs = await page.$$(selector);
    for (const input of inputs) {
      const inputLabel = await page.evaluate((el) => {
        const id = el.id;
        if (id) {
          const label = document.querySelector(`label[for="${id}"]`);
          return label?.textContent?.toLowerCase() || '';
        }
        const parent = el.closest('label');
        return parent?.textContent?.toLowerCase() || '';
      }, input);

      if (inputLabel.includes(normalizedLabel)) {
        return input as ElementHandle<HTMLInputElement>;
      }
    }
  }

  return null;
}

export async function clickUploadButton(page: Page, label: string): Promise<boolean> {
  const normalizedLabel = label.toLowerCase();

  const buttonSelectors = [
    `[aria-label*="${label}"]`,
    `[aria-label*="${normalizedLabel}"]`,
    `button[class*="upload"]`,
    `button[class*="attach"]`,
    `button:has-text("Upload")`,
    `button:has-text("Attach")`,
    `a[class*="upload"]`,
  ];

  for (const selector of buttonSelectors) {
    try {
      const button = await page.$(selector);
      if (button && (await button.isVisible())) {
        await button.click();
        return true;
      }
    } catch {
      continue;
    }
  }

  return false;
}

export async function waitForFileUploaded(page: Page, timeout = 10000): Promise<boolean> {
  try {
    const indicators = [
      '[class*="uploaded"]',
      '[class*="success"]',
      '[class*="complete"]',
      '[class*="filename"]',
      '[class*="preview"]',
    ];

    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      for (const selector of indicators) {
        const el = await page.$(selector);
        if (el && (await el.isVisible())) {
          return true;
        }
      }
      await page.waitForTimeout(500);
    }

    return false;
  } catch {
    return false;
  }
}
