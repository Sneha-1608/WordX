// ═══════════════════════════════════════════════════════════════
// IndicTrans2 Client — Local Neural Machine Translation
// ═══════════════════════════════════════════════════════════════
//
// Connects to the IndicTrans2 Python microservice for local,
// open-source, CUDA-accelerated Indian language translation.
//
// Models:
//   - ai4bharat/indictrans2-en-indic-dist-200M  (English → Indic)
//   - ai4bharat/indictrans2-indic-en-1B          (Indic → English)
// Based on: IndicTransToolkit by AI4Bharat
//
// Priority in the multi-model routing chain:
//   1. IndicTrans2 (local, free, no API key, RTX 4070)
//   2. Sarvam AI   (remote, paid)
//   3. Gemini       (remote, fallback)
//
// ═══════════════════════════════════════════════════════════════

import 'dotenv/config';

const INDICTRANS_URL = process.env.INDICTRANS_URL || 'http://localhost:5400';

// ═══════════════════════════════════════════════════════════════
// Supported Language Codes
// ═══════════════════════════════════════════════════════════════

const INDICTRANS_SUPPORTED = new Set([
  'hi_IN', 'bn_IN', 'ta_IN', 'te_IN', 'mr_IN', 'gu_IN', 'kn_IN',
  'ml_IN', 'pa_IN', 'or_IN', 'as_IN', 'ur_PK', 'ne_NP', 'sa_IN',
  'mai_IN', 'kok_IN', 'doi_IN', 'sd_IN', 'ks_IN', 'mni_IN',
  'brx_IN', 'sat_IN', 'si_LK',
]);

const LANG_NAMES = {
  hi_IN: 'Hindi', bn_IN: 'Bengali', ta_IN: 'Tamil', te_IN: 'Telugu',
  mr_IN: 'Marathi', gu_IN: 'Gujarati', kn_IN: 'Kannada', ml_IN: 'Malayalam',
  pa_IN: 'Punjabi', or_IN: 'Odia', as_IN: 'Assamese', ur_PK: 'Urdu',
  ne_NP: 'Nepali', sa_IN: 'Sanskrit', mai_IN: 'Maithili', kok_IN: 'Konkani',
  doi_IN: 'Dogri', sd_IN: 'Sindhi', ks_IN: 'Kashmiri', mni_IN: 'Manipuri',
  brx_IN: 'Bodo', sat_IN: 'Santali', si_LK: 'Sinhala',
};

// ═══════════════════════════════════════════════════════════════
// Health Check State
// ═══════════════════════════════════════════════════════════════

let _available = false;
let _lastHealthCheck = 0;
let _healthData = null;
const HEALTH_CHECK_INTERVAL_MS = 30_000; // Re-check every 30s

/**
 * Check if the IndicTrans2 microservice is available.
 * Caches the result for 30 seconds to avoid hammering the service.
 * @returns {boolean}
 */
export function isIndictransAvailable() {
  return _available;
}

/**
 * Check if a ClearLingo language code is supported by IndicTrans2.
 * @param {string} langCode ClearLingo format (e.g. 'hi_IN')
 * @returns {boolean}
 */
export function isIndictransSupported(langCode) {
  return INDICTRANS_SUPPORTED.has(langCode);
}

/**
 * Probe the IndicTrans2 microservice health endpoint.
 * Updates the internal availability flag.
 * @returns {Promise<Object|null>} Health data or null if unreachable
 */
