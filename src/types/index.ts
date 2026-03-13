import { z } from 'zod';

// ============ Platform Types ============
export type Platform =
  | 'greenhouse'
  | 'linkedin'
  | 'lever'
  | 'jobvite'
  | 'smartrecruiters'
  | 'pinpoint'
  | 'teamtailor'
  | 'workday'
  | 'ashby'
  | 'bamboohr'
  | 'generic';

export const SUPPORTED_PLATFORMS: Record<Platform, RegExp> = {
  greenhouse: /(?:job-)?boards\.greenhouse\.io|[?&]gh_jid=|greenhouse\.io\/embed/,
  linkedin: /linkedin\.com\/jobs/,
  lever: /jobs\.lever\.co/,
  jobvite: /jobs\.jobvite\.com/,
  smartrecruiters: /jobs\.smartrecruiters\.com/,
  pinpoint: /\.pinpointhq\.com/,
  teamtailor: /\.teamtailor\.com/,
  workday: /\.myworkdayjobs\.com|workday\.com\/.*\/job/,
  ashby: /jobs\.ashbyhq\.com/,
  bamboohr: /\.bamboohr\.com\/careers/,
  generic: /.*/
};

// ============ Profile Schemas ============
export const PreferencesSchema = z.object({
  remote_only: z.boolean().default(false),
  min_salary: z.number().optional(),
  preferred_locations: z.array(z.string()).default([]),
  excluded_companies: z.array(z.string()).default([]),
  job_types: z.array(z.string()).default(['full-time']),
});

export const ExperienceSchema = z.object({
  company: z.string(),
  title: z.string(),
  location: z.string().optional(),
  start_date: z.string(),
  end_date: z.string().optional(),
  description: z.string().optional(),
  highlights: z.array(z.string()).default([]),
});

export const EducationSchema = z.object({
  institution: z.string(),
  degree: z.string(),
  field: z.string().optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  gpa: z.string().optional(),
});

export const ProfileSchema = z.object({
  id: z.number().optional(),
  name: z.string(),
  email: z.string().email(),
  phone: z.string().optional(),
  location: z.string().optional(),
  linkedin_url: z.string().url().optional(),
  github_url: z.string().url().optional(),
  portfolio_url: z.string().url().optional(),
  base_resume: z.string().optional(),
  base_cover_letter: z.string().optional(),
  preferences: PreferencesSchema.optional(),
  skills: z.array(z.string()).default([]),
  experience: z.array(ExperienceSchema).default([]),
  education: z.array(EducationSchema).default([]),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

export type Preferences = z.infer<typeof PreferencesSchema>;
export type Experience = z.infer<typeof ExperienceSchema>;
export type Education = z.infer<typeof EducationSchema>;
export type Profile = z.infer<typeof ProfileSchema>;

// ============ Application Types ============
export type ApplicationStatus = 'pending' | 'filled' | 'submitted' | 'failed';

export interface Application {
  id?: number;
  profile_id: number;
  url: string;
  platform: Platform;
  company: string;
  job_title: string;
  status: ApplicationStatus;
  generated_resume?: string;
  generated_cover_letter?: string;
  form_data?: Record<string, unknown>;
  error_message?: string;
  applied_at?: string;
  created_at?: string;
}

// ============ Job Data Types ============
export interface JobData {
  url: string;
  platform: Platform;
  title: string;
  company: string;
  description: string;
  requirements: string[];
  qualifications: string[];
  location?: string;
  salary?: string;
  job_type?: string;
  remote?: boolean;
  form_fields: FormField[];
  custom_questions: CustomQuestion[];
}

export interface FormField {
  name: string;
  type: 'text' | 'email' | 'tel' | 'select' | 'textarea' | 'file' | 'checkbox' | 'radio';
  label: string;
  required: boolean;
  options?: string[];
  value?: string;
}

export interface CustomQuestion {
  id: string;
  question: string;
  type: 'text' | 'textarea' | 'select' | 'radio' | 'checkbox';
  required: boolean;
  options?: string[];
  answer?: string;
}

// ============ AI Provider Types ============
export type AIProviderType = 'openai' | 'anthropic' | 'google' | 'ollama' | 'lmstudio';

export interface AIConfig {
  provider: AIProviderType;
  model: string;
  baseUrl?: string;
  temperature?: number;
}

export interface AIProvider {
  name: AIProviderType;
  generateText(prompt: string, systemPrompt?: string): Promise<string>;
  isAvailable(): Promise<boolean>;
}

export interface GeneratedDocuments {
  resume: string;
  coverLetter: string;
}

// ============ Configuration Types ============
export interface AppConfig {
  ai: AIConfig;
  browser: {
    headless: boolean;
    timeout: number;
    storageState?: string;
    engine: 'playwright' | 'patchright';
    reuseSessions: boolean;
    maxOpenPagesPerBrowser: number;
    retireBrowserAfterPageCount: number;
    closeInactiveBrowserAfterMillis: number;
    patchrightHosts: string[];
    patchrightPlatforms: Platform[];
  };
  application: {
    autoSubmit: boolean;
    saveScreenshots: boolean;
    retryAttempts: number;
    /** Delay in seconds between applications in bulk mode (0 = no delay) */
    rateLimitDelay: number;
    minFitScore?: number;
    /** When true, fill non-required fields instead of leaving them blank */
    fillOptionalFields: boolean;
    /** When true, prompt user for fields that can't be auto-filled or AI-answered */
    interactivePrompts: boolean;
  };
  /** Cached answers for form fields the user has previously provided manually */
  cachedAnswers?: Record<string, string>;
}

export const DEFAULT_CONFIG: AppConfig = {
  ai: {
    provider: 'ollama',
    model: 'llama3.2',
    baseUrl: 'http://localhost:11434',
    temperature: 0.7,
  },
  browser: {
    headless: false,
    timeout: 30000,
    engine: 'playwright',
    reuseSessions: true,
    maxOpenPagesPerBrowser: 2,
    retireBrowserAfterPageCount: 25,
    closeInactiveBrowserAfterMillis: 30000,
    patchrightHosts: [],
    patchrightPlatforms: [],
  },
  application: {
    autoSubmit: false,
    saveScreenshots: true,
    retryAttempts: 3,
    rateLimitDelay: 0,
    fillOptionalFields: false,
    interactivePrompts: true,
  },
};

// ============ Queue Types ============
export interface QueueItem {
  id: string;
  url: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
  result?: Application;
}

// ============ CLI Types ============
export interface ApplyOptions {
  file?: string;
  dryRun?: boolean;
}

export interface GenerateOptions {
  output?: string;
}

export interface HistoryOptions {
  status?: ApplicationStatus;
  company?: string;
}
