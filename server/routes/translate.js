import { Router } from 'express';
import llmOrchestrator from '../llm-orchestrator.js';
import ragEngine from '../rag-engine.js';
import db from '../db.js';
import { isMockMode } from '../gemini.js';
import { isLanguageSupported } from '../middleware.js';

const router = Router();

// ═══════════════════════════════════════════════════════════════
// POST /api/translate — Full RAG → LLM Translation Pipeline
//
// Layer 3 (RAG Engine) handles TM lookup → glossary → style.
// Layer 4 (LLM Orchestrator) handles LLM calls → caching → cost.
// This route is now a thin controller delegating to translateBatch().
// ═══════════════════════════════════════════════════════════════

router.post('/', async (req, res) => {
  try {
    const {
      projectId,
      segments: inputSegments,
      sourceLang = 'en',
      targetLang = 'hi_IN',
    } = req.body;

    if (!projectId) {
      return res.status(400).json({ error: 'projectId required' });
    }

    if (!isLanguageSupported(targetLang)) {
      const routing = llmOrchestrator.getModelForLanguage(targetLang);
      return res.status(400).json({
        error: `Unsupported language: ${targetLang}`,
        routing,
      });
    }

    // ═══ Delegate entire pipeline to Layer 4 Orchestrator ═══
    const result = await llmOrchestrator.translateBatch({
      projectId,
      segments: inputSegments,
      sourceLang,
      targetLang,
    });

    res.json(result);
  } catch (err) {
    console.error('Translation pipeline error:', err);
    res.status(500).json({ error: 'Translation failed: ' + err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/translate/stream — SSE Streaming Translation (Improvement 5)
//
// Same payload as /api/translate but responses arrive per-segment
// via Server-Sent Events for progressive rendering.
// ═══════════════════════════════════════════════════════════════

router.post('/stream', async (req, res) => {
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const { projectId, segments, targetLang = 'hi_IN', sourceLang = 'en', styleProfile, context } = req.body;

  if (!segments || !Array.isArray(segments)) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: 'segments array required' })}\n\n`);
    return res.end();
  }

  // Emit a start event with total count
  res.write(`data: ${JSON.stringify({ type: 'start', total: segments.length })}\n\n`);

  let completed = 0;
  const errors = [];

  // Load project context + style profile
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  const projectContext = project?.context || context || 'General Business';
  const profileName = project?.style_profile || styleProfile || 'professional';
  const { promptText: stylePromptText } = ragEngine.styleProfileGet(profileName);
  const glossary = ragEngine.glossaryLookup(sourceLang, targetLang);

  // Process segments CONCURRENTLY with a concurrency limit of 5
  const CONCURRENCY = 5;
  const queue = [...segments];
  let active = 0;

  await new Promise((resolve) => {
    function processNext() {
      while (active < CONCURRENCY && queue.length > 0) {
        const segment = queue.shift();
        active++;

        (async () => {
          try {
            // First try exact TM lookup (instant)
            const exactResult = ragEngine.tmExactLookup(segment.sourceText || segment.source_text, sourceLang, targetLang);

            if (exactResult) {
              // Update DB
              db.prepare(
                `UPDATE segments SET target_text = ?, original_target = ?, tm_score = ?, match_type = 'EXACT' WHERE id = ?`
              ).run(exactResult.targetText, exactResult.targetText, exactResult.score, segment.id);

              completed++;
              res.write(`data: ${JSON.stringify({
                type: 'segment_done',
                segmentId: segment.id,
                idx: segment.idx ?? segment.index,
                translatedText: exactResult.targetText,
                matchType: 'EXACT',
                tmScore: exactResult.score,
                model: null,
                cost: 0,
                current: completed,
                total: segments.length,
              })}\n\n`);
            } else {
              // Full LLM translation
              const sourceText = segment.sourceText || segment.source_text;
              const relevantGlossary = glossary.filter((term) =>
                new RegExp(`\\b${term.source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(sourceText)
              );

              const llmResult = await llmOrchestrator.translateSegment({
                sourceText,
                sourceLang,
                targetLang,
                context: projectContext,
                stylePrompt: stylePromptText,
                glossaryTerms: relevantGlossary,
                segmentId: segment.id,
                projectId,
              });

              const matchType = llmResult.cached ? 'FUZZY' : 'NEW';

              // Update DB
              db.prepare(
                `UPDATE segments SET target_text = ?, original_target = ?, tm_score = ?, match_type = ? WHERE id = ?`
              ).run(llmResult.targetText, llmResult.targetText, 0, matchType, segment.id);

              completed++;
              res.write(`data: ${JSON.stringify({
                type: 'segment_done',
                segmentId: segment.id,
                idx: segment.idx ?? segment.index,
                translatedText: llmResult.targetText,
                matchType,
                tmScore: 0,
                model: llmResult.model,
                cost: llmResult.estimatedCost ?? 0,
                current: completed,
                total: segments.length,
              })}\n\n`);
            }
          } catch (err) {
            completed++;
            errors.push({ segmentId: segment.id, error: err.message });
            res.write(`data: ${JSON.stringify({
              type: 'segment_error',
              segmentId: segment.id,
              idx: segment.idx ?? segment.index,
              error: err.message,
              current: completed,
              total: segments.length,
            })}\n\n`);
          } finally {
            active--;
            processNext();
            if (active === 0 && queue.length === 0) resolve();
          }
        })();
      }
      // Handle empty queue case
      if (active === 0 && queue.length === 0) resolve();
    }
    processNext();
  });

  // Emit completion summary
  res.write(`data: ${JSON.stringify({
    type: 'complete',
    total: segments.length,
    errors: errors.length,
    errorDetails: errors,
  })}\n\n`);

  res.end();
});

export default router;
