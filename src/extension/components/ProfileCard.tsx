import React from 'react';
import {
  User,
  Plus,
  MapPin,
  Linkedin,
  Github,
  Globe,
} from 'lucide-react';
import type { Profile } from '../../types';
import { EmptyState, PhoneIcon } from './shared';

export const ProfileCard = ({
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
            <PhoneIcon className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
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
