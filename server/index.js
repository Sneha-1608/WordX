import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import 'dotenv/config';

import parseRouter from './routes/parse.js';
import validateRouter from './routes/validate.js';
import translateRouter from './routes/translate.js';
import approveRouter from './routes/approve.js';
import exportRouter from './routes/export.js';
import ragRouter from './routes/rag.js';
import llmRouter from './routes/llm.js';
import trainingRouter from './routes/training.js';
import analyticsRouter from './routes/analytics.js';
import importTmRouter from './routes/import-tm.js';
import webhookRouter from './routes/webhook.js';
import exportTmRouter from './routes/export-tm.js';
import { errorHandler, requestLogger } from './middleware.js';
import { isMockMode } from './gemini.js';
import { isSarvamAvailable, getSarvamStatus } from './sarvam.js';
import { isIndictransAvailable, getIndictransStatus, checkIndictransHealth } from './indictrans.js';
import ragEngine from './rag-engine.js';
import llmOrchestrator from './llm-orchestrator.js';
import trainingPipeline from './training-pipeline.js';
import db from './db.js';
import {
  joinRoom, leaveRoom, lockSegment, unlockSegment,
  getPresenceSnapshot,
} from './collab-manager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 3001;

// ═══════════════════════════════════════════════════════════════
// Socket.io — Real-Time Collaboration (Improvement 4)
// ═══════════════════════════════════════════════════════════════
let io = null;
try {
  const { Server: SocketIOServer } = await import('socket.io');
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: ['http://localhost:5173', 'http://localhost:3000'],
      methods: ['GET', 'POST'],
    },
    transports: ['websocket', 'polling'],
  });

  io.on('connection', (socket) => {
    console.log(`[WS] Client connected: ${socket.id}`);
    let currentProjectId = null;
    let currentUserId = null;

    socket.on('join_project', ({ projectId, userId, userName }) => {
      currentProjectId = projectId;
      currentUserId = userId;
      socket.join(`project:${projectId}`);
      const presence = joinRoom(projectId, userId, userName, socket.id);
      socket.emit('presence_update', { users: presence });
      socket.to(`project:${projectId}`).emit('user_joined', { userId, userName, activeSegmentId: null });
    });

    socket.on('leave_project', ({ projectId, userId }) => {
      const { releasedSegments } = leaveRoom(projectId, userId);
      socket.leave(`project:${projectId}`);
      releasedSegments.forEach(segId => {
        io.to(`project:${projectId}`).emit('segment_unlocked', { segmentId: segId });
      });
      io.to(`project:${projectId}`).emit('user_left', { userId });
    });

    socket.on('segment_focus', ({ projectId, segmentId, userId, userName }) => {
      const result = lockSegment(projectId, segmentId, userId);
      if (result.success) {
        io.to(`project:${projectId}`).emit('segment_locked', {
          segmentId,
          lockedBy: { userId, userName },
        });
      } else {
        socket.emit('segment_lock_denied', {
          segmentId,
          lockedBy: result.lockedBy,
        });
      }
    });

    socket.on('segment_blur', ({ projectId, segmentId, userId }) => {
      unlockSegment(projectId, segmentId, userId);
      io.to(`project:${projectId}`).emit('segment_unlocked', { segmentId });
    });

    socket.on('segment_updated', ({ projectId, segmentId, newTarget, userId }) => {
      socket.to(`project:${projectId}`).emit('segment_text_changed', {
        segmentId, newTarget, updatedBy: userId,
      });
    });

    socket.on('segment_approved', ({ projectId, segmentId, userId }) => {
      unlockSegment(projectId, segmentId, userId);
      io.to(`project:${projectId}`).emit('segment_status_changed', {
        segmentId, status: 'APPROVED', updatedBy: userId,
      });
    });

    socket.on('segment_rejected', ({ projectId, segmentId, userId }) => {
      unlockSegment(projectId, segmentId, userId);
      io.to(`project:${projectId}`).emit('segment_status_changed', {
        segmentId, status: 'REJECTED', updatedBy: userId,
      });
    });

    socket.on('disconnect', () => {
      console.log(`[WS] Client disconnected: ${socket.id}`);
      if (currentProjectId && currentUserId) {
        const { releasedSegments } = leaveRoom(currentProjectId, currentUserId);
        releasedSegments.forEach(segId => {
          io.to(`project:${currentProjectId}`).emit('segment_unlocked', { segmentId: segId });
        });
        io.to(`project:${currentProjectId}`).emit('user_left', { userId: currentUserId });
      }
    });
  });

  console.log('[WS] Socket.io initialized');
} catch (err) {
  console.warn('[WS] Socket.io not available (install socket.io to enable collaboration):', err.message);
}

