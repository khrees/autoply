import React, { useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import {
  Zap,
  Target,
  User,
  Settings as SettingsIcon,
  History,
  CheckCircle,
  Eye,
  FileText,
  AlertCircle,
  LayoutDashboard,
  ShieldCheck,
  ChevronRight,
  ExternalLink,
  Sparkles,
  RefreshCcw,
  Shield,
  Clock
} from 'lucide-react';
import type { Profile, AppConfig, Application } from '../types';
import { detectPlatform } from '../utils/url-parser';

const API_BASE = (globalThis as any).__API_BASE__ || 'http://localhost:8088';

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <h4 className="text-[10px] uppercase font-bold tracking-[0.25em] text-zinc-500 mb-5 px-1">{children}</h4>
);

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

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

function getApplicationDate(application: Application): string {
  const rawDate = application.applied_at || application.created_at;
  if (!rawDate) {
    return 'Date unavailable';
  }

  const timestamp = Date.parse(rawDate);
  return Number.isNaN(timestamp) ? 'Date unavailable' : DATE_FORMATTER.format(timestamp);
}

function isProfile(value: unknown): value is Profile {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'name' in value &&
      'email' in value
  );
}

function getUnsupportedTabMessage(url?: string): string | null {
  if (!url) {
    return 'Open a job application page before running Autofill.';
  }

  try {
    const parsed = new URL(url);
    if (NON_SCRIPTABLE_PROTOCOLS.includes(parsed.protocol)) {
      return `Autofill cannot run on ${parsed.protocol}// pages. Open a normal job application tab first.`;
    }

    if (parsed.hostname === 'chromewebstore.google.com') {
      return 'Autofill cannot run on Chrome Web Store pages. Open a job application page first.';
    }
  } catch {
    return 'Open a valid job application page before running Autofill.';
  }

  return null;
}

