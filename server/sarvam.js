// ═══════════════════════════════════════════════════════════════
// Sarvam AI Translation Service
// ═══════════════════════════════════════════════════════════════
//
// Integrates Sarvam AI's sarvam-translate:v1 model for
// high-quality Indian language translation.
//
// Sarvam-Translate is fine-tuned on Gemma3-4B-IT in partnership
// with AI4Bharat, supporting all 22 scheduled Indian languages.
//
// ═══════════════════════════════════════════════════════════════

import 'dotenv/config';

const SARVAM_API_KEY = process.env.SARVAM_API_KEY;
const SARVAM_ENDPOINT = 'https://api.sarvam.ai/translate';

// ═══════════════════════════════════════════════════════════════
// Language Code Mapping: ClearLingo → Sarvam
//
// ClearLingo uses POSIX locale codes (hi_IN),
// Sarvam uses BCP-47 style codes (hi-IN).
// ═══════════════════════════════════════════════════════════════

const CLEARLINGO_TO_SARVAM = {
  // ─── 22 Scheduled Indian Languages ───
  'hi_IN': 'hi-IN',   // Hindi
  'bn_IN': 'bn-IN',   // Bengali
  'ta_IN': 'ta-IN',   // Tamil
  'te_IN': 'te-IN',   // Telugu
  'mr_IN': 'mr-IN',   // Marathi
  'gu_IN': 'gu-IN',   // Gujarati
  'kn_IN': 'kn-IN',   // Kannada
  'ml_IN': 'ml-IN',   // Malayalam
  'pa_IN': 'pa-IN',   // Punjabi
  'or_IN': 'od-IN',   // Odia (Sarvam uses 'od')
  'as_IN': 'as-IN',   // Assamese
  'mai_IN': 'mai-IN', // Maithili
  'sd_IN': 'sd-IN',   // Sindhi
  'ks_IN': 'ks-IN',   // Kashmiri
  'ne_NP': 'ne-IN',   // Nepali
  'ur_PK': 'ur-IN',   // Urdu
  'mni_IN': 'mni-IN', // Manipuri
  'brx_IN': 'brx-IN', // Bodo
  'doi_IN': 'doi-IN', // Dogri
  'sat_IN': 'sat-IN', // Santali
  'kok_IN': 'kok-IN', // Konkani
  'sa_IN': 'sa-IN',   // Sanskrit
  'si_LK': 'si-IN',   // Sinhala

  // English (source language)
  'en': 'en-IN',
  'en_US': 'en-IN',
  'en_IN': 'en-IN',
};

// Languages display names
const SARVAM_LANG_NAMES = {
  'hi-IN': 'Hindi', 'bn-IN': 'Bengali', 'ta-IN': 'Tamil', 'te-IN': 'Telugu',
  'mr-IN': 'Marathi', 'gu-IN': 'Gujarati', 'kn-IN': 'Kannada', 'ml-IN': 'Malayalam',
  'pa-IN': 'Punjabi', 'od-IN': 'Odia', 'as-IN': 'Assamese', 'mai-IN': 'Maithili',
  'sd-IN': 'Sindhi', 'ks-IN': 'Kashmiri', 'ne-IN': 'Nepali', 'ur-IN': 'Urdu',
  'mni-IN': 'Manipuri', 'brx-IN': 'Bodo', 'doi-IN': 'Dogri', 'sat-IN': 'Santali',
  'kok-IN': 'Konkani', 'sa-IN': 'Sanskrit', 'si-IN': 'Sinhala', 'en-IN': 'English',
};

/**
 * Check if Sarvam AI is available (API key configured).
 * @returns {boolean}
 */
export function isSarvamAvailable() {
  return !!SARVAM_API_KEY && SARVAM_API_KEY.length > 0;
}

/**
 * Check if a ClearLingo language code is supported by Sarvam as a TARGET language.
 * @param {string} langCode ClearLingo format (e.g. 'hi_IN')
 * @returns {boolean}
 */
export function isSarvamSupported(langCode) {
  return !!CLEARLINGO_TO_SARVAM[langCode];
}

/**
 * Check if a source language is supported by Sarvam.
 * Sarvam only supports English as the source language.
 * @param {string} sourceLang BCP-47 or ClearLingo source code (e.g. 'en', 'hi', 'ta')
 * @returns {boolean}
 */
export function isSarvamSourceSupported(sourceLang) {
  if (!sourceLang) return false;
  const base = sourceLang.split(/[_-]/)[0].toLowerCase();
  return base === 'en';
}

/**
 * Map ClearLingo lang code to Sarvam format.
 * @param {string} langCode ClearLingo format
 * @returns {string|null} Sarvam format, or null if unsupported
 */
export function toSarvamLangCode(langCode) {
  return CLEARLINGO_TO_SARVAM[langCode] || null;
}

/**
 * Translate text using Sarvam AI's sarvam-translate:v1 model.
 *
 * @param {string} sourceText   The text to translate
 * @param {string} sourceLang   ClearLingo source language code (e.g. 'en')
 * @param {string} targetLang   ClearLingo target language code (e.g. 'hi_IN')
 * @param {Object} [options]
 * @param {string} [options.mode='formal']  Translation mode: 'formal' | 'classic-colloquial' | 'modern-colloquial'
 * @param {string} [options.model='sarvam-translate:v1']  Model to use
 * @param {number} [options.maxRetries=2]  Number of retries on failure
 * @returns {Promise<{text: string, model: string, sourceLang: string, targetLang: string}>}
 */
