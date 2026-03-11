// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { AIProvider, Profile } from '../types';

interface FormField {
  id: string;
  type: 'text' | 'select' | 'checkbox' | 'textarea';
  label: string;
  options?: string[];
  currentValue?: string;
  required: boolean;
}


const FORM_ANALYZER_PROMPT = `You help fill job application forms. Given a candidate's profile and unfilled form fields, provide the best answers.

Rules:
- For text fields: provide concise, appropriate text
- For select/dropdown fields: choose the EXACT option from the provided options list
- For checkboxes asking for consent/acknowledgment: answer "check"
- For "Preferred First Name": use the candidate's first name
- For location/city fields: use the candidate's city
- For "How did you hear" multi-select: pick "LinkedIn" or "Job Board" if available
- For demographic questions (gender, race, veteran, disability): choose "Decline" or "Prefer not to say" options
- For work authorization: answer "Yes" if they have the right to work
- For visa sponsorship: answer based on their situation (usually "No" if they're a citizen)

Return ONLY valid JSON array: [{"id": "field_id", "answer": "value"}, ...]`;

export async function analyzeAndFillFormFields(
  provider: AIProvider,
  profile: Profile,
  unfilledFields: FormField[]
): Promise<Map<string, string>> {
  if (unfilledFields.length === 0) return new Map();

  const fieldsDescription = unfilledFields.map(f => {
    let desc = `- ID: "${f.id}", Label: "${f.label}", Type: ${f.type}, Required: ${f.required}`;
    if (f.options && f.options.length > 0) {
      desc += `\n  Options: ${f.options.join(', ')}`;
    }
    return desc;
  }).join('\n');

  const prompt = `Fill these application form fields for the candidate:

## Candidate Profile
Name: ${profile.name}
Email: ${profile.email}
Phone: ${profile.phone || 'Not provided'}
Location: ${profile.location || 'Not provided'}
LinkedIn: ${profile.linkedin_url || 'Not provided'}

## Unfilled Form Fields
${fieldsDescription}

Provide answers for each field. For select/dropdown, use EXACTLY one of the provided options.`;

  const response = await provider.generateText(prompt, FORM_ANALYZER_PROMPT);
  const cleaned = response.replace(/```json?\n?/g, '').replace(/```/g, '').trim();

  const results = new Map<string, string>();

  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (item.id && item.answer) {
          results.set(String(item.id), String(item.answer));
        }
      }
    }
  } catch {
    // Fallback: use simple rules
    for (const field of unfilledFields) {
      const labelLower = field.label.toLowerCase();

      if (labelLower.includes('preferred') && labelLower.includes('name')) {
        results.set(field.id, profile.name.split(' ')[0]);
      } else if ((labelLower.includes('location') || labelLower.includes('city')) && profile.location) {
        results.set(field.id, profile.location);
      } else if (labelLower.includes('first name')) {
        results.set(field.id, profile.name.split(' ')[0]);
      }
    }
  }

  return results;
}

export async function getSmartFieldAnswer(
  provider: AIProvider,
  profile: Profile,
  label: string,
  fieldType: string,
  options?: string[]
): Promise<string> {
  const prompt = `For a job application form, what should this candidate answer for:

Field: "${label}"
Type: ${fieldType}
${options ? `Options: ${options.join(', ')}` : ''}

Candidate:
- Name: ${profile.name}
- Location: ${profile.location || 'Not provided'}
- Phone: ${profile.phone || 'Not provided'}

Return ONLY the answer value, nothing else. For dropdowns, return EXACTLY one of the options.`;

  return provider.generateText(prompt, 'You fill job application forms. Return only the answer value.');
}
