import { useNavigate } from 'react-router';
import { Navigation } from '../components/Navigation';
import { SectionLabel } from '../components/SectionLabel';
import { Button } from '../components/Button';
import { SegmentRow } from '../components/SegmentRow';
import { FeatureCard } from '../components/FeatureCard';
import { CodeBlock } from '../components/CodeBlock';
import { PricingCard } from '../components/PricingCard';
import { ResearchCard } from '../components/ResearchCard';
import { LanguagePillCard } from '../components/LanguagePillCard';
import RippleGrid from '../../components/RippleGrid';
import { ChevronDown } from 'lucide-react';
import { motion } from 'motion/react';

/* ═══════════════════════════════════
   ANIMATION PRESETS (dontboardme.com style)
   ═══════════════════════════════════ */
const fadeUp = {
  initial: { opacity: 0, y: 40 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.2 },
  transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] },
};

const fadeUpDelay = (delay: number) => ({
  ...fadeUp,
  transition: { ...fadeUp.transition, delay },
});

const staggerContainer = {
  initial: {},
  whileInView: { transition: { staggerChildren: 0.08 } },
  viewport: { once: true, amount: 0.2 },
};

const staggerChild = {
  initial: { opacity: 0, y: 30 },
  whileInView: { opacity: 1, y: 0 },
  transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] },
};

/* ═══════════════════════════════════
   MARQUEE ITEMS
   ═══════════════════════════════════ */
const marqueeItems = [
  '94% TM Leverage Rate',
  '90% Cost Reduction',
  '22 Indian Languages',
  '< 3ms Vector Search',
  'Glossary Compliance 99.8%',
  'Zero External Dependencies',
  '₹36,00,000 / yr Saved',
  'Atomic Continuous Learning',
];

const MarqueeContent = () => (
  <>
    {marqueeItems.map((item, i) => (
      <span key={i} className="flex items-center gap-8">
        <span className="text-body-sm font-medium text-white whitespace-nowrap">{item}</span>
        <span className="text-brand-emerald text-lg">◆</span>
      </span>
    ))}
  </>
);

/* ═══════════════════════════════════
   PROCESS STEPS DATA
   ═══════════════════════════════════ */
const processSteps = [
  {
    num: '01',
    title: 'Document Ingestion',
    desc: "mammoth.js and pdf-parse extract paragraphs from DOCX and PDF files. A regex boundary detector produces clean segments — never splitting on 'Dr.' or 'U.S.'",
    code: `const segments = document.split(/(?<=[.!?])\\s+(?=[A-Z])/)
  .filter(s => s.length > 5)
  .map((text, id) => ({
    id,
    sourceText: text,
    status: "pending"
  }));`,
  },
  {
    num: '02',
    title: 'Source Quality Validation',
    desc: "Before translation, 5 parallel audits run: spell check, terminology clustering, date normalization, punctuation, and segment length flags. Errors caught here don't multiply across 22 languages.",
    code: `const validation = await fetch('/api/validate', {
  body: JSON.stringify({ segments })
});

// Response: { qualityScore: 87, errors: [...] }`,
  },
  {
    num: '03',
    title: 'Semantic TM Lookup',
    desc: 'Three-tier search: exact string match (< 1ms), then vector cosine similarity across all stored 768-dim embeddings (< 3ms). Score ≥ 0.95 = reuse directly. No LLM needed.',
    code: `function cosineSimilarity(a, b) {
  const dot = a.reduce((s, v, i) => s + v * b[i], 0);
  return dot / (norm(a) * norm(b));
}

// Match threshold: 0.95 = instant reuse`,
  },
  {
    num: '04',
    title: 'Constrained LLM Translation',
    desc: 'Only new segments reach the LLM. Gemini 1.5 Flash handles European. AI4Bharat IndicTrans2 handles 22 Indian languages. Glossary terms are injected as hard constraints.',
    code: `const prompt = \`Translate to Hindi. 
Mandatory terms:
- "account" → "खाता"
- "balance" → "शेष राशि"

Source: \${sourceText}\`;

const translation = await gemini.translate(prompt);`,
  },
  {
    num: '05',
    title: 'Glossary Regex Verification',
    desc: 'A deterministic post-check verifies every mandated glossary term exists in the LLM output using word-boundary regex. Violations are flagged before the reviewer ever sees them.',
    code: `const violations = glossary.filter(term => {
  const regex = new RegExp(\`\\\\b\${term.target}\\\\b\`);
  return !regex.test(translation);
});

if (violations.length > 0) status = "violation";`,
  },
  {
    num: '06',
    title: 'Human Side-by-Side Review',
    desc: 'An AgGrid editor shows source and target side by side. The linguist reads, edits, and approves. Raw LLM output never enters the TM — only human-approved translations do.',
    code: `interface Segment {
  id: number;
  sourceText: string;
  targetText: string;
  status: "pending" | "approved" | "violation";
  tmMatch?: number;
}`,
  },
  {
    num: '07',
    title: 'Atomic TM Write',
    desc: 'On approval, an atomic SQLite INSERT stores the translation pair alongside its 768-dim embedding vector. The next identical or paraphrased segment resolves instantly — forever.',
    code: `INSERT INTO tm_records 
  (source, target, embedding, language, approved_by)
VALUES 
  (?, ?, ?, ?, ?);

-- Next lookup: instant < 1ms match`,
  },
];

