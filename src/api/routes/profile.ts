import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { profileRepository } from '../../db/repositories/profile';
import { createAIProvider } from '../../ai/provider';

const ProfileBodySchema = z.object({
  id: z.number().optional(),
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  location: z.string().optional(),
  linkedin_url: z.string().url().optional().or(z.literal('')),
  github_url: z.string().url().optional().or(z.literal('')),
  portfolio_url: z.string().url().optional().or(z.literal('')),
  base_resume: z.string().optional(),
  base_cover_letter: z.string().optional(),
  preferences: z.record(z.unknown()).optional(),
  skills: z.array(z.string()).optional(),
  experience: z.array(z.record(z.unknown())).optional(),
  education: z.array(z.record(z.unknown())).optional(),
});

export function registerProfileRoutes(app: FastifyInstance): void {
  // Get profile
  app.get('/profile', async () => {
    const profile = profileRepository.findFirst();
    if (!profile) return { error: 'No profile found' };
    return profile;
  });

  // Create / update profile
  app.post('/profile', async (request, reply) => {
    const parsed = ProfileBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten().fieldErrors });
    }
    const data = parsed.data;
    try {
      if (data.id !== undefined) {
        const updated = profileRepository.update(data.id, data as any);
        return updated;
      }
      const created = profileRepository.create(data as any);
      return { success: true, profile: created };
    } catch (error) {
      return reply.status(400).send({ error: (error as Error).message });
    }
  });

  // Import profile from resume text
  app.post('/profile/import', async (request, reply) => {
    const { resumeText } = request.body as { resumeText?: string };
    if (!resumeText) {
      return reply.status(400).send({ error: 'resumeText is required' });
    }
    try {
      const { extractProfileFromResume } = await import('../../ai/profile-extractor');
      const provider = createAIProvider();
      const extractedProfile = await extractProfileFromResume(provider, resumeText);

      const existingProfile = profileRepository.findFirst();
      if (existingProfile && existingProfile.id !== undefined) {
        const updated = profileRepository.update(existingProfile.id, extractedProfile);
        return { success: true, profile: updated, action: 'updated' };
      }
      const created = profileRepository.create(extractedProfile);
      return { success: true, profile: created, action: 'created' };
    } catch (error) {
      return reply.status(500).send({ error: (error as Error).message });
    }
  });

  // Delete profile
  app.delete('/profile/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const numId = parseInt(id, 10);
      if (isNaN(numId)) {
        return reply.status(400).send({ error: 'Invalid profile ID' });
      }
      const deleted = profileRepository.delete(numId);
      return { success: deleted };
    } catch (error) {
      return reply.status(400).send({ error: (error as Error).message });
    }
  });

  // Profile field mapping (lightweight, no AI)
  app.post('/profile/map-fields', async (request, reply) => {
    const { fields } = request.body as {
      fields: Array<{ key: string; type: string; label: string }>;
    };

    if (!Array.isArray(fields) || fields.length === 0) {
      return reply.status(400).send({ error: 'fields must be a non-empty array' });
    }

    const profile = profileRepository.findFirst();
    if (!profile) {
      return reply.status(400).send({ error: 'No profile found' });
    }

    const { getDeterministicFieldValue } = await import('../../core/form-filler');
    const profileData: Record<string, string> = {
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

    const fillPlan: Record<string, string> = {};
    for (const field of fields) {
      const fieldKey = field.key || field.label;
      const normalized = fieldKey.toLowerCase().replace(/[^a-z0-9]/g, '');
      for (const [profileKey, profileValue] of Object.entries(profileData)) {
        const normalizedProfileKey = profileKey.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (
          normalized.includes(normalizedProfileKey) ||
          normalizedProfileKey.includes(normalized) ||
          normalized === normalizedProfileKey
        ) {
          if (profileValue) {
            fillPlan[fieldKey] = profileValue;
            break;
          }
        }
      }
      if (!fillPlan[fieldKey]) {
        const value = getDeterministicFieldValue(profile, {
          label: field.label,
          name: field.key,
          type: field.type as 'text' | 'select' | 'checkbox' | 'radio',
        });
        if (value) fillPlan[fieldKey] = value;
      }
    }
    return { fillPlan };
  });
}
