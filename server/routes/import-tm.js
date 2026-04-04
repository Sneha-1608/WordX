// ═══════════════════════════════════════════════════════════════
// DeepTrans Feature: TMX/CSV Translation Memory Import
// ═══════════════════════════════════════════════════════════════
//
// Allows uploading industry-standard .tmx files (SDL Trados, memoQ)
// and .csv files to bootstrap the Translation Memory with pre-verified
// translation pairs from professional tools.
//
// ═══════════════════════════════════════════════════════════════

import { Router } from 'express';
import multer from 'multer';
import { XMLParser } from 'fast-xml-parser';
import ragEngine from '../rag-engine.js';
import db from '../db.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

/**
 * POST /api/import-tm
 * 
 * Upload a .tmx or .csv file to import translation memory pairs.
 * 
 * Body (multipart form):
 *   - file: The TMX or CSV file
 *   - sourceLang: Source language code (default: 'en')
 *   - targetLang: Target language code (default: 'hi_IN')
 */
router.post('/', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const sourceLang = req.body.sourceLang || 'en';
    const targetLang = req.body.targetLang || 'hi_IN';
    const ext = req.file.originalname.split('.').pop().toLowerCase();

    if (ext !== 'tmx' && ext !== 'csv') {
      return res.status(400).json({
        error: `Unsupported format: .${ext}. Use .tmx or .csv files.`,
      });
    }

    let imported = 0;
    let total = 0;
    let duplicatesSkipped = 0;

    if (ext === 'tmx') {
      // ═══ TMX Parsing ═══
      const xmlContent = req.file.buffer.toString('utf-8');
      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
      });
      const obj = parser.parse(xmlContent);

      // Navigate to translation units
      let units = obj?.tmx?.body?.tu;
      if (!units) {
        return res.status(400).json({ error: 'Invalid TMX file: no <tu> elements found.' });
      }

      // Normalize to array
      if (!Array.isArray(units)) {
        units = [units];
      }

      total = units.length;

      for (const tu of units) {
        try {
          let tuvs = tu.tuv;
          if (!tuvs) continue;
          if (!Array.isArray(tuvs)) tuvs = [tuvs];

          // Find source and target TUVs by language attribute
          let sourceText = null;
          let targetText = null;

          for (const tuv of tuvs) {
            const lang = tuv['@_xml:lang'] || tuv['@_lang'] || '';
            const segText = typeof tuv.seg === 'string'
              ? tuv.seg
              : (tuv.seg?.['#text'] || String(tuv.seg || ''));

            if (!segText || segText.trim().length === 0) continue;

            // Match source language (compare first 2 chars)
            if (lang.toLowerCase().startsWith(sourceLang.substring(0, 2).toLowerCase())) {
              sourceText = segText.trim();
            }
            // Match target language (compare first 2 chars)
            if (lang.toLowerCase().startsWith(targetLang.substring(0, 2).toLowerCase())) {
              targetText = segText.trim();
            }
          }

          if (sourceText && targetText) {
            // Check for duplicates
            const existing = db.prepare(
              'SELECT id FROM tm_records WHERE source_text = ? AND target_lang = ? LIMIT 1'
            ).get(sourceText, targetLang);

            if (existing) {
              duplicatesSkipped++;
            } else {
              ragEngine.tmWrite(sourceText, targetText, sourceLang, targetLang);
              imported++;
            }
          }
        } catch (tuErr) {
          console.warn(`⚠ Skipped TU: ${tuErr.message}`);
        }
      }
    } else if (ext === 'csv') {
      // ═══ CSV Parsing ═══
      const content = req.file.buffer.toString('utf-8');
      const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);

      total = lines.length;

      for (const line of lines) {
        // Support both comma and tab delimiters
        const parts = line.includes('\t') ? line.split('\t') : line.split(',');
        if (parts.length < 2) continue;

        const sourceText = parts[0].trim().replace(/^["']|["']$/g, '');
        const targetText = parts[1].trim().replace(/^["']|["']$/g, '');

        if (sourceText.length < 2 || targetText.length < 2) continue;

        // Skip header row
        if (sourceText.toLowerCase() === 'source' && targetText.toLowerCase() === 'target') {
          total--;
          continue;
        }

        // Check for duplicates
        const existing = db.prepare(
          'SELECT id FROM tm_records WHERE source_text = ? AND target_lang = ? LIMIT 1'
        ).get(sourceText, targetLang);

        if (existing) {
          duplicatesSkipped++;
        } else {
          ragEngine.tmWrite(sourceText, targetText, sourceLang, targetLang);
          imported++;
        }
      }
    }

    console.log(`📥 TMX/CSV Import: ${imported} new pairs from ${req.file.originalname} (${duplicatesSkipped} duplicates skipped)`);

    res.json({
      imported,
      total,
      duplicatesSkipped,
      sourceLang,
      targetLang,
      filename: req.file.originalname,
    });
  } catch (err) {
    console.error('TMX/CSV import error:', err);
    res.status(500).json({ error: 'Import failed: ' + err.message });
  }
});

export default router;
