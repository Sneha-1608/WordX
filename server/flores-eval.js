// ═══════════════════════════════════════════════════════════════
// FLORES-200 Multi-Language Benchmark Evaluator
// ═══════════════════════════════════════════════════════════════
//
// Supports dynamic evaluation across any Indian language pair
// that ClearLingo supports. Uses seed data from
// data_seeds/flores_indian_languages.json.
//
// ═══════════════════════════════════════════════════════════════

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import llmOrchestrator from './llm-orchestrator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load the FLORES seed data
let FLORES_DATA = {};
try {
  FLORES_DATA = JSON.parse(
    readFileSync(path.join(__dirname, '..', 'data_seeds', 'flores_indian_languages.json'), 'utf-8')
  );
} catch (err) {
  console.warn('[flores-eval] Could not load FLORES seed data:', err.message);
}

// ═══════════════════════════════════════════════════════════════
// Scoring Functions
// ═══════════════════════════════════════════════════════════════

/**
 * A simplified precision/recall token overlap scorer to proxy BLEU/COMET.
 * Returns a score out of 100.
 */
function calculateTokenOverlapScore(hypothesis, reference) {
  const normalize = (text) => text.toLowerCase().replace(/[.,!?।]/g, '').trim().split(/\s+/);

  const hypTokens = normalize(hypothesis);
  const refTokens = normalize(reference);

  if (hypTokens.length === 0 || refTokens.length === 0) return 0;

  // Count overlaps
  let overlapCount = 0;
  const refMap = {};
  for (const token of refTokens) {
    refMap[token] = (refMap[token] || 0) + 1;
  }

  for (const token of hypTokens) {
    if (refMap[token] > 0) {
      overlapCount++;
      refMap[token]--;
    }
  }

  const precision = overlapCount / hypTokens.length;
  const recall = overlapCount / refTokens.length;

  if (precision + recall === 0) return 0;
  const f1 = (2 * precision * recall) / (precision + recall);

  return Math.max(0, Math.min(100, Math.round(f1 * 100)));
}

/**
 * Compute BLEU-1 score (unigram precision) between hypothesis and reference.
 * @param {string} hypothesis - model translation output
 * @param {string} reference - gold reference translation
 * @returns {number} BLEU-1 score between 0 and 1
 */
function computeBLEU1(hypothesis, reference) {
  const hypTokens = hypothesis.trim().split(/\s+/);
  const refTokens = new Set(reference.trim().split(/\s+/));
  const matches = hypTokens.filter(t => refTokens.has(t)).length;
  return hypTokens.length > 0 ? matches / hypTokens.length : 0;
}

/**
 * Simple edit distance (Levenshtein) between two strings.
 */
function simpleEditDistance(a, b) {
  if (!a || !b) return Math.max((a || '').length, (b || '').length);
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  // Use a simplified version for performance
  const dp = Array.from({ length: m + 1 }, (_, i) => i);
  for (let j = 1; j <= n; j++) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= m; i++) {
      const temp = dp[i];
      dp[i] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[i], dp[i - 1]);
      prev = temp;
    }
  }
  return dp[m];
}

// ═══════════════════════════════════════════════════════════════
// Legacy: Quick 3-sentence quality check (preserved for backward compat)
// ═══════════════════════════════════════════════════════════════

const FLORES_EVAL_DATA = [
  {
    source: "On Monday, scientists from the Stanford University School of Medicine announced the invention of a new diagnostic tool that can sort cells by type.",
    target: "सोमवार को, स्टैनफोर्ड यूनिवर्सिटी स्कूल ऑफ मेडिसिन के वैज्ञानिकों ने एक नए डायग्नोस्टिक टूल के आविष्कार की घोषणा की जो कोशिकाओं को प्रकार के अनुसार क्रमबद्ध कर सकता है।"
  },
  {
    source: "Lead researchers say this may bring early detection of cancer, tuberculosis, HIV and malaria to patients in low-income countries.",
    target: "प्रमुख शोधकर्ताओं का कहना है कि इससे कम आय वाले देशों में रोगियों को कैंसर, तपेदिक, एचआईवी और मलेरिया का शीघ्र पता चलने में मदद मिल सकती है।"
  },
  {
    source: "Cancer cells, for instance, are harder to sort because they often hide among normal cells.",
    target: "कैंसर कोशिकाओं को, उदाहरण के लिए, क्रमबद्ध करना अधिक कठिन होता है क्योंकि वे अक्सर सामान्य कोशिकाओं के बीच छिप जाती हैं।"
  },
  {
    source: "A team of researchers has developed a process that may allow patients to safely and quickly identify diseases.",
    target: "शोधकर्ताओं की एक टीम ने एक ऐसी प्रक्रिया विकसित की है जो रोगियों को सुरक्षापूर्वक और तेज़ी से बीमारियों की पहचान करने में अनुमति दे सकती है।"
  },
  {
    source: "The global economy is currently undergoing a period of significant transformation and volatility.",
    target: "वैश्विक अर्थव्यवस्था वर्तमान में महत्वपूर्ण परिवर्तन और अस्थिरता की अवधि से गुजर रही है।"
  }
];

/**
 * Runs a rapid 3-sentence quality check benchmark (legacy — preserved for backward compat)
 */