export async function sarvamTranslate(sourceText, sourceLang, targetLang, options = {}) {
  const {
    mode = 'formal',
    model = 'sarvam-translate:v1',
    maxRetries = 2,
  } = options;

  // ═══ Sarvam only supports English as source language ═══
  // If source is non-English (e.g. detected as 'hi', 'ta'), reject immediately
  if (!isSarvamSourceSupported(sourceLang)) {
    throw new Error(`Sarvam: Unsupported source language: ${sourceLang} (Sarvam only supports English as source)`);
  }

  // Map from ClearLingo to Sarvam lang codes
  const sarvamSource = toSarvamLangCode(sourceLang) || 'en-IN';  // Always English
  const sarvamTarget = toSarvamLangCode(targetLang);

  if (!sarvamTarget) throw new Error(`Sarvam: Unsupported target language: ${targetLang}`);

  if (!SARVAM_API_KEY) {
    throw new Error('Sarvam API key not configured. Set SARVAM_API_KEY in .env');
  }

  const payload = {
    input: sourceText,
    source_language_code: sarvamSource,
    target_language_code: sarvamTarget,
    model,
    mode,
    enable_preprocessing: true,
  };

  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const start = performance.now();

      const response = await fetch(SARVAM_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-subscription-key': SARVAM_API_KEY,
        },
        body: JSON.stringify(payload),
      });

      const elapsed = Math.round(performance.now() - start);

      if (!response.ok) {
        const errorBody = await response.text().catch(() => 'Unable to parse error body');
        const errMsg = `Sarvam API ${response.status}: ${errorBody}`;

        // Don't retry on 4xx (client errors) except 429 (rate limit)
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          throw new Error(errMsg);
        }

        lastError = new Error(errMsg);
        console.warn(`   ⚠ Sarvam attempt ${attempt + 1}/${maxRetries + 1} failed (${response.status}), retrying...`);

        // Exponential backoff for retries
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
        }
        continue;
      }

      const data = await response.json();
      const translatedText = data.translated_text || data.output || '';

      if (!translatedText) {
        throw new Error('Sarvam returned empty translation');
      }

      // Clean up wrapping quotes if present
      let cleanText = translatedText.trim();
      if ((cleanText.startsWith('"') && cleanText.endsWith('"')) ||
          (cleanText.startsWith("'") && cleanText.endsWith("'"))) {
        cleanText = cleanText.slice(1, -1);
      }

      console.log(`   🇮🇳 Sarvam [${SARVAM_LANG_NAMES[sarvamTarget] || targetLang}] ${elapsed}ms: "${sourceText.substring(0, 40)}..." → "${cleanText.substring(0, 40)}..."`);

      return {
        text: cleanText,
        model,
        sourceLang: sarvamSource,
        targetLang: sarvamTarget,
        latencyMs: elapsed,
        engine: 'sarvam',
      };

    } catch (err) {
      lastError = err;

      // If it's a non-retryable error, throw immediately
      if (err.message.includes('Unsupported') || err.message.includes('not configured')) {
        throw err;
      }

      if (attempt < maxRetries) {
        console.warn(`   ⚠ Sarvam attempt ${attempt + 1}/${maxRetries + 1} error: ${err.message}`);
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
      }
    }
  }

  throw lastError || new Error('Sarvam translation failed after all retries');
}

/**
 * Batch translate multiple texts using Sarvam (sequential calls).
 * Sarvam doesn't have a native batch endpoint, so we send sequential requests.
 *
 * @param {string[]} texts  Array of texts to translate
 * @param {string} sourceLang
 * @param {string} targetLang
 * @param {Object} [options]
 * @returns {Promise<Array<{text: string, model: string}>>}
 */
export async function sarvamBatchTranslate(texts, sourceLang, targetLang, options = {}) {
  const results = [];
  for (const text of texts) {
    try {
      const result = await sarvamTranslate(text, sourceLang, targetLang, options);
      results.push(result);
    } catch (err) {
      console.error(`   ❌ Sarvam batch item failed: ${err.message}`);
      results.push({
        text: `[Sarvam Error: ${text.substring(0, 50)}...]`,
        model: options.model || 'sarvam-translate:v1',
        error: err.message,
        engine: 'sarvam',
      });
    }
  }
  return results;
}

/**
 * Get Sarvam service status info.
 */
export function getSarvamStatus() {
  return {
    available: isSarvamAvailable(),
    endpoint: SARVAM_ENDPOINT,
    model: 'sarvam-translate:v1',
    supportedLanguages: Object.keys(CLEARLINGO_TO_SARVAM).filter(k => k !== 'en' && k !== 'en_US' && k !== 'en_IN'),
    languageCount: Object.keys(CLEARLINGO_TO_SARVAM).filter(k => k !== 'en' && k !== 'en_US' && k !== 'en_IN').length,
    features: [
      'All 22 Scheduled Indian Languages',
      'Formal / Colloquial modes',
      'Fine-tuned on Gemma3-4B-IT (AI4Bharat)',
      'Outperforms Gemma3-27B and Llama-3.1-405B on Indian languages',
    ],
  };
}

export default {
  sarvamTranslate,
  sarvamBatchTranslate,
  isSarvamAvailable,
  isSarvamSupported,
  isSarvamSourceSupported,
  toSarvamLangCode,
  getSarvamStatus,
};
