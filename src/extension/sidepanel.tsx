import React, { useState, useCallback, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import {
  LayoutDashboard,
  History,
  Target,
  User,
  Settings as SettingsIcon,
} from 'lucide-react';
import type { Profile, Application } from '../types';
import { detectPlatform } from '../utils/url-parser';

// React Query
import { useIsMutating } from '@tanstack/react-query';
import {
  useExtensionData,
  useCurrentTabUrl,
  useGenerateDocuments,
  useSaveProfile,
  useImportProfile,
  useDeleteApplication,
  useUpdateConfig,
  useBulkAdd,
  useBulkProcess,
  useMapFields,
  useDownloadDocument,
} from './hooks';
import { Providers } from './providers';

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

const NON_SCRIPTABLE_PROTOCOLS = [
  'chrome:',
  'chrome-extension:',
  'devtools:',
  'edge:',
  'about:',
  'moz-extension:',
];

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

  // UI State (still useState since it's local UI state)
  const [activeTab, setActiveTab] = useState<'dashboard' | 'history' | 'analytics' | 'profile' | 'settings'>(
    'dashboard'
  );
  const [recentFilter, setRecentFilter] = useState<string>('all');
  const [showProfileForm, setShowProfileForm] = useState(false);
  const [bulkUrls, setBulkUrls] = useState('');
  const [previewApp, setPreviewApp] = useState<Application | null>(null);
  const [fillReport, setFillReport] = useState<{
    filled: Array<{ key: string; value: string }>;
    skipped: number;
  } | null>(null);
  const [importPreviewData, setImportPreviewData] = useState<Partial<Profile> | null>(null);

  // React Query data fetching
  const { connected, profile, config, applications, queueStats, isLoading, isError } =
    useExtensionData();

  // Tab URL polling via React Query
  const { data: currentTabUrl } = useCurrentTabUrl();

  // Derived state
  const timeSaved = useMemo(
    () => applications.reduce((acc, app) => acc + (app.time_saved || 0), 0),
    [applications]
  );

  const bulkStats = queueStats
    ? {
        pending: queueStats.pending || 0,
        completed: queueStats.completed || 0,
        failed: queueStats.failed || 0,
      }
    : null;

  // Mutations
  const saveProfileMutation = useSaveProfile();
  const importProfileMutation = useImportProfile();
  const deleteApplicationMutation = useDeleteApplication();
  const updateConfigMutation = useUpdateConfig();
  const generateDocsMutation = useGenerateDocuments();
  const bulkAddMutation = useBulkAdd();
  const bulkProcessMutation = useBulkProcess();
  const mapFieldsMutation = useMapFields();
  const downloadDocumentMutation = useDownloadDocument();

  // Check if any mutation is running (for loading states)
  const isAnyMutating = useIsMutating();
  const isSavingProfile = saveProfileMutation.isPending || importProfileMutation.isPending;
  const isGeneratingDocs = generateDocsMutation.isPending;
  const isBulkProcessing = bulkProcessMutation.isPending;

  const handleGenerateDocuments = async (type: 'resume' | 'cover-letter' | 'both') => {
    if (!currentTabUrl) {
      toast.error('No active job URL detected');
      return;
    }

    if (!connected) {
      toast.error('API server not connected. Make sure to run "bun run api".');
      return;
    }

    try {
      const result = await generateDocsMutation.mutateAsync({
        url: currentTabUrl,
        type,
      });
      toast.success('Documents generated successfully');
      return result;
    } catch (err: any) {
      toast.error(err.message || 'Failed to generate documents');
    }
  };

  const updateAppConfig = async (newConfig: Parameters<typeof updateConfigMutation.mutateAsync>[0]) => {
    try {
      await updateConfigMutation.mutateAsync(newConfig);
      toast.success('Settings saved');
    } catch (err) {
      toast.error('Failed to save settings');
    }
  };

  const saveProfile = async (formData: Partial<Profile>) => {
    try {
      await saveProfileMutation.mutateAsync({
        formData,
        profileId: profile?.id,
      });
      setShowProfileForm(false);
      setImportPreviewData(null);
      toast.success('Profile saved successfully');
    } catch (err: any) {
      toast.error(err.message || 'Failed to save profile');
    }
  };

  const deleteApplication = async (id: number) => {
    try {
      await deleteApplicationMutation.mutateAsync(id);
      toast.success('Application deleted');
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

      try {
        const text = await file.text();
        const data = await importProfileMutation.mutateAsync(text);
        setImportPreviewData(data);
        setShowProfileForm(false);
        toast.info('Review the extracted data before saving');
      } catch (err: any) {
        toast.error(err.message || 'Failed to import profile');
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
      const result = await bulkAddMutation.mutateAsync({ urls });
      setBulkUrls('');
      toast.success(`${result.added} URL${result.added !== 1 ? 's' : ''} added to queue`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to add URLs');
    }
  };

  const handleBulkProcess = async () => {
    try {
      await bulkProcessMutation.mutateAsync({
        autoSubmit: config?.application.autoSubmit,
        delaySeconds: config?.application.rateLimitDelay || 0,
      });
      toast.success('Queue processing started');
    } catch (err: any) {
      toast.error(err.message || 'Bulk processing failed');
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
    if (!connected) {
      toast.error('API server not connected');
      return;
    }

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.id) throw new Error('No active tab found');

      const unsupportedTabMessage = getUnsupportedTabMessage(tab.url);
      if (unsupportedTabMessage) {
        throw new Error(unsupportedTabMessage);
      }

      // Check profile exists
      if (!profile) {
        throw new Error('No profile found. Please set up your profile first.');
      }

      // Detect form fields and get AI-backed fill plan
      let fillPlan: Record<string, string> = {};
      try {
        const detectedFields = await sendMessageToTab(tab.id, { type: 'GET_FORM_FIELDS' }, tab.url);
        if (detectedFields?.fields?.length > 0) {
          const result = await mapFieldsMutation.mutateAsync({ fields: detectedFields.fields });
          fillPlan = result.fillPlan || {};
        }
      } catch {
        // fillPlan is optional
      }

      // Fetch resume PDF as base64
      let resumeBase64: string | undefined;
      let resumeFilename: string | undefined;
      const generatedDocs = generateDocsMutation.data;
      if (generatedDocs?.resume) {
        try {
          const blob = await downloadDocumentMutation.mutateAsync(generatedDocs.resume);
          resumeBase64 = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
          });
          resumeFilename = generatedDocs.resume;
        } catch {
          // resume upload is optional
        }
      }

      // Send profile to content script
      const profilePayload = {
        type: 'AUTOFILL_WITH_PROFILE',
        fillPlan,
        documents: resumeBase64 ? { resume: resumeBase64, resumeFilename } : undefined,
        profile: {
          firstName: profile.name?.split(' ')[0] || '',
          lastName: profile.name?.split(' ').slice(1).join(' ') || '',
          fullName: profile.name || '',
          email: profile.email || '',
          phone: profile.phone || '',
          location: profile.location || '',
          linkedin: profile.linkedin_url || '',
          linkedinUrl: profile.linkedin_url || '',
          github: profile.github_url || '',
          portfolio: profile.portfolio_url || '',
          address: profile.location || '',
          city: '',
          postcode: '',
          country: '',
          state: '',
          headline: profile.name || '',
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
          firstName: profile.name?.split(' ')[0] || '',
          lastName: profile.name?.split(' ').slice(1).join(' ') || '',
          fullName: profile.name || '',
          email: profile.email || '',
          phone: profile.phone || '',
          linkedin: profile.linkedin_url || '',
          linkedinUrl: profile.linkedin_url || '',
          github: profile.github_url || '',
          portfolio: profile.portfolio_url || '',
          location: profile.location || '',
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
    } catch (err: any) {
      console.error('Autofill failed', err);
      toast.error(err.message || 'Autofill failed');
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

  if (isLoading) {
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
              isApplying={isAnyMutating > 0}
              connected={connected}
              error={isError ? 'Failed to load extension data' : null}
              onRetry={() => window.location.reload()}
              onDismissError={() => {}}
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
              generatedDocs={generateDocsMutation.data ?? null}
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
  <Providers>
    <ToastProvider>
      <ConfirmProvider>
        <AppContent />
      </ConfirmProvider>
    </ToastProvider>
  </Providers>
);

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
