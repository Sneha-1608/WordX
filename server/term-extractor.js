// ═══════════════════════════════════════════════════════════════
// DeepTrans Feature: Pre-Translation Term Extraction Agent
// ═══════════════════════════════════════════════════════════════
//
// Scans source text before translation to discover domain-specific
// terms not present in the glossary. Injects them into prompt context
// to ensure consistent handling across all segments.
//
// ═══════════════════════════════════════════════════════════════

import { isMockMode, withRetry } from './gemini.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import 'dotenv/config';

let flashModel = null;
if (!isMockMode() && process.env.GEMINI_API_KEY) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  flashModel = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
}

/**
 * Extract domain-specific terms from source text using an LLM.
 * 
 * @param {string} sourceText  Full concatenated source text (all segments joined with \n)
 * @param {string} sourceLang  Source language code (e.g. 'en')
 * @returns {Promise<Array<{term: string, category: string}>>}
 */
export async function extractTerms(sourceText, sourceLang = 'en') {
  if (isMockMode() || !flashModel) {
    // Return hardcoded demo terms in mock mode
    return [
      { term: 'authorization', category: 'legal' },
      { term: 'compliance', category: 'legal' },
      { term: 'stakeholder', category: 'general' },
    ];
  }

  const prompt = `You are a terminology extraction specialist.
Analyze the following ${sourceLang} text and extract ALL:
- Domain-specific terminology (legal, medical, financial, technical)
- Proper nouns and named entities
- Technical acronyms and abbreviations
- Terms that should be translated consistently across a document

Return ONLY a JSON array: [{"term": "...", "category": "legal|medical|finance|technical|general"}]
No explanations. No markdown fences.

TEXT:
${sourceText}`;

  try {
    const result = await withRetry(() => flashModel.generateContent(prompt));
    const raw = result.response.text()
      .replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    console.warn('⚠ Term extraction returned non-array, defaulting to []');
    return [];
  } catch (err) {
    console.warn(`⚠ Term extraction failed: ${err.message}`);
    return [];
  }
}

/**
 * Cross-reference discovered terms against the existing glossary.
 * Returns terms split into known (already in glossary) and unknown (new discoveries).
 *
 * @param {Array<{term: string, category: string}>} discoveredTerms
 * @param {Array<{source: string, target: string}>} existingGlossary
 * @returns {{ known: Array, unknown: Array }}
 */
export function crossReferenceGlossary(discoveredTerms, existingGlossary) {
  const known = [];
  const unknown = [];

  const glossarySet = new Set(
    existingGlossary.map(g => g.source.toLowerCase())
  );

  for (const term of discoveredTerms) {
    if (glossarySet.has(term.term.toLowerCase())) {
      known.push(term);
    } else {
      unknown.push(term);
    }
  }

  return { known, unknown };
}
