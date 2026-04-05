import { useEffect, useRef, useCallback, useState, memo } from 'react';
import { Link, useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronRight, Download, Users, FileText, History, Globe } from 'lucide-react';
import { Button } from '../components/Button';
import { Badge } from '../components/Badge';
import { useAppStore } from '../store';
import { toast, Toaster } from 'sonner';
import type { Segment } from '../store';

/* ═══════════════════════════════════
   FAKE LIVE CURSORS (simulated Yjs)
   ═══════════════════════════════════ */
const fakeCursors = [
  { name: 'Priya S.', color: '#8B5CF6', avatar: 'P' },
  { name: 'Raj K.', color: '#F59E0B', avatar: 'R' },
];

function LiveCursors() {
  return (
    <div className="flex items-center gap-2">
      <Users className="w-4 h-4 text-ui-slate" />
      {fakeCursors.map((cursor, i) => (
        <motion.div
          key={cursor.name}
          className="flex items-center gap-1.5"
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 1 + i * 0.5 }}
        >
          <motion.div
            className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold"
            style={{ backgroundColor: cursor.color }}
            animate={{ y: [0, -2, 0] }}
            transition={{ duration: 2, repeat: Infinity, delay: i * 0.7 }}
          >
            {cursor.avatar}
          </motion.div>
          <span className="text-[10px] text-ui-slate hidden xl:inline">{cursor.name}</span>
        </motion.div>
      ))}
      <motion.div
        className="h-1.5 w-1.5 rounded-full bg-brand-emerald"
        animate={{ opacity: [1, 0.3, 1] }}
        transition={{ duration: 1.5, repeat: Infinity }}
      />
    </div>
  );
}

/* ═══════════════════════════════════
   SEGMENT ROW (Interactive)
   ═══════════════════════════════════ */
interface SegmentRowProps {
  segment: Segment;
  isActive: boolean;
  onActivate: () => void;
  glossary: { source: string; target: string }[];
}