export { io };

// ═══════════════════════════════════════════════════════════════
// Middleware
// ═══════════════════════════════════════════════════════════════
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(requestLogger);

// ═══════════════════════════════════════════════════════════════
// API Routes
// ═══════════════════════════════════════════════════════════════
app.use('/api/parse', parseRouter);
app.use('/api/validate', validateRouter);
app.use('/api/translate', translateRouter);
app.use('/api/approve', approveRouter);
app.use('/api/export', exportRouter);
app.use('/api/rag', ragRouter);
app.use('/api/llm', llmRouter);
app.use('/api/training', trainingRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/import-tm', importTmRouter);
app.use('/api/webhook', webhookRouter);
app.use('/api/export-tm', exportTmRouter);

// ═══════════════════════════════════════════════════════════════
// Utility Routes
// ═══════════════════════════════════════════════════════════════

// Get segments for a project
app.get('/api/segments/:projectId', (req, res) => {
  try {
    const segments = db.prepare(
      'SELECT * FROM segments WHERE project_id = ? ORDER BY idx ASC'
    ).all(req.params.projectId);

    const mapped = segments.map((s) => ({
      id: s.id,
      index: s.idx,
      sourceText: s.source_text,
      targetText: s.target_text,
      originalTarget: s.original_target,
      tmScore: s.tm_score,
      matchType: s.match_type,
      status: s.status,
      violation: s.violation === 1,
      formatType: s.format_type || 'paragraph',
    }));

    res.json(mapped);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/segments/:segmentId/history — Audit Trail (Improvement 8)
// ═══════════════════════════════════════════════════════════════
app.get('/api/segments/:segmentId/history', (req, res) => {
  try {
    const segmentId = req.params.segmentId;
    const segment = db.prepare('SELECT * FROM segments WHERE id = ?').get(segmentId);
    if (!segment) return res.status(404).json({ error: 'Segment not found' });

    const revisions = db.prepare(
      `SELECT id, original_output, human_revision, edit_distance, editor_id, created_at
       FROM revisions WHERE segment_id = ? ORDER BY created_at DESC`
    ).all(segmentId);

    const tmEntries = db.prepare(
      `SELECT id, source_text, target_text, approved_at, approved_by, context
       FROM tm_records WHERE source_text = ? AND target_lang = ?
       ORDER BY approved_at DESC LIMIT 10`
    ).all(segment.source_text, segment.target_text ? 'hi_IN' : 'hi_IN');

    res.json({
      segmentId,
      sourceText: segment.source_text,
      currentTarget: segment.target_text,
      status: segment.status,
      matchType: segment.match_type,
      createdAt: segment.created_at,
      updatedAt: segment.updated_at,
      revisions,
      tmEntries,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/preview/:projectId — In-Context DOCX Preview (Improvement 4)
// ═══════════════════════════════════════════════════════════════
app.get('/api/preview/:projectId', (req, res) => {
  try {
    const projectId = req.params.projectId;
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const segments = db.prepare(
      'SELECT * FROM segments WHERE project_id = ? ORDER BY idx ASC'
    ).all(projectId);

    // Render an HTML preview that shows source ↔ target in document layout
    const pages = [];
    let currentPage = { paragraphs: [] };
    const SEGMENTS_PER_PAGE = 20;

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      currentPage.paragraphs.push({
        id: seg.id,
        index: seg.idx,
        sourceText: seg.source_text,
        targetText: seg.target_text || '',
        status: seg.status,
        matchType: seg.match_type,
        formatType: seg.format_type || 'paragraph',
      });

      if (currentPage.paragraphs.length >= SEGMENTS_PER_PAGE) {
        pages.push(currentPage);
        currentPage = { paragraphs: [] };
      }
    }
    if (currentPage.paragraphs.length > 0) pages.push(currentPage);

    res.json({
      projectId: Number(projectId),
      projectName: project.name,
      sourceLanguage: project.source_language,
      targetLanguage: project.target_language,
      totalSegments: segments.length,
      totalPages: pages.length,
      pages,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get QA results for a project (DeepTrans Feature)
app.get('/api/qa-results/:projectId', (req, res) => {
  try {
    const results = db.prepare(
      'SELECT * FROM qa_results WHERE project_id = ? ORDER BY id DESC'
    ).all(req.params.projectId);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get glossary
app.get('/api/glossary/:language', (req, res) => {
  try {
    const terms = db.prepare(
      'SELECT source_term as source, target_term as target FROM glossary WHERE language = ?'
    ).all(req.params.language);
    res.json(terms);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all projects
app.get('/api/projects', (req, res) => {
  try {
    const projects = db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all();
    res.json(projects);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get supported languages (grouped by region)
app.get('/api/languages', (req, res) => {
  const languages = [
    // Source languages
    { code: 'en', name: 'English', region: 'source', flag: '🇬🇧' },

    // Indian languages
    { code: 'hi_IN', name: 'Hindi', region: 'indian', flag: '🇮🇳' },
    { code: 'bn_IN', name: 'Bengali', region: 'indian', flag: '🇮🇳' },
    { code: 'ta_IN', name: 'Tamil', region: 'indian', flag: '🇮🇳' },
    { code: 'te_IN', name: 'Telugu', region: 'indian', flag: '🇮🇳' },
    { code: 'mr_IN', name: 'Marathi', region: 'indian', flag: '🇮🇳' },
    { code: 'gu_IN', name: 'Gujarati', region: 'indian', flag: '🇮🇳' },
    { code: 'kn_IN', name: 'Kannada', region: 'indian', flag: '🇮🇳' },
    { code: 'ml_IN', name: 'Malayalam', region: 'indian', flag: '🇮🇳' },
    { code: 'pa_IN', name: 'Punjabi', region: 'indian', flag: '🇮🇳' },
    { code: 'or_IN', name: 'Odia', region: 'indian', flag: '🇮🇳' },
    { code: 'as_IN', name: 'Assamese', region: 'indian', flag: '🇮🇳' },
    { code: 'ur_PK', name: 'Urdu', region: 'indian', flag: '🇵🇰' },
    { code: 'ne_NP', name: 'Nepali', region: 'indian', flag: '🇳🇵' },
    { code: 'sa_IN', name: 'Sanskrit', region: 'indian', flag: '🇮🇳' },
    { code: 'mai_IN', name: 'Maithili', region: 'indian', flag: '🇮🇳' },
    { code: 'kok_IN', name: 'Konkani', region: 'indian', flag: '🇮🇳' },
    { code: 'doi_IN', name: 'Dogri', region: 'indian', flag: '🇮🇳' },
    { code: 'sd_IN', name: 'Sindhi', region: 'indian', flag: '🇮🇳' },
    { code: 'ks_IN', name: 'Kashmiri', region: 'indian', flag: '🇮🇳' },
    { code: 'mni_IN', name: 'Manipuri', region: 'indian', flag: '🇮🇳' },
    { code: 'brx_IN', name: 'Bodo', region: 'indian', flag: '🇮🇳' },
    { code: 'sat_IN', name: 'Santali', region: 'indian', flag: '🇮🇳' },
    { code: 'si_LK', name: 'Sinhala', region: 'indian', flag: '🇱🇰' },

    // European languages
    { code: 'es_ES', name: 'Spanish', region: 'european', flag: '🇪🇸' },
    { code: 'fr_FR', name: 'French', region: 'european', flag: '🇫🇷' },
    { code: 'de_DE', name: 'German', region: 'european', flag: '🇩🇪' },
    { code: 'it_IT', name: 'Italian', region: 'european', flag: '🇮🇹' },
    { code: 'pt_BR', name: 'Portuguese', region: 'european', flag: '🇧🇷' },
    { code: 'nl_NL', name: 'Dutch', region: 'european', flag: '🇳🇱' },
    { code: 'ru_RU', name: 'Russian', region: 'european', flag: '🇷🇺' },
    { code: 'pl_PL', name: 'Polish', region: 'european', flag: '🇵🇱' },
    { code: 'sv_SE', name: 'Swedish', region: 'european', flag: '🇸🇪' },
    { code: 'tr_TR', name: 'Turkish', region: 'european', flag: '🇹🇷' },

    // East Asian languages
    { code: 'ja_JP', name: 'Japanese', region: 'asian', flag: '🇯🇵' },
    { code: 'ko_KR', name: 'Korean', region: 'asian', flag: '🇰🇷' },
    { code: 'zh_CN', name: 'Chinese', region: 'asian', flag: '🇨🇳' },

    // Other languages
    { code: 'ar_SA', name: 'Arabic', region: 'other', flag: '🇸🇦' },
    { code: 'th_TH', name: 'Thai', region: 'other', flag: '🇹🇭' },
    { code: 'vi_VN', name: 'Vietnamese', region: 'other', flag: '🇻🇳' },
  ];
  res.json(languages);
});

// Health check — powered by ragEngine + llmOrchestrator
app.get('/api/health', (req, res) => {
  const layer3 = ragEngine.getStats();
  const layer4 = llmOrchestrator.getStats();
  const layer5 = trainingPipeline.getPipelineStatus();
  res.json({
    status: 'ok',
    mode: layer3.mode,
    tmRecords: layer3.tm.total,
    embeddedTM: layer3.tm.embedded,
    glossaryTerms: layer3.glossary.total,
    revisions: layer3.revisions.total,
    styleProfiles: layer3.styleProfiles,
    llmCalls: layer4.calls.total,
    tokensUsed: layer4.tokens.total,
    estimatedCost: layer4.cost.estimatedUSD,
    cacheHitRate: layer4.cache.hitRate,
    activeAdapters: layer4.adapters.active,
    layer3,
    layer4,
    layer5,
  });
});

// Style profiles endpoint
app.get('/api/style-profiles', (req, res) => {
  try {
    const profiles = db.prepare('SELECT * FROM style_profiles ORDER BY id ASC').all();
    res.json(profiles);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// TM records endpoint 
app.get('/api/tm-records/:language', (req, res) => {
  try {
    const records = db.prepare(
      'SELECT id, source_text, target_text, source_lang, target_lang, context, approved_at, embedding IS NOT NULL as has_embedding FROM tm_records WHERE language = ? ORDER BY id ASC'
    ).all(req.params.language);
    res.json(records);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// Health Check — Infrastructure Status (Improvement 3 & 4)
// ═══════════════════════════════════════════════════════════════
app.get('/api/health', async (req, res) => {
  try {
    const { getRedisStatus } = await import('./cache-redis.js');
    const { getPgvectorStatus, getEmbeddingCount } = await import('./vector-pg.js');
    const redisStatus = getRedisStatus();
    const pgStatus = getPgvectorStatus();
    const embeddingCount = await getEmbeddingCount();

    res.json({
      status: 'ok',
      uptime: process.uptime(),
      redis: redisStatus,
      pgvector: { ...pgStatus, embeddingCount },
      socketio: { active: !!io, connectedClients: io ? io.engine?.clientsCount || 0 : 0 },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      redis: { enabled: false },
      pgvector: { enabled: false },
      socketio: { active: !!io },
      error: err.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// Error Handler (must be last)
// ═══════════════════════════════════════════════════════════════
app.use(errorHandler);

httpServer.listen(PORT, async () => {
  const mode = isMockMode() ? '🟡 MOCK MODE' : '🟢 LIVE (Gemini API)';
  const l3 = ragEngine.getStats();
  const l4 = llmOrchestrator.getStats();
  const l5 = trainingPipeline.getPipelineStatus();

  const sarvam = isSarvamAvailable();
  const sarvamStatus = sarvam ? '🇮🇳 SARVAM AI CONNECTED' : '⚪ Sarvam unavailable (Gemini fallback)';

  // Check IndicTrans2 microservice
  const itHealth = await checkIndictransHealth();
  const itAvailable = isIndictransAvailable();
  const itStatus = itAvailable
    ? `🧠 INDICTRANS2 LOCAL ENGINE (${itHealth?.device?.toUpperCase() || 'CUDA'}) — 22 languages`
    : '⚪ IndicTrans2 not running (start: npm run indictrans)';

  // Determine Indic engine priority
  const indicEngineLine = itAvailable
    ? `indictrans2-en-indic-dist-200M (LOCAL ${itHealth?.device?.toUpperCase() || 'GPU'}) → sarvam fallback`
    : sarvam
      ? 'sarvam-translate:v1 (22 languages)'
      : 'gemini-2.0-flash';

  console.log(`\n  ═══════════════════════════════════════════════════`);
  console.log(`  ${mode}`);
  console.log(`  ${itStatus}`);
  console.log(`  ${sarvamStatus}`);
  console.log(`  🌐 ClearLingo API Gateway — http://localhost:${PORT}`);
  console.log(`  ═══════════════════════════════════════════════════`);
  console.log(`\n  📦 Layer 3 — RAG Engine`);
  console.log(`     TM Records: ${l3.tm.total} (${l3.tm.embedded} embedded)`);
  console.log(`     Glossary: ${l3.glossary.total} terms (${l3.glossary.mandatory} mandatory)`);
  console.log(`     Revisions: ${l3.revisions.total} | Style Profiles: ${l3.styleProfiles}`);
  console.log(`\n  🧠 Layer 4 — LLM Orchestrator`);
  console.log(`     Indic:    ${indicEngineLine}`);
  console.log(`     European: gemini-2.0-flash`);
  console.log(`     Prompt: ${l4.activePrompt}`);
  console.log(`     LoRA Adapters: ${l4.adapters.total} (${l4.adapters.active} active)`);
  console.log(`     LLM Calls: ${l4.calls.total} | Tokens: ${l4.tokens.total}`);
  console.log(`     Cache: ${l4.cache.entries} entries | Cost: $${l4.cost.estimatedUSD}`);
  console.log(`\n  🏋️ Layer 5 — Training Pipeline`);
  console.log(`     Mode: ${l5.mode}`);
  console.log(`     Revisions: ${l5.collection.totalRevisions} (${l5.collection.progress}% to threshold)`);
  console.log(`     Datasets: ${l5.datasets.total} | Runs: ${l5.training.totalRuns} | A/B Tests: ${l5.abTesting.totalTests}`);
  console.log(`     Active Adapters: ${l5.activeAdapters.length}`);
  console.log(`\n  📡 Routes:`);
  console.log(`     POST /api/parse           — Multi-format parsing + TM lookup`);
  console.log(`     POST /api/validate        — 5-point quality engine`);
  console.log(`     POST /api/translate       — Full RAG → LLM pipeline`);
  console.log(`     POST /api/approve         — Atomic TM write + revision`);
  console.log(`     POST /api/export          — Format-preserved DOCX export`);
  console.log(`     POST /api/rag/search      — Standalone TM semantic search`);
  console.log(`     GET  /api/rag/stats       — Layer 3 performance metrics`);
  console.log(`     GET  /api/llm/stats       — Layer 4 cost + token metrics`);
  console.log(`     POST /api/llm/translate-single — Debug single-segment`);
  console.log(`     GET  /api/llm/sarvam/status    — Sarvam AI status`);
  console.log(`     GET  /api/llm/adapters     — LoRA adapter registry`);
  console.log(`     GET  /api/llm/cache/stats  — Translation cache stats`);
  console.log(`     POST /api/training/extract — Extract training dataset`);
  console.log(`     POST /api/training/start   — Start QLoRA training run`);
  console.log(`     GET  /api/training/runs/:id/stream — SSE training stream`);
  console.log(`     GET  /api/training/status  — Pipeline dashboard`);
  console.log(`     GET  /api/analytics/dashboard — Layer 6 live dashboard`);
  console.log(`     GET  /api/analytics/leverage  — TM leverage rate`);
  console.log(`     GET  /api/analytics/compliance — Glossary compliance`);
  console.log(`     GET  /api/analytics/cost       — Cost savings metrics`);
  console.log(`     POST /api/import-tm         — TMX/CSV translation memory import`);
  console.log(`     GET  /api/qa-results/:id     — QA audit results per project`);
  console.log(`     GET  /api/health           — Full system status\n`);

  // ═══ §3.1.1: Seed embeddings via ragEngine ═══
  if (l3.tm.unembedded > 0) {
    const result = await ragEngine.backfillEmbeddings(null, 'General Business');
    console.log(`  ✅ Startup backfill: ${result.backfilled}/${result.total} TM records embedded\n`);
  }
});


