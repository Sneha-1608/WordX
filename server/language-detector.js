// ═══════════════════════════════════════════════════════════════
// Language Detector Module — Auto-detect source language per segment
// ═══════════════════════════════════════════════════════════════
//
// Created: 2026-04-04
// Purpose: Detect the source language of text segments without
//          requiring user declaration. Uses a two-tier strategy:
//   1. Primary: Gemini LLM-based detection (batched for efficiency)
//   2. Fallback: Unicode script range heuristics (pure JS, no API)
//
// Exports:
//   - detectLanguage(text)          → single segment detection
//   - detectLanguageBatch(segments) → batched detection (1 API call)
//   - detectScriptHeuristic(text)   → pure JS Unicode-based detection
//   - getLanguageDisplayName(code)  → BCP-47 → human-readable name
//
// ═══════════════════════════════════════════════════════════════

import { isMockMode, withRetry } from './gemini.js';

// ═══════════════════════════════════════════════════════════════
// Language Display Name Map — All 22 Scheduled Indian Languages + Others
// ═══════════════════════════════════════════════════════════════

const LANGUAGE_DISPLAY_NAMES = {
  // 22 Scheduled Indian Languages (Eighth Schedule)
  hi: 'Hindi',
  bn: 'Bengali',
  te: 'Telugu',
  mr: 'Marathi',
  ta: 'Tamil',
  ur: 'Urdu',
  gu: 'Gujarati',
  kn: 'Kannada',
  ml: 'Malayalam',
  or: 'Odia',
  pa: 'Punjabi',
  as: 'Assamese',
  mai: 'Maithili',
  sa: 'Sanskrit',
  sd: 'Sindhi',
  ks: 'Kashmiri',
  ne: 'Nepali',
  kok: 'Konkani',
  doi: 'Dogri',
  mni: 'Manipuri',
  brx: 'Bodo',
  sat: 'Santali',

  // Major world languages
  en: 'English',
  fr: 'French',
  de: 'German',
  es: 'Spanish',
  pt: 'Portuguese',
  it: 'Italian',
  nl: 'Dutch',
  ru: 'Russian',
  pl: 'Polish',
  sv: 'Swedish',
  tr: 'Turkish',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese',
  ar: 'Arabic',
  th: 'Thai',
  vi: 'Vietnamese',
  si: 'Sinhala',

  // Fallback
  unknown: 'Unknown',
  mixed: 'Mixed',
};

/**
 * Get human-readable display name for a BCP-47 language code.
 * @param {string} bcp47code - e.g. "hi", "mr", "ta"
 * @returns {string} - e.g. "Hindi", "Marathi", "Tamil"
 */
export function getLanguageDisplayName(bcp47code) {
  if (!bcp47code) return 'Unknown';
  // Handle locale codes like "hi_IN" → "hi"
  const base = bcp47code.split(/[_-]/)[0].toLowerCase();
  return LANGUAGE_DISPLAY_NAMES[base] || bcp47code;
}

// ═══════════════════════════════════════════════════════════════
// Unicode Script Range Detection (Heuristic Fallback)
// ═══════════════════════════════════════════════════════════════

// Marathi-specific markers (high-frequency words/morphemes)
const MARATHI_MARKERS = ['आहे', 'आणि', 'मला', 'तुम्ही', 'त्याने', 'तिने', 'करणे', 'होते', 'आहेत', 'नाही', 'हे', 'ते', 'या', 'ला', 'चे', 'ची', 'चा', 'मध्ये', 'साठी', 'पण', 'किंवा', 'झाले', 'करा', 'केले'];
// Hindi-specific markers
const HINDI_MARKERS = ['है', 'और', 'मुझे', 'आप', 'उसने', 'उन्होंने', 'करना', 'था', 'हैं', 'नहीं', 'यह', 'वह', 'को', 'का', 'की', 'के', 'में', 'लिए', 'लेकिन', 'या', 'हुआ', 'करें', 'किया', 'से'];

/**
 * Count how many markers from a list appear in the text.
 * @param {string} text
 * @param {string[]} markers
 * @returns {number}
 */
function countMarkers(text, markers) {
  let count = 0;
  for (const marker of markers) {
    if (text.includes(marker)) count++;
  }
  return count;
}

