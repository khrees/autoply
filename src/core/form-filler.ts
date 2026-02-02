import type { Page, Frame } from 'playwright';
import type { Profile, FormField, CustomQuestion, JobData } from '../types';
import { join } from 'path';
import { getAutoplyDir } from '../db';
import { configRepository } from '../db/repositories/config';
import { answerApplicationQuestion } from '../ai/cover-letter';
import { createAIProvider } from '../ai/provider';

// Field matching patterns for common form fields
const FIELD_PATTERNS = {
  // Personal information
  firstName: /first[\s_-]?name|given[\s_-]?name|\bfname\b/i,
  lastName: /last[\s_-]?name|surname|family[\s_-]?name|\blname\b/i,
  fullName: /full[\s_-]?name|\bname\b|your[\s_-]?name|candidate[\s_-]?name/i,
  email: /e?[\s_-]?mail|email[\s_-]?address/i,
  phone: /phone|tel|mobile|cell|contact[\s_-]?number/i,
  location: /location|city|address|where.*based|current[\s_-]?location|office|work[\s_-]?out[\s_-]?of/i,

  // URLs
  linkedin: /linkedin|li[\s_-]?url|li[\s_-]?profile/i,
  github: /github|gh[\s_-]?url|gh[\s_-]?profile/i,
  portfolio: /portfolio|website|personal[\s_-]?site|url|homepage/i,

  // Documents
  resume: /resume|cv|curriculum[\s_-]?vitae/i,
  coverLetter: /cover[\s_-]?letter|covering[\s_-]?letter|motivation[\s_-]?letter/i,

  // Work authorization
  workAuthorization: /work[\s_-]?auth|authorized[\s_-]?to[\s_-]?work|legally[\s_-]?authorized|eligib|visa[\s_-]?status|right[\s_-]?to[\s_-]?work/i,
  sponsorship: /sponsor|visa[\s_-]?sponsor|immigration[\s_-]?sponsor|require.*sponsor/i,

  // Experience
  yearsExperience: /years?[\s_-]?(?:of[\s_-]?)?experience|experience[\s_-]?years|how[\s_-]?many[\s_-]?years/i,
  currentCompany: /current[\s_-]?company|employer|where.*work/i,
  currentTitle: /current[\s_-]?title|current[\s_-]?role|job[\s_-]?title/i,

  // Salary
  salary: /salary|compensation|pay|expected[\s_-]?salary|desired[\s_-]?salary/i,
  salaryExpectation: /salary[\s_-]?expectation|expected[\s_-]?compensation/i,

  // Start date
  startDate: /start[\s_-]?date|when.*start|available.*start|availability|earliest[\s_-]?start/i,
  noticePeriod: /notice[\s_-]?period|notice|how[\s_-]?soon/i,

  // Demographics (optional, usually self-identify)
  gender: /gender|sex/i,
  ethnicity: /ethnicity|race|ethnic[\s_-]?background/i,
  veteran: /veteran|military[\s_-]?service/i,
  disability: /disability|disabled/i,

  // Country / Nationality
  country: /\bcountry\b|country[\s_-]?of[\s_-]?residence|passport[\s_-]?country|nationality|citizenship/i,

  // Age verification
  ageVerification: /over[\s_-]?(?:the[\s_-]?)?(?:age[\s_-]?(?:of[\s_-]?)?)?18|legal[\s_-]?age|are[\s_-]?you[\s_-]?(?:at[\s_-]?least[\s_-]?)?18/i,

  // Other
  referral: /referral|how.*hear|source|where.*find|referred[\s_-]?by/i,
  relocation: /relocation|willing[\s_-]?to[\s_-]?relocate|open[\s_-]?to[\s_-]?relocate/i,
} as const;

// Questions/fields that require human input — AI can't reliably answer these
const HUMAN_ONLY_PATTERNS = [
  /passport/i,
  /country[\s_-]?of[\s_-]?residence/i,
  /citizenship/i,
  /nationality/i,
  /\bssn\b|social[\s_-]?security/i,
  /\botp\b|verification[\s_-]?code|one[\s_-]?time[\s_-]?password/i,
  /date[\s_-]?of[\s_-]?birth|\bdob\b|birth[\s_-]?date/i,
  /\baddress\b.*(?:street|line|number|apt)/i,
  /zip[\s_-]?code|postal[\s_-]?code/i,
  /salary[\s_-]?expectation|expected[\s_-]?(?:salary|compensation)|desired[\s_-]?(?:salary|compensation)/i,
];

