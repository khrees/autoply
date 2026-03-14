// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { AIProvider, Profile, Experience, Education, Preferences } from '../types';

const EXTRACTION_SYSTEM_PROMPT = `You extract structured profile data from resumes. Return ONLY valid JSON, no markdown fences or extra text.

The JSON must match this exact schema:
{
  "name": "string",
  "email": "string",
  "phone": "string or null",
  "location": "string or null",
  "linkedin_url": "string or null",
  "github_url": "string or null",
  "portfolio_url": "string or null",
  "skills": ["string"],
  "experience": [
    {
      "company": "string",
      "title": "string",
      "location": "string or null",
      "start_date": "string",
      "end_date": "string or null",
      "description": "string or null",
      "highlights": ["string"]
    }
  ],
  "education": [
    {
      "institution": "string",
      "degree": "string",
      "field": "string or null",
      "start_date": "string or null",
      "end_date": "string or null",
      "gpa": "string or null"
    }
  ]
}

Rules:
- Extract ALL experience entries, not just the most recent
- For highlights, extract bullet points / achievements from each role
- Skills should be individual technologies, tools, and competencies — not sentences
- Dates should be in a readable format like "Jan 2022" or "2022"
- If a field isn't present in the resume, use null
- Return valid JSON only`;

export async function extractProfileFromResume(
  provider: AIProvider,
  resumeText: string
): Promise<Omit<Profile, 'id' | 'created_at' | 'updated_at' | 'base_resume' | 'base_cover_letter' | 'preferences'>> {
  const prompt = `Extract structured profile data from this resume:\n\n${resumeText}`;

  const response = await provider.generateText(prompt, EXTRACTION_SYSTEM_PROMPT);
  const cleaned = response.replace(/```json?\n?/g, '').replace(/```/g, '').trim();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Try to find JSON in the response
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('AI returned invalid JSON. Try again or use manual profile setup.');
    }
    parsed = JSON.parse(jsonMatch[0]);
  }

  return {
    name: String(parsed.name || ''),
    email: String(parsed.email || ''),
    phone: parsed.phone ? String(parsed.phone) : undefined,
    location: parsed.location ? String(parsed.location) : undefined,
    linkedin_url: parsed.linkedin_url ? String(parsed.linkedin_url) : undefined,
    github_url: parsed.github_url ? String(parsed.github_url) : undefined,
    portfolio_url: parsed.portfolio_url ? String(parsed.portfolio_url) : undefined,
    skills: Array.isArray(parsed.skills) ? parsed.skills.map(String) : [],
    experience: parseExperience(parsed.experience),
    education: parseEducation(parsed.education),
  };
}

function parseExperience(raw: unknown): Experience[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((exp: Record<string, unknown>) => ({
    company: String(exp.company || ''),
    title: String(exp.title || ''),
    location: exp.location ? String(exp.location) : undefined,
    start_date: String(exp.start_date || ''),
    end_date: exp.end_date ? String(exp.end_date) : undefined,
    description: exp.description ? String(exp.description) : undefined,
    highlights: Array.isArray(exp.highlights) ? exp.highlights.map(String) : [],
  }));
}

function parseEducation(raw: unknown): Education[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((edu: Record<string, unknown>) => ({
    institution: String(edu.institution || ''),
    degree: String(edu.degree || ''),
    field: edu.field ? String(edu.field) : undefined,
    start_date: edu.start_date ? String(edu.start_date) : undefined,
    end_date: edu.end_date ? String(edu.end_date) : undefined,
    gpa: edu.gpa ? String(edu.gpa) : undefined,
  }));
}