/**
 * Pure-JS Unicode script range detection.
 * Analyzes character code points to determine the dominant script.
 *
 * @param {string} text - Input text to analyze
 * @returns {{ language: string, confidence: number, script: string }}
 */
export function detectScriptHeuristic(text) {
  if (!text || text.trim().length === 0) {
    return { language: 'unknown', confidence: 0, script: 'unknown' };
  }

  const cleaned = text.replace(/\s/g, '');
  if (cleaned.length === 0) {
    return { language: 'unknown', confidence: 0, script: 'unknown' };
  }

  // Count characters per script range
  const scriptCounts = {
    devanagari: 0,  // U+0900–U+097F
    tamil: 0,       // U+0B80–U+0BFF
    telugu: 0,      // U+0C00–U+0C7F
    bengali: 0,     // U+0980–U+09FF
    gujarati: 0,    // U+0A80–U+0AFF
    kannada: 0,     // U+0C80–U+0CFF
    malayalam: 0,   // U+0D00–U+0D7F
    gurmukhi: 0,    // U+0A00–U+0A7F
    odia: 0,        // U+0B00–U+0B7F
    sinhala: 0,     // U+0D80–U+0DFF
    latin: 0,
    arabic: 0,      // U+0600–U+06FF (covers Urdu, Arabic, Sindhi)
    other: 0,
  };

  for (const char of cleaned) {
    const code = char.codePointAt(0);
    if (code >= 0x0900 && code <= 0x097F) scriptCounts.devanagari++;
    else if (code >= 0x0B80 && code <= 0x0BFF) scriptCounts.tamil++;
    else if (code >= 0x0C00 && code <= 0x0C7F) scriptCounts.telugu++;
    else if (code >= 0x0980 && code <= 0x09FF) scriptCounts.bengali++;
    else if (code >= 0x0A80 && code <= 0x0AFF) scriptCounts.gujarati++;
    else if (code >= 0x0C80 && code <= 0x0CFF) scriptCounts.kannada++;
    else if (code >= 0x0D00 && code <= 0x0D7F) scriptCounts.malayalam++;
    else if (code >= 0x0A00 && code <= 0x0A7F) scriptCounts.gurmukhi++;
    else if (code >= 0x0B00 && code <= 0x0B7F) scriptCounts.odia++;
    else if (code >= 0x0D80 && code <= 0x0DFF) scriptCounts.sinhala++;
    else if (code >= 0x0600 && code <= 0x06FF) scriptCounts.arabic++;
    else if ((code >= 0x0041 && code <= 0x007A) || (code >= 0x00C0 && code <= 0x024F)) scriptCounts.latin++;
    else scriptCounts.other++;
  }

  // Find dominant script
  const total = cleaned.length;
  const entries = Object.entries(scriptCounts).filter(([, v]) => v > 0);
  entries.sort((a, b) => b[1] - a[1]);

  if (entries.length === 0 || entries[0][1] === 0) {
    return { language: 'unknown', confidence: 0, script: 'unknown' };
  }

  const [dominantScript, dominantCount] = entries[0];
  const ratio = dominantCount / total;

  // If no script exceeds 60% of non-whitespace chars → "mixed"
  if (ratio < 0.6) {
    const bestLang = scriptToLanguage(dominantScript, text);
    return { language: bestLang, confidence: 0.6, script: 'Mixed' };
  }

  // Map script to language
  const language = scriptToLanguage(dominantScript, text);
  const scriptName = scriptToDisplayName(dominantScript);
  const confidence = ratio >= 0.9 ? 0.75 : 0.65;

  return { language, confidence, script: scriptName };
}

/**
 * Map a script identifier to a BCP-47 language code.
 * For Devanagari, uses marker analysis to distinguish Hindi vs Marathi.
 */