const NEUTRAL_OPTION_PATTERNS = [
  /prefer not to say/i,
  /decline to answer/i,
  /do not wish to answer/i,
  /rather not say/i,
  /choose not to answer/i,
  /not disclosed/i,
  /no answer/i,
];

const SENSITIVE_QUESTION_PATTERNS = [
  /gender|sex/i,
  /ethnicity|race|ethnic/i,
  /veteran|military/i,
  /disability|disabled/i,
  /sexual orientation|lgbtq/i,
  /pronoun/i,
];

export interface FormFillerOptions {
  resumePath?: string;
  coverLetterPath?: string;
  answeredQuestions?: CustomQuestion[];
  /** When true, prompt user for unfillable fields. Reads from config if not set. */
  interactivePrompts?: boolean;
  /** When true, skip all interactive prompts (e.g. --auto mode) */
  autoMode?: boolean;
}

export interface FillResult {
  success: boolean;
  filledFields: string[];
  skippedFields: string[];
  errors: string[];
}

export class FormFiller {
  private page: Page;
  private root: Page | Frame;
  private profile: Profile;
  private jobData: JobData;
  private options: FormFillerOptions;

  constructor(
    page: Page,
    profile: Profile,
    jobData: JobData,
    options: FormFillerOptions = {},
    root?: Page | Frame
  ) {
    this.page = page;
    this.root = root ?? page;
    this.profile = profile;
    this.jobData = jobData;
    this.options = options;
  }

  async fillForm(formFields: FormField[]): Promise<FillResult> {
    const result: FillResult = {
      success: true,
      filledFields: [],
      skippedFields: [],
      errors: [],
    };

    for (const field of formFields) {
      try {
        const fieldLabel = field.label || field.name;
        const filled = await this.fillField(field, field.required);
        if (filled) {
          if (fieldLabel) result.filledFields.push(fieldLabel);
        } else if (field.required) {
          let aiAnswerUsed = false;

          // Check cache first
          const cached = fieldLabel ? this.getCachedAnswer(fieldLabel) : null;
          if (cached) {
            field.value = cached;
            const retryFilled = await this.fillField(field, field.required);
            if (retryFilled) {
              result.filledFields.push(fieldLabel);
              continue;
            }
          }

          // For text/textarea fields that AI can handle, try AI first
          if ((field.type === 'text' || field.type === 'textarea') && fieldLabel && !this.needsHumanInput(fieldLabel)) {
            const aiAnswer = await this.tryAIAnswerForField(fieldLabel);
            if (aiAnswer) {
              aiAnswerUsed = true;
              field.value = aiAnswer;
              const retryFilled = await this.fillField(field, field.required);
              if (retryFilled) {
                result.filledFields.push(fieldLabel);
                continue;
              }
            }
          }

          // For select/radio/checkbox fields with options, try AI to choose an option
          if (
            (field.type === 'select' || field.type === 'radio' || field.type === 'checkbox') &&
            fieldLabel &&
            !this.needsHumanInput(fieldLabel)
          ) {
            const aiAnswer = await this.tryAIAnswerForField(fieldLabel, field.type, field.options);
            if (aiAnswer) {
              aiAnswerUsed = true;
              field.value = aiAnswer;
              const retryFilled = await this.fillField(field, field.required);
              if (retryFilled) {
                result.filledFields.push(fieldLabel);
                continue;
              }
            }
          }

          // Fall back to interactive prompt for human-only fields
          if (this.isInteractive() && !aiAnswerUsed) {
            const userValue = await this.promptForField(field);
            if (userValue) {
              field.value = userValue;
              const retryFilled = await this.fillField(field, field.required);
              if (retryFilled) {
                result.filledFields.push(fieldLabel);
              } else {
                result.skippedFields.push(fieldLabel);
              }
            } else {
              result.skippedFields.push(fieldLabel);
            }
          } else {
            result.skippedFields.push(fieldLabel);
          }
        } else {
          let optionalFilled = false;
          if (fieldLabel) {
            const neutral = this.getNeutralAnswerForField(field);
            if (neutral) {
              field.value = neutral;
              const retryFilled = await this.fillField(field, false);
              if (retryFilled) {
                result.filledFields.push(fieldLabel);
                optionalFilled = true;
              }
            }
          }
          if (!optionalFilled && fieldLabel) {
            result.skippedFields.push(fieldLabel);
          }
        }
      } catch (error) {
        result.errors.push(`Failed to fill ${field.label || field.name}: ${error}`);
        result.success = false;
      }
    }

    return result;
  }

