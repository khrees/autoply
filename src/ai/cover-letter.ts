import type { AIProvider } from '../types';
import type { Profile, JobData } from '../types';

const COVER_LETTER_SYSTEM_PROMPT = `You are a cover letter writer who crafts warm, human, and passionate letters. Your goal is to help the candidate stand out by showing who they truly are - not just what they can do.

Writing style guidelines:
- Write like a real person, not a corporate template
- Lead with genuine excitement and curiosity about the role
- Focus on impact and stories, not technical jargon or buzzwords
- Show heart - let the candidate's passion and drive shine through
- Avoid emdashes as much as possible
- Subtly weave in the candidate's unique perspective as someone bringing diverse global experience
- Keep it conversational yet professional
- Be confident but humble, ambitious but grounded
- 3-4 short paragraphs maximum - every sentence should earn its place

Avoid:
- Stiff, formal language ("I am writing to express my interest...")
- Listing skills or technologies - the resume does that
- Generic flattery about the company
- Overused phrases like "passionate about", "excited to", "leverage my skills"

The best cover letters feel like the start of a conversation, not a sales pitch.

## Using the Candidate's Existing Cover Letter
If the candidate provides an existing cover letter, treat it as the primary reference for their voice, tone, and personal narrative. Adapt it for the specific role and company rather than writing from scratch. Preserve their storytelling style and any personal anecdotes — just redirect them toward this opportunity.`;

export async function generateCoverLetter(
  provider: AIProvider,
  profile: Profile,
  jobData: JobData
): Promise<string> {
  const prompt = buildCoverLetterPrompt(profile, jobData);
  return provider.generateText(prompt, COVER_LETTER_SYSTEM_PROMPT);
}

function buildCoverLetterPrompt(profile: Profile, jobData: JobData): string {
  return `Please write a cover letter for the following job application.

## Candidate Profile

**Name:** ${profile.name}
**Email:** ${profile.email}
${profile.location ? `**Location:** ${profile.location}` : ''}

### Summary of Qualifications
${profile.skills.slice(0, 10).join(', ')}

### Recent Experience
${profile.experience
  .slice(0, 3)
  .map(
    (exp) => `
**${exp.title}** at ${exp.company} (${exp.start_date} - ${exp.end_date ?? 'Present'})
${exp.description ?? ''}
Key achievements: ${exp.highlights.slice(0, 3).join('; ')}
`
  )
  .join('\n')}

${profile.base_cover_letter ? `### Candidate's Existing Cover Letter\nThe candidate has provided their own cover letter below. Use this as the primary reference for tone, writing style, and personal narrative. Adapt it for the target role by connecting the candidate's story to this specific company and position, but preserve their authentic voice and any personal anecdotes or perspectives.\n\n${profile.base_cover_letter}` : ''}

---

## Job Posting

**Position:** ${jobData.title}
**Company:** ${jobData.company}
${jobData.location ? `**Location:** ${jobData.location}` : ''}

### Description
${jobData.description}

### Key Requirements
${jobData.requirements
  .slice(0, 5)
  .map((r) => `- ${r}`)
  .join('\n')}

---

Write a cover letter that:
1. Opens with something genuine - what specifically draws them to this role or company? Make it personal, not generic
2. Tells a brief story or two that shows their impact - focus on the human side, not technical details
3. Connects their journey and perspective to why this opportunity matters to them
4. Closes warmly with a clear next step

Remember: This person brings a unique perspective shaped by their background and experiences. Let that authenticity come through naturally - it's a strength, not something to hide. Write something that could only come from this specific person.`;
}

