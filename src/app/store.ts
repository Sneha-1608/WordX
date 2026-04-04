import { create } from 'zustand';

// ═══════════════════════════════════
// ClearLingo Global State (Zustand)
// ═══════════════════════════════════

export interface Segment {
  id: string;
  index: number;
  sourceText: string;
  targetText: string;
  originalTarget: string;
  tmScore: number | null;
  matchType: 'EXACT' | 'FUZZY' | 'NEW' | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  violation: boolean;
}

export interface ValidationIssue {
  category: string;
  severity: 'error' | 'warning' | 'info';
  segmentId: string;
  segmentIndex: number;
  text: string;
  original: string | null;
  suggestion: string | null;
}

export interface ValidationCheck {
  name: string;
  icon: string;
  count: number;
  status: 'pass' | 'warn' | 'fail';
}

export interface ValidationResult {
  qualityScore: number;
  totalIssues: number;
  checks: ValidationCheck[];
  issues: ValidationIssue[];
}

export interface GlossaryTerm {
  source: string;
  target: string;
}

export interface Language {
  code: string;
  name: string;
  region: string;
  flag: string;
}

interface AppState {
  // Project
  currentProjectId: number | null;
  currentProjectName: string;
  sourceLanguage: string;
  activeLanguage: string;
  languages: Language[];

  // Segments
  segments: Segment[];
  
  // Validation
  validationResult: ValidationResult | null;
  isValidating: boolean;
  isParsing: boolean;

  // Glossary
  glossary: GlossaryTerm[];

  // Computed stats (cached)
  leverageRate: number;
  approvedCount: number;
  violationCount: number;
  totalCostSaved: number;

  // Actions
  setProject: (id: number, name: string) => void;
  setSegments: (segments: Segment[]) => void;
  setSourceLanguage: (lang: string) => void;
  setActiveLanguage: (lang: string) => void;
  setLanguages: (langs: Language[]) => void;
  setValidationResult: (result: ValidationResult | null) => void;
  setIsValidating: (v: boolean) => void;
  setIsParsing: (v: boolean) => void;
  setGlossary: (terms: GlossaryTerm[]) => void;
  
  updateSegmentStatus: (id: string, status: 'APPROVED' | 'REJECTED' | 'PENDING') => void;
  updateTargetText: (id: string, text: string) => void;
  approveSegment: (id: string, targetText: string) => void;
  revertSegment: (id: string) => void;
  propagateApproval: (ids: string[], targetText: string) => void;
  approveAllExact: () => void;
  approveAll: () => void;
  recalculateStats: () => void;
  autoFixIssues: () => void;
  reset: () => void;
}

const COST_PER_SEGMENT_AGENCY = 400; // ₹400 per segment at agency rates
const COST_PER_SEGMENT_TM = 40; // ₹40 per segment with TM match

function calculateStats(segments: Segment[]) {
  const total = segments.length;
  const approved = segments.filter((s) => s.status === 'APPROVED').length;
  const violations = segments.filter((s) => s.violation).length;
  const exact = segments.filter((s) => s.matchType === 'EXACT').length;
  const fuzzy = segments.filter((s) => s.matchType === 'FUZZY').length;
  const leverageRate = total > 0 ? Math.round(((exact + fuzzy) / total) * 100) : 0;
  const saved = (exact + fuzzy) * (COST_PER_SEGMENT_AGENCY - COST_PER_SEGMENT_TM);
  return { leverageRate, approvedCount: approved, violationCount: violations, totalCostSaved: saved };
}

