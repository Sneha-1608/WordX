import { Router } from 'express';
import { validateWithGemini, isMockMode } from '../gemini.js';
import { rateLimiter } from '../middleware.js';

const router = Router();

// ═══════════════════════════════════════════════════════════════
// 5-Point Source Quality Validation Engine
// Deterministic checks + Gemini augmentation (when available)
// ═══════════════════════════════════════════════════════════════

// ═══ Check 1: Spelling ═══
const COMMON_MISSPELLINGS = {
  'recieve': 'receive', 'occured': 'occurred', 'seperate': 'separate',
  'definately': 'definitely', 'neccessary': 'necessary', 'accomodate': 'accommodate',
  'occassion': 'occasion', 'untill': 'until', 'acheive': 'achieve',
  'bussiness': 'business', 'enviroment': 'environment', 'goverment': 'government',
  'independant': 'independent', 'knowlege': 'knowledge', 'managment': 'management',
  'occurence': 'occurrence', 'priviledge': 'privilege', 'refered': 'referred',
  'sucessful': 'successful', 'tommorow': 'tomorrow', 'wierd': 'weird',
  'thier': 'their', 'truely': 'truly', 'begining': 'beginning',
  'comming': 'coming', 'excercise': 'exercise', 'foriegn': 'foreign',
};

function checkSpelling(segments) {
  const issues = [];
  for (const seg of segments) {
    const words = seg.sourceText.toLowerCase().split(/[\s,.;:!?]+/);
    for (const word of words) {
      if (COMMON_MISSPELLINGS[word]) {
        issues.push({
          category: 'spelling', severity: 'warning', segmentId: seg.id, segmentIndex: seg.index,
          text: `"${word}" should be "${COMMON_MISSPELLINGS[word]}"`,
          original: word, suggestion: COMMON_MISSPELLINGS[word],
        });
      }
    }
  }
  return issues;
}

// ═══ Check 2: Terminology Consistency ═══
function checkTerminologyConsistency(segments) {
  const issues = [];
  const variationPairs = [
    ['e-commerce', 'ecommerce'], ['e commerce', 'ecommerce'],
    ['on-line', 'online'], ['on line', 'online'],
    ['data-base', 'database'], ['data base', 'database'],
    ['log-in', 'login'], ['log in', 'login'],
    ['sign-up', 'signup'], ['sign up', 'signup'],
    ['check-out', 'checkout'], ['check out', 'checkout'],
  ];
  const termVariations = {};

  for (const seg of segments) {
    const lower = seg.sourceText.toLowerCase();
    for (const [variant, canonical] of variationPairs) {
      if (lower.includes(variant)) {
        if (!termVariations[canonical]) termVariations[canonical] = [];
        termVariations[canonical].push({ segmentId: seg.id, segmentIndex: seg.index, found: variant });
      }
      if (lower.includes(canonical) && variant !== canonical) {
        if (!termVariations[canonical]) termVariations[canonical] = [];
        termVariations[canonical].push({ segmentId: seg.id, segmentIndex: seg.index, found: canonical });
      }
    }
  }

  for (const [term, occurrences] of Object.entries(termVariations)) {
    const unique = [...new Set(occurrences.map((o) => o.found))];
    if (unique.length > 1) {
      for (const occ of occurrences) {
        issues.push({
          category: 'terminology', severity: 'warning', segmentId: occ.segmentId, segmentIndex: occ.segmentIndex,
          text: `Inconsistent term: "${occ.found}" — standardize to "${term}"`,
          original: occ.found, suggestion: term,
        });
      }
    }
  }
  return issues;
}

// ═══ Check 3: Date/Number Consistency ═══
function checkDateNumberConsistency(segments) {
  const issues = [];
  const dateFormats = [];

  for (const seg of segments) {
    const mmdd = seg.sourceText.match(/\d{1,2}\/\d{1,2}\/\d{2,4}/g);
    const ddmm = seg.sourceText.match(/\d{1,2}-\d{1,2}-\d{2,4}/g);
    const iso = seg.sourceText.match(/\d{4}-\d{2}-\d{2}/g);

    if (mmdd) dateFormats.push({ format: 'MM/DD/YYYY', segId: seg.id, segIndex: seg.index });
    if (ddmm) dateFormats.push({ format: 'DD-MM-YYYY', segId: seg.id, segIndex: seg.index });
    if (iso) dateFormats.push({ format: 'ISO', segId: seg.id, segIndex: seg.index });

    const plain = seg.sourceText.match(/\b\d{4,}\b/g);
    const formatted = seg.sourceText.match(/\b\d{1,3}(,\d{3})+\b/g);
    if (plain && formatted) {
      issues.push({
        category: 'date_number', severity: 'info', segmentId: seg.id, segmentIndex: seg.index,
        text: "Mixed number formatting — some use commas, others don't",
        original: null, suggestion: 'Standardize all numbers with comma separators',
      });
    }
  }

  const uniq = [...new Set(dateFormats.map((d) => d.format))];
  if (uniq.length > 1) {
    for (const df of dateFormats) {
      issues.push({
        category: 'date_number', severity: 'warning', segmentId: df.segId, segmentIndex: df.segIndex,
        text: `Mixed date format "${df.format}" — standardize across document`,
        original: null, suggestion: 'Use consistent date format',
      });
    }
  }
  return issues;
}

