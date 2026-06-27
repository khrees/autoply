// Content script for Autoply Copilot
// Works entirely client-side using Chrome's autocomplete attribute + semantic matching
// No AI needed for basic form filling - this is how simplify.jobs works

const DEBUG = false;
function debugLog(...args: unknown[]) {
  if (DEBUG) {
    console.log(...args);
  }
}

const AUTOCOMPLETE_TO_PROFILE_KEY: Record<string, string> = {
  'given-name': 'firstName',
  'additional-name': 'middleName',
  'family-name': 'lastName',
  name: 'fullName',
  email: 'email',
  tel: 'phone',
  'tel-national': 'phone',
  url: 'url',
  photo: 'photoUrl',
  nickname: 'nickname',
};

// Map name attributes to profile keys (handles Workable, Ashby, etc.)
const NAME_TO_PROFILE_KEY: Record<string, string> = {
  firstname: 'firstName',
  first_name: 'firstName',
  lastname: 'lastName',
  last_name: 'lastName',
  email: 'email',
  phone: 'phone',
  telephone: 'phone',
  mobile: 'phone',
  headline: 'headline',
  address: 'address',
  city: 'city',
  location: 'location',
  postcode: 'postcode',
  zip: 'postcode',
  zipcode: 'postcode',
  country: 'country',
  state: 'location',
  province: 'location',
  linkedin: 'linkedin',
  github: 'github',
  portfolio: 'portfolio',
  website: 'portfolio',
  url: 'url',
  name: 'fullName',
  fullname: 'fullName',
  full_name: 'fullName',
};

interface Profile {
  // Standard fields
  firstName: string;
  lastName: string;
  fullName: string;
  middleName?: string;
  email: string;
  phone: string;
  location?: string;
  linkedin?: string;
  github?: string;
  portfolio?: string;
  photoUrl?: string;
  nickname?: string;
  resumeUrl?: string;
  // Extended fields (Workable, Ashby, etc.)
  address?: string;
  city?: string;
  postcode?: string;
  country?: string;
  state?: string;
  headline?: string;
}

const HUMAN_ONLY_PATTERNS = [
  /gender|sex/i,
  /ethnicity|race/i,
  /veteran/i,
  /disability/i,
  /ssn|social.*security/i,
  /salary.*expectation|expected.*salary|desired.*salary/i,
  /date.*birth|dob/i,
  /street.*address|address.*line/i,
  /visa.*sponsor/i,
  /passport/i,
];

function shouldSkipField(label: string): boolean {
  return HUMAN_ONLY_PATTERNS.some((pattern) => pattern.test(label));
}

function isFormElement(el: Element): boolean {
  const tagName = el.tagName;
  if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(tagName)) return false;

  const input = el as HTMLInputElement;
  if (['hidden', 'submit', 'button', 'reset', 'image'].includes(input.type)) return false;

  return true;
}

function isVisible(el: Element): boolean {
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')
    return false;
  const rect = (el as HTMLElement).getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function getFieldLabel(el: Element): string {
  const input = el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

  // Try autocomplete first
  const autocomplete = input.getAttribute('autocomplete');
  if (autocomplete) return autocomplete;

  // Try aria-label
  const ariaLabel = input.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel;

  // Try placeholder
  const placeholder = input.getAttribute('placeholder');
  if (placeholder) return placeholder;

  // Try associated label
  const id = input.id;
  if (id) {
    const label = document.querySelector(`label[for="${id}"]`);
    if (label?.textContent) return label.textContent.trim();
  }

  // Try parent label
  const parentLabel = input.closest('label');
  if (parentLabel?.textContent) return parentLabel.textContent.trim();

  // Try name attribute
  const name = input.name;
  if (name) return name;

  return '';
}

function dispatchReactEvents(el: Element): void {
  const target = el as HTMLElement;

  // React/Angular/Vue all listen to these events
  target.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
  target.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }));
  target.dispatchEvent(new Event('change', { bubbles: true }));
  target.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
}

function setNativeInputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  if (input instanceof HTMLInputElement) {
    // Get the native value setter from HTMLInputElement prototype
    const nativeValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )?.set;

    if (nativeValueSetter) {
      // Use native setter (works for React controlled components)
      nativeValueSetter.call(input, value);
    } else {
      // Fallback
      input.value = value;
    }
  } else {
    // HTMLTextAreaElement
    input.value = value;
  }

  // React needs these specific events
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

