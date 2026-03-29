import { input, confirm, select } from '@inquirer/prompts';

import type { Profile, Education, Preferences, Experience } from '../../types';
import { extractTextFromFile, validateDocumentPath, getSupportedFormatsDescription } from '../../utils/document-extractor';

type AIExtractedProfile = Omit<Profile, 'id' | 'created_at' | 'updated_at' | 'base_resume' | 'base_cover_letter' | 'preferences'>;

interface ProfilePromptOptions {
  resumeText?: string;
  coverLetterText?: string;
  aiDefaults?: AIExtractedProfile;
}

export async function promptForProfile(options: ProfilePromptOptions = {}): Promise<Omit<Profile, 'id' | 'created_at' | 'updated_at'>> {
  const defaults = options.aiDefaults;
  console.log('\n📝 Let\'s set up your profile\n');

  const name = await input({
    message: 'Full name:',
    default: defaults?.name,
    validate: (value) => (value.length > 0 ? true : 'Name is required'),
  });

  const email = await input({
    message: 'Email address:',
    default: defaults?.email,
    validate: (value) => {
      if (!value.includes('@')) return 'Please enter a valid email';
      return true;
    },
  });

  const phone = await input({
    message: 'Phone number (optional):',
    default: defaults?.phone ?? '',
  });

  const location = await input({
    message: 'Location (City, Country):',
    default: defaults?.location ?? '',
  });

  const linkedin_url = await input({
    message: 'LinkedIn URL (optional):',
    default: defaults?.linkedin_url ?? '',
  });

  const github_url = await input({
    message: 'GitHub URL (optional):',
    default: defaults?.github_url ?? '',
  });

  const portfolio_url = await input({
    message: 'Portfolio URL (optional):',
    default: defaults?.portfolio_url ?? '',
  });

  // Skills
  const skillsInput = await input({
    message: 'Skills (comma-separated):',
    default: defaults?.skills.join(', ') ?? '',
  });
  const skills = skillsInput
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // Education - use AI extracted or prompt
  const education: Education[] = defaults?.education ?? [];
  if (!defaults?.education?.length) {
    const addEducation = await confirm({
      message: 'Add education?',
      default: true,
    });

    if (addEducation) {
      let addMore = true;
      while (addMore) {
        const edu = await promptForEducation();
        education.push(edu);
        addMore = await confirm({
          message: 'Add another education entry?',
          default: false,
        });
      }
    }
  }

  // Experience - use AI extracted or empty
  const experience: Experience[] = defaults?.experience ?? [];

  // Preferences
  const preferences = await promptForPreferences();

  // Base resume
  const base_resume = options.resumeText ?? await promptForDocument('resume');

  // Base cover letter
  const base_cover_letter = options.coverLetterText ?? await promptForDocument('cover letter');

  return {
    name,
    email,
    phone: phone || undefined,
    location: location || undefined,
    linkedin_url: linkedin_url || undefined,
    github_url: github_url || undefined,
    portfolio_url: portfolio_url || undefined,
    base_resume,
    base_cover_letter,
    preferences,
    skills,
    experience,
    education,
  };
}

async function promptForDocument(label: string): Promise<string> {
  const method = await select({
    message: `How would you like to provide your ${label}?`,
    choices: [
      { name: `Import from file (${getSupportedFormatsDescription()})`, value: 'file' },
      { name: 'Paste text directly', value: 'paste' },
      { name: 'Skip for now', value: 'skip' },
    ],
  });

  if (method === 'skip') {
    return '';
  }

  if (method === 'file') {
    return promptDocumentViaFile(label);
  }

  return promptDocumentViaPaste(label);
}

