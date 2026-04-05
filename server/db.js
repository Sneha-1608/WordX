import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', 'clearlingo.db');

const db = new Database(dbPath);

// Enable WAL mode for better concurrent access
db.pragma('journal_mode = WAL');

// ═══════════════════════════════════════════════════════════════
// Schema — Layer 3 Spec-Aligned Tables
// ═══════════════════════════════════════════════════════════════

db.exec(`
  -- Projects
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    source_language TEXT DEFAULT 'en',
    target_language TEXT DEFAULT 'hi_IN',
    style_profile TEXT DEFAULT 'professional',
    context TEXT DEFAULT 'General Business',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Segments
  CREATE TABLE IF NOT EXISTS segments (
    id TEXT PRIMARY KEY,
    project_id INTEGER NOT NULL,
    idx INTEGER NOT NULL,
    source_text TEXT NOT NULL,
    target_text TEXT,
    original_target TEXT,
    tm_score REAL,
    match_type TEXT CHECK(match_type IN ('EXACT','FUZZY','NEW','PROPAGATED')) DEFAULT 'NEW',
    status TEXT CHECK(status IN ('PENDING','APPROVED','REJECTED')) DEFAULT 'PENDING',
    violation INTEGER DEFAULT 0,
    format_type TEXT DEFAULT 'paragraph',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id)
  );

  -- ═══ 3.1.2 Vector TM — the full spec schema ═══
  CREATE TABLE IF NOT EXISTS tm_records (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    source_text TEXT NOT NULL,
    target_text TEXT NOT NULL,
    source_lang TEXT NOT NULL DEFAULT 'en',
    target_lang TEXT NOT NULL DEFAULT 'hi_IN',
    language    TEXT NOT NULL DEFAULT 'hi_IN',  -- backward compat alias
    embedding   TEXT,                           -- JSON-stringified 768-dim vector
    approved_at TEXT DEFAULT (datetime('now')),
    approved_by TEXT DEFAULT 'admin',
    project_id  INTEGER,
    context     TEXT DEFAULT 'General Business', -- domain context label
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- ═══ 3.2.1 Glossary Terms — full spec schema ═══
  CREATE TABLE IF NOT EXISTS glossary (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    source_term TEXT NOT NULL,
    target_term TEXT NOT NULL,
    source_lang TEXT NOT NULL DEFAULT 'en',
    target_lang TEXT NOT NULL DEFAULT 'hi_IN',
    language    TEXT NOT NULL DEFAULT 'hi_IN',  -- backward compat alias
    domain      TEXT DEFAULT 'general',         -- general, legal, finance, medical
    is_mandatory INTEGER DEFAULT 1,             -- 1=must appear in translation
    created_at  TEXT DEFAULT (datetime('now'))
  );

  -- ═══ 3.2.2 Style Profiles — full spec schema ═══
  CREATE TABLE IF NOT EXISTS style_profiles (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_name TEXT NOT NULL,
    tone         TEXT NOT NULL DEFAULT 'professional',
    formality    TEXT DEFAULT 'formal',
    target_lang  TEXT,
    rules        TEXT,                          -- JSON blob of additional rules
    description  TEXT,
    created_at   TEXT DEFAULT (datetime('now'))
  );

  -- ═══ 3.2.3 Revisions — full spec schema (replaces training_pairs) ═══
  CREATE TABLE IF NOT EXISTS revisions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    tm_record_id    INTEGER REFERENCES tm_records(id),
    segment_id      TEXT NOT NULL,
    source_text     TEXT NOT NULL,
    original_output TEXT NOT NULL,
    human_revision  TEXT NOT NULL,
    edit_distance   INTEGER,
    source_lang     TEXT DEFAULT 'en',
    target_lang     TEXT NOT NULL DEFAULT 'hi_IN',
    project_id      INTEGER,
    editor_id       TEXT DEFAULT 'admin',
    created_at      TEXT DEFAULT (datetime('now'))
  );

  -- Legacy compat: keep training_pairs for existing code
  CREATE TABLE IF NOT EXISTS training_pairs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_text TEXT NOT NULL,
    original_llm_output TEXT NOT NULL,
    human_revision TEXT NOT NULL,
    source_lang TEXT DEFAULT 'en',
    target_lang TEXT NOT NULL,
    project_id INTEGER,
    segment_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- ═══ 4.3 LoRA Adapter Registry ═══
  CREATE TABLE IF NOT EXISTS lora_adapters (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    adapter_name  TEXT NOT NULL UNIQUE,        -- e.g. 'lora-en-hi'
    source_lang   TEXT NOT NULL DEFAULT 'en',
    target_lang   TEXT NOT NULL,
    base_model    TEXT NOT NULL DEFAULT 'gemini-1.5-flash',
    status        TEXT CHECK(status IN ('active','inactive','training','testing')) DEFAULT 'inactive',
    accuracy_base REAL,                        -- base model accuracy (0-1)
    accuracy_lora REAL,                        -- LoRA model accuracy (0-1)
    training_pairs_count INTEGER DEFAULT 0,
    last_trained  TEXT,
    adapter_path  TEXT,                        -- path to adapter weights
    metadata      TEXT,                        -- JSON blob for extra config
    created_at    TEXT DEFAULT (datetime('now')),
    updated_at    TEXT DEFAULT (datetime('now'))
  );

  -- ═══ 4.1 LLM Call Log — per-request cost/token tracking ═══
  CREATE TABLE IF NOT EXISTS llm_call_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    call_type     TEXT NOT NULL,               -- 'translation', 'validation', 'embedding'
    model         TEXT NOT NULL,               -- 'gemini-1.5-flash', 'text-embedding-004'
    source_lang   TEXT,
    target_lang   TEXT,
    input_tokens  INTEGER,
    output_tokens INTEGER,
    total_tokens  INTEGER,
    latency_ms    REAL,
    status        TEXT DEFAULT 'success',      -- 'success', 'error', 'cached'
    cache_hit     INTEGER DEFAULT 0,
    segment_id    TEXT,
    project_id    INTEGER,
    adapter_used  TEXT,                        -- LoRA adapter name if used
    error_message TEXT,
    created_at    TEXT DEFAULT (datetime('now'))
  );

  -- ═══ 4.1 Translation Cache — semantic dedup ═══
  CREATE TABLE IF NOT EXISTS translation_cache (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    source_text   TEXT NOT NULL,
    source_lang   TEXT NOT NULL DEFAULT 'en',
    target_lang   TEXT NOT NULL,
    target_text   TEXT NOT NULL,
    model         TEXT NOT NULL,
    prompt_version TEXT,
    hit_count     INTEGER DEFAULT 0,
    created_at    TEXT DEFAULT (datetime('now')),
    expires_at    TEXT,
    UNIQUE(source_text, source_lang, target_lang, model)
  );

  -- ═══ 5.1 Training Datasets — versioned extraction snapshots ═══
  CREATE TABLE IF NOT EXISTS training_datasets (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    version         TEXT NOT NULL UNIQUE,
    source_lang     TEXT NOT NULL DEFAULT 'en',
    target_lang     TEXT NOT NULL DEFAULT 'hi_IN',
    pairs_count     INTEGER DEFAULT 0,
    filtered_count  INTEGER DEFAULT 0,
    status          TEXT CHECK(status IN ('extracting','ready','training','archived')) DEFAULT 'extracting',
    dataset_json    TEXT,
    metadata        TEXT,
    created_at      TEXT DEFAULT (datetime('now'))
  );

  -- ═══ 5.2 Training Runs — QLoRA fine-tuning job tracking ═══
  CREATE TABLE IF NOT EXISTS training_runs (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    dataset_id        INTEGER REFERENCES training_datasets(id),
    adapter_name      TEXT NOT NULL,
    source_lang       TEXT NOT NULL DEFAULT 'en',
    target_lang       TEXT NOT NULL DEFAULT 'hi_IN',
    base_model        TEXT NOT NULL DEFAULT 'gemini-1.5-flash',
    status            TEXT CHECK(status IN ('queued','training','completed','failed','cancelled')) DEFAULT 'queued',
    progress          REAL DEFAULT 0,
    epochs_completed  INTEGER DEFAULT 0,
    total_epochs      INTEGER DEFAULT 3,
    lora_rank         INTEGER DEFAULT 16,
    lora_alpha        INTEGER DEFAULT 16,
    learning_rate     REAL DEFAULT 0.0002,
    batch_size        INTEGER DEFAULT 4,
    training_loss     REAL,
    validation_loss   REAL,
    adapter_size_mb   REAL,
    adapter_path      TEXT,
    started_at        TEXT,
    completed_at      TEXT,
    error_message     TEXT,
    metadata          TEXT,
    created_at        TEXT DEFAULT (datetime('now'))
  );

  -- ═══ 5.3 A/B Test Results — evaluation comparisons ═══
  CREATE TABLE IF NOT EXISTS ab_test_results (
    id                          INTEGER PRIMARY KEY AUTOINCREMENT,
    training_run_id             INTEGER REFERENCES training_runs(id),
    adapter_name                TEXT NOT NULL,
    test_pairs_count            INTEGER DEFAULT 0,
    base_bleu                   REAL,
    adapter_bleu                REAL,
    base_edit_dist              REAL,
    adapter_edit_dist           REAL,
    base_glossary_compliance    REAL,
    adapter_glossary_compliance REAL,
    human_preference_rate       REAL,
    decision                    TEXT CHECK(decision IN ('auto_deploy','manual_review','rejected')),
    decision_reason             TEXT,
    deployed_at                 TEXT,
    created_at                  TEXT DEFAULT (datetime('now'))
  );

  -- ═══ 6.1 Translation Log — Per-segment match-type tracking ═══
  CREATE TABLE IF NOT EXISTS translation_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    segmentId   TEXT,
    projectId   INTEGER,
    matchType   TEXT CHECK(matchType IN ('EXACT','FUZZY','NEW')),
    tmScore     REAL DEFAULT 0,
    sourceLang  TEXT DEFAULT 'en',
    targetLang  TEXT DEFAULT 'hi_IN',
    costActual  REAL DEFAULT 0,
    latencyMs   REAL DEFAULT 0,
    processedAt TEXT DEFAULT (datetime('now'))
  );

  -- ═══ 6.2 Glossary Checks — Per-segment compliance audit ═══
  CREATE TABLE IF NOT EXISTS glossary_checks (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    segmentId    TEXT,
    projectId    INTEGER,
    totalTerms   INTEGER DEFAULT 0,
    matchedTerms INTEGER DEFAULT 0,
    violations   TEXT,
    checkedAt    TEXT DEFAULT (datetime('now'))
  );

  -- ═══ QA Agent Results — per-segment translation quality audit (DeepTrans) ═══
  CREATE TABLE IF NOT EXISTS qa_results (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    segment_id  TEXT NOT NULL,
    project_id  INTEGER,
    source_text TEXT NOT NULL,
    target_text TEXT NOT NULL,
    passed      INTEGER DEFAULT 1,
    issues      TEXT,
    checked_at  TEXT DEFAULT (datetime('now'))
  );

  -- ═══ Webhook Jobs — CMS Connector Layer (Improvement 1) ═══
  CREATE TABLE IF NOT EXISTS webhook_jobs (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL,
    content_id      TEXT,
    callback_url    TEXT,
    callback_secret TEXT,
    status          TEXT DEFAULT 'queued',
    callback_status TEXT,
    error           TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    completed_at    TEXT
  );
`);

