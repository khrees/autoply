import React, { useState } from 'react';
import { Target } from 'lucide-react';
import type { Application } from '../../types';
import { EmptyState } from './shared';

type DateRange = '7d' | '30d' | 'all';

const DATE_RANGES: { key: DateRange; label: string; ms: number | null }[] = [
  { key: '7d', label: '7 days', ms: 7 * 24 * 60 * 60 * 1000 },
  { key: '30d', label: '30 days', ms: 30 * 24 * 60 * 60 * 1000 },
  { key: 'all', label: 'All time', ms: null },
];

export const AnalyticsSection = ({ applications }: { applications: Application[] }) => {
  const [dateRange, setDateRange] = useState<DateRange>('all');

  if (applications.length === 0) {
    return (
      <div className="card">
        <EmptyState
          icon={Target}
          title="No data yet"
          description="Apply to some jobs to see your analytics"
        />
      </div>
    );
  }

  // Filter by date range
  const rangeConfig = DATE_RANGES.find((r) => r.key === dateRange)!;
  const cutoff = rangeConfig.ms ? Date.now() - rangeConfig.ms : 0;
  const filtered = rangeConfig.ms
    ? applications.filter(
        (a) => Date.parse(a.applied_at || a.created_at || '') > cutoff
      )
    : applications;

  const total = filtered.length;
  const submitted = filtered.filter((a) => a.status === 'submitted').length;
  const failed = filtered.filter((a) => a.status === 'failed').length;
  const pending = filtered.filter((a) => a.status === 'pending').length;
  const filled = filtered.filter((a) => a.status === 'filled').length;
  const successRate = total > 0 ? Math.round((submitted / total) * 100) : 0;

  // Platform breakdown
  const platformCounts: Record<string, number> = {};
  for (const app of filtered) {
    platformCounts[app.platform] = (platformCounts[app.platform] || 0) + 1;
  }
  const topPlatforms = Object.entries(platformCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  // Recent 7 days (always from full list for the stat card)
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentCount = applications.filter(
    (a) => Date.parse(a.applied_at || a.created_at || '') > sevenDaysAgo
  ).length;

  return (
    <div className="space-y-4">
      {/* Date range filter */}
      <div className="flex items-center gap-1 p-1 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-lg">
        {DATE_RANGES.map((range) => (
          <button
            key={range.key}
            onClick={() => setDateRange(range.key)}
            className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              dateRange === range.key
                ? 'bg-[var(--accent-blue)] text-white shadow-sm'
                : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
            }`}
          >
            {range.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="card text-center space-y-1">
          <p className="text-2xl font-bold text-[var(--text-primary)]">{total}</p>
          <p className="text-xs text-[var(--text-tertiary)]">Total Applied</p>
        </div>
        <div className="card text-center space-y-1">
          <p className="text-2xl font-bold text-emerald-400">{successRate}%</p>
          <p className="text-xs text-[var(--text-tertiary)]">Submitted Rate</p>
        </div>
        <div className="card text-center space-y-1">
          <p className="text-2xl font-bold text-blue-400">{recentCount}</p>
          <p className="text-xs text-[var(--text-tertiary)]">Last 7 Days</p>
        </div>
        <div className="card text-center space-y-1">
          <p className="text-2xl font-bold text-rose-400">{failed}</p>
          <p className="text-xs text-[var(--text-tertiary)]">Failed</p>
        </div>
      </div>

      <div className="card space-y-3">
        <h4 className="text-sm font-semibold text-[var(--text-primary)]">Status Breakdown</h4>
        {[
          { label: 'Submitted', count: submitted, color: 'bg-emerald-400' },
          { label: 'Filled', count: filled, color: 'bg-blue-400' },
          { label: 'Pending', count: pending, color: 'bg-amber-400' },
          { label: 'Failed', count: failed, color: 'bg-rose-400' },
        ].map(({ label, count, color }) => (
          <div key={label} className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-[var(--text-secondary)]">{label}</span>
              <span className="text-[var(--text-tertiary)]">{count}</span>
            </div>
            <div className="h-1.5 rounded-full bg-[var(--bg-tertiary)] overflow-hidden">
              <div
                className={`h-full rounded-full ${color} transition-all duration-500`}
                style={{ width: total > 0 ? `${(count / total) * 100}%` : '0%' }}
              />
            </div>
          </div>
        ))}
      </div>

      {topPlatforms.length > 0 && (
        <div className="card space-y-3">
          <h4 className="text-sm font-semibold text-[var(--text-primary)]">Top Platforms</h4>
          {topPlatforms.map(([platform, count]) => (
            <div key={platform} className="flex justify-between items-center text-xs">
              <span className="text-[var(--text-secondary)] capitalize">{platform}</span>
              <span className="px-2 py-0.5 rounded-full bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]">
                {count}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
