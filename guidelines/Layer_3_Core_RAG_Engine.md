# Layer 3: Core RAG Engine
## SQLite + Vectors

---

## Overview

Layer 3 is the **data backbone** of ClearLingo — a hybrid storage engine that combines a **Vector Database** (using `text-embedding-004` embeddings stored in SQLite) with a **relational SQL Database** (using `better-sqlite3`). This layer is responsible for all Translation Memory (TM) operations: storing, searching (exact and fuzzy), and retrieving past approved translations. It also stores glossary terms, style profiles, and human revision history.

The critical architectural decision here is using **SQLite for everything** instead of external vector databases like Pinecone. For hackathon-scale data (1,000–5,000 TM records), SQLite in-memory cosine similarity calculation is **faster** than network latency to a dedicated vector database.

---

## Sub-Components

### 3.1 Vector Database (text-embedding-004)

**Purpose:** Stores 768-dimensional embedding vectors alongside source-target translation pairs, enabling semantic similarity search for fuzzy TM matching.

**Detailed Steps:**

#### 3.1.1 Embedding Generation

1. When a new source text needs to be embedded, the system calls Google's `text-embedding-004` API.
2. The API returns a **768-dimensional float vector** representing the semantic meaning of the text.
3. **Contextual Embedding Prefix** — Before generating the embedding, a document context label is prepended to the source text:
   ```
   "[General Business] Please verify your account details."
   ```
   This shifts the embedding vector into the specific semantic neighborhood (e.g., business vs. IT networking), dramatically improving match accuracy for short, ambiguous segments.
4. The embedding vector is **JSON-stringified** and stored in the SQLite `embedding` column:
   ```
   "[0.124, 0.442, -0.331, 0.089, ...]"  // 768 floats as JSON string
   ```

#### 3.1.2 The SQLite TM Table Schema

```sql
CREATE TABLE tm_records (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source      TEXT NOT NULL,          -- Original source text
  target      TEXT NOT NULL,          -- Approved translated text
  sourceLang  TEXT NOT NULL,          -- e.g., "en"
  targetLang  TEXT NOT NULL,          -- e.g., "hi_IN"
  embedding   TEXT NOT NULL,          -- JSON-stringified 768-dim vector
  approvedAt  TEXT DEFAULT (datetime('now')),
  approvedBy  TEXT,
  projectId   TEXT,
  context     TEXT                    -- Optional domain context label
);
```

#### 3.1.3 RAG TM Lookup — The Three-Tier Search

This is the core algorithm of ClearLingo and runs every time a segment needs a translation:

**Phase 1: Exact String Match (fastest — skips embedding entirely)**
1. Normalize the source text: `trim()`, `toLowerCase()`.
2. Query SQLite for an identical string with matching language pair:
   ```sql
   SELECT * FROM tm_records
   WHERE LOWER(TRIM(source)) = ? AND sourceLang = ? AND targetLang = ?
   LIMIT 1;
   ```
3. If found → return `score = 1.0`, `matchType = 'EXACT'`.
4. **No embedding API call is made** — this saves both latency and cost.

**Phase 2: Vector Cosine Similarity (fuzzy matching)**
1. If no exact match found → generate the 768-dim embedding of the source text via `text-embedding-004`.
2. Fetch **all** TM records for the language pair from SQLite:
   ```sql
   SELECT * FROM tm_records WHERE sourceLang = ? AND targetLang = ?;
   ```
3. Parse each record's JSON-stringified embedding back into a `number[]` array.
4. Run **in-memory cosine similarity** against every stored vector:

   ```typescript
   function cosineSimilarity(vectorA: number[], vectorB: number[]): number {
     let dotProduct = 0, normA = 0, normB = 0;
     for (let i = 0; i < vectorA.length; i++) {
       dotProduct += vectorA[i] * vectorB[i];
       normA      += vectorA[i] * vectorA[i];
       normB      += vectorB[i] * vectorB[i];
     }
     return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
   }
   ```

5. Find the record with the **highest cosine similarity score**.
6. Classify the result:

   | Score Range | Classification | Action |
   |---|---|---|
   | ≥ 0.95 | **Near-Exact** | Use TM target directly (skip LLM) |
   | 0.75 – 0.94 | **Fuzzy** | Pass TM target as reference to LLM |
   | < 0.75 | **New** | Full LLM translation required |

**Phase 3: New Segment (no useful TM match)**
1. If the best score is below 0.75 → classified as `'NEW'`.
2. The segment is forwarded to Layer 4 (LLM Orchestration) for full translation.
3. After human approval, the translation + embedding are written back to this layer, enriching the TM for future lookups.

#### 3.1.4 Performance Characteristics

| Metric | Value |
|---|---|
| Embedding dimension | 768 floats |
| Cosine similarity of 1,000 records | < 3ms (in-memory, V8 engine) |
| Cosine similarity of 5,000 records | < 15ms |
| Exact match lookup | < 1ms (SQLite indexed query) |
| Embedding generation API call | ~200ms (network latency dependent) |

