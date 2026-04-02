import type { AIProvider } from '../types';
import type { Profile } from '../types';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const CHAT_SYSTEM_PROMPT = `You are a career coach and interview prep assistant. Your goal is to help the user answer interview questions, behavioral questions, and career-related questions by drawing from their actual experience and background.

Guidelines:
- Answer in a storytelling format - use the STAR method (Situation, Task, Action, Result) naturally
- Be specific and concrete - use real examples from the user's experience
- Sound authentic and conversational, like talking to a supportive mentor
- Include specific metrics, numbers, and outcomes when available
- Don't make up experiences - only use what's in their profile
- If there's no relevant experience in their profile, acknowledge that and suggest how they might approach the question
- Keep answers comprehensive enough to be useful but not rambling
- Use their name to personalize the response
- Frame answers to highlight their strengths and growth
- If the conversation has prior context, build on it naturally rather than re-introducing yourself`;

export async function answerQuestionFromProfile(
  provider: AIProvider,
  profile: Profile,
  question: string,
  history: ChatMessage[] = []
): Promise<string> {
  const prompt = buildChatPrompt(profile, question, history);
  return provider.generateText(prompt, CHAT_SYSTEM_PROMPT);
}

function formatHistory(history: ChatMessage[]): string {
  if (history.length === 0) return '';
  const lines = history.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`);
  return `\n## Conversation So Far\n${lines.join('\n\n')}\n`;
}

function buildChatPrompt(profile: Profile, question: string, history: ChatMessage[]): string {
  return `The user "${profile.name}" is preparing for job interviews and has a question. Use ONLY the information from their profile below to craft your answer. Do not make up any experiences or details that aren't listed.
${formatHistory(history)}
## Current Question
${question}

---

## ${profile.name}'s Profile

### Skills
${profile.skills.join(', ')}

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

---

Based ONLY on the profile information above, craft a compelling answer to the current question. ${history.length > 0 ? 'The conversation history above provides context — reference it where relevant.' : ''} Use specific examples, metrics, and experiences from their background. Structure your response using storytelling - don't just list facts, but show how their experience prepared them for this type of question.

If the profile doesn't contain relevant information for this question, be honest about that but still provide helpful guidance on how they might approach answering it.`;
}
