import { Router } from 'express';
import db from '../db.js';
import ragEngine from '../rag-engine.js';
import { logTranslationEvent, logGlossaryCheck } from './analytics.js';
import trainingPipeline from '../training-pipeline.js';

const router = Router();

// Helper to safely broadcast via Socket.io (no-op if io not available)
async function broadcastSegmentChange(projectId, segmentId, status, userId) {
  try {
    const { io } = await import('../index.js');
    if (io) {
      io.to(`project:${projectId}`).emit('segment_status_changed', {
        segmentId,
        status,
        updatedBy: userId || 'unknown',
      });
    }
  } catch {
    // Socket.io not available — silent no-op
  }
}

// Helper to automate the training pipeline when a project reaches 100% approval
async function checkAndTriggerAutoTraining(projectId) {
  try {
    // 1. Check if the project is 100% approved and has segments
    const stats = db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'APPROVED' THEN 1 ELSE 0 END) as approved
      FROM segments WHERE project_id = ?
    `).get(projectId);

    if (!stats || stats.total === 0 || stats.total !== stats.approved) {
      return; // Not 100% completed
    }

    // 2. Fetch project details
    const project = db.prepare('SELECT source_language, target_language FROM projects WHERE id = ?').get(projectId);
    if (!project) return;

    console.log(`\n🎉 Project ${projectId} is 100% approved! Triggering automated training pipeline...`);

    // 3. Extract dataset
    const extractResult = trainingPipeline.extractDataset(project.source_language, project.target_language);
    
    if (!extractResult.meetsThreshold) {
      console.log(`ℹ Extraction complete, but threshold not met (${extractResult.pairsCount}/${extractResult.threshold} pairs). Training not started.`);
      return;
    }

    // 4. Create and start training run
    const runInfo = trainingPipeline.createTrainingRun(extractResult.datasetId);
    console.log(`🚀 Automated training run ${runInfo.runId} queued. Starting execution...`);

    trainingPipeline.executeTrainingRun(runInfo.runId, (msg) => console.log(`  [Auto-Train] ${msg}`))
      .then(async (metrics) => {
        console.log(`✅ Automated training completed! Starting A/B test...`);
        // 5. Run A/B test (which auto-deploys if it meets requirements)
        await trainingPipeline.runABTest(runInfo.runId, (abMsg) => console.log(`  [Auto-Eval] ${abMsg}`));
        console.log(`🎯 Automated pipeline for project ${projectId} has finished.`);
      })
      .catch(err => console.error(`❌ Automated training execution failed: ${err.message}`));
      
  } catch (error) {
    console.error(`❌ Error in checkAndTriggerAutoTraining: ${error.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// POST /api/approve — Atomic TM Write + Embedding + Revision (§3.2.3)
// ═══════════════════════════════════════════════════════════════

router.post('/', async (req, res) => {
  try {
    const { segmentId, targetText, language = 'hi_IN' } = req.body;

    if (!segmentId || !targetText) {
      return res.status(400).json({ error: 'segmentId and targetText required' });
    }

    // Get the segment
    const segment = db.prepare('SELECT * FROM segments WHERE id = ?').get(segmentId);
    if (!segment) {
      return res.status(404).json({ error: 'Segment not found' });
    }

    // Get project context for contextual embedding prefix (§3.1.1)
    const project = db.prepare('SELECT context FROM projects WHERE id = ?').get(segment.project_id);
    const context = project?.context || 'General Business';

    // ═══ Detect human edits (§3.2.3) ═══
    const wasEdited = segment.original_target && targetText !== segment.original_target;

    // ═══ Atomic transaction: approve + TM write + revision log ═══
    const approveTransaction = db.transaction(() => {
      // 1. Update segment status
      db.prepare(
        'UPDATE segments SET status = ?, target_text = ?, updated_at = datetime(\'now\') WHERE id = ?'
      ).run('APPROVED', targetText, segmentId);

      // 4. Propagation: auto-approve identical unapproved segments
      const identical = db.prepare(
        `SELECT id FROM segments 
         WHERE LOWER(TRIM(source_text)) = LOWER(TRIM(?)) AND project_id = ? AND id != ? AND status = 'PENDING'`
      ).all(segment.source_text, segment.project_id, segmentId);

      if (identical.length > 0) {
        const autoApprove = db.prepare(
          'UPDATE segments SET status = ?, target_text = ?, match_type = \'PROPAGATED\', tm_score = 1.0, updated_at = datetime(\'now\') WHERE id = ?'
        );
        for (const dup of identical) {
          autoApprove.run('APPROVED', targetText, dup.id);
        }
      }

      return {
        propagatedCount: identical.length,
        propagatedIds: identical.map((d) => d.id),
      };
    });

    const txResult = approveTransaction();

    // ═══ TM Write via ragEngine (async — generates embedding) ═══
    const tmResult = await ragEngine.tmWrite({
      sourceText: segment.source_text,
      targetText,
      sourceLang: 'en',
      targetLang: language,
      context,
      projectId: segment.project_id,
      detectedLanguage: segment.detected_language || null,
      detectionConfidence: segment.detection_confidence || null,
      detectedScript: segment.detected_script || null,
      sourceLanguageDisplay: segment.source_language_display || null,
    });

    // ═══ Revision logging via ragEngine (§3.2.3) ═══
    let revisionResult = null;
    if (wasEdited) {
      revisionResult = ragEngine.revisionLog({
        tmRecordId: tmResult.tmRecordId,
        segmentId,
        sourceText: segment.source_text,
        originalOutput: segment.original_target,
        humanRevision: targetText,
        targetLang: language,
        projectId: segment.project_id,
      });
    }

    // ═══ Compute project stats ═══
    const projectStats = db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'APPROVED' THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN match_type = 'EXACT' THEN 1 ELSE 0 END) as exact,
        SUM(CASE WHEN match_type = 'FUZZY' THEN 1 ELSE 0 END) as fuzzy,
        SUM(CASE WHEN violation = 1 THEN 1 ELSE 0 END) as violations
      FROM segments WHERE project_id = ?
    `).get(segment.project_id);

    // ═══ Layer 6: Log analytics events ═══
    logTranslationEvent({
      segmentId,
      projectId: segment.project_id,
      matchType: segment.match_type || 'NEW',
      tmScore: segment.tm_score || 0,
      sourceLang: 'en',
      targetLang: language,
      costActual: segment.match_type === 'EXACT' ? 0 : segment.match_type === 'FUZZY' ? 15 : 75,
    });

    const layer3Stats = ragEngine.getStats();
    const newLeverageRate = projectStats.total > 0
      ? Math.round(((projectStats.exact + projectStats.fuzzy) / projectStats.total) * 100) / 100
      : 0;

    res.json({
      success: true,
      segmentId,
      status: 'APPROVED',
      tmRecordId: tmResult.tmRecordId,
      propagatedCount: txResult.propagatedCount,
      propagatedIds: txResult.propagatedIds,
      revisionLogged: wasEdited,
      editDistance: revisionResult?.editDistance || 0,
      newLeverageRate,
      stats: {
        ...projectStats,
        leverageRate: Math.round(newLeverageRate * 100),
        tmRecords: layer3Stats.tm.total,
        revisions: layer3Stats.revisions.total,
      },
    });

    // Broadcast via Socket.io to all connected clients
    broadcastSegmentChange(segment.project_id, segmentId, 'APPROVED', req.body.userId);

    // Broadcast propagation events for real-time sync (Improvement 7)
    if (txResult.propagatedCount > 0) {
      try {
        const { io } = await import('../index.js');
        if (io) {
          io.to(`project:${segment.project_id}`).emit('segments_propagated', {
            sourceSegmentId: segmentId,
            propagatedIds: txResult.propagatedIds,
            targetText,
            status: 'APPROVED',
          });
        }
      } catch {}
    }

    // Check for 100% completion in the background
    setImmediate(() => {
      checkAndTriggerAutoTraining(segment.project_id);
    });
  } catch (err) {
    console.error('Approve error:', err);
    res.status(500).json({ error: 'Approval failed: ' + err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/approve/bulk — Approve all pending segments for a project
//   Supports optional matchType filter ('EXACT', 'FUZZY', etc.)
// ═══════════════════════════════════════════════════════════════

router.post('/bulk', async (req, res) => {
  try {
    const { projectId, language = 'hi_IN', matchType } = req.body;

    if (!projectId) {
      return res.status(400).json({ error: 'projectId required' });
    }

    // Build query — optionally filter by matchType (e.g. 'EXACT')
    let query = `SELECT * FROM segments WHERE project_id = ? AND status = 'PENDING'`;
    const params = [projectId];
    if (matchType) {
      query += ` AND match_type = ?`;
      params.push(matchType);
    }

    const unapproved = db.prepare(query).all(...params);

    if (unapproved.length === 0) {
      return res.json({ success: true, count: 0 });
    }

    const project = db.prepare('SELECT context FROM projects WHERE id = ?').get(projectId);
    const context = project?.context || 'General Business';

    // ═══ Fast path: single transaction to approve all segments ═══
    const bulkApproveTransaction = db.transaction((segments) => {
      const stmt = db.prepare(
        'UPDATE segments SET status = ?, updated_at = datetime(\'now\') WHERE id = ?'
      );
      for (const seg of segments) {
        stmt.run('APPROVED', seg.id);
      }
      return segments.length;
    });

    const count = bulkApproveTransaction(unapproved);

    // ═══ Return success immediately — don't block on TM writes ═══
    res.json({ success: true, count });

    // ═══ Background: TM writes (fire-and-forget, non-blocking) ═══
    setImmediate(async () => {
      for (const segment of unapproved) {
        try {
          await ragEngine.tmWrite({
            sourceText: segment.source_text,
            targetText: segment.target_text,
            sourceLang: 'en',
            targetLang: language,
            context,
            projectId: segment.project_id,
            detectedLanguage: segment.detected_language || null,
            detectionConfidence: segment.detection_confidence || null,
            detectedScript: segment.detected_script || null,
            sourceLanguageDisplay: segment.source_language_display || null,
          });
        } catch (e) {
          console.warn(`TM Write failed for bulk segment ${segment.id}:`, e.message);
        }
      }
      console.log(`✅ Background TM writes complete for ${unapproved.length} segments`);

      // Now check if project is 100% complete and auto-train
      checkAndTriggerAutoTraining(projectId);
    });
  } catch (err) {
    console.error('Bulk Approve error:', err);
    res.status(500).json({ error: 'Bulk approval failed: ' + err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/approve/reject
// ═══════════════════════════════════════════════════════════════

router.post('/reject', (req, res) => {
  try {
    const { segmentId } = req.body;
    db.prepare('UPDATE segments SET status = ? WHERE id = ?').run('REJECTED', segmentId);
    res.json({ success: true, segmentId, status: 'REJECTED' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/approve/revert
// ═══════════════════════════════════════════════════════════════

router.post('/revert', (req, res) => {
  try {
    const { segmentId } = req.body;
    const segment = db.prepare('SELECT original_target FROM segments WHERE id = ?').get(segmentId);
    if (!segment) return res.status(404).json({ error: 'Segment not found' });

    db.prepare(
      'UPDATE segments SET target_text = ?, status = ? WHERE id = ?'
    ).run(segment.original_target, 'PENDING', segmentId);

    res.json({ success: true, segmentId, targetText: segment.original_target, status: 'PENDING' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/approve/stats/:projectId
// ═══════════════════════════════════════════════════════════════

router.get('/stats/:projectId', (req, res) => {
  try {
    const { projectId } = req.params;
    const stats = db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'APPROVED' THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN status = 'REJECTED' THEN 1 ELSE 0 END) as rejected,
        SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN match_type = 'EXACT' THEN 1 ELSE 0 END) as exact,
        SUM(CASE WHEN match_type = 'FUZZY' THEN 1 ELSE 0 END) as fuzzy,
        SUM(CASE WHEN match_type = 'NEW' THEN 1 ELSE 0 END) as newSegments,
        SUM(CASE WHEN violation = 1 THEN 1 ELSE 0 END) as violations
      FROM segments WHERE project_id = ?
    `).get(projectId);

    // Use ragEngine for layer 3 stats
    const layer3Stats = ragEngine.getStats();
    const revisions = ragEngine.revisionAnalytics(parseInt(projectId));
    const leverageRate = stats.total > 0
      ? Math.round(((stats.exact + stats.fuzzy) / stats.total) * 100)
      : 0;

    res.json({
      ...stats,
      leverageRate,
      tmRecords: layer3Stats.tm.total,
      revisions: revisions.totalRevisions,
      avgEditDistance: revisions.avgEditDistance,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/approve/revisions — Fetch revision history (§3.2.3)
// ═══════════════════════════════════════════════════════════════

router.get('/revisions', (req, res) => {
  try {
    const analytics = ragEngine.revisionAnalytics();
    res.json(analytics.recentRevisions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/approve/training-pairs — Legacy QLoRA training data
// ═══════════════════════════════════════════════════════════════

router.get('/training-pairs', (req, res) => {
  try {
    const pairs = db.prepare(
      'SELECT * FROM training_pairs ORDER BY created_at DESC LIMIT 100'
    ).all();
    res.json(pairs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
