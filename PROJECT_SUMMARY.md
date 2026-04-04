# ClearLingo — Complete Project Summary

> **AI-Powered Enterprise Translation Platform with RAG, Sarvam AI, Gemini, and Continuous Self-Improvement**

---

## 1. What is ClearLingo?

ClearLingo is a **full-stack, AI-powered Computer-Assisted Translation (CAT) platform** built for enterprise document translation. It combines a **Translation Memory (TM) engine**, **Retrieval-Augmented Generation (RAG)**, **multi-model LLM orchestration** (Google Gemini + Sarvam AI), and a **continuous learning pipeline** — all in a single-server, zero-infrastructure Node.js application.

### Core Value Proposition

| Problem | ClearLingo Solution |
|---|---|
| Enterprise translation is slow and expensive (₹400/segment at agency rates) | AI + TM leverage reduces cost by 94%+ |
| Human translators are inconsistent across glossary terms | Mandatory glossary enforcement at prompt + post-translation audit |
| Indian language support is poor in general-purpose LLMs | Sarvam AI (Gemma3-4B fine-tuned by AI4Bharat) for all 22 scheduled Indian languages |
| Translation quality degrades without feedback loops | QLoRA fine-tuning pipeline retrains on human corrections |
| Document formatting is lost after translation | Structured DOCX parser preserves bold/italic/underline per-run |

---

## 2. Architecture Overview

ClearLingo follows a **6-Layer Architecture**, with each layer as an independent, composable module:

```
┌─────────────────────────────────────────────────────────┐
│                  Layer 1: Web UI (React)                │
│   Home · Upload · Editor · Validation · Analytics       │
│   Training Pipeline · Loading Screen                    │
├─────────────────────────────────────────────────────────┤
│               Layer 2: API Gateway (Express)            │
│   /parse · /translate · /validate · /approve · /export  │
│   /rag · /llm · /training · /analytics · /import-tm     │
├─────────────────────────────────────────────────────────┤
│               Layer 3: Core RAG Engine                  │
│   Vector TM (SQLite + 768-dim embeddings)               │
│   Glossary Enforcement · Style Profiles · Revisions     │
├─────────────────────────────────────────────────────────┤
│            Layer 4: LLM Orchestration Engine            │
│   Gemini 2.0 Flash · Sarvam AI · LoRA Adapters          │
│   Smart Routing · Translation Cache · QA Agent          │
├─────────────────────────────────────────────────────────┤
│            Layer 5: Training Pipeline                   │
│   Dataset Extraction · QLoRA Fine-Tuning (Simulated)    │
│   A/B Testing · Auto-Deploy · Rollback                  │
├─────────────────────────────────────────────────────────┤
│            Layer 6: Analytics Dashboard                 │
│   TM Leverage · Glossary Compliance · Cost Savings      │
│   Segment Velocity · Language Coverage                  │
└─────────────────────────────────────────────────────────┘
```

---

## 3. Tech Stack

### Frontend
| Technology | Purpose |
|---|---|
| **React 18** | UI framework |
| **Vite 6.3** | Dev server & bundler |
| **Tailwind CSS 4** | Utility-first styling |
| **Zustand** | Global state management (2 stores: `useAppStore` + `useDashboardStore`) |
| **Radix UI** | Accessible headless components (accordion, dialog, dropdown, tabs, etc.) |
| **Recharts** | Dashboard charts and visualizations |
| **Framer Motion** | Animations and transitions |
| **Lucide React** | Icon library |
| **React Router 7** | Client-side routing |
| **Sonner** | Toast notifications |

### Backend
| Technology | Purpose |
|---|---|
| **Node.js (ESM)** | Runtime |
| **Express 5** | HTTP framework |
| **better-sqlite3** | Embedded database (WAL mode, zero config) |
| **Google Generative AI SDK** | Gemini 2.0 Flash (translation/validation) + text-embedding-005 (768-dim vectors) |
| **Sarvam AI REST API** | Indian language translation via sarvam-translate:v1 |
| **Multer** | File upload handling |
| **Mammoth** | DOCX → plain text extraction |
| **JSZip + fast-xml-parser** | Structured DOCX parsing (format-preserving) |
| **pdf-parse** | PDF text extraction |
| **xlsx** | Excel file parsing |
| **docx (npm)** | DOCX generation for export |
| **pdfkit** | PDF generation for export |

