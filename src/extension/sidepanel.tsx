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
  Clock,
  Plus,
  Upload,
  Trash2,
  Loader2,
  Save,
  X,
  Briefcase,
  GraduationCap,
  Code,
  MapPin,
  Linkedin,
  Github,
  Globe,
  Link2,
  Search,
  Play,
  Pause,
  ArrowRight,
  Download,
  Edit3,
} from 'lucide-react';
import type { Profile, AppConfig, Application } from '../types';
import { detectPlatform } from '../utils/url-parser';

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

function getApplicationDate(application: Application): string {
  const rawDate = application.applied_at || application.created_at;
  if (!rawDate) return 'Unknown date';

  const timestamp = Date.parse(rawDate);
  if (Number.isNaN(timestamp)) return 'Unknown date';

  const now = new Date();
  const date = new Date(timestamp);
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;

  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
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

const SkeletonLine = ({
  width = '100%',
  height = '1rem',
  className = '',
}: {
  width?: string;
  height?: string;
  className?: string;
}) => <div className={`skeleton ${className}`} style={{ width, height }} />;

const SkeletonCard = () => (
  <div className="card">
    <div className="flex items-center gap-4 mb-4">
      <div className="skeleton w-12 h-12 rounded-lg" />
      <div className="flex-1">
        <SkeletonLine width="60%" height="1rem" />
        <SkeletonLine width="40%" height="0.75rem" className="mt-2" />
      </div>
    </div>
    <SkeletonLine width="100%" height="3rem" />
  </div>
);

const LoadingState = () => (
  <div className="flex flex-col items-center justify-center h-full gap-4">
    <div className="w-10 h-10 border-2 border-zinc-800 border-t-blue-500 rounded-full animate-spin" />
    <p className="text-sm text-zinc-500">Connecting to Autoply…</p>
  </div>
);

const ConnectionBanner = ({ connected }: { connected: boolean }) => (
  <div
    className={`px-4 py-2 flex items-center justify-between text-xs font-medium ${
      connected
        ? 'bg-emerald-500/10 text-emerald-400 border-b border-emerald-500/20'
        : 'bg-rose-500/10 text-rose-400 border-b border-rose-500/20'
    }`}
  >
    <span className="flex items-center gap-2">
      <span className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-rose-400'}`} />
      {connected ? 'Engine Ready' : 'Engine Offline'}
    </span>
    {!connected && <span className="text-rose-300/70">Run `bun run api`</span>}
  </div>
);

const Header = ({ connected }: { connected: boolean }) => (
  <header className="flex items-center px-5 py-4 border-b border-[var(--border-subtle)]">
    <div className="flex items-center gap-3">
      <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/25">
        <Zap className="w-5 h-5 text-white" />
      </div>
      <div>
        <h1 className="text-base font-bold tracking-tight text-[var(--text-primary)]">Autoply</h1>
        <p className="text-[0.6875rem] text-[var(--text-tertiary)]">Job Application Automator</p>
      </div>
    </div>
  </header>
);

const ActionCard = ({
  onApply,
  isApplying,
  connected,
  error,
  onRetry,
  onDismissError,
}: {
  onApply: () => void;
  isApplying: boolean;
  connected: boolean;
  error: string | null;
  onRetry?: () => void;
  onDismissError?: () => void;
}) => (
  <div className="card relative overflow-hidden group">
    <div className="absolute top-0 right-0 p-6 opacity-[0.03] group-hover:opacity-[0.06] transition-opacity pointer-events-none">
      <Sparkles className="w-20 h-20 text-white" />
    </div>

    <div className="relative z-10 space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-500 border border-blue-500/20">
          <Shield className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-[var(--text-primary)]">Apply Instantly</h2>
          <p className="text-xs text-[var(--text-tertiary)]">AI-powered form autofill</p>
        </div>
      </div>

      <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
        Our AI scans the current page, detects form fields, and maps your profile data
        automatically.
      </p>

      {error && (
        <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg flex items-start gap-2 text-xs text-rose-300">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p>{error}</p>
            {error.includes('connection') && onRetry && (
              <button onClick={onRetry} className="mt-2 text-rose-200 underline">
                Retry connection
              </button>
            )}
          </div>
          {onDismissError && (
            <button
              onClick={onDismissError}
              className="p-1 rounded hover:bg-rose-500/20 text-rose-300"
              aria-label="Dismiss error"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      <button
        onClick={onApply}
        disabled={!connected || isApplying}
        className="btn btn-primary btn-lg w-full shadow-lg shadow-blue-500/20"
      >
        {isApplying ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>Analyzing form…</span>
          </>
        ) : !connected ? (
          <>
            <AlertCircle className="w-5 h-5" />
            <span>Server Offline</span>
          </>
        ) : (
          <>
            <Zap className="w-5 h-5" />
            <span>Fill Application</span>
            <ArrowRight className="w-4 h-4" />
          </>
        )}
      </button>
    </div>
  </div>
);

const GenerateDocumentsCard = ({
  currentUrl,
  onGenerate,
  isGenerating,
  generatedDocs,
  connected,
}: {
  currentUrl: string | undefined;
  onGenerate: (type: 'resume' | 'cover-letter' | 'both') => void;
  isGenerating: boolean;
  generatedDocs: { resume?: string; coverLetter?: string } | null;
  connected: boolean;
}) => {
  const isValidJobUrl =
    currentUrl && !NON_SCRIPTABLE_PROTOCOLS.some((p) => currentUrl.startsWith(p));

  if (!isValidJobUrl) {
    return null;
  }

  const handleDownload = async (filename: string) => {
    const apiBase = (globalThis as any).__API_BASE__ || 'http://localhost:8088';
    const link = document.createElement('a');
    link.href = `${apiBase}/documents/download/${encodeURIComponent(filename)}`;
    link.download = filename;
    link.click();
  };

  return (
    <div className="card space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center text-purple-500 border border-purple-500/20">
          <FileText className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-[var(--text-primary)]">Generate Documents</h2>
          <p className="text-xs text-[var(--text-tertiary)]">AI-tailored for this job</p>
        </div>
      </div>

      {generatedDocs ? (
        <div className="space-y-2">
          {generatedDocs.resume && (
            <button
              onClick={() => handleDownload(generatedDocs.resume!)}
              className="btn btn-secondary w-full justify-between"
            >
              <span className="flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Resume
              </span>
              <Download className="w-4 h-4" />
            </button>
          )}
          {generatedDocs.coverLetter && (
            <button
              onClick={() => handleDownload(generatedDocs.coverLetter!)}
              className="btn btn-secondary w-full justify-between"
            >
              <span className="flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Cover Letter
              </span>
              <Download className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => onGenerate('both')}
            disabled={isGenerating}
            className="btn btn-primary w-full"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Generating…
              </>
            ) : (
              <>
                <RefreshCcw className="w-4 h-4" />
                Regenerate
              </>
            )}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => onGenerate('resume')}
            disabled={!connected || isGenerating}
            className="btn btn-secondary"
          >
            {isGenerating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <FileText className="w-4 h-4" />
            )}
            Resume
          </button>
          <button
            onClick={() => onGenerate('cover-letter')}
            disabled={!connected || isGenerating}
            className="btn btn-secondary"
          >
            {isGenerating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <FileText className="w-4 h-4" />
            )}
            Cover Letter
          </button>
        </div>
      )}
    </div>
  );
};