export async function answerApplicationQuestion(
  provider: AIProvider,
  profile: Profile,
  jobData: JobData,
  question: string,
  options?: { type?: string; choices?: string[] }
): Promise<string> {
  const systemPrompt = `You help job applicants answer application questions in a warm, authentic voice.

Guidelines:
- Sound like a real person, not a template
- Draw from actual experiences with specific examples
- Be honest and genuine - don't oversell
- Keep answers focused and appropriately brief
- Show personality and enthusiasm without being over the top
- Avoid corporate buzzwords and jargon
- For select/radio/dropdown questions: return EXACTLY one of the provided options, nothing else
- For checkbox questions: return matching options separated by commas`;

  let questionDetail = `"${question}"`;
  if (options?.choices && options.choices.length > 0) {
    questionDetail += `\nAvailable options: ${options.choices.join(', ')}`;
    questionDetail += `\nIMPORTANT: Your answer must be exactly one of the above options.`;
  }

  const prompt = `Based on the following candidate profile and job posting, please answer this application question:

## Question
${questionDetail}

## Candidate Profile
Name: ${profile.name}
Skills: ${profile.skills.join(', ')}
Recent Experience:
${profile.experience
  .slice(0, 2)
  .map((exp) => `- ${exp.title} at ${exp.company}: ${exp.description ?? exp.highlights.join(', ')}`)
  .join('\n')}

## Job
${jobData.title} at ${jobData.company}
${jobData.description.slice(0, 500)}...

Please provide a concise, relevant answer to the question.`;

  return provider.generateText(prompt, systemPrompt);
}

import type { CustomQuestion } from '../types';

export async function answerAllQuestions(
  provider: AIProvider,
  profile: Profile,
  jobData: JobData,
  questions: CustomQuestion[],
  previousAnswers?: Array<{ question: string; answer: string }>
): Promise<Map<string, string>> {
  if (questions.length === 0) return new Map();

  // For a single question, use the direct approach
  if (questions.length === 1) {
    const q = questions[0];
    const answer = await answerApplicationQuestion(provider, profile, jobData, q.question, {
      type: q.type,
      choices: q.options,
    });
    return new Map([[q.question, answer]]);
  }

  // Batch all questions into one call for consistency
  const systemPrompt = `You answer job application questions for a candidate. Return ONLY valid JSON — an array of objects with "question" and "answer" fields.

Rules:
- For select/radio/dropdown questions with options listed: answer must be EXACTLY one of the provided options
- For text/textarea questions: give a concise, authentic answer (2-4 sentences)
- Keep answers consistent with each other (don't contradict across questions)
- Sound human, not robotic
- Draw from the candidate's actual experience`;

  const questionsBlock = questions
    .map((q, i) => {
      let block = `${i + 1}. "${q.question}" (type: ${q.type})`;
      if (q.options && q.options.length > 0) {
        block += `\n   Options: ${q.options.join(', ')}`;
      }
      return block;
    })
    .join('\n');

  const examplesBlock =
    previousAnswers && previousAnswers.length > 0
      ? `\n## Examples of how this candidate has answered questions before:\n${previousAnswers
          .slice(0, 5)
          .map((a) => `Q: "${a.question}"\nA: "${a.answer}"`)
          .join('\n\n')}\n`
      : '';

  const prompt = `Answer these application questions for the candidate.

## Candidate
Name: ${profile.name}
Skills: ${profile.skills.join(', ')}
Experience: ${profile.experience
    .slice(0, 3)
    .map((e) => `${e.title} at ${e.company}: ${e.highlights.slice(0, 2).join('; ')}`)
    .join(' | ')}
${examplesBlock}
## Job
${jobData.title} at ${jobData.company}
${jobData.description.slice(0, 1000)}

## Questions
${questionsBlock}

Return JSON array: [{"question": "...", "answer": "..."}, ...]`;

  const response = await provider.generateText(prompt, systemPrompt);
  const cleaned = response
    .replace(/```json?\n?/g, '')
    .replace(/```/g, '')
    .trim();

  const results = new Map<string, string>();

  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (item.question && item.answer) {
          results.set(String(item.question), String(item.answer));
        }
      }
    }
  } catch {
    // Fallback: answer each question individually
    for (const q of questions) {
      const answer = await answerApplicationQuestion(provider, profile, jobData, q.question, {
        type: q.type,
        choices: q.options,
      });
      results.set(q.question, answer);
    }
  }

  // Fill any missing answers individually
  for (const q of questions) {
    if (!results.has(q.question)) {
      const answer = await answerApplicationQuestion(provider, profile, jobData, q.question, {
        type: q.type,
        choices: q.options,
      });
      results.set(q.question, answer);
    }
  }

  return results;
}
