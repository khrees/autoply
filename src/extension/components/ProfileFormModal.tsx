import React, { useRef, useState } from 'react';
import {
  Upload,
  Save,
  Loader2,
  X,
} from 'lucide-react';
import type { Profile } from '../../types';
import { useFocusTrap } from '../hooks/useFocusTrap';

export const ProfileFormModal = ({
  profile,
  onSave,
  onCancel,
  onImport,
  isSaving,
}: {
  profile: Partial<Profile> | null;
  onSave: (formData: Partial<Profile>) => void;
  onCancel: () => void;
  onImport: () => void;
  isSaving: boolean;
}) => {
  const [form, setForm] = useState<Partial<Profile>>(profile || {});
  const containerRef = useRef<HTMLDivElement>(null);

  useFocusTrap(containerRef, { onClose: onCancel });

  const updateField = <K extends keyof Profile>(field: K, value: Profile[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in overscroll-contain">
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-form-title"
        className="bg-(--bg-secondary) w-full sm:max-w-lg sm:rounded-xl rounded-t-xl h-[85vh] sm:h-auto sm:max-h-[85vh] flex flex-col animate-slide-up sm:animate-scale-in"
      >
        <div className="flex items-center justify-between p-4 border-b border-(--border-subtle) shrink-0">
          <h3 id="profile-form-title" className="text-base font-semibold text-(--text-primary)">
            {profile?.name ? 'Edit Profile' : 'Create Profile'}
          </h3>
          <button
            onClick={onCancel}
            className="p-2 rounded-lg hover:bg-(--bg-tertiary) text-(--text-tertiary) transition-colors"
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
                updateField('skills', skills);
              }}
              placeholder="React, TypeScript, Node.js…"
              className="input h-20 resize-none"
            />
          </div>
        </div>

        <div className="p-4 border-t border-(--border-subtle) flex gap-3 shrink-0">
          <button onClick={onImport} className="btn btn-secondary flex-1" disabled={isSaving}>
            <Upload className="w-4 h-4" />
            Import
          </button>
          <button
            onClick={() => onSave(form)}
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
