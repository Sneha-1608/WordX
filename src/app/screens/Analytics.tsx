import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router';
import { motion, useMotionValue, animate } from 'motion/react';
import { Badge } from '../components/Badge';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line,
} from 'recharts';
import { useDashboardStore } from '../store';

/* ═══════════════════════════════════════════════════════════════
   ANIMATED COUNTER — smooth number transitions
   ═══════════════════════════════════════════════════════════════ */
function AnimatedCounter({ target, suffix = '', prefix = '', duration = 1.5, decimals = 0, className = '' }: {
  target: number; suffix?: string; prefix?: string; duration?: number; decimals?: number; className?: string;
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
      {prefix}{display.toLocaleString()}{suffix}
    </motion.span>
  );
}

/* ═══════════════════════════════════════════════════════════════
   PULSE DOT — live indicator
   ═══════════════════════════════════════════════════════════════ */
function PulseDot() {
  return (
    <span className="relative flex h-2.5 w-2.5">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-emerald opacity-75" />
      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-brand-emerald" />
    </span>
  );
}

/* ═══════════════════════════════════════════════════════════════
   STATUS COLOR — for leverage rate thresholds
   ═══════════════════════════════════════════════════════════════ */
function getLeverageColor(rate: number) {
  if (rate >= 90) return '#10B981'; // green
  if (rate >= 70) return '#F59E0B'; // yellow
  return '#EF4444'; // red
}

function getComplianceColor(rate: number) {
  if (rate >= 99) return '#10B981';
  if (rate >= 95) return '#F59E0B';
  return '#EF4444';
}

/* ═══════════════════════════════════════════════════════════════
   LANGUAGE HEAT TILE
   ═══════════════════════════════════════════════════════════════ */
function LangTile({ lang }: { lang: { code: string; name: string; tmRecords: number; active: boolean; intensity: number } }) {
  const bg = lang.active
    ? `rgba(16, 185, 129, ${0.15 + lang.intensity * 0.6})`
    : 'rgba(148, 163, 184, 0.08)';
  const border = lang.active ? 'rgba(16, 185, 129, 0.3)' : 'rgba(148, 163, 184, 0.15)';
  return (
    <motion.div
      className="rounded-lg px-2.5 py-1.5 text-center"
      style={{ background: bg, border: `1px solid ${border}` }}
      whileHover={{ scale: 1.05 }}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: Math.random() * 0.3 }}
    >
      <div className="text-[11px] font-semibold" style={{ color: lang.active ? '#10B981' : '#94A3B8' }}>
        {lang.name}
      </div>
      {lang.active && (
        <div className="text-[10px] text-ui-slate">{lang.tmRecords} TM</div>
      )}
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   CUSTOM RECHARTS TOOLTIP
   ═══════════════════════════════════════════════════════════════ */
const ChartTooltipStyle = {
  background: '#FFFFFF',
  border: '1px solid #E2E8F0',
  borderRadius: '12px',
  fontSize: '12px',
  padding: '8px 12px',
  boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
};

/* ═══════════════════════════════════════════════════════════════
   MAIN ANALYTICS DASHBOARD
   ═══════════════════════════════════════════════════════════════ */
