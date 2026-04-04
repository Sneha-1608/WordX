// ═══════════════════════════════════════════════════════════════
// Layer 3: Core RAG Engine
// ═══════════════════════════════════════════════════════════════
//
// Centralized module for ALL Translation Memory operations.
// Implements the Layer 3 spec: SQLite + Vectors hybrid storage.
//
// Sub-components:
//   §3.1  Vector Database  — embedding generation, cosine search
//   §3.2  SQL Database     — glossary, style profiles, revisions
//
// ═══════════════════════════════════════════════════════════════

import db from './db.js';
import {
  generateEmbedding,
  batchEmbed,
  cosineSimilarity,
  findBestMatch,
  editDistance,
  formatStyleForPrompt,
  isMockMode,
} from './gemini.js';
import { rateLimiter } from './middleware.js';
import { searchSimilar as pgvectorSearch, upsertEmbedding as pgvectorUpsert } from './vector-pg.js';

// ═══════════════════════════════════════════════════════════════
// §3.1.3 — Three-Tier TM Lookup (the core algorithm)
// ═══════════════════════════════════════════════════════════════

/**
 * Exact-match-only TM lookup (Phase 1 only, no embedding).
 * Used by batch optimizations to cheaply filter segments before batch embedding.
 *
 * @param {string}  sourceText
 * @param {string}  sourceLang
 * @param {string}  targetLang
 * @returns {{targetText: string|null, score: number, matchType: string, tmRecordId: number|null} | null}
 */
export function tmExactLookup(sourceText, sourceLang = 'en', targetLang = 'hi_IN') {
  const exactMatch = db
    .prepare(
      `SELECT id, target_text FROM tm_records
       WHERE LOWER(TRIM(source_text)) = LOWER(TRIM(?))
         AND source_lang = ? AND target_lang = ?
       LIMIT 1`
    )
    .get(sourceText, sourceLang, targetLang);

  if (exactMatch) {
    return {
      targetText: exactMatch.target_text,
      score: 1.0,
      matchType: 'EXACT',
      tmRecordId: exactMatch.id,
    };
  }

  // Legacy column fallback
  const exactMatchLegacy = db
    .prepare(
      `SELECT id, target_text FROM tm_records
       WHERE LOWER(TRIM(source_text)) = LOWER(TRIM(?))
         AND language = ?
       LIMIT 1`
    )
    .get(sourceText, targetLang);

  if (exactMatchLegacy) {
    return {
      targetText: exactMatchLegacy.target_text,
      score: 1.0,
      matchType: 'EXACT',
      tmRecordId: exactMatchLegacy.id,
    };
  }

  return null; // No exact match
}

/**
 * The spec's three-tier TM search algorithm.
 *
 * Phase 1: Exact string match (fastest — skips embedding entirely)
 * Phase 2: Vector cosine similarity (fuzzy matching)
 * Phase 3: New segment (no useful TM match → forward to LLM)
 *
 * @param {string}  sourceText   The source segment to look up
 * @param {string}  sourceLang   e.g. 'en'
 * @param {string}  targetLang   e.g. 'hi_IN'
 * @param {string}  context      Domain context label (e.g. 'General Business')
 * @param {number[]|null} precomputedEmbedding  Optional pre-batched embedding vector
 * @returns {Promise<{targetText: string|null, score: number, matchType: string, tmRecordId: number|null}>}
 */
