import { z } from 'zod';
import type { JobData, FormField, CustomQuestion, Profile, GeneratedDocuments } from '../types';

// ============================================================================
// Zod Schemas for Runtime Validation
// ============================================================================

/**
 * Validate a form field with strict type checking
 */
export const FormFieldSchema = z.object({
  name: z.string(),
  type: z.enum(['text', 'email', 'tel', 'select', 'textarea', 'file', 'checkbox', 'radio']),
  label: z.string(),
  required: z.boolean(),
  options: z.array(z.string()).optional(),
  value: z.string().optional(),
});

/**
 * Validate a custom question
 */
export const CustomQuestionSchema = z.object({
  id: z.string(),
  question: z.string(),
  type: z.enum(['text', 'textarea', 'select', 'radio', 'checkbox']),
  required: z.boolean(),
  options: z.array(z.string()).optional(),
  answer: z.string().optional(),
});

/**
 * Validate job data scraped from a job posting
 * This is the authoritative schema - all scrapers must produce data matching this
 */
export const JobDataSchema = z.object({
  url: z.string().url(),
  platform: z.enum([
    'greenhouse',
    'linkedin',
    'lever',
    'jobvite',
    'smartrecruiters',
    'pinpoint',
    'teamtailor',
    'workday',
    'ashby',
    'bamboohr',
    'workable',
    'generic',
  ]),
  title: z.string().min(1, 'Job title is required'),
  company: z.string().min(1, 'Company name is required'),
  description: z.string().min(50, 'Job description too short'),
  requirements: z.array(z.string()),
  qualifications: z.array(z.string()),
  location: z.string().optional(),
  salary: z.string().optional(),
  job_type: z.string().optional(),
  remote: z.boolean().optional(),
  form_fields: z.array(FormFieldSchema),
  custom_questions: z.array(CustomQuestionSchema),
});

/**
 * Validate a profile
 */
export const ProfileSchema = z.object({
  id: z.number().optional(),
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email format'),
  phone: z.string().optional(),
  location: z.string().optional(),
  linkedin_url: z.string().url().optional().or(z.literal('')),
  github_url: z.string().url().optional().or(z.literal('')),
  portfolio_url: z.string().url().optional().or(z.literal('')),
  base_resume: z.string().optional(),
  base_cover_letter: z.string().optional(),
  skills: z.array(z.string()),
  experience: z.array(
    z.object({
      company: z.string(),
      title: z.string(),
      location: z.string().optional(),
      start_date: z.string(),
      end_date: z.string().optional(),
      description: z.string().optional(),
      highlights: z.array(z.string()),
    })
  ),
  education: z.array(
    z.object({
      institution: z.string(),
      degree: z.string(),
      field: z.string().optional(),
      start_date: z.string().optional(),
      end_date: z.string().optional(),
      gpa: z.string().optional(),
    })
  ),
});

/**
 * Validate generated documents
 */
export const GeneratedDocumentsSchema = z.object({
  resume: z.string().min(100, 'Resume too short'),
  coverLetter: z.string().min(100, 'Cover letter too short'),
});

// ============================================================================
// Validation Functions
// ============================================================================

export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  errors: string[];
}

/**
 * Validate job data with detailed error messages
 */
export function validateJobData(data: unknown): ValidationResult<JobData> {
  const result = JobDataSchema.safeParse(data);

  if (!result.success) {
    const errors = result.error.errors.map((err) => {
      const path = err.path.join('.');
      return `${path ? `${path}: ` : ''}${err.message}`;
    });

    return {
      success: false,
      errors,
    };
  }

  // Additional semantic validation
  const semanticErrors: string[] = [];

  if (result.data.title.toLowerCase() === 'unknown position') {
    semanticErrors.push('Job title could not be determined - "Unknown Position" is not valid');
  }

  if (result.data.description.length < 100) {
    semanticErrors.push('Job description is suspiciously short (< 100 chars)');
  }

  if (semanticErrors.length > 0) {
    return {
      success: false,
      errors: semanticErrors,
    };
  }

  return {
    success: true,
    data: result.data,
    errors: [],
  };
}

/**
 * Validate profile data
 */
export function validateProfile(data: unknown): ValidationResult<Profile> {
  const result = ProfileSchema.safeParse(data);

  if (!result.success) {
    const errors = result.error.errors.map((err) => {
      const path = err.path.join('.');
      return `${path ? `${path}: ` : ''}${err.message}`;
    });

    return {
      success: false,
      errors,
    };
  }

  return {
    success: true,
    data: result.data,
    errors: [],
  };
}

