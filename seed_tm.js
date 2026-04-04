/**
 * ═══════════════════════════════════════════════════════════════
 * ClearLingo — TM Seeder
 * Loads translation pairs from data_seeds/*.json into SQLite
 * ═══════════════════════════════════════════════════════════════
 *
 * Usage: node seed_tm.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEEDS_DIR = path.join(__dirname, 'data_seeds');
const DB_PATH = path.join(__dirname, 'clearlingo.db');

// Open database
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// Ensure tm_records table exists
db.exec(`
  CREATE TABLE IF NOT EXISTS tm_records (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    source_text TEXT NOT NULL,
    target_text TEXT NOT NULL,
    source_lang TEXT NOT NULL DEFAULT 'en',
    target_lang TEXT NOT NULL DEFAULT 'hi_IN',
    language    TEXT NOT NULL DEFAULT 'hi_IN',
    embedding   TEXT,
    approved_at TEXT DEFAULT (datetime('now')),
    approved_by TEXT DEFAULT 'dataset-seed',
    project_id  INTEGER,
    context     TEXT DEFAULT 'General Business',
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Prepare insert statement
const insertTM = db.prepare(`
  INSERT INTO tm_records (source_text, target_text, source_lang, target_lang, language, context, approved_by)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

// Check for duplicates
const checkDup = db.prepare(`
  SELECT id FROM tm_records WHERE source_text = ? AND target_lang = ? LIMIT 1
`);

function seedFile(filePath) {
  const fileName = path.basename(filePath);
  let data;
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    data = JSON.parse(raw);
  } catch (err) {
    console.error(`  ❌ Failed to read ${fileName}: ${err.message}`);
    return { inserted: 0, skipped: 0 };
  }

  if (!Array.isArray(data) || data.length === 0) {
    console.log(`  ⚠ ${fileName}: empty or invalid`);
    return { inserted: 0, skipped: 0 };
  }

  let inserted = 0;
  let skipped = 0;

  const insertBatch = db.transaction((pairs) => {
    for (const pair of pairs) {
      const src = (pair.source || '').trim();
      const tgt = (pair.target || '').trim();
      const srcLang = pair.sourceLang || 'en';
      const tgtLang = pair.targetLang || 'hi_IN';
      const domain = pair.domain || 'general';
      const dataset = pair.dataset || 'unknown';

      if (!src || !tgt || src.length < 3 || tgt.length < 1) {
        skipped++;
        continue;
      }

      // Check for duplicate
      const existing = checkDup.get(src, tgtLang);
      if (existing) {
        skipped++;
        continue;
      }

      insertTM.run(src, tgt, srcLang, tgtLang, tgtLang, `${domain} (${dataset})`, `seed:${dataset}`);
      inserted++;
    }
  });

  insertBatch(data);
  return { inserted, skipped };
}

function main() {
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║  ClearLingo — TM Seeder                             ║');
  console.log('╚═══════════════════════════════════════════════════════╝\n');

  if (!fs.existsSync(SEEDS_DIR)) {
    console.error(`❌ No data_seeds/ directory found. Run download_datasets.py first.`);
    process.exit(1);
  }

  const files = fs.readdirSync(SEEDS_DIR)
    .filter(f => f.endsWith('.json'))
    .sort();

  if (files.length === 0) {
    console.error('❌ No JSON seed files found in data_seeds/');
    process.exit(1);
  }

  console.log(`📂 Found ${files.length} seed files\n`);

  let totalInserted = 0;
  let totalSkipped = 0;
  const results = [];

  for (const file of files) {
    const filePath = path.join(SEEDS_DIR, file);
    process.stdout.write(`  📥 ${file}...`);
    const { inserted, skipped } = seedFile(filePath);
    totalInserted += inserted;
    totalSkipped += skipped;
    results.push({ file, inserted, skipped });
    console.log(` ✅ ${inserted} inserted, ${skipped} skipped`);
  }

  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log(`  📊 SEEDING COMPLETE`);
  console.log('═'.repeat(60));
  console.log(`  Total inserted: ${totalInserted.toLocaleString()}`);
  console.log(`  Total skipped:  ${totalSkipped.toLocaleString()}`);

  // Show TM stats per language
  const langStats = db.prepare(`
    SELECT target_lang, COUNT(*) as count
    FROM tm_records
    GROUP BY target_lang
    ORDER BY count DESC
  `).all();

  console.log(`\n  📈 TM Records by Language:`);
  for (const { target_lang, count } of langStats) {
    console.log(`     ${target_lang}: ${count.toLocaleString()} records`);
  }

  const totalTM = db.prepare('SELECT COUNT(*) as c FROM tm_records').get().c;
  console.log(`\n  📦 Total TM Records: ${totalTM.toLocaleString()}`);
  console.log(`  🗄️ Database: ${DB_PATH}\n`);

  db.close();
}

main();