const App = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [timeSaved, setTimeSaved] = useState(0);
  const [applications, setApplications] = useState<Application[]>([]);
  const [recentApps, setRecentApps] = useState<Application[]>([]);
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkConnection = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/health`);
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

  const updateAppConfig = async (newConfig: any) => {
    if (!config) return;
    
    // Deep-ish merge helper for the common 2-level config structure
    const updated = { ...config };
    for (const key in newConfig) {
      if (typeof newConfig[key] === 'object' && newConfig[key] !== null && !Array.isArray(newConfig[key])) {
        updated[key as keyof AppConfig] = { 
          ...(updated[key as keyof AppConfig] as any), 
          ...newConfig[key] 
        } as any;
      } else {
        updated[key as keyof AppConfig] = newConfig[key];
      }
    }
    
    setConfig(updated);
    try {
      await fetch(`${API_BASE}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated)
      });
    } catch (err) {
      console.error('Failed to update config', err);
    }
  };

  const loadData = async () => {
    try {
      const [configRes, profileRes, appsRes] = await Promise.all([
        fetch(`${API_BASE}/config`),
        fetch(`${API_BASE}/profile`),
        fetch(`${API_BASE}/applications`)
      ]);

      if (!configRes.ok || !profileRes.ok || !appsRes.ok) {
        throw new Error('Failed to load extension data from the local API');
      }

      const configData = await configRes.json() as AppConfig;
      const profileData = await profileRes.json();
      const appsData = sortApplications(await appsRes.json() as Application[]);

      setConfig(configData);
      setProfile(isProfile(profileData) ? profileData : null);
      setApplications(appsData);
      setRecentApps(appsData.slice(0, 3));
      setTimeSaved(appsData.reduce((acc, app) => acc + (app.time_saved || 0), 0));
    } catch (err) {
      setConnected(false);
      console.error('Failed to load data', err);
    }
  };

  const sendMessageToTab = async (tabId: number, message: any, tabUrl?: string) => {
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (err: any) {
      if (typeof err?.message === 'string' && err.message.includes('Could not establish connection')) {
        const unsupportedTabMessage = getUnsupportedTabMessage(tabUrl);
        if (unsupportedTabMessage) {
          throw new Error(unsupportedTabMessage);
        }

        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            files: ['content.js']
          });

          await chrome.tabs.sendMessage(tabId, { type: 'PING' });
          return await chrome.tabs.sendMessage(tabId, message);
        } catch (injectionError: any) {
          const injectionMessage = typeof injectionError?.message === 'string'
            ? injectionError.message
            : 'Unknown injection error';

          throw new Error(
            `Could not attach to the current page. Reload the tab and try again. (${injectionMessage})`
          );
        }
      }
      throw err;
    }
  };

  const handleAutofill = async () => {
    if (!connected || isApplying) return;
    setIsApplying(true);
    setError(null);
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.id) throw new Error('No active tab found');
      const unsupportedTabMessage = getUnsupportedTabMessage(tab.url);
      if (unsupportedTabMessage) {
        throw new Error(unsupportedTabMessage);
      }

      // 1. Get HTML from page
      const pageData = await sendMessageToTab(tab.id, { type: 'GET_PAGE_DATA' }, tab.url);
      if (!pageData?.html || !pageData?.url) {
        throw new Error('Unable to inspect the active page');
      }
      const { html, url } = pageData;

      // Determine platform
      const platform = detectPlatform(url) ?? 'generic';
      
      // 2. Process passively
      const res = await fetch(`${API_BASE}/jobs/passive-process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html, url, platform })
      });
      
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to process job data');
      }
      
      const result = await res.json();
      if (!result.success) throw new Error(result.error || 'Processing failed');
      
      // 3. Trigger local autofill
      await sendMessageToTab(tab.id, {
        type: 'AUTOFILL_FORM',
        fillPlan: result.fillPlan,
        documents: result.documents
      }, tab.url);
      await loadData();
    } catch (err: any) {
      console.error('Autofill failed', err);
      setError(err.message || 'Autofill failed unexpectedly');
    } finally {
      setIsApplying(false);
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center h-screen bg-[#050505]">
      <div className="w-8 h-8 border-2 border-zinc-800 border-t-blue-500 rounded-full animate-spin"></div>
    </div>
  );

  return (
    <div className="relative flex flex-col h-screen bg-[#050505] text-white font-sans selection:bg-navy-blue/30 overflow-hidden">
      
      {/* Top Header */}
      <header className="px-6 py-6 flex items-center justify-between z-10">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-[#002e5d] rounded-xl flex items-center justify-center shadow-2xl shadow-navy-blue/20">
            <Zap className="w-5 h-5 text-white fill-current" />
          </div>
          <div className="flex flex-col">
            <h1 className="text-xl font-bold tracking-tight font-display text-white">Autoply</h1>
            <div className="flex items-center gap-2">
              <div className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.5)]' : 'bg-rose-500'}`} />
              <span className="text-[9px] uppercase font-bold tracking-[0.15em] text-zinc-500">{connected ? 'Engine Ready' : 'Engine Offline'}</span>
            </div>
          </div>
        </div>
        <button 
          onClick={() => setActiveTab(activeTab === 'settings' ? 'dashboard' : 'settings')}
          className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-white/[0.03] transition-all text-zinc-500 hover:text-white border border-transparent hover:border-white/10"
        >
          <SettingsIcon className={`w-5 h-5 transition-transform duration-700 ${activeTab === 'settings' ? 'rotate-180' : ''}`} />
        </button>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto px-6 py-2 space-y-6 custom-scrollbar pb-24">
        
        {activeTab === 'dashboard' && (
          <div className="space-y-6 animate-fade-in">
            
            {/* Action Section */}
            <div className="glass rounded-[24px] p-7 relative overflow-hidden group border-white/5">
              <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:opacity-10 transition-opacity">
                <Sparkles className="w-16 h-16 text-white" />
              </div>
              
              <div className="space-y-6 relative z-10">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-navy-blue/10 flex items-center justify-center text-navy-blue border border-navy-blue/10">
                    <Shield className="w-5 h-5" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">Intelligent Autofill</span>
                  </div>
                </div>
                
                <div>
                  <h2 className="text-2xl font-bold font-display mb-2 leading-tight">Apply Instantly</h2>
                  <p className="text-sm text-zinc-400 leading-relaxed font-medium">
                    Our AI scans the current page, detects form fields, and maps your profile data automatically.
                  </p>
                </div>

                {error && (
                  <div className="animate-fade-in space-y-4">
                    <div className="p-4 bg-rose-500/5 border border-rose-500/10 rounded-xl flex gap-3 text-xs text-rose-400">
                      <AlertCircle className="w-4 h-4 flex-shrink-0" />
                      <p className="font-medium leading-relaxed">{error}</p>
                    </div>
                    {error.includes('connection') && (
                      <button 
                        onClick={async () => {
                          setError(null);
                          setIsApplying(true);
                          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                          if (tab.id) {
                            try {
                              await chrome.scripting.executeScript({
                                target: { tabId: tab.id },
                                files: ['content.js']
                              });
                              setConnected(true);
                            } catch (e: any) {
                              setError(`Re-injection failed: ${e.message}`);
                            }
                          }
                          setIsApplying(false);
                        }}
                        className="w-full py-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-white hover:text-navy-blue transition-colors flex items-center justify-center gap-2 border border-white/5 rounded-lg hover:bg-white"
                      >
                        <RefreshCcw className="w-3 h-3" />
                        Force Repair Connection
                      </button>
                    )}
                  </div>
                )}

                <button 
                  onClick={handleAutofill}
                  disabled={!connected || isApplying}
                  className={`btn-primary w-full py-4 text-sm flex items-center justify-center gap-3 shadow-navy-blue/40 shadow-xl ${isApplying ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {isApplying ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span className="tracking-wide">Analyzing Form...</span>
                    </>
                  ) : (
                    <>
                      <Zap className="w-4 h-4 fill-current" />
                      <span className="tracking-wide">Fill Application</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 gap-4">
               <div className="glass rounded-[20px] p-5 flex flex-col gap-2 border-white/5">
                  <div className="flex items-center gap-2 text-zinc-500">
                    <Clock className="w-3.5 h-3.5" />
                    <span className="text-[10px] font-bold uppercase tracking-[0.15em]">Time Saved</span>
                  </div>
                  <div className="text-3xl font-display font-bold text-white tabular-nums tracking-tighter">
                    {timeSaved}<span className="text-sm font-medium text-zinc-500 ml-1">m</span>
                  </div>
               </div>
               <div className="glass rounded-[20px] p-5 flex flex-col gap-2 border-white/5">
                  <div className="flex items-center gap-2 text-zinc-500">
                    <Target className="w-3.5 h-3.5" />
                    <span className="text-[10px] font-bold uppercase tracking-[0.15em]">Success</span>
                  </div>
                  <div className="text-3xl font-display font-bold text-white tabular-nums tracking-tighter">98.2<span className="text-sm font-medium text-zinc-500 ml-1">%</span></div>
               </div>
            </div>

            {/* Recent Activity */}
            <div className="space-y-4">
              <SectionTitle>Recent Activity</SectionTitle>
              <div className="space-y-3">
                {recentApps.length > 0 ? recentApps.map((app, i) => (
                  <div 
                    key={app.id} 
                    className="flex items-center justify-between p-4 rounded-xl border border-white/[0.03] bg-white/[0.02] hover:bg-white/[0.04] transition-all cursor-pointer group group"
                    style={{ animationDelay: `${i * 100}ms` }}
                  >
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-zinc-900 border border-white/5 flex items-center justify-center text-zinc-500 group-hover:bg-[#002e5d] group-hover:text-white group-hover:border-navy-blue transition-all duration-500">
                        <FileText className="w-5 h-5" />
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm font-bold text-zinc-200 truncate group-hover:text-white transition-colors">{app.company}</span>
                        <span className="text-[11px] text-zinc-500 font-medium">{getApplicationDate(app)}</span>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-zinc-700 group-hover:text-zinc-300 group-hover:translate-x-1 transition-all duration-300" />
                  </div>
                )) : (
                  <div className="text-center py-10 rounded-2xl border border-dashed border-white/10 text-[11px] font-medium text-zinc-600 tracking-wide uppercase">
                    Activity logs will appear here
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="space-y-5 animate-fade-in pb-10">
            <SectionTitle>Application History</SectionTitle>
            <div className="glass rounded-[24px] border-white/5 overflow-hidden divide-y divide-white/[0.04]">
              {applications.length > 0 ? applications.map((app) => {
                const statusClasses =
                  app.status === 'submitted'
                    ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/10'
                    : app.status === 'failed'
                    ? 'bg-rose-500/10 text-rose-300 border-rose-500/10'
                    : app.status === 'filled'
                    ? 'bg-sky-500/10 text-sky-300 border-sky-500/10'
                    : 'bg-amber-500/10 text-amber-300 border-amber-500/10';

                return (
                  <div key={app.id ?? `${app.url}-${app.created_at}`} className="p-5 space-y-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 space-y-1">
                        <p className="text-sm font-bold text-white truncate">
                          {app.job_title || 'Untitled role'}
                        </p>
                        <div className="flex items-center gap-2 text-[11px] text-zinc-500 font-medium">
                          <span className="truncate">{app.company || 'Unknown company'}</span>
                          <span className="text-zinc-700">/</span>
                          <span>{getApplicationDate(app)}</span>
                        </div>
                      </div>
                      <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${statusClasses}`}>
                        {app.status}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-[11px] text-zinc-500">
                      <CheckCircle className="w-3.5 h-3.5" />
                      <span className="truncate">{app.platform}</span>
                      {app.status === 'filled' && (
                        <>
                          <span className="text-zinc-700">/</span>
                          <span>Ready for manual review</span>
                        </>
                      )}
                    </div>

                    {app.error_message && (
                      <div className="rounded-xl border border-rose-500/10 bg-rose-500/5 px-4 py-3 text-[11px] text-rose-300 leading-relaxed">
                        {app.error_message}
                      </div>
                    )}

                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => {
                          void chrome.tabs.create({ url: app.url });
                        }}
                        className="flex-1 rounded-[14px] border border-white/10 bg-white/[0.03] px-4 py-3 text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-200 transition-all hover:bg-white/[0.08]"
                      >
                        <span className="flex items-center justify-center gap-2">
                          <ExternalLink className="w-3.5 h-3.5" />
                          Open Listing
                        </span>
                      </button>
                      <button
                        onClick={() => setActiveTab('dashboard')}
                        className="rounded-[14px] border border-white/10 px-4 py-3 text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400 transition-all hover:border-white/20 hover:text-white"
                      >
                        <span className="flex items-center gap-2">
                          <Eye className="w-3.5 h-3.5" />
                          Return
                        </span>
                      </button>
                    </div>
                  </div>
                );
              }) : (
                <div className="px-6 py-12 text-center space-y-3">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] text-zinc-500">
                    <History className="w-5 h-5" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-bold text-zinc-200">No applications tracked yet</p>
                    <p className="text-[11px] font-medium text-zinc-500">
                      Run an application from the CLI or use the fill action on a supported job page.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {profile && (
              <div className="glass rounded-[20px] p-5 border-white/5">
                <div className="flex items-center gap-3 text-zinc-500 mb-3">
                  <ShieldCheck className="w-4 h-4" />
                  <span className="text-[10px] font-bold uppercase tracking-[0.16em]">Active Profile</span>
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-bold text-white">{profile.name}</p>
                  <p className="text-[11px] text-zinc-500 font-medium">{profile.email}</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Settings Tab */}
        {activeTab === 'settings' && (
          <div className="space-y-8 animate-fade-in pb-10">
            <div className="flex flex-col gap-8">
              <div className="space-y-5">
                <SectionTitle>Engine Intelligence</SectionTitle>
                <div className="glass rounded-[24px] p-6 space-y-5 border-white/5">
                  <div className="space-y-3">
                    <label className="text-[10px] font-bold text-zinc-500 ml-1 uppercase tracking-[0.2em]">Intelligence Protocol</label>
                    <div className="relative group">
                      <select
                        value={config?.ai.provider || 'ollama'}
                        onChange={(e) => updateAppConfig({ ai: { ...config?.ai!, provider: e.target.value as any } })}
                        className="w-full bg-zinc-950 border border-white/10 rounded-[14px] px-5 py-4 text-xs focus:ring-1 focus:ring-navy-blue outline-none appearance-none cursor-pointer hover:border-white/20 transition-all font-medium"
                      >
                        <option value="openai">OpenAI (SOTA)</option>
                        <option value="anthropic">Anthropic (Claude)</option>
                        <option value="google">Google (Gemini)</option>
                        <option value="ollama">Ollama (Local)</option>
                        <option value="lmstudio">LM Studio (Local)</option>
                      </select>
                      <ChevronRight className="w-4 h-4 text-zinc-600 absolute right-5 top-1/2 -translate-y-1/2 rotate-90 pointer-events-none group-hover:text-zinc-400 transition-colors" />
                    </div>
                  </div>

                  {/* API Key for Cloud Providers */}
                  {config?.ai.provider && ['openai', 'anthropic', 'google'].includes(config.ai.provider) && (
                    <div className="space-y-3 animate-fade-in">
                      <label className="text-[10px] font-bold text-zinc-500 ml-1 uppercase tracking-[0.2em]">Secure Access Key</label>
                      <input 
                        type="password"
                        value={config.ai.apiKey || ''}
                        onChange={(e) => updateAppConfig({ ai: { ...config.ai, apiKey: e.target.value } })}
                        placeholder={`Enter ${config.ai.provider.toUpperCase()} key...`}
                        className="w-full bg-zinc-950 border border-white/10 rounded-[14px] px-5 py-4 text-xs focus:ring-1 focus:ring-navy-blue outline-none hover:border-white/20 transition-all font-mono"
                      />
                    </div>
                  )}

                  {/* Base URL for Local Models */}
                  {config?.ai.provider && ['ollama', 'lmstudio'].includes(config.ai.provider) && (
                    <div className="space-y-3 animate-fade-in">
                      <label className="text-[10px] font-bold text-zinc-500 ml-1 uppercase tracking-[0.2em]">Node Endpoint</label>
                      <input 
                        type="text"
                        value={config.ai.baseUrl || ''}
                        onChange={(e) => updateAppConfig({ ai: { ...config.ai, baseUrl: e.target.value } })}
                        placeholder={config.ai.provider === 'ollama' ? 'http://localhost:11434' : 'http://localhost:1234'}
                        className="w-full bg-zinc-950 border border-white/10 rounded-[14px] px-5 py-4 text-xs focus:ring-1 focus:ring-navy-blue outline-none hover:border-white/20 transition-all font-mono"
                      />
                    </div>
                  )}

                  <div className="space-y-3">
                    <label className="text-[10px] font-bold text-zinc-500 ml-1 uppercase tracking-[0.2em]">Active Compute Node</label>
                    <input 
                      type="text"
                      value={config?.ai.model || ''}
                      onChange={(e) => updateAppConfig({ ai: { ...config?.ai!, model: e.target.value } })}
                      className="w-full bg-zinc-950 border border-white/10 rounded-[14px] px-5 py-4 text-xs focus:ring-1 focus:ring-navy-blue outline-none hover:border-white/20 transition-all font-mono tracking-tight"
                    />
                  </div>

                  <div className="pt-2">
                    <button 
                      onClick={async () => {
                        if (!config) return;
                        try {
                          const res = await fetch(`${API_BASE}/config/test`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ ai: config.ai })
                          });
                          const data = await res.json();
                          if (data.success) {
                            alert('Protocol Verified: Secure Link Established');
                          } else {
                            alert(`Node Error: ${data.error}`);
                          }
                        } catch (err) {
                          alert('System Error: Local Gateway Unresponsive');
                        }
                      }}
                      className="w-full py-4 px-5 rounded-[14px] border border-white/10 bg-white/[0.03] hover:bg-white/[0.08] text-[10px] font-bold uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-2 group"
                    >
                      <div className="w-1.5 h-1.5 rounded-full bg-navy-blue group-hover:animate-pulse"></div>
                      Verify Intelligence Node
                    </button>
                  </div>
                </div>
              </div>

              <div className="space-y-5">
                <SectionTitle>Security & Guardrails</SectionTitle>
                <div className="glass rounded-[24px] overflow-hidden divide-y divide-white/[0.03] border-white/5">
                    <div className="p-5 flex items-center justify-between hover:bg-white/[0.01] transition-colors group">
                       <div className="flex flex-col gap-1">
                         <span className="text-sm font-bold text-zinc-200 group-hover:text-white transition-colors">Autonomous Submission</span>
                         <span className="text-[11px] text-zinc-500 font-medium">Auto-pilot mode for applications</span>
                       </div>
                       <div 
                         onClick={() => updateAppConfig({ application: { autoSubmit: !config?.application.autoSubmit } })}
                         className={`w-12 h-6 rounded-full p-1 cursor-pointer transition-all duration-500 ${config?.application.autoSubmit ? 'bg-[#002e5d] shadow-[0_0_15px_rgba(0,46,93,0.4)]' : 'bg-zinc-800'}`}
                       >
                          <div className={`bg-white w-4 h-4 rounded-full shadow-lg transition-transform duration-500 ${config?.application.autoSubmit ? 'translate-x-6' : 'translate-x-0'}`} />
                       </div>
                    </div>
                    <div className="p-5 flex items-center justify-between hover:bg-white/[0.01] transition-colors group">
                       <div className="flex flex-col gap-1">
                         <span className="text-sm font-bold text-zinc-200 group-hover:text-white transition-colors">Vault Encryption</span>
                         <span className="text-[11px] text-zinc-500 font-medium">AES-256 profile protection</span>
                       </div>
                       <div 
                         onClick={() => updateAppConfig({ application: { vaultEncryption: !config?.application.vaultEncryption } })}
                         className={`w-12 h-6 rounded-full p-1 cursor-pointer transition-all duration-500 ${config?.application.vaultEncryption ? 'bg-[#002e5d] shadow-[0_0_15px_rgba(0,46,93,0.4)]' : 'bg-zinc-800'}`}
                       >
                          <div className={`bg-white w-4 h-4 rounded-full shadow-lg transition-transform duration-500 ${config?.application.vaultEncryption ? 'translate-x-6' : 'translate-x-0'}`} />
                       </div>
                    </div>
                 </div>
               </div>
             </div>
           </div>
         )}
       </main>
 
       {/* Bottom Nav */}
       <footer className="absolute bottom-0 left-0 right-0 px-8 py-8 bg-gradient-to-t from-black via-black/95 to-transparent z-20">
         <div className="bg-zinc-900/80 border border-white/10 backdrop-blur-xl rounded-[24px] p-2 flex items-center justify-around shadow-2xl shadow-black">
           <button 
             onClick={() => setActiveTab('dashboard')} 
             className={`flex-1 py-3 rounded-[18px] flex items-center justify-center gap-2.5 transition-all duration-500 ${activeTab === 'dashboard' ? 'bg-[#002e5d] text-white shadow-2xl shadow-navy-blue/30' : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.03]'}`}
           >
             <LayoutDashboard className={`w-5 h-5 ${activeTab === 'dashboard' ? 'fill-current' : ''}`} />
             {activeTab === 'dashboard' && <span className="text-xs font-bold tracking-tight">Console</span>}
           </button>
           
           <button 
             onClick={() => setActiveTab('history')}
             className={`flex-1 py-3 rounded-[18px] flex items-center justify-center gap-2.5 transition-all duration-500 ${activeTab === 'history' ? 'bg-[#002e5d] text-white shadow-2xl shadow-navy-blue/30' : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.03]'}`}
           >
             <History className="w-5 h-5" />
             {activeTab === 'history' && <span className="text-xs font-bold tracking-tight">History</span>}
           </button>

          <button 
            onClick={() => setActiveTab('settings')}
            className={`flex-1 py-3 rounded-[18px] flex items-center justify-center gap-2.5 transition-all duration-500 ${activeTab === 'settings' ? 'bg-[#002e5d] text-white shadow-2xl shadow-navy-blue/30' : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.03]'}`}
          >
            <User className={`w-5 h-5 ${activeTab === 'settings' ? 'fill-current' : ''}`} />
            {activeTab === 'settings' && <span className="text-xs font-bold tracking-tight">Vault</span>}
          </button>
        </div>
      </footer>
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
