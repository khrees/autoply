import type { AIProvider, FormField } from '../types';
import { calculateYearsExperience } from '../utils/experience';

export interface FieldClassificationResult {
  field: FormField;
  matchedProfileKey: string;
  confidence: number;
  reasoning: string;
}

const FIELD_CLASSIFICATION_PROMPT = `You are an expert at mapping form fields to candidate profile data. Analyze each form field and determine:

1. What profile data it should be filled with (if any)
2. Your confidence in the match (0.0 - 1.0)
3. A brief explanation

## Profile Fields Available
- firstName, lastName, fullName (candidate's name)
- email (email address)
- phone (phone number)
- location (city, country or full address)
- linkedinUrl (LinkedIn profile URL)
- githubUrl (GitHub profile URL)
- portfolioUrl (personal website/portfolio URL)
- currentCompany (current or most recent employer)
- currentTitle (current or most recent job title)
- yearsExperience (total years of professional experience)
- resume (file upload - return "FILE:resume")
- coverLetter (file upload - return "FILE:cover_letter")
- education (school/university name)
- skills (comma-separated skills list)

## Fields to NEVER auto-fill (privacy/legal reasons)
- gender, sex
- race, ethnicity
- veteran status
- disability status
- date of birth, age
- SSN, social security number
- salary history

## Fields that need smart defaults (not from profile)
- workAuthorization: "Yes, I am authorized to work" or similar
- referralSource: "Online Job Board" or similar
- startDate: "Immediately" or "2 weeks notice"

Return valid JSON array matching this format:
[
  {
    "fieldName": "name of the field",
    "matchedProfileKey": "firstName" | "lastName" | "email" | etc,
    "confidence": 0.95,
    "reasoning": "why this matches"
  }
]

Only include fields that should be auto-filled. Fields that should be skipped or require human input should not be in the response.`;

export async function classifyFieldsWithAI(
  provider: AIProvider,
  fields: FormField[],
  jobContext?: string
): Promise<FieldClassificationResult[]> {
  if (fields.length === 0) return [];

  const fieldsDescription = fields
    .map(
      (f, i) =>
        `${i + 1}. "${f.name}" (type: ${f.type})${f.label ? `, label: "${f.label}"` : ''}${f.required ? ', REQUIRED' : ', optional'}`
    )
    .join('\n');

  const prompt = `Analyze these application form fields and determine what profile data to fill them with:

## Form Fields
${fieldsDescription}

${jobContext ? `## Job Context\n${jobContext.slice(0, 2000)}\n` : ''}

Return a JSON array of fields to auto-fill. Skip any field that should be left blank or filled manually.`;

  const response = await provider.generateText(prompt, FIELD_CLASSIFICATION_PROMPT);

  // Parse the response
  const cleaned = response
    .replace(/```json\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item: { fieldName?: string; matchedProfileKey?: string; confidence?: number; reasoning?: string }) => {
        const matchedField = fields.find((f) => {
          const fieldName = item.fieldName?.toLowerCase();
          if (!fieldName) return false;
          return (
            f.name.toLowerCase() === fieldName ||
            f.label?.toLowerCase().includes(fieldName)
          );
        });

        if (!matchedField) return null;

        return {
          field: matchedField,
          matchedProfileKey: item.matchedProfileKey || '',
          confidence: typeof item.confidence === 'number' ? item.confidence : 0.8,
          reasoning: item.reasoning || '',
        };
      })
      .filter(Boolean) as FieldClassificationResult[];
  } catch {
    // If parsing fails, return empty - AI couldn't help
    return [];
  }
}

export function getProfileValueForKey(
  profile: Record<string, unknown>,
  key: string
): string | undefined {
  switch (key) {
    case 'firstName': {
      const name = profile.name as string;
      return name?.split(' ')[0];
    }

    case 'lastName': {
      const fullName = profile.name as string;
      const parts = fullName?.split(' ');
      return parts?.slice(1).join(' ') || undefined;
    }

    case 'fullName':
      return profile.name as string;

    case 'email':
      return profile.email as string;

    case 'phone':
      return profile.phone as string;

    case 'location':
      return profile.location as string;

    case 'linkedinUrl':
      return profile.linkedin_url as string;

    case 'githubUrl':
      return profile.github_url as string;

    case 'portfolioUrl':
      return profile.portfolio_url as string;

    case 'currentCompany': {
      const exp = profile.experience as Array<{ company?: string }>;
      return exp?.[0]?.company;
    }

    case 'currentTitle': {
      const exp = profile.experience as Array<{ title?: string }>;
      return exp?.[0]?.title;
    }

    case 'yearsExperience':
      return String(calculateYearsExperienceFromRecord(profile));

    case 'skills': {
      const skills = profile.skills as string[];
      return skills?.slice(0, 15).join(', ');
    }

    case 'education': {
      const edu = profile.education as Array<{ institution?: string; degree?: string }>;
      return edu?.map((e) => `${e.degree} at ${e.institution}`).join(', ');
    }

    case 'workAuthorization':
      return 'Yes, I am authorized to work in the country where the position is based';

    case 'referralSource':
      return 'Online Job Board';

    case 'startDate':
      return 'Immediately / 2 weeks notice';

    case 'resume':
      return 'FILE:resume';

    case 'coverLetter':
      return 'FILE:cover_letter';

    default:
      return undefined;
  }
}

function calculateYearsExperienceFromRecord(profile: Record<string, unknown>): number {
  const experience = profile.experience as Array<{ start_date?: string; end_date?: string }>;
  if (!experience || experience.length === 0) return 0;
  return calculateYearsExperience(experience as import('../types').Experience[]);
}
