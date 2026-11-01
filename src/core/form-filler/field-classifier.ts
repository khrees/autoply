import type { Profile, FormField, CustomQuestion, AIProvider } from '../../types';
import { calculateYearsExperienceString, calculateYearsExperience } from '../../utils/experience';
import { classifyFieldsWithAI, getProfileValueForKey } from '../../ai/form-classifier';

// Field matching patterns for common form fields
export const FIELD_PATTERNS = {
  // Personal information
  firstName: /first[\s_-]?name|given[\s_-]?name|\bfname\b/i,
  lastName: /last[\s_-]?name|surname|family[\s_-]?name|\blname\b/i,
  fullName: /full[\s_-]?name|\bname\b|your[\s_-]?name|candidate[\s_-]?name/i,
  email: /e?[\s_-]?mail|email[\s_-]?address/i,
  phone: /phone|tel|mobile|cell|contact[\s_-]?number/i,
  location:
    /location|city|address|where.*based|current[\s_-]?location|office|work[\s_-]?out[\s_-]?of/i,

  // URLs
  linkedin: /linkedin|li[\s_-]?url|li[\s_-]?profile/i,
  github: /github|gh[\s_-]?url|gh[\s_-]?profile/i,
  portfolio: /portfolio|website|personal[\s_-]?site|url|homepage/i,

  // Documents
  resume: /resume|cv|curriculum[\s_-]?vitae/i,
  coverLetter: /cover[\s_-]?letter|covering[\s_-]?letter|motivation[\s_-]?letter/i,

  // Work authorization
  workAuthorization:
    /work[\s_-]?auth|authorized[\s_-]?to[\s_-]?work|legally[\s_-]?authorized|eligib|visa[\s_-]?status|right[\s_-]?to[\s_-]?work/i,
  sponsorship: /sponsor|visa[\s_-]?sponsor|immigration[\s_-]?sponsor|require.*sponsor/i,

  // Experience
  yearsExperience:
    /years?[\s_-]?(?:of[\s_-]?)?experience|experience[\s_-]?years|how[\s_-]?many[\s_-]?years/i,
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
  country:
    /\bcountry\b|country[\s_-]?of[\s_-]?residence|passport[\s_-]?country|nationality|citizenship/i,

  // Age verification
  ageVerification:
    /over[\s_-]?(?:the[\s_-]?)?(?:age[\s_-]?(?:of[\s_-]?)?)?18|legal[\s_-]?age|are[\s_-]?you[\s_-]?(?:at[\s_-]?least[\s_-]?)?18/i,

  // Other
  referral: /referral|how.*hear|source|where.*find|referred[\s_-]?by/i,
  relocation: /relocation|willing[\s_-]?to[\s_-]?relocate|open[\s_-]?to[\s_-]?relocate/i,
} as const;

// Questions/fields that require human input — AI can't reliably answer these
export const HUMAN_ONLY_PATTERNS = [
  /passport/i,
  /country[\s_-]?of[\s_-]?residence/i,
  /citizenship/i,
  /nationality/i,
  /based[\s_-]?in[\s_-]?(?:the[\s_-]?)?(?:us|u\.s\.|united[\s_-]?states|canada)/i,
  /(?:us|u\.s\.|united[\s_-]?states|canada)[\s_-]?.*based/i,
  /work[\s_-]?auth|authorized[\s_-]?to[\s_-]?work|legally[\s_-]?authorized|right[\s_-]?to[\s_-]?work/i,
  /visa[\s_-]?(?:sponsor|sponsorship|transfer)|require.*visa|require.*sponsor/i,
  /hybrid|onsite|on[\s_-]?site|come[\s_-]?onsite|weekly[\s_-]?basis/i,
  /relocation|willing[\s_-]?to[\s_-]?relocate|willing[\s_-]?and[\s_-]?able.*onsite/i,
  /\bssn\b|social[\s_-]?security/i,
  /\botp\b|verification[\s_-]?code|one[\s_-]?time[\s_-]?password/i,
  /date[\s_-]?of[\s_-]?birth|\bdob\b|birth[\s_-]?date/i,
  /\baddress\b.*(?:street|line|number|apt)/i,
  /zip[\s_-]?code|postal[\s_-]?code/i,
  /salary[\s_-]?expectation|expected[\s_-]?(?:salary|compensation)|desired[\s_-]?(?:salary|compensation)/i,
];

export const NEUTRAL_OPTION_PATTERNS = [
  /prefer not to say/i,
  /decline to answer/i,
  /do not wish to answer/i,
  /rather not say/i,
  /prefer not to respond/i,
  /choose not to answer/i,
  /not disclosed/i,
  /no answer/i,
];

