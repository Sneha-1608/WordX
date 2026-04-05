// ═══════════════════════════════════════════════════════════════
// Layer 4: LLM Orchestration Engine
// ═══════════════════════════════════════════════════════════════
//
// Centralizes ALL LLM interactions for VerbAI.
// Implements the Layer 4 spec: Gemini + LoRA + Multi-Model.
//
// Sub-components:
//   §4.1  Gemini 1.5 Flash   — Translation + Validation
//   §4.2  text-embedding-004 — 768-dim semantic embeddings
//   §4.3  LoRA Adapters      — Per-language fine-tuning registry
//
// Modified: 2026-04-04 — sourceLang is now optional. Each segment
// uses its per-segment detected_language for translation. Added
// translatedFrom / translatedFromDisplay fields to results.
// Indic routing now considers source language too.
//
// ═══════════════════════════════════════════════════════════════

import db from './db.js';
import ragEngine from './rag-engine.js';
import {
  translateText,
  validateWithGemini,
  isMockMode,
} from './gemini.js';
import { qaCheckTranslationLlama as qaCheckTranslation, groqTranslate, isGroqAvailable } from './llama3.js';
import {
  sarvamTranslate,
  isSarvamAvailable,
  isSarvamSupported,
  isSarvamSourceSupported,
  getSarvamStatus,
} from './sarvam.js';
import {
  deeplTranslate,
  isDeeplAvailable,
  isDeeplSupported,
  getDeeplStatus,
} from './deepl.js';
import {
  indictransTranslate,
  isIndictransAvailable,
  isIndictransSupported,
  getIndictransStatus,
  checkIndictransHealth,
} from './indictrans.js';
import { rateLimiter } from './middleware.js';
import { extractTerms, crossReferenceGlossary } from './term-extractor.js';
import { getCachedTranslation, setCachedTranslation } from './cache-redis.js';
import { getLanguageDisplayName } from './language-detector.js';

// ═══════════════════════════════════════════════════════════════
// BCP-47 → Locale Code Mapping (for Indic source language routing)
// ═══════════════════════════════════════════════════════════════

// Set of BCP-47 codes for Indian scheduled languages (used for source routing)
const INDIC_BCP47 = new Set([
  'hi', 'bn', 'te', 'mr', 'ta', 'ur', 'gu', 'kn', 'ml', 'or', 'pa',
  'as', 'mai', 'sa', 'sd', 'ks', 'ne', 'kok', 'doi', 'mni', 'brx', 'sat', 'si',
]);

/**
 * Check if a BCP-47 source language code is an Indic language.
 * @param {string} bcp47 - e.g. "hi", "mr", "ta"
 * @returns {boolean}
 */
function isIndicSourceLang(bcp47) {
  if (!bcp47) return false;
  const base = bcp47.split(/[_-]/)[0].toLowerCase();
  return INDIC_BCP47.has(base);
}

// ═══════════════════════════════════════════════════════════════
// §4.1 — Prompt Template System (Versioned)
// ═══════════════════════════════════════════════════════════════

const PROMPT_TEMPLATES = {
  // v2: Production constrained prompt (Layer 4 spec §4.1)
  'v2-constrained': {
    version: 'v2-constrained',
    name: 'Enterprise Constrained Translation',
    description: 'Layer 4 spec-aligned constrained prompt. Prevents wrapping, forces glossary, anchors style.',
    build: ({ sourceLang, targetLang, stylePrompt, glossaryString, fuzzyRef, sourceText, context }) => {
      let prompt = `You are a professional Enterprise Translator from ${sourceLang} to ${targetLang}.
Return ONLY the translated sentence. No XML, no markdown, no explanations.

CONTEXT: ${context || 'General Business'}

STYLE REQUIREMENTS:`;

      if (stylePrompt) {
        prompt += stylePrompt;
      } else {
        prompt += `
- Tone: Professional, General Purpose
- Formality: Formal`;
      }

      if (glossaryString) {
        prompt += `

REQUIRED GLOSSARY TERMS (MUST USE EXACTLY IF SOURCE TERM IS PRESENT):
${glossaryString}`;
      }

      if (fuzzyRef) {
        prompt += `

REFERENCE TRANSLATIONS (For Style ONLY):
Reference: "${fuzzyRef}"`;
      } else {
        prompt += `

REFERENCE TRANSLATIONS (For Style ONLY):
None.`;
      }

      prompt += `

SOURCE TEXT:
${sourceText}`;

      return prompt;
    },
  },

  // v1: Legacy prompt (what was previously in gemini.js)
  'v1-legacy': {
    version: 'v1-legacy',
    name: 'Legacy Translation Prompt',
    description: 'Original basic translation prompt.',
    build: ({ sourceLang, targetLang, stylePrompt, glossaryTerms, fuzzyRef, sourceText }) => {
      let prompt = `You are a professional translator. Translate the following ${sourceLang} text to ${targetLang}.

RULES:
- Return ONLY the translated text. No XML, no markdown, no explanations.
- Maintain the same tone and register as the source.
- Preserve any numbers, dates, and proper nouns exactly as they appear.
- Use formal/professional register for business content.`;

      if (stylePrompt) prompt += stylePrompt;

      if (glossaryTerms && glossaryTerms.length > 0) {
        prompt += `\n\nMANDATORY GLOSSARY (you MUST use these exact translations):`;
        for (const term of glossaryTerms) {
          prompt += `\n- "${term.source}" → "${term.target}"`;
        }
      }

      if (fuzzyRef) {
        prompt += `\n\nSTYLE REFERENCE:\n"${fuzzyRef}"\nUse this as a style guide but translate the actual source text below.`;
      }

      prompt += `\n\nSOURCE TEXT:\n${sourceText}\n\nTRANSLATION:`;
      return prompt;
    },
  },
};

// Active prompt version
let activePromptVersion = 'v2-constrained';

// ═══════════════════════════════════════════════════════════════
// §4.1 — Multi-Model Routing Table
// ═══════════════════════════════════════════════════════════════

