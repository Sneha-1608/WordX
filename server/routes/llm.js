import { Router } from 'express';
import llmOrchestrator from '../llm-orchestrator.js';
import { isMockMode } from '../gemini.js';
import { getSarvamStatus, sarvamTranslate, isSarvamAvailable } from '../sarvam.js';
import { getDeeplStatus, deeplTranslate, isDeeplAvailable, getDeeplUsage } from '../deepl.js';

const router = Router();

// ═══════════════════════════════════════════════════════════════
// GET /api/llm/stats — Layer 4 Cost + Performance Metrics
// ═══════════════════════════════════════════════════════════════

router.get('/stats', (req, res) => {
  try {
    const stats = llmOrchestrator.getStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/llm/translate-single — Debug: translate one segment
// ═══════════════════════════════════════════════════════════════

router.post('/translate-single', async (req, res) => {
  try {
    const {
      sourceText,
      sourceLang = 'en',
      targetLang = 'hi_IN',
      context = 'General Business',
      promptVersion,
    } = req.body;

    if (!sourceText) {
      return res.status(400).json({ error: 'sourceText is required' });
    }

    const result = await llmOrchestrator.translateSegment({
      sourceText, sourceLang, targetLang, context, promptVersion,
    });

    res.json({
      query: sourceText,
      ...result,
      mode: isMockMode() ? 'MOCK' : 'LIVE',
    });
  } catch (err) {
    res.status(500).json({ error: 'Translation failed: ' + err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/llm/routing/:lang — Check model routing for a language
// ═══════════════════════════════════════════════════════════════

router.get('/routing/:lang', (req, res) => {
  try {
    const routing = llmOrchestrator.getModelForLanguage(req.params.lang);
    res.json(routing);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// LoRA Adapter CRUD (§4.3)
// ═══════════════════════════════════════════════════════════════

// GET /api/llm/adapters — List all adapters
router.get('/adapters', (req, res) => {
  try {
    const { targetLang } = req.query;
    const adapters = llmOrchestrator.listAdapters(targetLang || null);
    res.json({ adapters, total: adapters.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/llm/adapters — Register new adapter
router.post('/adapters', (req, res) => {
  try {
    const { adapterName, sourceLang, targetLang, baseModel, accuracyBase, accuracyLora, metadata } = req.body;
    if (!adapterName || !targetLang) {
      return res.status(400).json({ error: 'adapterName and targetLang are required' });
    }
    const result = llmOrchestrator.registerAdapter({
      adapterName, sourceLang, targetLang, baseModel, accuracyBase, accuracyLora, metadata,
    });
    res.status(201).json({ success: true, ...result, message: 'Adapter registered' });
  } catch (err) {
    if (err.message?.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Adapter with this name already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/llm/adapters/:id — Update adapter (activate/deactivate)
router.put('/adapters/:id', (req, res) => {
  try {
    const result = llmOrchestrator.updateAdapter(parseInt(req.params.id), req.body);
    if (!result.updated) return res.status(404).json({ error: 'Adapter not found or no changes' });
    res.json({ success: true, message: 'Adapter updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// Cache Management
// ═══════════════════════════════════════════════════════════════

// GET /api/llm/cache/stats — Cache hit rate
router.get('/cache/stats', (req, res) => {
  try {
    const stats = llmOrchestrator.getCacheStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/llm/cache/clear — Clear translation cache
router.post('/cache/clear', (req, res) => {
  try {
    const result = llmOrchestrator.clearCache();
    res.json({ success: true, ...result, message: `Cleared ${result.cleared} cached translations` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// Prompt Templates
// ═══════════════════════════════════════════════════════════════

// GET /api/llm/prompts — List prompt templates
router.get('/prompts', (req, res) => {
  try {
    const prompts = llmOrchestrator.listPrompts();
    res.json(prompts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/llm/prompts/active — Set active prompt version
router.put('/prompts/active', (req, res) => {
  try {
    const { version } = req.body;
    if (!version) return res.status(400).json({ error: 'version is required' });
    const result = llmOrchestrator.setActivePrompt(version);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// Sarvam AI Integration
// ═══════════════════════════════════════════════════════════════

// GET /api/llm/sarvam/status — Sarvam AI connection status
router.get('/sarvam/status', (req, res) => {
  try {
    const status = getSarvamStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/llm/sarvam/translate — Test direct Sarvam translation
router.post('/sarvam/translate', async (req, res) => {
  try {
    const {
      sourceText,
      sourceLang = 'en',
      targetLang = 'hi_IN',
      mode = 'formal',
    } = req.body;

    if (!sourceText) {
      return res.status(400).json({ error: 'sourceText is required' });
    }

    if (!isSarvamAvailable()) {
      return res.status(503).json({
        error: 'Sarvam AI not available. Set SARVAM_API_KEY in .env',
        available: false,
      });
    }

    const start = performance.now();
    const result = await sarvamTranslate(sourceText, sourceLang, targetLang, { mode });
    const elapsed = Math.round(performance.now() - start);

    res.json({
      query: sourceText,
      translation: result.text,
      model: result.model,
      engine: 'sarvam',
      sourceLang: result.sourceLang,
      targetLang: result.targetLang,
      latencyMs: elapsed,
    });
  } catch (err) {
    res.status(500).json({ error: 'Sarvam translation failed: ' + err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// DeepL Integration (Non-Indian Languages)
// ═══════════════════════════════════════════════════════════════

// GET /api/llm/deepl/status — DeepL connection status
router.get('/deepl/status', async (req, res) => {
  try {
    const status = getDeeplStatus();
    const usage = await getDeeplUsage();
    res.json({ ...status, usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/llm/deepl/translate — Test direct DeepL translation
router.post('/deepl/translate', async (req, res) => {
  try {
    const {
      sourceText,
      sourceLang = 'en',
      targetLang = 'fr_FR',
      formality = 'prefer_more',
    } = req.body;

    if (!sourceText) {
      return res.status(400).json({ error: 'sourceText is required' });
    }

    if (!isDeeplAvailable()) {
      return res.status(503).json({
        error: 'DeepL not available. Set DEEPL_API_KEY in .env',
        available: false,
      });
    }

    const start = performance.now();
    const result = await deeplTranslate(sourceText, sourceLang, targetLang, { formality });
    const elapsed = Math.round(performance.now() - start);

    res.json({
      query: sourceText,
      translation: result.text,
      model: result.model,
      engine: 'deepl',
      sourceLang: result.sourceLang,
      targetLang: result.targetLang,
      latencyMs: elapsed,
    });
  } catch (err) {
    res.status(500).json({ error: 'DeepL translation failed: ' + err.message });
  }
});

export default router;