### Environment Variables
```env
GEMINI_API_KEY=...       # Google Gemini API key
SARVAM_API_KEY=...       # Sarvam AI subscription key
MOCK_MODE=false          # true = offline demo mode (no API calls)
PORT=3001                # Backend port
```

---

## 4. Database Schema (SQLite — `clearlingo.db`)

### Core Translation Tables

| Table | Purpose | Key Columns |
|---|---|---|
| `projects` | Translation projects | `id`, `name`, `source_language`, `target_language`, `style_profile`, `context` |
| `segments` | Individual text segments within a project | `id` (UUID), `project_id`, `idx`, `source_text`, `target_text`, `original_target`, `tm_score`, `match_type` (EXACT/FUZZY/NEW), `status` (PENDING/APPROVED/REJECTED), `violation`, `format_type` |
| `tm_records` | Translation Memory entries | `id`, `source_text`, `target_text`, `source_lang`, `target_lang`, `embedding` (768-dim JSON), `context`, `approved_at` |
| `glossary` | Mandatory terminology mappings | `id`, `source_term`, `target_term`, `domain` (general/legal/finance/medical), `is_mandatory` |
| `style_profiles` | Tone/formality configuration | `id`, `profile_name`, `tone`, `formality`, `rules` (JSON), `description` |
| `revisions` | Human corrections (training data source) | `id`, `segment_id`, `source_text`, `original_output`, `human_revision`, `edit_distance` |

### LLM & Cost Tracking Tables

| Table | Purpose |
|---|---|
| `llm_call_log` | Per-request cost/token/latency tracking |
| `translation_cache` | Semantic dedup cache (source+lang+model → cached output) |
| `lora_adapters` | LoRA adapter registry (status: active/inactive/training/testing) |

### Training Pipeline Tables

| Table | Purpose |
|---|---|
| `training_datasets` | Versioned dataset snapshots for fine-tuning |
| `training_runs` | QLoRA training job tracking (progress, loss curves) |
| `ab_test_results` | Base vs adapter evaluation results |

### Analytics Tables

| Table | Purpose |
|---|---|
| `translation_log` | Per-segment match type + cost + latency |
| `glossary_checks` | Per-segment glossary compliance audit |
| `qa_results` | Post-translation QA agent findings (DeepTrans) |

**Total: 14 tables** with automatic migrations via `addColumnIfNotExists()`.

---

## 5. Backend Modules (Detailed)

### 5.1 `server/index.js` — API Gateway (Layer 2)

The Express application entrypoint. Mounts all route modules, defines utility endpoints, and prints a comprehensive startup dashboard showing Layer 3/4/5 status.

**Key endpoints defined inline:**
- `GET /api/segments/:projectId` — Fetch all segments for a project
- `GET /api/qa-results/:projectId` — QA audit results
- `GET /api/glossary/:language` — Glossary terms
- `GET /api/projects` — All projects
- `GET /api/languages` — Full language registry (40+ languages)
- `GET /api/health` — Full system health (RAG stats, LLM stats, training status)
- `GET /api/style-profiles` — Style configuration
- `GET /api/tm-records/:language` — TM records with embedding status

### 5.2 `server/gemini.js` — Gemini API Client

Central Gemini API abstraction with mock mode fallback.

**Key functions:**
| Function | Purpose |
|---|---|
| `translateText()` | Gemini 2.0 Flash constrained translation with glossary injection + fuzzy reference + style prompt |
| `generateEmbedding()` | Generate a single 768-dim vector via text-embedding-005 |
| `batchEmbed()` | Batch embed N texts (auto-chunks to 100/call, rate limited) |
| `cosineSimilarity()` | In-memory vector similarity |
| `findBestMatch()` | Find highest-similarity TM match above threshold |
| `validateWithGemini()` | 5-point quality engine (spelling, grammar, consistency, formatting, glossary) |
| `qaCheckTranslation()` | Post-translation QA audit (DeepTrans) |
| `editDistance()` | Levenshtein distance for revision tracking |
| `formatStyleForPrompt()` | Convert style profile to prompt text |