export async function checkIndictransHealth() {
  const now = Date.now();
  if (now - _lastHealthCheck < HEALTH_CHECK_INTERVAL_MS && _healthData) {
    return _healthData;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const res = await fetch(`${INDICTRANS_URL}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.ok) {
      _healthData = await res.json();
      _available = _healthData.status === 'ready';
      _lastHealthCheck = now;
      return _healthData;
    }
  } catch {
    _available = false;
    _healthData = null;
  }

  _lastHealthCheck = now;
  return null;
}

// ═══════════════════════════════════════════════════════════════
// Translation Functions
// ═══════════════════════════════════════════════════════════════

/**
 * Translate a single text using IndicTrans2 local model.
 *
 * @param {string} sourceText   The text to translate
 * @param {string} sourceLang   ClearLingo source language code (e.g. 'en')
 * @param {string} targetLang   ClearLingo target language code (e.g. 'hi_IN')
 * @param {Object} [options]
 * @param {number} [options.timeoutMs=15000]  Request timeout
 * @returns {Promise<{text: string, model: string, engine: string, latencyMs: number}>}
 */
export async function indictransTranslate(sourceText, sourceLang, targetLang, options = {}) {
  const { timeoutMs = 15000 } = options;

  if (!_available) {
    throw new Error('IndicTrans2 microservice not available');
  }

  if (!isIndictransSupported(targetLang) && targetLang !== 'en') {
    throw new Error(`IndicTrans2: Unsupported target language: ${targetLang}`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const start = performance.now();

    const res = await fetch(`${INDICTRANS_URL}/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: sourceText,
        src_lang: sourceLang,
        tgt_lang: targetLang,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(err.error || `IndicTrans2 API ${res.status}`);
    }

    const data = await res.json();
    const elapsed = Math.round(performance.now() - start);

    let cleanText = (data.translated_text || '').trim();
    // Strip wrapping quotes if present
    if (
      (cleanText.startsWith('"') && cleanText.endsWith('"')) ||
      (cleanText.startsWith("'") && cleanText.endsWith("'"))
    ) {
      cleanText = cleanText.slice(1, -1);
    }

    console.log(
      `   🧠 IndicTrans2 [${LANG_NAMES[targetLang] || targetLang}] ${elapsed}ms: "${sourceText.substring(0, 40)}..." → "${cleanText.substring(0, 40)}..."`
    );

    return {
      text: cleanText,
      model: data.model || 'indictrans2-en-indic-dist-200M',
      engine: 'indictrans2',
      latencyMs: elapsed,
      device: data.device || 'cpu',
    };
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      throw new Error(`IndicTrans2 request timed out (${timeoutMs}ms)`);
    }
    throw err;
  }
}

/**
 * Batch translate multiple texts using IndicTrans2.
 *
 * @param {string[]} texts  Array of texts to translate
 * @param {string} sourceLang
 * @param {string} targetLang
 * @param {Object} [options]
 * @returns {Promise<Array<{text: string, model: string, engine: string}>>}
 */
export async function indictransBatchTranslate(texts, sourceLang, targetLang, options = {}) {
  const { timeoutMs = 60000 } = options;

  if (!_available) {
    throw new Error('IndicTrans2 microservice not available');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const start = performance.now();

    const res = await fetch(`${INDICTRANS_URL}/translate/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        texts,
        src_lang: sourceLang,
        tgt_lang: targetLang,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(err.error || `IndicTrans2 batch API ${res.status}`);
    }

    const data = await res.json();
    const elapsed = Math.round(performance.now() - start);

    console.log(
      `   🧠 IndicTrans2 batch [${LANG_NAMES[targetLang] || targetLang}] ${texts.length} texts in ${elapsed}ms`
    );

    return (data.translations || []).map((t) => ({
      text: t.trim(),
      model: data.model || 'indictrans2-en-indic-dist-200M',
      engine: 'indictrans2',
      latencyMs: elapsed,
    }));
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      throw new Error(`IndicTrans2 batch request timed out (${timeoutMs}ms)`);
    }
    throw err;
  }
}

/**
 * Get IndicTrans2 service status info.
 * @returns {Object}
 */
export function getIndictransStatus() {
  return {
    available: _available,
    endpoint: INDICTRANS_URL,
    models: _healthData?.models || {
      en_to_indic: 'ai4bharat/indictrans2-en-indic-dist-200M',
      indic_to_en: 'ai4bharat/indictrans2-indic-en-1B',
    },
    device: _healthData?.device || 'unknown',
    directions: ['en→indic', 'indic→en'],
    supportedLanguages: Array.from(INDICTRANS_SUPPORTED),
    languageCount: INDICTRANS_SUPPORTED.size,
    features: [
      'Bidirectional: EN↔Indic (22 languages)',
      'Local model — no API key needed',
      'Open-source (AI4Bharat)',
      'CUDA RTX 4070 accelerated',
      'Batch translation support',
    ],
  };
}

// ═══════════════════════════════════════════════════════════════
// Startup Health Probe (non-blocking)
// ═══════════════════════════════════════════════════════════════

// Try to connect on import — non-blocking
checkIndictransHealth().then((data) => {
  if (data) {
    console.log(`[IndicTrans2] ✅ Connected — device: ${data.device}, directions: en↔indic, languages: ${data.languageCount}`);
  } else {
    console.log(`[IndicTrans2] ⚪ Not available (start with: python scripts/indictrans_server.py)`);
  }
}).catch(() => {
  console.log('[IndicTrans2] ⚪ Microservice not running');
});

export default {
  indictransTranslate,
  indictransBatchTranslate,
  isIndictransAvailable,
  isIndictransSupported,
  checkIndictransHealth,
  getIndictransStatus,
};
