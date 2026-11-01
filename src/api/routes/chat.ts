import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { profileRepository } from '../../db/repositories/profile';
import { createAIProvider } from '../../ai/provider';
import { fetchProfileLinksContext, fetchJobUrlContext } from '../../utils/link-context-fetcher';
import type { Profile } from '../../types';

const ChatRequestSchema = z.object({
  url: z.string().optional(),
  messages: z.array(
    z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string(),
    })
  ),
});

function formatProfileForPrompt(profile: Profile): string {
  const parts = [];

  if (profile.name) parts.push(`Name: ${profile.name}`);
  if (profile.email) parts.push(`Email: ${profile.email}`);
  if (profile.phone) parts.push(`Phone: ${profile.phone}`);
  if (profile.location) parts.push(`Location: ${profile.location}`);
  if (profile.linkedin_url) parts.push(`LinkedIn URL: ${profile.linkedin_url}`);
  if (profile.github_url) parts.push(`GitHub URL: ${profile.github_url}`);
  if (profile.portfolio_url) parts.push(`Portfolio URL: ${profile.portfolio_url}`);

  if (profile.skills && profile.skills.length > 0) {
    parts.push(`Skills:\n- ${profile.skills.join('\n- ')}`);
  }

  if (profile.experience && profile.experience.length > 0) {
    parts.push('Experience:');
    profile.experience.forEach((exp) => {
      parts.push(
        `- ${exp.title} at ${exp.company} (${exp.start_date} - ${exp.end_date || 'Present'})\n  ${exp.description || ''}`
      );
    });
  }

  if (profile.education && profile.education.length > 0) {
    parts.push('Education:');
    profile.education.forEach((edu) => {
      parts.push(
        `- ${edu.degree} in ${edu.field || ''} from ${edu.institution} (${edu.start_date || ''} - ${edu.end_date || ''})`
      );
    });
  }

  if (profile.base_resume) {
    parts.push(`Base Resume:\n${profile.base_resume}`);
  }

  if (profile.base_cover_letter) {
    parts.push(`Base Cover Letter:\n${profile.base_cover_letter}`);
  }

  return parts.join('\n\n');
}

export function registerChatRoutes(app: FastifyInstance): void {
  app.post('/chat', async (request, reply) => {
    try {
      const parsedBody = ChatRequestSchema.safeParse(request.body);
      if (!parsedBody.success) {
        return reply.status(400).send({
          success: false,
          error: 'Invalid request body',
          details: parsedBody.error.errors,
        });
      }

      const { messages, url } = parsedBody.data;

      // Extract URLs from current active tab or user messages
      const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
      const messageUrlMatch = lastUserMsg.match(/https?:\/\/[^\s]+/i);
      const targetUrl = url || (messageUrlMatch ? messageUrlMatch[0] : undefined);

      // Fetch live job context if a URL is active/provided
      let jobContext = '';
      if (targetUrl) {
        jobContext = await fetchJobUrlContext(targetUrl);
      }

      // Load user profile
      const profile = profileRepository.findFirst();
      let profileContext = 'No profile data available.';
      if (profile) {
        profileContext = formatProfileForPrompt(profile);
        const linkContext = await fetchProfileLinksContext(profile);
        if (linkContext) {
          profileContext += linkContext;
        }
      }

      if (jobContext) {
        profileContext = `${jobContext}\n\n${profileContext}`;
      }

      const systemPrompt = `You are Autoply Assistant, a career coach and job application helper. You have access to the user's complete professional profile (including portfolio, GitHub, and LinkedIn details) and the active job posting page (if provided).

STRICT RESPONSE RULES:
1. BREVITY & CONCISENESS: Be extremely direct and concise. NO fluff, preamble, greetings, filler text, or conversational intros/outros (e.g. "Sure!", "Here is a summary", "Let me know if you need help"). Jump straight to the point.
2. ZERO HALLUCINATION: Rely ONLY on facts explicitly stated in the active job context, profile, and link context below. Do NOT invent, assume, or hallucinate any job requirements, company details, skills, experience, or metrics not present in the context. If information is missing, state briefly that it is not in the context.
3. CLEAR FORMATTING: Use clean, well-structured Markdown (lists, bold text, code blocks) for readability.

Here is the context:
${profileContext}`;

      const conversationText = messages
        .map((msg) => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
        .join('\n\n');

      const prompt = `${conversationText}\n\nAssistant:`;

      const ai = createAIProvider();
      const response = await ai.generateText(prompt, systemPrompt);

      return { reply: response };
    } catch (error) {
      app.log.error(error);
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Internal Server Error',
      });
    }
  });
}