const InteractiveSegmentRow = memo(function InteractiveSegmentRow({ segment, isActive, onActivate, glossary }: SegmentRowProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { approveSegment, revertSegment, updateTargetText } = useAppStore();
  const [localText, setLocalText] = useState(segment.targetText);

  useEffect(() => {
    setLocalText(segment.targetText);
  }, [segment.targetText]);

  // Auto-expand textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
    }
  }, [localText, isActive]);

  const handleApprove = async () => {
    try {
      const { activeLanguage, sourceLanguage } = useAppStore.getState();
      const res = await fetch('/api/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          segmentId: segment.id,
          targetText: localText,
          language: activeLanguage,
        }),
      });
      const data = await res.json();
      if (data.success) {
        approveSegment(segment.id, localText);

        if (data.propagatedCount > 0) {
          const { propagateApproval } = useAppStore.getState();
          propagateApproval(data.propagatedIds, localText);
          toast.success(
            `${data.propagatedCount} Identical Segment${data.propagatedCount > 1 ? 's' : ''} Auto-Approved!`,
            { duration: 3000, icon: '🔄' }
          );
        } else {
          toast.success('Segment approved — TM updated.', { duration: 2000, icon: '✓' });
        }
      }
    } catch (err) {
      // Approve locally even if server fails
      approveSegment(segment.id, localText);
      toast.success('Segment approved.', { duration: 2000, icon: '✓' });
    }
  };

  const handleRevert = async () => {
    try {
      await fetch('/api/approve/revert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ segmentId: segment.id }),
      });
    } catch { }
    revertSegment(segment.id);
    setLocalText(segment.originalTarget);
    toast.info('Reverted to original.', { duration: 2000 });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleApprove();
    }
    if (e.key === 'Escape') {
      handleRevert();
    }
  };

  // Glossary highlighting
  const highlightGlossary = (text: string) => {
    let parts: React.ReactNode[] = [text];
    for (const term of glossary) {
      parts = parts.flatMap((part) => {
        if (typeof part !== 'string') return [part];
        const idx = part.indexOf(term.target);
        if (idx === -1) return [part];
        return [
          part.slice(0, idx),
          <span key={term.target + idx} className="bg-yellow-200/60 px-0.5 rounded">{term.target}</span>,
          part.slice(idx + term.target.length),
        ];
      });
    }
    return parts;
  };

  const isApproved = segment.status === 'APPROVED';

  const statusColors = {
    APPROVED: 'bg-brand-emerald',
    PENDING: 'bg-status-warning',
    REJECTED: 'bg-status-error',
  };

  const matchBadgeType = segment.violation
    ? 'violation'
    : segment.matchType === 'EXACT'
      ? 'exact'
      : segment.matchType === 'FUZZY'
        ? 'fuzzy'
        : 'new';

  const matchBadgeText = segment.violation
    ? '⚠ Glossary'
    : segment.matchType === 'EXACT'
      ? `100% Exact`
      : segment.matchType === 'FUZZY'
        ? `${Math.round((segment.tmScore || 0) * 100)}% Fuzzy`
        : 'AI Translated';

  return (
    <motion.div
      layout
      className={`w-full flex items-stretch gap-4 px-4 lg:px-6 border-b border-ui-border transition-all duration-200 group cursor-pointer ${isApproved
          ? 'bg-ui-surface/50'
          : isActive
            ? 'bg-ui-white shadow-md border-l-[3px] border-l-brand-emerald'
            : segment.violation
              ? 'bg-red-50/50 hover:bg-red-50'
              : 'hover:bg-ui-surface'
        }`}
      style={{ minHeight: isApproved ? '56px' : '72px' }}
      animate={{
        opacity: isApproved ? 0.55 : 1,
      }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      onClick={onActivate}
    >
      {/* Status Dot */}
      <div className="flex items-center">
        <motion.div
          className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${statusColors[segment.status]}`}
          animate={isApproved ? { scale: [1, 1.3, 1] } : {}}
          transition={{ duration: 0.4 }}
        />
      </div>

      {/* Badge */}
      <div className="w-[120px] lg:w-[140px] flex-shrink-0 flex items-center">
        <Badge type={matchBadgeType} size="sm" text={matchBadgeText} />
      </div>

      {/* Source Text */}
      <div className="flex-1 text-code-md text-ui-slate py-3 leading-relaxed">
        {segment.sourceText}
      </div>

      {/* Divider */}
      <div className="hidden lg:flex items-center">
        <div className="w-[1px] h-10 bg-ui-border" />
      </div>

      {/* Target Text */}
      <div className="flex-1 py-2 flex items-center">
        {isActive && !isApproved ? (
          <textarea
            ref={textareaRef}
            value={localText}
            onChange={(e) => {
              setLocalText(e.target.value);
              updateTargetText(segment.id, e.target.value);
            }}
            onKeyDown={handleKeyDown}
            className="w-full text-code-md text-brand-indigo bg-ui-surface rounded-[8px] px-3 py-2 border border-brand-emerald/30 focus:border-brand-emerald focus:outline-none resize-none leading-relaxed transition-colors"
            rows={1}
            autoFocus
          />
        ) : (
          <div className="text-code-md text-brand-indigo leading-relaxed">
            {highlightGlossary(segment.targetText)}
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {!isApproved && (
          <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <button
              onClick={(e) => { e.stopPropagation(); handleApprove(); }}
              className="w-7 h-7 rounded-md bg-brand-emerald-light text-brand-emerald text-xs flex items-center justify-center hover:bg-brand-emerald hover:text-white transition-colors"
              title="Approve (Enter)"
            >
              ✓
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleRevert(); }}
              className="w-7 h-7 rounded-md bg-ui-surface text-ui-slate text-xs flex items-center justify-center hover:bg-ui-border transition-colors"
              title="Revert (Esc)"
            >
              ↺
            </button>
          </div>
        )}
        {isApproved && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="w-6 h-6 rounded-full bg-brand-emerald flex items-center justify-center text-white text-[10px]"
          >
            ✓
          </motion.div>
        )}
      </div>
    </motion.div>
  );
});

/* ═══════════════════════════════════
   EXPORT MODAL
   ═══════════════════════════════════ */
function ExportModal({ projectId, approvedCount, onClose }: { projectId: number; approvedCount: number; onClose: () => void }) {
  const [isExporting, setIsExporting] = useState(false);
  const [exportFormat, setExportFormat] = useState<'docx' | 'txt'>('docx');

  const { activeLanguage } = useAppStore.getState();

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, language: activeLanguage, format: exportFormat }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `translated_${activeLanguage}.${exportFormat}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success(`Export complete — downloaded as .${exportFormat}`, { duration: 4000, icon: '📄' });
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Export failed');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="bg-ui-white rounded-[24px] p-8 w-[420px]"
        style={{ boxShadow: 'var(--shadow-lg)' }}
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.9, y: 20 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-display-h4 text-brand-indigo mb-2">Export Document</h3>
        <p className="text-body-md text-ui-slate mb-6">
          {approvedCount} approved segments will be exported. Select your preferred format below:
        </p>

        <div className="flex gap-4 mb-6">
          {(['docx', 'txt'] as const).map((fmt) => (
          {(['docx'] as const).map((fmt) => (
            <label key={fmt} className="flex-1 cursor-pointer">
              <input
                type="radio"
                name="export_format"
                value={fmt}
                checked={exportFormat === fmt}
                onChange={(e) => setExportFormat(e.target.value as 'docx')}
                className="peer hidden"
              />
              <div className="rounded-xl border border-ui-border p-3 text-center transition-all peer-checked:border-brand-emerald peer-checked:bg-brand-emerald-light/20 peer-checked:text-brand-indigo hover:bg-ui-surface">
                <span className="text-code-md font-bold uppercase">{fmt}</span>
              </div>
            </label>
          ))}
        </div>

        {isExporting ? (
          <div className="space-y-3 mb-6">
            <div className="h-2 rounded-full bg-ui-surface overflow-hidden">
              <motion.div
                className="h-full bg-brand-emerald rounded-full"
                initial={{ width: '0%' }}
                animate={{ width: '100%' }}
                transition={{ duration: 2, ease: 'easeInOut' }}
              />
            </div>
            <p className="text-body-sm text-ui-slate text-center">Generating document...</p>
          </div>
        ) : (
          <div className="flex gap-3">
            <Button variant="primary" size="md" onClick={handleExport} className="flex-1">
              <Download className="w-4 h-4 mr-2" />
              Download .{exportFormat.toUpperCase()}
            </Button>
            <Button variant="ghost" size="md" onClick={onClose}>
              Cancel
            </Button>
          </div>
        )}

        {approvedCount === 0 && (
          <p className="text-body-sm text-status-warning mt-4 text-center">
            ⚠ Approve at least 1 segment to export.
          </p>
        )}
      </motion.div>
    </motion.div>
  );
}

/* ═══════════════════════════════════
   MAIN EDITOR COMPONENT
   ═══════════════════════════════════ */
export default function TranslationEditor() {
  const navigate = useNavigate();
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null);
  const [showExport, setShowExport] = useState(false);
  const {
    segments,
    currentProjectId,
    currentProjectName,
    activeLanguage,
    languages,
    leverageRate,
    approvedCount,
    violationCount,
    glossary,
    approveAllExact,
    approveAll,
    validationResult,
    translationProgress,
  } = useAppStore();

  const [showPreview, setShowPreview] = useState(false);
  const [previewData, setPreviewData] = useState<any>(null);

  // Load document preview
  const loadPreview = useCallback(async () => {
    if (!currentProjectId) return;
    try {
      const res = await fetch(`http://localhost:3001/api/preview/${currentProjectId}`);
      if (res.ok) {
        const data = await res.json();
        setPreviewData(data);
        setShowPreview(true);
      }
    } catch { }
  }, [currentProjectId]);

  // Load demo data if no segments
  useEffect(() => {
    if (segments.length === 0) {
      // Load from server if we have a project
      if (currentProjectId) {
        fetch(`/api/segments/${currentProjectId}`)
          .then((r) => r.json())
          .then((data) => {
            if (Array.isArray(data) && data.length > 0) {
              useAppStore.getState().setSegments(data);
            }
          })
          .catch(() => { });
      }
    }
  }, [currentProjectId]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        // Move to next pending segment
        const pendingSegments = segments.filter((s) => s.status === 'PENDING');
        if (pendingSegments.length > 0) {
          const currentIdx = pendingSegments.findIndex((s) => s.id === activeSegmentId);
          const nextIdx = (currentIdx + 1) % pendingSegments.length;
          setActiveSegmentId(pendingSegments[nextIdx].id);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [segments, activeSegmentId]);

  const qualityScore = validationResult?.qualityScore || 87;

  return (
    <div className="w-screen h-screen flex overflow-hidden">
      <Toaster position="top-right" toastOptions={{ style: { fontFamily: 'var(--font-dm-sans)', borderRadius: '12px' } }} />

      {/* Left Sidebar */}
      <div className="w-[260px] bg-brand-indigo flex flex-col">
        <div className="p-6 border-b border-white/10">
          <Link to="/home" className="text-[22px] font-black">
            <span className="text-white">verb</span>
            <span className="text-brand-emerald">AI</span>
          </Link>
        </div>
        <nav className="flex-1 py-6">
          <Link to="/upload" className="flex items-center gap-3 px-6 py-3 text-label-caps text-white/60 hover:text-white hover:bg-white/5">UPLOAD</Link>
          <Link to="/editor" className="flex items-center gap-3 px-6 py-3 text-label-caps text-white bg-white/8 border-l-[3px] border-brand-emerald">TRANSLATION</Link>
          <Link to="/analytics" className="flex items-center gap-3 px-6 py-3 text-label-caps text-white/60 hover:text-white hover:bg-white/5">ANALYTICS</Link>
          <Link to="/home" className="flex items-center gap-3 px-6 py-3 text-label-caps text-white/60 hover:text-white hover:bg-white/5">DASHBOARD</Link>
          <a href="#" className="flex items-center gap-3 px-6 py-3 text-label-caps text-white/60 hover:text-white hover:bg-white/5">GLOSSARY</a>
          <a href="#" className="flex items-center gap-3 px-6 py-3 text-label-caps text-white/60 hover:text-white hover:bg-white/5">SETTINGS</a>
        </nav>
        <div className="p-6 border-t border-white/10 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-brand-emerald flex items-center justify-center text-white font-bold">A</div>
          <div className="flex-1">
            <div className="text-body-sm font-medium text-white">Admin</div>
            <div className="text-[11px] text-white/60">Linguist</div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Top Bar */}
        <div className="h-16 bg-ui-white border-b border-ui-border flex items-center justify-between px-6">
          <div className="flex items-center gap-2 text-body-sm text-ui-slate">
            <span>Projects</span>
            <ChevronRight className="w-4 h-4" />
            <span>{currentProjectName || 'Policy Document 2024'}</span>
            <ChevronRight className="w-4 h-4" />
            <span className="text-brand-indigo font-medium">
              {languages.find(l => l.code === activeLanguage)?.name || activeLanguage}
            </span>
          </div>

          <LiveCursors />

          <div className="flex items-center gap-3">
            <select
              className="px-4 py-2 border border-ui-border rounded-lg text-body-sm bg-white"
              value={activeLanguage}
              disabled
            >
              <option value={activeLanguage}>
                {languages.find(l => l.code === activeLanguage)?.flag || '🌐'}{' '}
                {languages.find(l => l.code === activeLanguage)?.name || activeLanguage}
              </option>
            </select>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setShowExport(true)}
              disabled={approvedCount === 0}
            >
              <Download className="w-4 h-4 mr-2" />
              Export
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={loadPreview}
              title="Document Preview (Improvement 4)"
            >
              <FileText className="w-4 h-4 mr-1" />
              Preview
            </Button>
            <a
              href={`http://localhost:3001/api/export-tm/tmx/${activeLanguage}`}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-ui-border text-body-sm text-ui-slate hover:bg-ui-surface transition-colors"
              title="TMX Export (Improvement 6)"
            >
              <Globe className="w-3.5 h-3.5" />
              TMX
            </a>
            {currentProjectId && (
              <a
                href={`http://localhost:3001/api/export-tm/xliff/${currentProjectId}`}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-ui-border text-body-sm text-ui-slate hover:bg-ui-surface transition-colors"
                title="XLIFF Export (Improvement 6)"
              >
                <FileText className="w-3.5 h-3.5" />
                XLIFF
              </a>
            )}
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 flex bg-ui-surface overflow-hidden">
          {/* Left Panel — Stats */}
          <div className="w-[280px] bg-ui-white border-r border-ui-border p-6 flex flex-col gap-8 overflow-y-auto">
            {/* TM Stats */}
            <div>
              <h3 className="text-body-sm font-bold text-brand-indigo mb-4">TM STATS</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-ui-border p-3 text-center">
                  <motion.div
                    className="text-[32px] font-bold text-brand-indigo"
                    key={leverageRate}
                    initial={{ scale: 1.2, color: '#10B981' }}
                    animate={{ scale: 1, color: '#1E1B4B' }}
                    transition={{ duration: 0.4 }}
                  >
                    {leverageRate}%
                  </motion.div>
                  <div className="text-[10px] text-ui-slate uppercase tracking-wide">TM Leverage</div>
                </div>
                <div className="rounded-lg border border-ui-border p-3 text-center">
                  <div className="text-[32px] font-bold text-brand-indigo">{qualityScore}</div>
                  <div className="text-[10px] text-ui-slate uppercase tracking-wide">Quality Score</div>
                </div>
                <div className="rounded-lg border border-ui-border p-3 text-center">
                  <motion.div
                    className="text-[32px] font-bold text-status-success"
                    key={approvedCount}
                    initial={{ scale: 1.3 }}
                    animate={{ scale: 1 }}
                  >
                    {approvedCount}
                  </motion.div>
                  <div className="text-[10px] text-ui-slate uppercase tracking-wide">Approved</div>
                </div>
                <div className="rounded-lg border border-ui-border p-3 text-center">
                  <div className="text-[32px] font-bold text-status-error">{violationCount}</div>
                  <div className="text-[10px] text-ui-slate uppercase tracking-wide">Violations</div>
                </div>
              </div>
            </div>

            {/* Quick Actions */}
            <div>
              <h3 className="text-body-sm font-bold text-brand-indigo mb-4">QUICK ACTIONS</h3>
              <div className="space-y-2">
                <button
                  onClick={async () => {
                    toast.loading('Approving exact matches...', { id: 'bulkExact' });
                    // 1. Local update
                    approveAllExact();

                    // 2. Persist to backend
                    try {
                      const res = await fetch('/api/approve/bulk', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ projectId: currentProjectId, language: activeLanguage, matchType: 'EXACT' })
                      });
                      const data = await res.json();
                      if (data.success) {
                        toast.success(`${data.count} exact matches approved!`, { id: 'bulkExact', icon: '🚀' });
                      } else {
                        toast.error(data.error || 'Failed to approve exact matches', { id: 'bulkExact' });
                      }
                    } catch (e) {
                      // Local state already updated — just warn
                      toast.success('Exact matches approved locally!', { id: 'bulkExact', icon: '🚀' });
                    }
                  }}
                  className="w-full px-4 py-2.5 rounded-lg bg-brand-emerald-light text-brand-emerald text-body-sm font-medium hover:bg-brand-emerald hover:text-white transition-colors text-left"
                >
                  ✓ Approve All Exact Matches
                </button>
                <button
                  onClick={async () => {
                    toast.loading('Approving all segments...', { id: 'bulkApprove' });
                    // 1. Local update
                    approveAll();

                    // 2. Persist to backend
                    try {
                      const res = await fetch('/api/approve/bulk', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ projectId: currentProjectId, language: activeLanguage })
                      });
                      const data = await res.json();
                      if (data.success) {
                        toast.success(`Successfully approved ${data.count} segments!`, { id: 'bulkApprove', icon: '🚀' });
                      } else {
                        toast.error(data.error || 'Failed to approve all', { id: 'bulkApprove' });
                      }
                    } catch (e) {
                      // Local state already updated — just warn
                      toast.success('All segments approved locally!', { id: 'bulkApprove', icon: '🚀' });
                    }
                  }}
                  className="w-full px-4 py-2.5 rounded-lg bg-blue-50 text-blue-600 text-body-sm font-medium hover:bg-blue-600 hover:text-white transition-colors text-left mt-2"
                >
                  ✓ Approve All Segments
                </button>
              </div>
            </div>

            {/* Glossary Preview */}
            <div>
              <h3 className="text-body-sm font-bold text-brand-indigo mb-4">GLOSSARY PREVIEW</h3>
              <div className="flex flex-col gap-3">
                {glossary.slice(0, 6).map((term, i) => (
                  <div key={i} className="flex items-center justify-between text-body-sm">
                    <span className="text-ui-slate">{term.source}</span>
                    <span className="text-brand-indigo font-medium">{term.target}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Keyboard Shortcuts */}
            <div>
              <h3 className="text-body-sm font-bold text-brand-indigo mb-4">SHORTCUTS</h3>
              <div className="space-y-2 text-code-sm">
                {[
                  ['Enter', 'Approve'],
                  ['Esc', 'Revert'],
                  ['Tab', 'Next pending'],
                ].map(([key, action]) => (
                  <div key={key} className="flex items-center justify-between">
                    <kbd className="px-2 py-0.5 rounded bg-ui-surface border border-ui-border text-[10px] font-mono">{key}</kbd>
                    <span className="text-ui-slate">{action}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right Panel — Segment Editor */}
          <div className="flex-1 overflow-y-auto">
            <div className="p-6">
              {/* Column Headers */}
              <div className="flex items-center gap-4 px-4 lg:px-6 pb-4 mb-2 border-b border-ui-border">
                <div className="w-[10px]" />
                <div className="w-[120px] lg:w-[140px] text-label-caps text-ui-slate">TM MATCH</div>
                <div className="flex-1 text-label-caps text-ui-slate">
                  SOURCE ({(() => {
                    const detected = segments
                      .map(s => s.sourceLanguageDisplay)
                      .filter(Boolean);
                    if (detected.length === 0) return 'AUTO';
                    // Find the most common detected language
                    const counts: Record<string, number> = {};
                    detected.forEach(l => { counts[l!] = (counts[l!] || 0) + 1; });
                    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
                    if (!top || top[0] === 'Unknown') return 'AUTO';
                    return top[0].toUpperCase();
                  })()})
                </div>
                <div className="hidden lg:block w-[1px]" />
                <div className="flex-1 text-label-caps text-ui-slate">
                  TARGET ({(languages.find(l => l.code === activeLanguage)?.name || 'HI').toUpperCase().slice(0, 2)})
                </div>
                <div className="w-[60px] text-label-caps text-ui-slate">ACTIONS</div>
              </div>

              {/* Streaming Translation Progress (Improvement 5) */}
              {translationProgress && (
                <motion.div
                  className="mb-4 rounded-xl border border-brand-emerald/30 bg-brand-emerald-light/10 p-4"
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-body-sm font-medium text-brand-indigo">
                      ⚡ Streaming Translation
                    </span>
                    <span className="text-code-sm text-ui-slate">
                      {translationProgress.current}/{translationProgress.total}
                      {translationProgress.errors > 0 && (
                        <span className="text-status-error ml-2">
                          ({translationProgress.errors} errors)
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-ui-surface overflow-hidden">
                    <motion.div
                      className="h-full bg-gradient-to-r from-brand-emerald to-brand-indigo rounded-full"
                      initial={{ width: '0%' }}
                      animate={{
                        width: `${Math.round((translationProgress.current / translationProgress.total) * 100)}%`,
                      }}
                      transition={{ duration: 0.3 }}
                    />
                  </div>
                </motion.div>
              )}

              {/* Segment Rows */}
              {segments.length > 0 ? (
                <div className="flex flex-col rounded-lg overflow-hidden border border-ui-border">
                  <AnimatePresence>
                    {segments.map((seg) => (
                      <InteractiveSegmentRow
                        key={seg.id}
                        segment={seg}
                        isActive={activeSegmentId === seg.id}
                        onActivate={() => setActiveSegmentId(seg.id)}
                        glossary={glossary}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <p className="text-body-lg text-ui-slate mb-4">No segments loaded yet.</p>
                  <Button variant="primary" size="md" onClick={() => navigate('/upload')}>
                    Upload a Document
                  </Button>
                </div>
              )}

              {/* Bottom Stats Bar */}
              {segments.length > 0 && (
                <motion.div
                  className="mt-6 flex items-center justify-between px-6 py-4 rounded-[16px] bg-ui-white border border-ui-border"
                  style={{ boxShadow: 'var(--shadow-sm)' }}
                >
                  <span className="text-label-caps text-ui-slate">
                    {segments.length} segments | {approvedCount} approved | {segments.length - approvedCount} remaining
                  </span>
                  <span className="text-label-caps text-brand-emerald">
                    TM Leverage: {leverageRate}% | Cost Saved: ₹{((leverageRate / 100) * segments.length * 360).toLocaleString()}
                  </span>
                </motion.div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Export Modal */}
      <AnimatePresence>
        {showExport && currentProjectId && (
          <ExportModal
            projectId={currentProjectId}
            approvedCount={approvedCount}
            onClose={() => setShowExport(false)}
          />
        )}
      </AnimatePresence>

      {/* Document Preview Panel (Improvement 4) */}
      <AnimatePresence>
        {showPreview && previewData && (
          <motion.div
            className="fixed inset-0 z-50 flex"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowPreview(false)} />
            <motion.div
              className="absolute right-0 top-0 bottom-0 w-[600px] bg-ui-white border-l border-ui-border shadow-2xl flex flex-col"
              initial={{ x: 600 }}
              animate={{ x: 0 }}
              exit={{ x: 600 }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            >
              <div className="h-16 border-b border-ui-border flex items-center justify-between px-6">
                <div className="flex items-center gap-3">
                  <FileText className="w-5 h-5 text-brand-indigo" />
                  <h2 className="text-body-lg font-bold text-brand-indigo">Document Preview</h2>
                </div>
                <button onClick={() => setShowPreview(false)} className="w-8 h-8 rounded-lg bg-ui-surface flex items-center justify-center hover:bg-ui-border transition-colors">
                  ✕
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {previewData.pages?.map((page: any, pIdx: number) => (
                  <div key={pIdx} className="rounded-xl border border-ui-border bg-white p-6 shadow-sm">
                    <div className="text-[10px] text-ui-slate uppercase tracking-wider mb-4">Page {pIdx + 1}</div>
                    {page.paragraphs?.map((para: any) => (
                      <div
                        key={para.id}
                        className={`mb-3 p-3 rounded-lg border transition-all cursor-pointer hover:shadow-sm ${para.status === 'APPROVED'
                            ? 'border-brand-emerald/30 bg-brand-emerald-light/5'
                            : para.status === 'REJECTED'
                              ? 'border-status-error/30 bg-red-50'
                              : 'border-ui-border bg-ui-surface/50'
                          }`}
                        onClick={() => {
                          setActiveSegmentId(para.id);
                          setShowPreview(false);
                        }}
                      >
                        <p className="text-body-sm text-ui-slate leading-relaxed mb-1">{para.sourceText}</p>
                        <p className="text-body-sm text-brand-indigo font-medium leading-relaxed">
                          {para.targetText || <span className="italic text-ui-slate/40">Not translated</span>}
                        </p>
                        <div className="flex items-center gap-2 mt-2">
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${para.matchType === 'EXACT' ? 'bg-brand-emerald-light text-brand-emerald'
                              : para.matchType === 'FUZZY' ? 'bg-amber-100 text-amber-700'
                                : para.matchType === 'PROPAGATED' ? 'bg-purple-100 text-purple-700'
                                  : 'bg-ui-surface text-ui-slate'
                            }`}>
                            {para.matchType || 'NEW'}
                          </span>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${para.status === 'APPROVED' ? 'bg-green-100 text-green-700'
                              : para.status === 'REJECTED' ? 'bg-red-100 text-red-700'
                                : 'bg-yellow-100 text-yellow-700'
                            }`}>
                            {para.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
