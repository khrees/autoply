// Content script for Autoply Copilot
// Enhanced with AI-based field detection, error handling, and retry logic

interface AutofillPlan {
  [key: string]: string;
}

const SEMANTIC_SELECTORS = {
  firstName: [
    '[aria-label*="first name" i]',
    '[placeholder*="first name" i]',
    '[name*="first" i]',
    '[id*="first" i]',
    'input[autocomplete="given-name"]',
  ],
  lastName: [
    '[aria-label*="last name" i]',
    '[placeholder*="last name" i]',
    '[name*="last" i]',
    '[id*="last" i]',
    'input[autocomplete="family-name"]',
  ],
  fullName: [
    '[aria-label*="name" i]',
    '[placeholder*="name" i]',
    '[name*="name" i]',
    'input[autocomplete="name"]',
  ],
  email: [
    '[aria-label*="email" i]',
    '[placeholder*="email" i]',
    '[type="email"]',
    'input[autocomplete="email"]',
  ],
  phone: [
    '[aria-label*="phone" i]',
    '[placeholder*="phone" i]',
    '[type="tel"]',
    'input[autocomplete="tel"]',
  ],
  location: [
    '[aria-label*="location" i]',
    '[aria-label*="city" i]',
    '[placeholder*="location" i]',
    '[placeholder*="city" i]',
  ],
  linkedin: ['[aria-label*="linkedin" i]', '[placeholder*="linkedin" i]', '[name*="linkedin" i]'],
  github: ['[aria-label*="github" i]', '[placeholder*="github" i]', '[name*="github" i]'],
  resume: [
    '[aria-label*="resume" i]',
    '[aria-label*="cv" i]',
    '[name*="resume" i]',
    '[name*="cv" i]',
    'input[type="file"]',
  ],
  coverLetter: ['[aria-label*="cover letter" i]', '[name*="cover" i]', '[name*="letter" i]'],
};

const HUMAN_ONLY_PATTERNS = [
  /gender|sex/i,
  /ethnicity|race/i,
  /veteran/i,
  /disability/i,
  /ssn|social.*security/i,
  /salary|compensation/i,
  /date.*birth|dob/i,
  /address.*street/i,
  /visa.*sponsor/i,
];

function shouldSkipField(label: string): boolean {
  return HUMAN_ONLY_PATTERNS.some((pattern) => pattern.test(label));
}

async function findFieldBySemanticSearch(
  targetKey: string
): Promise<{ element: HTMLElement | null; confidence: number }> {
  const selectors = SEMANTIC_SELECTORS[targetKey as keyof typeof SEMANTIC_SELECTORS];
  if (!selectors) return { element: null, confidence: 0 };

  for (const selector of selectors) {
    try {
      const elements = Array.from(document.querySelectorAll(selector));
      for (const el of elements) {
        if (isElementVisible(el as HTMLElement)) {
          return { element: el as HTMLElement, confidence: 0.9 };
        }
      }
    } catch {
      continue;
    }
  }

  return { element: null, confidence: 0 };
}

async function findFieldByLabelMatch(labelText: string): Promise<HTMLElement | null> {
  const normalizedLabel = labelText.toLowerCase().trim();

  const labels = Array.from(document.querySelectorAll('label'));
  for (const label of labels) {
    const text = label.textContent?.toLowerCase() || '';
    if (text.includes(normalizedLabel) || normalizedLabel.includes(text)) {
      const forAttr = label.getAttribute('for');
      if (forAttr) {
        const input = document.getElementById(forAttr);
        if (input) return input;
      }

      const input = label.querySelector('input, textarea, select');
      if (input) return input as HTMLElement;

      const next = label.nextElementSibling;
      if (next && ['INPUT', 'TEXTAREA', 'SELECT'].includes(next.tagName)) {
        return next as HTMLElement;
      }
    }
  }

  const inputs = Array.from(document.querySelectorAll('input, textarea, select'));
  for (const input of inputs) {
    const ariaLabel = input.getAttribute('aria-label') || '';
    const placeholder = input.getAttribute('placeholder') || '';
    const name = input.getAttribute('name') || '';
    const id = input.getAttribute('id') || '';

    const searchText = normalizedLabel.replace(/[^a-z0-9]/g, '');

    if (
      ariaLabel.toLowerCase().includes(normalizedLabel) ||
      placeholder.toLowerCase().includes(normalizedLabel) ||
      name.toLowerCase().includes(searchText) ||
      id.toLowerCase().includes(searchText)
    ) {
      return input as HTMLElement;
    }
  }

  return null;
}

