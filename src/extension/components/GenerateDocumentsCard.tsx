import React from 'react';
import {
  FileText,
  Loader2,
  RefreshCcw,
  Download,
} from 'lucide-react';

const NON_SCRIPTABLE_PROTOCOLS = [
  'chrome:',
  'chrome-extension:',
  'devtools:',
  'edge:',
  'about:',
  'moz-extension:',
];

export const GenerateDocumentsCard = ({
  currentUrl,
  onGenerate,
  isGenerating,
  generatedDocs,
  connected,
}: {
  currentUrl: string | undefined;
  onGenerate: (type: 'resume' | 'cover-letter' | 'both') => void;
  isGenerating: boolean;
  generatedDocs: { resume?: string; coverLetter?: string } | null;
  connected: boolean;
}) => {
  const isValidJobUrl =
    currentUrl && !NON_SCRIPTABLE_PROTOCOLS.some((p) => currentUrl.startsWith(p));

  if (!isValidJobUrl) {
    return null;
  }

  const handleDownload = async (filename: string) => {
    const apiBase = (globalThis as any).__API_BASE__ || 'http://localhost:8088';
    const link = document.createElement('a');
    link.href = `${apiBase}/documents/download/${encodeURIComponent(filename)}`;
    link.download = filename;
    link.click();
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

      {generatedDocs ? (
        <div className="space-y-2">
          {generatedDocs.resume && (
            <button
              onClick={() => handleDownload(generatedDocs.resume!)}
              className="btn btn-secondary w-full justify-between"
            >
              <span className="flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Resume
              </span>
              <Download className="w-4 h-4" />
            </button>
          )}
          {generatedDocs.coverLetter && (
            <button
              onClick={() => handleDownload(generatedDocs.coverLetter!)}
              className="btn btn-secondary w-full justify-between"
            >
              <span className="flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Cover Letter
              </span>
              <Download className="w-4 h-4" />
            </button>
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