export default function Analytics() {
  const { data, isLoading, refreshDashboard, lastUpdated } = useDashboardStore();
  const [roiVolume, setRoiVolume] = useState(1000);
  const [qualityCheck, setQualityCheck] = useState<{ averageBleu: number, tests: any[] } | null>(null);
  const [isCheckingQuality, setIsCheckingQuality] = useState(false);

  // Language Pairs (Improvement 3)
  const [langPairs, setLangPairs] = useState<any[]>([]);
  const [showLangPairs, setShowLangPairs] = useState(false);

  // Webhook Jobs (Improvement 1)
  const [webhookData, setWebhookData] = useState<{ jobs: any[], summary: any } | null>(null);
  const [showWebhooks, setShowWebhooks] = useState(false);
  const [webhookTestPayload, setWebhookTestPayload] = useState('{\n  "content_id": "test-001",\n  "source_text": "Welcome to our service portal. Your security is our top priority. Contact customer support for assistance.",\n  "source_lang": "en",\n  "target_langs": ["hi_IN"],\n  "project_name": "Webhook Test"\n}');

  const runQualityCheck = async () => {
    setIsCheckingQuality(true);
    try {
      const res = await fetch('http://localhost:3001/api/analytics/quality-check', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to run quality check');
      const responseData = await res.json();
      setQualityCheck(responseData);
    } catch (err: any) {
      console.error(err);
      alert('Quality check failed: ' + err.message);
    } finally {
      setIsCheckingQuality(false);
    }
  };

  // Initial fetch + 10s polling (spec §6 refresh strategy)
  useEffect(() => {
    refreshDashboard();
    const interval = setInterval(refreshDashboard, 10000);
    return () => clearInterval(interval);
  }, []);

  // Fetch language pairs
  useEffect(() => {
    if (showLangPairs) {
      fetch('http://localhost:3001/api/analytics/language-pairs')
        .then((r) => r.json())
        .then((d) => setLangPairs(d.pairs || []))
        .catch(() => {});
    }
  }, [showLangPairs]);

  // Fetch webhook jobs
  useEffect(() => {
    if (showWebhooks) {
      fetch('http://localhost:3001/api/analytics/webhook-jobs')
        .then((r) => r.json())
        .then((d) => setWebhookData(d))
        .catch(() => {});
    }
  }, [showWebhooks]);

  // Derived values
  const lev = data?.leverage ?? { leverageRate: 94, exactCount: 52, fuzzyCount: 42, newCount: 6, totalSegments: 100, trend: 8, target: 94 };
  const comp = data?.compliance ?? { complianceRate: 99.8, totalChecks: 60, violationCount: 1, glossaryTerms: 17, mandatoryTerms: 15, target: 99.8, recentViolations: [] };
  const cost = data?.cost ?? { manualCost: 40000, actualCost: 4000, savings: 36000, reductionPercent: 90, perProject: [], costModel: { manual: 400, llm: 75, fuzzy: 15, exact: 0 } };
  const tmGrowth = data?.tmGrowth?.data ?? [
    { day: 'Mon', records: 245 }, { day: 'Tue', records: 387 }, { day: 'Wed', records: 521 },
    { day: 'Thu', records: 698 }, { day: 'Fri', records: 892 }, { day: 'Sat', records: 1047 }, { day: 'Sun', records: 1247 },
  ];
  const vel = data?.velocity ?? { today: 155, thisWeek: 892, allTime: 1247, trend: '+155 today' };
  const review = data?.reviewTime ?? { avgSeconds: 18, improvement: '3s faster' };
  const langCov = data?.languageCoverage ?? { languages: [], activeLanguages: 1, totalLanguages: 22, coveragePercent: 5 };
  const approvals = data?.recentApprovals ?? [];
  const projects = data?.projects ?? [];

  // Segment donut data
  const segmentData = [
    { name: 'Exact', value: lev.exactCount, color: '#10B981' },
    { name: 'Fuzzy', value: lev.fuzzyCount, color: '#3B82F6' },
    { name: 'New', value: lev.newCount, color: '#64748B' },
  ];
  const totalPie = lev.exactCount + lev.fuzzyCount + lev.newCount;
  const segmentPercent = segmentData.map((d) => ({
    ...d,
    pct: totalPie > 0 ? Math.round((d.value / totalPie) * 100) : 0,
  }));

  // Cost savings per-project chart data
  const costChartData = cost.perProject.length > 0
    ? cost.perProject.map((p: any) => ({ project: p.projectName?.substring(0, 14) || 'Project', savings: p.savings }))
    : [
      { project: 'Policy Docs', savings: 320000 },
      { project: 'Legal Terms', savings: 280000 },
      { project: 'Marketing', savings: 195000 },
      { project: 'User Manuals', savings: 160000 },
      { project: 'Support KB', savings: 125000 },
    ];

  // Gauge geometry
  const circumference = 2 * Math.PI * 58;
  const scoreOffset = circumference - (circumference * lev.leverageRate) / 100;
  const leverageColor = getLeverageColor(lev.leverageRate);

  // ROI Calculator
  const roiSavings = Math.round(roiVolume * (cost.reductionPercent / 100) * (cost.costModel?.manual ?? 400));

  return (
    <div className="w-screen h-screen flex overflow-hidden">
      {/* ═══ Left Sidebar ═══ */}
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
          <Link to="/analytics" className="flex items-center gap-3 px-6 py-3 text-label-caps text-white bg-white/8 border-l-[3px] border-brand-emerald">ANALYTICS</Link>
          <Link to="/training" className="flex items-center gap-3 px-6 py-3 text-label-caps text-white/60 hover:text-white hover:bg-white/5">TRAINING</Link>
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

      {/* ═══ Main Content ═══ */}
      <div className="flex-1 flex flex-col bg-ui-surface overflow-y-auto">
        <div className="p-6 max-w-[1600px]">
          {/* Header */}
          <div className="mb-8 flex items-center justify-between">
            <div>
              <h1 className="text-display-h3 text-brand-indigo mb-1">Analytics Dashboard</h1>
              <p className="text-body-md text-ui-slate">Real-time insights into translation memory, compliance, and ROI</p>
            </div>
            <div className="flex items-center gap-3">
              <PulseDot />
              <span className="text-[11px] text-ui-slate font-medium">LIVE</span>
              {lastUpdated && (
                <span className="text-[10px] text-ui-slate/60 ml-2">
                  Updated {new Date(lastUpdated).toLocaleTimeString()}
                </span>
              )}
            </div>
          </div>

          {/* ═══ Row 1: Hero KPI Cards ═══ */}
          <div className="grid grid-cols-4 gap-6 mb-8">
            {/* 1. TM Leverage Gauge */}
            <motion.div
              className="rounded-[24px] bg-ui-white border border-ui-border p-6 flex flex-col items-center justify-center text-center"
              style={{ boxShadow: 'var(--shadow-sm)' }}
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
            >
              <div className="relative w-[110px] h-[110px] mb-3">
                <svg viewBox="0 0 128 128" className="w-full h-full -rotate-90">
                  <circle cx="64" cy="64" r="58" fill="none" stroke="#E2E8F0" strokeWidth="6" />
                  <motion.circle cx="64" cy="64" r="58" fill="none" stroke={leverageColor} strokeWidth="6"
                    strokeLinecap="round" strokeDasharray={circumference}
                    initial={{ strokeDashoffset: circumference }}
                    animate={{ strokeDashoffset: scoreOffset }}
                    transition={{ duration: 2, ease: [0.22, 1, 0.36, 1], delay: 0.5 }}
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <AnimatedCounter target={lev.leverageRate} suffix="%" className="text-[28px] font-black text-brand-indigo" duration={2} decimals={1} />
                </div>
              </div>
              <div className="text-label-caps text-ui-slate">TM LEVERAGE</div>
              <div className="text-body-sm mt-1 flex items-center gap-1" style={{ color: leverageColor }}>
                <span>{lev.trend >= 0 ? '↑' : '↓'}</span> {lev.trend >= 0 ? '+' : ''}{lev.trend}% this period
              </div>
            </motion.div>

            {/* 2. Cost Savings */}
            <motion.div
              className="rounded-[24px] bg-ui-white border border-ui-border p-6 flex flex-col items-center justify-center text-center"
              style={{ boxShadow: 'var(--shadow-sm)' }}
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
            >
              <div className="mb-1">
                <span className="text-[18px] text-ui-slate line-through">₹{(cost.manualCost).toLocaleString()}</span>
                <span className="text-body-sm text-ui-slate"> → </span>
              </div>
              <AnimatedCounter target={cost.actualCost} prefix="₹" className="text-display-h2 text-brand-indigo" duration={1.8} />
              <div className="text-label-caps text-ui-slate mt-2">ACTUAL COST</div>
              <div className="text-body-sm text-brand-emerald mt-1">{cost.reductionPercent}% reduction</div>
            </motion.div>

            {/* 3. Segments Processed */}
            <motion.div
              className="rounded-[24px] bg-ui-white border border-ui-border p-6 flex flex-col items-center justify-center text-center"
              style={{ boxShadow: 'var(--shadow-sm)' }}
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
            >
              <AnimatedCounter target={vel.allTime} className="text-display-h2 text-brand-indigo" duration={1.5} />
              <div className="text-label-caps text-ui-slate mt-2">SEGMENTS</div>
              <div className="text-body-sm text-brand-emerald mt-1 flex items-center gap-1">
                <span>↑</span> {vel.trend}
              </div>
            </motion.div>

            {/* 4. Glossary Compliance */}
            <motion.div
              className="rounded-[24px] bg-ui-white border border-ui-border p-6 flex flex-col items-center justify-center text-center"
              style={{ boxShadow: 'var(--shadow-sm)' }}
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
            >
              <AnimatedCounter target={comp.complianceRate} suffix="%" className="text-display-h2 text-brand-indigo" duration={1.8} decimals={1} />
              <div className="text-label-caps text-ui-slate mt-2">GLOSSARY</div>
              <div className="text-body-sm mt-1 flex items-center gap-1" style={{ color: getComplianceColor(comp.complianceRate) }}>
                {comp.complianceRate >= 99 ? '✓ Compliant' : `⚠ ${comp.violationCount} violations`}
              </div>
            </motion.div>
          </div>

          {/* ═══ Row 2: TM Growth + Segment Classification ═══ */}
          <div className="grid grid-cols-[60%_40%] gap-6 mb-8">
            {/* TM Growth Area Chart */}
            <motion.div
              className="rounded-[24px] bg-ui-white border border-ui-border p-6"
              style={{ boxShadow: 'var(--shadow-sm)' }}
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-body-sm font-bold text-brand-indigo">TM GROWTH OVER TIME</h3>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-brand-emerald/10 text-brand-emerald font-medium">
                    {data?.tmGrowth?.milestone ?? '1K+'} records
                  </span>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={tmGrowth}>
                  <defs>
                    <linearGradient id="colorRecords" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10B981" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="day" stroke="#94A3B8" style={{ fontSize: '12px' }} />
                  <YAxis stroke="#94A3B8" style={{ fontSize: '12px' }} />
                  <Tooltip contentStyle={ChartTooltipStyle} />
                  <Area type="monotone" dataKey="records" stroke="#10B981" strokeWidth={2.5} fillOpacity={1} fill="url(#colorRecords)"
                    animationBegin={500} animationDuration={1500} />
                </AreaChart>
              </ResponsiveContainer>
            </motion.div>

            {/* Segment Classification Donut */}
            <motion.div
              className="rounded-[24px] bg-ui-white border border-ui-border p-6"
              style={{ boxShadow: 'var(--shadow-sm)' }}
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}
            >
              <h3 className="text-body-sm font-bold text-brand-indigo mb-6">SEGMENT CLASSIFICATION</h3>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={segmentPercent} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={4} dataKey="pct"
                    animationBegin={600} animationDuration={1200}>
                    {segmentPercent.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={ChartTooltipStyle} formatter={(v: any) => `${v}%`} />
                </PieChart>
              </ResponsiveContainer>
              <div className="text-center -mt-32 mb-20">
                <AnimatedCounter target={lev.leverageRate} suffix="%" className="text-display-h2 text-brand-indigo" decimals={1} />
              </div>
              <div className="flex flex-col gap-2.5 mt-4">
                {segmentPercent.map((item, i) => (
                  <div key={i} className="flex items-center justify-between text-body-sm">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
                      <span className="text-ui-slate">{item.name}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-ui-slate/70 text-[11px]">{item.value}</span>
                      <span className="text-brand-indigo font-semibold">{item.pct}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          </div>

          {/* ═══ Row 3: Projects + Cost by Project ═══ */}
          <div className="grid grid-cols-[60%_40%] gap-6 mb-8">
            {/* Projects Table */}
            <motion.div
              className="rounded-[24px] bg-ui-white border border-ui-border p-6"
              style={{ boxShadow: 'var(--shadow-sm)' }}
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 }}
            >
              <h3 className="text-body-sm font-bold text-brand-indigo mb-6">ACTIVE PROJECTS</h3>
              <div className="flex flex-col">
                <div className="grid grid-cols-[2fr_1fr_1fr_auto] gap-4 pb-3 border-b border-ui-border text-label-caps text-ui-slate">
                  <div>PROJECT</div><div>LANGUAGES</div><div>PROGRESS</div><div>STATUS</div>
                </div>
                {(projects.length > 0 ? projects : [
                  { name: 'Policy Document 2024', sourceLangName: 'English', targetLangName: 'Hindi', progress: 94, status: 'active' },
                  { name: 'Legal Terms v3', sourceLangName: 'English', targetLangName: 'Tamil', progress: 78, status: 'active' },
                  { name: 'Marketing Copy Q4', sourceLangName: 'English', targetLangName: 'Marathi', progress: 100, status: 'completed' },
                  { name: 'User Manual Rev.B', sourceLangName: 'English', targetLangName: 'Telugu', progress: 45, status: 'active' },
                  { name: 'Support KB Articles', sourceLangName: 'English', targetLangName: 'Bengali', progress: 62, status: 'active' },
                ]).map((proj: any, i: number) => (
                  <motion.div
                    key={i}
                    className="grid grid-cols-[2fr_1fr_1fr_auto] gap-4 py-4 border-b border-ui-border last:border-0 text-body-sm items-center"
                    initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.8 + i * 0.06 }}
                  >
                    <div className="text-brand-indigo font-medium">{proj.name}</div>
                    <div className="text-ui-slate">{proj.sourceLangName ?? 'English'} → {proj.targetLangName ?? 'Hindi'}</div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 rounded-full bg-ui-surface overflow-hidden">
                        <motion.div className="h-full rounded-full bg-brand-emerald"
                          initial={{ width: '0%' }} animate={{ width: `${proj.progress}%` }}
                          transition={{ duration: 1.2, delay: 1 + i * 0.08, ease: [0.22, 1, 0.36, 1] }} />
                      </div>
                      <span className="text-[11px] text-ui-slate w-8 text-right">{proj.progress}%</span>
                    </div>
                    <Badge type={proj.status === 'completed' ? 'success' : 'fuzzy'} size="sm"
                      text={proj.status === 'completed' ? '✓ Done' : 'Active'} />
                  </motion.div>
                ))}
              </div>
            </motion.div>

            {/* Cost Savings Bar Chart */}
            <motion.div
              className="rounded-[24px] bg-ui-white border border-ui-border p-6"
              style={{ boxShadow: 'var(--shadow-sm)' }}
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.8 }}
            >
              <h3 className="text-body-sm font-bold text-brand-indigo mb-6">COST SAVINGS BY PROJECT</h3>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={costChartData} layout="vertical">
                  <XAxis type="number" stroke="#94A3B8" style={{ fontSize: '11px' }} />
                  <YAxis type="category" dataKey="project" stroke="#94A3B8" style={{ fontSize: '11px' }} width={80} />
                  <Tooltip contentStyle={ChartTooltipStyle}
                    formatter={(value: any) => `₹${(value / 1000).toFixed(0)}K`} />
                  <Bar dataKey="savings" fill="#1E1B4B" radius={[0, 8, 8, 0]}
                    animationBegin={800} animationDuration={1200} />
                </BarChart>
              </ResponsiveContainer>
            </motion.div>
          </div>

          {/* ═══ Row 4: Recent Approvals + Metrics Stack ═══ */}
          <div className="grid grid-cols-[60%_40%] gap-6 mb-8">
            {/* Recent Approvals Table */}
            <motion.div
              className="rounded-[24px] bg-ui-white border border-ui-border p-6"
              style={{ boxShadow: 'var(--shadow-sm)' }}
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.9 }}
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-body-sm font-bold text-brand-indigo">RECENT APPROVALS</h3>
                <div className="flex items-center gap-2">
                  <PulseDot />
                  <span className="text-[10px] text-ui-slate">Live feed</span>
                </div>
              </div>
              <div className="flex flex-col">
                <div className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-4 pb-3 border-b border-ui-border text-label-caps text-ui-slate">
                  <div>SEGMENT</div><div>LANGUAGE</div><div>REVIEWER</div><div>TIME</div><div>STATUS</div>
                </div>
                {(approvals.length > 0 ? approvals.slice(0, 6) : [
                  { segment: 'Welcome to our platform...', language: 'Hindi', reviewer: 'Priya S.', timeAgo: '2m ago' },
                  { segment: 'Your transaction is complete...', language: 'Tamil', reviewer: 'Raj K.', timeAgo: '5m ago' },
                  { segment: 'Please verify your account...', language: 'Telugu', reviewer: 'Amit P.', timeAgo: '8m ago' },
                  { segment: 'Contact support team...', language: 'Gujarati', reviewer: 'Priya S.', timeAgo: '12m ago' },
                  { segment: 'Update your preferences...', language: 'Marathi', reviewer: 'Neha M.', timeAgo: '15m ago' },
                ]).map((row: any, i: number) => (
                  <motion.div
                    key={i}
                    className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-4 py-3.5 border-b border-ui-border last:border-0 text-body-sm items-center"
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1 + i * 0.06 }}
                  >
                    <div className="text-ui-slate truncate">{row.segment}</div>
                    <div className="text-brand-indigo">{row.language}</div>
                    <div className="text-ui-slate">{row.reviewer}</div>
                    <div className="text-ui-slate/60 text-[12px]">{row.timeAgo}</div>
                    <Badge type="success" size="sm" text="✓" />
                  </motion.div>
                ))}
              </div>
            </motion.div>

            {/* Metrics Stack */}
            <motion.div className="space-y-5"
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1 }}
            >
              {/* Avg Review Time */}
              <div className="rounded-[24px] bg-ui-white border border-ui-border p-5 flex items-center justify-between"
                style={{ boxShadow: 'var(--shadow-sm)' }}>
                <div>
                  <div className="text-label-caps text-ui-slate mb-1">AVG REVIEW TIME</div>
                  <div className="text-display-h4 text-brand-indigo">{review.avgSeconds}s</div>
                </div>
                <span className="text-body-sm text-brand-emerald">↓ {review.improvement}</span>
              </div>

              {/* TM Records Total */}
              <div className="rounded-[24px] bg-ui-white border border-ui-border p-5 flex items-center justify-between"
                style={{ boxShadow: 'var(--shadow-sm)' }}>
                <div>
                  <div className="text-label-caps text-ui-slate mb-1">TM RECORDS</div>
                  <div className="text-display-h4 text-brand-indigo">{(data?.tmGrowth?.totalRecords ?? 1247).toLocaleString()}</div>
                </div>
                <span className="text-body-sm text-brand-emerald">↑ {vel.trend}</span>
              </div>

              {/* Glossary Terms */}
              <div className="rounded-[24px] bg-ui-white border border-ui-border p-5 flex items-center justify-between"
                style={{ boxShadow: 'var(--shadow-sm)' }}>
                <div>
                  <div className="text-label-caps text-ui-slate mb-1">GLOSSARY TERMS</div>
                  <div className="text-display-h4 text-brand-indigo">{comp.glossaryTerms}</div>
                </div>
                <span className="text-body-sm text-brand-indigo">{comp.mandatoryTerms} mandatory</span>
              </div>

              {/* Language Coverage */}
              <div className="rounded-[24px] bg-ui-white border border-ui-border p-5 flex items-center justify-between"
                style={{ boxShadow: 'var(--shadow-sm)' }}>
                <div>
                  <div className="text-label-caps text-ui-slate mb-1">LANGUAGES</div>
                  <div className="text-display-h4 text-brand-indigo">{langCov.activeLanguages}/{langCov.totalLanguages}</div>
                </div>
                <span className="text-body-sm text-brand-emerald">{langCov.coveragePercent}% coverage</span>
              </div>
            </motion.div>
          </div>

          {/* ═══ Row 5: Language Coverage Map + ROI Calculator ═══ */}
          <div className="grid grid-cols-[60%_40%] gap-6 mb-8">
            {/* Language Coverage Grid */}
            <motion.div
              className="rounded-[24px] bg-ui-white border border-ui-border p-6"
              style={{ boxShadow: 'var(--shadow-sm)' }}
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.1 }}
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-body-sm font-bold text-brand-indigo">LANGUAGE COVERAGE MAP</h3>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-brand-emerald/10 text-brand-emerald font-medium">
                  {langCov.activeLanguages} of 22 active
                </span>
              </div>
              <div className="grid grid-cols-5 gap-2.5">
                {(langCov.languages.length > 0 ? langCov.languages : [
                  { code: 'hi_IN', name: 'Hindi', tmRecords: 9, active: true, intensity: 1 },
                  { code: 'ta_IN', name: 'Tamil', tmRecords: 0, active: false, intensity: 0 },
                  { code: 'te_IN', name: 'Telugu', tmRecords: 0, active: false, intensity: 0 },
                  { code: 'kn_IN', name: 'Kannada', tmRecords: 0, active: false, intensity: 0 },
                  { code: 'ml_IN', name: 'Malayalam', tmRecords: 0, active: false, intensity: 0 },
                  { code: 'bn_IN', name: 'Bengali', tmRecords: 0, active: false, intensity: 0 },
                  { code: 'mr_IN', name: 'Marathi', tmRecords: 0, active: false, intensity: 0 },
                  { code: 'gu_IN', name: 'Gujarati', tmRecords: 0, active: false, intensity: 0 },
                  { code: 'pa_IN', name: 'Punjabi', tmRecords: 0, active: false, intensity: 0 },
                  { code: 'or_IN', name: 'Odia', tmRecords: 0, active: false, intensity: 0 },
                  { code: 'as_IN', name: 'Assamese', tmRecords: 0, active: false, intensity: 0 },
                  { code: 'mai_IN', name: 'Maithili', tmRecords: 0, active: false, intensity: 0 },
                  { code: 'sd_IN', name: 'Sindhi', tmRecords: 0, active: false, intensity: 0 },
                  { code: 'ks_IN', name: 'Kashmiri', tmRecords: 0, active: false, intensity: 0 },
                  { code: 'ne_NP', name: 'Nepali', tmRecords: 0, active: false, intensity: 0 },
                  { code: 'ur_PK', name: 'Urdu', tmRecords: 0, active: false, intensity: 0 },
                  { code: 'si_LK', name: 'Sinhala', tmRecords: 0, active: false, intensity: 0 },
                  { code: 'mni_IN', name: 'Manipuri', tmRecords: 0, active: false, intensity: 0 },
                  { code: 'brx_IN', name: 'Bodo', tmRecords: 0, active: false, intensity: 0 },
                  { code: 'doi_IN', name: 'Dogri', tmRecords: 0, active: false, intensity: 0 },
                  { code: 'sat_IN', name: 'Santali', tmRecords: 0, active: false, intensity: 0 },
                  { code: 'kok_IN', name: 'Konkani', tmRecords: 0, active: false, intensity: 0 },
                ]).map((lang: any) => (
                  <LangTile key={lang.code} lang={lang} />
                ))}
              </div>
            </motion.div>

            {/* ROI Calculator */}
            <motion.div
              className="rounded-[24px] bg-brand-indigo border border-white/10 p-6 text-white"
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.2 }}
            >
              <h3 className="text-body-sm font-bold text-white/90 mb-6">ROI CALCULATOR</h3>
              <p className="text-[13px] text-white/60 mb-5">Enter your monthly translation volume to see projected savings with Verb AI.</p>
              <div className="mb-6">
                <label className="text-[11px] text-white/50 uppercase tracking-wider block mb-2">SEGMENTS PER MONTH</label>
                <input
                  type="range" min={100} max={10000} step={100}
                  value={roiVolume}
                  onChange={(e) => setRoiVolume(parseInt(e.target.value))}
                  className="w-full h-2 rounded-full appearance-none cursor-pointer"
                  style={{ background: `linear-gradient(to right, #10B981 ${(roiVolume / 10000) * 100}%, rgba(255,255,255,0.2) 0%)` }}
                />
                <div className="flex justify-between mt-2 text-[12px] text-white/50">
                  <span>100</span>
                  <span className="text-brand-emerald font-bold text-[16px]">{roiVolume.toLocaleString()}</span>
                  <span>10,000</span>
                </div>
              </div>
              <div className="rounded-2xl bg-white/5 border border-white/10 p-5 space-y-4">
                <div className="flex justify-between">
                  <span className="text-white/60 text-[13px]">Manual cost</span>
                  <span className="text-white/80 font-medium line-through">₹{(roiVolume * (cost.costModel?.manual ?? 400)).toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/60 text-[13px]">With Verb AI</span>
                  <span className="text-brand-emerald font-bold text-[18px]">₹{(roiVolume * (cost.costModel?.manual ?? 400) - roiSavings).toLocaleString()}</span>
                </div>
                <div className="h-px bg-white/10" />
                <div className="flex justify-between">
                  <span className="text-white/60 text-[13px]">Monthly savings</span>
                  <span className="text-brand-emerald font-bold text-[20px]">₹{roiSavings.toLocaleString()}</span>
                </div>
                <div className="text-center mt-2">
                  <span className="text-[11px] px-3 py-1 rounded-full bg-brand-emerald/20 text-brand-emerald font-medium">
                    {cost.reductionPercent}% cost reduction
                  </span>
                </div>
              </div>
            </motion.div>
          </div>

          {/* ═══ Row 6: Automated Quality Checks (FLORES-200) ═══ */}
          <div className="mb-8">
            <motion.div
              className="rounded-[24px] bg-ui-white border border-ui-border p-6"
              style={{ boxShadow: 'var(--shadow-sm)' }}
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.25 }}
            >
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-body-sm font-bold text-brand-indigo">AUTOMATED QUALITY CHECKS (FLORES-200)</h3>
                  <p className="text-[13px] text-ui-slate mt-1">Benchmarking LLM translations against pristine FLORES-200 "Ground Truth" datasets.</p>
                </div>
                <button 
                  onClick={runQualityCheck} 
                  disabled={isCheckingQuality}
                  className="px-4 py-2 bg-brand-indigo text-white text-[13px] font-bold rounded-lg hover:bg-brand-indigo/90 disabled:opacity-50 transition-colors"
                >
                  {isCheckingQuality ? 'Running Benchmark...' : 'Run Benchmark'}
                </button>
              </div>

              {qualityCheck && (
                <div className="mt-4">
                  <div className="flex items-center gap-4 mb-6">
                    <div className="px-4 py-3 rounded-xl bg-brand-emerald/10 border border-brand-emerald/20 flex flex-col items-center">
                      <span className="text-display-h4 text-brand-emerald">{qualityCheck.averageBleu}</span>
                      <span className="text-[10px] text-brand-emerald font-bold tracking-wider uppercase">Avg Proxy BLEU</span>
                    </div>
                  </div>
                  
                  <div className="space-y-4">
                    {qualityCheck.tests.map((test, i) => (
                      <div key={i} className="p-4 rounded-xl border border-ui-border bg-ui-surface grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                          <div className="text-[11px] font-bold text-ui-slate uppercase tracking-wider mb-2">Source (English)</div>
                          <div className="text-[13px] text-brand-indigo">{test.source}</div>
                        </div>
                        <div>
                          <div className="text-[11px] font-bold text-brand-emerald uppercase tracking-wider mb-2 flex items-center justify-between">
                            <span>LLM Output (Hindi)</span>
                            <span className="text-[10px] bg-brand-emerald/20 text-brand-emerald px-2 py-0.5 rounded-full border border-brand-emerald/30">Score: {test.score}</span>
                          </div>
                          <div className="text-[13px] text-brand-indigo font-medium">{test.modelOutput}</div>
                          <div className="mt-3 pt-3 border-t border-brand-emerald/20">
                            <div className="text-[10px] text-ui-slate uppercase tracking-wider">Ground Truth (FLORES-200)</div>
                            <div className="text-[12px] text-ui-slate/80 mt-1">{test.groundTruth}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          </div>

          {/* ═══ Row 7: Glossary Violations (if any) ═══ */}
          {comp.recentViolations && comp.recentViolations.length > 0 && (
            <motion.div
              className="rounded-[24px] bg-ui-white border border-status-error/20 p-6 mb-8"
              style={{ boxShadow: 'var(--shadow-sm)' }}
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.3 }}
            >
              <h3 className="text-body-sm font-bold text-status-error mb-4">GLOSSARY VIOLATIONS ({comp.violationCount})</h3>
              <div className="space-y-2">
                {comp.recentViolations.map((v: any, i: number) => (
                  <div key={i} className="flex items-center gap-4 text-body-sm py-2 border-b border-ui-border last:border-0">
                    <span className="text-status-error">⚠</span>
                    <span className="text-ui-slate">Segment {v.segmentId}</span>
                    <span className="text-ui-slate/60">Missing: {(v.violations || []).join(', ')}</span>
                    <span className="text-ui-slate/40 text-[11px] ml-auto">{v.checkedAt}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
          {/* ═══ Language Pairs Panel (Improvement 3) ═══ */}
          <motion.div
            className="rounded-[24px] bg-ui-white border border-ui-border p-6 mb-8"
            style={{ boxShadow: 'var(--shadow-sm)' }}
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.4 }}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-body-sm font-bold text-brand-indigo">LANGUAGE PAIR ANALYTICS</h3>
              <button
                onClick={() => setShowLangPairs(!showLangPairs)}
                className="text-body-sm text-brand-emerald hover:underline"
              >
                {showLangPairs ? 'Hide' : 'Show Details'}
              </button>
            </div>
            {showLangPairs && langPairs.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-body-sm">
                  <thead>
                    <tr className="border-b border-ui-border">
                      <th className="text-left py-2 px-3 text-label-caps text-ui-slate">Pair</th>
                      <th className="text-right py-2 px-3 text-label-caps text-ui-slate">Segments</th>
                      <th className="text-right py-2 px-3 text-label-caps text-ui-slate">Leverage</th>
                      <th className="text-right py-2 px-3 text-label-caps text-ui-slate">TM Records</th>
                      <th className="text-right py-2 px-3 text-label-caps text-ui-slate">Glossary</th>
                      <th className="text-right py-2 px-3 text-label-caps text-ui-slate">Avg Cost</th>
                      <th className="text-right py-2 px-3 text-label-caps text-ui-slate">Avg Latency</th>
                    </tr>
                  </thead>
                  <tbody>
                    {langPairs.map((pair: any, i: number) => (
                      <tr key={i} className="border-b border-ui-border/50 hover:bg-ui-surface/50">
                        <td className="py-2 px-3 font-medium text-brand-indigo">
                          {pair.sourceName} → {pair.targetName}
                        </td>
                        <td className="text-right py-2 px-3">{pair.totalSegments}</td>
                        <td className="text-right py-2 px-3">
                          <span className={`font-semibold ${pair.leverageRate >= 90 ? 'text-brand-emerald' : pair.leverageRate >= 70 ? 'text-status-warning' : 'text-status-error'}`}>
                            {pair.leverageRate}%
                          </span>
                        </td>
                        <td className="text-right py-2 px-3">{pair.tmRecords}</td>
                        <td className="text-right py-2 px-3">{pair.glossaryTerms}</td>
                        <td className="text-right py-2 px-3">₹{pair.avgCost}</td>
                        <td className="text-right py-2 px-3">{pair.avgLatency}ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {showLangPairs && langPairs.length === 0 && (
              <p className="text-body-sm text-ui-slate/60 text-center py-4">No language pair data yet. Translate some segments first.</p>
            )}
          </motion.div>

          {/* ═══ Webhook Jobs Panel (Improvement 1) ═══ */}
          <motion.div
            className="rounded-[24px] bg-ui-white border border-ui-border p-6 mb-8"
            style={{ boxShadow: 'var(--shadow-sm)' }}
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.5 }}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-body-sm font-bold text-brand-indigo">WEBHOOK CONNECTOR</h3>
              <button
                onClick={() => setShowWebhooks(!showWebhooks)}
                className="text-body-sm text-brand-emerald hover:underline"
              >
                {showWebhooks ? 'Hide' : 'Show Jobs & Test'}
              </button>
            </div>
            {showWebhooks && (
              <div className="space-y-4">
                {/* Summary */}
                {webhookData?.summary && (
                  <div className="grid grid-cols-4 gap-3">
                    <div className="rounded-lg border border-ui-border p-3 text-center">
                      <div className="text-[20px] font-bold text-brand-indigo">{webhookData.summary.total}</div>
                      <div className="text-[10px] text-ui-slate uppercase">Total Jobs</div>
                    </div>
                    <div className="rounded-lg border border-ui-border p-3 text-center">
                      <div className="text-[20px] font-bold text-brand-emerald">{webhookData.summary.completed}</div>
                      <div className="text-[10px] text-ui-slate uppercase">Completed</div>
                    </div>
                    <div className="rounded-lg border border-ui-border p-3 text-center">
                      <div className="text-[20px] font-bold text-status-error">{webhookData.summary.failed}</div>
                      <div className="text-[10px] text-ui-slate uppercase">Failed</div>
                    </div>
                    <div className="rounded-lg border border-ui-border p-3 text-center">
                      <div className="text-[20px] font-bold text-status-success">{webhookData.summary.successRate}%</div>
                      <div className="text-[10px] text-ui-slate uppercase">Success Rate</div>
                    </div>
                  </div>
                )}

                {/* Test Webhook */}
                <div className="rounded-lg border border-ui-border p-4">
                  <h4 className="text-body-sm font-semibold text-brand-indigo mb-2">Test Webhook Ingestion</h4>
                  <textarea
                    value={webhookTestPayload}
                    onChange={(e) => setWebhookTestPayload(e.target.value)}
                    className="w-full h-32 text-code-sm font-mono p-3 rounded-lg border border-ui-border bg-ui-surface resize-none"
                  />
                  <button
                    onClick={async () => {
                      try {
                        const payload = JSON.parse(webhookTestPayload);
                        const res = await fetch('http://localhost:3001/api/webhook/ingest', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify(payload),
                        });
                        const data = await res.json();
                        alert(`Job created: ${data.jobId}\nSegments: ${data.segmentCount}`);
                        // Refresh webhook data
                        setShowWebhooks(false);
                        setTimeout(() => setShowWebhooks(true), 100);
                      } catch (err: any) {
                        alert('Error: ' + err.message);
                      }
                    }}
                    className="mt-2 px-4 py-2 rounded-lg bg-brand-emerald text-white text-body-sm font-medium hover:bg-brand-emerald/90 transition-colors"
                  >
                    Send Test Webhook
                  </button>
                </div>

                {/* Job List */}
                {webhookData?.jobs && webhookData.jobs.length > 0 && (
                  <div className="max-h-[300px] overflow-y-auto">
                    <table className="w-full text-body-sm">
                      <thead>
                        <tr className="border-b border-ui-border sticky top-0 bg-ui-white">
                          <th className="text-left py-2 px-3 text-label-caps text-ui-slate">Job ID</th>
                          <th className="text-left py-2 px-3 text-label-caps text-ui-slate">Content</th>
                          <th className="text-left py-2 px-3 text-label-caps text-ui-slate">Status</th>
                          <th className="text-left py-2 px-3 text-label-caps text-ui-slate">Callback</th>
                          <th className="text-left py-2 px-3 text-label-caps text-ui-slate">Created</th>
                        </tr>
                      </thead>
                      <tbody>
                        {webhookData.jobs.map((job: any) => (
                          <tr key={job.id} className="border-b border-ui-border/50 hover:bg-ui-surface/50">
                            <td className="py-2 px-3 font-mono text-[11px]">{job.id.slice(0, 8)}...</td>
                            <td className="py-2 px-3">{job.content_id || '–'}</td>
                            <td className="py-2 px-3">
                              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                                job.status === 'completed' ? 'bg-green-100 text-green-700'
                                : job.status === 'processing' ? 'bg-blue-100 text-blue-700'
                                : job.status === 'failed' ? 'bg-red-100 text-red-700'
                                : 'bg-yellow-100 text-yellow-700'
                              }`}>
                                {job.status}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-[11px]">{job.callback_status || '–'}</td>
                            <td className="py-2 px-3 text-[11px] text-ui-slate/60">
                              {job.created_at ? new Date(job.created_at).toLocaleString() : '–'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </motion.div>
        </div>
      </div>
    </div>
  );
}