function scriptToLanguage(script, text) {
  switch (script) {
    case 'devanagari': {
      // Distinguish Hindi vs Marathi using common grammatical markers
      const marathiScore = countMarkers(text, MARATHI_MARKERS);
      const hindiScore = countMarkers(text, HINDI_MARKERS);
      if (marathiScore > hindiScore) return 'mr';
      if (hindiScore > marathiScore) return 'hi';
      // Default to Hindi if ambiguous
      return 'hi';
    }
    case 'tamil': return 'ta';
    case 'telugu': return 'te';
    case 'bengali': return 'bn';
    case 'gujarati': return 'gu';
    case 'kannada': return 'kn';
    case 'malayalam': return 'ml';
    case 'gurmukhi': return 'pa';
    case 'odia': return 'or';
    case 'sinhala': return 'si';
    case 'arabic': return 'ar'; // Could be Urdu/Sindhi — needs deeper analysis
    case 'latin': {
      const textLower = text.toLowerCase();
      const scores = {
        es: countMarkers(textLower, [' y ', ' el ', ' de ', ' que ', ' la ', ' en ', ' un ', ' los ', ' las ', ' por ', ' con ']),
        fr: countMarkers(textLower, [' et ', ' le ', ' la ', ' les ', ' de ', ' des ', ' un ', ' une ', ' est ', ' dans ', ' pour ']),
        de: countMarkers(textLower, [' und ', ' der ', ' die ', ' das ', ' den ', ' in ', ' ein ', ' eine ', ' ist ', ' zu ', ' für ']),
        pt: countMarkers(textLower, [' e ', ' o ', ' a ', ' os ', ' as ', ' de ', ' do ', ' da ', ' em ', ' um ', ' uma ', ' para ']),
        it: countMarkers(textLower, [' e ', ' il ', ' la ', ' i ', ' le ', ' di ', ' che ', ' in ', ' un ', ' una ', ' per ']),
        en: countMarkers(textLower, [' and ', ' the ', ' of ', ' to ', ' in ', ' a ', ' is ', ' for '])
      };
      
      let bestLang = 'en';
      let maxScore = -1;
      for (const [lang, score] of Object.entries(scores)) {
        if (score > maxScore) {
          maxScore = score;
          bestLang = lang;
        }
      }
      return maxScore > 0 ? bestLang : 'en';
    }
    default: return 'unknown';
  }
}

/**
 * Map internal script key to Unicode script display name.
 */
function scriptToDisplayName(script) {
  const names = {
    devanagari: 'Devanagari',
    tamil: 'Tamil',
    telugu: 'Telugu',
    bengali: 'Bengali',
    gujarati: 'Gujarati',
    kannada: 'Kannada',
    malayalam: 'Malayalam',
    gurmukhi: 'Gurmukhi',
    odia: 'Odia',
    sinhala: 'Sinhala',
    arabic: 'Arabic',
    latin: 'Latin',
  };
  return names[script] || 'Unknown';
}

// ═══════════════════════════════════════════════════════════════
// Gemini-Based Language Detection (Primary Strategy)
// ═══════════════════════════════════════════════════════════════

/**
 * Detect the language of a single text segment.
 * Uses Gemini for texts ≥ 3 chars; heuristic-only for very short texts.
 *
 * @param {string} text - Input text to detect
 * @returns {Promise<{ language: string, confidence: number, script: string }>}
 */
export async function detectLanguage(text) {
  // Edge case: empty/whitespace
  if (!text || text.trim().length === 0) {
    return { language: 'unknown', confidence: 0, script: 'unknown' };
  }

  // Edge case: very short text (< 3 chars) → heuristic only
  if (text.trim().length < 3) {
    return detectScriptHeuristic(text);
  }

  // Try batch detection with single item
  const results = await detectLanguageBatch([text]);
  return results[0];
}

/**
 * Detect languages for a batch of text segments efficiently.
 * Makes ONE Gemini API call for the entire batch.
 * Falls back to heuristic detection on failure.
 *
 * @param {string[]} segments - Array of text strings
 * @returns {Promise<Array<{ language: string, confidence: number, script: string }>>}
 */