/* ═══════════════════════════════════
   COMPARISON TABLE DATA
   ═══════════════════════════════════ */
const comparisonRows = [
  { feature: 'Semantic TM Matching', values: ['String', 'String', 'None', '✓ Vector Cosine'] },
  { feature: 'Source Validation', values: ['✗', '✗', '✗', '✓ 5-Point Audit'] },
  { feature: 'Glossary Enforcement', values: ['⚠ Manual', '⚠ Manual', 'None', '✓ Prompt + Regex'] },
  { feature: 'Continuous Learning', values: ['⚠ Manual', '⚠ Manual', 'None', '✓ Atomic Auto'] },
  { feature: 'Browser Deployment', values: ['✗ Desktop', '✓ Cloud', '✓ API', '✓ Browser-Only'] },
  { feature: '22 Indian Languages', values: ['✗', '✗', '✗', '✓ IndicTrans2'] },
  { feature: 'Zero External DBs', values: ['✗', '✗', '—', '✓ SQLite Only'] },
];

/* ═══════════════════════════════════
   LANGUAGES DATA
   ═══════════════════════════════════ */
const languages = [
  { en: 'Hindi', native: 'हिन्दी' },
  { en: 'Marathi', native: 'मराठी' },
  { en: 'Tamil', native: 'தமிழ்' },
  { en: 'Telugu', native: 'తెలుగు' },
  { en: 'Bengali', native: 'বাংলা' },
  { en: 'Gujarati', native: 'ગુજરાતી' },
  { en: 'Kannada', native: 'ಕನ್ನಡ' },
  { en: 'Malayalam', native: 'മലയാളം' },
  { en: 'Odia', native: 'ଓଡ଼ିଆ' },
  { en: 'Punjabi', native: 'ਪੰਜਾਬੀ' },
  { en: 'Assamese', native: 'অসমীয়া' },
  { en: 'Urdu', native: 'اردو' },
  { en: 'Konkani', native: 'कोंकणी' },
  { en: 'Bodo', native: 'बड़ो' },
  { en: 'Dogri', native: 'डोगरी' },
  { en: 'Kashmiri', native: 'کٲشُر' },
  { en: 'Maithili', native: 'मैथिली' },
  { en: 'Manipuri', native: 'মৈতৈলোন্' },
  { en: 'Nepali', native: 'नेपाली' },
  { en: 'Sanskrit', native: 'संस्कृतम्' },
  { en: 'Santali', native: 'ᱥᱟᱱᱛᱟᱲᱤ' },
  { en: 'Sindhi', native: 'سنڌي' },
];

/* ═══════════════════════════════════
   HOME COMPONENT
   ═══════════════════════════════════ */
