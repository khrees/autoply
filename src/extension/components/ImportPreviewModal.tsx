import React, { useRef, useState } from 'react';
import {
  Eye,
  Save,
  Loader2,
  X,
  CheckCircle,
  Edit3,
} from 'lucide-react';
import type { Profile } from '../../types';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface ImportPreviewProps {
  data: Partial<Profile>;
  onSave: (data: Partial<Profile>) => void;
  onCancel: () => void;
  isSaving: boolean;
}

const FIELD_CONFIG: { key: keyof Profile; label: string; type?: string }[] = [
  { key: 'name', label: 'Full Name' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'phone', label: 'Phone', type: 'tel' },
  { key: 'location', label: 'Location' },
  { key: 'linkedin_url', label: 'LinkedIn', type: 'url' },
  { key: 'github_url', label: 'GitHub', type: 'url' },
  { key: 'portfolio_url', label: 'Portfolio', type: 'url' },
];

export const ImportPreviewModal = ({ data, onSave, onCancel, isSaving }: ImportPreviewProps) => {
  const [form, setForm] = useState<Partial<Profile>>(data);
  const [editingField, setEditingField] = useState<keyof Profile | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useFocusTrap(containerRef, { onClose: onCancel });

  const updateField = <K extends keyof Profile>(field: K, value: Profile[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const hasData = FIELD_CONFIG.some((f) => form[f.key]);

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in overscroll-contain"
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-preview-title"
        className="bg-(--bg-secondary) w-full sm:max-w-lg sm:rounded-xl rounded-t-xl h-[85vh] sm:h-auto sm:max-h-[85vh] flex flex-col animate-slide-up sm:animate-scale-in"
      >
        <div className="flex items-center justify-between p-4 border-b border-(--border-subtle) shrink-0">
          <div className="flex items-center gap-2">
            <Eye className="w-4 h-4 text-blue-400" />
            <h3 id="import-preview-title" className="text-base font-semibold text-(--text-primary)">
              Review Imported Data
            </h3>
          </div>
          <button
            onClick={onCancel}
            className="p-2 rounded-lg hover:bg-(--bg-tertiary) text-(--text-tertiary) transition-colors"
            aria-label="Cancel import"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <p className="text-xs text-(--text-tertiary) leading-relaxed">
            Review the extracted fields below. Click any field to edit before saving.
          </p>

          {FIELD_CONFIG.map((field) => {
            const value = form[field.key] as string | undefined;
            const isEditing = editingField === field.key;

            return (
              <div
                key={field.key}
                className={`rounded-lg border p-3 transition-colors ${
                  isEditing
                    ? 'border-blue-500/30 bg-blue-500/5'
                    : value
                      ? 'border-(--border-subtle) bg-(--bg-primary)'
                      : 'border-dashed border-(--border-subtle) bg-transparent'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[0.6875rem] font-medium text-(--text-tertiary) uppercase tracking-wider">
                    {field.label}
                  </label>
                  {value && !isEditing && (
                    <button
                      onClick={() => setEditingField(field.key)}
                      className="p-1 rounded hover:bg-(--bg-tertiary) text-(--text-tertiary)"
                      aria-label={`Edit ${field.label}`}
                    >
                      <Edit3 className="w-3 h-3" />
                    </button>
                  )}
                </div>
                {isEditing ? (
                  <div className="flex gap-2">
                    <input
                      type={field.type || 'text'}
                      value={(value as string) || ''}
                      onChange={(e) => updateField(field.key, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === 'Escape') setEditingField(null);
                      }}
                      className="input text-sm py-1.5 flex-1"
                      autoFocus
                    />
                    <button
                      onClick={() => setEditingField(null)}
                      className="btn btn-secondary btn-sm"
                    >
                      <CheckCircle className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <p className={`text-sm ${value ? 'text-(--text-primary)' : 'text-(--text-tertiary) italic'}`}>
                    {(value as string) || 'Not detected'}
                  </p>
                )}
              </div>
            );
          })}

          {/* Skills */}
          <div className="rounded-lg border border-(--border-subtle) bg-(--bg-primary) p-3">
            <label className="text-[0.6875rem] font-medium text-(--text-tertiary) uppercase tracking-wider mb-2 block">
              Skills
            </label>
            {form.skills && form.skills.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {form.skills.map((skill, i) => (
                  <span
                    key={i}
                    className="px-2 py-0.5 rounded-md bg-(--bg-tertiary) text-xs text-(--text-secondary) border border-(--border-subtle)"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-(--text-tertiary) italic">No skills detected</p>
            )}
          </div>
        </div>

        <div className="p-4 border-t border-(--border-subtle) flex gap-3 shrink-0">
          <button onClick={onCancel} className="btn btn-secondary flex-1" disabled={isSaving}>
            Discard
          </button>
          <button
            onClick={() => onSave(form)}
            className="btn btn-primary flex-1"
            disabled={isSaving || !hasData}
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
