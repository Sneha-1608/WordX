// ═══════════════════════════════════════════════════════════════
// DeepL Translation Service
// ═══════════════════════════════════════════════════════════════
//
// Integrates DeepL's translation API for high-quality
// non-Indian language translation (European, CJK, etc.).
//
// DeepL is widely recognized for superior translation quality
// for European and Asian languages compared to generic LLMs.
//
// Routing: All non-Indian languages use DeepL as primary engine.
//          Indian languages continue to use Sarvam AI / IndicTrans2.
//
// ═══════════════════════════════════════════════════════════════

import 'dotenv/config';

const DEEPL_API_KEY = process.env.DEEPL_API_KEY;

// DeepL Free keys end with ':fx', Pro keys don't
const IS_FREE_KEY = DEEPL_API_KEY?.endsWith(':fx');
const DEEPL_ENDPOINT = IS_FREE_KEY
  ? 'https://api-free.deepl.com/v2/translate'
  : 'https://api.deepl.com/v2/translate';

// ═══════════════════════════════════════════════════════════════
// Language Code Mapping: VerbAI (POSIX locale) → DeepL
//
// VerbAI uses POSIX locale codes (fr_FR, de_DE),
// DeepL uses ISO 639-1 codes (FR, DE) with some exceptions.
// ═══════════════════════════════════════════════════════════════

const VERBAI_TO_DEEPL = {
  // ─── European Languages ───
  'fr_FR': 'FR',       // French
  'de_DE': 'DE',       // German
  'es_ES': 'ES',       // Spanish
  'pt_BR': 'PT-BR',    // Portuguese (Brazilian)
  'it_IT': 'IT',       // Italian
  'nl_NL': 'NL',       // Dutch
  'ru_RU': 'RU',       // Russian
  'pl_PL': 'PL',       // Polish
  'sv_SE': 'SV',       // Swedish
  'tr_TR': 'TR',       // Turkish

  // ─── East Asian ───
  'ja_JP': 'JA',       // Japanese
  'ko_KR': 'KO',       // Korean
  'zh_CN': 'ZH-HANS',  // Chinese (Simplified)

  // ─── Other ───
  'ar_SA': 'AR',       // Arabic
  'th_TH': null,       // Thai — NOT supported by DeepL (fallback to Gemini)
  'vi_VN': null,       // Vietnamese — NOT supported by DeepL (fallback to Gemini)

  // ─── Source language mappings ───
  'en':    'EN',
  'en_US': 'EN-US',
  'en_GB': 'EN-GB',
  'en_IN': 'EN',
};

// DeepL language display names
const DEEPL_LANG_NAMES = {
  'FR':      'French',
  'DE':      'German',
  'ES':      'Spanish',
  'PT-BR':   'Portuguese (Brazilian)',
  'IT':      'Italian',
  'NL':      'Dutch',
  'RU':      'Russian',
  'PL':      'Polish',
  'SV':      'Swedish',
  'TR':      'Turkish',
  'JA':      'Japanese',
  'KO':      'Korean',
  'ZH-HANS': 'Chinese (Simplified)',
  'AR':      'Arabic',
  'EN':      'English',
  'EN-US':   'English (US)',
  'EN-GB':   'English (UK)',
};

/**
 * Check if DeepL is available (API key configured).
 * @returns {boolean}
 */
export function isDeeplAvailable() {
  return !!DEEPL_API_KEY && DEEPL_API_KEY.length > 0;
}

/**
 * Check if a VerbAI language code is supported by DeepL.
 * @param {string} langCode VerbAI format (e.g. 'fr_FR')
 * @returns {boolean}
 */
export function isDeeplSupported(langCode) {
  return !!VERBAI_TO_DEEPL[langCode];
}

/**
 * Map VerbAI lang code to DeepL format.
 * @param {string} langCode VerbAI format
 * @returns {string|null} DeepL format, or null if unsupported
 */
export function toDeeplLangCode(langCode) {
  return VERBAI_TO_DEEPL[langCode] || null;
}

