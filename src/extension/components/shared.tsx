import React from 'react';

export const SkeletonLine = ({
  width = '100%',
  height = '1rem',
  className = '',
}: {
  width?: string;
  height?: string;
  className?: string;
}) => <div className={`skeleton ${className}`} style={{ width, height }} />;

export const SkeletonCard = () => (
  <div className="card">
    <div className="flex items-center gap-4 mb-4">
      <div className="skeleton w-12 h-12 rounded-lg" />
      <div className="flex-1">
        <SkeletonLine width="60%" height="1rem" />
        <SkeletonLine width="40%" height="0.75rem" className="mt-2" />
      </div>
    </div>
    <SkeletonLine width="100%" height="3rem" />
  </div>
);

export const LoadingState = () => (
  <div className="flex flex-col items-center justify-center h-full gap-4">
    <div className="w-10 h-10 border-2 border-zinc-800 border-t-blue-500 rounded-full animate-spin" />
    <p className="text-sm text-zinc-500">Connecting to Autoply…</p>
  </div>
);

export const StatCard = ({
  label,
  value,
  suffix = '',
}: {
  label: string;
  value: number | string;
  suffix?: string;
}) => (
  <div className="card p-4 flex flex-col gap-1">
    <span className="stat-label">{label}</span>
    <span className="stat-value text-(--text-primary)">
      {value}
      {suffix && (
        <span className="text-sm font-normal text-(--text-tertiary) ml-0.5">{suffix}</span>
      )}
    </span>
  </div>
);

export const QuickStats = ({
  timeSaved,
  applicationsCount,
}: {
  timeSaved: number;
  applicationsCount: number;
}) => (
  <div className="grid grid-cols-2 gap-3">
    <StatCard label="Time Saved" value={timeSaved} suffix="min" />
    <StatCard label="Applications" value={applicationsCount} />
  </div>
);

export const EmptyState = ({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  action?: React.ReactNode;
}) => (
  <div className="empty-state">
    <div className="empty-state-icon">
      <Icon className="w-6 h-6" />
    </div>
    <h3 className="empty-state-title">{title}</h3>
    <p className="empty-state-description">{description}</p>
    {action && <div className="mt-4">{action}</div>}
  </div>
);

export const PhoneIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
  </svg>
);