export const useAppStore = create<AppState>((set, get) => ({
  // Initial state
  currentProjectId: null,
  currentProjectName: '',
  sourceLanguage: 'en',
  activeLanguage: 'hi_IN',
  languages: [],
  segments: [],
  validationResult: null,
  isValidating: false,
  isParsing: false,
  glossary: [],
  leverageRate: 0,
  approvedCount: 0,
  violationCount: 0,
  totalCostSaved: 0,

  // Setters
  setProject: (id, name) => set({ currentProjectId: id, currentProjectName: name }),
  setSegments: (segments) => {
    const stats = calculateStats(segments);
    set({ segments, ...stats });
  },
  setSourceLanguage: (lang) => set({ sourceLanguage: lang }),
  setActiveLanguage: (lang) => set({ activeLanguage: lang }),
  setLanguages: (langs) => set({ languages: langs }),
  setValidationResult: (result) => set({ validationResult: result }),
  setIsValidating: (v) => set({ isValidating: v }),
  setIsParsing: (v) => set({ isParsing: v }),
  setGlossary: (terms) => set({ glossary: terms }),

  // Segment actions
  updateSegmentStatus: (id, status) => {
    const segments = get().segments.map((s) =>
      s.id === id ? { ...s, status } : s
    );
    const stats = calculateStats(segments);
    set({ segments, ...stats });
  },

  updateTargetText: (id, text) => {
    set({
      segments: get().segments.map((s) =>
        s.id === id ? { ...s, targetText: text } : s
      ),
    });
  },

  approveSegment: (id, targetText) => {
    const segments = get().segments.map((s) =>
      s.id === id ? { ...s, status: 'APPROVED' as const, targetText } : s
    );
    const stats = calculateStats(segments);
    set({ segments, ...stats });
  },

  revertSegment: (id) => {
    const segments = get().segments.map((s) =>
      s.id === id ? { ...s, targetText: s.originalTarget, status: 'PENDING' as const } : s
    );
    const stats = calculateStats(segments);
    set({ segments, ...stats });
  },

  propagateApproval: (ids, targetText) => {
    const segments = get().segments.map((s) =>
      ids.includes(s.id) ? { ...s, status: 'APPROVED' as const, targetText } : s
    );
    const stats = calculateStats(segments);
    set({ segments, ...stats });
  },

  approveAllExact: () => {
    const segments = get().segments.map((s) =>
      s.matchType === 'EXACT' && s.status === 'PENDING'
        ? { ...s, status: 'APPROVED' as const }
        : s
    );
    const stats = calculateStats(segments);
    set({ segments, ...stats });
  },

  approveAll: () => {
    const segments = get().segments.map((s) =>
      s.status === 'PENDING'
        ? { ...s, status: 'APPROVED' as const }
        : s
    );
    const stats = calculateStats(segments);
    set({ segments, ...stats });
  },

  recalculateStats: () => {
    const stats = calculateStats(get().segments);
    set(stats);
  },

  autoFixIssues: () => {
    const { validationResult, segments } = get();
    if (!validationResult) return;

    // Apply suggestions that have both original and suggestion
    let newSegments = [...segments];
    for (const issue of validationResult.issues) {
      if (issue.original && issue.suggestion && issue.category === 'spelling') {
        newSegments = newSegments.map((s) => {
          if (s.id === issue.segmentId) {
            const regex = new RegExp(`\\b${issue.original}\\b`, 'gi');
            return { ...s, sourceText: s.sourceText.replace(regex, issue.suggestion!) };
          }
          return s;
        });
      }
      if (issue.category === 'punctuation' && issue.original === '  ' && issue.suggestion === ' ') {
        newSegments = newSegments.map((s) => {
          if (s.id === issue.segmentId) {
            return { ...s, sourceText: s.sourceText.replace(/  /g, ' ') };
          }
          return s;
        });
      }
    }

    // Mark validation as resolved
    const newResult = {
      ...validationResult,
      qualityScore: Math.min(100, validationResult.qualityScore + 10),
      totalIssues: 0,
      issues: [],
    };

    set({ segments: newSegments, validationResult: newResult });
  },

  reset: () => set({
    currentProjectId: null,
    currentProjectName: '',
    segments: [],
    validationResult: null,
    isValidating: false,
    isParsing: false,
    leverageRate: 0,
    approvedCount: 0,
    violationCount: 0,
    totalCostSaved: 0,
  }),
}));

// ═══════════════════════════════════════════════════════════════
// Layer 6: Dashboard Analytics State (§6)
// ═══════════════════════════════════════════════════════════════

export interface DashboardData {
  // §6.1 TM Leverage
  leverage: {
    leverageRate: number;
    exactCount: number;
    fuzzyCount: number;
    newCount: number;
    totalSegments: number;
    trend: number;
    target: number;
  };
  // §6.2 Glossary Compliance
  compliance: {
    complianceRate: number;
    totalChecks: number;
    compliantCount: number;
    violationCount: number;
    recentViolations: any[];
    glossaryTerms: number;
    mandatoryTerms: number;
    target: number;
  };
  // §6.3 Cost Savings
  cost: {
    manualCost: number;
    actualCost: number;
    savings: number;
    reductionPercent: number;
    perProject: any[];
    costModel: { manual: number; llm: number; fuzzy: number; exact: number };
  };
  // TM Growth
  tmGrowth: {
    data: { day: string; date: string; records: number }[];
    totalRecords: number;
    milestone: string;
  };
  // Segments Velocity
  velocity: {
    today: number;
    thisWeek: number;
    allTime: number;
    trend: string;
  };
  // Review Time
  reviewTime: {
    avgSeconds: number;
    minSeconds: number;
    maxSeconds: number;
    trend: string;
    improvement: string;
  };
  // Language Coverage
  languageCoverage: {
    languages: { code: string; name: string; script: string; tmRecords: number; active: boolean; intensity: number }[];
    totalLanguages: number;
    activeLanguages: number;
    coveragePercent: number;
  };
  // Recent Approvals
  recentApprovals: any[];
  // Projects
  projects: any[];
}

interface DashboardState {
  data: DashboardData | null;
  isLoading: boolean;
  error: string | null;
  lastUpdated: string | null;

  refreshDashboard: () => Promise<void>;
}

const defaultDashboard: DashboardData = {
  leverage: { leverageRate: 0, exactCount: 0, fuzzyCount: 0, newCount: 0, totalSegments: 0, trend: 0, target: 94 },
  compliance: { complianceRate: 100, totalChecks: 0, compliantCount: 0, violationCount: 0, recentViolations: [], glossaryTerms: 0, mandatoryTerms: 0, target: 99.8 },
  cost: { manualCost: 0, actualCost: 0, savings: 0, reductionPercent: 0, perProject: [], costModel: { manual: 400, llm: 75, fuzzy: 15, exact: 0 } },
  tmGrowth: { data: [], totalRecords: 0, milestone: '0' },
  velocity: { today: 0, thisWeek: 0, allTime: 0, trend: '' },
  reviewTime: { avgSeconds: 0, minSeconds: 0, maxSeconds: 0, trend: '', improvement: '' },
  languageCoverage: { languages: [], totalLanguages: 22, activeLanguages: 0, coveragePercent: 0 },
  recentApprovals: [],
  projects: [],
};

export const useDashboardStore = create<DashboardState>((set) => ({
  data: null,
  isLoading: false,
  error: null,
  lastUpdated: null,

  refreshDashboard: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await fetch('http://localhost:3001/api/analytics/dashboard');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      set({
        data: { ...defaultDashboard, ...data },
        isLoading: false,
        lastUpdated: new Date().toISOString(),
      });
    } catch (err: any) {
      console.warn('Dashboard fetch failed:', err.message);
      set({ isLoading: false, error: err.message });
    }
  },
}));
