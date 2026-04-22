import React, { useRef } from 'react';
import { FileText, X } from 'lucide-react';
import type { Application } from '../../types';
import { useFocusTrap } from '../hooks/useFocusTrap';

export const PreviewModal = ({ app, onClose }: { app: Application; onClose: () => void }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useFocusTrap(containerRef, { onClose });

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in overscroll-contain"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="preview-title"
    >
      <div
        ref={containerRef}
        className="bg-[var(--bg-secondary)] w-full sm:max-w-lg sm:rounded-xl rounded-t-xl h-[85vh] sm:h-auto sm:max-h-[85vh] flex flex-col animate-slide-up sm:animate-scale-in"
      >
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
};