/**
 * Translate text using DeepL's API.
 *
 * @param {string} sourceText   The text to translate
 * @param {string} sourceLang   VerbAI source language code (e.g. 'en')
 * @param {string} targetLang   VerbAI target language code (e.g. 'fr_FR')
 * @param {Object} [options]
 * @param {string} [options.formality='prefer_more']  Formality: 'default' | 'prefer_more' | 'prefer_less'
 * @param {number} [options.maxRetries=2]  Number of retries on failure
 * @param {Array}  [options.glossaryTerms]  [{source, target}] — Not used by DeepL API directly but reserved
 * @returns {Promise<{text: string, model: string, sourceLang: string, targetLang: string, latencyMs: number, engine: string}>}
 */
export async function deeplTranslate(sourceText, sourceLang, targetLang, options = {}) {
  const {
    formality = 'prefer_more',
    maxRetries = 2,
  } = options;

  // Map from VerbAI to DeepL lang codes
  const deeplSource = toDeeplLangCode(sourceLang);
  const deeplTarget = toDeeplLangCode(targetLang);

  if (!deeplTarget) throw new Error(`DeepL: Unsupported target language: ${targetLang}`);

  if (!DEEPL_API_KEY) {
    throw new Error('DeepL API key not configured. Set DEEPL_API_KEY in .env');
  }

  // Build form-encoded body (DeepL uses application/x-www-form-urlencoded)
  const params = new URLSearchParams();
  params.append('text', sourceText);
  params.append('target_lang', deeplTarget);
  if (deeplSource) {
    params.append('source_lang', deeplSource);
  }

  // Formality is only supported for certain target languages
  const FORMALITY_SUPPORTED = new Set([
    'DE', 'FR', 'IT', 'ES', 'NL', 'PL', 'PT-BR', 'RU', 'JA', 'KO',
  ]);
  if (FORMALITY_SUPPORTED.has(deeplTarget) && formality !== 'default') {
    params.append('formality', formality);
  }

  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const start = performance.now();

      const response = await fetch(DEEPL_ENDPOINT, {
        method: 'POST',
        headers: {
          'Authorization': `DeepL-Auth-Key ${DEEPL_API_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      const elapsed = Math.round(performance.now() - start);

      if (!response.ok) {
        const errorBody = await response.text().catch(() => 'Unable to parse error body');
        const errMsg = `DeepL API ${response.status}: ${errorBody}`;

        // Don't retry on 4xx (client errors) except 429 (rate limit) and 456 (quota exceeded)
        if (response.status >= 400 && response.status < 500 && response.status !== 429 && response.status !== 456) {
          throw new Error(errMsg);
        }

        lastError = new Error(errMsg);
        console.warn(`   ⚠ DeepL attempt ${attempt + 1}/${maxRetries + 1} failed (${response.status}), retrying...`);

        // Exponential backoff for retries
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
        }
        continue;
      }

      const data = await response.json();
      const translation = data.translations?.[0];

      if (!translation || !translation.text) {
        throw new Error('DeepL returned empty translation');
      }

      let cleanText = translation.text.trim();
      // Strip any wrapping quotes if present
      if ((cleanText.startsWith('"') && cleanText.endsWith('"')) ||
          (cleanText.startsWith("'") && cleanText.endsWith("'"))) {
        cleanText = cleanText.slice(1, -1);
      }

      const detectedSource = translation.detected_source_language || deeplSource || sourceLang;

      console.log(`   🌐 DeepL [${DEEPL_LANG_NAMES[deeplTarget] || targetLang}] ${elapsed}ms: "${sourceText.substring(0, 40)}..." → "${cleanText.substring(0, 40)}..."`);

      return {
        text: cleanText,
        model: 'deepl-translate',
        sourceLang: detectedSource,
        targetLang: deeplTarget,
        latencyMs: elapsed,
        engine: 'deepl',
      };

    } catch (err) {
      lastError = err;

      // If it's a non-retryable error, throw immediately
      if (err.message.includes('Unsupported') || err.message.includes('not configured')) {
        throw err;
      }

      if (attempt < maxRetries) {
        console.warn(`   ⚠ DeepL attempt ${attempt + 1}/${maxRetries + 1} error: ${err.message}`);
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
      }
    }
  }

  throw lastError || new Error('DeepL translation failed after all retries');
}

/**
 * Batch translate multiple texts using DeepL (single call — DeepL supports batching natively).
 *
 * @param {string[]} texts  Array of texts to translate
 * @param {string} sourceLang
 * @param {string} targetLang
 * @param {Object} [options]
 * @returns {Promise<Array<{text: string, model: string, engine: string}>>}
 */
export async function deeplBatchTranslate(texts, sourceLang, targetLang, options = {}) {
  const { formality = 'prefer_more', maxRetries = 2 } = options;

  const deeplSource = toDeeplLangCode(sourceLang);
  const deeplTarget = toDeeplLangCode(targetLang);

  if (!deeplTarget) throw new Error(`DeepL: Unsupported target language: ${targetLang}`);
  if (!DEEPL_API_KEY) throw new Error('DeepL API key not configured. Set DEEPL_API_KEY in .env');

  // DeepL supports multiple 'text' params in a single request
  const params = new URLSearchParams();
  for (const text of texts) {
    params.append('text', text);
  }
  params.append('target_lang', deeplTarget);
  if (deeplSource) {
    params.append('source_lang', deeplSource);
  }

  const FORMALITY_SUPPORTED = new Set([
    'DE', 'FR', 'IT', 'ES', 'NL', 'PL', 'PT-BR', 'RU', 'JA', 'KO',
  ]);
  if (FORMALITY_SUPPORTED.has(deeplTarget) && formality !== 'default') {
    params.append('formality', formality);
  }

  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(DEEPL_ENDPOINT, {
        method: 'POST',
        headers: {
          'Authorization': `DeepL-Auth-Key ${DEEPL_API_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        const errMsg = `DeepL batch API ${response.status}: ${errorBody}`;
        if (response.status >= 400 && response.status < 500 && response.status !== 429 && response.status !== 456) {
          throw new Error(errMsg);
        }
        lastError = new Error(errMsg);
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
        }
        continue;
      }

      const data = await response.json();
      return data.translations.map(t => ({
        text: t.text.trim(),
        model: 'deepl-translate',
        engine: 'deepl',
        detectedSource: t.detected_source_language,
      }));

    } catch (err) {
      lastError = err;
      if (err.message.includes('Unsupported') || err.message.includes('not configured')) throw err;
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
      }
    }
  }

  throw lastError || new Error('DeepL batch translation failed after all retries');
}