async function fillTextInput(el: Element, value: string): Promise<boolean> {
  try {
    const input = el as HTMLInputElement | HTMLTextAreaElement;

    // Check if it's a custom dropdown
    if (isCustomDropdown(el as HTMLElement)) {
      return fillCustomDropdown(el as HTMLElement, value);
    }

    input.focus();
    await humanJitter(20, 80); // brief pause after focus — mimics human reading the field
    input.select?.();
    setNativeInputValue(input, value);

    return true;
  } catch {
    return false;
  }
}

function isCustomDropdown(el: HTMLElement): boolean {
  const parent = el.closest(
    '[class*="select"], [class*="Select"], [role="combobox"], [data-testid*="select"]'
  );
  return parent !== null;
}

// Small random delay to mimic human reaction time and avoid bot-detection heuristics.
// Kept short (30–120ms) so it doesn't noticeably slow fills but breaks timing fingerprints.
function humanJitter(minMs = 30, maxMs = 120): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, minMs + Math.random() * (maxMs - minMs)));
}

function waitForElement(selector: string, timeoutMs = 400): Promise<Element | null> {
  return new Promise((resolve) => {
    const existing = document.querySelector(selector);
    if (existing) return resolve(existing);

    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) {
        observer.disconnect();
        resolve(el);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeoutMs);
  });
}

async function fillCustomDropdown(el: HTMLElement, value: string): Promise<boolean> {
  try {
    el.click();

    // Wait for options to appear rather than sleeping a fixed time
    const optionEl = await waitForElement(
      '[role="option"], [role="listbox"] li, [class*="option"], [class*="menu"] li, ul[role="listbox"] li'
    );

    if (optionEl) {
      const allOptions = Array.from(
        document.querySelectorAll(
          '[role="option"], [role="listbox"] li, [class*="option"], [class*="menu"] li, ul[role="listbox"] li'
        )
      );
      const lv = value.toLowerCase();
      for (const option of allOptions) {
        const text = option.textContent?.toLowerCase() || '';
        if (text.includes(lv) || lv.includes(text)) {
          await humanJitter(60, 180); // pause before selecting — mimics scanning the list
          (option as HTMLElement).click();
          return true;
        }
      }
    }

    // Fallback: type to filter via combobox input
    const combobox = document.querySelector(
      '[role="combobox"], input[class*="select"]'
    ) as HTMLInputElement | null;
    if (combobox) {
      combobox.value = value;
      combobox.dispatchEvent(new InputEvent('input', { bubbles: true }));

      const firstOption = await waitForElement('[role="option"]');
      if (firstOption) {
        (firstOption as HTMLElement).click();
        return true;
      }
    }

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return false;
  } catch {
    return false;
  }
}

