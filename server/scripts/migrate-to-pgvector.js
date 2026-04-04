#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// Migration Script: SQLite TM → pgvector
// ═══════════════════════════════════════════════════════════════
//
// Reads all TM records + embeddings from better-sqlite3 and
// writes them into the PostgreSQL tm_embeddings table.
//
// Usage:
//   node server/scripts/migrate-to-pgvector.js [--dry-run] [--batch-size=100]
//
// Requires:
//   USE_PGVECTOR=true in .env
//   PostgreSQL running with pgvector extension
//
// ═══════════════════════════════════════════════════════════════

import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Parse CLI args
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const batchSizeArg = args.find(a => a.startsWith('--batch-size='));
const BATCH_SIZE = batchSizeArg ? parseInt(batchSizeArg.split('=')[1]) : 100;

console.log('═══════════════════════════════════════════════════');
console.log('  ClearLingo — SQLite → pgvector Migration');
console.log('═══════════════════════════════════════════════════');
console.log(`  Mode:       ${dryRun ? '🔍 DRY RUN (no writes)' : '🚀 LIVE MIGRATION'}`);
console.log(`  Batch Size: ${BATCH_SIZE}`);
console.log('');

async function migrate() {
  // 1. Connect to SQLite
  let Database;
  try {
    Database = (await import('better-sqlite3')).default;
  } catch (err) {
    console.error('❌ Cannot import better-sqlite3:', err.message);
    process.exit(1);
  }

  const dbPath = path.join(__dirname, '..', '..', 'clearlingo.db');
  let sqliteDb;
  try {
    sqliteDb = new Database(dbPath, { readonly: true });
    console.log(`✅ SQLite database opened: ${dbPath}`);
  } catch (err) {
    console.error(`❌ Cannot open SQLite database at ${dbPath}:`, err.message);
    process.exit(1);
  }

  // 2. Count TM records
  const tmCount = sqliteDb.prepare('SELECT COUNT(*) as cnt FROM translation_memory').get();
  console.log(`📊 Found ${tmCount.cnt} TM records in SQLite`);

  // Count embeddings
  let embeddingCount = 0;
  try {
    const embResult = sqliteDb.prepare('SELECT COUNT(*) as cnt FROM embeddings').get();
    embeddingCount = embResult.cnt;
  } catch {
    console.log('   (No embeddings table found — will skip embedding migration)');
  }
  console.log(`📊 Found ${embeddingCount} embeddings in SQLite`);

  if (tmCount.cnt === 0) {
    console.log('\n⚠ No TM records to migrate. Exiting.');
    sqliteDb.close();
    process.exit(0);
  }

  // 3. Connect to PostgreSQL
  if (!process.env.USE_PGVECTOR || process.env.USE_PGVECTOR !== 'true') {
    console.error('❌ USE_PGVECTOR is not set to "true" in .env');
    sqliteDb.close();
    process.exit(1);
  }

  let pg, pool;
  try {
    pg = await import('pg');
    pool = new pg.default.Pool({
      connectionString: process.env.PGVECTOR_URL || 'postgresql://clearlingo:password@localhost:5432/clearlingo',
      max: 5,
    });

    // Verify connection
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    console.log('✅ PostgreSQL connected');
  } catch (err) {
    console.error('❌ Cannot connect to PostgreSQL:', err.message);
    sqliteDb.close();
    process.exit(1);
  }

  // 4. Ensure table exists
  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tm_embeddings (
        id SERIAL PRIMARY KEY,
        source_text TEXT NOT NULL,
        target_text TEXT NOT NULL,
        source_lang VARCHAR(10) NOT NULL,
        target_lang VARCHAR(10) NOT NULL,
        embedding vector(768),
        quality_score REAL DEFAULT 0.9,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('✅ tm_embeddings table ready');
  } catch (err) {
    console.error('❌ Cannot create table:', err.message);
    sqliteDb.close();
    await pool.end();
    process.exit(1);
  }

  // 5. Read and migrate TM records in batches
  const allTm = sqliteDb.prepare(
    'SELECT source_text, target_text, source_lang, target_lang, quality_score FROM translation_memory'
  ).all();

  // Build embedding lookup (if available)
  const embeddingMap = new Map();
  if (embeddingCount > 0) {
    try {
      const allEmb = sqliteDb.prepare('SELECT source_text, embedding FROM embeddings').all();
      for (const row of allEmb) {
        try {
          const vec = JSON.parse(row.embedding);
          if (Array.isArray(vec) && vec.length === 768) {
            embeddingMap.set(row.source_text, vec);
          }
        } catch {}
      }
      console.log(`   Loaded ${embeddingMap.size} valid embeddings into lookup`);
    } catch (err) {
      console.warn(`   ⚠ Could not read embeddings table: ${err.message}`);
    }
  }

  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < allTm.length; i += BATCH_SIZE) {
    const batch = allTm.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(allTm.length / BATCH_SIZE);

    console.log(`   Batch ${batchNum}/${totalBatches} (${batch.length} records)...`);

    if (dryRun) {
      migrated += batch.length;
      continue;
    }

    for (const row of batch) {
      try {
        const embedding = embeddingMap.get(row.source_text) || null;
        await pool.query(
          `INSERT INTO tm_embeddings (source_text, target_text, source_lang, target_lang, embedding, quality_score)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            row.source_text,
            row.target_text,
            row.source_lang || 'en',
            row.target_lang || 'hi_IN',
            embedding ? JSON.stringify(embedding) : null,
            row.quality_score || 0.9,
          ]
        );
        migrated++;
      } catch (err) {
        errors++;
        if (errors <= 5) console.warn(`   ⚠ Row error: ${err.message}`);
      }
    }
  }

  // 6. Summary
  console.log('');
  console.log('═══════════════════════════════════════════════════');
  console.log('  Migration Summary');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Total TM records:    ${allTm.length}`);
  console.log(`  Migrated:            ${migrated}`);
  console.log(`  Skipped:             ${skipped}`);
  console.log(`  Errors:              ${errors}`);
  console.log(`  Embeddings matched:  ${embeddingMap.size}`);
  if (dryRun) {
    console.log('');
    console.log('  🔍 This was a DRY RUN. No data was written.');
    console.log('     Remove --dry-run to perform actual migration.');
  }
  console.log('═══════════════════════════════════════════════════');

  // Cleanup
  sqliteDb.close();
  await pool.end();
}

migrate().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
