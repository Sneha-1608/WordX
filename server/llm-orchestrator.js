// ═══════════════════════════════════════════════════════════════
// Layer 4: LLM Orchestration Engine
// ═══════════════════════════════════════════════════════════════
//
// Centralizes ALL LLM interactions for ClearLingo.
// Implements the Layer 4 spec: Gemini + LoRA + Multi-Model.
//
// Sub-components:
//   §4.1  Gemini 1.5 Flash   — Translation + Validation
//   §4.2  text-embedding-004 — 768-dim semantic embeddings
//   §4.3  LoRA Adapters      — Per-language fine-tuning registry
//
// Only invoked for segments classified as "NEW" (score < 0.75)
// by Layer 3. Exact and fuzzy matches skip the LLM entirely.
//
// ═══════════════════════════════════════════════════════════════

import db from './db.js';
import ragEngine from './rag-engine.js';
import {
  translateText,
  validateWithGemini,
  isMockMode,
} from './gemini.js';
import { qaCheckTranslationLlama as qaCheckTranslation } from './llama3.js';
import {
  sarvamTranslate,
  isSarvamAvailable,
  isSarvamSupported,
  getSarvamStatus,
} from './sarvam.js';
import { rateLimiter } from './middleware.js';
import { extractTerms, crossReferenceGlossary } from './term-extractor.js';
import { getCachedTranslation, setCachedTranslation } from './cache-redis.js';

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
  'fr_FR', 'de_DE', 'es_ES', 'pt_BR', 'it_IT', 'nl_NL',
  'ru_RU', 'pl_PL', 'sv_SE', 'tr_TR',
  'ja_JP', 'ko_KR', 'zh_CN',
  'ar_SA', 'th_TH', 'vi_VN',
]);

