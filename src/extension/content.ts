// Content script for Autoply Copilot
// Works entirely client-side using Chrome's autocomplete attribute + semantic matching
// No AI needed for basic form filling - this is how simplify.jobs works

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
  zip?: string;
  country?: string;
  state?: string;
  headline?: string;
  linkedinUrl?: string;
}

const SEMANTIC_SELECTORS: Record<string, string[]> = {
  firstName: [
    '[autocomplete="given-name"]',
    '[name*="first" i]',
    '[id*="first" i]',
    '[data-first-name]',
    '[data-testid*="first"]',
  ],
  lastName: [
    '[autocomplete="family-name"]',
    '[name*="last" i]',
    '[id*="last" i]',
    '[name*="surname" i]',
    '[data-last-name]',
  ],
  fullName: ['[autocomplete="name"]', '[name="name"]', '[id="name"]', '[name*="full-name" i]'],
  email: ['[autocomplete="email"]', '[type="email"]', '[name*="email" i]', '[id*="email" i]'],
  phone: [
    '[autocomplete="tel"]',
    '[type="tel"]',
    '[name*="phone" i]',
    '[name*="mobile" i]',
    '[id*="phone" i]',
  ],
  linkedin: [
    '[autocomplete="url"]',
    '[name*="linkedin" i]',
    '[id*="linkedin" i]',
    '[placeholder*="linkedin" i]',
    '[aria-label*="linkedin" i]',
  ],
  github: [
    '[name*="github" i]',
    '[id*="github" i]',
    '[placeholder*="github" i]',
    '[aria-label*="github" i]',
  ],
  portfolio: [
    '[name*="portfolio" i]',
    '[name*="website" i]',
    '[name*="personal" i]',
    '[placeholder*="portfolio" i]',
  ],
  location: [
    '[autocomplete="address-level2"]',
    '[name*="city" i]',
    '[name*="location" i]',
    '[id*="city" i]',
  ],
};

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
  return (
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    style.opacity !== '0' &&
    (el as HTMLElement).getBoundingClientRect().width > 0 &&
    (el as HTMLElement).getBoundingClientRect().height > 0
  );
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
    await sleep(50);

    // Clear existing value using keyboard shortcut
    input.select?.();
    await sleep(50);

    // Set new value using native setter (works for React controlled components)
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

