import { create } from 'zustand';
import type { Application, Profile } from '../types';

/** Document preview state for in-extension preview before download */
export interface DocPreviewState {
  title: string;
  content: string;
  filename?: string;
  type: 'resume' | 'cover-letter';
}

type ActiveTab = 'dashboard' | 'history' | 'analytics' | 'profile' | 'settings';

export interface FillReport {
  filled: Array<{ key: string; value: string }>;
  skipped: number;
}

interface AppUIState {
  activeTab: ActiveTab;
  recentFilter: string;
  showProfileForm: boolean;
  previewApp: Application | null;
  fillReport: FillReport | null;
  importPreviewData: Partial<Profile> | null;
  previewDoc: DocPreviewState | null;
  previewDocs: DocPreviewState[] | null;
  bulkUrls: string;
  isApplying: boolean;
  autofillError: string | null;

  setActiveTab: (tab: ActiveTab) => void;
  setRecentFilter: (filter: string) => void;
  setShowProfileForm: (show: boolean) => void;
  setPreviewApp: (app: Application | null) => void;
  setFillReport: (report: FillReport | null) => void;
  updateFillReportField: (fieldKey: string, value: string) => void;
  setImportPreviewData: (data: Partial<Profile> | null) => void;
  setPreviewDoc: (doc: DocPreviewState | null) => void;
  setPreviewDocs: (docs: DocPreviewState[] | null) => void;
  setBulkUrls: (urls: string) => void;
  setIsApplying: (applying: boolean) => void;
  setAutofillError: (error: string | null) => void;
}

export const useAppStore = create<AppUIState>((set) => ({
  activeTab: 'dashboard',
  recentFilter: 'all',
  showProfileForm: false,
  previewApp: null,
  fillReport: null,
  importPreviewData: null,
  previewDoc: null,
  previewDocs: null,
  bulkUrls: '',
  isApplying: false,
  autofillError: null,

  setActiveTab: (activeTab) => set({ activeTab }),
  setRecentFilter: (recentFilter) => set({ recentFilter }),
  setShowProfileForm: (showProfileForm) => set({ showProfileForm }),
  setPreviewApp: (previewApp) => set({ previewApp }),
  setPreviewDoc: (previewDoc) => set({ previewDoc, previewDocs: null }),
  setPreviewDocs: (previewDocs) => set({ previewDocs, previewDoc: null }),
  setFillReport: (fillReport) => set({ fillReport }),
  updateFillReportField: (fieldKey, value) =>
    set((state) => ({
      fillReport: state.fillReport
        ? {
            ...state.fillReport,
            filled: state.fillReport.filled.map((f) =>
              f.key === fieldKey ? { ...f, value } : f
            ),
          }
        : null,
    })),
  setImportPreviewData: (importPreviewData) => set({ importPreviewData }),
  setBulkUrls: (bulkUrls) => set({ bulkUrls }),
  setIsApplying: (isApplying) => set({ isApplying }),
  setAutofillError: (autofillError) => set({ autofillError }),
}));
