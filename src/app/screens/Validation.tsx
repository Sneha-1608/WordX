import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router';
import { motion, AnimatePresence, useMotionValue, useTransform, animate } from 'motion/react';
import { ChevronDown, ChevronRight, CheckCircle2, AlertTriangle, Info, Sparkles } from 'lucide-react';
import { Button } from '../components/Button';
import { Badge } from '../components/Badge';
import { useAppStore } from '../store';
import { toast, Toaster } from 'sonner';

const categoryIcons: Record<string, string> = {
  spelling: '📝',
  terminology: '🔗',
  date_number: '📅',
  punctuation: '✏️',
  length: '📏',
};

const severityColors: Record<string, string> = {
  error: 'text-status-error bg-red-50',
  warning: 'text-status-warning bg-amber-50',
  info: 'text-brand-indigo bg-blue-50',
};

export default function Validation() {
  const navigate = useNavigate();
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const {
    segments,
    validationResult,
    isValidating,
    setIsValidating,
    setValidationResult,
    autoFixIssues,
    currentProjectName,
  } = useAppStore();

  // Animated score counter
  const scoreValue = useMotionValue(0);
  const displayScore = useTransform(scoreValue, (v) => Math.round(v));
  const [scoreDisplay, setScoreDisplay] = useState(0);

  // Run validation on mount
  useEffect(() => {
    if (segments.length === 0) {
      navigate('/upload');
      return;
    }

    if (!validationResult) {
      runValidation();
    }
  }, []);

  // Animate score when result arrives
  useEffect(() => {
    if (validationResult) {
      const controls = animate(scoreValue, validationResult.qualityScore, {
        duration: 1.5,
        ease: [0.22, 1, 0.36, 1],
        onUpdate: (v) => setScoreDisplay(Math.round(v)),
      });
      return () => controls.stop();
    }
  }, [validationResult]);

  const runValidation = async () => {
    setIsValidating(true);
    try {
      const response = await fetch('/api/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          segments: segments.map((s) => ({
            id: s.id,
            index: s.index,
            sourceText: s.sourceText,
          })),
        }),
      });

      if (!response.ok) throw new Error('Validation failed');
      const result = await response.json();
      setValidationResult(result);
    } catch (err: any) {
      toast.error('Validation failed: ' + err.message);
    } finally {
      setIsValidating(false);
    }
  };

  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  const handleAutoFix = () => {
    autoFixIssues();
    toast.success('Auto-fix applied! Source issues corrected.', {
      duration: 3000,
      icon: <Sparkles className="w-5 h-5" />,
    });
  };

  const scoreColor =
    scoreDisplay >= 90 ? 'text-brand-emerald' : scoreDisplay >= 70 ? 'text-status-warning' : 'text-status-error';

  const circumference = 2 * Math.PI * 58;
  const scoreOffset = validationResult
    ? circumference - (circumference * validationResult.qualityScore) / 100
    : circumference;

  return (
    <div className="w-screen h-screen flex overflow-hidden">
      <Toaster position="top-right" toastOptions={{ style: { fontFamily: 'var(--font-dm-sans)', borderRadius: '12px' } }} />

      {/* Sidebar */}
      <div className="w-[260px] bg-brand-indigo flex flex-col">
        <div className="p-6 border-b border-white/10">
          <Link to="/home" className="text-[22px] font-black">
            <span className="text-white">verb</span>
            <span className="text-brand-emerald">AI</span>
          </Link>
        </div>
        <nav className="flex-1 py-6">
          <Link to="/upload" className="flex items-center gap-3 px-6 py-3 text-label-caps text-white/60 hover:text-white hover:bg-white/5">UPLOAD</Link>
          <div className="flex items-center gap-3 px-6 py-3 text-label-caps text-white bg-white/8 border-l-[3px] border-brand-emerald">VALIDATION</div>
          <Link to="/editor" className="flex items-center gap-3 px-6 py-3 text-label-caps text-white/60 hover:text-white hover:bg-white/5">TRANSLATION</Link>
          <Link to="/analytics" className="flex items-center gap-3 px-6 py-3 text-label-caps text-white/60 hover:text-white hover:bg-white/5">ANALYTICS</Link>
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
      <div className="flex-1 flex flex-col bg-ui-surface overflow-y-auto">
        {/* Top Bar */}
        <div className="h-16 bg-ui-white border-b border-ui-border flex items-center justify-between px-6">
          <div className="flex items-center gap-2 text-body-sm text-ui-slate">
            <span>Projects</span>
            <ChevronRight className="w-4 h-4" />
            <span className="text-brand-indigo font-medium">{currentProjectName || 'Document'}</span>
            <ChevronRight className="w-4 h-4" />
            <span className="text-brand-emerald font-medium">Source Validation</span>
          </div>
        </div>

        <div className="flex-1 p-8">
          <AnimatePresence mode="wait">
            {isValidating ? (
              /* ═══ SKELETON LOADER ═══ */
              <motion.div
                key="loading"
                className="max-w-[720px] mx-auto"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <div className="text-center mb-12">
                  <motion.div
                    className="inline-flex items-center gap-3 px-6 py-3 rounded-full bg-ui-white border border-ui-border"
                    style={{ boxShadow: 'var(--shadow-sm)' }}
                    animate={{ opacity: [0.6, 1, 0.6] }}
                    transition={{ duration: 2, repeat: Infinity }}
                  >
                    <div className="w-4 h-4 rounded-full bg-brand-emerald animate-ping" />
                    <span className="text-body-md text-brand-indigo font-medium">Running 5 quality checks…</span>
                  </motion.div>
                </div>

                <div className="space-y-4">
                  {['Spell Check', 'Terminology Consistency', 'Date/Number Format', 'Punctuation Style', 'Segment Length'].map(
                    (name, i) => (
                      <motion.div
                        key={name}
                        className="h-16 rounded-[16px] bg-ui-white border border-ui-border flex items-center px-6 gap-4"
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.3, duration: 0.4 }}
                      >
                        <div className="w-8 h-8 rounded-lg bg-ui-surface skeleton-shimmer" />
                        <div
                          className="h-3 rounded-full bg-gradient-to-r from-ui-border via-ui-surface to-ui-border skeleton-shimmer flex-1"
                          style={{ animationDelay: `${i * 0.15}s` }}
                        />
                        <div className="w-16 h-6 rounded-full bg-ui-surface skeleton-shimmer" style={{ animationDelay: `${i * 0.15 + 0.1}s` }} />
                      </motion.div>
                    )
                  )}
                </div>
              </motion.div>
            ) : validationResult ? (
              /* ═══ VALIDATION RESULTS ═══ */
              <motion.div
                key="results"
                className="max-w-[720px] mx-auto"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
              >
                {/* Scorecard */}
                <motion.div
                  className="rounded-[24px] bg-ui-white border border-ui-border p-8 mb-8 flex items-center gap-8"
                  style={{ boxShadow: 'var(--shadow-md)' }}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.2 }}
                >
                  {/* Score Gauge */}
                  <div className="relative w-[140px] h-[140px] flex-shrink-0">
                    <svg viewBox="0 0 128 128" className="w-full h-full -rotate-90">
                      <circle cx="64" cy="64" r="58" fill="none" stroke="#E2E8F0" strokeWidth="6" />
                      <motion.circle
                        cx="64"
                        cy="64"
                        r="58"
                        fill="none"
                        stroke={scoreDisplay >= 90 ? '#10B981' : scoreDisplay >= 70 ? '#F59E0B' : '#EF4444'}
                        strokeWidth="6"
                        strokeLinecap="round"
                        strokeDasharray={circumference}
                        initial={{ strokeDashoffset: circumference }}
                        animate={{ strokeDashoffset: scoreOffset }}
                        transition={{ duration: 1.5, ease: [0.22, 1, 0.36, 1], delay: 0.3 }}
                      />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className={`text-[36px] font-black ${scoreColor}`}>{scoreDisplay}</span>
                      <span className="text-[11px] text-ui-slate uppercase tracking-wider">/100</span>
                    </div>
                  </div>

                  <div className="flex-1">
                    <h2 className="text-display-h4 text-brand-indigo mb-2">Quality Score</h2>
                    <p className="text-body-md text-ui-slate mb-4">
                      {validationResult.totalIssues === 0
                        ? 'All checks passed! Your source is clean.'
                        : `${validationResult.totalIssues} issue${validationResult.totalIssues > 1 ? 's' : ''} found across ${segments.length} segments.`}
                    </p>
                    <div className="flex items-center gap-3">
                      {validationResult.totalIssues > 0 && (
                        <Button variant="primary" size="sm" onClick={handleAutoFix}>
                          <Sparkles className="w-4 h-4 mr-2" />
                          Auto-Fix Source Issues
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => navigate('/editor')}>
                        Start Translation →
                      </Button>
                    </div>
                  </div>
                </motion.div>

                {/* Check Categories */}
                <div className="space-y-3">
                  {validationResult.checks.map((check, i) => {
                    const categoryIssues = validationResult.issues.filter(
                      (issue) => issue.category === check.name.toLowerCase().replace(/[/ ]/g, '_').replace('date_number_format', 'date_number').replace('spell_check', 'spelling').replace('terminology_consistency', 'terminology').replace('punctuation_style', 'punctuation').replace('segment_length', 'length')
                    );
                    
                    // Determine match key
                    const catKey = check.name === 'Spell Check' ? 'spelling' 
                      : check.name === 'Terminology Consistency' ? 'terminology'
                      : check.name === 'Date/Number Format' ? 'date_number'
                      : check.name === 'Punctuation Style' ? 'punctuation'
                      : 'length';
                    
                    const issuesForCat = validationResult.issues.filter((issue) => issue.category === catKey);
                    const isExpanded = expandedCategories.has(check.name);

                    return (
                      <motion.div
                        key={check.name}
                        className="rounded-[16px] bg-ui-white border border-ui-border overflow-hidden"
                        style={{ boxShadow: 'var(--shadow-sm)' }}
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.4 + i * 0.1 }}
                      >
                        <button
                          className="w-full flex items-center gap-4 px-6 py-4 hover:bg-ui-surface transition-colors"
                          onClick={() => toggleCategory(check.name)}
                        >
                          <span className="text-xl">{check.icon}</span>
                          <span className="text-body-md font-medium text-brand-indigo flex-1 text-left">{check.name}</span>
                          {check.count > 0 ? (
                            <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-status-warning/15 text-status-warning">
                              {check.count} issue{check.count > 1 ? 's' : ''}
                            </span>
                          ) : (
                            <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-brand-emerald-light text-brand-emerald">
                              ✓ Pass
                            </span>
                          )}
                          {issuesForCat.length > 0 && (
                            <motion.div animate={{ rotate: isExpanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
                              <ChevronDown className="w-4 h-4 text-ui-slate" />
                            </motion.div>
                          )}
                        </button>

                        <AnimatePresence>
                          {isExpanded && issuesForCat.length > 0 && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.3 }}
                              className="overflow-hidden"
                            >
                              <div className="px-6 pb-4 space-y-2 border-t border-ui-border pt-3">
                                {issuesForCat.map((issue, j) => (
                                  <div
                                    key={j}
                                    className={`flex items-start gap-3 p-3 rounded-lg ${severityColors[issue.severity]}`}
                                  >
                                    {issue.severity === 'warning' ? (
                                      <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                                    ) : (
                                      <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
                                    )}
                                    <div className="flex-1">
                                      <p className="text-body-sm font-medium">{issue.text}</p>
                                      <p className="text-code-sm text-ui-slate mt-1">
                                        Segment #{issue.segmentIndex + 1}
                                        {issue.suggestion && ` → Suggested: "${issue.suggestion}"`}
                                      </p>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </motion.div>
                    );
                  })}
                </div>

                {/* Start Translation CTA */}
                <motion.div
                  className="flex justify-center mt-10"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 1 }}
                >
                  <Button variant="primary" size="lg" onClick={() => navigate('/editor')}>
                    Start Translation →
                  </Button>
                </motion.div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
