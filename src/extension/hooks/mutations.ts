import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from './queries';
import type { Profile, AppConfig } from '../../types';

const API_BASE = (globalThis as any).__API_BASE__ || 'http://localhost:8088';

interface SaveProfileData {
  formData: Partial<Profile>;
  profileId?: number;
}

// Save profile mutation
export function useSaveProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ formData, profileId }: SaveProfileData): Promise<Profile> => {
      const res = await fetch(`${API_BASE}/profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          id: profileId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save profile');
      return data.profile || data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.profile });
    },
  });
}

// Import profile from resume
export function useImportProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (resumeText: string): Promise<Partial<Profile>> => {
      const res = await fetch(`${API_BASE}/profile/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resumeText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to import profile');
      return data.profile;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.profile });
    },
  });
}

// Delete application mutation
export function useDeleteApplication() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: number): Promise<void> => {
      const res = await fetch(`${API_BASE}/applications/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete application');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.applications });
    },
  });
}

// Update app config mutation
export function useUpdateConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (newConfig: Partial<AppConfig>): Promise<void> => {
      // Get current config first
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

      const res = await fetch(`${API_BASE}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      if (!res.ok) throw new Error('Failed to save settings');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.config });
    },
  });
}

// Generate documents mutation
interface GenerateDocumentsData {
  url: string;
  type: 'resume' | 'cover-letter' | 'both';
}

interface GeneratedDocumentsResult {
  resume?: string;
  coverLetter?: string;
}

export function useGenerateDocuments() {
  return useMutation({
    mutationFn: async ({ url, type }: GenerateDocumentsData): Promise<GeneratedDocumentsResult> => {
      const res = await fetch(`${API_BASE}/documents/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, type }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to generate documents');
      return {
        resume: data.resumePath?.split('/').pop(),
        coverLetter: data.coverLetterPath?.split('/').pop(),
      };
    },
  });
}

// Bulk add URLs mutation
interface BulkAddData {
  urls: string[];
}

interface BulkAddResult {
  added: number;
}

export function useBulkAdd() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ urls }: BulkAddData): Promise<BulkAddResult> => {
      const res = await fetch(`${API_BASE}/queue/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add URLs');
      return { added: data.added };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.queueStats });
    },
  });
}

// Bulk process mutation
interface BulkProcessData {
  autoSubmit?: boolean;
  delaySeconds?: number;
}

interface BulkStats {
  pending: number;
  completed: number;
  failed: number;
}

interface BulkProcessResult {
  stats: BulkStats;
}

export function useBulkProcess() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ autoSubmit, delaySeconds }: BulkProcessData): Promise<BulkProcessResult> => {
      const res = await fetch(`${API_BASE}/queue/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoSubmit, delaySeconds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Bulk processing failed');
      return { stats: data.stats };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.queueStats });
      queryClient.invalidateQueries({ queryKey: queryKeys.applications });
    },
  });
}

// Map fields mutation
interface MapFieldsData {
  fields: string[];
}

interface MapFieldsResult {
  fillPlan: Record<string, string>;
}

export function useMapFields() {
  return useMutation({
    mutationFn: async ({ fields }: MapFieldsData): Promise<MapFieldsResult> => {
      const res = await fetch(`${API_BASE}/profile/map-fields`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields }),
      });
      if (!res.ok) throw new Error('Failed to map fields');
      return res.json();
    },
  });
}

// Download document mutation
export function useDownloadDocument() {
  return useMutation({
    mutationFn: async (filename: string): Promise<Blob> => {
      const res = await fetch(`${API_BASE}/documents/download/${encodeURIComponent(filename)}`);
      if (!res.ok) throw new Error('Failed to download document');
      return res.blob();
    },
  });
}
