import type { Page, ElementHandle } from 'playwright';
import { join } from 'path';
import type { CustomQuestion } from '../types';

export function normalizeText(text: string | null | undefined): string {
  if (!text) return '';
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Normalizes a form label for comparison by removing excess whitespace and asterisks.
 */
export function normalizeLabel(text: string | null | undefined): string {
  if (!text) return '';
  return text.toLowerCase().replace(/\s+/g, ' ').replace(/\*+$/, '').trim();
}

/**
 * Derives a normalized country name from a location string.
 */
export function countryFromLocation(location: string): string {
  if (!location) return 'United States';
  const loc = location.toLowerCase();
  
  if (loc.includes('united states') || loc.includes('us') || loc.includes('usa')) return 'United States';
  if (loc.includes('united kingdom') || loc.includes('uk') || loc.includes('great britain')) return 'United Kingdom';
  if (loc.includes('canada')) return 'Canada';
  if (loc.includes('australia')) return 'Australia';
  if (loc.includes('india')) return 'India';
  if (loc.includes('germany') || loc.includes('deutschland')) return 'Germany';
  if (loc.includes('france')) return 'France';
  if (loc.includes('spain') || loc.includes('españa')) return 'Spain';
  if (loc.includes('italy') || loc.includes('italia')) return 'Italy';
  if (loc.includes('brazil') || loc.includes('brasil')) return 'Brazil';
  if (loc.includes('mexico')) return 'Mexico';
  if (loc.includes('netherlands') || loc.includes('holland')) return 'Netherlands';
  if (loc.includes('sweden') || loc.includes('sverige')) return 'Sweden';
  if (loc.includes('nigeria')) return 'Nigeria';
  
  // Default fallback if a comma is present (assumes "City, Country" format tentatively)
  const parts = location.split(',');
  if (parts.length > 1) {
    return parts[parts.length - 1].trim();
  }
  
  return location;
}

/**
 * Attempts to take a screenshot if configured and returns the path.
 */
export async function takeScreenshotIfEnabled(
  page: Page, 
  prefix: string, 
  configResolver: () => { application: { saveScreenshots: boolean } },
  dirResolver: () => string
): Promise<string | undefined> {
  const config = configResolver();
  if (!config.application.saveScreenshots) return undefined;

  try {
    const screenshotPath = join(dirResolver(), 'screenshots', `${prefix}_${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    return screenshotPath;
  } catch {
    return undefined;
  }
}

/**
 * Safely evaluates an accessible name for an ElementHandle using aria attributes, labels, or text content.
 */
export async function getAccessibleName(handle: ElementHandle): Promise<string> {
  return handle.evaluate((node) => {
    const element = node as HTMLElement;
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel?.trim()) return ariaLabel.trim();

    const labelledBy = element.getAttribute('aria-labelledby');
    if (labelledBy) {
      const ids = labelledBy.split(/\s+/);
      const labelText = ids
        .map((id) => document.getElementById(id)?.textContent?.trim() || '')
        .filter(Boolean)
        .join(' ');
      if (labelText) return labelText;
    }

    const parentLabel = element.closest('label');
    if (parentLabel?.textContent?.trim()) return parentLabel.textContent.trim();

    const prev = element.previousElementSibling as HTMLElement | null;
    if (prev?.textContent?.trim()) return prev.textContent.trim();

    return element.textContent?.trim() || '';
  });
}

/**
 * Safely evaluates an option label from a combobox, select option, or radio button.
 */
export async function getOptionLabel(handle: ElementHandle): Promise<string> {
  return handle.evaluate((node) => {
    const element = node as HTMLElement;
    const text = element.textContent?.trim();
    if (text) return text;

    if (element instanceof HTMLInputElement && element.type === 'radio') {
      const id = element.id;
      if (id) {
        const label = document.querySelector(`label[for="${id}"]`);
        if (label?.textContent?.trim()) return label.textContent.trim();
      }
      const parentLabel = element.closest('label');
      if (parentLabel?.textContent?.trim()) return parentLabel.textContent.trim();
      const ariaLabel = element.getAttribute('aria-label');
      if (ariaLabel?.trim()) return ariaLabel.trim();
    }

    const dataValue = element.getAttribute('data-value');
    if (dataValue?.trim()) return dataValue.trim();

    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel?.trim()) return ariaLabel.trim();

    const title = element.getAttribute('title');
    if (title?.trim()) return title.trim();

    return '';
  });
}

/**
 * Clicks the best matching option from a list of elements based on their text content.
 * Returns true if an option was clicked.
 */
export async function clickMatchingOption(
  elements: ElementHandle[],
  targetText: string,
  _autoMode = false,
  getLabel: (el: ElementHandle) => Promise<string> = getOptionLabel
): Promise<boolean> {
  if (elements.length === 0) return false;

  for (const el of elements) {
    const text = await getLabel(el);
    if (text?.trim().toLowerCase() === targetText.toLowerCase()) {
      await el.click().catch(() => {});
      return true;
    }
  }

  // If autoMode and no match, optionally click the first one (up to caller to skip or not).
  // Usually the caller decides whether to click the first element. We just return false here so caller can handle it.
  return false;
}

/**
 * Generic extraction of custom questions from common DOM containers.
 */
export async function extractCustomQuestionsFromContainers(
  page: Page, 
  containers: ElementHandle[], 
  platformPrefix: string,
  skipLabels: string[] = ['name', 'email', 'phone', 'resume', 'cv', 'cover letter']
): Promise<CustomQuestion[]> {
  const questions: CustomQuestion[] = [];

  for (let i = 0; i < containers.length; i++) {
    const container = containers[i];
    
    const questionText = await container.$eval(
      'label, .question-text, .question-label, [class*="label"], legend',
      (el) => el.textContent?.trim() ?? ''
    ).catch(() => '');

    if (!questionText) continue;

    if (skipLabels.length > 0 && skipLabels.some((skip) => questionText.toLowerCase().includes(skip))) {
      continue;
    }

    const hasTextarea = (await container.$('textarea')) !== null;
    const hasSelect = (await container.$('select')) !== null;
    const hasRadio = (await container.$('input[type="radio"]')) !== null;
    const hasCheckbox = (await container.$('input[type="checkbox"]')) !== null;

    let type: CustomQuestion['type'] = 'text';
    let options: string[] | undefined;

    if (hasTextarea) {
      type = 'textarea';
    } else if (hasSelect) {
      type = 'select';
      options = await container.$$eval('select option', (opts) =>
        opts.map((o) => o.textContent?.trim() ?? '').filter(Boolean)
      ).catch(() => []);
    } else if (hasRadio) {
      type = 'radio';
      options = await container.$$eval('input[type="radio"]', (radios) => 
        radios.map((r) => r.getAttribute('value') ?? '').filter(Boolean)
      ).catch(() => []);
      
      if (!options || options.length === 0) {
        // Try getting labels associated with radios if value attribute is missing or empty
        options = await container.$$eval('input[type="radio"]', (radios) => {
           return radios.map(r => {
             const lbl = r.closest('label') || document.querySelector(`label[for="${r.id}"]`);
             return lbl ? lbl.textContent?.trim() ?? '' : (r as HTMLInputElement).value;
           }).filter(Boolean);
        }).catch(() => []);
      }
    } else if (hasCheckbox) {
      type = 'checkbox';
      options = await container.$$eval('input[type="checkbox"]', (check) => 
        check.map((c) => c.getAttribute('value') ?? '').filter(Boolean)
      ).catch(() => []);
    }

    const required = (await container.$('[required], [aria-required="true"]')) !== null;

    questions.push({
      id: `${platformPrefix}_q_${i}`,
      question: questionText,
      type,
      required,
      options: options?.length ? options : undefined,
    });
  }

  return questions;
}