async function fillSelect(el: Element, value: string): Promise<boolean> {
  try {
    if (isCustomDropdown(el as HTMLElement)) {
      return fillCustomDropdown(el as HTMLElement, value);
    }

    const select = el as HTMLSelectElement;
    const normalizedValue = value.toLowerCase().trim();

    const options = Array.from(select.options);
    const matched =
      options.find((opt) => opt.value.toLowerCase() === normalizedValue) ||
      options.find((opt) => opt.textContent?.toLowerCase().includes(normalizedValue));

    if (matched) {
      select.value = matched.value;
      dispatchReactEvents(el);
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

async function fillRadio(el: Element, value: string): Promise<boolean> {
  try {
    const radio = el as HTMLInputElement;
    const normalizedValue = value.toLowerCase().trim();

    const name = radio.name;
    const radios = name
      ? Array.from(document.querySelectorAll(`input[type="radio"][name="${name}"]`))
      : [radio];

    for (const r of radios) {
      const radioEl = r as HTMLInputElement;
      const radioValue = radioEl.value?.toLowerCase() || '';
      const label = radioEl.closest('label')?.textContent?.toLowerCase() || '';

      if (
        radioValue === normalizedValue ||
        label.includes(normalizedValue) ||
        normalizedValue.includes(radioValue)
      ) {
        radioEl.checked = true;
        dispatchReactEvents(r);
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

async function fillCheckbox(el: Element, value: string): Promise<boolean> {
  try {
    const checkbox = el as HTMLInputElement;
    const shouldCheck = ['yes', 'true', '1', 'y'].includes(value.toLowerCase());

    if (checkbox.checked !== shouldCheck) {
      checkbox.checked = shouldCheck;
      dispatchReactEvents(el);
    }

    return true;
  } catch {
    return false;
  }
}

async function findAndFillField(
  profile: Profile,
  profileKey: string,
  selectors: string[]
): Promise<boolean> {
  const value = profile[profileKey as keyof Profile];
  if (!value) return false;

  for (const selector of selectors) {
    try {
      const elements = Array.from(document.querySelectorAll(selector));
      for (const el of elements) {
        if (!isFormElement(el)) continue;
        if (!isVisible(el)) continue;

        const label = getFieldLabel(el);
        if (shouldSkipField(label)) continue;

        const fieldType = (el as HTMLInputElement).type;

        if (fieldType === 'select' || el.tagName === 'SELECT') {
          if (await fillSelect(el, value)) return true;
        } else if (fieldType === 'radio') {
          if (await fillRadio(el, value)) return true;
        } else if (fieldType === 'checkbox') {
          if (await fillCheckbox(el, value)) return true;
        } else if (fieldType === 'file') {
          // File uploads handled separately
          continue;
        } else {
          if (await fillTextInput(el, value)) return true;
        }
      }
    } catch {
      continue;
    }
  }

  return false;
}

async function findAndFillByLabelMatch(profile: Profile, labelText: string): Promise<boolean> {
  // Match label text to profile fields
  if (/first|given|fname/i.test(labelText)) {
    return findAndFillField(profile, 'firstName', ['input:not([type])', 'input[type="text"]']);
  }
  if (/last|surname|family|lname/i.test(labelText)) {
    return findAndFillField(profile, 'lastName', ['input:not([type])', 'input[type="text"]']);
  }
  if (/email|mail/i.test(labelText)) {
    return findAndFillField(profile, 'email', ['input[type="email"]', 'input:not([type])']);
  }
  if (/phone|tel|mobile|cell/i.test(labelText)) {
    return findAndFillField(profile, 'phone', ['input[type="tel"]', 'input:not([type])']);
  }
  if (/linkedin/i.test(labelText)) {
    return findAndFillField(profile, 'linkedin', ['input[type="url"]', 'input:not([type])']);
  }
  if (/github|gh/i.test(labelText)) {
    return findAndFillField(profile, 'github', ['input[type="url"]', 'input:not([type])']);
  }
  if (/portfolio|website|personal/i.test(labelText)) {
    return findAndFillField(profile, 'portfolio', ['input[type="url"]', 'input:not([type])']);
  }
  if (/city|location/i.test(labelText)) {
    return findAndFillField(profile, 'location', ['input:not([type])']);
  }

  return false;
}

async function uploadResumeFile(base64: string, filename: string): Promise<boolean> {
  const fileInputs = Array.from(
    document.querySelectorAll('input[type="file"]')
  ) as HTMLInputElement[];

  for (const input of fileInputs) {
    if (!isVisible(input)) continue;

    const context = (
      input.name +
      ' ' +
      input.id +
      ' ' +
      (input.getAttribute('aria-label') || '') +
      ' ' +
      (input.closest('label')?.textContent || '') +
      ' ' +
      (input.getAttribute('accept') || '')
    ).toLowerCase();

    if (
      context.includes('resume') ||
      context.includes('cv') ||
      context.includes('curriculum') ||
      context.includes('.pdf')
    ) {
      try {
        const mimeType = 'application/pdf';
        const byteString = atob(base64.split(',')[1] || base64);
        const ab = new ArrayBuffer(byteString.length);
        const ia = new Uint8Array(ab);
        for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
        const blob = new Blob([ab], { type: mimeType });
        const file = new File([blob], filename, { type: mimeType });
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        input.files = dataTransfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new InputEvent('input', { bubbles: true }));
        console.log(`Autoply: Resume uploaded to input[name="${input.name || input.id}"]`);
        return true;
      } catch {
        // try next input
      }
    }
  }
  return false;
}

// Classify a form element to a profile key using a single ordered lookup chain.
// Checks: autocomplete attr → name attr → id attr → label/placeholder text.
function classifyElement(el: Element, label: string): string | null {
  const input = el as HTMLInputElement;

  // 1. Autocomplete attribute — most reliable signal
  const autocomplete = input.getAttribute('autocomplete');
  if (autocomplete) {
    const key = AUTOCOMPLETE_TO_PROFILE_KEY[autocomplete.toLowerCase()];
    if (key) return key;
  }

  // 2. Name attribute — direct and partial match
  const name = input.name?.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (name) {
    for (const [nameAttr, profileKey] of Object.entries(NAME_TO_PROFILE_KEY)) {
      const normalized = nameAttr.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (name === normalized || name.includes(normalized) || normalized.includes(name)) {
        return profileKey;
      }
    }
  }

  // 3. ID attribute — same pattern
  const id = input.id?.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (id) {
    for (const [nameAttr, profileKey] of Object.entries(NAME_TO_PROFILE_KEY)) {
      const normalized = nameAttr.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (id === normalized || id.includes(normalized) || normalized.includes(id)) {
        return profileKey;
      }
    }
  }

  // 4. Label / placeholder / aria-label text
  if (label) {
    const l = label.toLowerCase();
    if (/first|given|\bfname\b/.test(l) && !/last/.test(l)) return 'firstName';
    if (/last|surname|family|\blname\b/.test(l)) return 'lastName';
    if (/full[\s-]?name|your[\s-]?name/.test(l)) return 'fullName';
    if (/\bemail\b|e-?mail/.test(l)) return 'email';
    if (/\bphone\b|\btel\b|mobile|cell/.test(l)) return 'phone';
    if (/linkedin/.test(l)) return 'linkedin';
    if (/\bgithub\b/.test(l)) return 'github';
    if (/portfolio|personal[\s-]?site|personal[\s-]?url/.test(l)) return 'portfolio';
    if (/\bcity\b|location/.test(l)) return 'location';
    if (/\bwebsite\b/.test(l)) return 'portfolio';
  }

  return null;
}

async function fillAllFields(profile: Profile): Promise<{ filled: string[]; errors: string[] }> {
  const filled: string[] = [];
  const filledKeys = new Set<string>();

  // Single DOM query — eliminates the previous 3–4 separate querySelectorAll passes.
  const allInputs = Array.from(
    document.querySelectorAll<Element>(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), select, textarea'
    )
  );

  for (const el of allInputs) {
    if (!isVisible(el)) continue;

    const label = getFieldLabel(el);
    if (shouldSkipField(label)) continue;

    const profileKey = classifyElement(el, label);
    if (!profileKey || filledKeys.has(profileKey)) continue;

    const value = profile[profileKey as keyof Profile];
    if (!value) continue;

    const fieldType = (el as HTMLInputElement).type;
    let success = false;

    if (fieldType === 'select' || el.tagName === 'SELECT') {
      success = await fillSelect(el, value);
    } else if (fieldType === 'radio') {
      success = await fillRadio(el, value);
    } else if (fieldType === 'checkbox') {
      success = await fillCheckbox(el, value);
    } else if (fieldType !== 'file') {
      success = await fillTextInput(el, value);
    }

    if (success) {
      filledKeys.add(profileKey);
      filled.push(profileKey);
      debugLog(`Autoply: filled ${profileKey} = "${value}"`);
      await humanJitter(80, 250); // inter-field delay — breaks robotic fill timing fingerprint
    }
  }

  // Fill inside iframes (Ashby and other platforms that embed forms)
  const iframes = Array.from(document.querySelectorAll('iframe'));
  for (const iframe of iframes) {
    try {
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!iframeDoc) continue;

      const iframeInputs = Array.from(
        iframeDoc.querySelectorAll<Element>(
          'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]), select, textarea'
        )
      );

      for (const field of iframeInputs) {
        if (!isFormElement(field)) continue;
        if (!isVisible(field)) continue;

        const label = getFieldLabel(field);
        if (shouldSkipField(label)) continue;

        const profileKey = classifyElement(field, label);
        if (!profileKey || filledKeys.has(profileKey)) continue;

        const value = profile[profileKey as keyof Profile];
        if (!value) continue;

        const fieldType = (field as HTMLInputElement).type;
        let success = false;

        if (fieldType === 'select' || field.tagName === 'SELECT') {
          success = await fillSelect(field, value);
        } else if (fieldType !== 'file') {
          success = await fillTextInput(field, value);
        }

        if (success) {
          filledKeys.add(profileKey);
          filled.push(profileKey);
        }
      }
    } catch {
      // Cross-origin iframe — skip silently
    }
  }

  return { filled, errors: [] };
}

// Returns true if the key looks like a label string (e.g. "First Name") rather than
// a DOM attribute value (e.g. "firstname" / "first_name").
function looksLikeLabel(key: string): boolean {
  return /\s/.test(key) || key.length === 0;
}

async function fillByFillPlan(
  fillPlan: Record<string, string>,
  _alreadyFilled: Set<string>
): Promise<string[]> {
  const filled: string[] = [];

  for (const [fieldKey, value] of Object.entries(fillPlan)) {
    if (!value) continue;

    let didFill = false;

    if (looksLikeLabel(fieldKey)) {
      // Key is a human-readable label — use label-based matching
      didFill = await findAndFillByLabelMatch(
        { [fieldKey]: value } as unknown as Profile,
        fieldKey
      );
    } else {
      // Key is a DOM attribute value — try name/id selectors
      const selectors = [
        `[name="${fieldKey}"]`,
        `[id="${fieldKey}"]`,
        `[name="${fieldKey.toLowerCase()}"]`,
        `[data-field="${fieldKey}"]`,
      ];

      for (const selector of selectors) {
        const elements = Array.from(document.querySelectorAll(selector));
        for (const el of elements) {
          if (!isFormElement(el) || !isVisible(el)) continue;
          const label = getFieldLabel(el);
          if (shouldSkipField(label)) continue;

          // Skip if element already has the correct value (idempotent check)
          const currentVal = (el as HTMLInputElement).value;
          if (currentVal && currentVal === value) {
            didFill = true;
            break;
          }

          const fieldType = (el as HTMLInputElement).type;
          if (fieldType === 'select' || el.tagName === 'SELECT') {
            didFill = await fillSelect(el, value);
          } else if (fieldType === 'radio') {
            didFill = await fillRadio(el, value);
          } else if (fieldType === 'checkbox') {
            didFill = await fillCheckbox(el, value);
          } else if (fieldType !== 'file') {
            didFill = await fillTextInput(el, value);
          }

          if (didFill) break;
        }
        if (didFill) break;
      }
    }

    if (didFill) filled.push(fieldKey);
  }

  return filled;
}

async function handleAutofillWithProfile(
  profile: Profile,
  _documents?: { resume?: string; coverLetter?: string; resumeFilename?: string },
  fillPlan?: Record<string, string>
): Promise<{ success: boolean; filled: string[]; errors: string[] }> {
  debugLog('Autoply: Starting autofill with profile:', Object.keys(profile).join(', '));

  const result = await fillAllFields(profile);

  // AI fallback: use fillPlan for any fields not matched by semantic pass
  if (fillPlan && Object.keys(fillPlan).length > 0) {
    const alreadyFilled = new Set(result.filled);
    const planFilled = await fillByFillPlan(fillPlan, alreadyFilled);
    if (planFilled.length > 0) {
      debugLog(
        `Autoply: fillPlan filled ${planFilled.length} additional fields:`,
        planFilled.join(', ')
      );
      result.filled.push(...planFilled);
    }
  }

  // Upload resume PDF if provided
  if (_documents?.resume) {
    const filename = _documents.resumeFilename || 'resume.pdf';
    const uploaded = await uploadResumeFile(_documents.resume, filename);
    if (uploaded) result.filled.push('resume_upload');
  }

  debugLog(`Autoply: Filled ${result.filled.length} fields:`, result.filled.join(', '));

  if (result.errors.length > 0) {
    debugLog('Autoply: Errors:', result.errors.join(', '));
  }

  return {
    success: result.filled.length > 0,
    filled: result.filled,
    errors: result.errors,
  };
}

console.log('Autoply content script loaded');

// Listen for messages from sidepanel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Log which frame received the message
  const frameId = sender.frameId ?? 'main';
  debugLog(`Autoply: Message received in frame ${frameId}:`, message.type);

  if (message.type === 'PING') {
    sendResponse({ status: 'OK', frameId });
    return true;
  }

  if (message.type === 'AUTOFILL_WITH_PROFILE') {
    const { profile, documents, fillPlan } = message as {
      profile: Profile;
      documents?: { resume?: string; coverLetter?: string };
      fillPlan?: Record<string, string>;
    };

    handleAutofillWithProfile(profile, documents, fillPlan).then((result) => {
      debugLog(`Autoply: Frame ${frameId} fill result:`, result.filled.length, 'fields');
      sendResponse({ ...result, frameId });
    });

    return true; // async response
  }

  if (message.type === 'REFILL_FIELD') {
    const { fieldKey, value } = message as { fieldKey: string; value: string };
    fillByFillPlan({ [fieldKey]: value }, new Set()).then((filled) => {
      sendResponse({ success: filled.length > 0 });
    });
    return true;
  }

  if (message.type === 'GET_FORM_FIELDS') {
    const fields: Array<{ key: string; type: string; label: string; autocomplete?: string }> = [];

    const inputs = Array.from(
      document.querySelectorAll('input:not([type="hidden"]), select, textarea')
    );
    for (const input of inputs) {
      if (!isFormElement(input)) continue;
      if (!isVisible(input)) continue;

      const el = input as HTMLInputElement;
      fields.push({
        key: el.name || el.id || '',
        type: el.type || el.tagName.toLowerCase(),
        label: getFieldLabel(input),
        autocomplete: el.getAttribute('autocomplete') || undefined,
      });
    }

    sendResponse({ fields });
    return true;
  }

  return false;
});