async function fillCustomDropdown(el: HTMLElement, value: string): Promise<boolean> {
  try {
    // Click the trigger
    el.click();
    await sleep(300);

    // Find options in various dropdown patterns
    const optionSelectors = [
      '[role="option"]',
      '[role="listbox"] [role="option"]',
      '[class*="option"]',
      '[class*="menu"] li',
      'ul[role="listbox"] li',
    ];

    for (const selector of optionSelectors) {
      const options = Array.from(Array.from(document.querySelectorAll(selector)));
      for (const option of options) {
        const text = option.textContent?.toLowerCase() || '';
        if (text.includes(value.toLowerCase()) || value.toLowerCase().includes(text)) {
          (option as HTMLElement).click();
          return true;
        }
      }
    }

    // Try typing to filter
    const combobox = document.querySelector(
      '[role="combobox"], input[class*="select"]'
    ) as HTMLInputElement;
    if (combobox) {
      combobox.value = value;
      combobox.dispatchEvent(new InputEvent('input', { bubbles: true }));
      await sleep(200);

      const firstOption = document.querySelector('[role="option"]') as HTMLElement;
      if (firstOption) {
        firstOption.click();
        return true;
      }
    }

    // Close dropdown
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


function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function findAndFillByAutocomplete(
  profile: Profile,
  autocompleteValue: string
): Promise<boolean> {
  const profileKey = AUTOCOMPLETE_TO_PROFILE_KEY[autocompleteValue.toLowerCase()];
  if (!profileKey) return false;

  const value = profile[profileKey as keyof Profile];
  if (!value) return false;

  const selector = `[autocomplete="${autocompleteValue}"]`;
  const elements = Array.from(document.querySelectorAll(selector));

  for (const el of elements) {
    if (!isFormElement(el)) continue;
    if (!isVisible(el)) continue;

    const label = getFieldLabel(el);
    if (shouldSkipField(label)) continue;

    const fieldType = (el as HTMLInputElement).type;

    if (fieldType === 'select' || el.tagName === 'SELECT') {
      if (await fillSelect(el, value)) return true;
    } else if (fieldType === 'file') {
      continue;
    } else {
      if (await fillTextInput(el, value)) return true;
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

function findLabelAssociatedInput(labelEl: Element): Element | null {
  const htmlEl = labelEl as HTMLElement;
  const forAttr = htmlEl.getAttribute('for');
  if (forAttr) {
    const input = document.getElementById(forAttr);
    if (input && isFormElement(input)) return input;
  }

  const input = labelEl.querySelector('input, textarea, select');
  if (input && isFormElement(input)) return input;

  const next = labelEl.nextElementSibling;
  if (next && isFormElement(next)) return next;

  return null;
}

async function uploadResumeFile(base64: string, filename: string): Promise<boolean> {
  const fileInputs = Array.from(
    document.querySelectorAll('input[type="file"]')
  ) as HTMLInputElement[];

  for (const input of fileInputs) {
    if (!isVisible(input)) continue;

    const context = (
      input.name + ' ' +
      input.id + ' ' +
      (input.getAttribute('aria-label') || '') + ' ' +
      (input.closest('label')?.textContent || '') + ' ' +
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

async function fillAllFields(profile: Profile): Promise<{ filled: string[]; errors: string[] }> {
  const filled: string[] = [];
  const errors: string[] = [];

  // Debug: Check for shadow DOMs
  const shadowHosts = Array.from(document.querySelectorAll('*')).filter((el) => el.shadowRoot);
  if (shadowHosts.length > 0) {
    console.log('Autoply: Shadow DOMs found:', shadowHosts.map((el) => el.tagName).join(', '));
  }

  // Debug: Check for iframes
  const allIframes = Array.from(document.querySelectorAll('iframe'));
  console.log('Autoply: iframes on page:', allIframes.length);

  // Step 1: Fill using autocomplete attribute (fastest, most reliable)
  for (const autocompleteValue of Object.keys(AUTOCOMPLETE_TO_PROFILE_KEY)) {
    const profileKey = AUTOCOMPLETE_TO_PROFILE_KEY[autocompleteValue];
    const value = profile[profileKey as keyof Profile];

    if (value) {
      const success = await findAndFillByAutocomplete(profile, autocompleteValue);
      if (success) {
        filled.push(profileKey);
      }
    }
  }

  // Step 2: Fill using semantic selectors
  for (const [profileKey, selectors] of Object.entries(SEMANTIC_SELECTORS)) {
    if (filled.includes(profileKey)) continue;

    const value = profile[profileKey as keyof Profile];
    if (!value) continue;

    const success = await findAndFillField(profile, profileKey, selectors);
    if (success) {
      filled.push(profileKey);
    }
  }

  // Step 2.5: Fill by name attribute (handles Workable: firstname, lastname, etc.)
  // Debug: log all inputs on page
  console.log(
    'Autoply: All inputs on page:',
    Array.from(document.querySelectorAll('input, select, textarea')).map((el) => ({
      name: (el as HTMLElement).getAttribute('name'),
      type: (el as HTMLInputElement).type,
      id: (el as HTMLElement).id,
      tag: el.tagName,
    }))
  );

  // Try each name attribute with fast retry
  for (const [nameAttr, profileKey] of Object.entries(NAME_TO_PROFILE_KEY)) {
    const value = profile[profileKey as keyof Profile];
    if (!value) continue;
    if (filled.includes(profileKey)) continue;

    const selector = `[name="${nameAttr}"]`;

    // Quick check - no retry for speed
    const elements = Array.from(document.querySelectorAll(selector));

    if (elements.length === 0) {
      console.log(`Autoply: No element found for [name="${nameAttr}"]`);
      continue;
    }

    for (const el of elements) {
      if (!isFormElement(el)) continue;

      const label = getFieldLabel(el);
      if (shouldSkipField(label)) continue;

      const fieldType = (el as HTMLInputElement).type;
      console.log(
        `Autoply: Found [name="${nameAttr}"], type=${fieldType}, trying to fill with "${value}"`
      );

      if (fieldType === 'select' || el.tagName === 'SELECT') {
        if (await fillSelect(el, value)) {
          console.log(`Autoply: SUCCESS filled [name="${nameAttr}"]`);
          filled.push(profileKey);
          break;
        }
      } else if (fieldType !== 'file') {
        if (await fillTextInput(el, value)) {
          // Verify value was set
          const input = el as HTMLInputElement;
          if (input.value === value || input.value.includes(value)) {
            console.log(`Autoply: SUCCESS filled [name="${nameAttr}"] = "${input.value}"`);
            filled.push(profileKey);
            break;
          } else {
            console.log(
              `Autoply: Fill appeared to work but value is "${input.value}" not "${value}"`
            );
          }
        }
      }
    }
  }

  // Step 3: Fill by scanning all labels
  const labels = Array.from(document.querySelectorAll('label'));
  for (const label of labels) {
    const text = label.textContent?.trim() || '';
    if (!text) continue;
    if (shouldSkipField(text)) continue;

    const input = findLabelAssociatedInput(label);
    if (!input || !isFormElement(input)) continue;
    if (!isVisible(input)) continue;

    const filledAny = await findAndFillByLabelMatch(profile, text);
    if (filledAny) {
      // Add to filled if not already
      const profileKey = label.textContent.toLowerCase();
      if (/first/i.test(profileKey) && !filled.includes('firstName')) filled.push('firstName');
      else if (/last|surname/i.test(profileKey) && !filled.includes('lastName'))
        filled.push('lastName');
      else if (/email/i.test(profileKey) && !filled.includes('email')) filled.push('email');
      else if (/phone/i.test(profileKey) && !filled.includes('phone')) filled.push('phone');
      else if (/linkedin/i.test(profileKey) && !filled.includes('linkedin'))
        filled.push('linkedin');
      else if (/github/i.test(profileKey) && !filled.includes('github')) filled.push('github');
    }
  }

  // Step 4: Handle file uploads (resume upload requires server-side delivery — not yet implemented)

  // Step 5: Fill inside iframes (Ashby and other platforms)
  const iframes = Array.from(document.querySelectorAll('iframe'));
  console.log('Autoply: Trying to fill iframes, count:', iframes.length);

  for (const iframe of iframes) {
    try {
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!iframeDoc) {
        console.log('Autoply: Cannot access iframe doc:', iframe.src);
        continue;
      }

      console.log('Autoply: Accessing iframe, searching for inputs...');
      const iframeInputs = Array.from(
        iframeDoc.querySelectorAll('input[name]')
      ) as HTMLInputElement[];
      console.log(
        'Autoply: Iframe inputs found:',
        iframeInputs.map((i) => i.name)
      );

      const iframeFields = Array.from(
        iframeDoc.querySelectorAll('input:not([type="hidden"]), select, textarea')
      );
      for (const field of iframeFields) {
        if (!isFormElement(field)) continue;
        if (!isVisible(field)) continue;

        const name = (field as HTMLInputElement).name;
        const profileKey = name ? NAME_TO_PROFILE_KEY[name.toLowerCase()] : null;

        if (profileKey) {
          const value = profile[profileKey as keyof Profile];
          if (value) {
            console.log(
              `Autoply: IFRAME - found [name="${name}"] for ${profileKey}, value="${value}"`
            );
            const fieldType = (field as HTMLInputElement).type;

            if (fieldType === 'select' || field.tagName === 'SELECT') {
              if (await fillSelect(field, value)) {
                console.log(`Autoply: IFRAME - SUCCESS filled [name="${name}"]`);
                if (!filled.includes(profileKey)) filled.push(profileKey);
              }
            } else if (fieldType !== 'file') {
              if (await fillTextInput(field, value)) {
                console.log(`Autoply: IFRAME - SUCCESS filled [name="${name}"]`);
                if (!filled.includes(profileKey)) filled.push(profileKey);
              }
            }
          }
        }
      }
    } catch (e) {
      console.log('Autoply: Cannot access iframe (cross-origin or error):', e);
    }
  }

  return { filled, errors };
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
      didFill = await findAndFillByLabelMatch({ [fieldKey]: value } as unknown as Profile, fieldKey);
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
  _documents?: { resume?: string; coverLetter?: string },
  fillPlan?: Record<string, string>
): Promise<{ success: boolean; filled: string[]; errors: string[] }> {
  console.log('Autoply: Starting autofill with profile:', Object.keys(profile).join(', '));

  const result = await fillAllFields(profile);

  // AI fallback: use fillPlan for any fields not matched by semantic pass
  if (fillPlan && Object.keys(fillPlan).length > 0) {
    const alreadyFilled = new Set(result.filled);
    const planFilled = await fillByFillPlan(fillPlan, alreadyFilled);
    if (planFilled.length > 0) {
      console.log(`Autoply: fillPlan filled ${planFilled.length} additional fields:`, planFilled.join(', '));
      result.filled.push(...planFilled);
    }
  }

  // Upload resume PDF if provided
  if (_documents?.resume) {
    const filename = (_documents as any).resumeFilename || 'resume.pdf';
    const uploaded = await uploadResumeFile(_documents.resume, filename);
    if (uploaded) result.filled.push('resume_upload');
  }

  console.log(`Autoply: Filled ${result.filled.length} fields:`, result.filled.join(', '));

  if (result.errors.length > 0) {
    console.log('Autoply: Errors:', result.errors.join(', '));
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
  console.log(`Autoply: Message received in frame ${frameId}:`, message.type);

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
      console.log(`Autoply: Frame ${frameId} fill result:`, result.filled.length, 'fields');
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
