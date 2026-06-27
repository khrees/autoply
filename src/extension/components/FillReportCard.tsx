import React, { useState } from 'react';
import {
  CheckCircle,
  AlertCircle,
  Loader2,
  RefreshCcw,
  Edit3,
  X,
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
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CheckCircle className="w-4 h-4 text-emerald-400" />
          <span className="text-sm font-semibold text-(--text-primary)">
            {report.filled.length} field{report.filled.length !== 1 ? 's' : ''} filled
          </span>
        </div>
        <button
          onClick={onDismiss}
          className="p-1 rounded hover:bg-(--bg-tertiary) text-(--text-tertiary)"
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
          <p className="text-xs text-(--text-tertiary)">
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
        <p className="text-xs text-(--text-tertiary)">
          {report.skipped} field{report.skipped !== 1 ? 's' : ''} may need manual review
        </p>
      )}
    </div>
  );
};
