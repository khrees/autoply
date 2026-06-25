import { useQuery } from '@tanstack/react-query';
import type { Profile, AppConfig, Application } from '../../types';

const API_BASE = (globalThis as any).__API_BASE__ || 'http://localhost:8088';

// Query keys
export const queryKeys = {
  connection: ['connection'] as const,
  profile: ['profile'] as const,
  config: ['config'] as const,
  applications: ['applications'] as const,
  queueStats: ['queue', 'stats'] as const,
  tabUrl: ['tab', 'url'] as const,
};

function isProfile(value: unknown): value is Profile {
  return Boolean(value && typeof value === 'object' && 'name' in value && 'email' in value);
}

// Check API connection status
export function useConnectionStatus() {
  return useQuery({
    queryKey: queryKeys.connection,
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/extension/status`);
      if (!res.ok) throw new Error('Connection failed');
      return true;
    },
    retry: false,
    refetchInterval: 30000, // Check every 30s
    staleTime: 10000,
  });
}

// Fetch profile
export function useProfile() {
  return useQuery({
    queryKey: queryKeys.profile,
    queryFn: async (): Promise<Profile | null> => {
      const res = await fetch(`${API_BASE}/profile`);
      if (!res.ok) throw new Error('Failed to load profile');
      const data = await res.json();
      return isProfile(data) ? data : null;
    },
    staleTime: 30000,
  });
}

// Fetch config
export function useConfig() {
  return useQuery({
    queryKey: queryKeys.config,
    queryFn: async (): Promise<AppConfig> => {
      const res = await fetch(`${API_BASE}/config`);
      if (!res.ok) throw new Error('Failed to load config');
      return res.json();
    },
    staleTime: 30000,
  });
}

// Fetch applications
function sortApplications(applications: Application[]): Application[] {
  return [...applications].sort((left, right) => {
    const leftTime = Date.parse(left.applied_at || left.created_at || '') || 0;
    const rightTime = Date.parse(right.applied_at || right.created_at || '') || 0;
    return rightTime - leftTime;
  });
}

export function useApplications() {
  return useQuery({
    queryKey: queryKeys.applications,
    queryFn: async (): Promise<Application[]> => {
      // Run cleanup in background (fire and forget)
      fetch(`${API_BASE}/applications/cleanup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hours: 24 }),
      }).catch(() => {});

      const res = await fetch(`${API_BASE}/applications`);
      if (!res.ok) throw new Error('Failed to load applications');
      const data = await res.json();
      return sortApplications(data);
    },
    staleTime: 10000,
  });
}

// Fetch queue stats
export function useQueueStats() {
  return useQuery({
    queryKey: queryKeys.queueStats,
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/queue/stats`);
      if (!res.ok) throw new Error('Failed to load queue stats');
      return res.json();
    },
    staleTime: 5000,
  });
}

// Current tab URL with polling
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
    refetchInterval: 5000,
    initialData: undefined,
    staleTime: 0,
  });
}

// Fetch available AI models (Ollama/LM Studio)
export function useAIModels(provider: 'ollama' | 'lmstudio' | string) {
  return useQuery({
    queryKey: ['ai', 'models', provider],
    queryFn: async (): Promise<string[]> => {
      if (provider !== 'ollama' && provider !== 'lmstudio') {
        return [];
      }
      const res = await fetch(`${API_BASE}/ai/models`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to fetch models');
      }
      const data = await res.json();
      return data.models || [];
    },
    enabled: provider === 'ollama' || provider === 'lmstudio',
    retry: 1,
    staleTime: 60000, // Cache for 1 minute
  });
}

// Combined hook for initial data loading
export function useExtensionData() {
  const connection = useConnectionStatus();
  const profile = useProfile();
  const config = useConfig();
  const applications = useApplications();
  const queueStats = useQueueStats();

  const isLoading = connection.isLoading || profile.isLoading || config.isLoading || applications.isLoading;
  const isError = connection.isError || profile.isError || config.isError || applications.isError;

  return {
    connected: connection.data ?? false,
    profile: profile.data ?? null,
    config: config.data ?? null,
    applications: applications.data ?? [],
    queueStats: queueStats.data,
    isLoading,
    isError,
    refetch: () => {
      connection.refetch();
      profile.refetch();
      config.refetch();
      applications.refetch();
      queueStats.refetch();
    },
  };
}