export default function Home() {
  const navigate = useNavigate();
  return (
    <div className="w-full bg-ui-white overflow-x-hidden">
      <Navigation />

      {/* ═══════════════════════════════════
          SECTION: HERO
          ═══════════════════════════════════ */}
      <section id="hero" className="relative min-h-screen pt-[72px] flex items-center bg-ui-white overflow-hidden">
        {/* RippleGrid Background */}
        <div style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, zIndex: 0 }}>
          <RippleGrid
            enableRainbow={false}
            gridColor="#e2e8f0"
            rippleIntensity={0.02}
            gridSize={9}
            gridThickness={26}
            fadeDistance={2.8}
            vignetteStrength={3.5}
            glowIntensity={0}
            opacity={0.7}
            gridRotation={0}
            mouseInteraction
            mouseInteractionRadius={1}
          />
        </div>

        <div className="relative z-10 max-w-[1280px] mx-auto px-6 lg:px-[80px] w-full py-16 lg:py-24">
          <div className="grid lg:grid-cols-[55%_45%] grid-cols-1 gap-12 lg:gap-16 items-center">
            {/* Left Column */}
            <div className="flex flex-col gap-8">
              <motion.div {...fadeUp}>
                <SectionLabel>AI Translation Studio</SectionLabel>
              </motion.div>

              <div className="flex flex-col gap-2">
                <motion.h1
                  className="text-display-hero text-brand-indigo leading-[100%] font-black"
                  initial={{ opacity: 0, y: 60 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
                >
                  Translate Once.
                </motion.h1>
                <motion.h1
                  className="text-display-hero text-brand-emerald leading-[100%] font-black"
                  initial={{ opacity: 0, y: 60 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: 0.12 }}
                >
                  Remember Forever.
                </motion.h1>
              </div>

              <motion.p
                className="text-body-lg text-ui-slate max-w-[520px]"
                {...fadeUpDelay(0.3)}
              >
                Verb AI combines Semantic Vector Memory, Constrained LLM Translation, and a
                Human-in-the-Loop approval engine. 94% of your translations are served from memory
                — for free.
              </motion.p>

              <motion.div className="flex flex-wrap items-center gap-4 lg:gap-8" {...fadeUpDelay(0.4)}>
                <Button variant="primary" size="lg" onClick={() => navigate('/upload')}>
                  Start Translating →
                </Button>

              </motion.div>

              {/* Stat Chips */}
              <motion.div className="flex flex-wrap items-center gap-4 lg:gap-6" {...fadeUpDelay(0.5)}>
                {[
                  { num: '94%', label: 'TM LEVERAGE' },
                  { num: '22', label: 'INDIC LANGUAGES' },
                  { num: '90%', label: 'COST REDUCTION' },
                ].map((stat, i) => (
                  <div key={i} className="flex items-baseline gap-2">
                    <span className="text-[28px] lg:text-[32px] font-bold text-brand-indigo">{stat.num}</span>
                    <span className="text-label-caps text-ui-slate">{stat.label}</span>
                    {i < 2 && <div className="hidden lg:block w-[1px] h-6 bg-ui-border ml-4" />}
                  </div>
                ))}
              </motion.div>
            </div>

            {/* Right Column — Floating Editor Card */}
            <motion.div
              className="rounded-[32px] bg-ui-white border border-ui-border p-6 lg:p-8 flex flex-col gap-6"
              style={{ boxShadow: 'var(--shadow-lg)' }}
              initial={{ opacity: 0, y: 30, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.8, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="flex items-center justify-between pb-4 border-b border-ui-border">
                <span className="text-body-sm font-medium text-brand-indigo">Translation Editor</span>
                <div className="flex gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-status-error" />
                  <div className="w-2 h-2 rounded-full bg-status-warning" />
                  <div className="w-2 h-2 rounded-full bg-status-success" />
                </div>
              </div>

              <div className="flex flex-col">
                <SegmentRow
                  status="approved"
                  badgeType="exact"
                  badgeText="100% Exact"
                  sourceText="Welcome to our service"
                  targetText="हमारी सेवा में आपका स्वागत है"
                />
                <SegmentRow
                  status="needs-review"
                  badgeType="fuzzy"
                  badgeText="87% Fuzzy"
                  sourceText="Thank you for your patience"
                  targetText="आपके धैर्य के लिए धन्यवाद"
                />
                <SegmentRow
                  status="needs-review"
                  badgeType="new"
                  badgeText="AI Translated"
                  sourceText="Processing your request"
                  targetText="आपका अनुरोध संसाधित किया जा रहा है"
                />
                <SegmentRow
                  status="needs-review"
                  badgeType="violation"
                  badgeText="⚠ Violation"
                  sourceText="Terms and conditions apply"
                  targetText="नियम और शर्तें लागू"
                  className="bg-[#FEF2F2]"
                />
              </div>

              <div className="pt-4 border-t border-ui-border">
                <p className="text-label-caps text-ui-slate">
                  4 segments | TM Leverage: 75% | ₹4,000 saved
                </p>
              </div>
            </motion.div>
          </div>

          {/* Scroll Indicator */}
          <motion.div
            className="flex justify-center mt-12 lg:mt-16"
            animate={{ y: [0, 8, 0] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          >
            <ChevronDown className="w-8 h-8 text-ui-border" />
          </motion.div>
        </div>
      </section>

      {/* ═══════════════════════════════════
          SECTION: MARQUEE TICKER (CSS-only infinite scroll)
          ═══════════════════════════════════ */}
      <section className="bg-brand-indigo h-16 overflow-hidden">
        <div className="marquee-container h-full">
          <div className="marquee-track">
            <MarqueeContent />
            <MarqueeContent />
            <MarqueeContent />
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════
          SECTION: THE 4 SYSTEMS
          ═══════════════════════════════════ */}
      <section id="features" className="bg-ui-white py-[80px] lg:py-[120px]">
        <div className="max-w-[1280px] mx-auto px-6 lg:px-[80px]">
          <div className="flex flex-col lg:flex-row justify-between items-start mb-16 gap-6">
            <motion.div {...fadeUp}>
              <SectionLabel>ARCHITECTURE</SectionLabel>
              <h2 className="text-display-h2 text-brand-indigo mt-4">
                The Four Engines Behind 94% Leverage
              </h2>
            </motion.div>
            <motion.p className="text-body-lg text-ui-slate max-w-[400px]" {...fadeUpDelay(0.15)}>
              A pipeline where every layer enforces the last.
            </motion.p>
          </div>

          <div className="flex gap-8 overflow-x-auto pb-8 scroll-hide cursor-grab active:cursor-grabbing">
            {[
              {
                step: '01',
                title: 'Source Quality Validation Engine',
                desc: "Before a single word is translated, Verb AI runs 5 parallel audits — spell checks, terminology clustering, date normalization, punctuation compliance, and CMS business rule validation.",
                badge: 'exact' as const,
                badgeText: 'Pre-Translation',
              },
              {
                step: '02',
                title: 'Semantic Translation Memory',
                desc: "Unlike Trados or Smartcat's rigid string matching, Verb AI stores every approved translation as a 768-dimensional vector in SQLite. It catches paraphrased meaning — a string matcher never could.",
                badge: 'fuzzy' as const,
                badgeText: 'Vector Cosine',
              },
              {
                step: '03',
                title: 'Constrained LLM Translation',
                desc: 'Gemini 1.5 Flash handles European languages. AI4Bharat IndicTrans2 handles 22 Indian languages. Every prompt injects glossary terms as hard constraints with deterministic regex verification.',
                badge: 'new' as const,
                badgeText: 'Prompt + Regex',
              },
              {
                step: '04',
                title: 'Human Review & Continuous Learning',
                desc: 'Raw LLM output never enters the Translation Memory. Only human-approved translations write to the database. Each approval triggers an atomic SQLite insert — resolved instantly, for free, forever.',
                badge: 'success' as const,
                badgeText: 'Atomic Auto-Update',
              },
            ].map((card, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.1 }}
                transition={{ duration: 0.5, delay: i * 0.1, ease: [0.22, 1, 0.36, 1] }}
                className="flex-shrink-0"
              >
                <FeatureCard
                  step={card.step}
                  title={card.title}
                  description={card.desc}
                  badgeType={card.badge}
                  badgeText={card.badgeText}
                />
              </motion.div>
            ))}
          </div>

          <motion.div className="flex justify-end mt-8" {...fadeUpDelay(0.3)}>
            <Button variant="ghost" size="sm">
              ← drag to explore →
            </Button>
          </motion.div>
        </div>
      </section>

      {/* ═══════════════════════════════════
          SECTION: HOW IT WORKS (with pipeline connectors)
          ═══════════════════════════════════ */}
      <section id="process" className="bg-ui-surface py-[80px] lg:py-[120px]">
        <div className="max-w-[1280px] mx-auto px-6 lg:px-[80px]">
          <div className="flex flex-col lg:flex-row justify-between items-start mb-16 lg:mb-24 gap-6">
            <motion.div {...fadeUp}>
              <SectionLabel>PROCESS</SectionLabel>
              <h2 className="text-display-h2 text-brand-indigo mt-4">
                From Upload to Institutional Memory
              </h2>
            </motion.div>
            <motion.p className="text-body-lg text-ui-slate max-w-[400px]" {...fadeUpDelay(0.15)}>
              Seven deterministic steps. Zero black boxes.
            </motion.p>
          </div>

          {processSteps.map((step, i) => {
            const isOdd = i % 2 === 0;
            return (
              <div key={i}>
                <motion.div
                  className={`grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-16 items-center ${
                    i < processSteps.length - 1 ? 'mb-4' : ''
                  }`}
                  initial={{ opacity: 0, x: isOdd ? -30 : 30 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true, amount: 0.2 }}
                  transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                >
                  {isOdd ? (
                    <>
                      <div className="flex flex-col gap-4">
                        <div className="text-label-caps text-brand-emerald">{step.num}.</div>
                        <h3 className="text-display-h3 text-brand-indigo">{step.title}</h3>
                        <p className="text-body-lg text-ui-slate max-w-[440px]">{step.desc}</p>
                      </div>
                      <CodeBlock code={step.code} />
                    </>
                  ) : (
                    <>
                      <div className="order-2 lg:order-1">
                        <CodeBlock code={step.code} />
                      </div>
                      <div className="flex flex-col gap-4 order-1 lg:order-2">
                        <div className="text-label-caps text-brand-emerald">{step.num}.</div>
                        <h3 className="text-display-h3 text-brand-indigo">{step.title}</h3>
                        <p className="text-body-lg text-ui-slate max-w-[440px]">{step.desc}</p>
                      </div>
                    </>
                  )}
                </motion.div>

                {/* Pipeline Connector */}
                {i < processSteps.length - 1 && (
                  <div className="hidden lg:block pipeline-connector my-4" />
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ═══════════════════════════════════
          SECTION: COMPETITIVE TABLE
          ═══════════════════════════════════ */}
      <section className="bg-ui-white py-[80px] lg:py-[120px]">
        <div className="max-w-[1280px] mx-auto px-6 lg:px-[80px]">
          <motion.div className="mb-16" {...fadeUp}>
            <SectionLabel>WHY VERB AI?</SectionLabel>
            <h2 className="text-display-h2 text-brand-indigo mt-4 mb-4">
              DeepL translates. Verb AI remembers.
            </h2>
            <p className="text-body-xl text-ui-slate">
              Every other tool is stateless. We compound.
            </p>
          </motion.div>

          <motion.div
            className="rounded-[24px] border border-ui-border overflow-hidden overflow-x-auto"
            {...fadeUpDelay(0.15)}
          >
            {/* Header Row */}
            <div className="grid grid-cols-5 min-w-[700px] bg-ui-surface h-[72px] items-center">
              <div className="px-6 font-bold text-brand-indigo">Feature</div>
              <div className="px-6 text-center font-bold text-ui-slate">Trados</div>
              <div className="px-6 text-center font-bold text-ui-slate">Smartcat</div>
              <div className="px-6 text-center font-bold text-ui-slate">DeepL</div>
              <div className="px-6 text-center font-bold bg-brand-emerald text-white rounded-tr-[24px]">
                Verb AI
              </div>
            </div>

            {/* Data Rows */}
            {comparisonRows.map((row, i) => (
              <motion.div
                key={i}
                className={`comparison-row grid grid-cols-5 min-w-[700px] h-16 items-center ${
                  i % 2 === 0 ? 'bg-white' : 'bg-ui-surface'
                }`}
                initial={{ opacity: 0, y: 15 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ duration: 0.4, delay: i * 0.06, ease: [0.22, 1, 0.36, 1] }}
              >
                <div className="px-6 font-medium text-brand-indigo">{row.feature}</div>
                {row.values.map((val, j) => (
                  <div
                    key={j}
                    className={`px-6 text-center text-sm ${
                      j === 3 ? 'bg-brand-emerald-light font-bold' : 'text-ui-slate'
                    }`}
                  >
                    {val.startsWith('✓') ? (
                      <span className="text-brand-emerald">{val}</span>
                    ) : val.startsWith('✗') ? (
                      <span className="text-status-error">{val}</span>
                    ) : val.startsWith('⚠') ? (
                      <span className="text-status-warning">{val}</span>
                    ) : (
                      <span className="text-ui-slate">{val}</span>
                    )}
                  </div>
                ))}
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ═══════════════════════════════════
          SECTION: 22 LANGUAGES
          ═══════════════════════════════════ */}
      <section id="languages" className="bg-ui-surface py-[80px] lg:py-[120px]">
        <div className="max-w-[1280px] mx-auto px-6 lg:px-[80px]">
          <motion.div className="mb-16" {...fadeUp}>
            <SectionLabel>LANGUAGE COVERAGE</SectionLabel>
            <h2 className="text-display-h2 text-brand-indigo mt-4 mb-4">
              From Hindi to Odia. Every word counts.
            </h2>
            <p className="text-body-lg text-ui-slate max-w-[600px]">
              Powered by AI4Bharat's IndicTrans2 — government-backed, open-source, enterprise-grade
              translation for all 22 official Indian languages.
            </p>
          </motion.div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 lg:gap-6">
            {languages.map((lang, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.1 }}
                transition={{ duration: 0.4, delay: i * 0.03, ease: [0.22, 1, 0.36, 1] }}
              >
                <LanguagePillCard englishName={lang.en} nativeName={lang.native} />
              </motion.div>
            ))}
          </div>
        </div>
      </section>



      {/* ═══════════════════════════════════
          SECTION: RESEARCH (Dark)
          ═══════════════════════════════════ */}
      <section id="research" className="bg-brand-indigo py-[80px] lg:py-[120px]">
        <div className="max-w-[1280px] mx-auto px-6 lg:px-[80px]">
          <motion.div className="mb-16" {...fadeUp}>
            <SectionLabel className="[&>span]:text-white/60">FOUNDATION</SectionLabel>
            <h2 className="text-display-h2 text-white mt-4 mb-4">
              Built on peer-reviewed research.
            </h2>
            <p className="text-body-lg text-brand-emerald">Not a wrapper. A system.</p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[
              {
                source: 'arXiv:2505.20096',
                title: 'MA-RAG',
                desc: 'Multi-Agent Retrieval-Augmented Generation context orchestration — the theoretical backbone of MAAR.',
              },
              {
                source: 'EMNLP 2025',
                title: 'RAGtrans',
                desc: "Retrieval-Augmented Machine Translation. Verb AI's 94% TM leverage smashes this published baseline.",
              },
              {
                source: 'arXiv:2407.01463',
                title: 'Multilingual RAG Pipeline',
                desc: 'Zero-shot multilingual RAG directly inspiring the English → Hindi / Tamil / Telugu pipeline.',
              },
              {
                source: 'AI4Bharat',
                title: 'IndicTrans2',
                desc: 'Government-backed, open-source sequence-to-sequence translation for all 22 official Indian languages.',
              },
            ].map((card, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 25 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.2 }}
                transition={{ duration: 0.5, delay: i * 0.1, ease: [0.22, 1, 0.36, 1] }}
              >
                <ResearchCard source={card.source} title={card.title} description={card.desc} />
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════
          SECTION: FINAL CTA
          ═══════════════════════════════════ */}
      <section id="contact" className="bg-ui-white min-h-screen flex items-center justify-center py-[80px] lg:py-[120px]">
        <div className="max-w-[1280px] mx-auto px-6 lg:px-[80px] text-center">
          <motion.div className="flex flex-col items-center gap-8" {...fadeUp}>
            <div className="flex flex-col gap-2">
              <h2 className="text-display-hero text-brand-indigo leading-[100%]">Ready to</h2>
              <h2 className="text-display-hero text-brand-emerald leading-[100%]">remember?</h2>
            </div>

            <p className="text-body-xl text-ui-slate max-w-[560px]">
              While others built LLM wrappers, we built institutional memory. Every approval
              compounds. Every match is free. The system gets smarter so you don't have to
              translate twice.
            </p>

            <div className="flex flex-wrap items-center justify-center gap-4 lg:gap-8">
              <Button variant="primary" size="lg" onClick={() => navigate('/upload')}>
                Start Translating →
              </Button>
              <Button variant="ghost" size="lg" onClick={() => navigate('/analytics')}>
                View Analytics
              </Button>
            </div>

            <p className="text-body-sm text-ui-slate-light mt-4">
              Built for enterprise. Designed for India. Running entirely on Next.js + SQLite.
            </p>
          </motion.div>
        </div>
      </section>

      {/* ═══════════════════════════════════
          SECTION: FOOTER
          ═══════════════════════════════════ */}
      <footer className="bg-dark-900 py-16 lg:py-20">
        <div className="max-w-[1280px] mx-auto px-6 lg:px-[80px]">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-8 mb-12">
            {/* Col 1 */}
            <div className="flex flex-col gap-4 sm:col-span-2 lg:col-span-1">
              <div className="text-[22px] font-black mb-2">
                <span className="text-white">verb</span>
                <span className="text-brand-emerald"> AI</span>
              </div>
              <p className="text-body-md" style={{ color: 'rgba(255,255,255,0.50)' }}>
                Semantic memory for enterprise translation. MAAR Architecture. 22 Indian Languages.
              </p>
            </div>

            {/* Col 2 */}
            <div>
              <h4 className="text-label-caps text-white mb-4">PRODUCT</h4>
              <div className="flex flex-col gap-3">
                {['How It Works', 'Languages'].map((link) => (
                  <a
                    key={link}
                    href="#"
                    className="text-body-sm transition-colors duration-200"
                    style={{ color: 'rgba(255,255,255,0.65)' }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = '#ffffff')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(255,255,255,0.65)')}
                  >
                    {link}
                  </a>
                ))}
              </div>
            </div>

            {/* Col 3 */}
            <div>
              <h4 className="text-label-caps text-white mb-4">RESEARCH</h4>
              <div className="flex flex-col gap-3">
                {['MA-RAG Paper', 'RAGtrans', 'IndicTrans2', 'FLORES-200'].map((link) => (
                  <a
                    key={link}
                    href="#"
                    className="text-body-sm transition-colors duration-200"
                    style={{ color: 'rgba(255,255,255,0.65)' }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = '#ffffff')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(255,255,255,0.65)')}
                  >
                    {link}
                  </a>
                ))}
              </div>
            </div>

            {/* Col 4 */}
            <div>
              <h4 className="text-label-caps text-white mb-4">BUILT WITH</h4>
              <div className="flex flex-col gap-3">
                {[
                  'Next.js 14 App Router',
                  'SQLite + better-sqlite3',
                  'Gemini 1.5 Flash',
                  'AI4Bharat IndicTrans2',
                  'text-embedding-004',
                  'Framer Motion 11',
                ].map((tech) => (
                  <span key={tech} className="text-body-sm" style={{ color: 'rgba(255,255,255,0.65)' }}>
                    {tech}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div
            className="pt-8 flex flex-col sm:flex-row justify-between items-center gap-4"
            style={{ borderTop: '1px solid rgba(255,255,255,0.10)' }}
          >
            <p className="text-body-sm" style={{ color: 'rgba(255,255,255,0.40)' }}>
              © 2025 Verb AI. All rights reserved.
            </p>
            <p className="text-body-sm" style={{ color: 'rgba(255,255,255,0.40)' }}>
              BLEU. Cosine. Human-approved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}