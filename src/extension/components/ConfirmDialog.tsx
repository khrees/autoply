import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'destructive';
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

function ConfirmSheet({
  options,
  onResolve,
}: {
  options: ConfirmOptions;
  onResolve: (result: boolean) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isDestructive = options.variant === 'destructive';

  useFocusTrap(containerRef, { onClose: () => onResolve(false) });

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[90] flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in"
      onClick={(e) => e.target === e.currentTarget && onResolve(false)}
    >
      <div
        ref={containerRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        className="bg-(--bg-secondary) w-full sm:max-w-sm sm:rounded-xl rounded-t-xl animate-slide-up sm:animate-scale-in overflow-hidden"
      >
        <div className="p-5 space-y-4">
          <div className="flex items-start gap-3">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                isDestructive
                  ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                  : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
              }`}
            >
              {isDestructive ? (
                <Trash2 className="w-5 h-5" />
              ) : (
                <AlertTriangle className="w-5 h-5" />
              )}
            </div>
            <div>
              <h3 id="confirm-title" className="text-sm font-semibold text-(--text-primary)">
                {options.title}
              </h3>
              <p id="confirm-message" className="text-xs text-(--text-tertiary) mt-1 leading-relaxed">
                {options.message}
              </p>
            </div>
          </div>
        </div>

        <div className="flex gap-3 p-4 pt-0">
          <button
            onClick={() => onResolve(false)}
            className="btn btn-secondary flex-1"
          >
            {options.cancelLabel || 'Cancel'}
          </button>
          <button
            onClick={() => onResolve(true)}
            className={`btn flex-1 ${
              isDestructive
                ? 'bg-rose-500 hover:bg-rose-600 text-white'
                : 'btn-primary'
            }`}
          >
            {options.confirmLabel || 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{
    options: ConfirmOptions;
    resolve: (result: boolean) => void;
  } | null>(null);

  const confirm: ConfirmFn = useCallback((options) => {
    return new Promise<boolean>((resolve) => {
      setState({ options, resolve });
    });
  }, []);

  const handleResolve = useCallback(
    (result: boolean) => {
      state?.resolve(result);
      setState(null);
    },
    [state]
  );

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && <ConfirmSheet options={state.options} onResolve={handleResolve} />}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within a ConfirmProvider');
  return ctx;
}
