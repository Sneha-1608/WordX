import { Router } from 'express';
import multer from 'multer';
import mammoth from 'mammoth';
import { randomUUID } from 'crypto';
import db from '../db.js';
import ragEngine from '../rag-engine.js';
import { isMockMode } from '../gemini.js';
import { parseDocxStructured } from '../parsers/docx-structured.js';

// ═══ Pre-load pdf-parse at startup (not per-request) ═══
let _cachedPdfParse = null;
import('pdf-parse').then(m => { _cachedPdfParse = m; console.log('✅ pdf-parse pre-loaded'); }).catch(() => {});

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ═══════════════════════════════════════════════════════════════
// Supported file extensions
// ═══════════════════════════════════════════════════════════════

const SUPPORTED_EXTENSIONS = new Set([
  'docx', 'pdf',
]);

// ═══════════════════════════════════════════════════════════════
// Smart Segmentation with Abbreviation Protection
// ═══════════════════════════════════════════════════════════════

const ABBREVIATIONS = /(?:Dr|Mr|Mrs|Ms|Prof|Sr|Jr|St|U\.S|Inc|Ltd|Corp|etc|vs|e\.g|i\.e)\./gi;

function smartSplit(text) {
  let safe = text.replace(ABBREVIATIONS, (m) => m.replace(/\./g, '‡'));
  const raw = safe.split(/(?<=[.!?])\s+(?=[A-Z])/);
  
  const chunks = [];
  for (let s of raw) {
    s = s.replace(/‡/g, '.').trim();
    if (s.length < 3) continue;
    
    // Fallback chunking: if a single run-on sentence exceeds 400 chars, split it by words
    if (s.length > 400) {
      let currentChunk = '';
      const words = s.split(' ');
      for (const word of words) {
        if (currentChunk.length + word.length > 380) { // Leave room for padding
          chunks.push(currentChunk.trim());
          currentChunk = word + ' ';
        } else {
          currentChunk += word + ' ';
        }
      }
      if (currentChunk.trim().length > 0) chunks.push(currentChunk.trim());
    } else {
      chunks.push(s);
    }
  }
  return chunks;
}

// ═══════════════════════════════════════════════════════════════
// HTML-Based Format Detection
// ═══════════════════════════════════════════════════════════════

function detectFormatType(html) {
  if (/<h[1-6][^>]*>/i.test(html)) return 'heading';
  if (/<li[^>]*>/i.test(html)) return 'list_item';
  if (/<ol[^>]*>/i.test(html)) return 'numbered_list';
  if (/<ul[^>]*>/i.test(html)) return 'bullet_list';
  if (/<blockquote[^>]*>/i.test(html)) return 'blockquote';
  if (/<table[^>]*>/i.test(html)) return 'table';
  return 'paragraph';
}

function extractSegmentsFromHtml(html) {
  const segments = [];
  const blockPattern = /(<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>|<p[^>]*>[\s\S]*?<\/p>|<li[^>]*>[\s\S]*?<\/li>|<tr[^>]*>[\s\S]*?<\/tr>|<blockquote[^>]*>[\s\S]*?<\/blockquote>)/gi;
  const blocks = html.match(blockPattern) || [];

  for (const block of blocks) {
    const formatType = detectFormatType(block);
    const text = block.replace(/<[^>]+>/g, '').trim();
    if (text.length > 3) {
      // Split ANY format type (paragraphs, list items, quotes) if it exceeds 150 chars
      if (text.length > 150 && formatType !== 'heading') {
        const sentences = smartSplit(text);
        for (const sentence of sentences) {
          segments.push({ text: sentence, formatType });
        }
      } else {
        segments.push({ text, formatType });
      }
    }
  }
  return segments;
}

// ═══════════════════════════════════════════════════════════════
// Shared: Convert raw text → segment array
// ═══════════════════════════════════════════════════════════════

function textToSegments(text) {
  const paragraphs = text.split(/\n{2,}|\r\n{2,}/).filter((p) => p.trim().length > 3);
  const segments = [];

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (trimmed.length > 100) {
      const sentences = smartSplit(trimmed);
      for (const sentence of sentences) {
        segments.push({ text: sentence, formatType: 'paragraph' });
      }
    } else if (trimmed.length > 3) {
      segments.push({ text: trimmed, formatType: 'paragraph' });
    }
  }

  // If double-newline split produced nothing, try single newline
  if (segments.length === 0) {
    const lines = text.split(/\n|\r\n/).filter((l) => l.trim().length > 3);
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length > 100) {
        const sentences = smartSplit(trimmed);
        for (const sentence of sentences) {
          segments.push({ text: sentence, formatType: 'paragraph' });
        }
      } else {
        segments.push({ text: trimmed, formatType: 'paragraph' });
      }
    }
  }

  return segments;
}

