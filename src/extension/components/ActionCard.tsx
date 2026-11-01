import React, { useState, useEffect } from 'react';
import { Zap, Sparkles, AlertCircle, Loader2, ArrowRight, X } from 'lucide-react';



const FILL_STAGES = [
  'Analyzing form structure...',
  'Scanning for required fields...',
  'Mapping profile data...',
  'Optimizing AI responses...',
  'Injecting values into browser...',
  'Verifying filled fields...',
];

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
}) => {
  const [stageIndex, setStageIndex] = useState(0);


  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isApplying) {
      interval = setInterval(() => {
        setStageIndex((prev) => (prev + 1) % FILL_STAGES.length);
      }, 1500);
    } else {
      setStageIndex(0);
    }
    return () => clearInterval(interval);
  }, [isApplying]);

  return (
    <div className="card relative overflow-hidden group animate-fade-in">
      <div className="absolute top-0 right-0 p-6 opacity-[0.03] group-hover:opacity-[0.06] transition-opacity pointer-events-none">
        <Sparkles className="w-20 h-20 text-white" />
      </div>

      <div className="relative z-10 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-(--text-primary) tracking-tight">Apply Instantly</h2>
            <p className="text-xs text-(--text-tertiary)">AI-powered form autofill</p>
          </div>
          {connected && !isApplying && (
            <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-[10px] font-semibold uppercase tracking-wider border border-emerald-500/20">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Ready
            </div>
          )}
        </div>

        <p className="text-sm text-(--text-secondary) leading-relaxed opacity-80">
          Our AI scans the current page, detects form fields, and maps your profile data
          automatically.
        </p>

        {error && (
          <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg flex items-start gap-2 text-xs text-rose-300 animate-scale-in">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p>{error}</p>
              {error.includes('connection') && onRetry && (
                <button onClick={onRetry} className="mt-2 text-rose-200 underline font-medium">
                  Retry connection
                </button>
              )}
            </div>
            {onDismissError && (
              <button
                onClick={onDismissError}
                className="p-1 rounded hover:bg-rose-500/20 text-rose-300 transition-colors"
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
          className={`btn btn-primary btn-lg w-full shadow-lg transition-all duration-300 ${
            isApplying
              ? 'bg-navy-light opacity-90 scale-[0.98]'
              : 'hover:scale-[1.02] active:scale-[0.98] shadow-blue-500/20'
          }`}
        >
          {isApplying ? (
            <div className="flex items-center gap-3">
              <Loader2 className="w-5 h-5 animate-spin text-white" />
              <span className="animate-pulse text-white">
                {FILL_STAGES[stageIndex]}
              </span>
            </div>
          ) : !connected ? (
            <div className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5" />
              <span className="opacity-80">Server Offline</span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5" />
              <span className="tracking-wide">Fill Application</span>
              <ArrowRight className="w-4 h-4 ml-1 opacity-70" />
            </div>
          )}
        </button>
      </div>
    </div>
  );
};
