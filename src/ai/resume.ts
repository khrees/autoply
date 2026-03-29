import type { AIProvider } from '../types';
import type { Profile, JobData } from '../types';

const RESUME_SYSTEM_PROMPT = `You create clean, ATS-friendly resumes that position candidates strongly for specific roles.

## CRITICAL: OUTPUT FORMAT
- Output ONLY the resume content in markdown format
- NEVER ask for more information
- NEVER explain what you're doing
- NEVER add introductory or concluding remarks
- If job details are incomplete, still generate the best resume possible using the candidate's profile
- Always produce a complete, ready-to-use resume

## Formatting Rules (STRICT)
- Use markdown with clear visual hierarchy
- **Bold** for section headers and job titles only
- Use horizontal rules (---) to separate major sections
- No fancy formatting, icons, or decorative elements
- Single column layout, easy to scan
- Consistent spacing throughout

## Section Order
1. Name & Contact (one line: email | phone | location | linkedin)
2. Skills (one line of comma-separated skills tailored to job requirements)
3. Experience (most relevant first)
4. Education (brief - just degree, school, year)

## Job Title Optimization
Rewrite job titles to better match the target role while staying truthful to the actual work:
- "Technical Product Specialist" → "Developer Experience Engineer" or "Technical Support Engineer"
- "Fullstack Engineer" → "Software Engineer"
- "Junior Developer" → "Software Developer"
- Match the seniority and terminology the target company uses

## Experience Bullets
- Lead with strong action verbs and quantified impact
- Show initiative, ownership, and results
- Frame accomplishments confidently - you did good work, show it
- 3-4 bullets per role, most impactful first
- Incorporate relevant keywords from job description naturally

## Strategic Presentation
- Round experience favorably (3 years → 3+ years, 3.5 years → 4 years)
- Emphasize transferable skills that match requirements
- Present the candidate as someone who takes initiative and delivers
- Keep education minimal - degree, institution, graduation year only
- Skills section should mirror the job requirements closely

## Using the Candidate's Existing Resume
If the candidate provides an existing resume, treat it as the primary source of truth for their voice, phrasing, and content. Your job is to tailor it for the target role — not rewrite it from scratch. Pull in additional details from the structured profile only if they strengthen the application. Preserve their writing style and any specifics (metrics, project names, etc.) from the original.

Output clean markdown ready for PDF conversion.`;

export async function tailorResume(
  provider: AIProvider,
  profile: Profile,
  jobData: JobData
): Promise<string> {
  const prompt = buildResumePrompt(profile, jobData);
  return provider.generateText(prompt, RESUME_SYSTEM_PROMPT);
}

function buildResumePrompt(profile: Profile, jobData: JobData): string {
  return `Please tailor the following resume for the job posting below.

## Candidate Profile

**Name:** ${profile.name}
**Email:** ${profile.email}
${profile.phone ? `**Phone:** ${profile.phone}` : ''}
${profile.location ? `**Location:** ${profile.location}` : ''}
${profile.linkedin_url ? `**LinkedIn:** ${profile.linkedin_url}` : ''}
${profile.github_url ? `**GitHub:** ${profile.github_url}` : ''}
${profile.portfolio_url ? `**Portfolio:** ${profile.portfolio_url}` : ''}

### Skills
${profile.skills.join(', ')}

### Experience
${profile.experience
  .map(
    (exp) => `
**${exp.title}** at ${exp.company}
${exp.location ? `${exp.location} | ` : ''}${exp.start_date} - ${exp.end_date ?? 'Present'}
${exp.description ?? ''}
${exp.highlights.length > 0 ? exp.highlights.map((h) => `- ${h}`).join('\n') : ''}
`
  )
  .join('\n')}

### Education
${profile.education
  .map(
    (edu) => `
**${edu.degree}**${edu.field ? ` in ${edu.field}` : ''} - ${edu.institution}
${edu.start_date ?? ''} - ${edu.end_date ?? ''}
${edu.gpa ? `GPA: ${edu.gpa}` : ''}
`
  )
  .join('\n')}

${profile.base_resume ? `### Candidate's Existing Resume\nThe candidate has provided their own resume below. Use this as the primary reference for tone, structure, and content. Tailor it for the target job by emphasizing relevant experience and skills, rewriting bullets to match job requirements, and optimizing job titles — but preserve the candidate's voice and any details not found in the structured profile above.\n\n${profile.base_resume}` : ''}

---

## Job Posting

**Position:** ${jobData.title}
**Company:** ${jobData.company}
${jobData.location ? `**Location:** ${jobData.location}` : ''}
${jobData.job_type ? `**Type:** ${jobData.job_type}` : ''}

### Description
${jobData.description || 'Not provided'}

### Requirements
${jobData.requirements.length > 0 ? jobData.requirements.map((r) => `- ${r}`).join('\n') : 'Not provided'}

### Qualifications
${jobData.qualifications.length > 0 ? jobData.qualifications.map((q) => `- ${q}`).join('\n') : 'Not provided'}

---

IMPORTANT: Even if job details are incomplete or "Not provided", you MUST still generate a complete resume using the candidate's profile. Tailor it to the target role based on what's available. Do NOT ask for more information - just generate the best resume possible.

Generate a tailored resume following this exact structure:

**[FULL NAME]**
email@example.com | (123) 456-7890 | City, Country | linkedin.com/in/username

---

**Skills**
Skill1, Skill2, Skill3, Skill4, Skill5 (match these to job requirements)

---

**Experience**

**[Optimized Job Title]** | Company Name | Date - Date
- Achievement with quantified impact
- Achievement showing initiative and ownership
- Achievement with relevant keywords

(Repeat for each role, most relevant first)

---

**Education**
Degree, Institution, Year

---

Remember:
- Rewrite job titles to align with target role (e.g., "Fullstack Engineer" → "Software Engineer")
- Round experience duration favorably
- Keep it to one page worth of content
- Skills should closely match job requirements
- Show the candidate as someone who drives results`;
}

export async function generateResumeForMultipleJobs(
  provider: AIProvider,
  profile: Profile,
  jobs: JobData[]
): Promise<Map<string, string>> {
  const results = new Map<string, string>();

  for (const job of jobs) {
    const resume = await tailorResume(provider, profile, job);
    results.set(job.url, resume);
  }

  return results;
}
