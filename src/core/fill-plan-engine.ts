import type { Profile, JobData, AIProvider } from '../types';

export class FillPlanEngine {
  /**
   * Maps a set of detected form fields to the best possible values from a user profile.
   * Uses a combination of deterministic mapping and AI fallback.
   */
  static async createFillPlan(
    profile: Profile,
    detectedFields: Array<{ key: string; type: string; label: string }>,
    jobData: JobData,
    aiProvider: AIProvider
  ): Promise<Record<string, string>> {
    const fillPlan: Record<string, string> = {};
    const profileData = this.extractProfileData(profile);

    // 1. Deterministic Matching
    for (const field of detectedFields) {
      const fieldKey = field.key || field.label;
      const value = this.matchFieldToProfile(field, profileData, profile);
      if (value) {
        fillPlan[fieldKey] = value;
      }
    }

    // 2. AI-Powered Answer Generation for Custom Questions
    if (jobData.custom_questions && jobData.custom_questions.length > 0) {
      const unanswered = jobData.custom_questions.filter((q) => !q.answer);

      if (unanswered.length > 0) {
        // We delegate the bulk answering to the AI provider
        // but the coordination happens here.
        const answers = await this.generateAIAnswers(aiProvider, profile, jobData, unanswered);
        for (const [question, answer] of Object.entries(answers)) {
          fillPlan[question] = answer;
        }
      }
    }

    return fillPlan;
  }

  private static extractProfileData(profile: Profile): Record<string, string> {
    return {
      firstName: profile.name.split(' ')[0] || '',
      lastName: profile.name.split(' ').slice(1).join(' ') || '',
      fullName: profile.name,
      email: profile.email,
      phone: profile.phone || '',
      location: profile.location || '',
      linkedin: profile.linkedin_url || '',
      github: profile.github_url || '',
      portfolio: profile.portfolio_url || '',
    };
  }

  private static matchFieldToProfile(
    field: { key: string; type: string; label: string },
    profileData: Record<string, string>,
    _profile: Profile
  ): string | null {
    const fieldKey = (field.key || field.label).toLowerCase().replace(/[^a-z0-9]/g, '');

    for (const [pKey, pValue] of Object.entries(profileData)) {
      const normPKey = pKey.toLowerCase().replace(/[^a-z0-9]/g, '');
      if ((fieldKey.includes(normPKey) || normPKey.includes(fieldKey)) && pValue) {
        return pValue;
      }
    }

    // If no direct match, use basic deterministic logic for common types
    if (field.type === 'select' || field.type === 'radio') {
      // Logic for selecting options based on profile could go here
    }

    return null;
  }

  private static async generateAIAnswers(
    _aiProvider: AIProvider,
    _profile: Profile,
    _jobData: JobData,
    _questions: unknown[]
  ): Promise<Record<string, string>> {
    // This is a placeholder for the actual AI call logic found in ai/cover-letter.ts
    // To keep it clean, the Orchestrator will pass this to the AI provider.
    return {};
  }
}