**Smart features:**
- Automatic `[context] ` prefix on all embeddings for domain-aware vector search
- Rate limiter integration (15 RPM with exponential backoff)
- Mock mode returns realistic fake data for offline development

### 5.3 `server/rag-engine.js` — Core RAG Engine (Layer 3)

The heart of the system. Manages all Translation Memory operations.

**Three-Tier TM Lookup Algorithm:**
```
Input: "Patient must get prior authorization"

TIER 1: Exact String Match (SQLite LOWER(TRIM()))
  → Score: 1.0, match type: EXACT

TIER 2: Semantic Vector Search (cosine similarity ≥ 0.95)
  → Generates embedding, finds nearest TM vector
  → Score: 0.95–1.0 = EXACT, 0.75–0.95 = FUZZY, <0.75 = NEW

TIER 3: Edit Distance Fallback
  → Character-level Levenshtein for context-free matching
```

**Key functions:**
| Function | Purpose |
|---|---|
| `tmExactLookup()` | Phase 1 only — SQLite exact match (zero network cost) |
| `tmLookup()` | Full three-tier lookup with optional precomputed embedding |
| `tmWrite()` | Insert approved translation into TM with embedding |
| `backfillEmbeddings()` | Batch-embed all un-embedded TM records on startup |
| `glossaryLookup()` | Fetch glossary terms for a language pair |
| `glossaryEnforce()` | Post-translation glossary compliance check |
| `styleProfileGet()` | Fetch and format a style profile for prompt injection |
| `revisionWrite()` | Record a human correction (→ training data) |

**Batch Embedding Optimization:**
- Two-pass strategy: cheap exact match filter → batch embed unresolved
- 50 segments = **1 API call** instead of 50 sequential calls
- ~98.7% latency reduction on document upload

### 5.4 `server/llm-orchestrator.js` — LLM Orchestration Engine (Layer 4)

Centralizes ALL LLM interactions. Routes translation requests to the optimal model.

**Smart Model Routing:**
```
Input language pair → Router decision:

Indian languages (hi_IN, ta_IN, etc.)
  + Sarvam AI available?
    → YES: sarvam-translate:v1 (Gemma3-4B, AI4Bharat)
    → NO:  Gemini 2.0 Flash (fallback)

European / East Asian / Other
  → Gemini 2.0 Flash
```

**Key functions:**
| Function | Purpose |
|---|---|
| `translateBatch()` | Main batch translation pipeline — TM lookup → glossary → LLM → QA audit |
| `translateSegment()` | Single segment translation with prompt construction + cost logging |
| `translate()` | Standalone single translation (for benchmarks) |
| `routeModel()` | Smart model selection (Sarvam vs Gemini) |
| `registerAdapter()` | Register a LoRA adapter in the registry |
| `getStats()` | Cost, token, cache, and adapter metrics |

**`translateBatch()` Pipeline (per document):**
1. **Term Extraction** — LLM discovers domain-specific terms not in glossary
2. **Cross-reference** — Split terms into known (glossary) vs unknown (hints)
3. **Two-Pass TM Lookup** — Exact match filter → batch embed → vector search
4. **For each segment:**
   - EXACT match → use TM directly (skip LLM, ₹0 cost)
   - FUZZY match → LLM translation with TM as style reference
   - NEW → Full LLM translation with glossary injection
5. **Post-translation QA** — LLM-based quality audit for NEW segments
6. **Glossary enforcement** — Verify mandatory terms appear in output
7. **Cost logging** — Track tokens, latency, model used

### 5.5 `server/sarvam.js` — Sarvam AI Integration

Dedicated client for Sarvam AI's Indian language translation API.

**Features:**
- All 22 scheduled Indian languages supported
- Formal/colloquial translation modes
- Language code mapping (ClearLingo's `hi_IN` → Sarvam's `hi-IN`)
- Automatic retry with exponential backoff (max 3 attempts)
- Graceful fallback to Gemini if Sarvam is unavailable

### 5.6 `server/term-extractor.js` — Pre-Translation Term Extraction (DeepTrans)