export async function tmLookup(sourceText, sourceLang = 'en', targetLang = 'hi_IN', context = 'General Business', precomputedEmbedding = null) {
  const start = performance.now();

  // ──────────────────────────────────────────────────────
  // Phase 1: Exact String Match (§3.1.3)
  //   Normalize: trim() + toLowerCase()
  //   No embedding API call → saves latency + cost
  // ──────────────────────────────────────────────────────
  const exactMatch = db
    .prepare(
      `SELECT id, target_text FROM tm_records
       WHERE LOWER(TRIM(source_text)) = LOWER(TRIM(?))
         AND source_lang = ? AND target_lang = ?
       LIMIT 1`
    )
    .get(sourceText, sourceLang, targetLang);

  if (exactMatch) {
    const elapsed = (performance.now() - start).toFixed(2);
    console.log(`   ⚡ TM EXACT in ${elapsed}ms`);
    return {
      targetText: exactMatch.target_text,
      score: 1.0,
      matchType: 'EXACT',
      tmRecordId: exactMatch.id,
      latencyMs: parseFloat(elapsed),
    };
  }

  // Also try with the `language` column for backward compat
  const exactMatchLegacy = db
    .prepare(
      `SELECT id, target_text FROM tm_records
       WHERE LOWER(TRIM(source_text)) = LOWER(TRIM(?))
         AND language = ?
       LIMIT 1`
    )
    .get(sourceText, targetLang);

  if (exactMatchLegacy) {
    const elapsed = (performance.now() - start).toFixed(2);
    console.log(`   ⚡ TM EXACT (legacy) in ${elapsed}ms`);
    return {
      targetText: exactMatchLegacy.target_text,
      score: 1.0,
      matchType: 'EXACT',
      tmRecordId: exactMatchLegacy.id,
      latencyMs: parseFloat(elapsed),
    };
  }

  // ──────────────────────────────────────────────────────
  // Phase 2: Vector Cosine Similarity (§3.1.3)
  //   Use precomputed embedding if available (batch optimization),
  //   otherwise generate inline via text-embedding-004
  // ──────────────────────────────────────────────────────
  let queryEmbedding;
  if (precomputedEmbedding) {
    queryEmbedding = precomputedEmbedding;
  } else {
    try {
      // §3.1.1: Contextual embedding prefix
      queryEmbedding = await rateLimiter.execute(
        () => generateEmbedding(sourceText, context)
      );
    } catch (err) {
      console.warn(`   ⚠ Embedding generation failed: ${err.message}`);
      return {
        targetText: null,
        score: 0,
        matchType: 'NEW',
        tmRecordId: null,
        latencyMs: parseFloat((performance.now() - start).toFixed(2)),
      };
    }
  }
  // ──────────────────────────────────────────────────────
  // Phase 2a: pgvector Fast-Path (Improvement 3)
  //   If PostgreSQL + pgvector is available, use ANN index
  //   for O(log n) search before falling back to SQLite loop
  // ──────────────────────────────────────────────────────
  try {
    const pgResults = await pgvectorSearch(queryEmbedding, sourceLang, targetLang, 1, 0.75);
    if (pgResults.length > 0) {
      const best = pgResults[0];
      const elapsed = (performance.now() - start).toFixed(2);
      const matchType = best.similarity >= 0.95 ? 'EXACT' : 'FUZZY';
      const label = matchType === 'EXACT' ? 'NEAR-EXACT' : 'FUZZY';
      console.log(`   🚀 pgvector ${label} (${best.similarity.toFixed(3)}) in ${elapsed}ms`);
      return {
        targetText: best.target_text,
        score: best.similarity,
        matchType,
        tmRecordId: null, // pgvector records don't have SQLite IDs
        latencyMs: parseFloat(elapsed),
      };
    }
  } catch {
    // pgvector not available — fall through to SQLite
  }

  // ──────────────────────────────────────────────────────
  // Phase 2b: SQLite Vector Cosine Similarity (original §3.1.3)
  //   Fallback: scan all TM records with embeddings
  // ──────────────────────────────────────────────────────

  // Fetch all TM records with embeddings for this lang pair
  const tmRecords = db
    .prepare(
      `SELECT id, source_text, target_text, embedding
       FROM tm_records
       WHERE (source_lang = ? AND target_lang = ?) OR language = ?`
    )
    .all(sourceLang, targetLang, targetLang);

  const withEmbeddings = tmRecords.filter((r) => r.embedding);

  if (withEmbeddings.length > 0) {
    const best = findBestMatch(queryEmbedding, withEmbeddings);

    if (best.matchType !== 'NEW') {
      const elapsed = (performance.now() - start).toFixed(2);
      const label = best.matchType === 'EXACT' ? 'NEAR-EXACT' : 'FUZZY';
      console.log(`   🔍 TM ${label} (${best.score}) in ${elapsed}ms — scanned ${withEmbeddings.length} vectors`);
      return {
        targetText: best.record.target_text,
        score: best.score,
        matchType: best.matchType,
        tmRecordId: best.record.id,
        latencyMs: parseFloat(elapsed),
      };
    }
  }

  // ──────────────────────────────────────────────────────
  // Phase 3: New Segment (§3.1.3)
  //   No useful TM match → forward to Layer 4 (LLM)
  // ──────────────────────────────────────────────────────
  const elapsed = (performance.now() - start).toFixed(2);
  console.log(`   🆕 TM NEW in ${elapsed}ms — scanned ${withEmbeddings.length} vectors`);
  return {
    targetText: null,
    score: 0,
    matchType: 'NEW',
    tmRecordId: null,
    latencyMs: parseFloat(elapsed),
  };
}

