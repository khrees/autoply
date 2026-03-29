import type { Page, Frame, ElementHandle } from 'playwright';

export const ARIA_ROLES = {
  textbox: '[role="textbox"]',
  combobox: '[role="combobox"]',
  listbox: '[role="listbox"]',
  option: '[role="option"]',
  optionGroup: '[role="optiongroup"]',
  radio: '[role="radio"]',
  radiogroup: '[role="radiogroup"]',
  checkbox: '[role="checkbox"]',
  switch: '[role="switch"]',
  slider: '[role="slider"]',
  searchbox: '[role="searchbox"]',
  form: '[role="form"]',
  group: '[role="group"]',
  presentation: '[role="presentation"]',
} as const;

export interface SemanticSelector {
  role: keyof typeof ARIA_ROLES;
  label?: string;
  name?: string;
  placeholder?: string;
  multiple?: boolean;
}

export async function findBySemanticRole(
  page: Page | Frame,
  selector: SemanticSelector
): Promise<ElementHandle<Element> | null> {
  const { role, label, name, placeholder } = selector;
  const roleSelector = ARIA_ROLES[role];

  if (!roleSelector) return null;

  if (label) {
    const labelId = await findLabelId(page, label);
    if (labelId) {
      const selector = `${roleSelector}[aria-labelledby="${labelId}"], ${roleSelector}[aria-label*="${label}"]`;
      return page.$(selector);
    }
    return page.$(`${roleSelector}[aria-label*="${label}"]`);
  }

  if (name) {
    return page.$(`${roleSelector}[name="${name}"]`);
  }

  if (placeholder) {
    return page.$(`${roleSelector}[placeholder*="${placeholder}"]`);
  }

  return page.$(roleSelector);
}

async function findLabelId(page: Page | Frame, labelText: string): Promise<string | null> {
  const labels = await page.$$('label');
  for (const label of labels) {
    const text = await label.textContent();
    if (text?.toLowerCase().includes(labelText.toLowerCase())) {
      return label.getAttribute('id');
    }
  }
  return null;
}

export async function findAllBySemanticRole(
  page: Page | Frame,
  selector: SemanticSelector
): Promise<ElementHandle<Element>[]> {
  const { role } = selector;
  const roleSelector = ARIA_ROLES[role];
  if (!roleSelector) return [];

  const elements = await page.$$(roleSelector);

  if (!selector.label) return elements;

  const filtered: ElementHandle<Element>[] = [];
  for (const el of elements) {
    const ariaLabel = await el.getAttribute('aria-label');
    const labelledby = await el.getAttribute('aria-labelledby');

    if (labelledby) {
      const labelEl = await page.$(`#${labelledby}`);
      if (labelEl) {
        const text = await labelEl.textContent();
        if (text?.toLowerCase().includes(selector.label.toLowerCase())) {
          filtered.push(el);
        }
      }
    }

    if (ariaLabel?.toLowerCase().includes(selector.label.toLowerCase())) {
      filtered.push(el);
    }
  }

  return filtered;
}

export async function findInputBySemanticSearch(
  page: Page | Frame,
  label: string,
  fieldType?: 'text' | 'email' | 'tel' | 'number' | 'password' | 'url'
): Promise<ElementHandle<Element> | null> {
  const normalizedLabel = label.toLowerCase();

  const selectors = [
    `[aria-label*="${label}"]`,
    `[aria-label*="${normalizedLabel}"]`,
    `[placeholder*="${label}"]`,
    `[placeholder*="${normalizedLabel}"]`,
    '[role="combobox"]',
    '[role="searchbox"]',
    '[role="textbox"]',
    'input[type="text"]',
    'input[type="email"]',
    'input[type="tel"]',
    'input:not([type])',
  ];

  for (const selector of selectors) {
    const elements = await page.$$(selector);
    for (const el of elements) {
      if (await isElementVisible(el)) {
        const ariaLabel = await el.getAttribute('aria-label');
        const placeholder = await el.getAttribute('placeholder');
        const inputType = await el.getAttribute('type');

        if (ariaLabel?.toLowerCase().includes(normalizedLabel)) {
          return el;
        }
        if (placeholder?.toLowerCase().includes(normalizedLabel)) {
          return el;
        }
        if (inputType === fieldType) {
          const labelId = await el.getAttribute('id');
          if (labelId) {
            const labelEl = await page.$(`label[for="${labelId}"]`);
            if (labelEl) {
              const labelText = await labelEl.textContent();
              if (labelText?.toLowerCase().includes(normalizedLabel)) {
                return el;
              }
            }
          }
        }
      }
    }
  }

  return null;
}

async function isElementVisible(el: ElementHandle<Element>): Promise<boolean> {
  try {
    const isVisible = await el.isVisible();
    const isHidden = await el.evaluate((element) => {
      const style = window.getComputedStyle(element);
      return style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0';
    });
    return isVisible && !isHidden;
  } catch {
    return false;
  }
}

export function buildSemanticSelector(field: {
  label?: string;
  name?: string;
  type?: string;
}): string {
  const parts: string[] = [];

  if (field.label) {
    parts.push(`[aria-label*="${field.label}"]`);
    parts.push(`[placeholder*="${field.label}"]`);
  }

  if (field.name) {
    parts.push(`[name="${field.name}"]`);
  }

  switch (field.type) {
    case 'text':
    case 'email':
    case 'tel':
    case 'number':
    case 'password':
    case 'url':
      parts.push(`input[type="${field.type}"]`);
      break;
    case 'textarea':
      parts.push('textarea');
      break;
    case 'select':
      parts.push('select');
      break;
    case 'checkbox':
      parts.push('[role="checkbox"]');
      parts.push('input[type="checkbox"]');
      break;
    case 'radio':
      parts.push('[role="radio"]');
      parts.push('input[type="radio"]');
      break;
    case 'file':
      parts.push('input[type="file"]');
      break;
  }

  return parts.join(', ');
}
