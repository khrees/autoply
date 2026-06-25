import React, { useMemo, useState } from 'react';
import { FileText, Loader2, RefreshCcw, Eye, Download, LayoutTemplate } from 'lucide-react';
import { API_BASE, NON_SCRIPTABLE_PROTOCOLS } from '../constants';
import type { GeneratedDocumentsResult } from '../hooks/mutations';
import type { DocPreview } from './PreviewModal';

export const GenerateDocumentsCard = ({
  currentUrl,
  onGenerate,
  isGenerating,
  generatedDocs,
  connected,
  onPreview,
}: {
  currentUrl: string | undefined;
  onGenerate: (type: 'resume' | 'cover-letter' | 'both') => void;
  isGenerating: boolean;
  generatedDocs: GeneratedDocumentsResult | null;
  connected: boolean;
  onPreview: (type: 'resume' | 'cover-letter' | 'both') => void;
}) => {
  const isValidJobUrl =
    currentUrl && !NON_SCRIPTABLE_PROTOCOLS.some((p) => currentUrl.startsWith(p));

  if (!isValidJobUrl) return null;

  const hostname = currentUrl ? new URL(currentUrl).hostname.replace('www.', '') : '';

  const hasResume = !!(generatedDocs?.resume && generatedDocs?.resumeContent);
  const hasCoverLetter = !!(generatedDocs?.coverLetter && generatedDocs?.coverLetterContent);
  const hasBoth = hasResume && hasCoverLetter;

  const handleDownload = (filename: string) => {
    const link = document.createElement('a');
    link.href = `${API_BASE}/documents/download/${encodeURIComponent(filename)}`;
    link.download = filename;
    link.click();
  };

  /**
   * Returns preview docs for the modal — either a single doc or both.
   * Used by the parent when the user clicks "View Both" or individual preview buttons.
   */
  const getPreviewDocs = (type?: 'resume' | 'cover-letter'): DocPreview[] | null => {
    if (!generatedDocs) return null;

    if (type === 'resume' && generatedDocs.resumeContent) {
      return [
        {
          title: `Resume — ${hostname}`,
          content: generatedDocs.resumeContent,
          filename: generatedDocs.resume,
          type: 'resume',
        },
      ];
    }

    if (type === 'cover-letter' && generatedDocs.coverLetterContent) {
      return [
        {
          title: `Cover Letter — ${hostname}`,
          content: generatedDocs.coverLetterContent,
          filename: generatedDocs.coverLetter,
          type: 'cover-letter',
        },
      ];
    }

    // Return both
    const docs: DocPreview[] = [];
    if (generatedDocs.resumeContent) {
      docs.push({
        title: `Resume — ${hostname}`,
        content: generatedDocs.resumeContent,
        filename: generatedDocs.resume,
        type: 'resume',
      });
    }
    if (generatedDocs.coverLetterContent) {
      docs.push({
        title: `Cover Letter — ${hostname}`,
        content: generatedDocs.coverLetterContent,
        filename: generatedDocs.coverLetter,
        type: 'cover-letter',
      });
    }
    return docs.length > 0 ? docs : null;
  };
  return (
    <div className="card space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center text-purple-500 border border-purple-500/20">
          <FileText className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-[var(--text-primary)]">Generate Documents</h2>
          <p className="text-xs text-[var(--text-tertiary)]">AI-tailored for this job</p>
        </div>
      </div>

      {generatedDocs && (hasResume || hasCoverLetter) ? (
        <div className="space-y-3">
          {/* Dual document preview area (when both exist) */}
          {hasBoth && (
            <div className="rounded-xl border border-[var(--border-subtle)] overflow-hidden">
              {/* Dual mini-preview */}
              <div className="grid grid-cols-2 divide-x divide-[var(--border-subtle)]">
                {/* Resume mini-card */}
                <div className="p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-purple-500" />
                    <span className="text-xs font-semibold text-[var(--text-primary)]">Resume</span>
                  </div>
                  <p className="text-[10px] text-[var(--text-tertiary)] leading-relaxed line-clamp-3">
                    {generatedDocs.resumeContent?.slice(0, 180)}
                    {(generatedDocs.resumeContent?.length ?? 0) > 180 ? '…' : ''}
                  </p>
                  <div className="flex gap-1.5 pt-1">
                    <button
                      onClick={() => onPreview('resume')}
                      className="flex-1 text-[10px] font-medium px-2 py-1.5 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] transition-colors flex items-center justify-center gap-1"
                    >
                      <Eye className="w-3 h-3" />
                      Preview
                    </button>
                    {generatedDocs.resume && (
                      <button
                        onClick={() => handleDownload(generatedDocs.resume!)}
                        className="px-2 py-1.5 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] transition-colors"
                        title="Download Resume PDF"
                      >
                        <Download className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Cover Letter mini-card */}
                <div className="p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-500" />
                    <span className="text-xs font-semibold text-[var(--text-primary)]">Cover Letter</span>
                  </div>
                  <p className="text-[10px] text-[var(--text-tertiary)] leading-relaxed line-clamp-3">
                    {generatedDocs.coverLetterContent?.slice(0, 180)}
                    {(generatedDocs.coverLetterContent?.length ?? 0) > 180 ? '…' : ''}
                  </p>
                  <div className="flex gap-1.5 pt-1">
                    <button
                      onClick={() => onPreview('cover-letter')}
                      className="flex-1 text-[10px] font-medium px-2 py-1.5 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] transition-colors flex items-center justify-center gap-1"
                    >
                      <Eye className="w-3 h-3" />
                      Preview
                    </button>
                    {generatedDocs.coverLetter && (
                      <button
                        onClick={() => handleDownload(generatedDocs.coverLetter!)}
                        className="px-2 py-1.5 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] transition-colors"
                        title="Download Cover Letter PDF"
                      >
                        <Download className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* "View Both" CTA */}
              <button
                onClick={() => onPreview('both')}
                className="w-full flex items-center justify-center gap-1.5 py-2 bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-[10px] font-medium text-[var(--accent)] transition-colors border-t border-[var(--border-subtle)]"
              >
                <LayoutTemplate className="w-3.5 h-3.5" />
                View side-by-side
              </button>
            </div>
          )}

          {/* Single document (only one type generated) */}
          {!hasBoth && hasResume && (
            <div className="flex gap-2">
              <button
                onClick={() => onPreview('resume')}
                className="btn btn-secondary flex-1 justify-center"
              >
                <Eye className="w-4 h-4" />
                Preview Resume
              </button>
              {generatedDocs.resume && (
                <button
                  onClick={() => handleDownload(generatedDocs.resume!)}
                  className="btn btn-secondary px-3 justify-center"
                  title="Download PDF"
                >
                  <Download className="w-4 h-4" />
                </button>
              )}
            </div>
          )}
          {!hasBoth && hasCoverLetter && (
            <div className="flex gap-2">
              <button
                onClick={() => onPreview('cover-letter')}
                className="btn btn-secondary flex-1 justify-center"
              >
                <Eye className="w-4 h-4" />
                Preview Cover Letter
              </button>
              {generatedDocs.coverLetter && (
                <button
                  onClick={() => handleDownload(generatedDocs.coverLetter!)}
                  className="btn btn-secondary px-3 justify-center"
                  title="Download PDF"
                >
                  <Download className="w-4 h-4" />
                </button>
              )}
            </div>
          )}

          <button
            onClick={() => onGenerate('both')}
            disabled={isGenerating}
            className="btn btn-primary w-full"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Generating…
              </>
            ) : (
              <>
                <RefreshCcw className="w-4 h-4" />
                Regenerate
              </>
            )}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => onGenerate('resume')}
            disabled={!connected || isGenerating}
            className="btn btn-secondary"
          >
            {isGenerating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <FileText className="w-4 h-4" />
            )}
            Resume
          </button>
          <button
            onClick={() => onGenerate('cover-letter')}
            disabled={!connected || isGenerating}
            className="btn btn-secondary"
          >
            {isGenerating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <FileText className="w-4 h-4" />
            )}
            Cover Letter
          </button>
        </div>
      )}
    </div>
  );
};