export async function runAutomatedQualityCheck() {
  const shuffled = [...FLORES_EVAL_DATA].sort(() => 0.5 - Math.random());
  const testSet = shuffled.slice(0, 3);

  const results = [];
  let totalScore = 0;

  for (const item of testSet) {
    try {
      const translationResult = await llmOrchestrator.translateSegment({
        sourceText: item.source,
        sourceLang: 'en',
        targetLang: 'hi_IN',
      });

      const modelOutput = translationResult.translation;
      const proxyBleu = calculateTokenOverlapScore(modelOutput, item.target);

      totalScore += proxyBleu;

      results.push({
        source: item.source,
        groundTruth: item.target,
        modelOutput: modelOutput,
        score: proxyBleu,
        usedFallback: translationResult.usedFallback || false
      });
    } catch (err) {
      console.error("Benchmark translation failed:", err);
      results.push({
        source: item.source,
        groundTruth: item.target,
        modelOutput: "[Translation Failed]",
        score: 0,
        usedFallback: false
      });
    }
  }

  const averageBleu = results.length > 0 ? Math.round(totalScore / results.length) : 0;

  return {
    averageBleu,
    tests: results,
    timestamp: new Date().toISOString()
  };
}

// ═══════════════════════════════════════════════════════════════
// NEW: Dynamic Multi-Language FLORES Evaluation
// ═══════════════════════════════════════════════════════════════

/**
 * Map short lang codes (from FLORES seed) to ClearLingo API language codes.
 */
const LANG_CODE_MAP = {
  hi: 'hi_IN', bn: 'bn_IN', ta: 'ta_IN', te: 'te_IN',
  mr: 'mr_IN', gu: 'gu_IN', kn: 'kn_IN', ml: 'ml_IN',
  pa: 'pa_IN', or: 'or_IN', as: 'as_IN', ur: 'ur_PK',
};

/**
 * Run FLORES-200 evaluation for a specific language pair.
 *
 * @param {string} targetLangCode - ISO code like "hi", "bn", "ta"
 * @param {object} options
 * @param {number} options.maxPairs - max pairs to evaluate (default: all)
 * @param {Function} options.onProgress - callback(current, total) for SSE streaming
 * @returns {Promise<object>}
 */
export async function runFloresEval(targetLangCode, options = {}) {
  const langData = FLORES_DATA[targetLangCode];
  if (!langData) {
    throw new Error(`No FLORES data available for language: ${targetLangCode}`);
  }

  const pairs = options.maxPairs
    ? langData.pairs.slice(0, options.maxPairs)
    : langData.pairs;

  if (pairs.length === 0) {
    return {
      language: targetLangCode,
      language_name: langData.language_name,
      status: 'NO_DATA',
      message: 'No reference pairs available for this language. Add pairs to data_seeds/flores_indian_languages.json.',
      bleu1: null,
      avgEditDistance: null,
      testedPairs: 0,
    };
  }

  const apiLangCode = LANG_CODE_MAP[targetLangCode] || targetLangCode;
  const results = [];

  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];
    if (options.onProgress) options.onProgress(i + 1, pairs.length);

    try {
      const translationResult = await llmOrchestrator.translateSegment({
        sourceText: pair.source,
        sourceLang: 'en',
        targetLang: apiLangCode,
      });

      const modelOutput = translationResult.translation || translationResult.targetText || '';
      const bleu = computeBLEU1(modelOutput, pair.reference);
      const editDist = simpleEditDistance(modelOutput, pair.reference);
      const overlapScore = calculateTokenOverlapScore(modelOutput, pair.reference);

      results.push({
        source: pair.source,
        reference: pair.reference,
        hypothesis: modelOutput,
        bleu1: bleu,
        overlapScore,
        editDistance: editDist,
        matchType: translationResult.matchType || 'NEW',
        model: translationResult.model || 'unknown',
      });
    } catch (err) {
      results.push({
        source: pair.source,
        reference: pair.reference,
        hypothesis: '[error]',
        error: err.message,
        bleu1: 0,
        overlapScore: 0,
        editDistance: 999,
      });
    }
  }

  const avgBLEU = results.reduce((s, r) => s + r.bleu1, 0) / results.length;
  const avgEditDist = results.reduce((s, r) => s + r.editDistance, 0) / results.length;
  const avgOverlap = results.reduce((s, r) => s + (r.overlapScore || 0), 0) / results.length;
  const errorCount = results.filter(r => r.error).length;

  return {
    language: targetLangCode,
    language_name: langData.language_name,
    status: 'COMPLETE',
    bleu1: parseFloat(avgBLEU.toFixed(4)),
    avgEditDistance: parseFloat(avgEditDist.toFixed(2)),
    avgOverlapScore: parseFloat(avgOverlap.toFixed(2)),
    testedPairs: results.length,
    errorCount,
    perPairResults: results,
    evaluatedAt: new Date().toISOString(),
  };
}

/**
 * Run FLORES evaluation across ALL languages in the seed data.
 *
 * @param {object} options
 * @param {number} options.maxPairsPerLanguage - limit pairs per lang (default: 20)
 * @param {Function} options.onLanguageComplete - callback(langCode, result)
 * @returns {Promise<Array>}
 */
export async function runFullFloresEval(options = {}) {
  const languages = Object.keys(FLORES_DATA);
  const results = [];

  for (const langCode of languages) {
    const result = await runFloresEval(langCode, {
      maxPairs: options.maxPairsPerLanguage ?? 20,
    });
    results.push(result);
    if (options.onLanguageComplete) options.onLanguageComplete(langCode, result);
  }

  return results;
}

/**
 * Get available FLORES languages and their pair counts.
 */
export function getFloresLanguages() {
  return Object.entries(FLORES_DATA).map(([code, data]) => ({
    code,
    name: data.language_name,
    sarvamCode: data.sarvam_code,
    pairCount: data.pairs.length,
    hasData: data.pairs.length > 0,
  }));
}

export default {
  runAutomatedQualityCheck,
  runFloresEval,
  runFullFloresEval,
  getFloresLanguages,
};
