import { create } from 'zustand';
import type { Application, Profile } from '../types';

type ActiveTab = 'dashboard' | 'history' | 'analytics' | 'profile' | 'settings';

export interface FillReport {
  filled: Array<{ key: string; value: string }>;
  skipped: number;
}

export interface GeneratedDocs {
  resume?: string;
  coverLetter?: string;
}

interface AppUIState {
  activeTab: ActiveTab;
  recentFilter: string;
  showProfileForm: boolean;
  previewApp: Application | null;
  fillReport: FillReport | null;
  importPreviewData: Partial<Profile> | null;
  generatedDocs: GeneratedDocs | null;
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
  setGeneratedDocs: (docs: GeneratedDocs | null) => void;
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
  generatedDocs: null,
  bulkUrls: '',
  isApplying: false,
  autofillError: null,

  setActiveTab: (activeTab) => set({ activeTab }),
  setRecentFilter: (recentFilter) => set({ recentFilter }),
  setShowProfileForm: (showProfileForm) => set({ showProfileForm }),
  setPreviewApp: (previewApp) => set({ previewApp }),
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
  setGeneratedDocs: (generatedDocs) => set({ generatedDocs }),
  setBulkUrls: (bulkUrls) => set({ bulkUrls }),
  setIsApplying: (isApplying) => set({ isApplying }),
  setAutofillError: (autofillError) => set({ autofillError }),
}));