// ═══════════════════════════════════════════════════════════════
// Format-Specific Parsers
// ═══════════════════════════════════════════════════════════════

// ── DOCX ──
async function parseDocx(buffer) {
  const htmlResult = await mammoth.convertToHtml({ buffer });
  const html = htmlResult.value;

  if (!html || html.trim().length === 0) {
    const rawResult = await mammoth.extractRawText({ buffer });
    if (!rawResult.value || rawResult.value.trim().length === 0) {
      throw new Error('Document appears to be empty.');
    }
    return textToSegments(rawResult.value);
  }

  let segments = extractSegmentsFromHtml(html);
  if (segments.length === 0) {
    const rawResult = await mammoth.extractRawText({ buffer });
    return textToSegments(rawResult.value);
  }
  return segments;
}

// ── PDF ──
async function parsePdf(buffer) {
  const pdfParseModule = _cachedPdfParse || await import('pdf-parse');

  let text = '';

  if (pdfParseModule.PDFParse) {
    // pdf-parse v2: class-based API
    const parser = new pdfParseModule.PDFParse({ data: buffer });
    const result = await parser.getText();
    text = result.text || '';
    await parser.destroy().catch(() => {});
  } else if (typeof pdfParseModule.default === 'function') {
    // pdf-parse v1: function-based API
    const data = await pdfParseModule.default(buffer);
    text = data.text || '';
  } else {
    throw new Error('pdf-parse module could not be loaded. Please reinstall: npm install pdf-parse');
  }

  if (!text || text.trim().length === 0) {
    throw new Error('PDF appears to be empty or contains only images.');
  }
  return textToSegments(text);
}

// ── Plain Text / Markdown / RTF ──
function parseTxt(buffer) {
  const text = buffer.toString('utf-8');
  if (!text || text.trim().length === 0) {
    throw new Error('Text file appears to be empty.');
  }
  return textToSegments(text);
}

// ── HTML / HTM ──
function parseHtmlFile(buffer) {
  const html = buffer.toString('utf-8');
  if (!html || html.trim().length === 0) {
    throw new Error('HTML file appears to be empty.');
  }
  let segments = extractSegmentsFromHtml(html);
  if (segments.length === 0) {
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return textToSegments(text);
  }
  return segments;
}

// ── XLSX / XLS / CSV ──
async function parseSpreadsheet(buffer, ext) {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const segments = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
      const row = rows[rowIdx];
      const cellTexts = row.filter((cell) => cell !== null && cell !== undefined && String(cell).trim().length > 0);
      if (cellTexts.length === 0) continue;

      const combined = cellTexts.map((c) => String(c).trim()).join(' | ');
      if (combined.length > 3) {
        segments.push({
          text: combined,
          formatType: rowIdx === 0 ? 'heading' : 'table',
        });
      }
    }
  }

  if (segments.length === 0) {
    throw new Error('Spreadsheet appears to be empty.');
  }
  return segments;
}

// ── PPTX (ZIP → XML text extraction) ──
async function parsePptx(buffer) {
  const JSZip = (await import('jszip')).default;
  const segments = [];

  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort();

  for (let i = 0; i < slideFiles.length; i++) {
    const xml = await zip.files[slideFiles[i]].async('string');
    // Extract text from <a:t> tags (PowerPoint text runs)
    const textMatches = xml.match(/<a:t[^>]*>([^<]*)<\/a:t>/gi) || [];
    const texts = textMatches
      .map((m) => m.replace(/<[^>]+>/g, '').trim())
      .filter((t) => t.length > 0);

    if (texts.length > 0) {
      // First text block per slide is usually the heading
      const heading = texts[0];
      if (heading.length > 3) {
        segments.push({ text: heading, formatType: 'heading' });
      }
      for (let j = 1; j < texts.length; j++) {
        if (texts[j].length > 3) {
          segments.push({ text: texts[j], formatType: 'paragraph' });
        }
      }
    }
  }

  if (segments.length === 0) {
    throw new Error('Presentation appears to be empty or has no text content.');
  }
  return segments;
}

// Extract project name from any filename
function extractProjectName(filename) {
  return filename.replace(/\.[^.]+$/, '');
}

// ═══════════════════════════════════════════════════════════════
// POST /api/parse — Multi-Format Document Parsing & Segmentation
// ═══════════════════════════════════════════════════════════════

