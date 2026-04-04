// ═══════════════════════════════════════════════════════════════
// DeepTrans Feature: Structured DOCX Parser (Format-Preserving)
// ═══════════════════════════════════════════════════════════════
//
// Alternative DOCX parser that preserves per-run formatting metadata
// (bold, italic, underline, color, font size) from the original document.
// Enables format-faithful export reconstruction.
//
// Uses JSZip + fast-xml-parser to read the raw OOXML structure
// instead of mammoth's HTML conversion.
//
// ═══════════════════════════════════════════════════════════════

import { XMLParser } from 'fast-xml-parser';
import { alignTranslationToRuns } from './run-aligner.js';

/**
 * Given a parsed paragraph object (from fast-xml-parser), return a structured
 * array of runs. Each run has:
 *   - text: string (the original source text in that run)
 *   - rPr: object (the raw run properties — bold, italic, underline, font etc.)
 *   - charStart: number (character offset where this run starts in the full paragraph text)
 *   - charEnd: number (character offset where this run ends)
 */
export function extractRunMap(paragraph) {
  // paragraph.r may be a single object or an array — normalize to array
  const runs = Array.isArray(paragraph.r)
    ? paragraph.r
    : paragraph.r
    ? [paragraph.r]
    : [];

  let cursor = 0;
  return runs.map((run) => {
    let text = '';
    if (typeof run.t === 'string') {
      text = run.t;
    } else if (run.t && typeof run.t === 'object') {
      text = run.t['#text'] || '';
    } else if (run.t !== undefined && run.t !== null) {
      text = String(run.t);
    }

    const rPr = run.rPr || null;
    const entry = {
      text: String(text),
      rPr,
      charStart: cursor,
      charEnd: cursor + String(text).length,
    };
    cursor += String(text).length;
    return entry;
  });
}

/**
 * Rebuilds a paragraph's run data using aligned run formatting from LLM.
 *
 * @param {Array} originalRuns - raw run array from parseDocxStructured (runs metadata)
 * @param {string} translatedText - full translated string for this paragraph
 * @param {string} sourceLang
 * @param {string} targetLang
 * @returns {Promise<Array<{text: string, bold: boolean, italic: boolean, underline: boolean, color: string|null, fontSize: number|null}>>}
 */
export async function buildAlignedRuns(originalRuns, translatedText, sourceLang, targetLang) {
  // Convert our simplified run format to what the aligner expects
  const runMapInput = originalRuns.map(r => ({
    text: r.text,
    rPr: {
      bold: r.bold,
      italic: r.italic,
      underline: r.underline,
      color: r.color,
      fontSize: r.fontSize,
    },
  }));

  const alignedRuns = await alignTranslationToRuns(runMapInput, translatedText, sourceLang, targetLang);

  return alignedRuns
    .filter(r => r.translatedSegment && r.translatedSegment.length > 0)
    .map(({ translatedSegment, rPr }) => ({
      text: translatedSegment,
      bold: rPr?.bold || false,
      italic: rPr?.italic || false,
      underline: rPr?.underline || false,
      color: rPr?.color || null,
      fontSize: rPr?.fontSize || null,
    }));
}

/**
 * Parse a DOCX buffer into structured segments with per-run formatting metadata.
 *
 * @param {Buffer} buffer  The raw DOCX file buffer
 * @returns {Promise<Array<{text: string, formatType: string, runs: Array}>>}
 *
 * Each segment has shape:
 * {
 *   text: string,                     // Full paragraph text
 *   formatType: 'heading' | 'paragraph' | 'list_item',
 *   runs: [{
 *     text: string,
 *     bold: boolean,
 *     italic: boolean,
 *     underline: boolean,
 *     color: string | null,          // hex e.g. "FF0000"
 *     fontSize: number | null,       // half-points e.g. 28 = 14pt
 *   }]
 * }
 */
export async function parseDocxStructured(buffer) {
  const JSZip = (await import('jszip')).default;

  // Step 1: Unzip the DOCX
  const zip = await JSZip.loadAsync(buffer);
  const docXml = zip.file('word/document.xml');

  if (!docXml) {
    throw new Error('Invalid DOCX file: word/document.xml not found');
  }

  const xmlContent = await docXml.async('string');

  // Step 2: Parse the XML
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
  });
  const doc = parser.parse(xmlContent);

  // Step 3: Navigate to paragraphs
  let paragraphs = doc?.document?.body?.p;
  if (!paragraphs) {
    throw new Error('No paragraphs found in document');
  }
  if (!Array.isArray(paragraphs)) {
    paragraphs = [paragraphs];
  }

  const segments = [];

  for (const p of paragraphs) {
    // Detect format type
    let formatType = 'paragraph';

    // Check for heading style
    if (p.pPr) {
      const styleVal = p.pPr?.pStyle?.['@_val'] || '';
      if (/heading|title/i.test(styleVal)) {
        formatType = 'heading';
      }
      // Check for list items (numbering properties)
      if (p.pPr?.numPr) {
        formatType = 'list_item';
      }
    }

    // Extract runs
    let rawRuns = p.r;
    if (!rawRuns) {
      // Paragraph might have direct text (no runs)
      const directText = typeof p === 'string' ? p : (p?.['#text'] || '');
      if (directText && directText.trim().length >= 3) {
        segments.push({
          text: directText.trim(),
          formatType,
          runs: [{ text: directText.trim(), bold: false, italic: false, underline: false, color: null, fontSize: null }],
        });
      }
      continue;
    }

    if (!Array.isArray(rawRuns)) {
      rawRuns = [rawRuns];
    }

    const runs = [];
    let fullText = '';

    for (const r of rawRuns) {
      // Extract text — handle both string and object shapes
      let runText = '';
      if (typeof r.t === 'string') {
        runText = r.t;
      } else if (r.t && typeof r.t === 'object') {
        runText = r.t['#text'] || '';
      } else if (r.t !== undefined && r.t !== null) {
        runText = String(r.t);
      }

      if (!runText) continue;

      // Read run properties
      const rPr = r.rPr || {};

      const bold = rPr.b !== undefined && rPr.b !== false;
      const italic = rPr.i !== undefined && rPr.i !== false;
      const underline = rPr.u !== undefined && rPr.u !== false;
      const color = rPr.color?.['@_val'] || null;
      const fontSize = rPr.sz?.['@_val'] ? parseInt(rPr.sz['@_val'], 10) : null;

      runs.push({
        text: runText,
        bold,
        italic,
        underline,
        color,
        fontSize,
      });

      fullText += runText;
    }

    // Skip very short paragraphs
    if (fullText.trim().length < 3) continue;

    segments.push({
      text: fullText.trim(),
      formatType,
      runs,
    });
  }

  if (segments.length === 0) {
    throw new Error('No translatable text found in the structured DOCX parse.');
  }

  return segments;
}
