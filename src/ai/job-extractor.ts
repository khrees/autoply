import type { AIProvider, JobData } from '../types';

const EXTRACTION_SYSTEM_PROMPT = `You extract job posting data from raw HTML content. Return ONLY valid JSON, no markdown.

Schema:
{
  "title": "Job title",
  "company": "Company name",
  "location": "Location or remote status",
  "description": "Full job description text (cleaned, no HTML)",
  "requirements": ["Required skill or qualification"],
  "qualifications": ["Nice-to-have or preferred qualification"],
  "salary": "Salary range if mentioned",
  "job_type": "full-time, part-time, contract, etc."
}

Rules:
- Extract the actual job title, not the page title
- Clean HTML tags from description
- Split requirements into individual items
- If a field isn't present, omit it or use null
- Be thorough with requirements - extract from bullet points, paragraphs, etc.`;

export interface ExtractedJobData {
  title?: string;
  company?: string;
  location?: string;
  description?: string;
  requirements?: string[];
  qualifications?: string[];
  salary?: string;
  job_type?: string;
}

export async function extractJobDataWithAI(
  provider: AIProvider,
  rawHtml: string,
  url: string
): Promise<Partial<JobData>> {
  // Strip scripts and styles to save tokens and focus on content
  const cleanedHtml = rawHtml
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '')
    .substring(0, 30000); // Increased window but with cleaner text

  const prompt = `Extract job posting data from this page HTML.
  
URL: ${url}

HTML Content:
${cleanedHtml}`;

  const response = await provider.generateText(prompt, EXTRACTION_SYSTEM_PROMPT);

  const cleaned = response.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
  const parsed: ExtractedJobData = JSON.parse(cleaned);

  const result: Partial<JobData> = {};

  if (parsed.title) result.title = parsed.title;
  if (parsed.company) result.company = parsed.company;
  if (parsed.location) result.location = parsed.location;
  if (parsed.description) result.description = parsed.description;
  if (parsed.requirements) result.requirements = parsed.requirements;
  if (parsed.qualifications) result.qualifications = parsed.qualifications;
  if (parsed.salary) result.salary = parsed.salary;
  if (parsed.job_type) result.job_type = parsed.job_type;

  return result;
}

export function mergeJobData(existing: JobData, extracted: Partial<JobData>): JobData {
  return {
    ...existing,
    title: shouldReplace(existing.title, 'Unknown Position') ? (extracted.title ?? existing.title) : existing.title,
    company: shouldReplace(existing.company, '') ? (extracted.company ?? existing.company) : existing.company,
    description: shouldReplace(existing.description, '') ? (extracted.description ?? existing.description) : existing.description,
    requirements: existing.requirements.length === 0 ? (extracted.requirements ?? []) : existing.requirements,
    qualifications: existing.qualifications.length === 0 ? (extracted.qualifications ?? []) : existing.qualifications,
    location: existing.location ?? extracted.location,
    salary: existing.salary ?? extracted.salary,
    job_type: existing.job_type ?? extracted.job_type,
  };
}

function shouldReplace(current: string | undefined, emptyValue: string): boolean {
  return !current || current === emptyValue || current.trim() === '';
}