router.post('/', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const ext = req.file.originalname.split('.').pop().toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      return res.status(400).json({
        error: `Unsupported file format: .${ext}. Supported: ${[...SUPPORTED_EXTENSIONS].map(e => '.' + e).join(', ')}`,
      });
    }

    const language = req.body.language || 'hi_IN';
    const projectName = extractProjectName(req.file.originalname);
    const preserveFormatting = req.body.preserveFormatting === 'true';

    // ═══ Step 1: Parse document based on format ═══
    console.log(`\n📄 Parsing "${req.file.originalname}" (${ext}) — ${(req.file.size / 1024).toFixed(1)} KB`);

    let segments;
    switch (ext) {
      case 'docx':
        segments = preserveFormatting
          ? await parseDocxStructured(req.file.buffer)
          : await parseDocx(req.file.buffer);
        break;
      case 'pdf':
        segments = await parsePdf(req.file.buffer);
        break;
      default:
        return res.status(400).json({ error: `No parser available for .${ext}. Only DOCX and PDF are supported.` });
    }

    if (!segments || segments.length === 0) {
      return res.status(400).json({ error: 'No translatable text found in the document.' });
    }

    // ═══ Step 2: Create project with context ═══
    const projectContext = 'General Business';
    const project = db
      .prepare('INSERT INTO projects (name, target_language, context) VALUES (?, ?, ?)')
      .run(projectName, language, projectContext);
    const projectId = project.lastInsertRowid;

    // ═══ Step 3: TM lookup + DB insert for each segment ═══
    const glossary = ragEngine.glossaryLookup('en', language);

    const insertSegment = db.prepare(`
      INSERT INTO segments (id, project_id, idx, source_text, target_text, original_target, tm_score, match_type, status, violation, format_type, runs_metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)
    `);

    const segmentData = [];
    console.log(`   📊 ${segments.length} segments detected from .${ext} file`);

    // ═══════════════════════════════════════════════════════════
    // Fast TM Lookup — Exact Match Only (instant, no API calls)
    // ═══════════════════════════════════════════════════════════
    //
    // Only does SQLite exact-match lookups (~1ms each).
    // Embedding-based fuzzy matching and LLM translation happen
    // later when the user triggers /api/translate.
    // ═══════════════════════════════════════════════════════════

    const segmentEntries = segments.map((seg, idx) => ({
      idx,
      text: seg.text,
      formatType: seg.formatType,
      runs: seg.runs || null,
      id: randomUUID(),
      tmResult: null,
      resolved: false,
    }));

    for (const entry of segmentEntries) {
      const exact = ragEngine.tmExactLookup(entry.text, 'en', language);
      if (exact) {
        entry.tmResult = { ...exact, latencyMs: 0 };
        entry.resolved = true;
      }
    }

    // Mark all unresolved as NEW (translation happens in /api/translate)
    const unresolved = segmentEntries.filter(e => !e.resolved);
    for (const entry of unresolved) {
      entry.tmResult = { targetText: null, score: 0, matchType: 'NEW', tmRecordId: null, latencyMs: 0 };
      entry.resolved = true;
    }

    const exactCount = segmentEntries.length - unresolved.length;
    console.log(`   ⚡ ${exactCount} exact matches, ${unresolved.length} new — parse complete (no API calls)`);

    // ═══ Insert all segments into DB ═══
    for (const entry of segmentEntries) {
      const tm = entry.tmResult;

      let violation = false;
      if (tm.targetText) {
        const enforcement = ragEngine.glossaryEnforce(entry.text, tm.targetText, glossary);
        violation = enforcement.violated;
      }

      const targetText = tm.targetText || `[Translation pending]`;

      insertSegment.run(
        entry.id, projectId, entry.idx, entry.text, targetText, targetText,
        tm.score, tm.matchType, violation ? 1 : 0, entry.formatType,
        entry.runs ? JSON.stringify(entry.runs) : null
      );

      segmentData.push({
        id: entry.id,
        index: entry.idx,
        sourceText: entry.text,
        targetText,
        tmScore: tm.score,
        matchType: tm.matchType,
        status: 'PENDING',
        violation,
        formatType: entry.formatType,
      });

      const icon = tm.matchType === 'EXACT' ? '✅' : tm.matchType === 'FUZZY' ? '🟡' : '⬜';
      console.log(`   ${icon} [${entry.idx}] ${tm.matchType} (${tm.score}): "${entry.text.substring(0, 50)}..."`);
    }

    console.log(`   📊 Total: ${segmentData.length} segments, ${segmentData.filter(s => s.matchType === 'EXACT').length} exact, ${segmentData.filter(s => s.matchType === 'FUZZY').length} fuzzy`);

    res.json({
      projectId: Number(projectId),
      projectName,
      language,
      segmentCount: segmentData.length,
      segments: segmentData,
      totalSegments: segmentData.length,
      documentName: req.file.originalname,
    });
  } catch (err) {
    console.error('Parse error:', err);
    res.status(500).json({ error: 'Failed to parse document: ' + err.message });
  }
});

export default router;