Uses Gemini 2.0 Flash to scan source text BEFORE translation and discover domain-specific terminology.

**Flow:**
1. Concatenate all source segments
2. LLM extracts terms with categories (legal, medical, finance, technical, general)
3. Cross-reference against existing glossary
4. Unknown terms → injected as hints into translation prompts

### 5.7 `server/training-pipeline.js` — Training Pipeline (Layer 5)

Continuous improvement engine that learns from human corrections.

**§5.1 Dataset Collection:**
- Extracts from `revisions` table (human corrections with edit distance)
- Quality filters: exclude full rewrites (edit_distance > 200), empty entries
- Formats into instruction-tuning pairs with glossary + style context
- Versioned snapshots: `ds-2026-04-02-001`

**§5.2 QLoRA Fine-Tuning:**
- Simulated training with realistic SSE-streamed progress
- Deterministic metrics per language pair (same input = same BLEU score)
- Clean swap point for real Unsloth training (`USE_REAL_TRAINING=true`)
- Config: rank=16, alpha=16, lr=2e-4, batch=4, epochs=3

**§5.3 A/B Testing & Auto-Deploy:**
- Compares base model vs adapter on held-out test set (20%)
- Auto-deploy criteria: BLEU improved ≥ 0.02 AND glossary compliance ≥ 99.8% AND edit distance improved
- Manual review flag for borderline results
- Rollback capability to previous adapter version

### 5.8 `server/flores-eval.js` — FLORES-200 Quality Benchmark

Automated quality checking using a curated subset of FLORES-200 (eng→hin).

- Randomly samples 3 sentences
- Translates via the full LLM orchestration pipeline
- Scores output against ground truth using token overlap (F1 proxy for BLEU)
- Returns per-sentence and average scores

### 5.9 `server/parsers/docx-structured.js` — Structured DOCX Parser (DeepTrans)

Format-preserving DOCX parser using raw OOXML parsing.

**Preserves per-run:**
- Bold, italic, underline flags
- Font color (hex)
- Font size (half-points)
- Format type: heading / paragraph / list_item

**Uses:** JSZip for DOCX unzipping → fast-xml-parser for XML → structured segment objects

### 5.10 `server/middleware.js` — Rate Limiter & Error Handling

**GeminiRateLimiter class:**
- 15 RPM sliding window
- Automatic queue + wait calculation
- Exponential backoff on 429 errors (max 30s)
- Singleton instance shared across all modules

**Error handler:**
- Structured JSON error responses
- Special handling for rate limits (429 + Retry-After header)
- Graceful degradation for embedding failures

---

## 6. API Routes (Detailed)

### 6.1 `POST /api/parse` — Document Upload & Parsing
**Input:** Multipart form (file upload: DOCX/PDF/XLSX/TXT) + language + context
**Pipeline:**
1. Parse document → extract segments
2. Create project in DB
3. Backfill TM embeddings for the target language
4. **Two-Pass TM Lookup:** Exact filter → Batch embed → Vector search
5. Insert all segments with TM scores
6. Return project ID + segment array

### 6.2 `POST /api/translate` — Batch Translation
**Input:** `{ projectId, targetLang }`
**Pipeline:** Calls `translateBatch()` — full pipeline with term extraction, TM lookup, LLM translation, QA audit

### 6.3 `POST /api/validate` — 5-Point Quality Validation
**Input:** `{ segments }` array
**Pipeline:** Gemini-based validation checking spelling, grammar, consistency, formatting, glossary compliance

### 6.4 `POST /api/approve` — Segment Approval + TM Write
**Input:** `{ segmentId, targetText }`
**Pipeline:**
1. Update segment status to APPROVED
2. Write to TM with embedding
3. Record revision (if text was edited)
4. Log to translation_log + glossary_checks

### 6.5 `POST /api/export` — Document Export
**Output formats:** DOCX / PDF / TXT
**Pipeline:** Generates formatted output from approved segments

### 6.6 `POST /api/rag/search` — Standalone TM Search
**Input:** `{ query, language }`
**Output:** Top semantic matches from TM