// ═══════════════════════════════════════════════════════════════
// §3.1.2 — TM Write (Atomic Insert/Update with Embedding)
// ═══════════════════════════════════════════════════════════════

/**
 * Write a translation to the TM. If a record with the same source text
 * + lang pair already exists, update it. Otherwise insert a new record.
 * Generates the 768-dim embedding with contextual prefix.
 *
 * @param {Object} params
 * @param {string} params.sourceText
 * @param {string} params.targetText
 * @param {string} params.sourceLang
 * @param {string} params.targetLang
 * @param {string} params.context      Domain context label
 * @param {number[]} [params.embedding]  Pre-computed embedding (optional)
 * @param {number}  [params.projectId]
 * @param {string} [params.approvedBy]
 * @returns {Promise<{tmRecordId: number, isNew: boolean}>}
 */
export async function tmWrite({
  sourceText,
  targetText,
  sourceLang = 'en',
  targetLang = 'hi_IN',
  context = 'General Business',
  embedding = null,
  projectId = null,
  approvedBy = 'admin',
}) {
  // Generate embedding if not provided
  if (!embedding) {
    try {
      embedding = await rateLimiter.execute(
        () => generateEmbedding(sourceText, context)
      );
    } catch (err) {
      console.warn(`⚠ Embedding generation failed during TM write: ${err.message}`);
    }
  }

  const embeddingJson = embedding ? JSON.stringify(embedding) : null;

  // Check if record already exists
  const existing = db.prepare(
    `SELECT id FROM tm_records
     WHERE LOWER(TRIM(source_text)) = LOWER(TRIM(?))
       AND ((source_lang = ? AND target_lang = ?) OR language = ?)`
  ).get(sourceText, sourceLang, targetLang, targetLang);

  if (existing) {
    db.prepare(
      `UPDATE tm_records
       SET target_text = ?, embedding = ?, approved_at = datetime('now'),
           approved_by = ?, context = ?
       WHERE id = ?`
    ).run(targetText, embeddingJson, approvedBy, context, existing.id);

    return { tmRecordId: existing.id, isNew: false };
  }

  const result = db.prepare(
    `INSERT INTO tm_records
       (source_text, target_text, language, source_lang, target_lang,
        embedding, approved_by, project_id, context)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    sourceText, targetText, targetLang, sourceLang, targetLang,
    embeddingJson, approvedBy, projectId, context
  );

  // Write-through to pgvector (async, non-blocking)
  if (embedding) {
    pgvectorUpsert(sourceText, targetText, sourceLang, targetLang, embedding, 0.9).catch(() => {});
  }

  return { tmRecordId: Number(result.lastInsertRowid), isNew: true };
}

/**
 * Delete a TM record by ID.
 * @param {number} id
 * @returns {{ deleted: boolean }}
 */
export function tmDelete(id) {
  const result = db.prepare('DELETE FROM tm_records WHERE id = ?').run(id);
  return { deleted: result.changes > 0 };
}

/**
 * Get a single TM record by ID.
 * @param {number} id
 * @returns {Object|null}
 */
export function tmGet(id) {
  return db.prepare(
    `SELECT id, source_text, target_text, source_lang, target_lang, context,
            approved_at, approved_by, project_id,
            embedding IS NOT NULL as has_embedding
     FROM tm_records WHERE id = ?`
  ).get(id) || null;
}

/**
 * List TM records for a language pair.
 * @param {string} targetLang
 * @param {number} [limit=100]
 * @param {number} [offset=0]
 * @returns {{ records: Object[], total: number }}
 */
export function tmList(targetLang, limit = 100, offset = 0) {
  const records = db.prepare(
    `SELECT id, source_text, target_text, source_lang, target_lang, context,
            approved_at, approved_by, project_id,
            embedding IS NOT NULL as has_embedding
     FROM tm_records
     WHERE target_lang = ? OR language = ?
     ORDER BY id DESC
     LIMIT ? OFFSET ?`
  ).all(targetLang, targetLang, limit, offset);

  const total = db.prepare(
    'SELECT COUNT(*) as c FROM tm_records WHERE target_lang = ? OR language = ?'
  ).get(targetLang, targetLang).c;

  return { records, total };
}

// ═══════════════════════════════════════════════════════════════
// §3.2.1 — Glossary Terms
// ═══════════════════════════════════════════════════════════════

/**
 * Fetch mandatory glossary terms for a language pair.
 *
 * @param {string} sourceLang
 * @param {string} targetLang
 * @param {string} [domain]  Filter by domain (optional)
 * @returns {Array<{id: number, source: string, target: string, domain: string, isMandatory: boolean}>}
 */
export function glossaryLookup(sourceLang = 'en', targetLang = 'hi_IN', domain = null) {
  let query = `SELECT id, source_term as source, target_term as target, domain,
                      is_mandatory as isMandatory
               FROM glossary
               WHERE source_lang = ? AND target_lang = ?`;
  const params = [sourceLang, targetLang];

  if (domain) {
    query += ' AND domain = ?';
    params.push(domain);
  }

  query += ' ORDER BY is_mandatory DESC, source_term ASC';

  const terms = db.prepare(query).all(...params);

  // Fallback: also check legacy `language` column
  if (terms.length === 0) {
    const legacy = db.prepare(
      `SELECT id, source_term as source, target_term as target, domain,
              is_mandatory as isMandatory
       FROM glossary WHERE language = ?
       ORDER BY is_mandatory DESC, source_term ASC`
    ).all(targetLang);
    return legacy;
  }

  return terms;
}

/**
 * Deterministic glossary enforcement check (§3.2.1).
 * After translation, verifies the LLM actually used mandatory glossary terms.
 *
 * @param {string} sourceText   Original source segment
 * @param {string} targetText   Translated output
 * @param {Array}  glossaryTerms  [{source, target, isMandatory}]
 * @returns {{ violated: boolean, violations: Array<{source: string, expectedTarget: string}> }}
 */
export function glossaryEnforce(sourceText, targetText, glossaryTerms) {
  const violations = [];

  for (const term of glossaryTerms) {
    // Only enforce mandatory terms
    if (term.isMandatory === 0) continue;

    // Check if source term appears in the source text
    const sourceHasTerm = new RegExp(`\\b${escapeRegex(term.source)}\\b`, 'i').test(sourceText);
    if (sourceHasTerm && !targetText.includes(term.target)) {
      violations.push({
        source: term.source,
        expectedTarget: term.target,
      });
    }
  }

  return {
    violated: violations.length > 0,
    violations,
  };
}

/**
 * Add a glossary term.
 */
export function glossaryAdd({ sourceTerm, targetTerm, sourceLang = 'en', targetLang = 'hi_IN', domain = 'general', isMandatory = 1 }) {
  const result = db.prepare(
    `INSERT INTO glossary (source_term, target_term, language, source_lang, target_lang, domain, is_mandatory)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(sourceTerm, targetTerm, targetLang, sourceLang, targetLang, domain, isMandatory);
  return { id: Number(result.lastInsertRowid) };
}

/**
 * Update a glossary term.
 */
export function glossaryUpdate(id, { sourceTerm, targetTerm, domain, isMandatory }) {
  const fields = [];
  const values = [];
  if (sourceTerm !== undefined) { fields.push('source_term = ?'); values.push(sourceTerm); }
  if (targetTerm !== undefined) { fields.push('target_term = ?'); values.push(targetTerm); }
  if (domain !== undefined) { fields.push('domain = ?'); values.push(domain); }
  if (isMandatory !== undefined) { fields.push('is_mandatory = ?'); values.push(isMandatory); }

  if (fields.length === 0) return { updated: false };

  values.push(id);
  const result = db.prepare(`UPDATE glossary SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return { updated: result.changes > 0 };
}

/**
 * Delete a glossary term.
 */
export function glossaryDelete(id) {
  const result = db.prepare('DELETE FROM glossary WHERE id = ?').run(id);
  return { deleted: result.changes > 0 };
}

// ═══════════════════════════════════════════════════════════════
// §3.2.2 — Style Profiles
// ═══════════════════════════════════════════════════════════════

/**
 * Fetch a style profile by name and format it for LLM prompt injection.
 *
 * @param {string} profileName  e.g. 'professional', 'legal', 'casual'
 * @returns {{ profile: Object|null, promptText: string }}
 */
export function styleProfileGet(profileName) {
  const profile = db.prepare(
    'SELECT * FROM style_profiles WHERE profile_name = ?'
  ).get(profileName);

  return {
    profile: profile || null,
    promptText: formatStyleForPrompt(profile),
  };
}

/**
 * List all style profiles.
 */
export function styleProfileList() {
  return db.prepare('SELECT * FROM style_profiles ORDER BY id ASC').all();
}

/**
 * Add a new style profile.
 */
export function styleProfileAdd({ profileName, tone, formality = 'formal', targetLang = null, rules = null, description = null }) {
  const result = db.prepare(
    `INSERT INTO style_profiles (profile_name, tone, formality, target_lang, rules, description)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(profileName, tone, formality, targetLang, typeof rules === 'object' ? JSON.stringify(rules) : rules, description);
  return { id: Number(result.lastInsertRowid) };
}

/**
 * Update a style profile.
 */
export function styleProfileUpdate(id, { profileName, tone, formality, targetLang, rules, description }) {
  const fields = [];
  const values = [];
  if (profileName !== undefined) { fields.push('profile_name = ?'); values.push(profileName); }
  if (tone !== undefined) { fields.push('tone = ?'); values.push(tone); }
  if (formality !== undefined) { fields.push('formality = ?'); values.push(formality); }
  if (targetLang !== undefined) { fields.push('target_lang = ?'); values.push(targetLang); }
  if (rules !== undefined) { fields.push('rules = ?'); values.push(typeof rules === 'object' ? JSON.stringify(rules) : rules); }
  if (description !== undefined) { fields.push('description = ?'); values.push(description); }

  if (fields.length === 0) return { updated: false };

  values.push(id);
  const result = db.prepare(`UPDATE style_profiles SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return { updated: result.changes > 0 };
}

// ═══════════════════════════════════════════════════════════════
// §3.2.3 — Revision History (Human Edits)
// ═══════════════════════════════════════════════════════════════

/**
 * Log a human revision to the revisions table.
 * Computes Levenshtein edit distance automatically.
 *
 * @param {Object} params
 * @param {number} params.tmRecordId
 * @param {string} params.segmentId
 * @param {string} params.sourceText
 * @param {string} params.originalOutput    What the LLM generated
 * @param {string} params.humanRevision     What the human corrected it to
 * @param {string} params.targetLang
 * @param {number} [params.projectId]
 * @param {string} [params.editorId]
 * @returns {{ revisionId: number, editDistance: number }}
 */
export function revisionLog({
  tmRecordId,
  segmentId,
  sourceText,
  originalOutput,
  humanRevision,
  targetLang = 'hi_IN',
  projectId = null,
  editorId = 'admin',
}) {
  const distance = editDistance(originalOutput, humanRevision);

  const result = db.prepare(
    `INSERT INTO revisions
       (tm_record_id, segment_id, source_text, original_output, human_revision,
        edit_distance, target_lang, project_id, editor_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(tmRecordId, segmentId, sourceText, originalOutput, humanRevision,
    distance, targetLang, projectId, editorId);

  // Also write to legacy training_pairs table
  try {
    db.prepare(
      `INSERT INTO training_pairs (source_text, original_llm_output, human_revision, target_lang, project_id, segment_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(sourceText, originalOutput, humanRevision, targetLang, projectId, segmentId);
  } catch {
    // Ignore — legacy table may not exist
  }

  console.log(`📝 Revision logged: seg ${segmentId} (edit distance: ${distance})`);

  return {
    revisionId: Number(result.lastInsertRowid),
    editDistance: distance,
  };
}

/**
 * Get revision analytics — average edit distance, common error patterns, etc.
 * @param {number} [projectId]  Filter by project (optional)
 * @returns {Object}
 */
export function revisionAnalytics(projectId = null) {
  const where = projectId ? 'WHERE project_id = ?' : '';
  const params = projectId ? [projectId] : [];

  const aggregate = db.prepare(
    `SELECT
       COUNT(*)                   as totalRevisions,
       AVG(edit_distance)         as avgEditDistance,
       MIN(edit_distance)         as minEditDistance,
       MAX(edit_distance)         as maxEditDistance,
       SUM(edit_distance)         as totalEditDistance
     FROM revisions ${where}`
  ).get(...params);

  // Recent revisions
  const recent = db.prepare(
    `SELECT r.id, r.segment_id, r.source_text, r.original_output, r.human_revision,
            r.edit_distance, r.target_lang, r.editor_id, r.created_at
     FROM revisions r
     ${where}
     ORDER BY r.created_at DESC LIMIT 20`
  ).all(...params);

  // Edit distance distribution
  const distribution = db.prepare(
    `SELECT
       CASE
         WHEN edit_distance <= 5  THEN 'minor (1-5)'
         WHEN edit_distance <= 20 THEN 'moderate (6-20)'
         WHEN edit_distance <= 50 THEN 'significant (21-50)'
         ELSE 'major (50+)'
       END as category,
       COUNT(*) as count
     FROM revisions ${where}
     GROUP BY category ORDER BY MIN(edit_distance)`
  ).all(...params);

  return {
    ...aggregate,
    avgEditDistance: aggregate.avgEditDistance ? Math.round(aggregate.avgEditDistance * 10) / 10 : 0,
    distribution,
    recentRevisions: recent,
  };
}

// ═══════════════════════════════════════════════════════════════
// Embedding Backfill — On-Demand
// ═══════════════════════════════════════════════════════════════

/**
 * Backfill embeddings for TM records that don't have one yet.
 * Uses contextual embedding prefix (§3.1.1).
 *
 * @param {string} targetLang
 * @param {string} context  Domain context label
 * @returns {Promise<{backfilled: number, total: number, failed: number}>}
 */
export async function backfillEmbeddings(targetLang = null, context = 'General Business') {
  let query = 'SELECT id, source_text, context FROM tm_records WHERE embedding IS NULL';
  const params = [];
  if (targetLang) {
    query += ' AND (target_lang = ? OR language = ?)';
    params.push(targetLang, targetLang);
  }

  const unembedded = db.prepare(query).all(...params);
  if (unembedded.length === 0) {
    return { backfilled: 0, total: 0, failed: 0 };
  }

  console.log(`🧮 Backfilling embeddings for ${unembedded.length} TM records (context: "${context}")...`);

  const updateEmb = db.prepare('UPDATE tm_records SET embedding = ? WHERE id = ?');
  let backfilled = 0;
  let failed = 0;

  // ═══ Batch embedding optimization ═══
  // Group by context, then batch embed each group in chunks of 100.
  // This reduces N API calls to ceil(N/100) calls.
  const byContext = {};
  for (const record of unembedded) {
    const ctx = record.context || context;
    if (!byContext[ctx]) byContext[ctx] = [];
    byContext[ctx].push(record);
  }

  for (const [ctx, records] of Object.entries(byContext)) {
    const texts = records.map(r => r.source_text);
    try {
      const embeddings = await batchEmbed(texts, ctx);
      for (let i = 0; i < records.length; i++) {
        try {
          updateEmb.run(JSON.stringify(embeddings[i]), records[i].id);
          backfilled++;
        } catch (dbErr) {
          console.warn(`   ⚠ DB write failed for TM record ${records[i].id}: ${dbErr.message}`);
          failed++;
        }
      }
    } catch (err) {
      console.warn(`   ⚠ Batch embedding failed for context "${ctx}": ${err.message}`);
      failed += records.length;
    }
  }

  console.log(`✅ Backfilled ${backfilled}/${unembedded.length} TM records (${failed} failed)`);

  return { backfilled, total: unembedded.length, failed };
}

// ═══════════════════════════════════════════════════════════════
// Layer 3 Health & Performance Stats
// ═══════════════════════════════════════════════════════════════

/**
 * Get comprehensive Layer 3 health metrics.
 * @returns {Object}
 */
export function getStats() {
  const tmTotal = db.prepare('SELECT COUNT(*) as c FROM tm_records').get().c;
  const tmEmbedded = db.prepare("SELECT COUNT(*) as c FROM tm_records WHERE embedding IS NOT NULL").get().c;
  const tmUnembedded = tmTotal - tmEmbedded;
  const glossaryTotal = db.prepare('SELECT COUNT(*) as c FROM glossary').get().c;
  const glossaryMandatory = db.prepare('SELECT COUNT(*) as c FROM glossary WHERE is_mandatory = 1').get().c;
  const revisionsTotal = db.prepare('SELECT COUNT(*) as c FROM revisions').get().c;
  const styleProfilesTotal = db.prepare('SELECT COUNT(*) as c FROM style_profiles').get().c;
  const trainingPairsTotal = db.prepare('SELECT COUNT(*) as c FROM training_pairs').get().c;

  // Language coverage
  const languages = db.prepare(
    'SELECT DISTINCT target_lang, COUNT(*) as count FROM tm_records GROUP BY target_lang'
  ).all();

  // Average edit distance across all revisions
  const avgEditDist = db.prepare('SELECT AVG(edit_distance) as avg FROM revisions').get();

  return {
    layer: 3,
    engine: 'SQLite + Vectors (text-embedding-005)',
    mode: isMockMode() ? 'MOCK' : 'LIVE',
    embeddingDimension: 768,
    tm: {
      total: tmTotal,
      embedded: tmEmbedded,
      unembedded: tmUnembedded,
      coveragePercent: tmTotal > 0 ? Math.round((tmEmbedded / tmTotal) * 100) : 0,
    },
    glossary: {
      total: glossaryTotal,
      mandatory: glossaryMandatory,
      optional: glossaryTotal - glossaryMandatory,
    },
    revisions: {
      total: revisionsTotal,
      avgEditDistance: avgEditDist.avg ? Math.round(avgEditDist.avg * 10) / 10 : 0,
    },
    styleProfiles: styleProfilesTotal,
    trainingPairs: trainingPairsTotal,
    languages,
    performance: {
      exactMatchLatency: '<1ms (SQLite indexed)',
      cosine1kVectors: '<3ms (in-memory V8)',
      cosine5kVectors: '<15ms (in-memory V8)',
      embeddingApiLatency: '~200ms (network)',
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// Utility
// ═══════════════════════════════════════════════════════════════

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default {
  // §3.1 — TM / Vector operations
  tmLookup,
  tmExactLookup,
  tmWrite,
  tmDelete,
  tmGet,
  tmList,

  // §3.2.1 — Glossary
  glossaryLookup,
  glossaryEnforce,
  glossaryAdd,
  glossaryUpdate,
  glossaryDelete,

  // §3.2.2 — Style Profiles
  styleProfileGet,
  styleProfileList,
  styleProfileAdd,
  styleProfileUpdate,

  // §3.2.3 — Revisions
  revisionLog,
  revisionAnalytics,

  // Utils
  backfillEmbeddings,
  getStats,
};