export const SENSITIVE_QUESTION_PATTERNS = [
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
  /** When true, fill non-required fields instead of leaving them blank */
  fillOptionalFields?: boolean;
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

export function requiresHumanAnswer(questionText: string): boolean {
  return HUMAN_ONLY_PATTERNS.some((pattern) => pattern.test(questionText));
}

export type IdentityAssertionKey =
  | 'firstName'
  | 'lastName'
  | 'fullName'
  | 'email'
  | 'phone'
  | 'location';

type FieldLike = {
  label?: string;
  name?: string;
  type?: FormField['type'] | CustomQuestion['type'];
  options?: string[];
  value?: string;
};

function getFieldContext(field: FieldLike | string): string {
  if (typeof field === 'string') return field.toLowerCase();
  return `${field.label || ''} ${field.name || ''}`.toLowerCase();
}

function getProfileText(profile: Profile): string {
  const experienceText = profile.experience
    .map((exp) => [exp.title, exp.description, ...(exp.highlights || [])].join(' '))
    .join(' ');
  return `${profile.skills.join(' ')} ${experienceText}`.toLowerCase();
}

export function isSensitiveQuestionLabel(label: string): boolean {
  return SENSITIVE_QUESTION_PATTERNS.some((pattern) => pattern.test(label));
}

export function isIdentityField(field: FieldLike | string): boolean {
  const context = getFieldContext(field);
  return (
    FIELD_PATTERNS.firstName.test(context) ||
    FIELD_PATTERNS.lastName.test(context) ||
    FIELD_PATTERNS.fullName.test(context) ||
    FIELD_PATTERNS.email.test(context) ||
    FIELD_PATTERNS.phone.test(context) ||
    FIELD_PATTERNS.location.test(context)
  );
}

export function isComplianceField(field: FieldLike | string): boolean {
  const context = getFieldContext(field);
  return (
    FIELD_PATTERNS.workAuthorization.test(context) ||
    FIELD_PATTERNS.sponsorship.test(context) ||
    FIELD_PATTERNS.country.test(context) ||
    FIELD_PATTERNS.ageVerification.test(context) ||
    FIELD_PATTERNS.relocation.test(context) ||
    requiresHumanAnswer(context)
  );
}

export function shouldAllowAIAnswer(field: FieldLike | string): boolean {
  const label = typeof field === 'string' ? field : field.label || field.name || '';
  if (!label) return false;

  return !(isIdentityField(field) || isComplianceField(field) || isSensitiveQuestionLabel(label));
}

export function getIdentityAssertionKey(field: FieldLike | string): IdentityAssertionKey | null {
  const context = getFieldContext(field);

  if (FIELD_PATTERNS.firstName.test(context)) return 'firstName';
  if (FIELD_PATTERNS.lastName.test(context)) return 'lastName';
  if (FIELD_PATTERNS.fullName.test(context)) return 'fullName';
  if (FIELD_PATTERNS.email.test(context)) return 'email';
  if (FIELD_PATTERNS.phone.test(context)) return 'phone';
  if (FIELD_PATTERNS.location.test(context)) return 'location';

  return null;
}

export function getExpectedIdentityValue(
  profile: Profile,
  key: IdentityAssertionKey
): string | null {
  switch (key) {
    case 'firstName':
      return profile.name.split(' ')[0] || null;
    case 'lastName': {
      const parts = profile.name.split(' ');
      return parts.length > 1 ? parts.slice(1).join(' ') : null;
    }
    case 'fullName':
      return profile.name;
    case 'email':
      return profile.email;
    case 'phone':
      return profile.phone || null;
    case 'location':
      return profile.location || null;
    default:
      return null;
  }
}

function normalizeComparableText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function normalizeComparablePhone(value: string): string {
  return value.replace(/\D+/g, '');
}

function normalizeComparableLocation(value: string): string {
  return normalizeLocationInput(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function matchesIdentityFieldValue(
  key: IdentityAssertionKey,
  expected: string,
  actual: string
): boolean {
  switch (key) {
    case 'email':
      return normalizeComparableText(expected) === normalizeComparableText(actual);
    case 'phone':
      return normalizeComparablePhone(expected) === normalizeComparablePhone(actual);
    case 'location': {
      const normalizedExpected = normalizeComparableLocation(expected);
      const normalizedActual = normalizeComparableLocation(actual);
      return (
        normalizedExpected === normalizedActual ||
        normalizedExpected.includes(normalizedActual) ||
        normalizedActual.includes(normalizedExpected)
      );
    }
    default:
      return normalizeComparableText(expected) === normalizeComparableText(actual);
  }
}

export function getDeterministicFieldValue(
  profile: Profile,
  field: FieldLike,
  allowAssumptions = true
): string | null {
  const combined = getFieldContext(field);
  const isChoiceField =
    field.type === 'radio' || field.type === 'select' || field.type === 'checkbox';

  if (FIELD_PATTERNS.firstName.test(combined)) {
    return profile.name.split(' ')[0] || null;
  }

  if (FIELD_PATTERNS.lastName.test(combined)) {
    const parts = profile.name.split(' ');
    return parts.length > 1 ? parts.slice(1).join(' ') : null;
  }

  if (FIELD_PATTERNS.fullName.test(combined)) {
    return profile.name;
  }

  if (FIELD_PATTERNS.email.test(combined)) {
    return profile.email;
  }

  if (FIELD_PATTERNS.phone.test(combined)) {
    return profile.phone || null;
  }

  if (FIELD_PATTERNS.location.test(combined)) {
    return profile.location || null;
  }

  if (FIELD_PATTERNS.linkedin.test(combined)) {
    return profile.linkedin_url || null;
  }

  if (FIELD_PATTERNS.github.test(combined)) {
    return profile.github_url || null;
  }

  if (FIELD_PATTERNS.portfolio.test(combined)) {
    return profile.portfolio_url || null;
  }

  if (FIELD_PATTERNS.yearsExperience.test(combined)) {
    return calculateYearsExperienceString(profile.experience);
  }

  if (isChoiceField) {
    const yearsThresholdMatch = combined.match(
      /(\d+)\s*(?:\+|plus|or\s+more|or\s+greater|or\s+above)/i
    );
    if (yearsThresholdMatch) {
      const threshold = Number.parseInt(yearsThresholdMatch[1], 10);
      const yearsExp = calculateYearsExperience(profile.experience);
      const years = yearsExp;
      if (!Number.isNaN(threshold) && !Number.isNaN(years)) {
        return years >= threshold ? 'Yes' : 'No';
      }
    }
  }

  if (
    isChoiceField &&
    /front[\s-]?end.*back[\s-]?end|back[\s-]?end.*front[\s-]?end|full[\s-]?stack/i.test(combined)
  ) {
    const profileText = getProfileText(profile);
    const hasFrontend = /(frontend|front-end|react|vue|angular|svelte|html|css)\b/i.test(
      profileText
    );
    const hasBackend =
      /(backend|back-end|api|server|node|golang|go|python|java|c#|ruby|postgres|mysql|redis)\b/i.test(
        profileText
      );
    return hasFrontend && hasBackend ? 'Yes' : 'No';
  }

  if (isChoiceField && /(0[\s-]?1|zero[\s-]?to[\s-]?one|from\s*0\s*to\s*1)/i.test(combined)) {
    const profileText = getProfileText(profile);
    const hasLeadership =
      /(led|lead|owned|owner|launched|built|end-to-end|end to end|from scratch|0-1)/i.test(
        profileText
      );
    return hasLeadership ? 'Yes' : 'No';
  }

  if (FIELD_PATTERNS.currentCompany.test(combined)) {
    const latestExp = profile.experience[0];
    return latestExp?.company || null;
  }

  if (FIELD_PATTERNS.currentTitle.test(combined)) {
    const latestExp = profile.experience[0];
    return latestExp?.title || null;
  }

  if (allowAssumptions) {
    if (FIELD_PATTERNS.startDate.test(combined) || FIELD_PATTERNS.noticePeriod.test(combined)) {
      return '2 weeks';
    }

    if (FIELD_PATTERNS.referral.test(combined)) {
      return 'Online Job Board';
    }
  }

  if (field.value) {
    return field.value;
  }

  return null;
}

export function normalizeLocationInput(location: string): string {
  const cleaned = location
    .replace(/\b(state|province|region|county)\b/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+,/g, ',')
    .trim();

  const parts = cleaned
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length >= 2) {
    return `${parts[0]}, ${parts[parts.length - 1]}`;
  }

  return cleaned;
}

export interface AIFieldClassification {
  field: FormField;
  value: string | null;
  confidence: number;
  reasoning: string;
}

export async function classifyFieldsWithAIOnce(
  provider: AIProvider,
  fields: FormField[],
  jobContext?: string
): Promise<Map<string, AIFieldClassification>> {
  const result = new Map<string, AIFieldClassification>();

  try {
    const classifications = await classifyFieldsWithAI(provider, fields, jobContext);

    for (const classification of classifications) {
      const profileValue = getProfileValueForKey(
        classification.field as unknown as Record<string, unknown>,
        classification.matchedProfileKey
      );

      result.set(classification.field.name || classification.field.label || '', {
        field: classification.field,
        value: profileValue || null,
        confidence: classification.confidence,
        reasoning: classification.reasoning,
      });
    }
  } catch {
    // AI classification failed, return empty map
  }

  return result;
}