### 6.7 `POST /api/import-tm` — TMX/CSV Import
**Input:** Multipart form (TMX or CSV file)
**Pipeline:** Parses file → bulk insert into tm_records

### 6.8 Training Pipeline Routes
| Route | Purpose |
|---|---|
| `POST /api/training/extract` | Extract dataset from revisions |
| `POST /api/training/start` | Start QLoRA training run |
| `GET /api/training/runs/:id/stream` | SSE real-time training progress |
| `GET /api/training/status` | Full pipeline dashboard |
| `POST /api/training/ab-test/:runId` | Run A/B evaluation |
| `POST /api/training/deploy/:runId` | Manual deploy adapter |
| `POST /api/training/rollback/:adapterId` | Rollback to previous adapter |

### 6.9 Analytics Routes
| Route | Purpose |
|---|---|
| `GET /api/analytics/dashboard` | Full Layer 6 dashboard data |
| `GET /api/analytics/leverage` | TM leverage rate over time |
| `GET /api/analytics/compliance` | Glossary compliance metrics |
| `GET /api/analytics/cost` | Cost savings analysis |

### 6.10 LLM Debug Routes
| Route | Purpose |
|---|---|
| `GET /api/llm/stats` | LLM call/token/cost stats |
| `POST /api/llm/translate-single` | Debug single segment translation |
| `GET /api/llm/sarvam/status` | Sarvam AI connection status |
| `GET /api/llm/adapters` | LoRA adapter registry |
| `GET /api/llm/cache/stats` | Translation cache metrics |

---

## 7. Frontend (Detailed)

### 7.1 Screens

| Screen | Route | Purpose |
|---|---|---|
| **LoadingScreen** | `/` | Animated entry screen with branding |
| **Home** | `/home` | Landing page with feature cards, language showcase, pricing, stats |
| **DocumentUpload** | `/upload` | Drag-and-drop file upload with language/style selection |
| **TranslationEditor** | `/editor` | Core editing interface — side-by-side source/target with TM scoring, inline editing, approve/reject, batch operations |
| **Validation** | `/validation` | 5-point quality engine results with auto-fix capability |
| **Analytics** | `/analytics` | Layer 6 dashboard — TM leverage, glossary compliance, cost savings, segment velocity, language coverage (Recharts) |
| **TrainingPipeline** | `/training` | Full Layer 5 UI — dataset extraction, training run management, A/B testing, adapter deployment, SSE log streaming |

### 7.2 Reusable Components

| Component | Purpose |
|---|---|
| `Navigation` | App-wide nav bar with route links |
| `SegmentRow` | Individual segment card with match type badge, edit controls |
| `Badge` | Status badges (EXACT/FUZZY/NEW, APPROVED/PENDING) |
| `Button` | Themed button with variants |
| `FeatureCard` | Feature showcase card |
| `PricingCard` | Pricing tier card |
| `StatCounterCard` | Animated stat counter |
| `LanguagePillCard` | Language tag display |
| `CodeBlock` | Code display component |
| `ResearchCard` | Research/paper reference card |
| `SectionLabel` | Section header component |

### 7.3 State Management (Zustand)

**`useAppStore`** — Core application state:
- Current project (id, name, languages)
- Segments array with full CRUD operations
- Validation results
- Glossary terms
- Computed stats (leverage rate, approved count, violations, cost savings)
- Actions: approve, reject, revert, propagate approval, approve all exact, auto-fix

**`useDashboardStore`** — Analytics dashboard:
- Full dashboard data (leverage, compliance, cost, TM growth, velocity, review time, language coverage)
- Auto-refresh from `/api/analytics/dashboard`

---

## 8. Supported Languages (40+)

### Indian Languages (22 — via Sarvam AI)
Hindi, Bengali, Tamil, Telugu, Marathi, Gujarati, Kannada, Malayalam, Punjabi, Odia, Assamese, Urdu, Nepali, Sanskrit, Maithili, Konkani, Dogri, Sindhi, Kashmiri, Manipuri, Bodo, Santali, Sinhala

### European Languages (10 — via Gemini)
Spanish, French, German, Italian, Portuguese, Dutch, Russian, Polish, Swedish, Turkish

