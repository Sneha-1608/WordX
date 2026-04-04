// ═══════════════════════════════════════════════════════════════
// pgvector — Scalable Vector Store for Semantic TM Search
// ═══════════════════════════════════════════════════════════════
//
// Provides a fast-path for embedding search using PostgreSQL +
// pgvector extension. Falls back to SQLite cosine loop if PG
// is unavailable.
//
// ENV: USE_PGVECTOR=true + PGVECTOR_URL=postgresql://user:pass@host:5432/db
//
// ═══════════════════════════════════════════════════════════════

let pool = null;
let pgReady = false;
const EMBEDDING_DIM = 768; // Gemini embedding dimension

async function initPg() {
  if (process.env.USE_PGVECTOR !== 'true') {
    console.log('[pgvector] Disabled (set USE_PGVECTOR=true to enable)');
    return;
  }

  try {
    const pg = await import('pg');
    const pgvector = await import('pgvector/pg');

    pool = new pg.default.Pool({
      connectionString: process.env.PGVECTOR_URL || 'postgresql://clearlingo:password@localhost:5432/clearlingo',
      max: 10,
      idleTimeoutMillis: 30000,
    });

    const client = await pool.connect();
    try {
      // Ensure pgvector extension and table exist
      await client.query('CREATE EXTENSION IF NOT EXISTS vector');
      await client.query(`
        CREATE TABLE IF NOT EXISTS tm_embeddings (
          id SERIAL PRIMARY KEY,
          source_text TEXT NOT NULL,
          target_text TEXT NOT NULL,
          source_lang VARCHAR(10) NOT NULL,
          target_lang VARCHAR(10) NOT NULL,
          embedding vector(${EMBEDDING_DIM}),
          quality_score REAL DEFAULT 0.9,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_tm_embeddings_vector
        ON tm_embeddings USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100)
      `).catch(() => {
        // IVFFlat index requires data; create after first insert
        console.log('[pgvector] IVFFlat index will be created after initial data load');
      });

      pgReady = true;
      console.log('[pgvector] Connected and table ready');
    } finally {
      client.release();
    }
  } catch (err) {
    console.warn('[pgvector] Init failed (falling back to SQLite vectors):', err.message);
    pool = null;
    pgReady = false;
  }
}

// Initialize on module load
initPg();

/**
 * Insert an embedding into pgvector.
 */
export async function upsertEmbedding(sourceText, targetText, sourceLang, targetLang, embedding, qualityScore = 0.9) {
  if (!pool || !pgReady) return null;
  try {
    const result = await pool.query(
      `INSERT INTO tm_embeddings (source_text, target_text, source_lang, target_lang, embedding, quality_score)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [sourceText, targetText, sourceLang, targetLang, JSON.stringify(embedding), qualityScore]
    );
    return result.rows[0]?.id;
  } catch (err) {
    console.warn('[pgvector] Upsert failed:', err.message);
    return null;
  }
}

/**
 * Search for the nearest TM matches using cosine similarity.
 *
 * @param {number[]} queryEmbedding - The query embedding vector
 * @param {string} sourceLang - Source language code
 * @param {string} targetLang - Target language code
 * @param {number} topK - Maximum results to return (default: 5)
 * @param {number} threshold - Minimum similarity threshold (default: 0.7)
 * @returns {Promise<Array<{source_text, target_text, similarity, quality_score}>>}
 */
export async function searchSimilar(queryEmbedding, sourceLang, targetLang, topK = 5, threshold = 0.7) {
  if (!pool || !pgReady) return [];
  try {
    const result = await pool.query(
      `SELECT source_text, target_text, quality_score,
              1 - (embedding <=> $1::vector) as similarity
       FROM tm_embeddings
       WHERE source_lang = $2 AND target_lang = $3
         AND 1 - (embedding <=> $1::vector) > $4
       ORDER BY embedding <=> $1::vector
       LIMIT $5`,
      [JSON.stringify(queryEmbedding), sourceLang, targetLang, threshold, topK]
    );
    return result.rows;
  } catch (err) {
    console.warn('[pgvector] Search failed:', err.message);
    return [];
  }
}

/**
 * Health check — returns pgvector connection status.
 */
export function getPgvectorStatus() {
  return {
    enabled: process.env.USE_PGVECTOR === 'true',
    connected: pgReady,
    url: process.env.PGVECTOR_URL ? '***' : 'not set',
  };
}

/**
 * Get total embedding count.
 */
export async function getEmbeddingCount() {
  if (!pool || !pgReady) return 0;
  try {
    const r = await pool.query('SELECT COUNT(*) as cnt FROM tm_embeddings');
    return parseInt(r.rows[0]?.cnt || 0);
  } catch {
    return 0;
  }
}

export default {
  upsertEmbedding,
  searchSimilar,
  getPgvectorStatus,
  getEmbeddingCount,
};
