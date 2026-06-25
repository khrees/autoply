import React, { useRef, useMemo, useState, useEffect } from 'react';
import { FileText, X, Download, Eye, File as FilePdf, ChevronLeft, ChevronRight } from 'lucide-react';
import { API_BASE } from '../constants';
import { useFocusTrap } from '../hooks/useFocusTrap';

// ── Markdown renderer ────────────────────────────────────────────────────────

/**
 * Minimal markdown-to-HTML renderer for preview purposes.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function applyInlineFormatting(text: string): string {
  return text
    .replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener">$1</a>'
    );
}

function renderMarkdown(md: string): string {
  const escaped = escapeHtml(md);
  const lines = escaped.split('\n');
  const parts: string[] = [];
  let inList = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();

    if (!trimmed) {
      if (inList) { parts.push('</ul>'); inList = false; }
      const last = parts[parts.length - 1];
      if (last && last.endsWith('</p>')) parts.push('<br />');
      continue;
    }

    if (/^[-*_]{3,}$/.test(trimmed)) {
      if (inList) { parts.push('</ul>'); inList = false; }
      parts.push('<hr />');
      continue;
    }

    const hMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (hMatch) {
      if (inList) { parts.push('</ul>'); inList = false; }
      const level = hMatch[1].length;
      parts.push(`<h${level}>${applyInlineFormatting(hMatch[2])}</h${level}>`);
      continue;
    }

    const bMatch = trimmed.match(/^[-•*]\s+(.*)$/);
    if (bMatch) {
      if (!inList) { parts.push('<ul>'); inList = true; }
      parts.push(`<li>${applyInlineFormatting(bMatch[1])}</li>`);
      continue;
    }

    if (inList) { parts.push('</ul>'); inList = false; }
    parts.push(`<p>${applyInlineFormatting(raw)}</p>`);
  }

  if (inList) parts.push('</ul>');
  return parts.join('\n');
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface DocPreview {
  title: string;
  content: string;
  filename?: string;
  type: 'resume' | 'cover-letter';
}

type PreviewTab = 'rendered' | 'pdf';

// ── Document Pane (shared by single and dual views) ──────────────────────────

const DocPane = ({
  doc,
  activeTab,
  setActiveTab,
  renderedHtml,
  previewUrl,
  pdfError,
  onDownload,
  onOpenInTab,
}: {
  doc: DocPreview;
  activeTab: PreviewTab;
  setActiveTab: (tab: PreviewTab) => void;
  renderedHtml: string;
  previewUrl: string | null;
  pdfError: boolean;
  onDownload: () => void;
  onOpenInTab: () => void;
}) => (
  <div className="flex flex-col h-full min-h-0">
    {/* Document header */}
    <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <div className="w-6 h-6 rounded-md bg-purple-500/10 flex items-center justify-center text-purple-500 shrink-0">
          <FileText className="w-3 h-3" />
        </div>
        <span className="text-xs font-semibold text-[var(--text-primary)] truncate">
          {doc.type === 'resume' ? 'Resume' : 'Cover Letter'}
        </span>
      </div>
      <div className="flex items-center gap-1">
        {previewUrl && (
          <div className="flex rounded-lg bg-[var(--bg-tertiary)] p-0.5 border border-[var(--border-subtle)]">
            <button
              onClick={() => setActiveTab('rendered')}
              className={`px-2 py-0.5 text-[10px] font-medium rounded-md transition-colors ${
                activeTab === 'rendered'
                  ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm'
                  : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
              }`}
              aria-pressed={activeTab === 'rendered'}
            >
              <Eye className="w-3 h-3 inline mr-0.5" />
              Preview
            </button>
            <button
              onClick={() => setActiveTab('pdf')}
              className={`px-2 py-0.5 text-[10px] font-medium rounded-md transition-colors ${
                activeTab === 'pdf'
                  ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm'
                  : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
              }`}
              aria-pressed={activeTab === 'pdf'}
            >
              <FilePdf className="w-3 h-3 inline mr-0.5" />
              PDF
            </button>
          </div>
        )}
        {doc.filename && (
          <button
            onClick={onDownload}
            className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] transition-colors"
            title="Download PDF"
            aria-label="Download PDF"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>

    {/* Document content */}
    <div className="flex-1 overflow-hidden">
      {activeTab === 'pdf' && previewUrl && !pdfError ? (
        <embed
          src={previewUrl}
          type="application/pdf"
          className="w-full h-full"
          onError={() => setActiveTab('rendered')}
          title={doc.title}
        />
      ) : (
        <div className="h-full overflow-y-auto p-4">
          {activeTab === 'pdf' && (!previewUrl || pdfError) && (
            <div className="mb-3 p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[10px] flex items-start gap-1.5">
              <Eye className="w-3 h-3 shrink-0 mt-0.5" />
              <span>
                PDF unavailable. Showing rendered preview instead.
                {doc.filename && (
                  <>
                    {' '}
                    <button onClick={onDownload} className="underline hover:text-amber-200">
                      Download PDF
                    </button>
                  </>
                )}
              </span>
            </div>
          )}
          <div
            className="prose prose-sm max-w-none text-[var(--text-primary)]
              prose-headings:text-[var(--text-primary)]
              prose-headings:font-bold prose-h1:text-lg prose-h2:text-base prose-h3:text-sm
              prose-p:text-[var(--text-secondary)] prose-p:leading-relaxed prose-p:text-xs
              prose-li:text-[var(--text-secondary)] prose-li:text-xs
              prose-code:text-[var(--accent)] prose-code:bg-[var(--bg-tertiary)] prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs
              prose-a:text-[var(--accent)] prose-a:underline
              prose-strong:text-[var(--text-primary)]
              prose-hr:border-[var(--border-subtle)]"
            dangerouslySetInnerHTML={{ __html: renderedHtml }}
          />
        </div>
      )}
    </div>
  </div>
);

