import { Router } from 'express';
import ragEngine from '../rag-engine.js';
import { isMockMode } from '../gemini.js';

const router = Router();

// ═══════════════════════════════════════════════════════════════
// GET /api/rag/stats — Layer 3 Health & Performance Metrics
// ═══════════════════════════════════════════════════════════════

router.get('/stats', (req, res) => {
  try {
    const stats = ragEngine.getStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/rag/search — Standalone Three-Tier TM Search
// ═══════════════════════════════════════════════════════════════

router.post('/search', async (req, res) => {
  try {
    const {
      sourceText,
      sourceLang = 'en',
      targetLang = 'hi_IN',
      context = 'General Business',
    } = req.body;

    if (!sourceText) {
      return res.status(400).json({ error: 'sourceText is required' });
    }

    const result = await ragEngine.tmLookup(sourceText, sourceLang, targetLang, context);

    res.json({
      query: sourceText,
      ...result,
      mode: isMockMode() ? 'MOCK' : 'LIVE',
    });
  } catch (err) {
    res.status(500).json({ error: 'TM search failed: ' + err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// TM Record CRUD
// ═══════════════════════════════════════════════════════════════

// GET /api/rag/tm — List TM Records
router.get('/tm', (req, res) => {
  try {
    const { targetLang = 'hi_IN', limit = 100, offset = 0 } = req.query;
    const result = ragEngine.tmList(targetLang, parseInt(limit), parseInt(offset));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/rag/tm/:id — Get Single TM Record
router.get('/tm/:id', (req, res) => {
  try {
    const record = ragEngine.tmGet(parseInt(req.params.id));
    if (!record) return res.status(404).json({ error: 'TM record not found' });
    res.json(record);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/rag/tm — Add TM Record (with auto-embedding)
router.post('/tm', async (req, res) => {
  try {
    const {
      sourceText, targetText,
      sourceLang = 'en', targetLang = 'hi_IN',
      context = 'General Business',
      projectId = null, approvedBy = 'admin',
    } = req.body;

    if (!sourceText || !targetText) {
      return res.status(400).json({ error: 'sourceText and targetText are required' });
    }

    const result = await ragEngine.tmWrite({
      sourceText, targetText, sourceLang, targetLang,
      context, projectId, approvedBy,
    });

    res.status(201).json({
      success: true,
      ...result,
      message: result.isNew ? 'TM record created' : 'TM record updated',
    });
  } catch (err) {
    res.status(500).json({ error: 'TM write failed: ' + err.message });
  }
});

// PUT /api/rag/tm/:id — Update TM Record
router.put('/tm/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const existing = ragEngine.tmGet(id);
    if (!existing) return res.status(404).json({ error: 'TM record not found' });

    const {
      sourceText = existing.source_text,
      targetText = existing.target_text,
      sourceLang = existing.source_lang,
      targetLang = existing.target_lang,
      context = existing.context,
    } = req.body;

    // Delete old and re-insert to regenerate embedding
    ragEngine.tmDelete(id);
    const result = await ragEngine.tmWrite({
      sourceText, targetText, sourceLang, targetLang, context,
    });

    res.json({ success: true, ...result, message: 'TM record updated with new embedding' });
  } catch (err) {
    res.status(500).json({ error: 'TM update failed: ' + err.message });
  }
});

// DELETE /api/rag/tm/:id — Delete TM Record
router.delete('/tm/:id', (req, res) => {
  try {
    const result = ragEngine.tmDelete(parseInt(req.params.id));
    if (!result.deleted) return res.status(404).json({ error: 'TM record not found' });
    res.json({ success: true, message: 'TM record deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// Glossary CRUD
// ═══════════════════════════════════════════════════════════════

// GET /api/rag/glossary — List Glossary Terms
router.get('/glossary', (req, res) => {
  try {
    const { sourceLang = 'en', targetLang = 'hi_IN', domain } = req.query;
    const terms = ragEngine.glossaryLookup(sourceLang, targetLang, domain || null);
    res.json({ terms, total: terms.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/rag/glossary — Add Glossary Term
router.post('/glossary', (req, res) => {
  try {
    const { sourceTerm, targetTerm, sourceLang, targetLang, domain, isMandatory } = req.body;
    if (!sourceTerm || !targetTerm) {
      return res.status(400).json({ error: 'sourceTerm and targetTerm are required' });
    }
    const result = ragEngine.glossaryAdd({ sourceTerm, targetTerm, sourceLang, targetLang, domain, isMandatory });
    res.status(201).json({ success: true, ...result, message: 'Glossary term added' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/rag/glossary/:id — Update Glossary Term
router.put('/glossary/:id', (req, res) => {
  try {
    const result = ragEngine.glossaryUpdate(parseInt(req.params.id), req.body);
    if (!result.updated) return res.status(404).json({ error: 'Glossary term not found or no changes' });
    res.json({ success: true, message: 'Glossary term updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/rag/glossary/:id — Delete Glossary Term
router.delete('/glossary/:id', (req, res) => {
  try {
    const result = ragEngine.glossaryDelete(parseInt(req.params.id));
    if (!result.deleted) return res.status(404).json({ error: 'Glossary term not found' });
    res.json({ success: true, message: 'Glossary term deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/rag/glossary/enforce — Test Glossary Enforcement
router.post('/glossary/enforce', (req, res) => {
  try {
    const { sourceText, targetText, sourceLang = 'en', targetLang = 'hi_IN' } = req.body;
    if (!sourceText || !targetText) {
      return res.status(400).json({ error: 'sourceText and targetText are required' });
    }
    const terms = ragEngine.glossaryLookup(sourceLang, targetLang);
    const result = ragEngine.glossaryEnforce(sourceText, targetText, terms);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// Style Profiles
// ═══════════════════════════════════════════════════════════════

// GET /api/rag/style-profiles — List All
router.get('/style-profiles', (req, res) => {
  try {
    const profiles = ragEngine.styleProfileList();
    res.json(profiles);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/rag/style-profiles/:name — Get By Name (with prompt text)
router.get('/style-profiles/:name', (req, res) => {
  try {
    const result = ragEngine.styleProfileGet(req.params.name);
    if (!result.profile) return res.status(404).json({ error: 'Style profile not found' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/rag/style-profiles — Add Style Profile
router.post('/style-profiles', (req, res) => {
  try {
    const { profileName, tone, formality, targetLang, rules, description } = req.body;
    if (!profileName || !tone) {
      return res.status(400).json({ error: 'profileName and tone are required' });
    }
    const result = ragEngine.styleProfileAdd({ profileName, tone, formality, targetLang, rules, description });
    res.status(201).json({ success: true, ...result, message: 'Style profile created' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/rag/style-profiles/:id — Update Style Profile
router.put('/style-profiles/:id', (req, res) => {
  try {
    const result = ragEngine.styleProfileUpdate(parseInt(req.params.id), req.body);
    if (!result.updated) return res.status(404).json({ error: 'Style profile not found or no changes' });
    res.json({ success: true, message: 'Style profile updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// Revisions & Analytics
// ═══════════════════════════════════════════════════════════════

// GET /api/rag/revisions/analytics — Revision Analytics
router.get('/revisions/analytics', (req, res) => {
  try {
    const { projectId } = req.query;
    const analytics = ragEngine.revisionAnalytics(projectId ? parseInt(projectId) : null);
    res.json(analytics);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// Embedding Backfill
// ═══════════════════════════════════════════════════════════════

// POST /api/rag/backfill-embeddings — Trigger On-Demand Backfill
router.post('/backfill-embeddings', async (req, res) => {
  try {
    const { targetLang = null, context = 'General Business' } = req.body;
    const result = await ragEngine.backfillEmbeddings(targetLang, context);
    res.json({
      success: true,
      ...result,
      message: `Backfilled ${result.backfilled} of ${result.total} records`,
    });
  } catch (err) {
    res.status(500).json({ error: 'Backfill failed: ' + err.message });
  }
});

export default router;
