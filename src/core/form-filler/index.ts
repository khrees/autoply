import type { Page, Frame } from 'playwright';
import type { Profile, FormField, CustomQuestion, JobData } from '../../types';
import { join } from 'path';
import { getAutoplyDir } from '../../db';
import { configRepository } from '../../db/repositories/config';
import { answerApplicationQuestion } from '../../ai/cover-letter';
import { createAIProvider } from '../../ai/provider';
import { buildSemanticSelector } from '../semantic-selectors';
import {
  classifyFieldsWithAIOnce,
  shouldAllowAIAnswer,
  getDeterministicFieldValue,
  SENSITIVE_QUESTION_PATTERNS,
  NEUTRAL_OPTION_PATTERNS,
} from './field-classifier';
import type { AIFieldClassification, FormFillerOptions, FillResult } from './field-classifier';
import {
  fillTextInput,
  fillTextarea,
  fillSelect,
  fillRadio,
  fillCheckbox,
  fillFileInput,
} from './field-input';
import { fillQuestion, findQuestionContainer, findInputByLabel } from './question-filler';
import {
  getCacheKey,
  getCachedAnswer,
  saveCachedAnswer,
  promptForField,
  promptForQuestion,
} from './prompt-handler';

export * from './field-classifier';
export * from './field-input';
export * from './question-filler';
export * from './prompt-handler';

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
    const aiClassifications = await this.getAIFieldClassifications(formFields);
    for (const field of formFields) {
      try {
        const fieldLabel = field.label || field.name;
        if (!field.required && field.type !== 'file' && !this.shouldFillOptionalFields()) {
          if (fieldLabel) result.skippedFields.push(fieldLabel);
          continue;
        }

        const aiClassification = aiClassifications.get(fieldLabel || '');

        let filled = await this.fillField(field, field.required);
        if (filled) {
          if (fieldLabel) result.filledFields.push(fieldLabel);
        } else if (field.required) {
          let aiAnswerUsed = false;

          if (aiClassification?.value) {
            field.value = aiClassification.value;
            filled = await this.fillFieldWithRetry(field, field.required, 2);
            if (filled) {
              aiAnswerUsed = true;
              if (fieldLabel) result.filledFields.push(fieldLabel);
              continue;
            }
          }

          const cached = fieldLabel ? this.getCachedAnswer(fieldLabel) : null;
          if (cached) {
            field.value = cached;
            const retryFilled = await this.fillFieldWithRetry(field, field.required, 2);
            if (retryFilled) {
              result.filledFields.push(fieldLabel);
              continue;
            }
          }

          if (
            (field.type === 'text' || field.type === 'textarea') &&
            fieldLabel &&
            shouldAllowAIAnswer(field)
          ) {
            const aiAnswer = await this.tryAIAnswerForField(fieldLabel);
            if (aiAnswer) {
              aiAnswerUsed = true;
              field.value = aiAnswer;
              const retryFilled = await this.fillFieldWithRetry(field, field.required, 2);
              if (retryFilled) {
                result.filledFields.push(fieldLabel);
                continue;
              }
            }
          }

          if (
            (field.type === 'select' || field.type === 'radio' || field.type === 'checkbox') &&
            fieldLabel &&
            shouldAllowAIAnswer(field)
          ) {
            const aiAnswer = await this.tryAIAnswerForField(fieldLabel, field.type, field.options);
            if (aiAnswer) {
              aiAnswerUsed = true;
              field.value = aiAnswer;
              const retryFilled = await this.fillFieldWithRetry(field, field.required, 2);
              if (retryFilled) {
                result.filledFields.push(fieldLabel);
                continue;
              }
            }
          }

          if (this.isInteractive() && !aiAnswerUsed) {
            const userValue = await this.promptForField(field);
            if (userValue) {
              field.value = userValue;
              const retryFilled = await this.fillFieldWithRetry(field, field.required, 2);
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
          if (fieldLabel && this.shouldFillOptionalFields()) {
            const neutral = this.getNeutralAnswerForField(field);
            if (neutral) {
              field.value = neutral;
              const retryFilled = await this.fillFieldWithRetry(field, false, 1);
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
        if (!question.required && !this.shouldFillOptionalFields()) {
          result.skippedFields.push(question.question.slice(0, 50));
          continue;
        }

        if (!question.answer) {
          const cached = this.getCachedAnswer(question.question);
          if (cached) {
            question.answer = cached;
          } else {
            const deterministic = getDeterministicFieldValue(
              this.profile,
              {
                label: question.question,
                name: question.id,
                type: question.type,
                options: question.options,
                value: question.answer,
              },
              false
            );
            if (deterministic) {
              question.answer = deterministic;
            }
          }

          if (
            !question.answer &&
            question.required &&
            shouldAllowAIAnswer({
              label: question.question,
              name: question.id,
              type: question.type,
              options: question.options,
            })
          ) {
            // AI-answerable required question — get AI answer
            const aiAnswer = await this.tryAIAnswer(question);
            if (aiAnswer) {
              question.answer = aiAnswer;
            }
          } else if (!question.answer && !question.required) {
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
        return value ? this.fillTextInput(selector, value, field) : false;

      case 'textarea':
        return value ? this.fillTextarea(selector, value) : false;

      case 'select':
        return value ? this.fillSelect(selector, value, field) : false;

      case 'radio':
        return value ? this.fillRadio(field, value) : false;

      case 'checkbox':
        return value ? this.fillCheckbox(field, value) : false;

      case 'file':
        return this.fillFileInput(selector, field);

      default:
        return false;
    }
  }

  private async fillFieldWithRetry(
    field: FormField,
    allowAssumptions: boolean,
    maxRetries = 2
  ): Promise<boolean> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const filled = await this.fillField(field, allowAssumptions);
      if (filled) return true;

      if (attempt < maxRetries) {
        await this.humanDelay();
      }
    }

    return false;
  }

  private async getAIFieldClassifications(
    fields: FormField[]
  ): Promise<Map<string, AIFieldClassification>> {
    const result = new Map<string, AIFieldClassification>();
    if (fields.length === 0) return result;
    try {
      const provider = createAIProvider();
      const jobContext = this.jobData.description
        ? `${this.jobData.title} at ${this.jobData.company}\n\n${this.jobData.description.slice(0, 2000)}`
        : undefined;

      const classifications = await classifyFieldsWithAIOnce(provider, fields, jobContext);

      for (const [key, value] of classifications) {
        result.set(key, value);
      }
    } catch {
      // AI classification failed, continue with pattern matching
    }

    return result;
  }

  private getValueForField(field: FormField, allowAssumptions = true): string | null {
    const resolved = getDeterministicFieldValue(this.profile, field, allowAssumptions);
    if (resolved) {
      return resolved;
    }

    const fieldLabel = field.label || field.name;
    if (fieldLabel) {
      const cached = this.getCachedAnswer(fieldLabel);
      if (cached) return cached;
    }

    return null;
  }

  private buildSelector(field: FormField): string {
    const semanticSelector = buildSemanticSelector({
      label: field.label,
      name: field.name,
      type: field.type,
    });
    const selectors: string[] = [semanticSelector];
    if (field.name) {
      selectors.push(`[name="${field.name}"]`);
      selectors.push(`#${field.name}`);
    }

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
    return fillTextInput(this.page, this.root, selector, value, field, this.humanDelay.bind(this));
  }

  private async fillTextarea(selector: string, value: string): Promise<boolean> {
    return fillTextarea(this.root, selector, value, this.humanDelay.bind(this));
  }

  private async fillSelect(selector: string, value: string, field: FormField): Promise<boolean> {
    return fillSelect(
      this.page,
      this.root,
      selector,
      value,
      field,
      this.findBestMatchingOption.bind(this),
      this.humanDelay.bind(this)
    );
  }

  private async fillRadio(field: FormField, value: string): Promise<boolean> {
    return fillRadio(
      this.page,
      this.root,
      field,
      value,
      this.findBestMatchingOption.bind(this),
      this.humanDelay.bind(this)
    );
  }

  private async fillCheckbox(field: FormField, value: string): Promise<boolean> {
    return fillCheckbox(this.page, this.root, field, value, this.humanDelay.bind(this));
  }

  private async fillFileInput(selector: string, field: FormField): Promise<boolean> {
    return fillFileInput(
      this.page,
      this.root,
      selector,
      field,
      this.options,
      this.humanDelay.bind(this)
    );
  }

  private async fillQuestion(question: CustomQuestion): Promise<boolean> {
    return fillQuestion(
      this.page,
      this.root,
      question,
      this.findBestMatchingOption.bind(this),
      this.humanDelay.bind(this)
    );
  }

  private async findQuestionContainer(questionText: string): Promise<ReturnType<Page['$']>> {
    return findQuestionContainer(this.root, questionText);
  }

  private async findInputByLabel(labelText: string): Promise<ReturnType<Page['$']>> {
    return findInputByLabel(this.root, labelText);
  }

  public findBestMatchingOption(value: string, options: string[]): string | null {
    const normalizedValue = value.toLowerCase().trim();
    const exactMatch = options.find((opt) => opt.toLowerCase().trim() === normalizedValue);
    if (exactMatch) return exactMatch;
    const containsMatch = options.find(
      (opt) =>
        opt.toLowerCase().includes(normalizedValue) || normalizedValue.includes(opt.toLowerCase())
    );
    if (containsMatch) return containsMatch;
    if (['yes', 'true', 'y'].includes(normalizedValue)) {
      const yesOption = options.find((opt) =>
        /^(yes|true|y|affirmative|correct)$/i.test(opt.trim())
      );
      if (yesOption) return yesOption;
    }

    if (['no', 'false', 'n'].includes(normalizedValue)) {
      const noOption = options.find((opt) => /^(no|false|n|negative)$/i.test(opt.trim()));
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
    if (
      (question.type === 'text' || question.type === 'textarea') &&
      this.isSensitiveQuestion(question.question)
    ) {
      return 'Prefer not to say';
    }

    return null;
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

  /** Check if optional form fields and questions should be filled at all */
  public shouldFillOptionalFields(): boolean {
    if (this.options.fillOptionalFields !== undefined) return this.options.fillOptionalFields;
    try {
      const config = configRepository.loadAppConfig();
      return config.application.fillOptionalFields ?? false;
    } catch {
      return false;
    }
  }

  /** Normalize a field label into a cache key */
  private getCacheKey(label: string): string {
    return getCacheKey(label);
  }

  /** Look up a cached answer for this field */
  private getCachedAnswer(label: string): string | null {
    return getCachedAnswer(label);
  }

  /** Save a user-provided answer so they won't be asked again */
  private saveCachedAnswer(label: string, value: string): void {
    return saveCachedAnswer(label, value);
  }

  /** Prompt the user for a form field value, checking cache first */
  public async promptForField(field: FormField): Promise<string | null> {
    return promptForField(field, this.getCachedAnswer.bind(this), this.saveCachedAnswer.bind(this));
  }

  /** Prompt the user for a custom question answer, checking cache first */
  public async promptForQuestion(question: CustomQuestion): Promise<string | null> {
    return promptForQuestion(
      question,
      this.getCachedAnswer.bind(this),
      this.saveCachedAnswer.bind(this)
    );
  }

  /** Get a default value for a label without a concrete field handle */
  public getValueForLabel(
    label: string,
    fieldType: FormField['type'] = 'text',
    options?: string[],
    allowAssumptions = true
  ): string | null {
    return this.getValueForField(
      {
        name: '',
        type: fieldType,
        label,
        required: false,
        options,
      },
      allowAssumptions
    );
  }
}

export function getDocumentPath(applicationId: number, type: 'resume' | 'cover_letter'): string {
  return join(getAutoplyDir(), 'documents', `${applicationId}_${type}.pdf`);
}