// ── Component ────────────────────────────────────────────────────────────────

export const PreviewModal = ({
  docs,
  initialIndex = 0,
  onClose,
}: {
  docs: DocPreview[];
  initialIndex?: number;
  onClose: () => void;
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [docIndex, setDocIndex] = useState(initialIndex);
  const [activeTabs, setActiveTabs] = useState<Record<number, PreviewTab>>({});
  const [pdfErrors, setPdfErrors] = useState<Record<number, boolean>>({});
  const [showSplit, setShowSplit] = useState(docs.length >= 2);

  useFocusTrap(containerRef, { onClose });

  const currentDoc = docs[docIndex];
  const renderedHtml = useMemo(
    () => (currentDoc ? renderMarkdown(currentDoc.content) : ''),
    [currentDoc?.content]
  );

  // Reset per-doc state when switching docs
  useEffect(() => {
    if (!(docIndex in activeTabs)) {
      setActiveTabs((prev) => ({ ...prev, [docIndex]: 'pdf' }));
    }
    if (!(docIndex in pdfErrors)) {
      setPdfErrors((prev) => ({ ...prev, [docIndex]: false }));
    }
  }, [docIndex]);

  const activeTab = activeTabs[docIndex] ?? 'pdf';
  const pdfError = pdfErrors[docIndex] ?? false;

  const previewUrl = currentDoc?.filename
    ? `${API_BASE}/documents/preview/${encodeURIComponent(currentDoc.filename)}`
    : null;

  const handleDownload = () => {
    if (!currentDoc?.filename) return;
    const link = document.createElement('a');
    link.href = `${API_BASE}/documents/download/${encodeURIComponent(currentDoc.filename)}`;
    link.download = currentDoc.filename;
    link.click();
  };

  const handleOpenInTab = () => {
    if (!previewUrl) return;
    window.open(previewUrl, '_blank');
  };

  const setActiveTabForCurrent = (tab: PreviewTab) => {
    setActiveTabs((prev) => ({ ...prev, [docIndex]: tab }));
  };

  // ── Split view (both documents side-by-side) ─────────────────────────
  if (showSplit && docs.length === 2) {
    const doc0 = docs[0];
    const doc1 = docs[1];
    const tab0 = activeTabs[0] ?? 'pdf';
    const tab1 = activeTabs[1] ?? 'pdf';
    const err0 = pdfErrors[0] ?? false;
    const err1 = pdfErrors[1] ?? false;
    const url0 = doc0.filename
      ? `${API_BASE}/documents/preview/${encodeURIComponent(doc0.filename)}`
      : null;
    const url1 = doc1.filename
      ? `${API_BASE}/documents/preview/${encodeURIComponent(doc1.filename)}`
      : null;
    const html0 = useMemo(() => renderMarkdown(doc0.content), [doc0.content]);
    const html1 = useMemo(() => renderMarkdown(doc1.content), [doc1.content]);

    return (
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in overscroll-contain"
        onClick={(e) => e.target === e.currentTarget && onClose()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="split-preview-title"
      >
        <div
          ref={containerRef}
          className="bg-[var(--bg-secondary)] w-full sm:max-w-5xl sm:rounded-xl rounded-t-xl h-[90vh] sm:h-[90vh] flex flex-col animate-slide-up sm:animate-scale-in"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)] shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center text-purple-500 border border-purple-500/20 shrink-0">
                <FileText className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <h3
                  id="split-preview-title"
                  className="text-sm font-semibold text-[var(--text-primary)] truncate"
                >
                  Resume & Cover Letter
                </h3>
                <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5">
                  Side-by-side preview — scroll each document independently
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0 ml-3">
              <button
                onClick={() => setShowSplit(false)}
                className="px-2.5 py-1 text-xs font-medium rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] transition-colors"
                title="Single document view"
              >
                Single View
              </button>
              <button
                onClick={onClose}
                className="p-2 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] transition-colors"
                aria-label="Close preview"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Body: two panes */}
          <div className="flex-1 flex flex-col sm:flex-row min-h-0">
            {/* Resume pane */}
            <div className="flex-1 flex flex-col min-h-0 border-r border-[var(--border-subtle)]">
              <DocPane
                doc={doc0}
                activeTab={tab0}
                setActiveTab={(t) => setActiveTabs((p) => ({ ...p, [0]: t }))}
                renderedHtml={html0}
                previewUrl={url0}
                pdfError={err0}
                onDownload={() => {
                  if (!doc0.filename) return;
                  const link = document.createElement('a');
                  link.href = `${API_BASE}/documents/download/${encodeURIComponent(doc0.filename)}`;
                  link.download = doc0.filename;
                  link.click();
                }}
                onOpenInTab={() => url0 && window.open(url0, '_blank')}
              />
            </div>

            {/* Cover Letter pane */}
            <div className="flex-1 flex flex-col min-h-0">
              <DocPane
                doc={doc1}
                activeTab={tab1}
                setActiveTab={(t) => setActiveTabs((p) => ({ ...p, [1]: t }))}
                renderedHtml={html1}
                previewUrl={url1}
                pdfError={err1}
                onDownload={() => {
                  if (!doc1.filename) return;
                  const link = document.createElement('a');
                  link.href = `${API_BASE}/documents/download/${encodeURIComponent(doc1.filename)}`;
                  link.download = doc1.filename;
                  link.click();
                }}
                onOpenInTab={() => url1 && window.open(url1, '_blank')}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Single doc view ─────────────────────────────────────────────────
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
        className="bg-[var(--bg-secondary)] w-full sm:max-w-3xl sm:rounded-xl rounded-t-xl h-[88vh] sm:h-auto sm:max-h-[92vh] flex flex-col animate-slide-up sm:animate-scale-in"
      >
        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--border-subtle)] shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center text-purple-500 border border-purple-500/20 shrink-0">
              <FileText className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3
                id="preview-title"
                className="text-base font-semibold text-[var(--text-primary)] truncate"
              >
                {currentDoc?.title}
              </h3>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 ml-3">
            {/* Doc switcher (when multiple docs) */}
            {docs.length >= 2 && (
              <div className="flex items-center gap-1 mr-1">
                <button
                  onClick={() => setDocIndex(Math.max(0, docIndex - 1))}
                  disabled={docIndex === 0}
                  className="p-1 rounded-md hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  title="Previous document"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-[10px] font-medium text-[var(--text-tertiary)] min-w-[60px] text-center">
                  {docIndex === 0 ? 'Resume' : 'Cover Letter'}
                  <span className="block text-[9px] opacity-60">
                    {docIndex + 1} of {docs.length}
                  </span>
                </span>
                <button
                  onClick={() => setDocIndex(Math.min(docs.length - 1, docIndex + 1))}
                  disabled={docIndex === docs.length - 1}
                  className="p-1 rounded-md hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  title="Next document"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Tabs */}
            {previewUrl && (
              <div className="flex rounded-lg bg-[var(--bg-tertiary)] p-0.5 border border-[var(--border-subtle)]">
                <button
                  onClick={() => setActiveTabForCurrent('rendered')}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                    activeTab === 'rendered'
                      ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm'
                      : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
                  }`}
                  aria-pressed={activeTab === 'rendered'}
                >
                  <Eye className="w-3.5 h-3.5 inline mr-1" />
                  Preview
                </button>
                <button
                  onClick={() => setActiveTabForCurrent('pdf')}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                    activeTab === 'pdf'
                      ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm'
                      : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
                  }`}
                  aria-pressed={activeTab === 'pdf'}
                >
                  <FilePdf className="w-3.5 h-3.5 inline mr-1" />
                  PDF
                </button>
              </div>
            )}

            {/* Split view toggle (when 2 docs) */}
            {docs.length === 2 && (
              <button
                onClick={() => setShowSplit(true)}
                className="px-2.5 py-1 text-xs font-medium rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] transition-colors"
                title="View side-by-side"
              >
                Split
              </button>
            )}

            {currentDoc?.filename && (
              <button
                onClick={handleDownload}
                className="p-2 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] transition-colors"
                title="Download PDF"
                aria-label="Download PDF"
              >
                <Download className="w-5 h-5" />
              </button>
            )}

            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] transition-colors"
              aria-label="Close preview"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* ── Body ───────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-hidden">
          {activeTab === 'pdf' && previewUrl && !pdfError ? (
            <embed
              src={previewUrl}
              type="application/pdf"
              className="w-full h-full"
              onError={() => setPdfErrors((p) => ({ ...p, [docIndex]: true }))}
              title={currentDoc?.title}
            />
          ) : activeTab === 'pdf' && (!previewUrl || pdfError) ? (
            <div className="h-full overflow-y-auto p-6">
              <div className="mb-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs flex items-start gap-2">
                <Eye className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  PDF preview unavailable. Showing rendered markdown preview instead.
                  {currentDoc?.filename && (
                    <>
                      {' '}
                      <button onClick={handleDownload} className="underline hover:text-amber-200">
                        Download PDF
                      </button>{' '}
                      to view the actual document.
                    </>
                  )}
                </span>
              </div>
              <div
                className="prose prose-sm max-w-none text-[var(--text-primary)]
                  prose-headings:text-[var(--text-primary)]
                  prose-headings:font-bold prose-h1:text-xl prose-h2:text-lg prose-h3:text-base
                  prose-p:text-[var(--text-secondary)] prose-p:leading-relaxed
                  prose-li:text-[var(--text-secondary)]
                  prose-code:text-[var(--accent)] prose-code:bg-[var(--bg-tertiary)] prose-code:px-1 prose-code:py-0.5 prose-code:rounded
                  prose-a:text-[var(--accent)] prose-a:underline
                  prose-strong:text-[var(--text-primary)]
                  prose-hr:border-[var(--border-subtle)]"
                dangerouslySetInnerHTML={{ __html: renderedHtml }}
              />
            </div>
          ) : (
            <div className="h-full overflow-y-auto p-6">
              <div
                className="prose prose-sm max-w-none text-[var(--text-primary)]
                  prose-headings:text-[var(--text-primary)]
                  prose-headings:font-bold prose-h1:text-xl prose-h2:text-lg prose-h3:text-base
                  prose-p:text-[var(--text-secondary)] prose-p:leading-relaxed
                  prose-li:text-[var(--text-secondary)]
                  prose-code:text-[var(--accent)] prose-code:bg-[var(--bg-tertiary)] prose-code:px-1 prose-code:py-0.5 prose-code:rounded
                  prose-a:text-[var(--accent)] prose-a:underline
                  prose-strong:text-[var(--text-primary)]
                  prose-hr:border-[var(--border-subtle)]"
                dangerouslySetInnerHTML={{ __html: renderedHtml }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
