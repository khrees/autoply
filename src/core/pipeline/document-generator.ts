import type { Profile, JobData, GeneratedDocuments } from '../../types';
import type { AIProvider } from '../../ai/provider';
import { tailorResume } from '../../ai/resume';
import { generateCoverLetter } from '../../ai/cover-letter';
import { validateGeneratedDocuments } from '../../utils/validation';
import { logger, createSpinner } from '../../utils/logger';

export type GenerateDocsResult =
  | { success: true; documents: GeneratedDocuments; qualityIssues?: string[] }
  | { success: false; error: string };

/**
 * Pipeline step 3: Generate resume and cover letter using AI.
 */
export async function generateApplicationDocuments(
  provider: AIProvider,
  profile: Profile,
  jobData: JobData,
  jobTitle: string,
  company: string,
  url: string,
  platform: string,
  spinner: ReturnType<typeof createSpinner>
): Promise<GenerateDocsResult> {
  try {
    const isAvailable = await provider.isAvailable();
    if (!isAvailable) {
      spinner.fail('AI provider not available');
      return {
        success: false,
        error: `AI provider is not available. Check your AI provider is running.`,
      };
    }

    spinner.start('Generating resume and cover letter...');
    const [resume, coverLetter] = await Promise.all([
      tailorResume(provider, profile, jobData),
      generateCoverLetter(provider, profile, jobData),
    ]);
    spinner.succeed('Resume and cover letter generated');

    const documents: GeneratedDocuments = { resume, coverLetter };

    // Quality gate — warn on issues, don't hard-fail
    const docCheck = validateGeneratedDocuments(documents, { checkQuality: true });
    if (docCheck.qualityIssues && docCheck.qualityIssues.length > 0) {
      logger.warn('Generated documents have quality issues', { issues: docCheck.qualityIssues }, 'ai');
      for (const issue of docCheck.qualityIssues) {
        spinner.warn(`Quality check: ${issue}`);
      }
      return { success: true, documents, qualityIssues: docCheck.qualityIssues };
    }

    return { success: true, documents };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    spinner.fail(`Document generation failed for ${url}`);
    return {
      success: false,
      error: `[${platform}] AI generation failed: ${msg}. Check your AI provider is running ("ollama serve" or set OPENAI_API_KEY / ANTHROPIC_API_KEY).`,
    };
  }
}