> For hackathon-scale data, SQLite in-memory distance calculation is FASTER than the network latency to Pinecone.

---

### 3.2 SQL Database (better-sqlite3)

**Purpose:** Stores all structured relational data beyond TM records — including glossary terms, style profiles, revision history, and project metadata.

#### 3.2.1 Glossary Terms Table

**Purpose:** Stores mandatory term mappings that must be enforced in every translation.

```sql
CREATE TABLE glossary_terms (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sourceTerm  TEXT NOT NULL,      -- e.g., "Government"
  targetTerm  TEXT NOT NULL,      -- e.g., "Gobierno" (Spanish) or "सरकार" (Hindi)
  sourceLang  TEXT NOT NULL,
  targetLang  TEXT NOT NULL,
  domain      TEXT,               -- e.g., "general", "legal", "finance"
  isMandatory BOOLEAN DEFAULT 1,  -- If true, must appear in translation
  createdAt   TEXT DEFAULT (datetime('now'))
);
```

**How glossary terms are used:**
1. Before LLM translation (Layer 4), relevant glossary terms are fetched for the source-target language pair.
2. They are injected directly into the LLM prompt as hard constraints:
   ```
   REQUIRED GLOSSARY TERMS (MUST USE EXACTLY IF SOURCE TERM IS PRESENT):
   "Government" → "Gobierno"
   "Technology" → "Tecnología"
   ```
3. After translation, a **deterministic post-check** verifies the LLM actually used them (see Layer 2's glossary enforcement step).

#### 3.2.2 Style Profiles Table

**Purpose:** Stores per-project or per-language tone and style configuration.

```sql
CREATE TABLE style_profiles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  profileName TEXT NOT NULL,       -- e.g., "General Purpose"
  tone        TEXT NOT NULL,       -- e.g., "Professional", "Casual", "Legal"
  formality   TEXT DEFAULT 'formal', -- "formal", "informal", "neutral"
  targetLang  TEXT,
  rules       TEXT,                -- JSON blob of additional rules
  createdAt   TEXT DEFAULT (datetime('now'))
);
```

**How style profiles are used:**
1. When a project is created, a style profile is assigned (or defaults to "Professional, General Purpose").
2. The profile's tone and formality settings are included in the LLM prompt as `STYLE REQUIREMENTS`.
3. Multiple profiles can exist for different industries or languages.

#### 3.2.3 Revisions Table (Human Edits)

**Purpose:** Tracks every human edit to a translation, creating an audit trail and training data for QLoRA fine-tuning (Layer 5).

```sql
CREATE TABLE revisions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  tmRecordId      INTEGER REFERENCES tm_records(id),
  segmentId       TEXT NOT NULL,
  originalOutput  TEXT NOT NULL,       -- What the LLM originally generated
  humanRevision   TEXT NOT NULL,       -- What the human corrected it to
  editDistance     INTEGER,            -- Levenshtein distance for metrics
  editorId        TEXT,
  createdAt       TEXT DEFAULT (datetime('now'))
);
```

**How revisions are used:**
1. When a reviewer modifies the target text before clicking "Approve", the original LLM output and final human-approved version are both saved.
2. These pairs form the **training dataset** for QLoRA fine-tuning (Layer 5):
   - `input: source text + original LLM output`
   - `output: human-corrected version`
3. The edit distance metric helps identify which types of errors the LLM makes most frequently.
4. Over time, this data improves the LoRA adapters, reducing human corrections needed.

---

## Data Flow Through Layer 3

```
┌─────────────────────────────────────────────────┐
│                  INCOMING REQUEST                │
│            (source text + lang pair)             │
└──────────────────────┬──────────────────────────┘
                       │
                       ▼
              ┌────────────────┐
              │  Exact String  │ ── YES ──► Return score=1.0
              │    Match?      │            matchType='EXACT'
              └───────┬────────┘
                      │ NO
                      ▼
              ┌────────────────┐
              │   Generate     │
              │   Embedding    │ ◄── text-embedding-004 API
              └───────┬────────┘
                      │
                      ▼
              ┌────────────────┐
              │  Cosine Sim    │
              │  vs All TM     │ ── In-memory loop
              │  Records       │
              └───────┬────────┘
                      │
              ┌───────┴───────┐
              │               │
         score ≥ 0.75    score < 0.75
              │               │
              ▼               ▼
         Return FUZZY    Return NEW
         (with TM ref)   (needs LLM)
```

---

## Why SQLite Instead of Pinecone / Dedicated Vector DB

| Factor | SQLite (ClearLingo) | Pinecone / Weaviate |
|---|---|---|
| Setup time | 0 — single file, no config | Hours (API key, indexes, schema) |
| Network dependency | None — fully local | Requires internet |
| Latency for 1K vectors | < 3ms (in-memory) | 50–200ms (network) |
| Cost | Free | Paid tiers |
| Hackathon reliability | 100% — no external failure modes | Risk of API rate limits, outages |
| Persistence | Single `.db` file survives restart | Cloud-hosted |
| Complexity | `npm install better-sqlite3` | SDK + auth + index management |