function isElementVisible(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el);
  return (
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    style.opacity !== '0' &&
    el.getBoundingClientRect().width > 0 &&
    el.getBoundingClientRect().height > 0
  );
}

function getFieldType(element: HTMLElement): string {
  if (element.tagName === 'SELECT') return 'select';
  if (element.tagName === 'TEXTAREA') return 'textarea';
  if (element.tagName === 'INPUT') {
    const type = (element as HTMLInputElement).type.toLowerCase();
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    if (type === 'file') return 'file';
    return type === 'email' || type === 'tel' ? type : 'text';
  }
  return 'text';
}

function dispatchInputEvents(element: HTMLElement): void {
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  element.dispatchEvent(new Event('blur', { bubbles: true }));
}

async function fillTextField(element: HTMLElement, value: string): Promise<boolean> {
  try {
    const input = element as HTMLInputElement | HTMLTextAreaElement;
    input.focus();
    input.value = '';
    input.value = value;
    dispatchInputEvents(element);
    return true;
  } catch {
    return false;
  }
}

async function fillSelectField(element: HTMLElement, value: string): Promise<boolean> {
  try {
    const select = element as HTMLSelectElement;
    const options = Array.from(select.options);
    const normalizedValue = value.toLowerCase().trim();

    const matchedOption = options.find(
      (opt) =>
        opt.textContent?.toLowerCase().includes(normalizedValue) ||
        opt.value.toLowerCase().includes(normalizedValue)
    );

    if (matchedOption) {
      select.value = matchedOption.value;
      dispatchInputEvents(element);
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

async function fillCheckboxField(element: HTMLElement, value: string): Promise<boolean> {
  try {
    const checkbox = element as HTMLInputElement;
    const shouldCheck = ['yes', 'true', '1', 'checked'].includes(value.toLowerCase().trim());
    checkbox.checked = shouldCheck;
    dispatchInputEvents(element);
    return true;
  } catch {
    return false;
  }
}

async function fillField(element: HTMLElement, value: string): Promise<boolean> {
  const fieldType = getFieldType(element);

  switch (fieldType) {
    case 'select':
      return fillSelectField(element, value);
    case 'checkbox':
      return fillCheckboxField(element, value);
    case 'text':
    case 'email':
    case 'tel':
    case 'textarea':
      return fillTextField(element, value);
    default:
      return fillTextField(element, value);
  }
}

async function fillWithRetry(
  element: HTMLElement,
  value: string,
  maxRetries = 2
): Promise<boolean> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const filled = await fillField(element, value);
    if (filled) return true;

    if (attempt < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  return false;
}

function uploadFile(input: HTMLInputElement, base64: string, filename: string): void {
  try {
    const byteString = atob(base64.split(',')[1] || base64);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
    const blob = new Blob([ab], { type: 'application/pdf' });
    const file = new File([blob], filename, { type: 'application/pdf' });

    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    input.files = dataTransfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  } catch (error) {
    console.error('Autoply: File upload error:', error);
  }
}

async function _buildFillPlanFromSemanticSearch(fillPlan: AutofillPlan): Promise<void> {
  const profileKeys = Object.keys(SEMANTIC_SELECTORS);

  for (const key of profileKeys) {
    if (fillPlan[key]) continue;

    const { element, confidence } = await findFieldBySemanticSearch(key);
    if (element && confidence > 0) {
      console.log(`Autoply: Found ${key} via semantic search (confidence: ${confidence})`);
    }
  }
}

function getFormFields(): Array<{ label: string; element: HTMLElement; type: string }> {
  const fields: Array<{ label: string; element: HTMLElement; type: string }> = [];
  const seen = new Set<HTMLElement>();

  const allSelectors =
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select';
  const allFields = Array.from(document.querySelectorAll(allSelectors)) as (
    | HTMLInputElement
    | HTMLTextAreaElement
    | HTMLSelectElement
  )[];

  for (const field of allFields) {
    if (seen.has(field as unknown as HTMLElement)) continue;
    seen.add(field as unknown as HTMLElement);

    let label = '';

    const ariaLabel = field.getAttribute('aria-label');
    if (ariaLabel) label = ariaLabel;

    const placeholder = field.getAttribute('placeholder');
    if (placeholder && !label) label = placeholder;

    const id = field.id;
    if (id) {
      const labelEl = document.querySelector(`label[for="${id}"]`);
      if (labelEl?.textContent) label = labelEl.textContent;
    }

    if (!label) {
      const parentLabel = field.closest('label');
      if (parentLabel?.textContent) label = parentLabel.textContent;
    }

    fields.push({
      label,
      element: field as HTMLElement,
      type: getFieldType(field as HTMLElement),
    });
  }

  return fields;
}

console.log('Autoply content script active');

// Listen for messages from the side panel
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'PING') {
    sendResponse({ status: 'OK' });
    return true;
  }

  if (message.type === 'GET_PAGE_DATA') {
    sendResponse({
      url: window.location.href,
      html: document.documentElement.outerHTML,
      title: document.title,
    });
    return true;
  }

  if (message.type === 'GET_FORM_FIELDS') {
    const fields = getFormFields();
    sendResponse({ fields });
    return true;
  }

  if (message.type === 'AUTOFILL_FORM') {
    const { fillPlan, documents } = message;
    console.log('Autoply: Starting autofill', { fillPlan, hasDocs: !!documents });

    const results: Array<{ key: string; success: boolean; error?: string }> = [];

    for (const [key, value] of Object.entries(fillPlan)) {
      if (shouldSkipField(key)) {
        console.log(`Autoply: Skipping ${key} (human-only field)`);
        results.push({ key, success: false, error: 'Skipped: requires human input' });
        continue;
      }

      (async () => {
        try {
          const element = await findFieldByLabelMatch(key);
          if (element) {
            const success = await fillWithRetry(element, String(value));
            if (success) {
              console.log(`Autoply: Filled ${key}`);
              results.push({ key, success: true });
            } else {
              console.log(`Autoply: Failed to fill ${key}`);
              results.push({ key, success: false, error: 'Fill operation failed' });
            }
          } else {
            console.log(`Autoply: Could not find field for ${key}`);
            results.push({ key, success: false, error: 'Field not found' });
          }
        } catch (error) {
          console.error(`Autoply: Error filling ${key}:`, error);
          results.push({ key, success: false, error: String(error) });
        }
      })();
    }

    if (documents) {
      const fileInputs = Array.from(
        document.querySelectorAll('input[type="file"]')
      ) as HTMLInputElement[];
      const uploadFileToInput = (input: HTMLInputElement, base64: string, filename: string) => {
        const context = (
          input.name +
          input.id +
          (input.closest('label')?.textContent || '')
        ).toLowerCase();
        if (context.includes('resume') || context.includes('cv')) {
          uploadFile(input, base64, filename);
        } else if (context.includes('cover') || context.includes('letter')) {
          uploadFile(input, base64, filename);
        }
      };

      for (const input of fileInputs) {
        uploadFileToInput(input, documents.resume, 'resume.pdf');
        uploadFileToInput(input, documents.coverLetter, 'cover_letter.pdf');
      }
    }

    sendResponse({
      success: true,
      results,
      message: 'Autofill initiated',
    });
    return true;
  }

  if (message.type === 'AUTOFILL_FIELD') {
    const { fieldKey, value } = message;

    (async () => {
      try {
        const element = await findFieldByLabelMatch(fieldKey);
        if (element) {
          const success = await fillWithRetry(element, value);
          sendResponse({ success, fieldKey });
        } else {
          sendResponse({ success: false, fieldKey, error: 'Field not found' });
        }
      } catch (error) {
        sendResponse({ success: false, fieldKey, error: String(error) });
      }
    })();

    return true;
  }

  return false;
});

// Observe DOM changes to detect dynamically loaded forms
const formObserver = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    if (mutation.addedNodes.length > 0) {
      console.log('Autoply: Form elements may have been added to the page');
    }
  }
});

formObserver.observe(document.body, {
  childList: true,
  subtree: true,
});