  async fillCustomQuestions(questions: CustomQuestion[]): Promise<FillResult> {
    const result: FillResult = {
      success: true,
      filledFields: [],
      skippedFields: [],
      errors: [],
    };

    for (const question of questions) {
      try {
        if (!question.answer) {
          const cached = this.getCachedAnswer(question.question);
          if (cached) {
            question.answer = cached;
          } else if (question.required && !this.needsHumanInput(question.question)) {
            // AI-answerable required question — get AI answer
            const aiAnswer = await this.tryAIAnswer(question);
            if (aiAnswer) {
              question.answer = aiAnswer;
            }
          } else if (!question.required) {
            const neutral = this.getNeutralAnswerForQuestion(question);
            if (neutral) {
              question.answer = neutral;
            }
          }
        }

        const filled = await this.fillQuestion(question);
        if (filled) {
          result.filledFields.push(question.question.slice(0, 50));
        } else if (question.required && this.isInteractive() && !question.answer) {
          // Only prompt user for questions AI couldn't answer (human-only questions)
          const userAnswer = await this.promptForQuestion(question);
          if (userAnswer) {
            question.answer = userAnswer;
            const retryFilled = await this.fillQuestion(question);
            if (retryFilled) {
              result.filledFields.push(question.question.slice(0, 50));
            } else {
              result.skippedFields.push(question.question.slice(0, 50));
            }
          } else {
            result.skippedFields.push(question.question.slice(0, 50));
          }
        } else {
          result.skippedFields.push(question.question.slice(0, 50));
        }
      } catch (error) {
        result.errors.push(`Failed to answer "${question.question.slice(0, 30)}...": ${error}`);
        if (question.required) {
          result.success = false;
        }
      }
    }

    return result;
  }

  private async fillField(field: FormField, allowAssumptions = true): Promise<boolean> {
    const value = this.getValueForField(field, allowAssumptions);
    if (!value && field.type !== 'file') {
      return false;
    }

    const selector = this.buildSelector(field);

    switch (field.type) {
      case 'text':
      case 'email':
      case 'tel':
        return this.fillTextInput(selector, value!, field);

      case 'textarea':
        return this.fillTextarea(selector, value!);

      case 'select':
        return this.fillSelect(selector, value!, field);

      case 'radio':
        return this.fillRadio(field, value!);

      case 'checkbox':
        return this.fillCheckbox(field, value!);

      case 'file':
        return this.fillFileInput(selector, field);

      default:
        return false;
    }
  }