### East Asian Languages (3 — via Gemini)
Japanese, Korean, Chinese

### Other Languages (3 — via Gemini)
Arabic, Thai, Vietnamese

---

## 9. Key Data Flow: End-to-End Document Translation

```
┌──────────────────────────────────────────────────────────────┐
│ 1. USER uploads DOCX file at /upload                        │
│    → Language: English → Hindi                               │
│    → Style: Professional | Context: General Business         │
└──────────────────┬───────────────────────────────────────────┘
                   ▼
┌──────────────────────────────────────────────────────────────┐
│ 2. POST /api/parse                                           │
│    → Mammoth (or structured parser) extracts 50 segments     │
│    → backfillEmbeddings() for existing TM records            │
│    ┌─────────────────────────────────────────────────────┐   │
│    │ Pass 1: tmExactLookup() × 50 (SQLite, ~0ms each)   │   │
│    │ → 12 exact matches found                            │   │
│    ├─────────────────────────────────────────────────────┤   │
│    │ Pass 2: batchEmbed() 38 texts (1 API call, ~200ms) │   │
│    │ → tmLookup() × 38 with precomputed embeddings       │   │
│    │ → 8 FUZZY matches, 30 NEW segments                  │   │
│    └─────────────────────────────────────────────────────┘   │
│    → All 50 segments inserted into DB                        │
│    → Returns: { projectId, segments, stats }                 │
└──────────────────┬───────────────────────────────────────────┘
                   ▼
┌──────────────────────────────────────────────────────────────┐
│ 3. POST /api/translate                                       │
│    → extractTerms() discovers 5 domain terms                 │
│    → crossReferenceGlossary() → 3 known, 2 unknown          │
│    ┌─────────────────────────────────────────────────────┐   │
│    │ Pass 1: tmExactLookup() → 12 EXACT (₹0 each)      │   │
│    ├─────────────────────────────────────────────────────┤   │
│    │ Pass 2: batchEmbed() 38 texts (1 API call)          │   │
│    │ For each non-exact:                                  │   │
│    │   FUZZY: Sarvam AI translate + TM style reference    │   │
│    │   NEW:   Sarvam AI translate + glossary injection    │   │
│    │   → QA audit (Gemini) for NEW segments              │   │
│    │   → Glossary enforcement check                       │   │
│    └─────────────────────────────────────────────────────┘   │
│    → Returns: { results, stats, cost }                       │
└──────────────────┬───────────────────────────────────────────┘
                   ▼
┌──────────────────────────────────────────────────────────────┐
│ 4. USER reviews in /editor                                   │
│    → Side-by-side view with TM scores + match type badges    │
│    → Edits translations inline                               │
│    → Approves segments (✓) or rejects (✗)                    │
│    → "Approve All Exact" bulk action                         │
└──────────────────┬───────────────────────────────────────────┘
                   ▼
┌──────────────────────────────────────────────────────────────┐
│ 5. POST /api/approve (per segment)                           │
│    → Writes approved text to TM (with new embedding)         │
│    → Records revision if text was modified                   │
│    → Logs to translation_log + glossary_checks               │
│    → TM grows with every approval → future docs get faster   │
└──────────────────┬───────────────────────────────────────────┘
                   ▼
┌──────────────────────────────────────────────────────────────┐
│ 6. POST /api/validate                                        │
│    → Gemini runs 5-point quality check:                      │
│      ① Spelling ② Grammar ③ Consistency ④ Formatting ⑤ Gloss│
│    → Returns quality score + issues + auto-fix suggestions   │
└──────────────────┬───────────────────────────────────────────┘
                   ▼
┌──────────────────────────────────────────────────────────────┐
│ 7. POST /api/export (DOCX / PDF / TXT)                       │
│    → Generates final document with translations              │
│    → DOCX preserves formatting metadata if available         │
└──────────────────────────────────────────────────────────────┘
```

---

## 10. Key Data Flow: Training Pipeline (Continuous Improvement)

