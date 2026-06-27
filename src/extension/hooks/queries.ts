import { useQuery } from '@tanstack/react-query';
import type { Profile, AppConfig, Application } from '../../types';
import { API_BASE } from '../constants';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getApiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.json();
}

// ── Query keys ───────────────────────────────────────────────────────────────

export const queryKeys = {
  connection: ['connection'] as const,
  profile: ['profile'] as const,
  config: ['config'] as const,
  applications: ['applications'] as const,
  queueStats: ['queue', 'stats'] as const,
  tabUrl: ['tab', 'url'] as const,
};

// ── Type guards ──────────────────────────────────────────────────────────────

function isProfile(value: unknown): value is Profile {
  return Boolean(value && typeof value === 'object' && 'name' in value && 'email' in value);
}

function sortApplications(applications: Application[]): Application[] {
  return [...applications].sort((left, right) => {
    const leftTime = Date.parse(left.applied_at || left.created_at || '') || 0;
    const rightTime = Date.parse(right.applied_at || right.created_at || '') || 0;
    return rightTime - leftTime;
  });
}

// ── Hooks ────────────────────────────────────────────────────────────────────

/** Check API connection health */
export function useConnectionStatus() {
  return useQuery({
    queryKey: queryKeys.connection,
    queryFn: async () => {
      const res = await fetch(getApiUrl('/extension/status'));
      if (!res.ok) throw new Error('Connection failed');
      return true;
    },
    retry: false,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

/** Fetch the current profile */
export function useProfile() {
  return useQuery({
    queryKey: queryKeys.profile,
    queryFn: async (): Promise<Profile | null> => {
      const data = await fetchJson<Profile | { error: string }>(getApiUrl('/profile'));
      if ('error' in data) return null;
      return isProfile(data) ? data : null;
    },
    staleTime: 30_000,
  });
}

/** Fetch app config */
export function useConfig() {
  return useQuery({
    queryKey: queryKeys.config,
    queryFn: async (): Promise<AppConfig> => {
      return fetchJson<AppConfig>(getApiUrl('/config'));
    },
    staleTime: 30_000,
  });
}

/** Fetch applications (sorted newest-first) */
export function useApplications() {
  return useQuery({
    queryKey: queryKeys.applications,
    queryFn: async (): Promise<Application[]> => {
      // Background cleanup
      fetch(getApiUrl('/applications/cleanup'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hours: 24 }),
      }).catch(() => {});

      const data = await fetchJson<Application[]>(getApiUrl('/applications'));
      return sortApplications(data);
    },
    staleTime: 10_000,
  });
}

/** Fetch queue stats */
export function useQueueStats() {
  return useQuery({
    queryKey: queryKeys.queueStats,
    queryFn: async () => {
      return fetchJson<{ pending: number; completed: number; failed: number }>(
        getApiUrl('/queue/stats')
      );
    },
    staleTime: 5_000,
  });
}

/** Current tab URL with polling */
export function useCurrentTabUrl() {
  return useQuery({
    queryKey: queryKeys.tabUrl,
    queryFn: async (): Promise<string | undefined> => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        return tab?.url;
      } catch {
        return undefined;
      }
    },
    refetchInterval: 5_000,
    initialData: undefined,
    staleTime: 0,
  });
}

/** Fetch available AI models (Ollama/LM Studio only) */
export function useAIModels(provider: 'ollama' | 'lmstudio' | string) {
  return useQuery({
    queryKey: ['ai', 'models', provider],
    queryFn: async (): Promise<string[]> => {
      const data = await fetchJson<{ models?: string[] }>(getApiUrl('/ai/models'));
      return data.models || [];
    },
    enabled: provider === 'ollama' || provider === 'lmstudio',
    retry: 1,
    staleTime: 60_000,
  });
}

// ── Combined hook ────────────────────────────────────────────────────────────

export function useExtensionData() {
  const connection = useConnectionStatus();
  const profile = useProfile();
  const config = useConfig();
  const applications = useApplications();
  const queueStats = useQueueStats();

  return {
    connected: connection.data ?? false,
    profile: profile.data ?? null,
    config: config.data ?? null,
    applications: applications.data ?? [],
    queueStats: queueStats.data ?? null,
    isLoading: connection.isLoading || profile.isLoading || config.isLoading || applications.isLoading,
    isError: connection.isError || profile.isError || config.isError || applications.isError,
    refetch: () => {
      connection.refetch();
      profile.refetch();
      config.refetch();
      applications.refetch();
      queueStats.refetch();
    },
  };
}
