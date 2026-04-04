import { Router } from 'express';
import { randomUUID } from 'crypto';
import db from '../db.js';

const router = Router();

// ═══════════════════════════════════════════════════════════════
// POST /api/webhook/ingest — CMS Webhook Connector (Improvement 1)
//
// Accepts a CMS content payload, creates a translation project,
// and queues it for async processing.
// ═══════════════════════════════════════════════════════════════

router.post('/ingest', async (req, res) => {
  try {
    const {
      content_id,
      source_text,
      source_lang = 'en',
      target_langs = ['hi_IN'],
      callback_url,
      callback_secret,
      project_name,
      context = 'General Business',
      style_profile = 'professional',
    } = req.body;

    if (!source_text) {
      return res.status(400).json({ error: 'source_text is required' });
    }

    if (!Array.isArray(target_langs) || target_langs.length === 0) {
      return res.status(400).json({ error: 'target_langs must be a non-empty array' });
    }

    const jobId = randomUUID();
    const projectName = project_name || `Webhook: ${content_id || jobId.slice(0, 8)}`;

    // Create project
    const pResult = db.prepare(
      `INSERT INTO projects (name, source_language, target_language, style_profile, context)
       VALUES (?, ?, ?, ?, ?)`
    ).run(projectName, source_lang, target_langs[0], style_profile, context);

    const projectId = Number(pResult.lastInsertRowid);

    // Create webhook job
    db.prepare(
      `INSERT INTO webhook_jobs (id, project_id, content_id, callback_url, callback_secret, status)
       VALUES (?, ?, ?, ?, ?, 'queued')`
    ).run(jobId, String(projectId), content_id, callback_url, callback_secret);

    // Parse source text into segments (simple sentence splitter)
    const sentences = source_text
      .split(/(?<=[.!?।])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const insertSegment = db.prepare(
      `INSERT INTO segments (id, project_id, idx, source_text, target_text, original_target, status, match_type)
       VALUES (?, ?, ?, ?, '', '', 'PENDING', 'NEW')`
    );

    const insertSegments = db.transaction(() => {
      sentences.forEach((text, i) => {
        const segId = `${jobId}-seg-${String(i + 1).padStart(4, '0')}`;
        insertSegment.run(segId, projectId, i + 1, text);
      });
    });
    insertSegments();

    // Update job status
    db.prepare(`UPDATE webhook_jobs SET status = 'processing' WHERE id = ?`).run(jobId);

    // Start async translation (fire-and-forget)
    processWebhookJob(jobId, projectId, source_lang, target_langs).catch((err) => {
      console.error(`[Webhook] Job ${jobId} failed:`, err);
      db.prepare(`UPDATE webhook_jobs SET status = 'failed', error = ? WHERE id = ?`).run(err.message, jobId);
    });

    res.status(202).json({
      jobId,
      projectId,
      status: 'queued',
      segmentCount: sentences.length,
      targetLangs: target_langs,
      message: 'Translation job queued. Poll GET /api/webhook/status/:jobId for progress.',
    });
  } catch (err) {
    console.error('[Webhook] Ingest error:', err);
    res.status(500).json({ error: 'Webhook ingest failed: ' + err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/webhook/status/:jobId — Job Status Polling
// ═══════════════════════════════════════════════════════════════

router.get('/status/:jobId', (req, res) => {
  try {
    const job = db.prepare('SELECT * FROM webhook_jobs WHERE id = ?').get(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const segments = db.prepare(
      `SELECT status, COUNT(*) as count FROM segments WHERE project_id = ? GROUP BY status`
    ).all(job.project_id);

    const total = segments.reduce((sum, s) => sum + s.count, 0);
    const approved = segments.find((s) => s.status === 'APPROVED')?.count || 0;
    const pending = segments.find((s) => s.status === 'PENDING')?.count || 0;

    res.json({
      jobId: job.id,
      projectId: job.project_id,
      contentId: job.content_id,
      status: job.status,
      callbackStatus: job.callback_status,
      error: job.error,
      segments: { total, approved, pending },
      progress: total > 0 ? Math.round(((total - pending) / total) * 100) : 0,
      createdAt: job.created_at,
      completedAt: job.completed_at,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/webhook/jobs — List All Webhook Jobs
// ═══════════════════════════════════════════════════════════════

router.get('/jobs', (req, res) => {
  try {
    const jobs = db.prepare('SELECT * FROM webhook_jobs ORDER BY created_at DESC LIMIT 100').all();
    res.json(jobs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// Async Translation Processor
// ═══════════════════════════════════════════════════════════════

async function processWebhookJob(jobId, projectId, sourceLang, targetLangs) {
  try {
    const llmOrchestrator = (await import('../llm-orchestrator.js')).default;

    const segments = db.prepare(
      `SELECT id, idx, source_text as sourceText FROM segments WHERE project_id = ? ORDER BY idx`
    ).all(projectId);

    for (const targetLang of targetLangs) {
      await llmOrchestrator.translateBatch({
        projectId,
        segments,
        sourceLang,
        targetLang,
      });
    }

    // Mark complete
    db.prepare(
      `UPDATE webhook_jobs SET status = 'completed', completed_at = datetime('now') WHERE id = ?`
    ).run(jobId);

    // Fire callback if configured
    const job = db.prepare('SELECT * FROM webhook_jobs WHERE id = ?').get(jobId);
    if (job.callback_url) {
      try {
        const result = await fetch(job.callback_url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(job.callback_secret ? { 'X-Webhook-Secret': job.callback_secret } : {}),
          },
          body: JSON.stringify({
            jobId,
            projectId,
            status: 'completed',
            contentId: job.content_id,
          }),
        });
        db.prepare(`UPDATE webhook_jobs SET callback_status = ? WHERE id = ?`).run(
          result.ok ? 'delivered' : `failed:${result.status}`,
          jobId
        );
      } catch (cbErr) {
        db.prepare(`UPDATE webhook_jobs SET callback_status = ? WHERE id = ?`).run(
          `error:${cbErr.message}`,
          jobId
        );
      }
    }
  } catch (err) {
    db.prepare(`UPDATE webhook_jobs SET status = 'failed', error = ? WHERE id = ?`).run(err.message, jobId);
    throw err;
  }
}

export default router;