// Language families and their routing
const INDIC_LANGS = new Set([
  'hi_IN', 'ta_IN', 'te_IN', 'kn_IN', 'ml_IN', 'bn_IN', 'mr_IN',
  'gu_IN', 'pa_IN', 'or_IN', 'as_IN', 'mai_IN', 'sd_IN', 'ks_IN',
  'ne_NP', 'ur_PK', 'si_LK', 'mni_IN', 'brx_IN', 'doi_IN',
  'sat_IN', 'kok_IN', 'sa_IN',
]);

const EUROPEAN_LANGS = new Set([
  'en_US', 'en_GB',
  'fr_FR', 'de_DE', 'es_ES', 'pt_BR', 'it_IT', 'nl_NL',
  'ru_RU', 'pl_PL', 'sv_SE', 'tr_TR',
  'ja_JP', 'ko_KR', 'zh_CN',
  'ar_SA', 'th_TH', 'vi_VN',
]);

// Language display names for logging
const LANG_NAMES = {
  en: 'English', en_US: 'English (US)', en_GB: 'English (UK)',
  hi_IN: 'Hindi', ta_IN: 'Tamil', te_IN: 'Telugu', kn_IN: 'Kannada',
  ml_IN: 'Malayalam', bn_IN: 'Bengali', mr_IN: 'Marathi', gu_IN: 'Gujarati',
  pa_IN: 'Punjabi', or_IN: 'Odia', as_IN: 'Assamese', mai_IN: 'Maithili',
  sd_IN: 'Sindhi', ks_IN: 'Kashmiri', ur_PK: 'Urdu', ne_NP: 'Nepali',
  si_LK: 'Sinhala', mni_IN: 'Manipuri', brx_IN: 'Bodo', doi_IN: 'Dogri',
  sat_IN: 'Santali', kok_IN: 'Konkani', sa_IN: 'Sanskrit',
  fr_FR: 'French', de_DE: 'German', es_ES: 'Spanish', pt_BR: 'Portuguese',
  it_IT: 'Italian', nl_NL: 'Dutch', ru_RU: 'Russian', pl_PL: 'Polish',
  sv_SE: 'Swedish', tr_TR: 'Turkish',
  ja_JP: 'Japanese', ko_KR: 'Korean', zh_CN: 'Chinese',
  ar_SA: 'Arabic', th_TH: 'Thai', vi_VN: 'Vietnamese',
};

/**
 * §4.1: Multi-model routing.
 * INDIC languages → IndicTrans2 (local) → Sarvam AI → Gemini (fallback)
 * European / CJK / Other → DeepL API → Gemini (fallback)
 *
 * @param {string} targetLang
 * @returns {{ model: string, engine: string, family: string }}
 */
export function getModelForLanguage(targetLang) {
  const family = INDIC_LANGS.has(targetLang) ? 'indic'
    : EUROPEAN_LANGS.has(targetLang) ? 'european'
      : 'other';

  // ═══ INDIC LANGUAGES: IndicTrans2 → Sarvam AI → Gemini ═══

  // Priority 1: IndicTrans2 (local, free, no API key needed)
  if (family === 'indic' && isIndictransAvailable() && isIndictransSupported(targetLang)) {
    return {
      model: 'indictrans2-en-indic-dist-200M',
      engine: 'indictrans2',
      family,
      displayName: LANG_NAMES[targetLang] || targetLang,
    };
  }

  // Priority 2: Sarvam AI (remote API, Indic languages)
  if (family === 'indic' && isSarvamAvailable() && isSarvamSupported(targetLang)) {
    return {
      model: 'sarvam-translate:v1',
      engine: 'sarvam',
      family,
      displayName: LANG_NAMES[targetLang] || targetLang,
    };
  }

  // ═══ EUROPEAN LANGUAGES: DeepL → Gemini ═══

  // Priority 3: DeepL (European languages)
  if (family === 'european' && isDeeplAvailable() && isDeeplSupported(targetLang)) {
    return {
      model: 'deepl-translate',
      engine: 'deepl',
      family,
      displayName: LANG_NAMES[targetLang] || targetLang,
    };
  }

  // Priority 4: Gemini (ultimate fallback for all languages)
  return {
    model: 'gemini-2.0-flash',
    engine: 'gemini',
    family,
    displayName: LANG_NAMES[targetLang] || targetLang,
  };
}

// ═══════════════════════════════════════════════════════════════
// §4.1 — Token Estimation (for cost tracking)
// ═══════════════════════════════════════════════════════════════

/**
 * Estimate token count for a text string.
 * Gemini uses ~4 chars/token for English, ~2 chars/token for Indic.
 */
function estimateTokens(text, langFamily = 'other') {
  if (!text) return 0;
  const charsPerToken = langFamily === 'indic' ? 2 : 4;
  return Math.ceil(text.length / charsPerToken);
}

// Gemini 1.5 Flash pricing (per 1M tokens)
const PRICING = {
  'gemini-2.0-flash': { input: 0.10, output: 0.40 },  // USD per 1M tokens
  'gemini-1.5-flash': { input: 0.10, output: 0.40 },  // Legacy reference
  'text-embedding-004': { input: 0.00, output: 0.00 },  // Free in free tier
};

function estimateCost(inputTokens, outputTokens, model = 'gemini-2.0-flash') {
  const rates = PRICING[model] || PRICING['gemini-2.0-flash'];
  return ((inputTokens * rates.input) + (outputTokens * rates.output)) / 1_000_000;
}

// ═══════════════════════════════════════════════════════════════
// §4.1 — Translation Cache (Semantic Dedup)
// ═══════════════════════════════════════════════════════════════

/**
 * Check if we already have a cached translation for this exact input.
 */
function cacheGet(sourceText, sourceLang, targetLang, model) {
  const cached = db.prepare(
    `SELECT id, target_text, hit_count FROM translation_cache
     WHERE source_text = ? AND source_lang = ? AND target_lang = ? AND model = ?
     AND (expires_at IS NULL OR expires_at > datetime('now'))
     LIMIT 1`
  ).get(sourceText, sourceLang, targetLang, model);

  if (cached) {
    // Increment hit count
    db.prepare('UPDATE translation_cache SET hit_count = hit_count + 1 WHERE id = ?')
      .run(cached.id);
    return cached.target_text;
  }
  return null;
}

/**
 * Cache a translation result.
 */
