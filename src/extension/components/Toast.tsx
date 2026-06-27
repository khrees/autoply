import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { CheckCircle, AlertCircle, X, Info, AlertTriangle } from 'lucide-react';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration: number;
  createdAt: number;
}

interface ToastContextValue {
  success: (message: string, duration?: number) => void;
  error: (message: string, duration?: number) => void;
  warning: (message: string, duration?: number) => void;
  info: (message: string, duration?: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let toastId = 0;

const ICONS: Record<ToastType, React.ElementType> = {
  success: CheckCircle,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

const ICON_COLORS: Record<ToastType, string> = {
  success: 'text-emerald-400',
  error: 'text-rose-400',
  warning: 'text-amber-400',
  info: 'text-blue-400',
};

const BAR_COLORS: Record<ToastType, string> = {
  success: 'bg-emerald-400',
  error: 'bg-rose-400',
  warning: 'bg-amber-400',
  info: 'bg-blue-400',
};

const BORDER_COLORS: Record<ToastType, string> = {
  success: 'border-emerald-500/20',
  error: 'border-rose-500/20',
  warning: 'border-amber-500/20',
  info: 'border-blue-500/20',
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const [exiting, setExiting] = useState(false);
  const Icon = ICONS[toast.type];

  const handleDismiss = useCallback(() => {
    setExiting(true);
    setTimeout(() => onDismiss(toast.id), 200);
  }, [toast.id, onDismiss]);

  useEffect(() => {
    const timer = setTimeout(() => {
      handleDismiss();
    }, toast.duration);
    return () => clearTimeout(timer);
  }, [toast.duration, handleDismiss]);

  return (
    <div
      role="alert"
      aria-live="polite"
      className={`toast ${exiting ? 'toast-exit' : 'toast-enter'} ${BORDER_COLORS[toast.type]}`}
    >
      <div className="toast-progress">
        <div
          className={`toast-progress-bar ${BAR_COLORS[toast.type]}`}
          style={{ animationDuration: `${toast.duration}ms` }}
        />
      </div>
      <div className="flex items-start gap-2.5 p-3">
        <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${ICON_COLORS[toast.type]}`} />
        <p className="flex-1 text-xs text-(--text-primary) leading-relaxed">{toast.message}</p>
        <button
          onClick={handleDismiss}
          className="p-0.5 rounded hover:bg-white/10 text-(--text-tertiary) transition-colors shrink-0"
          aria-label="Dismiss"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((type: ToastType, message: string, duration = 4000) => {
    const id = `toast-${++toastId}`;
    setToasts((prev) => [
      ...prev.slice(-4),
      { id, type, message, duration, createdAt: Date.now() },
    ]);
  }, []);

  const contextValue: ToastContextValue = {
    success: useCallback((msg, dur) => addToast('success', msg, dur), [addToast]),
    error: useCallback((msg, dur) => addToast('error', msg, dur ?? 6000), [addToast]),
    warning: useCallback((msg, dur) => addToast('warning', msg, dur), [addToast]),
    info: useCallback((msg, dur) => addToast('info', msg, dur), [addToast]),
  };

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      {toasts.length > 0 && (
        <div
          className="fixed top-2 left-2 right-2 z-100 flex flex-col gap-2 pointer-events-none"
          aria-label="Notifications"
        >
          {toasts.map((toast) => (
            <div key={toast.id} className="pointer-events-auto">
              <ToastItem toast={toast} onDismiss={dismiss} />
            </div>
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}
