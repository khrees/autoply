import React, { useState } from 'react';
import {
  CheckCircle,
  AlertCircle,
  Loader2,
  RefreshCcw,
  Edit3,
  X,
  ArrowRight,
  Info,
} from 'lucide-react';

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

export const FillReportCard = ({
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
    <div className="card space-y-4 animate-slide-up border-emerald-500/20 shadow-emerald-500/5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1 rounded-full bg-emerald-500/20">
            <CheckCircle className="w-4 h-4 text-emerald-400" />
          </div>
          <span className="text-sm font-bold text-(--text-primary) tracking-tight">
            Fill Report
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-800 text-zinc-400 font-medium">
            {report.filled.length} Fields
          </span>
        </div>
        <button
          onClick={onDismiss}
          className="p-1 rounded-full hover:bg-zinc-800 text-(--text-tertiary) transition-colors"
          aria-label="Dismiss"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {report.filled.map(({ key, value }) => {
          const isEditing = editingKey === key;
          const isResume = key === 'resume_upload';
          return (
            <button
              key={key}
              onClick={() => startEdit(key, value)}
              disabled={isResume}
              className={`px-2.5 py-1 rounded-lg text-[11px] border transition-all duration-200 flex items-center gap-1.5 ${
                isEditing
                  ? 'bg-blue-500/20 text-blue-300 border-blue-500/40 ring-1 ring-blue-500/20'
                  : isResume
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 cursor-default'
                    : 'bg-zinc-800/50 text-zinc-300 border-zinc-700/50 hover:bg-blue-500/10 hover:text-blue-300 hover:border-blue-500/30'
              }`}
            >
              {isResume && <CheckCircle className="w-2.5 h-2.5" />}
              <span className="font-medium">{FILL_DISPLAY_NAMES[key] || key}</span>
              {!isResume && <Edit3 className="w-2.5 h-2.5 opacity-40" />}
            </button>
          );
        })}
      </div>

      {editingKey && (
        <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-4 space-y-3 animate-scale-in shadow-inner">
          <div className="flex items-center gap-2 text-xs text-blue-300/80">
            <Info className="w-3 h-3" />
            <span>Correcting <span className="font-bold">{FILL_DISPLAY_NAMES[editingKey] || editingKey}</span></span>
          </div>
          <div className="relative">
            <input
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRefill();
                if (e.key === 'Escape') cancelEdit();
              }}
              className="input text-sm py-2 pl-3 pr-10 focus:ring-blue-500/20"
              autoFocus
              disabled={refillState === 'loading'}
            />
            {refillState === 'loading' && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={cancelEdit}
              disabled={refillState === 'loading'}
              className="btn btn-secondary btn-sm flex-1 opacity-70 hover:opacity-100 transition-opacity"
            >
              Cancel
            </button>
            <button
              onClick={commitRefill}
              disabled={refillState === 'loading' || !editValue.trim()}
              className={`btn btn-sm flex-1 font-bold transition-all ${
                refillState === 'success'
                  ? 'bg-emerald-500 text-white shadow-emerald-500/20'
                  : refillState === 'error'
                    ? 'bg-rose-500 text-white shadow-rose-500/20'
                    : 'btn-primary shadow-blue-500/20'
              }`}
            >
              {refillState === 'loading' ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Updating...
                </span>
              ) : refillState === 'success' ? (
                <span className="flex items-center gap-2">
                  <CheckCircle className="w-3.5 h-3.5" />
                  Fixed
                </span>
              ) : refillState === 'error' ? (
                <span className="flex items-center gap-2">
                  <AlertCircle className="w-3.5 h-3.5" />
                  Error
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  Update Field
                  <ArrowRight className="w-3.5 h-3.5" />
                </span>
              )}
            </button>
          </div>
        </div>
      )}

      {report.skipped > 0 && (
        <div className="flex items-center gap-2 p-2 rounded-lg bg-amber-500/5 border border-amber-500/10 text-amber-400/80">
          <AlertCircle className="w-3 h-3 flex-shrink-0" />
          <p className="text-[10px] font-medium italic">
            {report.skipped} field{report.skipped !== 1 ? 's' : ''} may require manual attention
          </p>
        </div>
      )}
    </div>
  );
};