```
Approved Segments (with human edits)
         │
         ▼
┌─────────────────────────────────────────┐
│ Revisions Table (edit_distance > 0)     │
│ "Original LLM output" vs "Human fix"   │
│ Currently: 15 seed revisions            │
└────────────────┬────────────────────────┘
                 ▼
┌─────────────────────────────────────────┐
│ §5.1: Dataset Extraction                │
│ POST /api/training/extract              │
│                                         │
│ Filters:                                │
│   - Exclude edit_distance > 200         │
│   - Exclude empty/trivial edits         │
│   - Format: instruction-tuning JSON     │
│   - Version: ds-2026-04-02-001          │
│   Status: 'ready' if pairs ≥ 10         │
└────────────────┬────────────────────────┘
                 ▼
┌─────────────────────────────────────────┐
│ §5.2: QLoRA Fine-Tuning                 │
│ POST /api/training/start                │
│                                         │
│ Config: rank=16, alpha=16, lr=2e-4      │
│ 3 epochs with SSE-streamed progress     │
│ Deterministic metrics per lang pair     │
│                                         │
│ Output: LoRA adapter (42-58MB)          │
│ Status: 'testing' (not active yet)      │
└────────────────┬────────────────────────┘
                 ▼
┌─────────────────────────────────────────┐
│ §5.3: A/B Testing                       │
│ POST /api/training/ab-test/:runId       │
│                                         │
│ Compares on 20% held-out test set:      │
│   • BLEU score                          │
│   • Edit distance                       │
│   • Glossary compliance                 │
│   • Human preference rate               │
│                                         │
│ Auto-deploy if:                         │
│   BLEU Δ ≥ 0.02 AND compliance ≥ 99.8% │
│   AND edit distance improved            │
│                                         │
│ Otherwise: flagged for manual review    │
└────────────────┬────────────────────────┘
                 ▼
┌─────────────────────────────────────────┐
│ Active Adapter                          │
│ Layer 4 uses it on next translation     │
│ Rollback available if quality drops     │
└─────────────────────────────────────────┘
```

---

## 11. Seed Data

The database auto-seeds on first startup:

| Data | Count | Purpose |
|---|---|---|
| Glossary terms | 17 | Hindi business/legal/medical/finance terms (15 mandatory, 2 optional) |
| TM records | 9 | English → Hindi translation pairs (including paraphrase test) |
| Style profiles | 4 | Professional, Legal, Casual, Medical |
| Revisions | 15 | Human corrections for training pipeline demo |
| Translation log | 100 | 7-day analytics data (52% EXACT, 42% FUZZY, 6% NEW) |
| Glossary checks | 60 | Compliance audit data (1 intentional violation) |

Additional seed scripts:
- `seed_tm.js` — Bulk seed from Samanantar + EuroParl
- `data_seeds/europarl_en_fr_seed.json` — 1000+ EN→FR pairs
- `data_seeds/samanantar_iitb_en_hi_seed.json` — 500+ EN→HI pairs

---

## 12. Performance Optimizations

### Batch Embedding (Latest)
| Metric | Before | After | Improvement |
|---|---|---|---|
| `backfillEmbeddings` (200 records) | 200 × 200ms = **40s** | 2 × 200ms = **0.4s** | **99%** |
| `parse.js` TM lookup (50 segments) | 50 × 200ms = **10s** | 1 × 200ms = **0.2s** | **98%** |
| `translateBatch` TM lookup (50 segs) | 50 × 200ms = **10s** | 1 × 200ms = **0.2s** | **98%** |
| **Total embedding latency** | **~60s** | **~0.8s** | **98.7%** |

### Other Optimizations
- **Translation cache** — Exact dedup prevents re-translating identical segments
- **TM cascade** — EXACT matches skip LLM entirely (₹0 cost)
- **SQLite WAL mode** — Better concurrent read/write performance
- **Rate limiter** — Respects Gemini's 15 RPM limit with intelligent queueing

---

## 13. File Tree (Annotated)

