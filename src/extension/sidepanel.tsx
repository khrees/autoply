import React, { useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import {
  LayoutDashboard,
  History,
  Target,
  User,
  Settings as SettingsIcon,
} from 'lucide-react';
import type { Profile, AppConfig, Application } from '../types';
import { detectPlatform } from '../utils/url-parser';

// Components
import { ToastProvider, useToast } from './components/Toast';
import { ConfirmProvider } from './components/ConfirmDialog';
import { ConnectionBanner, Header } from './components/Header';
import { LoadingState, QuickStats } from './components/shared';
import { ActionCard } from './components/ActionCard';
import { ApplicationCard, FilterTabs } from './components/ApplicationCard';
import { ProfileCard } from './components/ProfileCard';
import { ProfileFormModal } from './components/ProfileFormModal';
import { PreviewModal } from './components/PreviewModal';
import { SettingsSection } from './components/SettingsSection';
import { AnalyticsSection } from './components/AnalyticsSection';
import { BulkSection } from './components/BulkSection';
import { FillReportCard } from './components/FillReportCard';
import { GenerateDocumentsCard } from './components/GenerateDocumentsCard';
import { ImportPreviewModal } from './components/ImportPreviewModal';
import { VirtualList } from './components/VirtualList';

const API_BASE = (globalThis as any).__API_BASE__ || 'http://localhost:8088';

const NON_SCRIPTABLE_PROTOCOLS = [
  'chrome:',
  'chrome-extension:',
  'devtools:',
  'edge:',
  'about:',
  'moz-extension:',
];

function sortApplications(applications: Application[]): Application[] {
  return [...applications].sort((left, right) => {
    const leftTime = Date.parse(left.applied_at || left.created_at || '') || 0;
    const rightTime = Date.parse(right.applied_at || right.created_at || '') || 0;
    return rightTime - leftTime;
  });
}

function isProfile(value: unknown): value is Profile {
  return Boolean(value && typeof value === 'object' && 'name' in value && 'email' in value);
}

function getUnsupportedTabMessage(url?: string): string | null {
  if (!url) return 'Open a job application page before running Autofill.';

  try {
    const parsed = new URL(url);
    if (NON_SCRIPTABLE_PROTOCOLS.includes(parsed.protocol)) {
      return `Autofill cannot run on ${parsed.protocol} pages. Open a normal job application tab first.`;
    }
    if (parsed.hostname === 'chromewebstore.google.com') {
      return 'Autofill cannot run on Chrome Web Store pages.';
    }
  } catch {
    return 'Open a valid job application page before running Autofill.';
  }
  return null;
}

const AppContent = () => {
  const toast = useToast();

  const [activeTab, setActiveTab] = useState<'dashboard' | 'history' | 'analytics' | 'profile' | 'settings'>(
    'dashboard'
  );
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [timeSaved, setTimeSaved] = useState(0);
  const [applications, setApplications] = useState<Application[]>([]);
  const [recentFilter, setRecentFilter] = useState<string>('all');
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showProfileForm, setShowProfileForm] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [bulkUrls, setBulkUrls] = useState('');
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);
  const [bulkStats, setBulkStats] = useState<{
    pending: number;
    completed: number;
    failed: number;
  } | null>(null);
  const [previewApp, setPreviewApp] = useState<Application | null>(null);
  const [isGeneratingDocs, setIsGeneratingDocs] = useState(false);
  const [generatedDocs, setGeneratedDocs] = useState<{
    resume?: string;
    coverLetter?: string;
  } | null>(null);
  const [currentTabUrl, setCurrentTabUrl] = useState<string | undefined>();
  const [fillReport, setFillReport] = useState<{
    filled: Array<{ key: string; value: string }>;
    skipped: number;
  } | null>(null);
  const [importPreviewData, setImportPreviewData] = useState<Partial<Profile> | null>(null);

  const checkConnection = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/extension/status`);
      if (res.ok) {
        setConnected(true);
        await loadData();
      } else {
        setConnected(false);
      }
    } catch {
      setConnected(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkConnection();
  }, [checkConnection]);

  useEffect(() => {
    const getTabUrl = async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.url) {
          setCurrentTabUrl(tab.url);
        }
      } catch {
        // Extension context not available
      }
    };
    getTabUrl();

    const interval = setInterval(getTabUrl, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleGenerateDocuments = async (type: 'resume' | 'cover-letter' | 'both') => {
    if (!currentTabUrl) {
      toast.error('No active job URL detected');
      return;
    }

    if (!connected) {
      toast.error('API server not connected. Make sure to run "bun run api".');
      return;
    }

    setIsGeneratingDocs(true);
    try {
      const res = await fetch(`${API_BASE}/documents/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: currentTabUrl, type }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setGeneratedDocs({
          resume: data.resumePath?.split('/').pop(),
          coverLetter: data.coverLetterPath?.split('/').pop(),
        });
        toast.success('Documents generated successfully');
      } else {
        toast.error(data.error || 'Failed to generate documents');
      }
    } catch (err) {
      toast.error('Failed to connect to API server. Make sure "bun run api" is running.');
    } finally {
      setIsGeneratingDocs(false);
    }
  };

  const updateAppConfig = async (newConfig: Partial<AppConfig>) => {
    if (!config) return;

    const updated: AppConfig = { ...config };

    if (newConfig.ai) {
      updated.ai = { ...config.ai, ...newConfig.ai };
    }
    if (newConfig.application) {
      updated.application = { ...config.application, ...newConfig.application };
    }
    if (newConfig.browser) {
      updated.browser = { ...config.browser, ...newConfig.browser };
    }

    setConfig(updated);
    try {
      await fetch(`${API_BASE}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      toast.success('Settings saved');
    } catch (err) {
      toast.error('Failed to save settings');
    }
  };

  const loadData = async () => {
    try {
      fetch(`${API_BASE}/applications/cleanup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hours: 24 }),
      }).catch(() => {});

      const [configRes, profileRes, appsRes, queueRes] = await Promise.all([
        fetch(`${API_BASE}/config`),
        fetch(`${API_BASE}/profile`),
        fetch(`${API_BASE}/applications`),
        fetch(`${API_BASE}/queue/stats`).catch(() => null),
      ]);

      if (!configRes.ok || !profileRes.ok || !appsRes.ok) {
        throw new Error('Failed to load extension data');
      }

      const configData = (await configRes.json()) as AppConfig;
      const profileData = await profileRes.json();
      const appsData = sortApplications((await appsRes.json()) as Application[]);

      if (queueRes?.ok) {
        const queueData = await queueRes.json();
        setBulkStats({
          pending: queueData.pending || 0,
          completed: queueData.completed || 0,
          failed: queueData.failed || 0,
        });
      }

      setConfig(configData);
      setProfile(isProfile(profileData) ? profileData : null);
      setApplications(appsData);
      setTimeSaved(appsData.reduce((acc, app) => acc + (app.time_saved || 0), 0));
    } catch (err) {
      setConnected(false);
      console.error('Failed to load data', err);
    }
  };

  const saveProfile = async (formData: Partial<Profile>) => {
    setIsSavingProfile(true);
    try {
      const res = await fetch(`${API_BASE}/profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          id: profile?.id,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setProfile(data.profile || data);
        setShowProfileForm(false);
        setImportPreviewData(null);
        toast.success('Profile saved successfully');
      } else {
        toast.error(data.error || 'Failed to save profile');
      }
    } catch (err) {
      toast.error('Failed to save profile');
    } finally {
      setIsSavingProfile(false);
    }
  };

  const deleteApplication = async (id: number) => {
    try {
      const res = await fetch(`${API_BASE}/applications/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setApplications((prev) => prev.filter((app) => app.id !== id));
        toast.success('Application deleted');
      } else {
        toast.error('Failed to delete application');
      }
    } catch (err) {
      toast.error('Failed to delete application');
    }
  };

  const importProfileFromResume = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt,.md,.pdf';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      setIsSavingProfile(true);
      try {
        const text = await file.text();
        const res = await fetch(`${API_BASE}/profile/import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ resumeText: text }),
        });
        const data = await res.json();
        if (res.ok) {
          // Show preview instead of committing immediately
          setImportPreviewData(data.profile);
          setShowProfileForm(false);
          toast.info('Review the extracted data before saving');
        } else {
          toast.error(data.error || 'Failed to import profile');
        }
      } catch {
        toast.error('Failed to import profile');
      } finally {
        setIsSavingProfile(false);
      }
    };
    input.click();
  };

  const handleBulkAdd = async () => {
    const urls = bulkUrls
      .split('\n')
      .map((u) => u.trim())
      .filter(Boolean);
    if (urls.length === 0) {
      toast.warning('Please enter at least one URL');
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/queue/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls }),
      });
      const data = await res.json();
      if (res.ok) {
        setBulkStats((prev) => ({
          pending: (prev?.pending || 0) + data.added,
          completed: prev?.completed || 0,
          failed: prev?.failed || 0,
        }));
        setBulkUrls('');
        toast.success(`${data.added} URL${data.added !== 1 ? 's' : ''} added to queue`);
      } else {
        toast.error(data.error || 'Failed to add URLs');
      }
    } catch {
      toast.error('Failed to add URLs');
    }
  };

  const handleBulkProcess = async () => {
    setIsBulkProcessing(true);
    try {
      const res = await fetch(`${API_BASE}/queue/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          autoSubmit: config?.application.autoSubmit,
          delaySeconds: config?.application.rateLimitDelay || 0,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setBulkStats({
          pending: data.stats.pending,
          completed: data.stats.completed,
          failed: data.stats.failed,
        });
        await loadData();
        toast.success('Queue processing started');
      } else {
        toast.error(data.error || 'Bulk processing failed');
      }
    } catch {
      toast.error('Bulk processing failed');
    } finally {
      setIsBulkProcessing(false);
    }
  };

  const sendMessageToTab = async (tabId: number, message: any, tabUrl?: string) => {
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (err: any) {
      if (
        typeof err?.message === 'string' &&
        err.message.includes('Could not establish connection')
      ) {
        const unsupportedTabMessage = getUnsupportedTabMessage(tabUrl);
        if (unsupportedTabMessage) {
          throw new Error(unsupportedTabMessage);
        }

        try {
          // Inject into main frame
          await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });

          // Also inject into all frames (handles Ashby and other iframe-based forms)
          await chrome.scripting.executeScript({
            target: { tabId, allFrames: true },
            files: ['content.js'],
          });

          await chrome.tabs.sendMessage(tabId, { type: 'PING' });
          return await chrome.tabs.sendMessage(tabId, message);
        } catch (injectionError: any) {
          const injectionMessage =
            typeof injectionError?.message === 'string'
              ? injectionError.message
              : 'Unknown injection error';
          throw new Error(
            `Could not attach to the page. Reload and try again. (${injectionMessage})`
          );
        }
      }
      throw err;
    }
  };

  const handleAutofill = async () => {
    if (isApplying) return;
    setIsApplying(true);
    setError(null);
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.id) throw new Error('No active tab found');

      const unsupportedTabMessage = getUnsupportedTabMessage(tab.url);
      if (unsupportedTabMessage) {
        throw new Error(unsupportedTabMessage);
      }

      // Step 1: Get profile
      const profileRes = await fetch(`${API_BASE}/profile`);
      if (!profileRes.ok) {
        throw new Error('Failed to load profile');
      }
      const profileData = await profileRes.json();

      if (!profileData || !profileData.name) {
        throw new Error('No profile found. Please set up your profile first.');
      }

      // Step 1.5: Detect form fields and get AI-backed fill plan
      let fillPlan: Record<string, string> = {};
      try {
        const detectedFields = await sendMessageToTab(tab.id, { type: 'GET_FORM_FIELDS' }, tab.url);
        if (detectedFields?.fields?.length > 0) {
          const mapRes = await fetch(`${API_BASE}/profile/map-fields`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fields: detectedFields.fields }),
          });
          if (mapRes.ok) {
            const mapped = await mapRes.json();
            fillPlan = mapped.fillPlan || {};
          }
        }
      } catch {
        // fillPlan is optional
      }

      // Step 1.6: Fetch resume PDF as base64
      let resumeBase64: string | undefined;
      let resumeFilename: string | undefined;
      if (generatedDocs?.resume) {
        try {
          const resumeRes = await fetch(`${API_BASE}/documents/download/${encodeURIComponent(generatedDocs.resume)}`);
          if (resumeRes.ok) {
            const blob = await resumeRes.blob();
            resumeBase64 = await new Promise<string>((resolve) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.readAsDataURL(blob);
            });
            resumeFilename = generatedDocs.resume;
          }
        } catch {
          // resume upload is optional
        }
      }

      // Step 2: Send profile to content script
      try {
        const profilePayload = {
          type: 'AUTOFILL_WITH_PROFILE',
          fillPlan,
          documents: resumeBase64 ? { resume: resumeBase64, resumeFilename } : undefined,
          profile: {
            firstName: profileData.name?.split(' ')[0] || '',
            lastName: profileData.name?.split(' ').slice(1).join(' ') || '',
            fullName: profileData.name || '',
            email: profileData.email || '',
            phone: profileData.phone || '',
            location: profileData.location || '',
            linkedin: profileData.linkedin_url || '',
            linkedinUrl: profileData.linkedin_url || '',
            github: profileData.github_url || '',
            portfolio: profileData.portfolio_url || '',
            address: profileData.address || profileData.location || '',
            city: profileData.city || '',
            postcode: profileData.postcode || profileData.zip || '',
            country: profileData.country || '',
            state: profileData.state || '',
            headline: profileData.headline || profileData.name || '',
          },
        };

        // Send to main frame first
        const fillResult = await sendMessageToTab(tab.id, profilePayload, tab.url);

        // For Ashby and other iframe-based platforms, also try all frames
        try {
          const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
          for (const frame of frames || []) {
            if (frame.frameId !== 0) {
              try {
                await chrome.tabs.sendMessage(tab.id, profilePayload, { frameId: frame.frameId });
              } catch {
                // Not all frames accept messages
              }
            }
          }
        } catch {
          // webNavigation may not be available
        }

        if (fillResult?.success) {
          const profileKeyToValue: Record<string, string> = {
            firstName: profileData.name?.split(' ')[0] || '',
            lastName: profileData.name?.split(' ').slice(1).join(' ') || '',
            fullName: profileData.name || '',
            email: profileData.email || '',
            phone: profileData.phone || '',
            linkedin: profileData.linkedin_url || '',
            linkedinUrl: profileData.linkedin_url || '',
            github: profileData.github_url || '',
            portfolio: profileData.portfolio_url || '',
            location: profileData.location || '',
            resume_upload: '',
          };
          const filledArr: string[] = fillResult?.filled || [];
          setFillReport({
            filled: filledArr.map((key) => ({ key, value: profileKeyToValue[key] ?? '' })),
            skipped: filledArr.length === 0 ? 0 : Math.max(0, 8 - filledArr.length),
          });
          toast.success(`${filledArr.length} field${filledArr.length !== 1 ? 's' : ''} filled successfully`);
        } else if (fillResult?.error) {
          throw new Error(fillResult.error);
        }
      } catch (fillError: any) {
        throw new Error(fillError.message || 'Form fill failed');
      }

      await loadData();
    } catch (err: any) {
      console.error('Autofill failed', err);
      setError(err.message || 'Autofill failed unexpectedly');
      toast.error(err.message || 'Autofill failed');
    } finally {
      setIsApplying(false);
    }
  };

  const handleRefillField = async (fieldKey: string, value: string): Promise<boolean> => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.id) return false;
      const result = await sendMessageToTab(tab.id, { type: 'REFILL_FIELD', fieldKey, value }, tab.url);
      if (result?.success) {
        setFillReport((prev) =>
          prev
            ? { ...prev, filled: prev.filled.map((f) => (f.key === fieldKey ? { ...f, value } : f)) }
            : prev
        );
      }
      return result?.success === true;
    } catch {
      return false;
    }
  };

  const handleRetry = async () => {
    setError(null);
    setIsApplying(true);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab.id) {
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
        setConnected(true);
      } catch (e: any) {
        setError(`Re-injection failed: ${e.message}`);
      }
    }
    setIsApplying(false);
  };

  if (loading) {
    return (
      <div className="h-screen bg-[var(--bg-primary)]">
        <LoadingState />
      </div>
    );
  }

  const filteredApps =
    recentFilter === 'all'
      ? applications.slice(0, 10)
      : applications.filter((app) => app.status === recentFilter);

  return (
    <div className="flex flex-col h-screen bg-[var(--bg-primary)]">
      <ConnectionBanner connected={connected} />

      <Header connected={connected} />

      <main className="flex-1 overflow-y-auto px-4 py-4 pb-24 space-y-4">
        {activeTab === 'dashboard' && (
          <div className="space-y-4">
            <ActionCard
              onApply={handleAutofill}
              isApplying={isApplying}
              connected={connected}
              error={error}
              onRetry={handleRetry}
              onDismissError={() => setError(null)}
            />

            {fillReport && (
              <FillReportCard
                report={fillReport}
                onDismiss={() => setFillReport(null)}
                onRefill={handleRefillField}
              />
            )}

            <GenerateDocumentsCard
              currentUrl={currentTabUrl}
              onGenerate={handleGenerateDocuments}
              isGenerating={isGeneratingDocs}
              generatedDocs={generatedDocs}
              connected={connected}
            />

            <QuickStats timeSaved={timeSaved} applicationsCount={applications.length} />

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                  Recent Activity
                </h3>
              </div>
              <FilterTabs active={recentFilter} onChange={setRecentFilter} />

              <div className="space-y-2">
                {filteredApps.length > 0 ? (
                  filteredApps.map((app, i) => (
                    <div
                      key={app.id}
                      className="animate-fade-in"
                      style={{ animationDelay: `${i * 50}ms` }}
                    >
                      <ApplicationCard
                        application={app}
                        onDelete={() => app.id && deleteApplication(app.id)}
                        onPreview={() => setPreviewApp(app)}
                      />
                    </div>
                  ))
                ) : (
                  <div className="card">
                    <div className="empty-state">
                      <div className="empty-state-icon">
                        <History className="w-6 h-6" />
                      </div>
                      <h3 className="empty-state-title">No applications yet</h3>
                      <p className="empty-state-description">Your application history will appear here</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              Application History
            </h3>
            {applications.length > 0 ? (
              <VirtualList
                items={applications}
                itemHeight={80}
                maxHeight={600}
                className="space-y-2"
                renderItem={(app, i) => (
                  <div
                    key={app.id ?? `${app.url}-${app.created_at}`}
                    className="animate-fade-in"
                    style={{ animationDelay: `${Math.min(i, 10) * 30}ms` }}
                  >
                    <ApplicationCard
                      application={app}
                      onDelete={() => app.id && deleteApplication(app.id)}
                      onPreview={() => setPreviewApp(app)}
                    />
                  </div>
                )}
              />
            ) : (
              <div className="card">
                <div className="empty-state">
                  <div className="empty-state-icon">
                    <History className="w-6 h-6" />
                  </div>
                  <h3 className="empty-state-title">No applications tracked</h3>
                  <p className="empty-state-description">Use autofill on a job page to start tracking</p>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'analytics' && (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Analytics</h3>
            <AnalyticsSection applications={applications} />
          </div>
        )}

        {activeTab === 'profile' && (
          <div className="space-y-4">
            <ProfileCard profile={profile} onEdit={() => setShowProfileForm(true)} />

            <BulkSection
              urls={bulkUrls}
              onUrlsChange={setBulkUrls}
              onAdd={handleBulkAdd}
              onProcess={handleBulkProcess}
              stats={bulkStats}
              isProcessing={isBulkProcessing}
            />
          </div>
        )}

        {activeTab === 'settings' && <SettingsSection config={config} onUpdate={updateAppConfig} />}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 bg-[var(--bg-secondary)]/95 backdrop-blur-xl border-t border-[var(--border-subtle)] safe-area-bottom">
        <div className="flex items-center justify-around px-2 py-2">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`}
            aria-label="Dashboard"
            aria-current={activeTab === 'dashboard' ? 'page' : undefined}
          >
            <LayoutDashboard className="w-5 h-5" />
            <span>Home</span>
          </button>

          <button
            onClick={() => setActiveTab('history')}
            className={`nav-item ${activeTab === 'history' ? 'active' : ''}`}
            aria-label="History"
            aria-current={activeTab === 'history' ? 'page' : undefined}
          >
            <History className="w-5 h-5" />
            <span>History</span>
          </button>

          <button
            onClick={() => setActiveTab('analytics')}
            className={`nav-item ${activeTab === 'analytics' ? 'active' : ''}`}
            aria-label="Analytics"
            aria-current={activeTab === 'analytics' ? 'page' : undefined}
          >
            <Target className="w-5 h-5" />
            <span>Stats</span>
          </button>

          <button
            onClick={() => setActiveTab('profile')}
            className={`nav-item ${activeTab === 'profile' ? 'active' : ''}`}
            aria-label="Profile"
            aria-current={activeTab === 'profile' ? 'page' : undefined}
          >
            <User className="w-5 h-5" />
            <span>Profile</span>
          </button>

          <button
            onClick={() => setActiveTab('settings')}
            className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`}
            aria-label="Settings"
            aria-current={activeTab === 'settings' ? 'page' : undefined}
          >
            <SettingsIcon className="w-5 h-5" />
            <span>Settings</span>
          </button>
        </div>
      </nav>

      {previewApp && <PreviewModal app={previewApp} onClose={() => setPreviewApp(null)} />}

      {showProfileForm && (
        <ProfileFormModal
          profile={profile}
          onSave={saveProfile}
          onCancel={() => setShowProfileForm(false)}
          onImport={importProfileFromResume}
          isSaving={isSavingProfile}
        />
      )}

      {importPreviewData && (
        <ImportPreviewModal
          data={importPreviewData}
          onSave={saveProfile}
          onCancel={() => setImportPreviewData(null)}
          isSaving={isSavingProfile}
        />
      )}
    </div>
  );
};

const App = () => (
  <ToastProvider>
    <ConfirmProvider>
      <AppContent />
    </ConfirmProvider>
  </ToastProvider>
);

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
