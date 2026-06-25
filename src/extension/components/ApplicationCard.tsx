import React from 'react';
import {
  CheckCircle,
  FileText,
  Clock,
  AlertCircle,
  Eye,
  Trash2,
} from 'lucide-react';
import type { Application } from '../../types';
import { useConfirm } from './ConfirmDialog';

export const StatusBadge = ({ status }: { status: string }) => {
  const statusConfig: Record<string, { class: string; label: string }> = {
    submitted: { class: 'badge-success', label: 'Submitted' },
    filled: { class: 'badge-info', label: 'Filled' },
    pending: { class: 'badge-warning', label: 'Pending' },
    failed: { class: 'badge-error', label: 'Failed' },
  };
  const config = statusConfig[status] || statusConfig.pending;
  return <span className={`badge ${config.class}`}>{config.label}</span>;
};

export const FilterTabs = ({
  active,
  onChange,
}: {
  active: string;
  onChange: (filter: string) => void;
}) => {
  const filters = ['all', 'pending', 'filled', 'submitted', 'failed'];
  return (
    <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide pb-1 -mx-2 px-2">
      {filters.map((filter) => (
        <button
          key={filter}
          onClick={() => onChange(filter)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
            active === filter
              ? 'bg-[var(--text-primary)] text-[var(--bg-primary)]'
              : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
          }`}
        >
          {filter.charAt(0).toUpperCase() + filter.slice(1)}
        </button>
      ))}
    </div>
  );
};

export const ApplicationCard = ({
  application,
  onDelete,
  onPreview,
}: {
  application: Application;
  onDelete: () => void;
  onPreview?: () => void;
}) => {
  const confirm = useConfirm();

  const statusIcon = {
    submitted: <CheckCircle className="w-4 h-4 text-emerald-400" />,
    filled: <FileText className="w-4 h-4 text-blue-400" />,
    pending: <Clock className="w-4 h-4 text-amber-400" />,
    failed: <AlertCircle className="w-4 h-4 text-rose-400" />,
  };

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: 'Delete application',
      message: `Are you sure you want to delete the "${
        application.company || 'Unknown'
      }" application? This action cannot be undone.`,
      confirmLabel: 'Delete',
      variant: 'destructive',
    });
    if (confirmed) onDelete();
  };

  return (
    <div className="card card-interactive p-4 flex items-center gap-4 group">
      <div className="w-10 h-10 rounded-lg bg-[var(--bg-tertiary)] flex items-center justify-center text-[var(--text-tertiary)] group-hover:bg-blue-500/10 group-hover:text-blue-400 transition-colors">
        {statusIcon[application.status as keyof typeof statusIcon] || statusIcon.pending}
      </div>

      <div className="flex-1 min-w-0">
        <h4 className="text-sm font-semibold text-[var(--text-primary)] truncate">
          {application.company || 'Unknown Company'}
        </h4>
        <p className="text-xs text-[var(--text-tertiary)] truncate">
          {application.job_title || 'Untitled position'}
        </p>
      </div>

      <StatusBadge status={application.status} />

      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {(application.generated_resume || application.generated_cover_letter) && (
          <button
            onClick={onPreview}
            className="p-2 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
            aria-label="Preview documents"
            title="Preview documents"
          >
            <Eye className="w-4 h-4" />
          </button>
        )}
        <button
          onClick={handleDelete}
          className="p-2 rounded-lg hover:bg-rose-500/10 text-[var(--text-tertiary)] hover:text-rose-400 transition-colors"
          aria-label="Delete application"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