async function promptDocumentViaFile(label: string): Promise<string> {
  const filePath = await input({
    message: `Path to ${label} file (drag & drop or type path):`,
    validate: (value) => {
      if (!value.trim()) return 'File path is required';
      // Clean up path (remove surrounding quotes from drag-and-drop)
      const cleaned = value.trim().replace(/^['"]|['"]$/g, '');
      const validation = validateDocumentPath(cleaned);
      if (!validation.valid) return validation.error || 'Invalid file';
      return true;
    },
  });

  const cleanedPath = filePath.trim().replace(/^['"]|['"]$/g, '');
  const result = await extractTextFromFile(cleanedPath);
  if (!result.success) {
    console.log(`\n  Failed to extract: ${result.error}`);
    const retry = await select({
      message: 'What would you like to do?',
      choices: [
        { name: 'Try another file', value: 'retry' },
        { name: 'Paste text instead', value: 'paste' },
        { name: 'Skip for now', value: 'skip' },
      ],
    });
    if (retry === 'retry') return promptDocumentViaFile(label);
    if (retry === 'skip') return '';
    return promptDocumentViaPaste(label);
  }

  console.log(`\n  ✓ Extracted ${result.content ? result.content.length : 0} characters from ${result.fileType} file.\n`);
  return result.content || '';
}

async function promptDocumentViaPaste(label: string): Promise<string> {
  console.log(`\n  Paste your ${label} below, then press Enter twice to finish:\n`);
  const text = await input({
    message: `${label}:`,
  });

  if (!text.trim()) {
    const retry = await confirm({
      message: `No ${label} text provided. Skip?`,
      default: true,
    });
    if (retry) return '';
    return promptDocumentViaPaste(label);
  }

  return text.trim();
}

async function promptForEducation(): Promise<Education> {
  const institution = await input({
    message: 'Institution name:',
    validate: (v) => (v.length > 0 ? true : 'Required'),
  });

  const degree = await input({
    message: 'Degree (e.g., Bachelor\'s, Master\'s):',
    validate: (v) => (v.length > 0 ? true : 'Required'),
  });

  const field = await input({
    message: 'Field of study (optional):',
  });

  const start_date = await input({
    message: 'Start date (optional):',
  });

  const end_date = await input({
    message: 'End date or expected graduation:',
  });

  const gpa = await input({
    message: 'GPA (optional):',
  });

  return {
    institution,
    degree,
    field: field || undefined,
    start_date: start_date || undefined,
    end_date: end_date || undefined,
    gpa: gpa || undefined,
  };
}

export async function promptForPreferences(): Promise<Preferences> {
  const remote_only = await confirm({
    message: 'Only interested in remote jobs?',
    default: false,
  });

  const minSalaryInput = await input({
    message: 'Minimum salary (optional, numbers only):',
  });
  const min_salary = minSalaryInput ? parseInt(minSalaryInput, 10) : undefined;

  const locationsInput = await input({
    message: 'Preferred locations (comma-separated, optional):',
  });
  const preferred_locations = locationsInput
    .split(',')
    .map((l) => l.trim())
    .filter(Boolean);

  const excludedInput = await input({
    message: 'Companies to exclude (comma-separated, optional):',
  });
  const excluded_companies = excludedInput
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);

  const jobTypesInput = await input({
    message: 'Job types (comma-separated, e.g., full-time, contract):',
    default: 'full-time',
  });
  const job_types = jobTypesInput
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  return {
    remote_only,
    min_salary,
    preferred_locations,
    excluded_companies,
    job_types,
  };
}

export async function promptForProfileUpdate(
  current: Profile
): Promise<Partial<Profile>> {
  console.log('\n📝 Update your profile (press Enter to keep current value)\n');

  const name = await input({
    message: 'Full name:',
    default: current.name,
  });

  const email = await input({
    message: 'Email:',
    default: current.email,
  });

  const phone = await input({
    message: 'Phone:',
    default: current.phone ?? '',
  });

  const location = await input({
    message: 'Location:',
    default: current.location ?? '',
  });

  const skillsInput = await input({
    message: 'Skills (comma-separated):',
    default: current.skills.join(', '),
  });

  const skills = skillsInput
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    name,
    email,
    phone: phone || undefined,
    location: location || undefined,
    skills,
  };
}
