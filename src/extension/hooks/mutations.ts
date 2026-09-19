import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from './queries';
import type { Profile, AppConfig } from '../../types';
import { getApiUrl, getAuthHeaders, apiFetchJson } from '../utils/api-config';

// ── Mutation Data Types ──────────────────────────────────────────────────────

interface SaveProfileData {
  formData: Partial<Profile>;
  profileId?: number;
}

interface GenerateDocumentsData {
  url: string;
  type: 'resume' | 'cover-letter' | 'both';
}

export interface GeneratedDocumentsResult {
  /** PDF filename for download/preview */
  resume?: string;
  /** PDF filename for download/preview */
  coverLetter?: string;
  /** Markdown content of the resume, for in-extension preview */
  resumeContent?: string;
  /** Markdown content of the cover letter, for in-extension preview */
  coverLetterContent?: string;
}

interface BulkAddData {
  urls: string[];
}

interface BulkAddResult {
  added: number;
}

interface BulkProcessData {
  autoSubmit?: boolean;
  delaySeconds?: number;
}

interface MapFieldsData {
  fields: Array<{ key: string; type: string; label: string }>;
}

// ── Mutations ────────────────────────────────────────────────────────────────

/** Save or update profile */
export function useSaveProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ formData, profileId }: SaveProfileData): Promise<Profile> => {
      return apiFetchJson('/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, id: profileId }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.profile });
    },
  });
}

/** Import profile from resume text */
export function useImportProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (resumeText: string): Promise<Partial<Profile>> => {
      const data = await apiFetchJson<{ profile: Partial<Profile> }>('/profile/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resumeText }),
      });
      return data.profile;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.profile });
    },
  });
}

/** Delete an application */
export function useDeleteApplication() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: number): Promise<void> => {
      const res = await fetch(await getApiUrl(`/applications/${id}`), {
        method: 'DELETE',
        headers: await getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to delete application');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.applications });
    },
  });
}

/** Update app config */
export function useUpdateConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (newConfig: Partial<AppConfig>): Promise<void> => {
      const currentConfig = queryClient.getQueryData<AppConfig>(queryKeys.config);
      if (!currentConfig) throw new Error('Config not loaded');

      const updated: AppConfig = { ...currentConfig };

      if (newConfig.ai) {
        updated.ai = { ...currentConfig.ai, ...newConfig.ai };
      }
      if (newConfig.application) {
        updated.application = { ...currentConfig.application, ...newConfig.application };
      }
      if (newConfig.browser) {
        updated.browser = { ...currentConfig.browser, ...newConfig.browser };
      }

      const res = await fetch('/config', {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify(updated),
      });
      if (!res.ok) throw new Error('Failed to save settings');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.config });
    },
  });
}

/** Generate documents (resume + cover letter) */
export function useGenerateDocuments() {
  return useMutation({
    mutationFn: async ({ url, type }: GenerateDocumentsData): Promise<GeneratedDocumentsResult> => {
      const data = await apiFetchJson<{
        success: boolean;
        resumePath?: string;
        coverLetterPath?: string;
        resumeContent?: string;
        coverLetterContent?: string;
        error?: string;
      }>('/documents/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, type }),
      });

      if (!data.success) throw new Error(data.error || 'Failed to generate documents');

      return {
        resume: data.resumePath?.split('/').pop(),
        coverLetter: data.coverLetterPath?.split('/').pop(),
        resumeContent: data.resumeContent,
        coverLetterContent: data.coverLetterContent,
      };
    },
  });
}

/** Bulk add URLs to queue */
export function useBulkAdd() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ urls }: BulkAddData): Promise<BulkAddResult> => {
      const data = await apiFetchJson<{ added: number }>('/queue/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls }),
      });
      return { added: data.added };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.queueStats });
    },
  });
}

/** Bulk process the queue */
export function useBulkProcess() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      autoSubmit,
      delaySeconds,
    }: BulkProcessData): Promise<{
      stats: { pending: number; completed: number; failed: number };
    }> => {
      const data = await apiFetchJson<{
        stats: { pending: number; completed: number; failed: number };
      }>('/queue/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoSubmit, delaySeconds }),
      });
      return { stats: data.stats };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.queueStats });
      queryClient.invalidateQueries({ queryKey: queryKeys.applications });
    },
  });
}

/** Map form fields to profile data */
export function useMapFields() {
  return useMutation({
    mutationFn: async ({
      fields,
    }: MapFieldsData): Promise<{ fillPlan: Record<string, string> }> => {
      return apiFetchJson('/profile/map-fields', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields }),
      });
    },
  });
}

/** Download a document (returns blob) */
export function useDownloadDocument() {
  return useMutation({
    mutationFn: async (filename: string): Promise<Blob> => {
      const res = await fetch(
        await getApiUrl(`/documents/download/${encodeURIComponent(filename)}`),
        {
          headers: await getAuthHeaders(),
        }
      );
      if (!res.ok) throw new Error('Failed to download document');
      return res.blob();
    },
  });
}

/** Send a chat message and get AI response */
export function useSendChatMessage() {
  return useMutation({
    mutationFn: async ({
      messages,
      url,
    }: {
      messages: Array<{ role: 'user' | 'assistant'; content: string }>;
      url?: string;
    }): Promise<string> => {
      const data = await apiFetchJson<{ reply: string }>('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, url }),
      });
      return data.reply;
    },
  });
}
