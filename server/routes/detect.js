// ═══════════════════════════════════════════════════════════════
// POST /api/detect — Standalone Language Detection Endpoint
// ═══════════════════════════════════════════════════════════════
//
// Accepts an array of text segments (max 500) and returns the
// detected source language, confidence, and script for each.
//
// Request body:
//   { segments: string[] }
//
// Response:
//   { results: [{ text, language, confidence, script, displayName }] }
//
// ═══════════════════════════════════════════════════════════════

import { Router } from 'express';
import { detectLanguageBatch, getLanguageDisplayName } from '../language-detector.js';

const router = Router();

const MAX_SEGMENTS = 500;

router.post('/', async (req, res) => {
  try {
    const { segments } = req.body;

    // ═══ Input Validation ═══
    if (!segments || !Array.isArray(segments)) {
      return res.status(400).json({
        error: 'segments array required',
        hint: 'POST { "segments": ["Hello world", "नमस्ते दुनिया"] }',
      });
    }

    if (segments.length === 0) {
      return res.json({ results: [], summary: [] });
    }

    if (segments.length > MAX_SEGMENTS) {
      return res.status(400).json({
        error: `Too many segments: ${segments.length}. Maximum is ${MAX_SEGMENTS}.`,
      });
    }

    // Validate each segment is a string
    for (let i = 0; i < segments.length; i++) {
      if (typeof segments[i] !== 'string') {
        return res.status(400).json({
          error: `segments[${i}] must be a string, got ${typeof segments[i]}`,
        });
      }
    }

    // ═══ Run batch detection ═══
    const detectionResults = await detectLanguageBatch(segments);

    // ═══ Build response ═══
    const results = detectionResults.map((det, i) => ({
      text: segments[i].substring(0, 100) + (segments[i].length > 100 ? '...' : ''),
      language: det.language,
      confidence: det.confidence,
      script: det.script,
      displayName: getLanguageDisplayName(det.language),
    }));

    // ═══ Build summary (grouped by language) ═══
    const langCounts = {};
    for (const det of results) {
      const lang = det.language;
      if (!langCounts[lang]) {
        langCounts[lang] = {
          language: lang,
          displayName: det.displayName,
          segmentCount: 0,
          avgConfidence: 0,
          totalConfidence: 0,
        };
      }
      langCounts[lang].segmentCount++;
      langCounts[lang].totalConfidence += det.confidence;
    }

    const summary = Object.values(langCounts)
      .map(entry => ({
        language: entry.language,
        displayName: entry.displayName,
        segmentCount: entry.segmentCount,
        avgConfidence: Math.round((entry.totalConfidence / entry.segmentCount) * 100) / 100,
      }))
      .sort((a, b) => b.segmentCount - a.segmentCount);

    res.json({
      total: results.length,
      results,
      summary,
    });
  } catch (err) {
    console.error('Language detection error:', err);
    res.status(500).json({ error: 'Detection failed: ' + err.message });
  }
});

export default router;
