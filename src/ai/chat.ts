import type { AIProvider } from '../types';
import type { Profile } from '../types';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const CHAT_SYSTEM_PROMPT = `You are an elite career coach and interview preparation expert with 20+ years of experience in executive recruiting. Your goal is to help the user craft high-impact interview answers by drawing ONLY from their actual experience and background.

## CORE PERSONA
- Professional, encouraging, and strategic.
- You don't just list facts; you frame experiences as "value propositions."
- You are an expert in the STAR method (Situation, Task, Action, Result).

## STRICT RESPONSE RULES
1. BREVITY & CONCISENESS: Be direct. NO fluff, preamble, greetings, filler text, or conversational intros/outros (e.g. "Sure!", "Here is an answer"). Jump straight to the response.
2. ZERO HALLUCINATION: Rely ONLY on facts explicitly stated in the profile and link context. Do NOT invent skills, metrics, or company names. If information is missing, state briefly: "This detail is not in your profile."
3. VALUE-DRIVEN STORYTELLING: When drafting answers, use the STAR method. Focus on "Action" and "Result" (the 'how' and the 'impact'). Quantify results whenever possible using data from the profile.
4. FORMATTING: Use clean Markdown (bullet points for actions, bolding for key metrics, headings for structure).

## EXAMPLE OF QUALITY
Bad: "I managed a team and we increased sales."
Good: "In my role as [Title] at [Company], I led a team of 5 to implement [X], resulting in a 20% increase in quarterly sales ($2M) within 6 months."`;

export async function answerQuestionFromProfile(
  provider: AIProvider,
  profile: Profile,
  question: string,
  history: ChatMessage[] = [],
  linkContext: string = ''
): Promise<string> {
  const prompt = buildChatPrompt(profile, question, linkContext);
  return provider.generateText(prompt, CHAT_SYSTEM_PROMPT, history);
}

function buildChatPrompt(profile: Profile, question: string, linkContext: string = ''): string {
  return `The user "${profile.name}" is preparing for job interviews. Use ONLY the information from their profile, resume, and external links below to craft your answer. Do not make up any experiences or details that aren't listed.

## ${profile.name}'s Profile

${profile.email ? `Email: ${profile.email}` : ''}
${profile.phone ? `Phone: ${profile.phone}` : ''}
${profile.location ? `Location: ${profile.location}` : ''}
${profile.linkedin_url ? `LinkedIn: ${profile.linkedin_url}` : ''}
${profile.github_url ? `GitHub: ${profile.github_url}` : ''}
${profile.portfolio_url ? `Portfolio: ${profile.portfolio_url}` : ''}

### Skills
${profile.skills.length > 0 ? profile.skills.join(', ') : 'None listed.'}

### Work Experience
${
  profile.experience.length > 0
    ? profile.experience
        .map(
          (exp) => `
**${exp.title}** at ${exp.company}
${exp.start_date} - ${exp.end_date ?? 'Present'}
${exp.location ? `Location: ${exp.location}` : ''}
${exp.description ? `Description: ${exp.description}` : ''}
${exp.highlights.length > 0 ? `Key highlights: ${exp.highlights.join('; ')}` : ''}
`
        )
        .join('\n')
    : 'No work experience listed in profile.'
}

### Education
${
  profile.education.length > 0
    ? profile.education
        .map(
          (edu) => `
**${edu.degree}**${edu.field ? ` in ${edu.field}` : ''}
${edu.institution}
${edu.start_date ?? ''} - ${edu.end_date ?? ''}
${edu.gpa ? `GPA: ${edu.gpa}` : ''}
`
        )
        .join('\n')
    : 'No education listed in profile.'
}

${profile.base_resume ? `### Base Resume\n${profile.base_resume}\n` : ''}
${profile.base_cover_letter ? `### Base Cover Letter\n${profile.base_cover_letter}\n` : ''}
${linkContext ? `### External Links & Portfolio Context\n${linkContext}\n` : ''}

---

Based ONLY on the profile and link information above, craft a compelling answer to the current question. Use specific examples, metrics, and experiences from their background. Structure your response using storytelling - don't just list facts, but show how their experience prepared them for this type of question.

If the profile doesn't contain relevant information for this question, be honest about that but still provide helpful guidance on how they might approach answering it.`;
}
