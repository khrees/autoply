import React, { useCallback, useEffect, useState } from 'react';
import {
  Link2,
  Plus,
  Play,
  Loader2,
  CheckCircle,
  AlertCircle,
  Clock,
  X,
} from 'lucide-react';
import type { QueueItem } from '../../types';

const API_BASE = (globalThis as any).__API_BASE__ || 'http://localhost:8088';

const QUEUE_STATUS_ICON: Record<string, React.ReactNode> = {
  pending: <Clock className="w-3.5 h-3.5 text-amber-400" />,
  processing: <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />,
  completed: <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />,
  failed: <AlertCircle className="w-3.5 h-3.5 text-rose-400" />,
};

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return url.slice(0, 30);
  }
}

export const BulkSection = ({
  urls,
  onUrlsChange,
  onAdd,
  onProcess,
  stats,
  isProcessing,
}: {
  urls: string;
  onUrlsChange: (urls: string) => void;
  onAdd: () => void;
  onProcess: () => void;
  stats: { pending: number; completed: number; failed: number } | null;
  isProcessing: boolean;
}) => {
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [showQueue, setShowQueue] = useState(false);

  const fetchQueueItems = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/queue`);
      if (res.ok) {
        const data = await res.json();
        setQueueItems(data.items || []);
        if (data.items?.length > 0) setShowQueue(true);
      }
    } catch {
      // Queue fetch is best-effort
    }
  }, []);

  // Poll during processing
  useEffect(() => {
    if (!isProcessing) return;
    fetchQueueItems();
    const interval = setInterval(fetchQueueItems, 2000);
    return () => clearInterval(interval);
  }, [isProcessing, fetchQueueItems]);

  // Fetch on mount if there are stats
  useEffect(() => {
    if (stats && (stats.pending > 0 || stats.completed > 0 || stats.failed > 0)) {
      fetchQueueItems();
    }
  }, [stats, fetchQueueItems]);

  const hasQueueItems = queueItems.length > 0;

  return (
    <div className="card space-y-4">
      <div className="flex items-center gap-2">
        <Link2 className="w-4 h-4 text-[var(--text-tertiary)]" />
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Bulk Apply</h3>
      </div>

      <textarea
        value={urls}
        onChange={(e) => onUrlsChange(e.target.value)}
        placeholder="Paste job URLs here (one per line)…"
        className="input h-24 resize-none"
        aria-label="Job URLs for bulk application"
      />

      <div className="flex flex-wrap gap-2">
        <button onClick={onAdd} className="btn btn-secondary flex-1 min-w-[120px]">
          <Plus className="w-4 h-4" />
          Add to Queue
        </button>
        <button
          onClick={onProcess}
          disabled={isProcessing || !stats || stats.pending === 0}
          className="btn btn-primary flex-1 min-w-[120px]"
        >
          {isProcessing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Processing…
            </>
          ) : (
            <>
              <Play className="w-4 h-4" />
              Process Queue
            </>
          )}
        </button>
      </div>

      {stats && (stats.pending > 0 || stats.completed > 0 || stats.failed > 0) && (
        <div className="flex items-center justify-center gap-4 text-xs">
          <span className="text-[var(--text-tertiary)]">
            Pending: <span className="font-semibold text-amber-400">{stats.pending}</span>
          </span>
          <span className="text-[var(--text-tertiary)]">
            Done: <span className="font-semibold text-emerald-400">{stats.completed}</span>
          </span>
          <span className="text-[var(--text-tertiary)]">
            Failed: <span className="font-semibold text-rose-400">{stats.failed}</span>
          </span>
        </div>
      )}

      {/* Queue item list */}
      {hasQueueItems && showQueue && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-[0.6875rem] font-medium text-[var(--text-tertiary)] uppercase tracking-wider">
              Queue ({queueItems.length})
            </p>
            <button
              onClick={() => setShowQueue(false)}
              className="p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]"
              aria-label="Hide queue"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
          <div className="max-h-48 overflow-y-auto space-y-1 scrollbar-hide">
            {queueItems.map((item) => (
              <div
                key={item.id}
                className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs transition-colors ${
                  item.status === 'processing'
                    ? 'bg-blue-500/5 border border-blue-500/10'
                    : item.status === 'failed'
                      ? 'bg-rose-500/5 border border-rose-500/10'
                      : item.status === 'completed'
                        ? 'bg-emerald-500/5 border border-emerald-500/10'
                        : 'bg-[var(--bg-primary)] border border-[var(--border-subtle)]'
                }`}
              >
                <span className="flex-shrink-0">{QUEUE_STATUS_ICON[item.status]}</span>
                <span className="flex-1 text-[var(--text-secondary)] truncate" title={item.url}>
                  {extractDomain(item.url)}
                </span>
                {item.error && (
                  <span
                    className="text-rose-400 truncate max-w-[120px]"
                    title={item.error}
                  >
                    {item.error}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {hasQueueItems && !showQueue && (
        <button
          onClick={() => setShowQueue(true)}
          className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
        >
          Show queue details →
        </button>
      )}
    </div>
  );
};