```
d:\Codes\Hackathon\
├── server/
│   ├── index.js                 # Express app, route mounting, startup dashboard
│   ├── db.js                    # SQLite schema (14 tables), migrations, seed data
│   ├── gemini.js                # Gemini API client (translate, embed, validate, QA)
│   ├── rag-engine.js            # Layer 3: TM lookup, glossary, style profiles, revisions
│   ├── llm-orchestrator.js      # Layer 4: Multi-model routing, batch translation, cost tracking
│   ├── sarvam.js                # Sarvam AI client (22 Indian languages)
│   ├── training-pipeline.js     # Layer 5: Dataset extraction, QLoRA training, A/B testing
│   ├── term-extractor.js        # DeepTrans: Pre-translation term discovery
│   ├── flores-eval.js           # FLORES-200 quality benchmark
│   ├── middleware.js             # Rate limiter (15 RPM), error handler, language registry
│   ├── parsers/
│   │   └── docx-structured.js   # DeepTrans: Format-preserving DOCX parser
│   └── routes/
│       ├── parse.js             # Document upload + two-pass TM processing
│       ├── translate.js         # Batch translation endpoint
│       ├── validate.js          # 5-point quality engine
│       ├── approve.js           # Segment approval + TM write + revision
│       ├── export.js            # DOCX/PDF/TXT export
│       ├── rag.js               # Standalone TM search + stats
│       ├── llm.js               # LLM debug endpoints
│       ├── training.js          # Training pipeline API + SSE streaming
│       ├── analytics.js         # Layer 6 dashboard + metrics
│       └── import-tm.js         # TMX/CSV TM import
├── src/
│   ├── main.tsx                 # React entry point
│   ├── app/
│   │   ├── App.tsx              # RouterProvider wrapper
│   │   ├── routes.tsx           # React Router config (7 routes)
│   │   ├── store.ts             # Zustand stores (useAppStore + useDashboardStore)
│   │   ├── screens/
│   │   │   ├── Home.tsx         # Landing page (38KB)
│   │   │   ├── DocumentUpload.tsx  # File upload (21KB)
│   │   │   ├── TranslationEditor.tsx  # Core editor (28KB)
│   │   │   ├── Validation.tsx   # Quality engine (17KB)
│   │   │   ├── Analytics.tsx    # Dashboard (41KB)
│   │   │   ├── TrainingPipeline.tsx  # Training UI (52KB)
│   │   │   └── LoadingScreen.tsx  # Animated entry (5KB)
│   │   └── components/
│   │       ├── Navigation.tsx, Badge.tsx, Button.tsx, SegmentRow.tsx...
│   │       ├── figma/           # Figma-exported components
│   │       └── ui/              # Radix-based primitives
│   └── styles/
│       ├── theme.css            # Design tokens and theme (11KB)
│       ├── fonts.css            # Google Fonts imports
│       ├── index.css            # Root styles
│       └── tailwind.css         # Tailwind entry
├── data_seeds/
│   ├── samanantar_iitb_en_hi_seed.json  # 500+ EN→HI pairs
│   └── europarl_en_fr_seed.json         # 1000+ EN→FR pairs
├── guidelines/                  # Architecture specs (Layers 1–6)
├── clearlingo.db                # SQLite database (auto-created)
├── package.json                 # Dependencies (80+ packages)
├── vite.config.ts               # Vite build config
└── .env                         # API keys + config
```

---

## 14. How to Run

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your GEMINI_API_KEY and SARVAM_API_KEY

# 3. Start backend (port 3001)
npm run server

# 4. Start frontend (port 5173)
npm run dev

# 5. Open http://localhost:5173
```

**Mock mode:** Set `MOCK_MODE=true` in `.env` to run without API keys (uses realistic fake data).

---

## 15. Cost Model

| Match Type | Cost per Segment (₹) | Who Handles |
|---|---|---|
| EXACT (TM match ≥ 0.95) | ₹0 | Served from TM, no LLM call |
| FUZZY (TM match 0.75–0.95) | ₹15 | LLM refines TM suggestion |
| NEW (no TM match) | ₹75 | Full LLM translation |
| Manual agency rate | ₹400 | Traditional vendor |

**Savings calculation:** `(EXACT + FUZZY) × (₹400 - ₹40) = cost saved`

With 94% TM leverage → **~90% cost reduction** vs. agency rates.

---

*Generated: 2026-04-02 | ClearLingo v0.0.1 | Hackathon Project by Team SourceShipIt/WordX*
