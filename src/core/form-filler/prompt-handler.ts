import type { FormField, CustomQuestion } from '../../types';
import { configRepository } from '../../db/repositories/config';

export function getCacheKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

export function getCachedAnswer(label: string): string | null {
  try {
    const config = configRepository.loadAppConfig();
    const key = getCacheKey(label);
    return config.cachedAnswers?.[key] ?? null;
  } catch {
    return null;
  }
}

export function saveCachedAnswer(label: string, value: string): void {
  try {
    const config = configRepository.loadAppConfig();
    if (!config.cachedAnswers) config.cachedAnswers = {};
    config.cachedAnswers[getCacheKey(label)] = value;
    configRepository.saveAppConfig(config);
  } catch {
    // Non-critical — caching failure shouldn't block form filling
  }
}

export async function promptForField(
  field: FormField,
  getCachedAnswer: (l: string) => string | null,
  saveCachedAnswer: (l: string, v: string) => void
): Promise<string | null> {
  const label = field.label || field.name;
  if (!label) return null;

  // Check cache first
  const cached = getCachedAnswer(label);
  if (cached) return cached;

  try {
    const { input, select } = await import('@inquirer/prompts');

    // Select, radio, and checkbox with options — show select UI
    if (
      (field.type === 'select' || field.type === 'radio') &&
      field.options &&
      field.options.length > 0
    ) {
      const answer = await select({
        message: `  ${label}:`,
        choices: field.options.map((opt) => ({ name: opt, value: opt })),
      });
      saveCachedAnswer(label, answer);
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
      saveCachedAnswer(label, answer);
      return answer;
    }

    const answer = await input({
      message: `  ${label}:`,
    });

    if (answer.trim()) {
      saveCachedAnswer(label, answer.trim());
      return answer.trim();
    }

    return null;
  } catch {
    return null;
  }
}

export async function promptForQuestion(
  question: CustomQuestion,
  getCachedAnswer: (l: string) => string | null,
  saveCachedAnswer: (l: string, v: string) => void
): Promise<string | null> {
  const label = question.question;

  // Check cache first
  const cached = getCachedAnswer(label);
  if (cached) return cached;

  try {
    const { input, select } = await import('@inquirer/prompts');

    if (
      (question.type === 'select' || question.type === 'radio') &&
      question.options &&
      question.options.length > 0
    ) {
      const answer = await select({
        message: `  ${label}`,
        choices: question.options.map((opt) => ({ name: opt, value: opt })),
      });
      saveCachedAnswer(label, answer);
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
      saveCachedAnswer(label, answer);
      return answer;
    }

    // Checkbox with specific options
    if (question.type === 'checkbox' && question.options && question.options.length > 0) {
      const answer = await select({
        message: `  ${label}`,
        choices: question.options.map((opt) => ({ name: opt, value: opt })),
      });
      saveCachedAnswer(label, answer);
      return answer;
    }

    const answer = await input({
      message: `  ${label}`,
    });

    if (answer.trim()) {
      saveCachedAnswer(label, answer.trim());
      return answer.trim();
    }

    return null;
  } catch {
    return null;
  }
}
