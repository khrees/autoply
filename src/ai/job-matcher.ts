import type { AIProvider, Profile, JobData } from '../types';

export interface JobFitResult {
  score: number;
  reasoning: string;
  strongMatches: string[];
  missingSkills: string[];
  recommendation: 'strong' | 'good' | 'stretch' | 'skip';
}

const FIT_SYSTEM_PROMPT = `You evaluate how well a candidate matches a job posting. Return ONLY valid JSON, no markdown fences.

Schema:
{
  "score": 0-100,
  "reasoning": "1-2 sentence summary",
  "strongMatches": ["skill or qualification that matches well"],
  "missingSkills": ["required skill the candidate lacks"],
  "recommendation": "strong" | "good" | "stretch" | "skip"
}

Scoring guide:
- 80-100: Strong match, candidate meets most/all requirements
- 60-79: Good match, meets core requirements with some gaps
- 40-59: Stretch, significant gaps but transferable skills exist
- 0-39: Skip, fundamental mismatch

Be honest and practical. A senior role for a junior candidate is a skip. Missing a "nice-to-have" shouldn't tank the score.`;

export async function evaluateJobFit(
  provider: AIProvider,
  profile: Profile,
  jobData: JobData
): Promise<JobFitResult> {
  const prompt = `Evaluate this candidate's fit for the role.

## Candidate
Skills: ${profile.skills.join(', ')}
Experience: ${profile.experience
    .slice(0, 3)
    .map((e) => `${e.title} at ${e.company} (${e.start_date} - ${e.end_date ?? 'Present'})`)
    .join('; ')}
Education: ${profile.education.map((e) => `${e.degree}${e.field ? ' in ' + e.field : ''} - ${e.institution}`).join('; ')}

## Job
Title: ${jobData.title}
Company: ${jobData.company}
Description: ${jobData.description.slice(0, 2000)}
Requirements: ${jobData.requirements.slice(0, 10).join('; ')}
Qualifications: ${jobData.qualifications.slice(0, 10).join('; ')}`;

  const response = await provider.generateText(prompt, FIT_SYSTEM_PROMPT);
  const cleaned = response
    .replace(/```json?\n?/g, '')
    .replace(/```/g, '')
    .trim();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        score: 50,
        reasoning: 'Could not evaluate fit',
        strongMatches: [],
        missingSkills: [],
        recommendation: 'good',
      };
    }
    parsed = JSON.parse(jsonMatch[0]);
  }

  const score = Math.min(100, Math.max(0, Number(parsed.score) || 50));
  const recommendation = (
    ['strong', 'good', 'stretch', 'skip'].includes(String(parsed.recommendation))
      ? String(parsed.recommendation)
      : score >= 80
        ? 'strong'
        : score >= 60
          ? 'good'
          : score >= 40
            ? 'stretch'
            : 'skip'
  ) as JobFitResult['recommendation'];

  return {
    score,
    reasoning: String(parsed.reasoning || ''),
    strongMatches: Array.isArray(parsed.strongMatches) ? parsed.strongMatches.map(String) : [],
    missingSkills: Array.isArray(parsed.missingSkills) ? parsed.missingSkills.map(String) : [],
    recommendation,
  };
}
