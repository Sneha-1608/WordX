import { useEffect, useState, useRef, useCallback } from 'react';
import { Link } from 'react-router';
import { motion, useMotionValue, animate, AnimatePresence } from 'motion/react';
import { Badge } from '../components/Badge';
import {
  AreaChart, Area, BarChart, Bar, RadarChart, Radar, PolarGrid,
  PolarAngleAxis, PolarRadiusAxis,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

const API = 'http://localhost:3001/api';

/* ═══════════════════════════════════
   ANIMATED COUNTER
   ═══════════════════════════════════ */
function AnimatedCounter({ target, suffix = '', prefix = '', decimals = 0, duration = 1.5, className = '' }: {
  target: number; suffix?: string; prefix?: string; decimals?: number; duration?: number; className?: string;
}) {
  const [display, setDisplay] = useState(0);
  const value = useMotionValue(0);

  useEffect(() => {
    const controls = animate(value, target, {
      duration,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setDisplay(decimals > 0 ? parseFloat(v.toFixed(decimals)) : Math.round(v)),
    });
    return () => controls.stop();
  }, [target]);

  return (
    <motion.span className={className} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      {prefix}{decimals > 0 ? display.toFixed(decimals) : display.toLocaleString()}{suffix}
    </motion.span>
  );
}

/* ═══════════════════════════════════
   PIPELINE PHASE INDICATOR
   ═══════════════════════════════════ */
type PipelinePhase = 'idle' | 'extracting' | 'training' | 'testing' | 'complete' | 'error';

function PipelineStepper({ phase, stats }: { phase: PipelinePhase; stats: any }) {
  const steps = [
    { id: 'extract', icon: '📦', label: 'Dataset Extraction', desc: `${stats?.collection?.totalRevisions || 0} revisions` },
    { id: 'train', icon: '🧠', label: 'QLoRA Training', desc: 'r=16, 4-bit, 3 epochs' },
    { id: 'test', icon: '📊', label: 'A/B Evaluation', desc: 'BLEU + Glossary + EditDist' },
    { id: 'deploy', icon: '🚀', label: 'Auto-Deploy', desc: `${stats?.activeAdapters?.length || 0} active` },
  ];

  const phaseOrder: Record<string, number> = { idle: -1, extracting: 0, training: 1, testing: 2, complete: 3, error: -1 };
  const currentIdx = phaseOrder[phase] ?? -1;

  return (
    <div className="flex items-center justify-between w-full">
      {steps.map((step, i) => {
        const isActive = i === currentIdx;
        const isDone = i < currentIdx || phase === 'complete';
        const isPending = i > currentIdx && phase !== 'complete';

        return (
          <div key={step.id} className="flex items-center flex-1">
            <motion.div
              className={`relative flex flex-col items-center text-center px-3 py-4 rounded-[20px] flex-1 min-w-[120px] transition-all duration-500 ${
                isDone ? 'bg-brand-emerald/10 border border-brand-emerald/30' :
                isActive ? 'bg-white/10 border border-brand-emerald/60 shadow-[0_0_24px_rgba(16,185,129,0.25)]' :
                'bg-white/[0.03] border border-white/10'
              }`}
              animate={isActive ? { scale: [1, 1.02, 1] } : {}}
              transition={isActive ? { duration: 2, repeat: Infinity, ease: 'easeInOut' } : {}}
            >
              {/* Completion checkmark */}
              {isDone && (
                <motion.div
                  className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-brand-emerald flex items-center justify-center text-white text-[11px] font-bold"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 15 }}
                >
                  ✓
                </motion.div>
              )}
              {/* Active pulse */}
              {isActive && (
                <motion.div
                  className="absolute inset-0 rounded-[20px] border-2 border-brand-emerald/40"
                  animate={{ opacity: [0.5, 0, 0.5] }}
                  transition={{ duration: 2, repeat: Infinity }}
                />
              )}
              <div className="text-[28px] mb-2">{step.icon}</div>
              <div className={`text-[12px] font-semibold ${isDone || isActive ? 'text-white' : 'text-white/40'}`}>
                {step.label}
              </div>
              <div className={`text-[10px] mt-1 ${isDone ? 'text-brand-emerald' : isActive ? 'text-white/70' : 'text-white/25'}`}>
                {isDone ? '✓ Complete' : isActive ? '● Running...' : step.desc}
              </div>
            </motion.div>

            {i < steps.length - 1 && (
              <div className="mx-2 flex-shrink-0">
                <svg width="40" height="12" viewBox="0 0 40 12">
                  <motion.line
                    x1="0" y1="6" x2="30" y2="6"
                    stroke={isDone ? '#10B981' : 'rgba(255,255,255,0.15)'}
                    strokeWidth="2"
                    strokeDasharray="5 4"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.8, delay: isDone ? 0 : 0.3 }}
                  />
                  <polygon
                    points="30,2 40,6 30,10"
                    fill={isDone ? '#10B981' : 'rgba(255,255,255,0.15)'}
                  />
                </svg>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════
   TERMINAL LOG COMPONENT (SSE receiver)
   ═══════════════════════════════════ */
function TerminalLog({ lines, progress }: {
  lines: { message: string; type: string; timestamp?: string; phase?: string }[];
  progress: number;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  const getLineColor = (line: { message: string; type: string }) => {
    if (line.type === 'error') return 'text-red-400';
    if (line.type === 'complete') return 'text-[#10B981]';
    if (line.type === 'phase') return 'text-blue-400 font-semibold';
    if (line.message.includes('✅')) return 'text-[#10B981]';
    if (line.message.includes('⚠')) return 'text-yellow-400';
    if (line.message.includes('ERROR')) return 'text-red-400';
    if (line.message.includes('Epoch')) return 'text-purple-300';
    if (line.message.includes('loss:') || line.message.includes('Loss:')) return 'text-orange-300';
    return 'text-white/80';
  };

  const getLineIcon = (line: { message: string; type: string }) => {
    if (line.type === 'error') return '✗';
    if (line.type === 'complete') return '✓';
    if (line.type === 'phase') return '▸';
    if (line.message.includes('Epoch')) return '⟳';
    if (line.message.includes('Extracting')) return '📦';
    if (line.message.includes('Initializing')) return '⚙';
    if (line.message.includes('Adapter')) return '💾';
    if (line.message.includes('A/B') || line.message.includes('Model')) return '📊';
    return '›';
  };

  return (
    <div className="relative">
      {/* Progress bar */}
      {progress > 0 && progress < 100 && (
        <div className="absolute top-0 left-0 right-0 h-[3px] bg-white/5 rounded-t-[16px] overflow-hidden z-10">
          <motion.div
            className="h-full rounded-full"
            style={{ background: 'linear-gradient(90deg, #10B981, #34D399, #6EE7B7)' }}
            initial={{ width: '0%' }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          />
        </div>
      )}
      <div
        ref={scrollRef}
        className="bg-[#0a0920] rounded-[16px] p-5 font-[var(--font-jetbrains)] text-[12px] leading-[22px] overflow-y-auto max-h-[360px] border border-white/5"
        style={{ fontFamily: "'JetBrains Mono', 'Courier New', monospace" }}
      >
        {lines.length === 0 ? (
          <div className="text-white/25 flex items-center gap-2">
            <span className="text-[16px]">⌘</span>
            <span>Click "Run Full Pipeline" to start the training process...</span>
          </div>
        ) : (
          lines.map((line, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.25, delay: 0.02 }}
              className={`flex items-start gap-2 ${getLineColor(line)} ${line.type === 'phase' ? 'mt-3 mb-1' : ''}`}
            >
              <span className={`select-none flex-shrink-0 w-[20px] text-center ${
                line.type === 'phase' ? 'text-blue-400' : 'text-white/20'
              }`}>
                {getLineIcon(line)}
              </span>
              <span className="text-white/20 flex-shrink-0 w-[70px] select-none">
                {line.timestamp ? new Date(line.timestamp).toLocaleTimeString() : ''}
              </span>
              <span className="flex-1">{line.message}</span>
            </motion.div>
          ))
        )}
        {lines.length > 0 && lines[lines.length - 1].type !== 'complete' && lines[lines.length - 1].type !== 'error' && (
          <motion.span
            className="inline-block w-[7px] h-[14px] bg-brand-emerald ml-[92px] mt-1"
            animate={{ opacity: [1, 0] }}
            transition={{ duration: 0.7, repeat: Infinity }}
          />
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════
   METRIC COMPARISON CARD (Enhanced)
   ═══════════════════════════════════ */
function MetricCard({ label, baseValue, adapterValue, unit = '', better = 'higher', icon }: {
  label: string; baseValue: number; adapterValue: number; unit?: string; better?: 'higher' | 'lower'; icon?: string;
}) {
  const improved = better === 'higher' ? adapterValue > baseValue : adapterValue < baseValue;
  const delta = better === 'higher' ? adapterValue - baseValue : baseValue - adapterValue;
  const pctChange = baseValue !== 0 ? Math.abs((delta / baseValue) * 100) : 0;

  return (
    <motion.div
      className="rounded-[16px] bg-ui-white border border-ui-border p-5 relative overflow-hidden group"
      style={{ boxShadow: 'var(--shadow-sm)' }}
      whileHover={{ y: -2, boxShadow: '0px 8px 24px rgba(0,0,0,0.08)' }}
      transition={{ duration: 0.2 }}
    >
      {/* Gradient accent */}
      <div className={`absolute top-0 left-0 right-0 h-[3px] ${
        improved ? 'bg-gradient-to-r from-brand-emerald to-emerald-300' : 'bg-gradient-to-r from-status-warning to-yellow-300'
      }`} />

      <div className="flex items-center justify-between mb-3">
        <div className="text-label-caps text-ui-slate">{label}</div>
        {icon && <span className="text-[18px]">{icon}</span>}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="text-[10px] text-ui-slate-light uppercase tracking-wider mb-1">Base Model</div>
          <div className="text-[24px] font-bold text-ui-slate tabular-nums">{baseValue.toFixed(3)}{unit}</div>
        </div>
        <div>
          <div className="text-[10px] text-ui-slate-light uppercase tracking-wider mb-1">+ LoRA Adapter</div>
          <div className={`text-[24px] font-bold tabular-nums ${improved ? 'text-brand-emerald' : 'text-status-warning'}`}>
            {adapterValue.toFixed(3)}{unit}
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
          improved ? 'bg-brand-emerald/10 text-brand-emerald' : 'bg-status-warning/10 text-status-warning'
        }`}>
          {improved ? '↑' : '↓'} {pctChange.toFixed(1)}%
        </span>
        <span className="text-[11px] text-ui-slate-light">
          {improved ? 'improved' : 'needs review'}
        </span>
      </div>
    </motion.div>
  );
}

/* ═══════════════════════════════════
   TRAINING CONFIG CARD
   ═══════════════════════════════════ */
function ConfigBadge({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <motion.div
      className="flex items-center gap-3 p-3 rounded-[12px] bg-ui-surface border border-ui-border/50"
      whileHover={{ scale: 1.02 }}
    >
      <div className="w-8 h-8 rounded-[8px] bg-brand-indigo/5 flex items-center justify-center text-[16px]">{icon}</div>
      <div>
        <div className="text-[10px] text-ui-slate-light uppercase tracking-wider">{label}</div>
        <div className="text-[13px] font-bold text-brand-indigo">{value}</div>
      </div>
    </motion.div>
  );
}

/* ═══════════════════════════════════
   DATASET TABLE ROW
   ═══════════════════════════════════ */
function DatasetRow({ ds, index }: { ds: any; index: number }) {
  return (
    <motion.tr
      className="border-b border-ui-border/50 hover:bg-ui-surface/50 transition-colors"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
    >
      <td className="py-3 px-4 text-body-sm font-medium text-brand-indigo">{ds.version}</td>
      <td className="py-3 px-4 text-body-sm tabular-nums">{ds.pairs_count}</td>
      <td className="py-3 px-4 text-body-sm text-ui-slate">{ds.filtered_count}</td>
      <td className="py-3 px-4">
        <Badge
          type={ds.status === 'ready' ? 'success' : ds.status === 'training' ? 'fuzzy' : 'exact'}
          size="sm"
          text={ds.status}
        />
      </td>
      <td className="py-3 px-4 text-[11px] text-ui-slate-light">
        {ds.created_at ? new Date(ds.created_at).toLocaleString() : '—'}
      </td>
    </motion.tr>
  );
}

/* ═══════════════════════════════════
   MAIN TRAINING PIPELINE DASHBOARD
   ═══════════════════════════════════ */
export default function TrainingPipeline() {
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isTraining, setIsTraining] = useState(false);
  const [terminalLines, setTerminalLines] = useState<{ message: string; type: string; timestamp?: string }[]>([]);
  const [lastResult, setLastResult] = useState<any>(null);
  const [trainingRuns, setTrainingRuns] = useState<any[]>([]);
  const [abTests, setAbTests] = useState<any[]>([]);
  const [datasets, setDatasets] = useState<any[]>([]);
  const [pipelinePhase, setPipelinePhase] = useState<PipelinePhase>('idle');
  const [trainingProgress, setTrainingProgress] = useState(0);

  // Fetch pipeline status
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API}/training/status`);
      const data = await res.json();
      setStatus(data);
    } catch (err) {
      console.error('Status fetch failed:', err);
    }
  }, []);

  // Fetch training runs + A/B tests + datasets
  const fetchHistory = useCallback(async () => {
    try {
      const [runsRes, testsRes, dsRes] = await Promise.all([
        fetch(`${API}/training/runs`),
        fetch(`${API}/training/ab-tests`),
        fetch(`${API}/training/datasets`),
      ]);
      const runsData = await runsRes.json();
      const testsData = await testsRes.json();
      const dsData = await dsRes.json();
      setTrainingRuns(runsData.runs || []);
      setAbTests(testsData.tests || []);
      setDatasets(dsData.datasets || []);
    } catch (err) {
      console.error('History fetch failed:', err);
    }
  }, []);

  useEffect(() => {
    Promise.all([fetchStatus(), fetchHistory()]).finally(() => setLoading(false));
  }, []);

  // Full pipeline: Extract → Train → A/B Test (streamed via SSE)
  const runFullPipeline = async () => {
    setIsTraining(true);
    setTerminalLines([]);
    setLastResult(null);
    setTrainingProgress(0);
    setPipelinePhase('extracting');

    try {
      // ───── Phase 1: Extract dataset ─────
      setTerminalLines(prev => [
        ...prev,
        { type: 'phase', message: '═══ PHASE 1: DATASET EXTRACTION ═══' },
        { type: 'log', message: 'Querying revisions table for human-corrected translation pairs...', timestamp: new Date().toISOString() },
      ]);

      const extractRes = await fetch(`${API}/training/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceLang: 'en', targetLang: 'hi_IN' }),
      });
      const extractData = await extractRes.json();
      setTrainingProgress(10);

      setTerminalLines(prev => [
        ...prev,
        { type: 'log', message: `Dataset ${extractData.version}: ${extractData.pairsCount} pairs extracted (${extractData.filteredCount} quality-filtered)`, timestamp: new Date().toISOString() },
        { type: 'log', message: `Format: instruction-tuning (Unsloth/HF compatible)`, timestamp: new Date().toISOString() },
      ]);

      if (!extractData.meetsThreshold) {
        setTerminalLines(prev => [
          ...prev,
          { type: 'error', message: `Insufficient data: need ${extractData.threshold} pairs, only have ${extractData.pairsCount}. Approve more segments with edits first.` },
        ]);
        setPipelinePhase('error');
        setIsTraining(false);
        return;
      }

      // ───── Phase 2: Create + execute training run ─────
      setPipelinePhase('training');
      setTerminalLines(prev => [
        ...prev,
        { type: 'phase', message: '═══ PHASE 2: QLoRA FINE-TUNING ═══' },
        { type: 'log', message: 'Creating training run...', timestamp: new Date().toISOString() },
      ]);

      const startRes = await fetch(`${API}/training/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ datasetId: extractData.datasetId }),
      });
      const startData = await startRes.json();
      setTrainingProgress(15);

      setTerminalLines(prev => [
        ...prev,
        { type: 'log', message: `Run #${startData.runId} queued → Adapter: '${startData.adapterName}'`, timestamp: new Date().toISOString() },
      ]);

      // ───── SSE stream for training + A/B test ─────
      const eventSource = new EventSource(`${API}/training/runs/${startData.runId}/stream`);

      eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.type === 'complete') {
          setLastResult(data);
          setPipelinePhase('complete');
          setTrainingProgress(100);
          setTerminalLines(prev => [
            ...prev,
            { type: 'phase', message: '═══ PIPELINE COMPLETE ═══' },
            { type: 'complete', message: data.message, timestamp: new Date().toISOString() },
          ]);
          eventSource.close();
          setIsTraining(false);
          fetchStatus();
          fetchHistory();
        } else if (data.type === 'error') {
          setPipelinePhase('error');
          setTerminalLines(prev => [
            ...prev,
            { type: 'error', message: `Pipeline Error: ${data.message}` },
          ]);
          eventSource.close();
          setIsTraining(false);
        } else {
          // Track progress from SSE messages
          const msg = data.message || '';
          if (msg.includes('Epoch 1/3')) setTrainingProgress(30);
          else if (msg.includes('Epoch 2/3')) setTrainingProgress(50);
          else if (msg.includes('Epoch 3/3')) setTrainingProgress(70);
          else if (msg.includes('Validation')) setTrainingProgress(80);
          else if (msg.includes('A/B') || msg.includes('evaluation')) {
            setPipelinePhase('testing');
            setTrainingProgress(85);
            setTerminalLines(prev => [
              ...prev,
              { type: 'phase', message: '═══ PHASE 3: A/B EVALUATION ═══' },
            ]);
          }
          else if (msg.includes('Model A')) setTrainingProgress(88);
          else if (msg.includes('Model B')) setTrainingProgress(92);
          else if (msg.includes('AUTO DEPLOYING') || msg.includes('manual review')) setTrainingProgress(95);

          setTerminalLines(prev => [
            ...prev,
            { type: data.type, message: msg, timestamp: data.timestamp },
          ]);
        }
      };

      eventSource.onerror = () => {
        eventSource.close();
        setIsTraining(false);
        setPipelinePhase('idle');
        fetchStatus();
        fetchHistory();
      };
    } catch (err: any) {
      setTerminalLines(prev => [
        ...prev,
        { type: 'error', message: `Pipeline failed: ${err.message}` },
      ]);
      setPipelinePhase('error');
      setIsTraining(false);
    }
  };

  // Rollback handler
  const handleRollback = async (adapterId: number) => {
    try {
      const res = await fetch(`${API}/training/rollback/${adapterId}`, { method: 'POST' });
      await res.json();
      fetchStatus();
      fetchHistory();
    } catch (err: any) {
      console.error('Rollback failed:', err);
    }
  };

  // Manual deploy handler
  const handleManualDeploy = async (runId: number) => {
    try {
      const res = await fetch(`${API}/training/deploy/${runId}`, { method: 'POST' });
      await res.json();
      fetchStatus();
      fetchHistory();
    } catch (err: any) {
      console.error('Deploy failed:', err);
    }
  };

  // Loss curve chart data
  const lossData = lastResult?.training?.metrics?.losses
    ? [
        { epoch: 'Epoch 1', loss: lastResult.training.metrics.losses.epoch1, lr: 0.0002 },
        { epoch: 'Epoch 2', loss: lastResult.training.metrics.losses.epoch2, lr: 0.0002 },
        { epoch: 'Epoch 3', loss: lastResult.training.metrics.losses.epoch3, lr: 0.0002 },
      ]
    : trainingRuns.length > 0 && trainingRuns[0].metadata?.losses
      ? [
          { epoch: 'Epoch 1', loss: trainingRuns[0].metadata.losses.epoch1, lr: 0.0002 },
          { epoch: 'Epoch 2', loss: trainingRuns[0].metadata.losses.epoch2, lr: 0.0002 },
          { epoch: 'Epoch 3', loss: trainingRuns[0].metadata.losses.epoch3, lr: 0.0002 },
        ]
      : [];

  // A/B radar chart data
  const abResult = lastResult?.abTest || (abTests.length > 0 ? {
    metrics: {
      base: { bleu: abTests[0].base_bleu, editDistance: abTests[0].base_edit_dist, glossaryCompliance: abTests[0].base_glossary_compliance },
      adapter: { bleu: abTests[0].adapter_bleu, editDistance: abTests[0].adapter_edit_dist, glossaryCompliance: abTests[0].adapter_glossary_compliance },
      humanPreference: abTests[0].human_preference_rate,
      bleuDelta: abTests[0].adapter_bleu - abTests[0].base_bleu,
    },
    decision: abTests[0].decision,
    decisionReason: abTests[0].decision_reason,
    adapterName: abTests[0].adapter_name,
  } : null);

  const radarData = abResult ? [
    { metric: 'BLEU', base: abResult.metrics.base.bleu * 100, adapter: abResult.metrics.adapter.bleu * 100 },
    { metric: 'Glossary', base: abResult.metrics.base.glossaryCompliance * 100, adapter: abResult.metrics.adapter.glossaryCompliance * 100 },
    { metric: 'Preference', base: 50, adapter: (abResult.metrics.humanPreference || 0.65) * 100 },
    { metric: 'Accuracy', base: (1 - abResult.metrics.base.editDistance / 50) * 100, adapter: (1 - abResult.metrics.adapter.editDistance / 50) * 100 },
  ] : [];

  // Pipeline progress
  const collectionPct = status?.collection?.progress || 0;

  if (loading) {
    return (
      <div className="w-screen h-screen flex items-center justify-center bg-ui-surface">
        <motion.div
          className="w-12 h-12 rounded-full border-3 border-brand-emerald/20 border-t-brand-emerald"
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
        />
      </div>
    );
  }

  return (
    <div className="w-screen h-screen flex overflow-hidden">
      {/* Left Sidebar */}
      <div className="w-[260px] bg-brand-indigo flex flex-col shrink-0">
        <div className="p-6 border-b border-white/10">
          <Link to="/home" className="text-[22px] font-black">
            <span className="text-white">verb</span>
            <span className="text-brand-emerald">AI</span>
          </Link>
        </div>
        <nav className="flex-1 py-6">
          <Link to="/upload" className="flex items-center gap-3 px-6 py-3 text-label-caps text-white/60 hover:text-white hover:bg-white/5">UPLOAD</Link>
          <Link to="/editor" className="flex items-center gap-3 px-6 py-3 text-label-caps text-white/60 hover:text-white hover:bg-white/5">TRANSLATION</Link>
          <Link to="/analytics" className="flex items-center gap-3 px-6 py-3 text-label-caps text-white/60 hover:text-white hover:bg-white/5">ANALYTICS</Link>
          <Link to="/training" className="flex items-center gap-3 px-6 py-3 text-label-caps text-white bg-white/8 border-l-[3px] border-brand-emerald">TRAINING</Link>
          <Link to="/home" className="flex items-center gap-3 px-6 py-3 text-label-caps text-white/60 hover:text-white hover:bg-white/5">DASHBOARD</Link>
        </nav>
        <div className="p-6 border-t border-white/10 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-brand-emerald flex items-center justify-center text-white font-bold">A</div>
          <div className="flex-1">
            <div className="text-body-sm font-medium text-white">Admin</div>
            <div className="text-[11px] text-white/60">ML Engineer</div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col bg-ui-surface overflow-y-auto">
        <div className="p-6 max-w-[1400px]">
          {/* Header */}
          <div className="mb-8 flex items-start justify-between">
            <div>
              <h1 className="text-display-h3 text-brand-indigo mb-2">Training Pipeline</h1>
              <p className="text-body-md text-ui-slate">
                QLoRA fine-tuning with Unsloth — Continuous model improvement from human corrections
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Badge
                type={status?.mode === 'SIMULATED' ? 'fuzzy' : 'success'}
                size="sm"
                text={status?.mode === 'SIMULATED' ? '🧪 Demo Mode' : '🟢 GPU Active'}
              />
              <button
                onClick={() => { fetchStatus(); fetchHistory(); }}
                className="text-body-sm text-ui-slate hover:text-brand-indigo transition-colors px-3 py-1.5 rounded-[8px] hover:bg-white border border-transparent hover:border-ui-border"
              >
                ↻ Refresh
              </button>
            </div>
          </div>

          {/* ════════════════════════════════════
             Row 0: Pipeline Lifecycle Stepper
             ════════════════════════════════════ */}
          <motion.div
            className="rounded-[24px] bg-brand-indigo p-8 mb-8"
            style={{ boxShadow: '0px 20px 48px rgba(30,27,75,0.3)' }}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
          >
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-[14px] font-bold text-white tracking-wide">PIPELINE LIFECYCLE</h3>
                <p className="text-[11px] text-white/40 mt-1">Human Reviews → Dataset → QLoRA → A/B Test → Deploy</p>
              </div>
              <button
                onClick={runFullPipeline}
                disabled={isTraining}
                className={`px-6 py-3 rounded-full text-[13px] font-bold tracking-wide transition-all duration-300 ${
                  isTraining
                    ? 'bg-white/10 text-white/40 cursor-not-allowed'
                    : 'bg-brand-emerald text-white hover:shadow-[0_0_32px_rgba(16,185,129,0.4)] hover:scale-[1.03] active:scale-[0.97]'
                }`}
              >
                {isTraining ? (
                  <span className="flex items-center gap-2">
                    <motion.span
                      className="w-4 h-4 rounded-full border-2 border-white/20 border-t-white inline-block"
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                    />
                    Pipeline Running...
                  </span>
                ) : (
                  '▶ Run Full Pipeline'
                )}
              </button>
            </div>
            <PipelineStepper phase={pipelinePhase} stats={status} />
          </motion.div>

          {/* ════════════════════════════════════
             Row 1: Pipeline Status Cards
             ════════════════════════════════════ */}
          <div className="grid grid-cols-4 gap-5 mb-8">
            {[
              {
                icon: '📝', label: 'REVISIONS', value: status?.collection?.totalRevisions || 0,
                sub: `${collectionPct}% to threshold`, showBar: true, barPct: collectionPct,
                gradient: 'from-violet-500/10 to-purple-500/5',
              },
              {
                icon: '📦', label: 'DATASETS', value: status?.datasets?.total || 0,
                sub: `${status?.datasets?.ready || 0} ready for training`,
                gradient: 'from-blue-500/10 to-cyan-500/5',
              },
              {
                icon: '🧠', label: 'TRAINING RUNS', value: status?.training?.totalRuns || 0,
                sub: `${status?.training?.completed || 0} completed`,
                gradient: 'from-brand-emerald/10 to-green-500/5',
              },
              {
                icon: '🚀', label: 'ACTIVE ADAPTERS', value: status?.activeAdapters?.length || 0,
                sub: `${status?.abTesting?.autoDeployed || 0} auto-deployed`,
                gradient: 'from-amber-500/10 to-orange-500/5',
              },
            ].map((card, i) => (
              <motion.div
                key={i}
                className={`rounded-[20px] bg-ui-white border border-ui-border p-6 relative overflow-hidden bg-gradient-to-br ${card.gradient}`}
                style={{ boxShadow: 'var(--shadow-sm)' }}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + i * 0.05 }}
                whileHover={{ y: -3, boxShadow: 'var(--shadow-md)' }}
              >
                <div className="text-[28px] mb-3">{card.icon}</div>
                <AnimatedCounter target={card.value} className="text-[40px] font-black text-brand-indigo leading-none" />
                <div className="text-label-caps text-ui-slate mt-2">{card.label}</div>
                <div className="text-[11px] text-ui-slate-light mt-1">{card.sub}</div>
                {card.showBar && (
                  <div className="mt-3 w-full h-[6px] rounded-full bg-ui-surface overflow-hidden">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ background: 'linear-gradient(90deg, #10B981, #059669)' }}
                      initial={{ width: '0%' }}
                      animate={{ width: `${Math.min(100, card.barPct || 0)}%` }}
                      transition={{ duration: 1.5, ease: [0.22, 1, 0.36, 1] }}
                    />
                  </div>
                )}
              </motion.div>
            ))}
          </div>

          {/* ════════════════════════════════════
             Row 2: Terminal + Loss Curve + Config
             ════════════════════════════════════ */}
          <div className="grid grid-cols-[1fr_380px] gap-6 mb-8">
            {/* Terminal */}
            <motion.div
              className="rounded-[24px] bg-ui-white border border-ui-border p-6"
              style={{ boxShadow: 'var(--shadow-sm)' }}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded-full bg-red-400/80" />
                    <div className="w-3 h-3 rounded-full bg-yellow-400/80" />
                    <div className="w-3 h-3 rounded-full bg-green-400/80" />
                  </div>
                  <h3 className="text-body-sm font-bold text-brand-indigo">TRAINING TERMINAL</h3>
                  {isTraining && (
                    <motion.div
                      className="w-2 h-2 rounded-full bg-brand-emerald"
                      animate={{ opacity: [1, 0.3, 1] }}
                      transition={{ duration: 1, repeat: Infinity }}
                    />
                  )}
                </div>
                {trainingProgress > 0 && (
                  <span className="text-[11px] font-bold tabular-nums text-brand-emerald">{Math.round(trainingProgress)}%</span>
                )}
              </div>
              <TerminalLog lines={terminalLines} progress={trainingProgress} />
            </motion.div>

            {/* Right column: Loss Curve + Config */}
            <div className="space-y-6">
              {/* Loss Curve */}
              <motion.div
                className="rounded-[24px] bg-ui-white border border-ui-border p-6"
                style={{ boxShadow: 'var(--shadow-sm)' }}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.35 }}
              >
                <h3 className="text-body-sm font-bold text-brand-indigo mb-4">TRAINING LOSS CURVE</h3>
                {lossData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={180}>
                    <AreaChart data={lossData}>
                      <defs>
                        <linearGradient id="lossGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#EF4444" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#10B981" stopOpacity={0.05} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="epoch" stroke="#94A3B8" style={{ fontSize: '11px' }} />
                      <YAxis stroke="#94A3B8" style={{ fontSize: '11px' }} />
                      <Tooltip
                        contentStyle={{ background: '#FFF', border: '1px solid #E2E8F0', borderRadius: '10px', fontSize: '12px' }}
                        formatter={(value: any) => [`${value}`, 'Loss']}
                      />
                      <Area type="monotone" dataKey="loss" stroke="#EF4444" strokeWidth={2.5} fillOpacity={1} fill="url(#lossGradient)" dot={{ r: 4, fill: '#EF4444' }} />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[180px] flex items-center justify-center text-ui-slate text-body-sm">
                    <div className="text-center">
                      <div className="text-[36px] mb-2 opacity-20">📉</div>
                      <div className="text-[12px]">Run pipeline to see loss curve</div>
                    </div>
                  </div>
                )}
              </motion.div>

              {/* Training Config */}
              <motion.div
                className="rounded-[24px] bg-ui-white border border-ui-border p-6"
                style={{ boxShadow: 'var(--shadow-sm)' }}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
              >
                <h3 className="text-body-sm font-bold text-brand-indigo mb-4">QLoRA CONFIGURATION</h3>
                <div className="grid grid-cols-2 gap-3">
                  <ConfigBadge icon="🏗" label="LoRA Rank" value="r = 16" />
                  <ConfigBadge icon="⚡" label="Quantization" value="4-bit" />
                  <ConfigBadge icon="📐" label="Alpha" value="α = 16" />
                  <ConfigBadge icon="🔁" label="Epochs" value="3" />
                  <ConfigBadge icon="📦" label="Batch Size" value="4" />
                  <ConfigBadge icon="📏" label="LR" value="2e-4" />
                </div>
              </motion.div>
            </div>
          </div>

          {/* ════════════════════════════════════
             Row 3: A/B Test Metrics + Radar
             ════════════════════════════════════ */}
          <div className="grid grid-cols-[1fr_380px] gap-6 mb-8">
            {/* A/B metrics cards */}
            <motion.div
              className="rounded-[24px] bg-ui-white border border-ui-border p-6"
              style={{ boxShadow: 'var(--shadow-sm)' }}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.45 }}
            >
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-body-sm font-bold text-brand-indigo">A/B TEST METRICS</h3>
                {abResult && (
                  <Badge
                    type={abResult.decision === 'auto_deploy' ? 'success' : 'fuzzy'}
                    size="sm"
                    text={abResult.decision === 'auto_deploy' ? '✅ Auto-Deployed' : '⚠ Manual Review'}
                  />
                )}
              </div>
              {abResult ? (
                <div className="space-y-5">
                  <div className="grid grid-cols-2 gap-4">
                    <MetricCard icon="📝" label="BLEU SCORE" baseValue={abResult.metrics.base.bleu} adapterValue={abResult.metrics.adapter.bleu} better="higher" />
                    <MetricCard icon="📏" label="EDIT DISTANCE" baseValue={abResult.metrics.base.editDistance} adapterValue={abResult.metrics.adapter.editDistance} better="lower" />
                    <MetricCard icon="📚" label="GLOSSARY COMPLIANCE" baseValue={abResult.metrics.base.glossaryCompliance} adapterValue={abResult.metrics.adapter.glossaryCompliance} better="higher" />
                    {/* Human Preference */}
                    <motion.div
                      className="rounded-[16px] bg-ui-white border border-ui-border p-5 relative overflow-hidden"
                      style={{ boxShadow: 'var(--shadow-sm)' }}
                      whileHover={{ y: -2, boxShadow: '0px 8px 24px rgba(0,0,0,0.08)' }}
                    >
                      <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-brand-emerald to-emerald-300" />
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-label-caps text-ui-slate">HUMAN PREFERENCE</div>
                        <span className="text-[16px]">👤</span>
                      </div>
                      <div className="text-[40px] font-black text-brand-emerald leading-none">
                        <AnimatedCounter target={Math.round((abResult.metrics.humanPreference || 0.65) * 100)} suffix="%" className="text-[40px] font-black text-brand-emerald" />
                      </div>
                      <div className="text-[11px] text-ui-slate-light mt-2">prefer adapter output over base</div>
                    </motion.div>
                  </div>
                  {/* Decision reason */}
                  {abResult.decisionReason && (
                    <div className={`p-4 rounded-[12px] text-[12px] ${
                      abResult.decision === 'auto_deploy'
                        ? 'bg-brand-emerald/5 border border-brand-emerald/20 text-brand-emerald'
                        : 'bg-status-warning/5 border border-status-warning/20 text-status-warning'
                    }`}>
                      <span className="font-semibold">Decision: </span>{abResult.decisionReason}
                    </div>
                  )}
                </div>
              ) : (
                <div className="h-[300px] flex items-center justify-center text-ui-slate text-body-sm">
                  <div className="text-center">
                    <div className="text-[48px] mb-3 opacity-20">📊</div>
                    <div>No A/B tests yet. Run the pipeline to generate metrics.</div>
                  </div>
                </div>
              )}
            </motion.div>

            {/* Radar Chart + Adapters */}
            <div className="space-y-6">
              {/* Radar Chart */}
              <motion.div
                className="rounded-[24px] bg-ui-white border border-ui-border p-6"
                style={{ boxShadow: 'var(--shadow-sm)' }}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
              >
                <h3 className="text-body-sm font-bold text-brand-indigo mb-3">ADAPTER vs BASE</h3>
                {radarData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <RadarChart data={radarData} outerRadius={70}>
                      <PolarGrid stroke="rgba(0,0,0,0.06)" />
                      <PolarAngleAxis dataKey="metric" tick={{ fill: '#64748B', fontSize: 11 }} />
                      <PolarRadiusAxis tick={false} axisLine={false} domain={[0, 100]} />
                      <Radar name="Base" dataKey="base" stroke="#94A3B8" fill="#94A3B8" fillOpacity={0.15} strokeWidth={1.5} />
                      <Radar name="Adapter" dataKey="adapter" stroke="#10B981" fill="#10B981" fillOpacity={0.2} strokeWidth={2} />
                      <Legend wrapperStyle={{ fontSize: '11px' }} />
                    </RadarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[220px] flex items-center justify-center text-ui-slate text-[12px]">
                    <div className="text-center">
                      <div className="text-[32px] mb-2 opacity-20">🎯</div>
                      <div>Run pipeline to compare</div>
                    </div>
                  </div>
                )}
              </motion.div>

              {/* Active Adapters */}
              <motion.div
                className="rounded-[24px] bg-ui-white border border-ui-border p-6"
                style={{ boxShadow: 'var(--shadow-sm)' }}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.55 }}
              >
                <h3 className="text-body-sm font-bold text-brand-indigo mb-4">ACTIVE ADAPTERS</h3>
                {status?.activeAdapters && status.activeAdapters.length > 0 ? (
                  <div className="space-y-3">
                    {status.activeAdapters.map((adapter: any, i: number) => (
                      <div key={i} className="flex items-center justify-between p-3 rounded-[12px] bg-ui-surface group">
                        <div className="flex-1 min-w-0">
                          <div className="text-[12px] font-semibold text-brand-indigo truncate">{adapter.name}</div>
                          <div className="text-[10px] text-ui-slate-light">{adapter.targetLang} • BLEU {adapter.accuracyLora?.toFixed(3) || '—'}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge type="success" size="sm" text="Active" />
                          <button
                            onClick={() => handleRollback(adapter.id)}
                            className="text-[10px] text-status-error opacity-0 group-hover:opacity-100 transition-opacity px-2 py-1 rounded hover:bg-status-error/5"
                          >
                            Rollback
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-body-sm text-ui-slate text-center py-4">No active adapters</div>
                )}
              </motion.div>
            </div>
          </div>

          {/* ════════════════════════════════════
             Row 4: Datasets + Training History
             ════════════════════════════════════ */}
          <div className="grid grid-cols-2 gap-6 mb-8">
            {/* Dataset Explorer */}
            <motion.div
              className="rounded-[24px] bg-ui-white border border-ui-border p-6"
              style={{ boxShadow: 'var(--shadow-sm)' }}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }}
            >
              <h3 className="text-body-sm font-bold text-brand-indigo mb-4">DATASET EXPLORER</h3>
              {datasets.length > 0 ? (
                <div className="overflow-hidden rounded-[12px] border border-ui-border">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-ui-surface border-b border-ui-border">
                        <th className="py-2.5 px-4 text-[10px] text-ui-slate-light uppercase tracking-wider font-medium">Version</th>
                        <th className="py-2.5 px-4 text-[10px] text-ui-slate-light uppercase tracking-wider font-medium">Pairs</th>
                        <th className="py-2.5 px-4 text-[10px] text-ui-slate-light uppercase tracking-wider font-medium">Filtered</th>
                        <th className="py-2.5 px-4 text-[10px] text-ui-slate-light uppercase tracking-wider font-medium">Status</th>
                        <th className="py-2.5 px-4 text-[10px] text-ui-slate-light uppercase tracking-wider font-medium">Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {datasets.slice(0, 6).map((ds: any, i: number) => (
                        <DatasetRow key={ds.id} ds={ds} index={i} />
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="h-[200px] flex items-center justify-center text-ui-slate text-body-sm">
                  <div className="text-center">
                    <div className="text-[36px] mb-2 opacity-20">📦</div>
                    <div className="text-[12px]">No datasets extracted yet</div>
                  </div>
                </div>
              )}
            </motion.div>

            {/* Training History */}
            <motion.div
              className="rounded-[24px] bg-ui-white border border-ui-border p-6"
              style={{ boxShadow: 'var(--shadow-sm)' }}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.65 }}
            >
              <h3 className="text-body-sm font-bold text-brand-indigo mb-4">TRAINING HISTORY</h3>
              {trainingRuns.length > 0 ? (
                <div className="space-y-3">
                  {trainingRuns.slice(0, 6).map((run: any, i: number) => (
                    <motion.div
                      key={run.id}
                      className="flex items-center justify-between p-3.5 rounded-[12px] bg-ui-surface border border-ui-border/50 group"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.05 }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[12px] font-semibold text-brand-indigo">Run #{run.id}</span>
                          <Badge
                            type={run.status === 'completed' ? 'success' : run.status === 'failed' ? 'exact' : 'fuzzy'}
                            size="sm"
                            text={run.status}
                          />
                        </div>
                        <div className="text-[10px] text-ui-slate-light mt-1 flex items-center gap-3">
                          {run.training_loss && <span>Loss: {run.training_loss.toFixed(3)}</span>}
                          {run.adapter_size_mb && <span>{run.adapter_size_mb.toFixed(1)}MB</span>}
                          <span className="truncate max-w-[120px]">{run.adapter_name}</span>
                        </div>
                      </div>
                      {/* Manual deploy for runs that got manual_review */}
                      {run.status === 'completed' && (
                        <button
                          onClick={() => handleManualDeploy(run.id)}
                          className="text-[10px] text-brand-emerald opacity-0 group-hover:opacity-100 transition-opacity px-2.5 py-1 rounded-[6px] hover:bg-brand-emerald/5 border border-transparent hover:border-brand-emerald/20"
                        >
                          Deploy
                        </button>
                      )}
                    </motion.div>
                  ))}
                </div>
              ) : (
                <div className="h-[200px] flex items-center justify-center text-ui-slate text-body-sm">
                  <div className="text-center">
                    <div className="text-[36px] mb-2 opacity-20">🧠</div>
                    <div className="text-[12px]">No training runs yet</div>
                  </div>
                </div>
              )}
            </motion.div>
          </div>

        </div>
      </div>
    </div>
  );
}
