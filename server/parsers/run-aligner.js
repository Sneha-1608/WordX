// ═══════════════════════════════════════════════════════════════
// Run Aligner — LLM-Based Translation-to-Source Run Mapping
// ═══════════════════════════════════════════════════════════════
//
// Uses Gemini to align translated text back to source XML runs,
// enabling per-run formatting preservation in DOCX exports.
//
// ═══════════════════════════════════════════════════════════════

/**
 * Given source runs and a fully translated string, ask Gemini to identify
 * which substring of the translation corresponds to each source run.
 *
 * @param {Array<{text: string, rPr: object}>} sourceRuns - extracted run map
 * @param {string} translatedText - the full translated paragraph string
 * @param {string} sourceLang - e.g. "en"
 * @param {string} targetLang - e.g. "hi"
 * @returns {Promise<Array<{translatedSegment: string, rPr: object}>>}
 */
export async function alignTranslationToRuns(sourceRuns, translatedText, sourceLang, targetLang) {
  // Filter out runs with no meaningful text (whitespace-only, empty)
  const meaningfulRuns = sourceRuns.filter(r => r.text.trim().length > 0);

  // If only 1 meaningful run OR all runs have same formatting,
  // skip LLM call — return translatedText as a single run with first rPr
  const hasVariedFormatting = meaningfulRuns.some(
    (r, i, arr) => i > 0 && JSON.stringify(r.rPr) !== JSON.stringify(arr[0].rPr)
  );
  if (!hasVariedFormatting || meaningfulRuns.length <= 1) {
    return [{ translatedSegment: translatedText, rPr: sourceRuns[0]?.rPr ?? null }];
  }

  // Build the alignment prompt
  const sourceRunsJson = JSON.stringify(
    meaningfulRuns.map((r, i) => ({ id: i, text: r.text }))
  );

  const prompt = `
You are a translation alignment assistant.

Source language: ${sourceLang}
Target language: ${targetLang}

The following source text was split into ${meaningfulRuns.length} runs (some may be bold, italic, etc.):
${sourceRunsJson}

The full translated output is:
"${translatedText}"

Your task: For each source run (by id), identify the EXACT substring in the translated output that corresponds to that run.

Rules:
1. The substrings must be contiguous and together form the full translated string with no gaps and no overlaps.
2. Preserve word boundaries — do not split words.
3. If a source run is punctuation or a single space, its translated counterpart is the nearest equivalent punctuation or space.
4. Return ONLY a JSON array. No explanation. No markdown. No code fences.

Output format:
[
  { "id": 0, "translatedSegment": "..." },
  { "id": 1, "translatedSegment": "..." },
  ...
]
`;

  try {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const result = await model.generateContent(prompt);
    const raw = result.response.text().trim();

    // Strip any accidental markdown fences
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);

    // Map aligned segments back to their rPr
    return parsed.map((item) => ({
      translatedSegment: item.translatedSegment,
      rPr: meaningfulRuns[item.id]?.rPr ?? null,
    }));
  } catch (err) {
    // Fallback: return entire translation as single run with first rPr
    console.warn('[run-aligner] Alignment failed, using fallback single-run:', err.message);
    return [{ translatedSegment: translatedText, rPr: sourceRuns[0]?.rPr ?? null }];
  }
}
