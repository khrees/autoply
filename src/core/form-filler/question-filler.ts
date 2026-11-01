import type { Page, Frame } from 'playwright';
import type { CustomQuestion } from '../../types';

export async function fillQuestion(
  page: Page,
  root: Page | Frame,
  question: CustomQuestion,
  findBestMatchingOption: (val: string, opts: string[]) => string | null,
  humanDelay: () => Promise<void>
) {
  const answer = question.answer;
  if (!answer && question.type !== 'checkbox') {
    return false;
  }

  try {
    // Find the question container by matching the question text
    const container = await findQuestionContainer(root, question.question);
    if (!container) {
      return false;
    }

    switch (question.type) {
      case 'text': {
        const input = await container.$('input[type="text"], input:not([type])');
        if (input) {
          // Don't overwrite fields that already contain a valid URL (e.g. LinkedIn, GitHub)
          const currentValue = await input.inputValue().catch(() => '');
          if (currentValue && /^https?:\/\//i.test(currentValue)) {
            return true; // Already filled with a URL, skip
          }
          if (answer) {
            await input.fill(answer);
            await humanDelay();
          }
          return true;
        }
        break;
      }

      case 'textarea': {
        const textarea = await container.$('textarea');
        if (textarea) {
          if (answer) {
            await textarea.fill(answer);
            await humanDelay();
          }
          return true;
        }
        break;
      }

      case 'select': {
        const select = await container.$('select');
        if (select && question.options) {
          const matchedOption = answer ? findBestMatchingOption(answer, question.options) : null;
          if (matchedOption) {
            await select.selectOption({ label: matchedOption });
            await humanDelay();
            return true;
          }
        }
        break;
      }

      case 'radio': {
        if (question.options) {
          const matchedOption = answer ? findBestMatchingOption(answer, question.options) : null;
          const radios = await container.$$('input[type="radio"]');
          for (const radio of radios) {
            const radioValue = await radio.getAttribute('value');
            const radioLabel = await root.evaluate((el) => {
              const label = el.closest('label') || document.querySelector(`label[for="${el.id}"]`);
              return label?.textContent?.trim() || '';
            }, radio);

            if (
              radioValue === matchedOption ||
              radioLabel.toLowerCase().includes((matchedOption || '').toLowerCase())
            ) {
              await radio.check();
              await humanDelay();
              return true;
            }
          }
        }
        break;
      }

      case 'checkbox': {
        const checkboxes = await container.$$('input[type="checkbox"]');
        const selectedOptions = answer?.split(',').map((s) => s.trim().toLowerCase()) || [];

        for (const checkbox of checkboxes) {
          const checkboxValue = await checkbox.getAttribute('value');
          const checkboxLabel = await root.evaluate((el) => {
            const label = el.closest('label') || document.querySelector(`label[for="${el.id}"]`);
            return label?.textContent?.trim() || '';
          }, checkbox);

          const shouldCheck = selectedOptions.some(
            (opt) =>
              checkboxValue?.toLowerCase().includes(opt) ||
              checkboxLabel.toLowerCase().includes(opt)
          );

          if (shouldCheck) {
            await checkbox.check();
          }
        }
        await humanDelay();
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

export async function findQuestionContainer(root: Page | Frame, questionText: string) {
  // Normalize the question text for matching
  const normalizedQuestion = questionText.toLowerCase().trim().slice(0, 50);

  // Try to find container by label text
  const selectors = [
    '[class*="question"]',
    '[class*="field"]',
    '.form-group',
    '[class*="form-element"]',
    'fieldset',
  ];

  for (const selector of selectors) {
    const containers = await root.$$(selector);
    for (const container of containers) {
      const text = await container.textContent();
      if (text?.toLowerCase().includes(normalizedQuestion)) {
        return container;
      }
    }
  }

  // Fallback: find by label
  const labels = await root.$$('label');
  for (const label of labels) {
    const text = await label.textContent();
    if (text?.toLowerCase().includes(normalizedQuestion)) {
      // Find the parent container
      const parentSelector = await root.evaluate((el) => {
        const parent = el.closest('.form-group, fieldset, [class*="question"]') || el.parentElement;
        if (parent && parent.id) return `#${parent.id}`;
        if (parent && parent.className) return `.${parent.className.split(' ').join('.')}`;
        return null;
      }, label);

      if (parentSelector) {
        return root.$(parentSelector);
      }
    }
  }

  return null;
}

export async function findInputByLabel(root: Page | Frame, labelText: string) {
  const normalizedLabel = labelText.toLowerCase();

  // Find label by text content
  const labels = await root.$$('label');
  for (const label of labels) {
    const text = await label.textContent();
    if (text?.toLowerCase().includes(normalizedLabel)) {
      // Get the for attribute
      const forAttr = await label.getAttribute('for');
      if (forAttr) {
        const safeForAttr = forAttr.replace(/"/g, '\\"');
        return root.$(`[id="${safeForAttr}"]`);
      }

      // Find input inside label
      const input = await label.$('input, textarea, select');
      if (input) return input;

      // Find input as next sibling
      const nextSelector = await root.evaluate((el) => {
        const next = el.nextElementSibling;
        if (next?.matches('input, textarea, select')) {
          if (next.id) return `#${next.id}`;
          if (next.getAttribute('name')) return `[name="${next.getAttribute('name')}"]`;
        }
        return null;
      }, label);

      if (nextSelector) {
        const nextElement = await root.$(nextSelector);
        if (nextElement) return nextElement;
      }
    }
  }

  return null;
}