export async function detectLanguageBatch(segments) {
  if (!segments || segments.length === 0) return [];

  // Pre-process: handle empty/short segments with heuristic
  const results = new Array(segments.length);
  const geminiIndices = [];  // Indices that need Gemini detection
  const geminiTexts = [];    // Corresponding texts for Gemini

  for (let i = 0; i < segments.length; i++) {
    const text = segments[i];
    if (!text || text.trim().length === 0) {
      results[i] = { language: 'unknown', confidence: 0, script: 'unknown' };
    } else if (text.trim().length < 3) {
      results[i] = detectScriptHeuristic(text);
    } else {
      geminiIndices.push(i);
      geminiTexts.push(text);
    }
  }

  // If nothing needs Gemini, return heuristic results
  if (geminiTexts.length === 0) return results;

  // Try Gemini-based detection
  let geminiResults = null;

  if (!isMockMode()) {
    try {
      geminiResults = await geminiDetectBatch(geminiTexts);
    } catch (err) {
      console.warn(`⚠ Gemini language detection failed: ${err.message}`);
      geminiResults = null;
    }
  }

  // Merge Gemini results with heuristic fallback
  for (let j = 0; j < geminiIndices.length; j++) {
    const idx = geminiIndices[j];

    if (geminiResults && geminiResults[j] && geminiResults[j].confidence >= 0.6) {
      results[idx] = geminiResults[j];
    } else {
      // Fallback to heuristic
      results[idx] = detectScriptHeuristic(geminiTexts[j]);
    }
  }

  return results;
}

/**
 * Call Gemini with a structured batch prompt for language detection.
 * @param {string[]} texts - Array of text strings (all ≥ 3 chars)
 * @returns {Promise<Array<{ language: string, confidence: number, script: string }> | null>}
 */
async function geminiDetectBatch(texts) {
  // Dynamic import to avoid circular dependency
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  // Build numbered segment list for the prompt
  const numberedSegments = texts.map((t, i) => `${i + 1}. "${t.substring(0, 200)}"`).join('\n');

  const prompt = `You are a language identification system. Analyze each numbered text segment below and detect its language.

For each segment, determine:
- "language": BCP-47 language code (e.g. "hi" for Hindi, "mr" for Marathi, "ta" for Tamil, "te" for Telugu, "bn" for Bengali, "en" for English, "gu" for Gujarati, "kn" for Kannada, "ml" for Malayalam, "pa" for Punjabi, "or" for Odia, "as" for Assamese, "ur" for Urdu, "sa" for Sanskrit, "ne" for Nepali, "sd" for Sindhi, "ks" for Kashmiri, "mai" for Maithili, "kok" for Konkani, "doi" for Dogri, "mni" for Manipuri, "brx" for Bodo, "sat" for Santali, "si" for Sinhala, "fr" for French, "de" for German, "es" for Spanish, "ja" for Japanese, "ko" for Korean, "zh" for Chinese, "ar" for Arabic)
- "confidence": float 0.0 to 1.0 indicating how confident you are
- "script": Unicode script name (e.g. "Devanagari", "Tamil", "Telugu", "Bengali", "Latin", "Arabic", "Gujarati", "Kannada", "Malayalam", "Gurmukhi", "Odia", "Sinhala", "CJK", "Cyrillic", "Ol Chiki")

SEGMENTS:
${numberedSegments}

Return ONLY a raw JSON array with exactly ${texts.length} objects, one per segment in order. No markdown fences, no explanation, no extra text.
Example format: [{"language":"hi","confidence":0.95,"script":"Devanagari"},{"language":"en","confidence":0.99,"script":"Latin"}]`;

  try {
    const result = await withRetry(() => model.generateContent(prompt));
    const responseText = result.response.text().trim();

    // Strip markdown fences if Gemini adds them despite instructions
    const cleaned = responseText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    const parsed = JSON.parse(cleaned);

    if (!Array.isArray(parsed) || parsed.length !== texts.length) {
      console.warn(`⚠ Gemini detection returned ${parsed.length} results for ${texts.length} segments`);
      return null;
    }

    // Validate and normalize each result
    return parsed.map((item) => ({
      language: (item.language || 'unknown').toLowerCase(),
      confidence: typeof item.confidence === 'number' ? Math.min(1, Math.max(0, item.confidence)) : 0.5,
      script: item.script || 'unknown',
    }));
  } catch (err) {
    console.warn(`⚠ Gemini detection parse failed: ${err.message}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// Default Export
// ═══════════════════════════════════════════════════════════════

export default {
  detectLanguage,
  detectLanguageBatch,
  detectScriptHeuristic,
  getLanguageDisplayName,
};