/**
 * Get DeepL service status info.
 * Also fetches API usage if available.
 */
export function getDeeplStatus() {
  const supportedLangs = Object.entries(VERBAI_TO_DEEPL)
    .filter(([k, v]) => v && !['en', 'en_US', 'en_IN'].includes(k))
    .map(([k]) => k);

  return {
    available: isDeeplAvailable(),
    endpoint: DEEPL_ENDPOINT,
    model: 'deepl-translate',
    plan: IS_FREE_KEY ? 'Free' : 'Pro',
    supportedLanguages: supportedLangs,
    languageCount: supportedLangs.length,
    features: [
      'European languages (FR, DE, ES, IT, NL, PL, SV, RU, TR)',
      'East Asian languages (JA, KO, ZH)',
      'Arabic (AR)',
      'Formality control (formal/informal)',
      'Context-aware neural translation',
      'Native batch translation support',
    ],
  };
}

/**
 * Fetch DeepL API usage (character count / limit).
 * @returns {Promise<{character_count: number, character_limit: number}|null>}
 */
export async function getDeeplUsage() {
  if (!isDeeplAvailable()) return null;

  const usageEndpoint = IS_FREE_KEY
    ? 'https://api-free.deepl.com/v2/usage'
    : 'https://api.deepl.com/v2/usage';

  try {
    const response = await fetch(usageEndpoint, {
      headers: { 'Authorization': `DeepL-Auth-Key ${DEEPL_API_KEY}` },
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

export default {
  deeplTranslate,
  deeplBatchTranslate,
  isDeeplAvailable,
  isDeeplSupported,
  toDeeplLangCode,
  getDeeplStatus,
  getDeeplUsage,
};