const StatCard = ({
  label,
  value,
  suffix = '',
}: {
  label: string;
  value: number | string;
  suffix?: string;
}) => (
  <div className="card p-4 flex flex-col gap-1">
    <span className="stat-label">{label}</span>
    <span className="stat-value text-[var(--text-primary)]">
      {value}
      {suffix && (
        <span className="text-sm font-normal text-[var(--text-tertiary)] ml-0.5">{suffix}</span>
      )}
    </span>
  </div>
);

const StatusBadge = ({ status }: { status: string }) => {
  const statusConfig: Record<string, { class: string; label: string }> = {
    submitted: { class: 'badge-success', label: 'Submitted' },
    filled: { class: 'badge-info', label: 'Filled' },
    pending: { class: 'badge-warning', label: 'Pending' },
    failed: { class: 'badge-error', label: 'Failed' },
  };
  const config = statusConfig[status] || statusConfig.pending;
  return <span className={`badge ${config.class}`}>{config.label}</span>;
};

const ApplicationCard = ({
  application,
  onDelete,
  onPreview,
}: {
  application: Application;
  onDelete: () => void;
  onPreview?: () => void;
}) => {
  const statusIcon = {
    submitted: <CheckCircle className="w-4 h-4 text-emerald-400" />,
    filled: <FileText className="w-4 h-4 text-blue-400" />,
    pending: <Clock className="w-4 h-4 text-amber-400" />,
    failed: <AlertCircle className="w-4 h-4 text-rose-400" />,
  };

  return (
    <div className="card card-interactive p-4 flex items-center gap-4 group">
      <div className="w-10 h-10 rounded-lg bg-[var(--bg-tertiary)] flex items-center justify-center text-[var(--text-tertiary)] group-hover:bg-blue-500/10 group-hover:text-blue-400 transition-colors">
        {statusIcon[application.status as keyof typeof statusIcon] || statusIcon.pending}
      </div>

      <div className="flex-1 min-w-0">
        <h4 className="text-sm font-semibold text-[var(--text-primary)] truncate">
          {application.company || 'Unknown Company'}
        </h4>
        <p className="text-xs text-[var(--text-tertiary)] truncate">
          {application.job_title || 'Untitled position'}
        </p>
      </div>

      <StatusBadge status={application.status} />

      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {onPreview && application.generated_resume && (
          <button
            onClick={onPreview}
            className="p-2 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
            aria-label="Preview documents"
          >
            <Eye className="w-4 h-4" />
          </button>
        )}
        <button
          onClick={() => {
            if (confirm(`Delete "${application.company}" application?`)) {
              onDelete();
            }
          }}
          className="p-2 rounded-lg hover:bg-rose-500/10 text-[var(--text-tertiary)] hover:text-rose-400 transition-colors"
          aria-label="Delete application"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

const EmptyState = ({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  action?: React.ReactNode;
}) => (
  <div className="empty-state">
    <div className="empty-state-icon">
      <Icon className="w-6 h-6" />
    </div>
    <h3 className="empty-state-title">{title}</h3>
    <p className="empty-state-description">{description}</p>
    {action && <div className="mt-4">{action}</div>}
  </div>
);

const ProfileCard = ({
  profile,
  onEdit,
  onDelete,
}: {
  profile: Profile | null;
  onEdit: () => void;
  onDelete?: () => void;
}) => {
  if (!profile) {
    return (
      <div className="card">
        <EmptyState
          icon={User}
          title="No profile set up"
          description="Add your details to autofill applications faster"
          action={
            <button onClick={onEdit} className="btn btn-primary btn-sm">
              <Plus className="w-4 h-4" />
              Create Profile
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white font-bold text-lg shadow-lg shadow-blue-500/25">
            {profile.name?.charAt(0)?.toUpperCase() || '?'}
          </div>
          <div>
            <h3 className="text-base font-semibold text-[var(--text-primary)]">{profile.name}</h3>
            <p className="text-xs text-[var(--text-tertiary)]">{profile.email}</p>
          </div>
        </div>
        <button onClick={onEdit} className="btn btn-secondary btn-sm">
          Edit
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 pt-2">
        {profile.phone && (
          <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
            <Phone className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
            <span className="truncate">{profile.phone}</span>
          </div>
        )}
        {profile.location && (
          <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
            <MapPin className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
            <span className="truncate">{profile.location}</span>
          </div>
        )}
      </div>

      {(profile.linkedin_url || profile.github_url || profile.portfolio_url) && (
        <div className="flex items-center gap-2 pt-2 border-t border-[var(--border-subtle)]">
          {profile.linkedin_url && (
            <a
              href={profile.linkedin_url}
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
              aria-label="LinkedIn profile"
            >
              <Linkedin className="w-4 h-4" />
            </a>
          )}
          {profile.github_url && (
            <a
              href={profile.github_url}
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
              aria-label="GitHub profile"
            >
              <Github className="w-4 h-4" />
            </a>
          )}
          {profile.portfolio_url && (
            <a
              href={profile.portfolio_url}
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
              aria-label="Portfolio"
            >
              <Globe className="w-4 h-4" />
            </a>
          )}
        </div>
      )}

      {profile.skills && profile.skills.length > 0 && (
        <div className="pt-2 border-t border-[var(--border-subtle)]">
          <p className="text-[0.6875rem] font-medium text-[var(--text-tertiary)] uppercase tracking-wider mb-2">
            Skills
          </p>
          <div className="flex flex-wrap gap-1.5">
            {profile.skills.slice(0, 10).map((skill, i) => (
              <span
                key={i}
                className="px-2 py-1 rounded-md bg-[var(--bg-tertiary)] text-xs text-[var(--text-secondary)] border border-[var(--border-subtle)]"
              >
                {skill}
              </span>
            ))}
            {profile.skills.length > 10 && (
              <span className="px-2 py-1 text-xs text-[var(--text-tertiary)]">
                +{profile.skills.length - 10} more
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const Phone = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
  </svg>
);

const QuickStats = ({
  timeSaved,
  applicationsCount,
}: {
  timeSaved: number;
  applicationsCount: number;
}) => (
  <div className="grid grid-cols-2 gap-3">
    <StatCard label="Time Saved" value={timeSaved} suffix="min" />
    <StatCard label="Applications" value={applicationsCount} />
  </div>
);

const FilterTabs = ({
  active,
  onChange,
}: {
  active: string;
  onChange: (filter: string) => void;
}) => {
  const filters = ['all', 'pending', 'filled', 'submitted', 'failed'];
  return (
    <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide pb-1 -mx-2 px-2">
      {filters.map((filter) => (
        <button
          key={filter}
          onClick={() => onChange(filter)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
            active === filter
              ? 'bg-[var(--text-primary)] text-[var(--bg-primary)]'
              : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
          }`}
        >
          {filter.charAt(0).toUpperCase() + filter.slice(1)}
        </button>
      ))}
    </div>
  );
};

const BulkSection = ({
  urls,
  onUrlsChange,
  onAdd,
  onProcess,
  stats,
  isProcessing,
}: {
  urls: string;
  onUrlsChange: (urls: string) => void;
  onAdd: () => void;
  onProcess: () => void;
  stats: { pending: number; completed: number; failed: number } | null;
  isProcessing: boolean;
}) => (
  <div className="card space-y-4">
    <div className="flex items-center gap-2">
      <Link2 className="w-4 h-4 text-[var(--text-tertiary)]" />
      <h3 className="text-sm font-semibold text-[var(--text-primary)]">Bulk Apply</h3>
    </div>

    <textarea
      value={urls}
      onChange={(e) => onUrlsChange(e.target.value)}
      placeholder="Paste job URLs here (one per line)…"
      className="input h-24 resize-none"
      aria-label="Job URLs for bulk application"
    />

    <div className="flex gap-2">
      <button onClick={onAdd} className="btn btn-secondary flex-1">
        <Plus className="w-4 h-4" />
        Add to Queue
      </button>
      <button
        onClick={onProcess}
        disabled={isProcessing || !stats || stats.pending === 0}
        className="btn btn-primary flex-1"
      >
        {isProcessing ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Processing…
          </>
        ) : (
          <>
            <Play className="w-4 h-4" />
            Process Queue
          </>
        )}
      </button>
    </div>

    {stats && (stats.pending > 0 || stats.completed > 0 || stats.failed > 0) && (
      <div className="flex items-center justify-center gap-4 text-xs">
        <span className="text-[var(--text-tertiary)]">
          Pending: <span className="font-semibold text-amber-400">{stats.pending}</span>
        </span>
        <span className="text-[var(--text-tertiary)]">
          Done: <span className="font-semibold text-emerald-400">{stats.completed}</span>
        </span>
        <span className="text-[var(--text-tertiary)]">
          Failed: <span className="font-semibold text-rose-400">{stats.failed}</span>
        </span>
      </div>
    )}
  </div>
);

const SettingsSection = ({
  config,
  onUpdate,
}: {
  config: AppConfig | null;
  onUpdate: (config: Partial<AppConfig>) => void;
}) => {
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');

  if (!config) return null;

  const aiProviders = [
    { value: 'openai', label: 'OpenAI' },
    { value: 'anthropic', label: 'Anthropic' },
    { value: 'google', label: 'Google' },
    { value: 'ollama', label: 'Ollama (Local)' },
    { value: 'lmstudio', label: 'LM Studio (Local)' },
  ];

  const handleTestConnection = async () => {
    setTestStatus('testing');
    setTestMessage('');
    try {
      const res = await fetch(`${API_BASE}/config/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ai: config.ai }),
      });
      const data = await res.json();
      if (data.success) {
        setTestStatus('success');
        setTestMessage('Connected successfully');
      } else {
        setTestStatus('error');
        setTestMessage(data.error || 'Connection failed');
      }
    } catch {
      setTestStatus('error');
      setTestMessage('Failed to connect to API');
    }
    setTimeout(() => setTestStatus('idle'), 3000);
  };

  return (
    <div className="space-y-6">
      <div className="card space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-blue-500" />
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">AI Configuration</h3>
        </div>

        <div className="space-y-3">
          <label className="label">Provider</label>
          <select
            value={config.ai.provider}
            onChange={(e) => onUpdate({ ai: { ...config.ai, provider: e.target.value as any } })}
            className="input appearance-none cursor-pointer"
            aria-label="AI provider"
          >
            {aiProviders.map((provider) => (
              <option key={provider.value} value={provider.value}>
                {provider.label}
              </option>
            ))}
          </select>
        </div>

        {['openai', 'anthropic', 'google'].includes(config.ai.provider) && (
          <div className="space-y-3">
            <label className="label">API Key</label>
            <input
              type="password"
              value={config.ai.apiKey || ''}
              onChange={(e) => onUpdate({ ai: { ...config.ai, apiKey: e.target.value } })}
              placeholder={`Enter ${config.ai.provider.toUpperCase()} API key…`}
              className="input font-mono"
              aria-label="API key"
            />
          </div>
        )}

        {['ollama', 'lmstudio'].includes(config.ai.provider) && (
          <div className="space-y-3">
            <label className="label">Local Endpoint</label>
            <input
              type="text"
              value={config.ai.baseUrl || ''}
              onChange={(e) => onUpdate({ ai: { ...config.ai, baseUrl: e.target.value } })}
              placeholder={
                config.ai.provider === 'ollama' ? 'http://localhost:11434' : 'http://localhost:1234'
              }
              className="input font-mono"
              aria-label="Local endpoint URL"
            />
          </div>
        )}

        <div className="space-y-3">
          <label className="label">Model</label>
          <input
            type="text"
            value={config.ai.model || ''}
            onChange={(e) => onUpdate({ ai: { ...config.ai, model: e.target.value } })}
            placeholder="e.g., gpt-4, claude-3, llama3"
            className="input"
            aria-label="AI model"
          />
        </div>

        <button
          onClick={handleTestConnection}
          disabled={testStatus === 'testing'}
          className={`btn w-full ${
            testStatus === 'success'
              ? 'btn-primary bg-emerald-500 hover:bg-emerald-600'
              : testStatus === 'error'
                ? 'btn-secondary border-rose-500/50 text-rose-400'
                : 'btn-secondary'
          }`}
        >
          {testStatus === 'testing' ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Testing…
            </>
          ) : testStatus === 'success' ? (
            <>
              <CheckCircle className="w-4 h-4" />
              Connected
            </>
          ) : testStatus === 'error' ? (
            <>
              <AlertCircle className="w-4 h-4" />
              {testMessage}
            </>
          ) : (
            <>
              <CheckCircle className="w-4 h-4" />
              Test Connection
            </>
          )}
        </button>
      </div>

      <div className="card space-y-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-500" />
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Preferences</h3>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">Auto-submit</p>
              <p className="text-xs text-[var(--text-tertiary)]">
                Automatically submit after filling
              </p>
            </div>
            <button
              role="switch"
              aria-checked={config.application.autoSubmit}
              onClick={() =>
                onUpdate({
                  application: {
                    ...config.application,
                    autoSubmit: !config.application.autoSubmit,
                  },
                })
              }
              className="toggle"
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">Vault Encryption</p>
              <p className="text-xs text-[var(--text-tertiary)]">AES-256 profile protection</p>
            </div>
            <button
              role="switch"
              aria-checked={config.application.vaultEncryption}
              onClick={() =>
                onUpdate({
                  application: {
                    ...config.application,
                    vaultEncryption: !config.application.vaultEncryption,
                  },
                })
              }
              className="toggle"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

const PreviewModal = ({ app, onClose }: { app: Application; onClose: () => void }) => (
  <div
    className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in overscroll-contain"
    onClick={(e) => e.target === e.currentTarget && onClose()}
    role="dialog"
    aria-modal="true"
    aria-labelledby="preview-title"
  >
    <div className="bg-[var(--bg-secondary)] w-full sm:max-w-lg sm:rounded-xl rounded-t-xl h-[85vh] sm:h-auto sm:max-h-[85vh] flex flex-col animate-slide-up sm:animate-scale-in">
      <div className="flex items-center justify-between p-4 border-b border-[var(--border-subtle)] shrink-0">
        <div>
          <h3 id="preview-title" className="text-base font-semibold text-[var(--text-primary)]">
            Generated Documents
          </h3>
          <p className="text-xs text-[var(--text-tertiary)]">{app.company}</p>
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] transition-colors"
          aria-label="Close preview"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {app.generated_resume && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
              <FileText className="w-4 h-4" />
              Resume
            </div>
            <div className="p-3 bg-[var(--bg-primary)] rounded-lg border border-[var(--border-subtle)]">
              <pre className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap font-mono leading-relaxed max-h-48 overflow-y-auto">
                {app.generated_resume}
              </pre>
            </div>
          </div>
        )}

        {app.generated_cover_letter && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
              <FileText className="w-4 h-4" />
              Cover Letter
            </div>
            <div className="p-3 bg-[var(--bg-primary)] rounded-lg border border-[var(--border-subtle)]">
              <pre className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap font-mono leading-relaxed max-h-48 overflow-y-auto">
                {app.generated_cover_letter}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  </div>
);

const ProfileFormModal = ({
  profile,
  onSave,
  onCancel,
  onImport,
  isSaving,
}: {
  profile: Partial<Profile> | null;
  onSave: () => void;
  onCancel: () => void;
  onImport: () => void;
  isSaving: boolean;
}) => {
  const [form, setForm] = useState<Partial<Profile>>(profile || {});

  const updateField = (field: keyof Profile, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in overscroll-contain">
      <div className="bg-[var(--bg-secondary)] w-full sm:max-w-lg sm:rounded-xl rounded-t-xl h-[85vh] sm:h-auto sm:max-h-[85vh] flex flex-col animate-slide-up sm:animate-scale-in">
        <div className="flex items-center justify-between p-4 border-b border-[var(--border-subtle)] shrink-0">
          <h3 className="text-base font-semibold text-[var(--text-primary)]">
            {profile?.name ? 'Edit Profile' : 'Create Profile'}
          </h3>
          <button
            onClick={onCancel}
            className="p-2 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] transition-colors"
            aria-label="Close form"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="name" className="label">
                Full Name
              </label>
              <input
                id="name"
                type="text"
                value={form.name || ''}
                onChange={(e) => updateField('name', e.target.value)}
                placeholder="John Doe"
                className="input"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="email" className="label">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={form.email || ''}
                onChange={(e) => updateField('email', e.target.value)}
                placeholder="john@example.com"
                className="input"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="phone" className="label">
                Phone
              </label>
              <input
                id="phone"
                type="tel"
                value={form.phone || ''}
                onChange={(e) => updateField('phone', e.target.value)}
                placeholder="+1 (555) 123-4567"
                className="input"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="location" className="label">
                Location
              </label>
              <input
                id="location"
                type="text"
                value={form.location || ''}
                onChange={(e) => updateField('location', e.target.value)}
                placeholder="San Francisco, CA"
                className="input"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="linkedin" className="label">
              LinkedIn URL
            </label>
            <input
              id="linkedin"
              type="url"
              value={form.linkedin_url || ''}
              onChange={(e) => updateField('linkedin_url', e.target.value)}
              placeholder="https://linkedin.com/in/johndoe"
              className="input"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="github" className="label">
              GitHub URL
            </label>
            <input
              id="github"
              type="url"
              value={form.github_url || ''}
              onChange={(e) => updateField('github_url', e.target.value)}
              placeholder="https://github.com/johndoe"
              className="input"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="portfolio" className="label">
              Portfolio URL
            </label>
            <input
              id="portfolio"
              type="url"
              value={form.portfolio_url || ''}
              onChange={(e) => updateField('portfolio_url', e.target.value)}
              placeholder="https://johndoe.com"
              className="input"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="skills" className="label">
              Skills (comma-separated)
            </label>
            <textarea
              id="skills"
              value={(form.skills as unknown as string[])?.join(', ') || ''}
              onChange={(e) => {
                const skills = e.target.value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean);
                updateField('skills' as keyof Profile, skills as any);
              }}
              placeholder="React, TypeScript, Node.js…"
              className="input h-20 resize-none"
            />
          </div>
        </div>

        <div className="p-4 border-t border-[var(--border-subtle)] flex gap-3 shrink-0">
          <button onClick={onImport} className="btn btn-secondary flex-1" disabled={isSaving}>
            <Upload className="w-4 h-4" />
            Import
          </button>
          <button
            onClick={onSave}
            className="btn btn-primary flex-1"
            disabled={isSaving || !form.name || !form.email}
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                Save Profile
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

const FILL_DISPLAY_NAMES: Record<string, string> = {
  firstName: 'First name',
  lastName: 'Last name',
  fullName: 'Full name',
  email: 'Email',
  phone: 'Phone',
  linkedin: 'LinkedIn',
  linkedinUrl: 'LinkedIn',
  github: 'GitHub',
  portfolio: 'Portfolio',
  location: 'Location',
  resume_upload: 'Resume file',
};

const FillReportCard = ({
  report,
  onDismiss,
  onRefill,
}: {
  report: { filled: Array<{ key: string; value: string }>; skipped: number };
  onDismiss: () => void;
  onRefill: (fieldKey: string, value: string) => Promise<boolean>;
}) => {
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [refillState, setRefillState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

  if (report.filled.length === 0) return null;

  const startEdit = (key: string, value: string) => {
    if (key === 'resume_upload') return;
    setEditingKey(key);
    setEditValue(value);
    setRefillState('idle');
  };

  const cancelEdit = () => {
    setEditingKey(null);
    setEditValue('');
    setRefillState('idle');
  };

  const commitRefill = async () => {
    if (!editingKey || !editValue.trim()) return;
    setRefillState('loading');
    const success = await onRefill(editingKey, editValue.trim());
    setRefillState(success ? 'success' : 'error');
    if (success) {
      setTimeout(() => {
        setEditingKey(null);
        setEditValue('');
        setRefillState('idle');
      }, 1200);
    }
  };

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CheckCircle className="w-4 h-4 text-emerald-400" />
          <span className="text-sm font-semibold text-[var(--text-primary)]">
            {report.filled.length} field{report.filled.length !== 1 ? 's' : ''} filled
          </span>
        </div>
        <button
          onClick={onDismiss}
          className="p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]"
          aria-label="Dismiss"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {report.filled.map(({ key, value }) => {
          const isEditing = editingKey === key;
          const isResume = key === 'resume_upload';
          return (
            <button
              key={key}
              onClick={() => startEdit(key, value)}
              disabled={isResume}
              title={isResume ? undefined : 'Click to correct'}
              className={`px-2 py-0.5 rounded-full text-xs border transition-colors flex items-center gap-1 ${
                isEditing
                  ? 'bg-blue-500/20 text-blue-300 border-blue-500/40'
                  : isResume
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 cursor-default'
                    : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-blue-500/10 hover:text-blue-300 hover:border-blue-500/30'
              }`}
            >
              {FILL_DISPLAY_NAMES[key] || key}
              {!isResume && <Edit3 className="w-2.5 h-2.5 opacity-50" />}
            </button>
          );
        })}
      </div>

      {editingKey && (
        <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 space-y-2">
          <p className="text-xs text-[var(--text-tertiary)]">
            Correct{' '}
            <span className="text-blue-300 font-medium">
              {FILL_DISPLAY_NAMES[editingKey] || editingKey}
            </span>
          </p>
          <input
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRefill();
              if (e.key === 'Escape') cancelEdit();
            }}
            className="input text-sm py-1.5"
            autoFocus
            disabled={refillState === 'loading'}
          />
          <div className="flex gap-2">
            <button
              onClick={cancelEdit}
              disabled={refillState === 'loading'}
              className="btn btn-secondary btn-sm flex-1"
            >
              Cancel
            </button>
            <button
              onClick={commitRefill}
              disabled={refillState === 'loading' || !editValue.trim()}
              className={`btn btn-sm flex-1 ${
                refillState === 'success'
                  ? 'btn-primary bg-emerald-500 hover:bg-emerald-600'
                  : refillState === 'error'
                    ? 'btn-secondary border-rose-500/50 text-rose-400'
                    : 'btn-primary'
              }`}
            >
              {refillState === 'loading' ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Filling…
                </>
              ) : refillState === 'success' ? (
                <>
                  <CheckCircle className="w-3.5 h-3.5" />
                  Done
                </>
              ) : refillState === 'error' ? (
                <>
                  <AlertCircle className="w-3.5 h-3.5" />
                  Failed
                </>
              ) : (
                <>
                  <RefreshCcw className="w-3.5 h-3.5" />
                  Re-fill
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {report.skipped > 0 && (
        <p className="text-xs text-[var(--text-tertiary)]">
          {report.skipped} field{report.skipped !== 1 ? 's' : ''} may need manual review
        </p>
      )}
    </div>
  );
};

const AnalyticsSection = ({ applications }: { applications: Application[] }) => {
  if (applications.length === 0) {
    return (
      <div className="card">
        <EmptyState
          icon={Target}
          title="No data yet"
          description="Apply to some jobs to see your analytics"
        />
      </div>
    );
  }

  const total = applications.length;
  const submitted = applications.filter((a) => a.status === 'submitted').length;
  const failed = applications.filter((a) => a.status === 'failed').length;
  const pending = applications.filter((a) => a.status === 'pending').length;
  const filled = applications.filter((a) => a.status === 'filled').length;
  const successRate = total > 0 ? Math.round((submitted / total) * 100) : 0;

  // Platform breakdown
  const platformCounts: Record<string, number> = {};
  for (const app of applications) {
    platformCounts[app.platform] = (platformCounts[app.platform] || 0) + 1;
  }
  const topPlatforms = Object.entries(platformCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  // Last 7 days
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentCount = applications.filter(
    (a) => Date.parse(a.applied_at || a.created_at || '') > sevenDaysAgo
  ).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="card text-center space-y-1">
          <p className="text-2xl font-bold text-[var(--text-primary)]">{total}</p>
          <p className="text-xs text-[var(--text-tertiary)]">Total Applied</p>
        </div>
        <div className="card text-center space-y-1">
          <p className="text-2xl font-bold text-emerald-400">{successRate}%</p>
          <p className="text-xs text-[var(--text-tertiary)]">Submitted Rate</p>
        </div>
        <div className="card text-center space-y-1">
          <p className="text-2xl font-bold text-blue-400">{recentCount}</p>
          <p className="text-xs text-[var(--text-tertiary)]">Last 7 Days</p>
        </div>
        <div className="card text-center space-y-1">
          <p className="text-2xl font-bold text-rose-400">{failed}</p>
          <p className="text-xs text-[var(--text-tertiary)]">Failed</p>
        </div>
      </div>

      <div className="card space-y-3">
        <h4 className="text-sm font-semibold text-[var(--text-primary)]">Status Breakdown</h4>
        {[
          { label: 'Submitted', count: submitted, color: 'bg-emerald-400' },
          { label: 'Filled', count: filled, color: 'bg-blue-400' },
          { label: 'Pending', count: pending, color: 'bg-amber-400' },
          { label: 'Failed', count: failed, color: 'bg-rose-400' },
        ].map(({ label, count, color }) => (
          <div key={label} className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-[var(--text-secondary)]">{label}</span>
              <span className="text-[var(--text-tertiary)]">{count}</span>
            </div>
            <div className="h-1.5 rounded-full bg-[var(--bg-tertiary)] overflow-hidden">
              <div
                className={`h-full rounded-full ${color}`}
                style={{ width: total > 0 ? `${(count / total) * 100}%` : '0%' }}
              />
            </div>
          </div>
        ))}
      </div>

      {topPlatforms.length > 0 && (
        <div className="card space-y-3">
          <h4 className="text-sm font-semibold text-[var(--text-primary)]">Top Platforms</h4>
          {topPlatforms.map(([platform, count]) => (
            <div key={platform} className="flex justify-between items-center text-xs">
              <span className="text-[var(--text-secondary)] capitalize">{platform}</span>
              <span className="px-2 py-0.5 rounded-full bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]">
                {count}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const App = () => {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'history' | 'analytics' | 'profile' | 'settings'>(
    'dashboard'
  );
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [timeSaved, setTimeSaved] = useState(0);
  const [applications, setApplications] = useState<Application[]>([]);
  const [recentApps, setRecentApps] = useState<Application[]>([]);
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
      setError('No active job URL detected');
      return;
    }

    if (!connected) {
      setError('API server not connected. Make sure to run "bun run api".');
      return;
    }

    setIsGeneratingDocs(true);
    setError(null);
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
      } else {
        setError(data.error || 'Failed to generate documents');
      }
    } catch (err) {
      setError('Failed to connect to API server. Make sure "bun run api" is running.');
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
    } catch (err) {
      console.error('Failed to update config', err);
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
      setRecentApps(appsData.slice(0, 10));
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
      } else {
        setError(data.error || 'Failed to save profile');
      }
    } catch (err) {
      setError('Failed to save profile');
    } finally {
      setIsSavingProfile(false);
    }
  };

  const deleteApplication = async (id: number) => {
    try {
      const res = await fetch(`${API_BASE}/applications/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setApplications((prev) => prev.filter((app) => app.id !== id));
        setRecentApps((prev) => prev.filter((app) => app.id !== id));
      }
    } catch (err) {
      console.error('Failed to delete application', err);
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
          setProfile(data.profile);
          setShowProfileForm(false);
        } else {
          setError(data.error || 'Failed to import profile');
        }
      } catch {
        setError('Failed to import profile');
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
      setError('Please enter at least one URL');
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
      } else {
        setError(data.error || 'Failed to add URLs');
      }
    } catch {
      setError('Failed to add URLs');
    }
  };

  const handleBulkProcess = async () => {
    setIsBulkProcessing(true);
    setError(null);
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
      } else {
        setError(data.error || 'Bulk processing failed');
      }
    } catch {
      setError('Bulk processing failed');
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

      // Step 1: Get profile (fast, local API call)
      const profileRes = await fetch(`${API_BASE}/profile`);
      if (!profileRes.ok) {
        throw new Error('Failed to load profile');
      }
      const profileData = await profileRes.json();

      if (!profileData || !profileData.name) {
        throw new Error('No profile found. Please set up your profile first.');
      }

      // Step 1.5: Detect form fields and get AI-backed fill plan as fallback
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
        // fillPlan is optional; proceed without it
      }

      // Step 1.6: Fetch resume PDF as base64 if already generated (for file upload fields)
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
          // resume upload is optional, continue without it
        }
      }

      // Step 2: Send profile directly to content script - it fills instantly using autocomplete
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
            // Workable/Ashby fields
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

        // For Ashby and other iframe-based platforms, also try to send to all frames
        try {
          const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
          console.log(
            'Autoply: Found frames:',
            frames?.map((f) => ({ id: f.frameId, url: f.url?.slice(0, 50) }))
          );

          for (const frame of frames || []) {
            if (frame.frameId !== 0) {
              try {
                console.log('Autoply: Trying to send to frame', frame.frameId);
                await chrome.tabs.sendMessage(tab.id, profilePayload, { frameId: frame.frameId });
                console.log('Autoply: Successfully sent to frame', frame.frameId);
              } catch (e) {
                console.log('Autoply: Could not send to frame', frame.frameId, e);
              }
            }
          }
        } catch (e) {
          console.log('Autoply: webNavigation error:', e);
        }

        if (fillResult?.success) {
          console.log('Autoply: Filled', fillResult.filled?.length || 0, 'fields');
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
        } else if (fillResult?.error) {
          throw new Error(fillResult.error);
        }
      } catch (fillError: any) {
        console.error('Fill execution failed:', fillError);
        throw new Error(fillError.message || 'Form fill failed');
      }

      await loadData();
    } catch (err: any) {
      console.error('Autofill failed', err);
      setError(err.message || 'Autofill failed unexpectedly');
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
                    <EmptyState
                      icon={History}
                      title="No applications yet"
                      description="Your application history will appear here"
                    />
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
            <div className="space-y-2">
              {applications.length > 0 ? (
                applications.map((app, i) => (
                  <div
                    key={app.id ?? `${app.url}-${app.created_at}`}
                    className="animate-fade-in"
                    style={{ animationDelay: `${i * 30}ms` }}
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
                  <EmptyState
                    icon={History}
                    title="No applications tracked"
                    description="Use autofill on a job page to start tracking"
                  />
                </div>
              )}
            </div>
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
          onSave={() => saveProfile(profile || {})}
          onCancel={() => setShowProfileForm(false)}
          onImport={importProfileFromResume}
          isSaving={isSavingProfile}
        />
      )}
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
