import React from 'react';
import { Zap, Sparkles, AlertCircle, Loader2, ArrowRight, X } from 'lucide-react';

export const ActionCard = ({
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
      <div>
        <h2 className="text-lg font-bold text-(--text-primary)">Apply Instantly</h2>
        <p className="text-xs text-(--text-tertiary)">AI-powered form autofill</p>
      </div>

      <p className="text-sm text-(--text-secondary) leading-relaxed">
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