// ═══ Check 4: Punctuation Style ═══
function checkPunctuation(segments) {
  const issues = [];
  for (const seg of segments) {
    const text = seg.sourceText.trim();
    if (text.length > 20 && !text.match(/[.!?:;]$/)) {
      issues.push({
        category: 'punctuation', severity: 'info', segmentId: seg.id, segmentIndex: seg.index,
        text: 'Segment ends without punctuation', original: text.slice(-20), suggestion: text + '.',
      });
    }
    if (text.includes('  ')) {
      issues.push({
        category: 'punctuation', severity: 'info', segmentId: seg.id, segmentIndex: seg.index,
        text: 'Double space detected', original: '  ', suggestion: ' ',
      });
    }
    if (/\s[.,:;!?]/.test(text)) {
      issues.push({
        category: 'punctuation', severity: 'warning', segmentId: seg.id, segmentIndex: seg.index,
        text: 'Extra space before punctuation mark',
        original: text.match(/\s[.,:;!?]/)?.[0], suggestion: text.match(/\s([.,:;!?])/)?.[1],
      });
    }
  }
  return issues;
}

// ═══ Check 5: Segment Length ═══
function checkSegmentLength(segments) {
  const issues = [];
  if (segments.length === 0) return issues;
  const avg = segments.reduce((s, seg) => s + seg.sourceText.length, 0) / segments.length;

  for (const seg of segments) {
    const len = seg.sourceText.length;
    if (len > avg * 3 && len > 300) {
      issues.push({
        category: 'length', severity: 'warning', segmentId: seg.id, segmentIndex: seg.index,
        text: `Unusually long segment (${len} chars) — consider splitting`, original: null, suggestion: 'Split into smaller segments',
      });
    }
    if (len < 10) {
      issues.push({
        category: 'length', severity: 'info', segmentId: seg.id, segmentIndex: seg.index,
        text: `Very short segment (${len} chars)`, original: seg.sourceText, suggestion: 'Merge with adjacent segment',
      });
    }
  }
  return issues;
}

// ═══════════════════════════════════════════════════════════════
// POST /api/validate — Main Handler
// ═══════════════════════════════════════════════════════════════

router.post('/', async (req, res) => {
  try {
    const { segments } = req.body;
    if (!segments || !Array.isArray(segments)) {
      return res.status(400).json({ error: 'segments array required' });
    }

    // ═══ Deterministic checks (always run) ═══
    const spellingIssues = checkSpelling(segments);
    const terminologyIssues = checkTerminologyConsistency(segments);
    const dateIssues = checkDateNumberConsistency(segments);
    const punctuationIssues = checkPunctuation(segments);
    const lengthIssues = checkSegmentLength(segments);

    // ═══ Gemini-augmented checks (when not in mock mode) ═══
    let geminiTermIssues = [];
    let geminiGrammarIssues = [];
    if (!isMockMode()) {
      try {
        const allText = segments.map((s) => s.sourceText).join('\n');
        const geminiResult = await rateLimiter.execute(() => validateWithGemini(allText));
        geminiTermIssues = (geminiResult.termIssues || []).map((i) => ({
          category: 'terminology', severity: i.severity || 'warning',
          segmentId: null, segmentIndex: null,
          text: i.issue, original: null, suggestion: i.correction,
        }));
        geminiGrammarIssues = (geminiResult.grammarIssues || []).map((i) => ({
          category: 'spelling', severity: i.severity || 'info',
          segmentId: null, segmentIndex: null,
          text: i.issue, original: null, suggestion: i.correction,
        }));
      } catch (err) {
        console.warn('Gemini validation augmentation failed:', err.message);
      }
    }

    const allIssues = [
      ...spellingIssues, ...geminiGrammarIssues,
      ...terminologyIssues, ...geminiTermIssues,
      ...dateIssues, ...punctuationIssues, ...lengthIssues,
    ];

    // Quality score
    const critical = allIssues.filter((i) => i.severity === 'error').length;
    const warnings = allIssues.filter((i) => i.severity === 'warning').length;
    const infos = allIssues.filter((i) => i.severity === 'info').length;
    const penalty = critical * 10 + warnings * 3 + infos * 1;
    const qualityScore = Math.max(0, Math.min(100, 100 - penalty));

    const checks = [
      { name: 'Spell Check', icon: '📝', count: spellingIssues.length + geminiGrammarIssues.length, status: (spellingIssues.length + geminiGrammarIssues.length) === 0 ? 'pass' : 'warn' },
      { name: 'Terminology Consistency', icon: '🔗', count: terminologyIssues.length + geminiTermIssues.length, status: (terminologyIssues.length + geminiTermIssues.length) === 0 ? 'pass' : 'warn' },
      { name: 'Date/Number Format', icon: '📅', count: dateIssues.length, status: dateIssues.length === 0 ? 'pass' : 'warn' },
      { name: 'Punctuation Style', icon: '✏️', count: punctuationIssues.length, status: punctuationIssues.length === 0 ? 'pass' : 'warn' },
      { name: 'Segment Length', icon: '📏', count: lengthIssues.length, status: lengthIssues.length === 0 ? 'pass' : 'warn' },
    ];

    // Simulate processing time for realism
    setTimeout(() => {
      res.json({
        qualityScore,
        totalIssues: allIssues.length,
        checks,
        issues: allIssues,
        autoFixAvailable: allIssues.some((i) => i.suggestion),
        geminiAugmented: !isMockMode(),
      });
    }, 1500);
  } catch (err) {
    console.error('Validation error:', err);
    res.status(500).json({ error: 'Validation failed: ' + err.message });
  }
});

export default router;