// ═══════════════════════════════════════════════════════════════
// Migration — Add columns if not present (for existing DBs)
// ═══════════════════════════════════════════════════════════════

function addColumnIfNotExists(table, column, type, defaultVal) {
  try {
    const cols = db.pragma(`table_info(${table})`);
    if (!cols.find((c) => c.name === column)) {
      const def = defaultVal !== undefined ? ` DEFAULT '${defaultVal}'` : '';
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}${def}`);
      console.log(`  📐 Added column ${table}.${column}`);
    }
  } catch {}
}

// tm_records migrations
addColumnIfNotExists('tm_records', 'embedding', 'TEXT');
addColumnIfNotExists('tm_records', 'source_lang', 'TEXT', 'en');
addColumnIfNotExists('tm_records', 'target_lang', 'TEXT', 'hi_IN');
addColumnIfNotExists('tm_records', 'context', 'TEXT', 'General Business');
addColumnIfNotExists('tm_records', 'project_id', 'INTEGER');
addColumnIfNotExists('tm_records', 'approved_at', 'TEXT');

// segments migrations
addColumnIfNotExists('segments', 'format_type', 'TEXT', 'paragraph');
addColumnIfNotExists('segments', 'runs_metadata', 'TEXT');  // JSON blob of formatting runs (DeepTrans)
addColumnIfNotExists('segments', 'updated_at', 'TEXT');

// segments — auto language detection columns (2026-04-04)
addColumnIfNotExists('segments', 'detected_language', 'TEXT');
addColumnIfNotExists('segments', 'detection_confidence', 'REAL');
addColumnIfNotExists('segments', 'detected_script', 'TEXT');
addColumnIfNotExists('segments', 'source_language_display', 'TEXT');

// tm_records — auto language detection columns (2026-04-04)
addColumnIfNotExists('tm_records', 'detected_language', 'TEXT');
addColumnIfNotExists('tm_records', 'detection_confidence', 'REAL');
addColumnIfNotExists('tm_records', 'detected_script', 'TEXT');
addColumnIfNotExists('tm_records', 'source_language_display', 'TEXT');

// glossary migrations
addColumnIfNotExists('glossary', 'source_lang', 'TEXT', 'en');
addColumnIfNotExists('glossary', 'target_lang', 'TEXT', 'hi_IN');
addColumnIfNotExists('glossary', 'domain', 'TEXT', 'general');
addColumnIfNotExists('glossary', 'is_mandatory', 'INTEGER', '1');

// projects migrations
addColumnIfNotExists('projects', 'style_profile', 'TEXT', 'professional');
addColumnIfNotExists('projects', 'context', 'TEXT', 'General Business');

// ═══════════════════════════════════════════════════════════════
// Seed Data
// ═══════════════════════════════════════════════════════════════

// Seed glossary if empty
const glossaryCount = db.prepare('SELECT COUNT(*) as c FROM glossary').get();
if (glossaryCount.c === 0) {
  const insertGlossary = db.prepare(
    'INSERT INTO glossary (source_term, target_term, language, source_lang, target_lang, domain, is_mandatory) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const terms = [
    // General business terms (mandatory)
    ['account', 'खाता', 'hi_IN', 'en', 'hi_IN', 'general', 1],
    ['balance', 'शेष राशि', 'hi_IN', 'en', 'hi_IN', 'finance', 1],
    ['transaction', 'लेनदेन', 'hi_IN', 'en', 'hi_IN', 'finance', 1],
    ['policy', 'नीति', 'hi_IN', 'en', 'hi_IN', 'legal', 1],
    ['customer', 'ग्राहक', 'hi_IN', 'en', 'hi_IN', 'general', 1],
    ['service', 'सेवा', 'hi_IN', 'en', 'hi_IN', 'general', 1],
    ['payment', 'भुगतान', 'hi_IN', 'en', 'hi_IN', 'finance', 1],
    ['security', 'सुरक्षा', 'hi_IN', 'en', 'hi_IN', 'general', 1],
    ['support', 'सहायता', 'hi_IN', 'en', 'hi_IN', 'general', 1],
    ['document', 'दस्तावेज़', 'hi_IN', 'en', 'hi_IN', 'general', 1],
    ['authorization', 'प्राधिकरण', 'hi_IN', 'en', 'hi_IN', 'legal', 1],
    ['patient', 'रोगी', 'hi_IN', 'en', 'hi_IN', 'medical', 1],
    ['insurance', 'बीमा', 'hi_IN', 'en', 'hi_IN', 'finance', 1],
    ['compliance', 'अनुपालन', 'hi_IN', 'en', 'hi_IN', 'legal', 1],
    ['stakeholder', 'हितधारक', 'hi_IN', 'en', 'hi_IN', 'general', 1],
    // Non-mandatory (suggestions only)
    ['government', 'सरकार', 'hi_IN', 'en', 'hi_IN', 'general', 0],
    ['technology', 'प्रौद्योगिकी', 'hi_IN', 'en', 'hi_IN', 'general', 0],
  ];
  const insertMany = db.transaction((items) => {
    for (const item of items) insertGlossary.run(...item);
  });
  insertMany(terms);
}

// Seed TM records if empty
const tmCount = db.prepare('SELECT COUNT(*) as c FROM tm_records').get();
if (tmCount.c === 0) {
  const insertTM = db.prepare(
    `INSERT INTO tm_records (source_text, target_text, language, source_lang, target_lang, context) 
     VALUES (?, ?, ?, 'en', ?, 'General Business')`
  );
  const records = [
    ['Welcome to our service portal', 'हमारी सेवा पोर्टल में आपका स्वागत है', 'hi_IN', 'hi_IN'],
    ['Thank you for your patience and understanding', 'आपके धैर्य और समझ के लिए धन्यवाद', 'hi_IN', 'hi_IN'],
    ['Your transaction has been completed successfully', 'आपका लेनदेन सफलतापूर्वक पूरा हो गया है', 'hi_IN', 'hi_IN'],
    ['Please review your account balance regularly', 'कृपया अपनी शेष राशि की नियमित समीक्षा करें', 'hi_IN', 'hi_IN'],
    ['Contact customer support for assistance', 'सहायता के लिए ग्राहक सहायता से संपर्क करें', 'hi_IN', 'hi_IN'],
    ['Your security is our top priority', 'आपकी सुरक्षा हमारी प्राथमिकता है', 'hi_IN', 'hi_IN'],
    ['We are processing your request', 'हम आपके अनुरोध को संसाधित कर रहे हैं', 'hi_IN', 'hi_IN'],
    ['Terms and conditions apply', 'नियम और शर्तें लागू होती हैं', 'hi_IN', 'hi_IN'],
    // Critical demo sentence — proves paraphrase matching
    ['Patient must obtain prior authorization', 'रोगी को पूर्व प्राधिकरण प्राप्त करना होगा', 'hi_IN', 'hi_IN'],
  ];
  const insertMany = db.transaction((items) => {
    for (const item of items) insertTM.run(...item);
  });
  insertMany(records);
}

// Seed style profiles
const styleCount = db.prepare('SELECT COUNT(*) as c FROM style_profiles').get();
if (styleCount.c === 0) {
  const insertProfile = db.prepare(
    `INSERT INTO style_profiles (profile_name, tone, formality, target_lang, rules, description) VALUES (?, ?, ?, ?, ?, ?)`
  );
  const profiles = [
    ['professional', 'neutral', 'formal', null,
     JSON.stringify({ avoidColloquialisms: true, useHonorific: true, maxSentenceLength: 40 }),
     'Standard enterprise professional tone. Avoid colloquialisms. Use honorifics.'],
    ['legal', 'precise', 'formal', null,
     JSON.stringify({ avoidAmbiguity: true, preserveDefinitions: true, usePassiveVoice: false }),
     'Legal document tone. Precision is critical. No ambiguous terms.'],
    ['casual', 'friendly', 'informal', null,
     JSON.stringify({ useContractions: true, allowSlang: false, toneMarkers: ['😊'] }),
     'Friendly customer-facing content. Warm but professional.'],
    ['medical', 'clinical', 'formal', null,
     JSON.stringify({ preserveLatinTerms: true, useStandardNomenclature: true }),
     'Clinical medical tone. Preserve medical terminology precisely.'],
  ];
  const insertMany = db.transaction((items) => {
    for (const [name, tone, formality, lang, rules, desc] of items) {
      insertProfile.run(name, tone, formality, lang, rules, desc);
    }
  });
  insertMany(profiles);
}

// Seed revisions for Layer 5 Training Pipeline demo
const revCount = db.prepare('SELECT COUNT(*) as c FROM revisions').get();
if (revCount.c === 0) {
  // Ensure a demo project + segments exist for revisions to reference
  const demoProject = db.prepare('SELECT id FROM projects LIMIT 1').get();
  let projectId = demoProject?.id;
  if (!projectId) {
    const pResult = db.prepare(
      "INSERT INTO projects (name, source_language, target_language, style_profile, context) VALUES ('Demo Document', 'en', 'hi_IN', 'professional', 'General Business')"
    ).run();
    projectId = Number(pResult.lastInsertRowid);
  }

  const insertRevision = db.prepare(
    `INSERT INTO revisions (segment_id, source_text, original_output, human_revision, edit_distance, source_lang, target_lang, project_id, editor_id)
     VALUES (?, ?, ?, ?, ?, 'en', 'hi_IN', ?, ?)`
  );

  const revisions = [
    // [segmentId, sourceText, originalOutput, humanRevision, editDistance, editorId]
    ['demo-seg-01', 'Welcome to our customer portal',
     'हमारे ग्राहक पोर्टल में स्वागत है', 'हमारे ग्राहक पोर्टल में आपका स्वागत है', 12, 'reviewer-1'],
    ['demo-seg-02', 'Please verify your account details before proceeding',
     'आगे बढ़ने से पहले अपने खाता विवरण सत्यापित करें', 'आगे बढ़ने से पहले कृपया अपने खाता विवरण सत्यापित करें', 15, 'reviewer-1'],
    ['demo-seg-03', 'Your transaction has been processed successfully',
     'आपका लेनदेन सफलतापूर्वक प्रोसेस हो गया है', 'आपका लेनदेन सफलतापूर्वक संसाधित हो गया है', 22, 'reviewer-2'],
    ['demo-seg-04', 'Contact our support team for any assistance',
     'किसी भी सहायता के लिए हमारी सपोर्ट टीम से संपर्क करें', 'किसी भी सहायता के लिए हमारी सहायता टीम से संपर्क करें', 18, 'reviewer-1'],
    ['demo-seg-05', 'Your security is our top priority',
     'आपकी सुरक्षा हमारी टॉप प्रायोरिटी है', 'आपकी सुरक्षा हमारी सर्वोच्च प्राथमिकता है', 30, 'reviewer-2'],
    ['demo-seg-06', 'The payment has been credited to your account',
     'भुगतान आपके अकाउंट में क्रेडिट हो गया है', 'भुगतान आपके खाते में जमा हो गया है', 25, 'reviewer-1'],
    ['demo-seg-07', 'Please review the terms and conditions carefully',
     'कृपया नियम और शर्तों को ध्यानपूर्वक रिव्यू करें', 'कृपया नियम और शर्तों की ध्यानपूर्वक समीक्षा करें', 20, 'reviewer-2'],
    ['demo-seg-08', 'We appreciate your patience during this process',
     'इस प्रक्रिया के दौरान आपके पेशेंस की सराहना करते हैं', 'इस प्रक्रिया के दौरान आपके धैर्य के लिए हम आभारी हैं', 35, 'reviewer-1'],
    ['demo-seg-09', 'Your insurance policy has been updated',
     'आपकी इंश्योरेंस पॉलिसी अपडेट हो गई है', 'आपकी बीमा पॉलिसी अद्यतन कर दी गई है', 28, 'reviewer-2'],
    ['demo-seg-10', 'The document requires authorization before submission',
     'दस्तावेज़ को सबमिशन से पहले ऑथराइजेशन की आवश्यकता है', 'दस्तावेज़ को जमा करने से पहले प्राधिकरण की आवश्यकता है', 32, 'reviewer-1'],
    ['demo-seg-11', 'Customer feedback helps us improve our services',
     'ग्राहक फीडबैक हमें अपनी सेवाओं में सुधार करने में मदद करता है', 'ग्राहक प्रतिक्रिया हमें अपनी सेवाओं में सुधार करने में सहायता करती है', 38, 'reviewer-2'],
    ['demo-seg-12', 'All stakeholders must comply with the new policy',
     'सभी स्टेकहोल्डर्स को नई पॉलिसी का पालन करना होगा', 'सभी हितधारकों को नई नीति का अनुपालन करना होगा', 26, 'reviewer-1'],
    ['demo-seg-13', 'The compliance report has been submitted for review',
     'कम्प्लायंस रिपोर्ट रिव्यू के लिए सबमिट कर दी गई है', 'अनुपालन रिपोर्ट समीक्षा के लिए प्रस्तुत कर दी गई है', 40, 'reviewer-2'],
    ['demo-seg-14', 'Please ensure all patient records are up to date',
     'कृपया सुनिश्चित करें कि सभी पेशेंट रिकॉर्ड अप टू डेट हैं', 'कृपया सुनिश्चित करें कि सभी रोगी अभिलेख अद्यतन हैं', 42, 'reviewer-1'],
    ['demo-seg-15', 'Your account balance will be updated within 24 hours',
     'आपकी अकाउंट बैलेंस 24 घंटे में अपडेट हो जाएगी', 'आपकी शेष राशि 24 घंटों के भीतर अद्यतन कर दी जाएगी', 33, 'reviewer-2'],
  ];

  const insertManyRevisions = db.transaction((items) => {
    for (const [segId, src, orig, human, dist, editor] of items) {
      insertRevision.run(segId, src, orig, human, dist, projectId, editor);
    }
  });
  insertManyRevisions(revisions);
}

// Seed translation_log for Layer 6 Analytics dashboard demo
const tlCount = db.prepare('SELECT COUNT(*) as c FROM translation_log').get();
if (tlCount.c === 0) {
  const insertTL = db.prepare(
    `INSERT INTO translation_log (segmentId, projectId, matchType, tmScore, sourceLang, targetLang, costActual, latencyMs, processedAt)
     VALUES (?, ?, ?, ?, 'en', 'hi_IN', ?, ?, ?)`
  );

  // Generate 100 realistic entries spread over the last 7 days
  // Target: 52% EXACT, 42% FUZZY, 6% NEW → 94% TM leverage
  const now = Date.now();
  const DAY = 86400000;
  const entries = [];

  for (let i = 0; i < 100; i++) {
    const dayOffset = Math.floor((i / 100) * 7);
    const timeOffset = Math.floor(Math.random() * DAY);
    const ts = new Date(now - (6 - dayOffset) * DAY + timeOffset).toISOString().replace('T', ' ').substring(0, 19);

    let matchType, tmScore, costActual, latencyMs;
    if (i < 52) {
      matchType = 'EXACT'; tmScore = 1.0; costActual = 0; latencyMs = Math.random() * 2;
    } else if (i < 94) {
      matchType = 'FUZZY'; tmScore = 0.75 + Math.random() * 0.2; costActual = 15; latencyMs = 5 + Math.random() * 10;
    } else {
      matchType = 'NEW'; tmScore = Math.random() * 0.5; costActual = 75; latencyMs = 200 + Math.random() * 300;
    }

    entries.push([`analytics-seg-${String(i + 1).padStart(3, '0')}`, 1, matchType, Math.round(tmScore * 100) / 100, costActual, Math.round(latencyMs * 10) / 10, ts]);
  }

  const insertManyTL = db.transaction((items) => {
    for (const args of items) insertTL.run(...args);
  });
  insertManyTL(entries);
}

// Seed glossary_checks for Layer 6 glossary compliance dashboard
const gcCount = db.prepare('SELECT COUNT(*) as c FROM glossary_checks').get();
if (gcCount.c === 0) {
  const insertGC = db.prepare(
    `INSERT INTO glossary_checks (segmentId, projectId, totalTerms, matchedTerms, violations, checkedAt)
     VALUES (?, 1, ?, ?, ?, ?)`
  );

  const now = Date.now();
  const DAY = 86400000;
  const checks = [];

  // 60 checks total: 59 pass (99.8% ≈ compliance), 1 violation
  for (let i = 0; i < 60; i++) {
    const dayOffset = Math.floor((i / 60) * 7);
    const ts = new Date(now - (6 - dayOffset) * DAY + Math.random() * DAY).toISOString().replace('T', ' ').substring(0, 19);
    const totalTerms = 1 + Math.floor(Math.random() * 3); // 1–3 glossary terms per segment

    if (i === 42) {
      // One violation: segment 42 missed a term
      checks.push([`analytics-seg-${String(i + 1).padStart(3, '0')}`, totalTerms, totalTerms - 1, JSON.stringify(['बीमा']), ts]);
    } else {
      checks.push([`analytics-seg-${String(i + 1).padStart(3, '0')}`, totalTerms, totalTerms, null, ts]);
    }
  }

  const insertManyGC = db.transaction((items) => {
    for (const args of items) insertGC.run(...args);
  });
  insertManyGC(checks);
}

export function getDb() { return db; }
export default db;