  private getValueForField(field: FormField, allowAssumptions = true): string | null {
    const label = (field.label || '').toLowerCase();
    const name = (field.name || '').toLowerCase();
    const combined = `${label} ${name}`;
    const isChoiceField = field.type === 'radio' || field.type === 'select' || field.type === 'checkbox';

    // First Name
    if (FIELD_PATTERNS.firstName.test(combined)) {
      return this.profile.name.split(' ')[0] || null;
    }

    // Last Name
    if (FIELD_PATTERNS.lastName.test(combined)) {
      const parts = this.profile.name.split(' ');
      return parts.length > 1 ? parts.slice(1).join(' ') : null;
    }

    // Full Name
    if (FIELD_PATTERNS.fullName.test(combined)) {
      return this.profile.name;
    }

    // Email
    if (FIELD_PATTERNS.email.test(combined)) {
      return this.profile.email;
    }

    // Phone
    if (FIELD_PATTERNS.phone.test(combined)) {
      return this.profile.phone || null;
    }

    // Location
    if (FIELD_PATTERNS.location.test(combined)) {
      return this.profile.location || null;
    }

    // LinkedIn
    if (FIELD_PATTERNS.linkedin.test(combined)) {
      return this.profile.linkedin_url || null;
    }

    // GitHub
    if (FIELD_PATTERNS.github.test(combined)) {
      return this.profile.github_url || null;
    }

    // Portfolio
    if (FIELD_PATTERNS.portfolio.test(combined)) {
      return this.profile.portfolio_url || null;
    }

    if (allowAssumptions) {
      // Work Authorization - typically "Yes" for most applicants
      if (FIELD_PATTERNS.workAuthorization.test(combined)) {
        return 'Yes';
      }

      // Sponsorship - default to No (can be customized)
      if (FIELD_PATTERNS.sponsorship.test(combined)) {
        return 'No';
      }
    }

    // Years of experience
    if (FIELD_PATTERNS.yearsExperience.test(combined)) {
      return this.calculateYearsExperience();
    }

    // Yes/No questions derived from experience thresholds
    if (isChoiceField) {
      const yearsThresholdMatch = combined.match(/(\d+)\s*(?:\+|plus|or\s+more|or\s+greater|or\s+above)/i);
      if (yearsThresholdMatch) {
        const threshold = Number.parseInt(yearsThresholdMatch[1], 10);
        const years = Number.parseInt(this.calculateYearsExperience(), 10);
        if (!Number.isNaN(threshold) && !Number.isNaN(years)) {
          return years >= threshold ? 'Yes' : 'No';
        }
      }
    }

    // Frontend + backend experience (yes/no)
    if (isChoiceField && /front[\s-]?end.*back[\s-]?end|back[\s-]?end.*front[\s-]?end|full[\s-]?stack/i.test(combined)) {
      const profileText = this.getProfileText();
      const hasFrontend = /(frontend|front-end|react|vue|angular|svelte|html|css)\b/i.test(profileText);
      const hasBackend = /(backend|back-end|api|server|node|golang|go|python|java|c#|ruby|postgres|mysql|redis)\b/i.test(profileText);
      return hasFrontend && hasBackend ? 'Yes' : 'No';
    }

    // 0-1 project leadership (yes/no)
    if (isChoiceField && /(0[\s-]?1|zero[\s-]?to[\s-]?one|from\s*0\s*to\s*1)/i.test(combined)) {
      const profileText = this.getProfileText();
      const hasLeadership = /(led|lead|owned|owner|launched|built|end-to-end|end to end|from scratch|0-1)/i.test(profileText);
      return hasLeadership ? 'Yes' : 'No';
    }

    // Current company
    if (FIELD_PATTERNS.currentCompany.test(combined)) {
      const latestExp = this.profile.experience[0];
      return latestExp?.company || null;
    }

    // Current title
    if (FIELD_PATTERNS.currentTitle.test(combined)) {
      const latestExp = this.profile.experience[0];
      return latestExp?.title || null;
    }

    if (allowAssumptions) {
      // Start date / availability
      if (FIELD_PATTERNS.startDate.test(combined) || FIELD_PATTERNS.noticePeriod.test(combined)) {
        return '2 weeks';
      }

      // Referral / How did you hear
      if (FIELD_PATTERNS.referral.test(combined)) {
        return 'Online Job Board';
      }

      // Relocation
      if (FIELD_PATTERNS.relocation.test(combined)) {
        return this.profile.preferences?.remote_only ? 'No' : 'Yes';
      }
    }

    // Country / Nationality — use location from profile as hint, but will likely need interactive prompt
    if (FIELD_PATTERNS.country.test(combined)) {
      return this.profile.location || null;
    }

    if (allowAssumptions) {
      // Age verification — default Yes
      if (FIELD_PATTERNS.ageVerification.test(combined)) {
        return 'Yes';
      }
    }

    // If we have a pre-filled value from scraping
    if (field.value) {
      return field.value;
    }

    // Check cached answers from previous user input
    const fieldLabel = field.label || field.name;
    if (fieldLabel) {
      const cached = this.getCachedAnswer(fieldLabel);
      if (cached) return cached;
    }

    return null;
  }

  private calculateYearsExperience(): string {
    if (this.profile.experience.length === 0) {
      return '0';
    }

    let totalMonths = 0;
    for (const exp of this.profile.experience) {
      const start = new Date(exp.start_date);
      const end = exp.end_date ? new Date(exp.end_date) : new Date();
      const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
      totalMonths += Math.max(0, months);
    }

    const years = Math.round(totalMonths / 12);
    return years.toString();
  }

  private getProfileText(): string {
    const experienceText = this.profile.experience
      .map((exp) => [exp.title, exp.description, ...(exp.highlights || [])].join(' '))
      .join(' ');
    return `${this.profile.skills.join(' ')} ${experienceText}`.toLowerCase();
  }

  private buildSelector(field: FormField): string {
    const selectors: string[] = [];

    if (field.name) {
      selectors.push(`[name="${field.name}"]`);
      selectors.push(`#${field.name}`);
    }

    // Build selector from label
    const labelText = field.label?.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (labelText) {
      selectors.push(`[name*="${labelText}"]`);
      selectors.push(`[id*="${labelText}"]`);
      selectors.push(`[aria-label*="${field.label}"]`);
      selectors.push(`[placeholder*="${field.label}"]`);
    }

    return selectors.join(', ');
  }

  private async fillTextInput(selector: string, value: string, field: FormField): Promise<boolean> {
    try {
      // Try multiple strategies to find the input
      let element = await this.root.$(selector);

      // If not found by selector, try finding by label text
      if (!element && field.label) {
        element = await this.findInputByLabel(field.label);
      }

      if (!element) {
        return false;
      }

      // Clear existing value and type new one
      await element.click();
      await this.page.keyboard.press('Control+a');
      await element.fill(value);
      await this.humanDelay();

      return true;
    } catch {
      return false;
    }
  }

  private async fillTextarea(selector: string, value: string): Promise<boolean> {
    try {
      const element = await this.root.$(selector);
      if (!element) return false;

      await element.click();
      await element.fill(value);
      await this.humanDelay();

      return true;
    } catch {
      return false;
    }
  }

  private async fillSelect(selector: string, value: string, field: FormField): Promise<boolean> {
    try {
      const element = await this.root.$(selector);
      if (!element) return false;

      // Try to find the best matching option
      const options = field.options || [];
      const matchedOption = this.findBestMatchingOption(value, options);

      if (matchedOption) {
        await element.selectOption({ label: matchedOption });
      } else {
        // Try selecting by value directly
        await element.selectOption(value);
      }

      await this.humanDelay();
      return true;
    } catch {
      return false;
    }
  }

  private async fillRadio(field: FormField, value: string): Promise<boolean> {
    try {
      const options = field.options || [];
      const matchedOption = this.findBestMatchingOption(value, options);
      const targetValue = matchedOption || value;

      // Collect all candidate radio buttons from multiple strategies
      let radios: Awaited<ReturnType<Page['$$']>> = [];

      // Strategy 1: by name attribute
      if (field.name) {
        radios = await this.root.$$(`input[type="radio"][name="${field.name}"]`);
      }

      // Strategy 2: find radios near the label text (for forms without name attributes)
      if (radios.length === 0 && field.label) {
        const container = await this.findQuestionContainer(field.label);
        if (container) {
          radios = await container.$$('input[type="radio"]');
        }
      }

      // Strategy 3: broad search by label text
      if (radios.length === 0 && field.label) {
        radios = await this.root.$$('input[type="radio"]');
      }

      for (const radio of radios) {
        const radioValue = await radio.getAttribute('value');
        const radioLabel = await this.root.evaluate((el) => {
          const label = el.closest('label') || document.querySelector(`label[for="${el.id}"]`);
          return label?.textContent?.trim() || '';
        }, radio);

        if (
          radioValue?.toLowerCase() === targetValue.toLowerCase() ||
          radioLabel.toLowerCase().includes(targetValue.toLowerCase()) ||
          targetValue.toLowerCase().includes(radioLabel.toLowerCase())
        ) {
          await radio.check();
          await this.humanDelay();
          return true;
        }
      }

      return false;
    } catch {
      return false;
    }
  }

  private async fillCheckbox(field: FormField, value: string): Promise<boolean> {
    try {
      const shouldCheck = ['yes', 'true', '1', 'checked'].includes(value.toLowerCase());

      // Strategy 1: by name attribute
      let checkbox = field.name ? await this.root.$(`input[type="checkbox"][name="${field.name}"]`) : null;

      // Strategy 2: find checkbox near the label text
      if (!checkbox && field.label) {
        const container = await this.findQuestionContainer(field.label);
        if (container) {
          checkbox = await container.$('input[type="checkbox"]');
        }
      }

      // Strategy 3: find by label association
      if (!checkbox && field.label) {
        checkbox = await this.findInputByLabel(field.label);
      }

      if (!checkbox) return false;

      if (shouldCheck) {
        await checkbox.check();
      } else {
        await checkbox.uncheck();
      }

      await this.humanDelay();
      return true;
    } catch {
      return false;
    }
  }

  private async fillFileInput(selector: string, field: FormField): Promise<boolean> {
    const label = (field.label || '').toLowerCase();
    const name = (field.name || '').toLowerCase();
    const combined = `${label} ${name}`;

    let filePath: string | null = null;

    // Determine which file to upload
    if (FIELD_PATTERNS.resume.test(combined)) {
      filePath = this.options.resumePath || null;
    } else if (FIELD_PATTERNS.coverLetter.test(combined)) {
      filePath = this.options.coverLetterPath || null;
    }

    if (!filePath) {
      return false;
    }

    try {
      // Find file input
      let fileInput = await this.root.$(selector);

      // Try alternative selectors for file inputs
      if (!fileInput) {
        fileInput = await this.root.$('input[type="file"]');
      }

      if (!fileInput) {
        // Some sites hide the file input - look for upload buttons
        const uploadButton = await this.root.$('[class*="upload"], [class*="attach"], button:has-text("Upload")');
        if (uploadButton) {
          // Click and wait for file chooser
          const [fileChooser] = await Promise.all([
            this.page.waitForEvent('filechooser'),
            uploadButton.click(),
          ]);
          await fileChooser.setFiles(filePath);
          await this.humanDelay();
          return true;
        }
        return false;
      }

      await fileInput.setInputFiles(filePath);
      await this.humanDelay();
      return true;
    } catch {
      return false;
    }
  }

  private async fillQuestion(question: CustomQuestion): Promise<boolean> {
    const answer = question.answer;
    if (!answer && question.type !== 'checkbox') {
      return false;
    }

    try {
      // Find the question container by matching the question text
      const container = await this.findQuestionContainer(question.question);
      if (!container) {
        return false;
      }

      switch (question.type) {
        case 'text': {
          const input = await container.$('input[type="text"], input:not([type])');
          if (input) {
            await input.fill(answer!);
            await this.humanDelay();
            return true;
          }
          break;
        }

        case 'textarea': {
          const textarea = await container.$('textarea');
          if (textarea) {
            await textarea.fill(answer!);
            await this.humanDelay();
            return true;
          }
          break;
        }

        case 'select': {
          const select = await container.$('select');
          if (select && question.options) {
            const matchedOption = this.findBestMatchingOption(answer!, question.options);
            if (matchedOption) {
              await select.selectOption({ label: matchedOption });
              await this.humanDelay();
              return true;
            }
          }
          break;
        }

        case 'radio': {
          if (question.options) {
            const matchedOption = this.findBestMatchingOption(answer!, question.options);
            const radios = await container.$$('input[type="radio"]');
            for (const radio of radios) {
              const radioValue = await radio.getAttribute('value');
            const radioLabel = await this.root.evaluate((el) => {
              const label = el.closest('label') || document.querySelector(`label[for="${el.id}"]`);
              return label?.textContent?.trim() || '';
            }, radio);

              if (
                radioValue === matchedOption ||
                radioLabel.toLowerCase().includes((matchedOption || '').toLowerCase())
              ) {
                await radio.check();
                await this.humanDelay();
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
            const checkboxLabel = await this.root.evaluate((el) => {
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
          await this.humanDelay();
          return true;
        }
      }

      return false;
    } catch {
      return false;
    }
  }

  private async findQuestionContainer(questionText: string): Promise<ReturnType<Page['$']>> {
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
    const containers = await this.root.$$(selector);
      for (const container of containers) {
        const text = await container.textContent();
        if (text?.toLowerCase().includes(normalizedQuestion)) {
          return container;
        }
      }
    }

    // Fallback: find by label
    const labels = await this.root.$$('label');
    for (const label of labels) {
      const text = await label.textContent();
      if (text?.toLowerCase().includes(normalizedQuestion)) {
        // Find the parent container
        const parentSelector = await this.root.evaluate((el) => {
          const parent = el.closest('.form-group, fieldset, [class*="question"]') || el.parentElement;
          if (parent && parent.id) return `#${parent.id}`;
          if (parent && parent.className) return `.${parent.className.split(' ').join('.')}`;
          return null;
        }, label);

        if (parentSelector) {
          return this.root.$(parentSelector);
        }
      }
    }

    return null;
  }

  private async findInputByLabel(labelText: string): Promise<ReturnType<Page['$']>> {
    const normalizedLabel = labelText.toLowerCase();

    // Find label by text content
    const labels = await this.root.$$('label');
    for (const label of labels) {
      const text = await label.textContent();
      if (text?.toLowerCase().includes(normalizedLabel)) {
        // Get the for attribute
        const forAttr = await label.getAttribute('for');
        if (forAttr) {
          const safeForAttr = forAttr.replace(/"/g, '\\"');
          return this.root.$(`[id="${safeForAttr}"]`);
        }

        // Find input inside label
        const input = await label.$('input, textarea, select');
        if (input) return input;

        // Find input as next sibling
        const nextSelector = await this.root.evaluate((el) => {
          const next = el.nextElementSibling;
          if (next?.matches('input, textarea, select')) {
            if (next.id) return `#${next.id}`;
            if (next.getAttribute('name')) return `[name="${next.getAttribute('name')}"]`;
          }
          return null;
        }, label);

        if (nextSelector) {
          const nextElement = await this.root.$(nextSelector);
          if (nextElement) return nextElement;
        }
      }
    }

    return null;
  }

  public findBestMatchingOption(value: string, options: string[]): string | null {
    const normalizedValue = value.toLowerCase().trim();

    // Exact match
    const exactMatch = options.find((opt) => opt.toLowerCase().trim() === normalizedValue);
    if (exactMatch) return exactMatch;

    // Contains match
    const containsMatch = options.find(
      (opt) =>
        opt.toLowerCase().includes(normalizedValue) ||
        normalizedValue.includes(opt.toLowerCase())
    );
    if (containsMatch) return containsMatch;

    // Fuzzy match for yes/no variants
    if (['yes', 'true', 'y'].includes(normalizedValue)) {
      const yesOption = options.find((opt) =>
        /^(yes|true|y|affirmative|correct)$/i.test(opt.trim())
      );
      if (yesOption) return yesOption;
    }

    if (['no', 'false', 'n'].includes(normalizedValue)) {
      const noOption = options.find((opt) =>
        /^(no|false|n|negative)$/i.test(opt.trim())
      );
      if (noOption) return noOption;
    }

    return null;
  }

  private async humanDelay(): Promise<void> {
    const delay = Math.floor(Math.random() * 300) + 100;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  private getNeutralOption(options?: string[]): string | null {
    if (!options || options.length === 0) return null;
    for (const pattern of NEUTRAL_OPTION_PATTERNS) {
      const match = options.find((opt) => pattern.test(opt));
      if (match) return match;
    }
    return null;
  }

  private isSensitiveQuestion(label: string): boolean {
    return SENSITIVE_QUESTION_PATTERNS.some((pattern) => pattern.test(label));
  }

  private getNeutralAnswerForField(field: FormField): string | null {
    const label = field.label || field.name || '';
    const neutralOption = this.getNeutralOption(field.options);
    if (neutralOption) return neutralOption;

    if ((field.type === 'text' || field.type === 'textarea') && this.isSensitiveQuestion(label)) {
      return 'Prefer not to say';
    }

    return null;
  }

  private getNeutralAnswerForQuestion(question: CustomQuestion): string | null {
    const neutralOption = this.getNeutralOption(question.options);
    if (neutralOption) return neutralOption;

    if ((question.type === 'text' || question.type === 'textarea') && this.isSensitiveQuestion(question.question)) {
      return 'Prefer not to say';
    }

    return null;
  }

  /** Check if a question/field requires human input (AI can't reliably answer) */
  private needsHumanInput(questionText: string): boolean {
    return HUMAN_ONLY_PATTERNS.some((pattern) => pattern.test(questionText));
  }

  /** Try to get an AI-generated answer for a custom question */
  private async tryAIAnswer(question: CustomQuestion): Promise<string | null> {
    try {
      const provider = createAIProvider();
      const answer = await answerApplicationQuestion(
        provider,
        this.profile,
        this.jobData,
        question.question,
        { type: question.type, choices: question.options }
      );
      return answer?.trim() || null;
    } catch {
      return null;
    }
  }

  /** Try to get an AI-generated answer for a standard form field label */
  private async tryAIAnswerForField(
    fieldLabel: string,
    fieldType?: CustomQuestion['type'] | FormField['type'],
    options?: string[]
  ): Promise<string | null> {
    try {
      const provider = createAIProvider();
      const answer = await answerApplicationQuestion(
        provider,
        this.profile,
        this.jobData,
        fieldLabel,
        options && options.length > 0 ? { type: fieldType, choices: options } : { type: fieldType }
      );
      return answer?.trim() || null;
    } catch {
      return null;
    }
  }

  /** Check if interactive prompts are enabled */
  public isInteractive(): boolean {
    if (this.options.autoMode) return false;
    if (this.options.interactivePrompts !== undefined) return this.options.interactivePrompts;
    try {
      const config = configRepository.loadAppConfig();
      return config.application.interactivePrompts ?? true;
    } catch {
      return true;
    }
  }

  /** Normalize a field label into a cache key */
  private getCacheKey(label: string): string {
    return label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  }

  /** Look up a cached answer for this field */
  private getCachedAnswer(label: string): string | null {
    try {
      const config = configRepository.loadAppConfig();
      const key = this.getCacheKey(label);
      return config.cachedAnswers?.[key] ?? null;
    } catch {
      return null;
    }
  }

  /** Save a user-provided answer so they won't be asked again */
  private saveCachedAnswer(label: string, value: string): void {
    try {
      const config = configRepository.loadAppConfig();
      if (!config.cachedAnswers) config.cachedAnswers = {};
      config.cachedAnswers[this.getCacheKey(label)] = value;
      configRepository.saveAppConfig(config);
    } catch {
      // Non-critical — caching failure shouldn't block form filling
    }
  }

  /** Prompt the user for a form field value, checking cache first */
  public async promptForField(field: FormField): Promise<string | null> {
    const label = field.label || field.name;
    if (!label) return null;

    // Check cache first
    const cached = this.getCachedAnswer(label);
    if (cached) return cached;

    try {
      const { input, select } = await import('@inquirer/prompts');

      // Select, radio, and checkbox with options — show select UI
      if ((field.type === 'select' || field.type === 'radio') && field.options && field.options.length > 0) {
        const answer = await select({
          message: `  ${label}:`,
          choices: field.options.map(opt => ({ name: opt, value: opt })),
        });
        this.saveCachedAnswer(label, answer);
        return answer;
      }

      // Checkbox — show Yes/No select
      if (field.type === 'checkbox') {
        const answer = await select({
          message: `  ${label}:`,
          choices: [
            { name: 'Yes', value: 'yes' },
            { name: 'No', value: 'no' },
          ],
        });
        this.saveCachedAnswer(label, answer);
        return answer;
      }

      const answer = await input({
        message: `  ${label}:`,
      });

      if (answer.trim()) {
        this.saveCachedAnswer(label, answer.trim());
        return answer.trim();
      }

      return null;
    } catch {
      return null;
    }
  }

  /** Prompt the user for a custom question answer, checking cache first */
  public async promptForQuestion(question: CustomQuestion): Promise<string | null> {
    const label = question.question;

    // Check cache first
    const cached = this.getCachedAnswer(label);
    if (cached) return cached;

    try {
      const { input, select } = await import('@inquirer/prompts');

      console.log('');

      if ((question.type === 'select' || question.type === 'radio') && question.options && question.options.length > 0) {
        const answer = await select({
          message: `  ${label}`,
          choices: question.options.map(opt => ({ name: opt, value: opt })),
        });
        this.saveCachedAnswer(label, answer);
        return answer;
      }

      // Checkbox — show Yes/No select
      if (question.type === 'checkbox' && (!question.options || question.options.length === 0)) {
        const answer = await select({
          message: `  ${label}`,
          choices: [
            { name: 'Yes', value: 'yes' },
            { name: 'No', value: 'no' },
          ],
        });
        this.saveCachedAnswer(label, answer);
        return answer;
      }

      // Checkbox with specific options
      if (question.type === 'checkbox' && question.options && question.options.length > 0) {
        const answer = await select({
          message: `  ${label}`,
          choices: question.options.map(opt => ({ name: opt, value: opt })),
        });
        this.saveCachedAnswer(label, answer);
        return answer;
      }

      const answer = await input({
        message: `  ${label}`,
      });

      if (answer.trim()) {
        this.saveCachedAnswer(label, answer.trim());
        return answer.trim();
      }

      return null;
    } catch {
      return null;
    }
  }

  /** Get a default value for a label without a concrete field handle */
  public getValueForLabel(
    label: string,
    fieldType: FormField['type'] = 'text',
    options?: string[],
    allowAssumptions = true
  ): string | null {
    return this.getValueForField({
      name: '',
      type: fieldType,
      label,
      required: false,
      options,
    }, allowAssumptions);
  }
}

// Helper to get file path for generated documents
export function getDocumentPath(applicationId: number, type: 'resume' | 'cover_letter'): string {
  return join(getAutoplyDir(), 'documents', `${applicationId}_${type}.pdf`);
}