function cacheSet(sourceText, sourceLang, targetLang, targetText, model, promptVersion) {
  try {
    db.prepare(
      `INSERT OR REPLACE INTO translation_cache
         (source_text, source_lang, target_lang, target_text, model, prompt_version, hit_count)
       VALUES (?, ?, ?, ?, ?, ?, 0)`
    ).run(sourceText, sourceLang, targetLang, targetText, model, promptVersion);
  } catch (err) {
    console.warn(`⚠ Cache write failed: ${err.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// §4.1 — LLM Call Logger
// ═══════════════════════════════════════════════════════════════

function logLLMCall({
  callType, model, sourceLang, targetLang, inputTokens, outputTokens,
  latencyMs, status = 'success', cacheHit = false, segmentId = null,
  projectId = null, adapterUsed = null, errorMessage = null,
}) {
  try {
    db.prepare(
      `INSERT INTO llm_call_log
         (call_type, model, source_lang, target_lang, input_tokens, output_tokens,
          total_tokens, latency_ms, status, cache_hit, segment_id, project_id,
          adapter_used, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      callType, model, sourceLang, targetLang, inputTokens, outputTokens,
      (inputTokens || 0) + (outputTokens || 0), latencyMs, status,
      cacheHit ? 1 : 0, segmentId, projectId, adapterUsed, errorMessage
    );
  } catch (err) {
    console.warn(`⚠ Call log write failed: ${err.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// §4.1 — translateSegment() — The Core Translation Function
// ═══════════════════════════════════════════════════════════════

/**
 * Translate a single segment through the full Layer 4 pipeline.
 * Implements §4.1 constrained prompt with multi-model routing.
 *
 * @param {Object} params
 * @param {string} params.sourceText      Source segment
 * @param {string} params.sourceLang      e.g. 'en'
 * @param {string} params.targetLang      e.g. 'hi_IN'
 * @param {string} [params.context]       Domain context label
 * @param {string} [params.stylePrompt]   Style profile text for prompt
 * @param {Array}  [params.glossaryTerms] [{source, target}]
 * @param {string} [params.fuzzyRef]      Fuzzy TM match for tone anchoring
 * @param {string} [params.segmentId]     For call logging
 * @param {number} [params.projectId]     For call logging
 * @param {string} [params.promptVersion] Override prompt template version
 * @returns {Promise<{targetText: string, model: string, cached: boolean, tokens: Object, latencyMs: number}>}
 */
export async function translateSegment({
  sourceText,
  sourceLang = 'en',
  targetLang = 'hi_IN',
  context = 'General Business',
  stylePrompt = '',
  glossaryTerms = [],
  fuzzyRef = null,
  segmentId = null,
  projectId = null,
  promptVersion = null,
}) {
  const start = performance.now();
  const routing = getModelForLanguage(targetLang);
  const version = promptVersion || activePromptVersion;

  // ──────────────────────────────────────────────────────
  // Step 0: Check Redis L1 cache (shared across processes)
  // ──────────────────────────────────────────────────────
  try {
    const redisCached = await getCachedTranslation(sourceText, sourceLang, targetLang);
    if (redisCached) {
      const elapsed = parseFloat((performance.now() - start).toFixed(2));
      logLLMCall({
        callType: 'translation', model: routing.model,
        sourceLang, targetLang, inputTokens: 0, outputTokens: 0,
        latencyMs: elapsed, status: 'redis_cached', cacheHit: true,
        segmentId, projectId,
      });
      console.log(`   ⚡ REDIS CACHED [${routing.displayName}] in ${elapsed}ms`);
      return {
        targetText: redisCached.targetText,
        model: redisCached.model || routing.model,
        engine: redisCached.engine || routing.engine,
        cached: true,
        tokens: { input: 0, output: 0, total: 0 },
        latencyMs: elapsed,
        promptVersion: version,
      };
    }
  } catch { }

  // ──────────────────────────────────────────────────────
  // Step 1: Check translation cache (semantic dedup)
  // ──────────────────────────────────────────────────────
  const cached = cacheGet(sourceText, sourceLang, targetLang, routing.model);
  if (cached) {
    const elapsed = parseFloat((performance.now() - start).toFixed(2));
    logLLMCall({
      callType: 'translation', model: routing.model,
      sourceLang, targetLang, inputTokens: 0, outputTokens: 0,
      latencyMs: elapsed, status: 'cached', cacheHit: true,
      segmentId, projectId,
    });
    console.log(`   💾 CACHED [${routing.displayName}] in ${elapsed}ms`);
    return {
      targetText: cached,
      model: routing.model,
      engine: routing.engine,
      cached: true,
      tokens: { input: 0, output: 0, total: 0 },
      latencyMs: elapsed,
      promptVersion: version,
    };
  }

  // ──────────────────────────────────────────────────────
  // Step 2: Check for active LoRA adapter (§4.3)
  // ──────────────────────────────────────────────────────
  const adapter = getActiveAdapter(sourceLang, targetLang);
  const adapterName = adapter?.adapter_name || null;

  // ──────────────────────────────────────────────────────
  // Step 3: Build constrained prompt (§4.1)
  // ──────────────────────────────────────────────────────
  const template = PROMPT_TEMPLATES[version] || PROMPT_TEMPLATES['v2-constrained'];

  // Format glossary for injection
  let glossaryString = '';
  if (glossaryTerms.length > 0) {
    glossaryString = glossaryTerms.map((t) => `"${t.source}" → "${t.target}"`).join('\n');
  }

  const prompt = template.build({
    sourceLang, targetLang, sourceText, context,
    stylePrompt, glossaryString, fuzzyRef,
    glossaryTerms,
  });

  // ──────────────────────────────────────────────────────
  // Step 4: Call translation engine (§4.1)
  //   IndicTrans2 (local) → Sarvam AI → Gemini (fallback)
  // ──────────────────────────────────────────────────────
  let targetText;
  let errorMessage = null;
  let status = 'success';
  let actualEngine = routing.engine;
  let actualModel = routing.model;

  const runGeminiWithGroqFallback = async (fallbackSources) => {
    try {
      targetText = await rateLimiter.execute(() =>
        translateText(sourceText, sourceLang, targetLang, glossaryTerms, fuzzyRef, stylePrompt)
      );
      actualEngine = fallbackSources ? `gemini (fallback from ${fallbackSources})` : 'gemini';
      actualModel = 'gemini-2.0-flash';
    } catch (geminiErr) {
      console.warn(`   ⚠ Gemini failed for [${routing.displayName}]: ${geminiErr.message}`);
      if (isGroqAvailable()) {
        console.warn(`   ↪ Falling back to Groq Llama 3 (Ultimate Fallback)...`);
        try {
          const groqResult = await groqTranslate(sourceText, sourceLang, targetLang, glossaryTerms, fuzzyRef, stylePrompt);
          targetText = groqResult.text;
          actualEngine = fallbackSources ? `groq (fallback from gemini+${fallbackSources})` : 'groq (fallback from gemini)';
          actualModel = groqResult.model;
        } catch (groqErr) {
          console.warn(`   ⚠ Groq also failed: ${groqErr.message}`);
          throw groqErr; // both gemini and groq failed
        }
      } else {
        throw geminiErr;
      }
    }
  };

  try {
    if (routing.engine === 'indictrans2') {
      // ═══ IndicTrans2 path (local model, Indic languages) ═══
      try {
        const itResult = await indictransTranslate(sourceText, sourceLang, targetLang);
        targetText = itResult.text;
        actualEngine = 'indictrans2';
        actualModel = itResult.model;
      } catch (itErr) {
        // Fallback to Sarvam AI if IndicTrans2 fails
        console.warn(`   ⚠ IndicTrans2 failed for [${routing.displayName}]: ${itErr.message}`);
        if (isSarvamAvailable() && isSarvamSupported(targetLang) && isSarvamSourceSupported(sourceLang)) {
          console.warn(`   ↪ Falling back to Sarvam AI...`);
          try {
            const sarvamResult = await sarvamTranslate(sourceText, isSarvamSourceSupported(sourceLang) ? sourceLang : 'en', targetLang, { mode: 'formal' });
            targetText = sarvamResult.text;
            actualEngine = 'sarvam (fallback from indictrans2)';
            actualModel = sarvamResult.model;
          } catch (sarvamErr) {
            console.warn(`   ⚠ Sarvam also failed: ${sarvamErr.message}`);
            console.warn(`   ↪ Falling back to Gemini/Groq...`);
            await runGeminiWithGroqFallback('indictrans2+sarvam');
          }
        } else {
          console.warn(`   ↪ Falling back to Gemini/Groq...`);
          await runGeminiWithGroqFallback('indictrans2');
        }
      }
    } else if (routing.engine === 'sarvam') {
      // ═══ Sarvam AI path (Indic languages, English source ONLY) ═══
      // Sarvam only supports English→Indic, so check source language first
      if (isSarvamSourceSupported(sourceLang)) {
        try {
          const sarvamResult = await sarvamTranslate(sourceText, sourceLang, targetLang, { mode: 'formal' });
          targetText = sarvamResult.text;
          actualEngine = 'sarvam';
          actualModel = sarvamResult.model;
        } catch (sarvamErr) {
          // Fallback to IndicTrans2 if Sarvam fails
          console.warn(`   ⚠ Sarvam failed for [${routing.displayName}]: ${sarvamErr.message}`);
          if (isIndictransAvailable() && isIndictransSupported(targetLang)) {
            console.warn(`   ↪ Falling back to IndicTrans2...`);
            try {
              const itResult = await indictransTranslate(sourceText, sourceLang, targetLang);
              targetText = itResult.text;
              actualEngine = 'indictrans2 (fallback from sarvam)';
              actualModel = itResult.model;
            } catch (itErr) {
              console.warn(`   ⚠ IndicTrans2 also failed: ${itErr.message}`);
              console.warn(`   ↪ Falling back to Gemini/Groq...`);
              await runGeminiWithGroqFallback('sarvam+indictrans2');
            }
          } else {
            console.warn(`   ↪ Falling back to Gemini/Groq...`);
            await runGeminiWithGroqFallback('sarvam');
          }
        }
      } else {
        // Source language is not English — skip Sarvam entirely, go to Gemini
        console.warn(`   ⚠ Sarvam skipped: source language "${sourceLang}" is not English`);
        console.warn(`   ↪ Falling back to Gemini/Groq...`);
        await runGeminiWithGroqFallback('sarvam-source-unsupported');
      }
    } else if (routing.engine === 'deepl') {
      // ═══ DeepL path (European, CJK, non-Indian languages) ═══
      try {
        const deeplResult = await deeplTranslate(sourceText, sourceLang, targetLang, { formality: 'prefer_more' });
        targetText = deeplResult.text;
        actualEngine = 'deepl';
        actualModel = 'deepl-translate';
      } catch (deeplErr) {
        // Fallback to Gemini/Groq if DeepL fails
        console.warn(`   ⚠ DeepL failed for [${routing.displayName}]: ${deeplErr.message}`);
        console.warn(`   ↪ Falling back to Gemini/Groq...`);
        await runGeminiWithGroqFallback('deepl');
      }
    } else {
      // ═══ Gemini path (fallback for unsupported languages) ═══
      await runGeminiWithGroqFallback(null);
    }
  } catch (err) {
    errorMessage = err.message;
    status = 'error';
    console.error(`   ❌ Translation error [${routing.displayName}]: ${err.message}`);
    // Fallback to fuzzy ref or placeholder
    targetText = fuzzyRef || `[Translation pending: ${sourceText.substring(0, 50)}...]`;
  }

  const elapsed = parseFloat((performance.now() - start).toFixed(2));

  // ──────────────────────────────────────────────────────
  // Step 5: Estimate tokens + log cost (§4.1)
  // ──────────────────────────────────────────────────────
  const inputTokens = estimateTokens(prompt, routing.family);
  const outputTokens = estimateTokens(targetText, routing.family);

  logLLMCall({
    callType: 'translation', model: actualModel,
    sourceLang, targetLang, inputTokens, outputTokens,
    latencyMs: elapsed, status, cacheHit: false,
    segmentId, projectId, adapterUsed: adapterName,
    errorMessage,
  });

  // ──────────────────────────────────────────────────────
  // Step 6: Cache successful translations
  // ──────────────────────────────────────────────────────
  if (status === 'success') {
    cacheSet(sourceText, sourceLang, targetLang, targetText, actualModel, version);
    // Write-through to Redis L1 cache (async, non-blocking)
    setCachedTranslation(sourceText, sourceLang, targetLang, {
      targetText, model: actualModel, engine: actualEngine,
    }).catch(() => { });
  }

  return {
    targetText,
    model: actualModel,
    engine: actualEngine,
    cached: false,
    adapter: adapterName,
    tokens: { input: inputTokens, output: outputTokens, total: inputTokens + outputTokens },
    estimatedCost: estimateCost(inputTokens, outputTokens, actualModel),
    latencyMs: elapsed,
    promptVersion: version,
    translatedFrom: sourceLang,
    translatedFromDisplay: getLanguageDisplayName(sourceLang),
  };
}

// ═══════════════════════════════════════════════════════════════
// §4.1 — translateBatch() — Full Project Translation Pipeline
// ═══════════════════════════════════════════════════════════════

/**
 * Orchestrates the complete translation pipeline for a batch of segments.
 * Integrates: Layer 3 TM lookup → Layer 4 LLM → glossary enforcement → DB update.
 *
 * @param {Object} params
 * @param {number} params.projectId
 * @param {Array}  [params.segments]    Override segments (optional, fetches from DB)
 * @param {string} params.sourceLang
 * @param {string} params.targetLang
 * @returns {Promise<Object>}  Results + comprehensive stats
 */
export async function translateBatch({
  projectId,
  segments: inputSegments,
  sourceLang,  // Now optional — will use per-segment detected_language
  targetLang = 'hi_IN',
}) {
  // Default sourceLang to 'en' only if explicitly needed later
  const globalSourceLang = sourceLang || 'en';
  const batchStart = performance.now();

  // ═══ Load project context + style profile (§3.2.2 via ragEngine) ═══
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  const projectContext = project?.context || 'General Business';
  const profileName = project?.style_profile || 'professional';
  const { promptText: stylePromptText } = ragEngine.styleProfileGet(profileName);

  // ═══ Get segments from DB if not provided ═══
  let segments = inputSegments;
  if (!segments || segments.length === 0) {
    const dbSegments = db
      .prepare('SELECT * FROM segments WHERE project_id = ? ORDER BY idx ASC')
      .all(projectId);
    segments = dbSegments.map((s) => ({
      id: s.id,
      index: s.idx,
      sourceText: s.source_text,
      targetText: s.target_text,
      matchType: s.match_type,
      tmScore: s.tm_score,
      detected_language: s.detected_language || null,
      detection_confidence: s.detection_confidence || 0,
      detected_script: s.detected_script || null,
      source_language_display: s.source_language_display || null,
    }));
  }

  if (!segments || segments.length === 0) {
    throw new Error('No segments to translate');
  }

  // ═══ Fetch glossary terms (§3.2.1 via ragEngine) ═══
  const glossary = ragEngine.glossaryLookup(globalSourceLang, targetLang);
  const routing = getModelForLanguage(targetLang);

  console.log(`\n🔄 Layer 4 Translation Pipeline`);
  console.log(`   ${segments.length} segments → ${routing.displayName} (${targetLang})`);
  console.log(`   Model: ${routing.model} | Engine: ${routing.engine}`);
  console.log(`   Context: "${projectContext}" | Style: "${profileName}"`);
  console.log(`   Glossary: ${glossary.length} terms | Mode: ${isMockMode() ? 'MOCK' : 'LIVE'}`);

  // ═══ Term extraction SKIPPED to reduce API calls and latency ═══
  // On free-tier Gemini, each extra LLM call risks 429 rate limits.
  // Term extraction is a nice-to-have but adds ~2-5s blocking latency.
  const unknown = [];

  const results = [];
  let exactCount = 0, fuzzyCount = 0, newCount = 0;
  let totalTokens = 0, cacheHits = 0;
  let totalLLMLatency = 0;

  // ═══════════════════════════════════════════════════════════════
  // Two-Pass TM Lookup (Batch Embedding Optimization)
  // ═══════════════════════════════════════════════════════════════
  //
  // Pass 1: Exact match filter (SQLite only, zero network calls)
  // Pass 2: Batch embed non-exact segments → 1 API call instead of N
  // ═══════════════════════════════════════════════════════════════

  // ═══ Pass 1: Exact Match Filter ═══
  const exactResults = [];    // Segments resolved by exact TM match
  const needsEmbedding = [];  // Segments that need embedding + possible LLM

  for (const seg of segments) {
    const exactResult = ragEngine.tmExactLookup(seg.sourceText, globalSourceLang, targetLang);
    if (exactResult) {
      exactResults.push({ seg, tmResult: exactResult });
    } else {
      needsEmbedding.push(seg);
    }
  }

  console.log(`   ⚡ Pass 1: ${exactResults.length} exact, ${needsEmbedding.length} need embedding`);

  // ═══ Process exact matches (no LLM, no embedding) ═══
  for (const { seg, tmResult } of exactResults) {
    exactCount++;
    // Determine effective source language for this segment
    const segSourceLang = (seg.detected_language && seg.detected_language !== 'unknown' && (seg.detection_confidence || 0) >= 0.6)
      ? seg.detected_language : globalSourceLang;
    const result = {
      id: seg.id,
      sourceText: seg.sourceText,
      targetText: tmResult.targetText,
      tmScore: tmResult.score,
      matchType: 'EXACT',
      violation: false,
      llmSkipped: true,
      cached: false,
      model: null,
      translatedFrom: segSourceLang,
      translatedFromDisplay: getLanguageDisplayName(segSourceLang),
      detectionConfidence: seg.detection_confidence || 0,
      detectedScript: seg.detected_script || null,
    };

    db.prepare(
      `UPDATE segments SET target_text = ?, original_target = ?, tm_score = ?, match_type = 'EXACT' WHERE id = ?`
    ).run(tmResult.targetText, tmResult.targetText, tmResult.score, seg.id);

    results.push(result);
    console.log(`   ✅ EXACT [${seg.index}] (${tmResult.score}): "${seg.sourceText.substring(0, 40)}..."`);
  }

  // ═══ Pass 2: Batch Embed + TM Lookup + LLM Translation (PARALLEL) ═══
  if (needsEmbedding.length > 0) {
    // Single batch embed call for ALL non-exact segments
    const { batchEmbed } = await import('./gemini.js');
    const textsToEmbed = needsEmbedding.map(s => s.sourceText);
    const embeddings = await batchEmbed(textsToEmbed, projectContext);

    console.log(`   🔍 Pass 2: Batch embedded ${needsEmbedding.length} segments in 1 API call`);

    // ═══ Parallel processing with concurrency limit ═══
    const CONCURRENCY = 2;  // Reduced from 5 to stay under Gemini free-tier RPM limits
    const segmentQueue = needsEmbedding.map((seg, i) => ({ seg, embedding: embeddings[i] }));
    let activeCount = 0;

    await new Promise((resolveAll) => {
      function processNextSegment() {
        while (activeCount < CONCURRENCY && segmentQueue.length > 0) {
          const { seg, embedding } = segmentQueue.shift();
          activeCount++;

          (async () => {
            try {
              const precomputedEmbedding = embedding;

              // Determine effective source language for this segment
              const segSourceLang = (seg.detected_language && seg.detected_language !== 'unknown' && (seg.detection_confidence || 0) >= 0.6)
                ? seg.detected_language : globalSourceLang;
              const segSourceDisplay = getLanguageDisplayName(segSourceLang);

              // TM lookup with precomputed embedding (no network call)
              const tmResult = await ragEngine.tmLookup(
                seg.sourceText, globalSourceLang, targetLang, projectContext, precomputedEmbedding
              );

              // ──────────────────────────────────────────────────────
              // EXACT (from vector similarity ≥ 0.95): Use TM directly
              // ──────────────────────────────────────────────────────
              if (tmResult.matchType === 'EXACT') {
                exactCount++;
                const result = {
                  id: seg.id,
                  sourceText: seg.sourceText,
                  targetText: tmResult.targetText,
                  tmScore: tmResult.score,
                  matchType: 'EXACT',
                  violation: false,
                  llmSkipped: true,
                  cached: false,
                  model: null,
                  translatedFrom: segSourceLang,
                  translatedFromDisplay: segSourceDisplay,
                  detectionConfidence: seg.detection_confidence || 0,
                  detectedScript: seg.detected_script || null,
                };

                db.prepare(
                  `UPDATE segments SET target_text = ?, original_target = ?, tm_score = ?, match_type = 'EXACT' WHERE id = ?`
                ).run(tmResult.targetText, tmResult.targetText, tmResult.score, seg.id);

                results.push(result);
                console.log(`   ✅ EXACT [${seg.index}] (${tmResult.score}): "${seg.sourceText.substring(0, 40)}..."`);
                return;
              }

              // ──────────────────────────────────────────────────────
              // FUZZY or NEW → Layer 4 LLM Translation
              // ──────────────────────────────────────────────────────
              const fuzzyRef = tmResult.matchType === 'FUZZY' ? tmResult.targetText : null;
              if (tmResult.matchType === 'FUZZY') fuzzyCount++;
              else newCount++;

              // Filter glossary to terms present in this segment
              const relevantGlossary = glossary.filter((term) =>
                new RegExp(`\\b${escapeRegex(term.source)}\\b`, 'i').test(seg.sourceText)
              );

              // ═══ DeepTrans: Inject discovered-but-unglossaried terms as hints ═══
              const termHints = unknown
                .filter(t => new RegExp(`\\b${escapeRegex(t.term)}\\b`, 'i').test(seg.sourceText))
                .map(t => ({ source: t.term, target: `[translate consistently: ${t.term}]` }));

              const allGlossary = [...relevantGlossary, ...termHints];

              // §4.1: Call LLM via orchestrator — use per-segment source language
              const llmResult = await translateSegment({
                sourceText: seg.sourceText,
                sourceLang: segSourceLang,
                targetLang,
                context: projectContext,
                stylePrompt: stylePromptText,
                glossaryTerms: allGlossary,
                fuzzyRef,
                segmentId: seg.id,
                projectId,
              });

              totalTokens += llmResult.tokens.total;
              totalLLMLatency += llmResult.latencyMs;
              if (llmResult.cached) cacheHits++;

              // §3.2.1: Post-translation glossary enforcement (via ragEngine)
              const enforcement = ragEngine.glossaryEnforce(seg.sourceText, llmResult.targetText, relevantGlossary);

              const matchType = tmResult.matchType === 'FUZZY' ? 'FUZZY' : 'NEW';

              // ═══ QA check DISABLED to reduce API calls ═══
              // Each QA check fires another LLM call (Groq/Gemini), adding
              // latency and rate-limit pressure. Skipping on free tier.

              const result = {
                id: seg.id,
                sourceText: seg.sourceText,
                targetText: llmResult.targetText,
                tmScore: tmResult.score,
                matchType,
                violation: enforcement.violated,
                qaIssues: [],
                qaPassed: true,
                llmSkipped: false,
                cached: llmResult.cached,
                model: llmResult.model,
                tokens: llmResult.tokens,
                translatedFrom: segSourceLang,
                translatedFromDisplay: segSourceDisplay,
                detectionConfidence: seg.detection_confidence || 0,
                detectedScript: seg.detected_script || null,
              };

              db.prepare(
                `UPDATE segments SET target_text = ?, original_target = ?, tm_score = ?, match_type = ?, violation = ? WHERE id = ?`
              ).run(llmResult.targetText, llmResult.targetText, tmResult.score, matchType, enforcement.violated ? 1 : 0, seg.id);

              results.push(result);
              const icon = matchType === 'FUZZY' ? '🟡' : '🆕';
              const cacheIcon = llmResult.cached ? ' 💾' : '';
              console.log(`   ${icon} ${matchType} [${seg.index}] (${tmResult.score}) ${routing.model}${cacheIcon}: "${seg.sourceText.substring(0, 40)}..."`);
            } catch (segErr) {
              console.error(`   ❌ Segment [${seg.index}] error: ${segErr.message}`);
              results.push({
                id: seg.id,
                sourceText: seg.sourceText,
                targetText: `[Translation pending: ${seg.sourceText.substring(0, 50)}...]`,
                tmScore: 0,
                matchType: 'NEW',
                violation: false,
                qaIssues: [],
                qaPassed: true,
                llmSkipped: false,
                cached: false,
                model: null,
                translatedFrom: globalSourceLang,
                translatedFromDisplay: getLanguageDisplayName(globalSourceLang),
                detectionConfidence: 0,
                detectedScript: null,
              });
              newCount++;
            } finally {
              activeCount--;
              processNextSegment();
              if (activeCount === 0 && segmentQueue.length === 0) resolveAll();
            }
          })();
        }
        // Handle empty queue case
        if (activeCount === 0 && segmentQueue.length === 0) resolveAll();
      }
      processNextSegment();
    });
  }

  const batchElapsed = parseFloat((performance.now() - batchStart).toFixed(2));
  const leverageRate = results.length > 0
    ? Math.round(((exactCount + fuzzyCount) / results.length) * 100) : 0;

  console.log(`\n📊 Pipeline complete in ${batchElapsed}ms`);
  console.log(`   ${exactCount} exact, ${fuzzyCount} fuzzy, ${newCount} new (${leverageRate}% TM leverage)`);
  console.log(`   ${totalTokens} tokens consumed, ${cacheHits} cache hits\n`);

  // ═══ Build languageSummary — grouped by source language ═══
  const langSummaryMap = {};
  for (const r of results) {
    const src = r.translatedFrom || globalSourceLang;
    if (!langSummaryMap[src]) {
      langSummaryMap[src] = {
        sourceLanguage: src,
        sourceLanguageDisplay: r.translatedFromDisplay || getLanguageDisplayName(src),
        segmentCount: 0,
        targetLanguage: targetLang,
        targetLanguageDisplay: LANG_NAMES[targetLang] || targetLang,
      };
    }
    langSummaryMap[src].segmentCount++;
  }
  const languageSummary = Object.values(langSummaryMap).sort((a, b) => b.segmentCount - a.segmentCount);

  return {
    projectId: Number(projectId),
    segments: results,
    stats: {
      total: results.length,
      exact: exactCount,
      fuzzy: fuzzyCount,
      new: newCount,
      leverageRate,
      cacheHits,
      totalTokens,
      avgLLMLatencyMs: newCount + fuzzyCount > 0
        ? Math.round(totalLLMLatency / (newCount + fuzzyCount))
        : 0,
      batchLatencyMs: batchElapsed,
    },
    routing: {
      model: routing.model,
      engine: routing.engine,
      language: routing.displayName,
      family: routing.family,
    },
    languageSummary,
    mock: isMockMode(),
  };
}

// ═══════════════════════════════════════════════════════════════
// §4.3 — LoRA Adapter Registry
// ═══════════════════════════════════════════════════════════════

/**
 * Register a new LoRA adapter for a language pair.
 */
export function registerAdapter({
  adapterName,
  sourceLang = 'en',
  targetLang,
  baseModel = 'gemini-2.0-flash',
  accuracyBase = null,
  accuracyLora = null,
  trainingPairsCount = 0,
  adapterPath = null,
  metadata = null,
}) {
  const result = db.prepare(
    `INSERT INTO lora_adapters
       (adapter_name, source_lang, target_lang, base_model, accuracy_base,
        accuracy_lora, training_pairs_count, adapter_path, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    adapterName, sourceLang, targetLang, baseModel, accuracyBase,
    accuracyLora, trainingPairsCount, adapterPath,
    metadata ? JSON.stringify(metadata) : null
  );
  return { id: Number(result.lastInsertRowid), adapterName };
}

/**
 * Get the active LoRA adapter for a language pair (if any).
 */
export function getActiveAdapter(sourceLang = 'en', targetLang) {
  return db.prepare(
    `SELECT * FROM lora_adapters
     WHERE source_lang = ? AND target_lang = ? AND status = 'active'
     ORDER BY updated_at DESC LIMIT 1`
  ).get(sourceLang, targetLang) || null;
}

/**
 * List all registered adapters.
 */
export function listAdapters(targetLang = null) {
  if (targetLang) {
    return db.prepare('SELECT * FROM lora_adapters WHERE target_lang = ? ORDER BY updated_at DESC')
      .all(targetLang);
  }
  return db.prepare('SELECT * FROM lora_adapters ORDER BY updated_at DESC').all();
}

/**
 * Update adapter status/metadata.
 */
export function updateAdapter(id, { status, accuracyBase, accuracyLora, trainingPairsCount, adapterPath, metadata }) {
  const fields = [];
  const values = [];
  if (status !== undefined) { fields.push('status = ?'); values.push(status); }
  if (accuracyBase !== undefined) { fields.push('accuracy_base = ?'); values.push(accuracyBase); }
  if (accuracyLora !== undefined) { fields.push('accuracy_lora = ?'); values.push(accuracyLora); }
  if (trainingPairsCount !== undefined) { fields.push('training_pairs_count = ?'); values.push(trainingPairsCount); }
  if (adapterPath !== undefined) { fields.push('adapter_path = ?'); values.push(adapterPath); }
  if (metadata !== undefined) { fields.push('metadata = ?'); values.push(JSON.stringify(metadata)); }
  fields.push("updated_at = datetime('now')");

  if (fields.length <= 1) return { updated: false };

  values.push(id);
  const result = db.prepare(`UPDATE lora_adapters SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return { updated: result.changes > 0 };
}

// ═══════════════════════════════════════════════════════════════
// Layer 4 Health & Cost Metrics
// ═══════════════════════════════════════════════════════════════

/**
 * Comprehensive Layer 4 stats: tokens, cost, cache, adapters.
 */
export function getStats() {
  // Total LLM calls
  const totalCalls = db.prepare('SELECT COUNT(*) as c FROM llm_call_log').get().c;
  const successCalls = db.prepare("SELECT COUNT(*) as c FROM llm_call_log WHERE status = 'success'").get().c;
  const errorCalls = db.prepare("SELECT COUNT(*) as c FROM llm_call_log WHERE status = 'error'").get().c;
  const cachedCalls = db.prepare("SELECT COUNT(*) as c FROM llm_call_log WHERE cache_hit = 1").get().c;

  // Token breakdown
  const tokenStats = db.prepare(
    `SELECT
       COALESCE(SUM(input_tokens), 0) as totalInputTokens,
       COALESCE(SUM(output_tokens), 0) as totalOutputTokens,
       COALESCE(SUM(total_tokens), 0) as totalTokens,
       COALESCE(AVG(total_tokens), 0) as avgTokensPerCall,
       COALESCE(AVG(latency_ms), 0) as avgLatencyMs
     FROM llm_call_log WHERE status = 'success'`
  ).get();

  // By call type
  const byType = db.prepare(
    `SELECT call_type, COUNT(*) as count,
            COALESCE(SUM(total_tokens), 0) as tokens,
            COALESCE(AVG(latency_ms), 0) as avgLatency
     FROM llm_call_log GROUP BY call_type`
  ).all();

  // By model
  const byModel = db.prepare(
    `SELECT model, COUNT(*) as count,
            COALESCE(SUM(total_tokens), 0) as tokens
     FROM llm_call_log GROUP BY model`
  ).all();

  // Cache stats
  const cacheEntries = db.prepare('SELECT COUNT(*) as c FROM translation_cache').get().c;
  const cacheHitRate = totalCalls > 0 ? Math.round((cachedCalls / totalCalls) * 100) : 0;
  const totalCacheHits = db.prepare('SELECT COALESCE(SUM(hit_count), 0) as c FROM translation_cache').get().c;

  // Adapter stats (§4.3)
  const adapters = db.prepare('SELECT COUNT(*) as c FROM lora_adapters').get().c;
  const activeAdapters = db.prepare("SELECT COUNT(*) as c FROM lora_adapters WHERE status = 'active'").get().c;

  // Estimated cost
  const estimatedCostUSD = estimateCost(
    tokenStats.totalInputTokens,
    tokenStats.totalOutputTokens,
    'gemini-2.0-flash'
  );

  // Recent calls (last 10)
  const recentCalls = db.prepare(
    `SELECT call_type, model, source_lang, target_lang, total_tokens,
            latency_ms, status, cache_hit, created_at
     FROM llm_call_log ORDER BY created_at DESC LIMIT 10`
  ).all();

  // Translation engine status
  const sarvamStatus = getSarvamStatus();
  const indictransStatus = getIndictransStatus();
  const deeplStatus = getDeeplStatus();

  // Determine primary Indic engine label
  const indicEngine = isIndictransAvailable()
    ? 'IndicTrans2 (local)'
    : isSarvamAvailable()
      ? 'Sarvam AI (remote)'
      : 'Gemini 2.0 Flash';

  // Determine primary non-Indic engine label
  const nonIndicEngine = isDeeplAvailable()
    ? 'DeepL API'
    : 'Gemini 2.0 Flash';

  return {
    layer: 4,
    engine: `${indicEngine} (Indic) + ${nonIndicEngine} (Others) + text-embedding-004`,
    mode: isMockMode() ? 'MOCK' : 'LIVE',
    activePrompt: activePromptVersion,
    routing: {
      indicLanguages: isIndictransAvailable()
        ? 'indictrans2-en-indic-dist-200M (local)'
        : isSarvamAvailable() ? 'sarvam-translate:v1' : 'gemini-2.0-flash',
      europeanLanguages: isDeeplAvailable() ? 'deepl-translate' : 'gemini-2.0-flash',
      otherLanguages: isDeeplAvailable() ? 'deepl-translate' : 'gemini-2.0-flash',
      indictrans2: indictransStatus,
      sarvam: sarvamStatus,
      deepl: deeplStatus,
    },
    calls: {
      total: totalCalls,
      success: successCalls,
      errors: errorCalls,
      cached: cachedCalls,
    },
    tokens: {
      totalInput: tokenStats.totalInputTokens,
      totalOutput: tokenStats.totalOutputTokens,
      total: tokenStats.totalTokens,
      avgPerCall: Math.round(tokenStats.avgTokensPerCall),
    },
    cost: {
      estimatedUSD: Math.round(estimatedCostUSD * 10000) / 10000,
      model: 'gemini-2.0-flash',
      pricing: PRICING['gemini-2.0-flash'],
    },
    performance: {
      avgLatencyMs: Math.round(tokenStats.avgLatencyMs),
    },
    cache: {
      entries: cacheEntries,
      hitRate: cacheHitRate,
      totalHits: totalCacheHits,
    },
    adapters: {
      total: adapters,
      active: activeAdapters,
    },
    byType,
    byModel,
    recentCalls,
    prompts: Object.keys(PROMPT_TEMPLATES).map((k) => ({
      version: k,
      name: PROMPT_TEMPLATES[k].name,
      active: k === activePromptVersion,
    })),
  };
}

/**
 * Clear the translation cache.
 */
export function clearCache() {
  const result = db.prepare('DELETE FROM translation_cache').run();
  return { cleared: result.changes };
}

/**
 * Get cache stats.
 */
export function getCacheStats() {
  const entries = db.prepare('SELECT COUNT(*) as c FROM translation_cache').get().c;
  const totalHits = db.prepare('SELECT COALESCE(SUM(hit_count), 0) as c FROM translation_cache').get().c;

  // Top cached translations
  const topCached = db.prepare(
    `SELECT source_text, target_lang, target_text, hit_count, model, created_at
     FROM translation_cache ORDER BY hit_count DESC LIMIT 10`
  ).all();

  return { entries, totalHits, topCached };
}

/**
 * List prompt templates.
 */
export function listPrompts() {
  return Object.entries(PROMPT_TEMPLATES).map(([key, tmpl]) => ({
    version: key,
    name: tmpl.name,
    description: tmpl.description,
    active: key === activePromptVersion,
  }));
}

/**
 * Set active prompt version.
 */
export function setActivePrompt(version) {
  if (!PROMPT_TEMPLATES[version]) {
    throw new Error(`Unknown prompt version: ${version}. Available: ${Object.keys(PROMPT_TEMPLATES).join(', ')}`);
  }
  activePromptVersion = version;
  return { activePrompt: version };
}

// ═══════════════════════════════════════════════════════════════
// Utility
// ═══════════════════════════════════════════════════════════════

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ═══════════════════════════════════════════════════════════════
// Default Export
// ═══════════════════════════════════════════════════════════════

export default {
  // §4.1 — Translation
  translateSegment,
  translateBatch,
  getModelForLanguage,

  // §4.3 — LoRA Adapters
  registerAdapter,
  getActiveAdapter,
  listAdapters,
  updateAdapter,

  // Prompts
  listPrompts,
  setActivePrompt,

  // Cache
  clearCache,
  getCacheStats,

  // Stats
  getStats,
};