/**
 * Validate generated documents with quality checks
 */
export function validateGeneratedDocuments(
  data: unknown,
  options: { checkQuality?: boolean } = {}
): ValidationResult<GeneratedDocuments> & { qualityIssues?: string[] } {
  const result = GeneratedDocumentsSchema.safeParse(data);

  if (!result.success) {
    const errors = result.error.errors.map((err) => err.message);

    return {
      success: false,
      errors,
    };
  }

  const qualityIssues: string[] = [];

  if (options.checkQuality !== false) {
    // Check for AI hallucination markers
    const resumeLower = result.data.resume.toLowerCase();
    const coverLetterLower = result.data.coverLetter.toLowerCase();

    // Check for placeholder text that shouldn't be there
    const placeholderPatterns = [
      /[your|their|his|her]\s+(company|name|position)/i,
      /\[.*\]/, // Unfilled brackets
      /insert .* here/i,
      /replace with/i,
      /todo/i,
      /fix me/i,
    ];

    for (const pattern of placeholderPatterns) {
      if (pattern.test(resumeLower) || pattern.test(coverLetterLower)) {
        qualityIssues.push(`Document contains placeholder text matching: ${pattern}`);
      }
    }

    // Check for AI self-reference
    const aiSelfReferences = [
      'as an ai',
      'as a language model',
      'i am an ai',
      'generated by',
      'this document was generated',
    ];

    for (const reference of aiSelfReferences) {
      if (resumeLower.includes(reference) || coverLetterLower.includes(reference)) {
        qualityIssues.push(`Document contains AI self-reference: "${reference}"`);
      }
    }

    // Check for reasonable length
    if (result.data.resume.length < 500) {
      qualityIssues.push('Resume is suspiciously short (< 500 chars)');
    }

    if (result.data.coverLetter.length < 300) {
      qualityIssues.push('Cover letter is suspiciously short (< 300 chars)');
    }

    // Check for proper structure in resume
    if (!/##?\s*(experience|work|employment)/i.test(result.data.resume)) {
      qualityIssues.push('Resume may be missing experience section');
    }

    if (!/##?\s*(skills|technical)/i.test(result.data.resume)) {
      qualityIssues.push('Resume may be missing skills section');
    }
  }

  return {
    success: qualityIssues.length === 0,
    data: result.data,
    errors: [],
    qualityIssues,
  };
}

/**
 * Validate form field - check if it's an identity/compliance field
 */
export function isIdentityField(field: { name?: string; label?: string }): boolean {
  const context = `${field.name ?? ''} ${field.label ?? ''}`.toLowerCase();
  const identityPatterns = [
    /first[\s_-]?name|given[\s_-]?name|\bfname\b/i,
    /last[\s_-]?name|surname|family[\s_-]?name|\blname\b/i,
    /full[\s_-]?name|\bname\b/i,
    /e?[\s_-]?mail|email/i,
    /phone|tel|mobile|cell/i,
    /location|city|address/i,
  ];

  return identityPatterns.some((pattern) => pattern.test(context));
}

/**
 * Validate that form fields don't have conflicting identity values
 */
export function validateFormFieldsConsistency(
  fields: FormField[],
  profile: Profile
): { valid: boolean; conflicts: string[] } {
  const conflicts: string[] = [];

  for (const field of fields) {
    if (!field.value) continue;

    if (isIdentityField(field)) {
      const fieldContext = `${field.name ?? ''} ${field.label ?? ''}`.toLowerCase();

      // Check email consistency
      if (/e?[\s_-]?mail|email/i.test(fieldContext)) {
        if (field.value.toLowerCase() !== profile.email.toLowerCase()) {
          conflicts.push(`Email mismatch: form has "${field.value}", profile has "${profile.email}"`);
        }
      }

      // Check name consistency (simplified)
      if (/first[\s_-]?name|given[\s_-]?name/i.test(fieldContext)) {
        const profileFirstName = profile.name.split(' ')[0]?.toLowerCase();
        if (profileFirstName && field.value.toLowerCase() !== profileFirstName) {
          conflicts.push(
            `First name mismatch: form has "${field.value}", profile has "${profileFirstName}"`
          );
        }
      }
    }
  }

  return {
    valid: conflicts.length === 0,
    conflicts,
  };
}