// Language display names for logging
const LANG_NAMES = {
  en: 'English',
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
 * INDIC languages → Sarvam AI (sarvam-translate:v1) when available
 * European / Other  → Gemini 1.5 Flash
 * Fallback: Gemini 1.5 Flash for ALL languages if Sarvam is unavailable
 *
 * @param {string} targetLang
 * @returns {{ model: string, engine: string, family: string }}
 */
export function getModelForLanguage(targetLang) {
  const family = INDIC_LANGS.has(targetLang) ? 'indic'
    : EUROPEAN_LANGS.has(targetLang) ? 'european'
    : 'other';

  // Route Indic languages through Sarvam AI when available
  if (family === 'indic' && isSarvamAvailable() && isSarvamSupported(targetLang)) {
    return {
      model: 'sarvam-translate:v1',
      engine: 'sarvam',
      family,
      displayName: LANG_NAMES[targetLang] || targetLang,
    };
  }

  // European + other + Sarvam-unsupported → Gemini
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
  'text-embedding-005': { input: 0.00, output: 0.00 },  // Free in free tier
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
  } catch {}

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
  //   Sarvam AI for Indic languages, Gemini for others.
  //   If Sarvam fails → automatic fallback to Gemini.
  // ──────────────────────────────────────────────────────
  let targetText;
  let errorMessage = null;
  let status = 'success';
  let actualEngine = routing.engine;
  let actualModel = routing.model;

  try {
    if (routing.engine === 'sarvam') {
      // ═══ Sarvam AI path (Indic languages) ═══
      try {
        const sarvamResult = await sarvamTranslate(sourceText, sourceLang, targetLang, {
          mode: 'formal',
        });
        targetText = sarvamResult.text;
        actualEngine = 'sarvam';
        actualModel = sarvamResult.model;
      } catch (sarvamErr) {
        // Fallback to Gemini if Sarvam fails
        console.warn(`   ⚠ Sarvam failed for [${routing.displayName}]: ${sarvamErr.message}`);
        console.warn(`   ↪ Falling back to Gemini...`);
        targetText = await rateLimiter.execute(() =>
          translateText(
            sourceText, sourceLang, targetLang,
            glossaryTerms, fuzzyRef, stylePrompt
          )
        );
        actualEngine = 'gemini (fallback from sarvam)';
        actualModel = 'gemini-1.5-flash';
      }
    } else {
      // ═══ Gemini path (European + other languages) ═══
      targetText = await rateLimiter.execute(() =>
        translateText(
          sourceText, sourceLang, targetLang,
          glossaryTerms, fuzzyRef, stylePrompt
        )
      );
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
    }).catch(() => {});
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
  sourceLang = 'en',
  targetLang = 'hi_IN',
}) {
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
    }));
  }

  if (!segments || segments.length === 0) {
    throw new Error('No segments to translate');
  }

  // ═══ Fetch glossary terms (§3.2.1 via ragEngine) ═══
  const glossary = ragEngine.glossaryLookup(sourceLang, targetLang);
  const routing = getModelForLanguage(targetLang);

  console.log(`\n🔄 Layer 4 Translation Pipeline`);
  console.log(`   ${segments.length} segments → ${routing.displayName} (${targetLang})`);
  console.log(`   Model: ${routing.model} | Engine: ${routing.engine}`);
  console.log(`   Context: "${projectContext}" | Style: "${profileName}"`);
  console.log(`   Glossary: ${glossary.length} terms | Mode: ${isMockMode() ? 'MOCK' : 'LIVE'}`);

  // ═══ NEW (DeepTrans): Document-level term extraction ═══
  const fullSourceText = segments.map(s => s.sourceText).join('\n');
  const discoveredTerms = await extractTerms(fullSourceText, sourceLang);
  const { known, unknown } = crossReferenceGlossary(discoveredTerms, glossary);

  if (unknown.length > 0) {
    console.log(`   🔍 ${unknown.length} new terms discovered: ${unknown.map(t => `"${t.term}"`).join(', ')}`);
  }

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
    const exactResult = ragEngine.tmExactLookup(seg.sourceText, sourceLang, targetLang);
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
    };

    db.prepare(
      `UPDATE segments SET target_text = ?, original_target = ?, tm_score = ?, match_type = 'EXACT' WHERE id = ?`
    ).run(tmResult.targetText, tmResult.targetText, tmResult.score, seg.id);

    results.push(result);
    console.log(`   ✅ EXACT [${seg.index}] (${tmResult.score}): "${seg.sourceText.substring(0, 40)}..."`);
  }

  // ═══ Pass 2: Batch Embed + TM Lookup + LLM Translation ═══
  if (needsEmbedding.length > 0) {
    // Single batch embed call for ALL non-exact segments
    const { batchEmbed } = await import('./gemini.js');
    const textsToEmbed = needsEmbedding.map(s => s.sourceText);
    const embeddings = await batchEmbed(textsToEmbed, projectContext);

    console.log(`   🔍 Pass 2: Batch embedded ${needsEmbedding.length} segments in 1 API call`);

    for (let i = 0; i < needsEmbedding.length; i++) {
      const seg = needsEmbedding[i];
      const precomputedEmbedding = embeddings[i];

      // TM lookup with precomputed embedding (no network call)
      const tmResult = await ragEngine.tmLookup(
        seg.sourceText, sourceLang, targetLang, projectContext, precomputedEmbedding
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
        };

        db.prepare(
          `UPDATE segments SET target_text = ?, original_target = ?, tm_score = ?, match_type = 'EXACT' WHERE id = ?`
        ).run(tmResult.targetText, tmResult.targetText, tmResult.score, seg.id);

        results.push(result);
        console.log(`   ✅ EXACT [${seg.index}] (${tmResult.score}): "${seg.sourceText.substring(0, 40)}..."`);
        continue;
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

      // §4.1: Call LLM via orchestrator
      const llmResult = await translateSegment({
        sourceText: seg.sourceText,
        sourceLang,
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

      // ═══ DeepTrans: Post-translation QA audit ═══
      let qaIssues = [];
      let qaPassed = true;
      if (matchType === 'NEW') {
        try {
          const qa = await qaCheckTranslation(seg.sourceText, llmResult.targetText, targetLang);
          qaPassed = qa.passed;
          qaIssues = qa.issues || [];
          if (!qaPassed) {
            console.log(`   ⚠️ QA [${seg.index}]: ${qaIssues.join('; ')}`);
          }
        } catch (qaErr) {
          console.warn(`   ⚠ QA check failed: ${qaErr.message}`);
        }
      }

      const result = {
        id: seg.id,
        sourceText: seg.sourceText,
        targetText: llmResult.targetText,
        tmScore: tmResult.score,
        matchType,
        violation: enforcement.violated,
        qaIssues,
        qaPassed,
        llmSkipped: false,
        cached: llmResult.cached,
        model: llmResult.model,
        tokens: llmResult.tokens,
      };

      db.prepare(
        `UPDATE segments SET target_text = ?, original_target = ?, tm_score = ?, match_type = ?, violation = ? WHERE id = ?`
      ).run(llmResult.targetText, llmResult.targetText, tmResult.score, matchType, enforcement.violated ? 1 : 0, seg.id);

      // ═══ DeepTrans: Persist QA results ═══
      if (qaIssues.length > 0 || !qaPassed) {
        db.prepare(
          `INSERT INTO qa_results (segment_id, project_id, source_text, target_text, passed, issues)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run(seg.id, projectId, seg.sourceText, llmResult.targetText, qaPassed ? 1 : 0, JSON.stringify(qaIssues));
      }

      results.push(result);
      const icon = matchType === 'FUZZY' ? '🟡' : '🆕';
      const cacheIcon = llmResult.cached ? ' 💾' : '';
      console.log(`   ${icon} ${matchType} [${seg.index}] (${tmResult.score}) ${routing.model}${cacheIcon}: "${seg.sourceText.substring(0, 40)}..."`);
    }
  }

  const batchElapsed = parseFloat((performance.now() - batchStart).toFixed(2));
  const leverageRate = results.length > 0
    ? Math.round(((exactCount + fuzzyCount) / results.length) * 100) : 0;

  console.log(`\n📊 Pipeline complete in ${batchElapsed}ms`);
  console.log(`   ${exactCount} exact, ${fuzzyCount} fuzzy, ${newCount} new (${leverageRate}% TM leverage)`);
  console.log(`   ${totalTokens} tokens consumed, ${cacheHits} cache hits\n`);

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
  baseModel = 'gemini-1.5-flash',
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

  // Sarvam AI status
  const sarvamStatus = getSarvamStatus();

  return {
    layer: 4,
    engine: isSarvamAvailable()
      ? 'Sarvam AI (Indic) + Gemini 2.0 Flash (Others) + text-embedding-005'
      : 'Gemini 2.0 Flash + text-embedding-005',
    mode: isMockMode() ? 'MOCK' : 'LIVE',
    activePrompt: activePromptVersion,
    routing: {
      indicLanguages: isSarvamAvailable() ? 'sarvam-translate:v1' : 'gemini-2.0-flash',
      europeanLanguages: 'gemini-2.0-flash',
      otherLanguages: 'gemini-2.0-flash',
      sarvam: sarvamStatus,
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
