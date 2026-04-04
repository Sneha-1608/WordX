# ClearLingo — Detailed IDE AI Implementation Prompt
# Post-Hackathon Improvements: All 4 Enhancements

> Copy this entire document and paste it into your IDE AI (Cursor, Copilot, Windsurf, etc.).
> It covers all 4 improvements with exact file paths, function signatures, schemas, and acceptance criteria.

---

## CONTEXT BRIEFING (Read This First)

You are working on **ClearLingo**, a full-stack AI-powered Computer-Assisted Translation (CAT) platform.

**Tech Stack:**
- Frontend: React 18 + Vite 6.3 + Tailwind CSS 4 + Zustand + Radix UI + Framer Motion
- Backend: Node.js (ESM) + Express 5 + better-sqlite3 (WAL mode)
- AI: Google Gemini 2.0 Flash (translation/embed) + Sarvam AI (Indian languages)
- Parsers: JSZip + fast-xml-parser (DOCX), Mammoth, pdfkit, docx (npm)

**Project Root:** `d:\Codes\Hackathon\`

**Key Files You Will Touch:**
- `server/parsers/docx-structured.js` — Format-preserving DOCX parser
- `server/flores-eval.js` — FLORES-200 benchmark evaluator
- `server/db.js` — SQLite schema + migrations
- `server/index.js` — Express app entrypoint
- `server/rag-engine.js` — Core RAG/TM engine (Layer 3)
- `server/routes/translate.js` — Batch translation endpoint
- `server/routes/approve.js` — Segment approval + TM write
- `server/routes/export.js` — DOCX/PDF/TXT export
- `src/app/screens/TranslationEditor.tsx` — Core editor UI (28KB)
- `src/app/store.ts` — Zustand stores

**DO NOT break existing functionality.** All 4 improvements are additive. Existing API contracts must remain intact.

---

---

# IMPROVEMENT 1: Sub-Segment Style Mapping in the DOCX Parser

## Problem Statement

The current format-preserving DOCX parser in `server/parsers/docx-structured.js` extracts segments from DOCX XML, but when it writes the translated text back into the DOCX, it applies the **first run's XML style attributes** to the entire translated segment as a single monolithic run. This means that if the original English text was:

```
"Please review the <bold>contract terms</bold> and sign."
```

…the translated Hindi output becomes a single run:

```
"<bold>कृपया अनुबंध की शर्तों की समीक्षा करें और हस्ताक्षर करें।</bold>"
```

The bold is incorrectly applied to the entire sentence instead of only the translated equivalent of "contract terms".

## Goal

Implement **token-to-XML run alignment**: after translation, use an LLM call to map which portion of the translated output corresponds to which styled run in the source, then reconstruct the DOCX XML with multiple `<w:r>` runs, each carrying the correct `<w:rPr>` (run properties: bold, italic, underline, font, size, color).

---

## Step-by-Step Implementation

### Step 1 — Understand the current parser structure

Open `server/parsers/docx-structured.js` and locate the following:

1. The function that extracts `paragraphs` from the DOCX XML — it should currently be reading `<w:p>` elements and collecting `<w:r>` runs into a flat `text` string. Note that each run has a `<w:rPr>` (run properties block) and a `<w:t>` (text content).

2. The function that **writes back** translated segments into the XML — it currently takes the translated string and wraps it in a single `<w:r>` block using the style of the first run.

You need to modify **only the write-back function**. The extraction logic stays the same.

---

### Step 2 — Build a new helper: `extractRunMap(paragraph)`

Add this function to `server/parsers/docx-structured.js`:

```javascript
/**
 * Given a parsed paragraph object (from fast-xml-parser), return a structured
 * array of runs. Each run has:
 *   - text: string (the original source text in that run)
 *   - rPr: object (the raw run properties XML node — bold, italic, underline, font etc.)
 *   - charStart: number (character offset where this run starts in the full paragraph text)
 *   - charEnd: number (character offset where this run ends)
 */
function extractRunMap(paragraph) {
  // paragraph["w:r"] may be a single object or an array — normalize to array
  const runs = Array.isArray(paragraph["w:r"])
    ? paragraph["w:r"]
    : paragraph["w:r"]
    ? [paragraph["w:r"]]
    : [];

  let cursor = 0;
  return runs.map((run) => {
    const text =
      run["w:t"]?.["#text"] ?? run["w:t"] ?? "";
    const rPr = run["w:rPr"] ?? null;
    const entry = {
      text: String(text),
      rPr,
      charStart: cursor,
      charEnd: cursor + String(text).length,
    };
    cursor += String(text).length;
    return entry;
  });
}
```

---

### Step 3 — Build the LLM alignment function: `alignTranslationToRuns()`

Create a new file: `server/parsers/run-aligner.js`

This file will use Gemini to map translated text back to source runs.

```javascript
// server/parsers/run-aligner.js
// Uses Gemini to align translated output back to source XML runs

import { translateText } from "../gemini.js"; // reuse existing Gemini client

/**
 * Given source runs and a fully translated string, ask Gemini to identify
 * which substring of the translation corresponds to each source run.
 *
 * @param {Array<{text: string, rPr: object}>} sourceRuns - extracted run map
 * @param {string} translatedText - the full translated paragraph string
 * @param {string} sourceLang - e.g. "en"
 * @param {string} targetLang - e.g. "hi"
 * @returns {Promise<Array<{translatedSegment: string, rPr: object}>>}
 */
export async function alignTranslationToRuns(sourceRuns, translatedText, sourceLang, targetLang) {
  // Filter out runs with no meaningful text (whitespace-only, empty)
  const meaningfulRuns = sourceRuns.filter(r => r.text.trim().length > 0);

  // If only 1 meaningful run OR all runs have same rPr (no mixed formatting),
  // skip LLM call — return translatedText as a single run with first rPr
  const hasVariedFormatting = meaningfulRuns.some(
    (r, i, arr) => i > 0 && JSON.stringify(r.rPr) !== JSON.stringify(arr[0].rPr)
  );
  if (!hasVariedFormatting || meaningfulRuns.length <= 1) {
    return [{ translatedSegment: translatedText, rPr: sourceRuns[0]?.rPr ?? null }];
  }

  // Build the alignment prompt
  const sourceRunsJson = JSON.stringify(
    meaningfulRuns.map((r, i) => ({ id: i, text: r.text }))
  );

  const prompt = `
You are a translation alignment assistant.

Source language: ${sourceLang}
Target language: ${targetLang}

The following source text was split into ${meaningfulRuns.length} runs (some may be bold, italic, etc.):
${sourceRunsJson}

The full translated output is:
"${translatedText}"

Your task: For each source run (by id), identify the EXACT substring in the translated output that corresponds to that run.

Rules:
1. The substrings must be contiguous and together form the full translated string with no gaps and no overlaps.
2. Preserve word boundaries — do not split words.
3. If a source run is punctuation or a single space, its translated counterpart is the nearest equivalent punctuation or space.
4. Return ONLY a JSON array. No explanation. No markdown. No code fences.

Output format:
[
  { "id": 0, "translatedSegment": "..." },
  { "id": 1, "translatedSegment": "..." },
  ...
]
`;

  try {
    // Use the Gemini client — we call it with a custom prompt (not a translation task)
    // Make a direct call to the Gemini generative model
    const { GoogleGenerativeAI } = await import("@google/generative-ai");
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const result = await model.generateContent(prompt);
    const raw = result.response.text().trim();

    // Strip any accidental markdown fences
    const cleaned = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);

    // Map aligned segments back to their rPr
    return parsed.map((item) => ({
      translatedSegment: item.translatedSegment,
      rPr: meaningfulRuns[item.id]?.rPr ?? null,
    }));
  } catch (err) {
    // Fallback: return entire translation as single run with first rPr
    console.warn("[run-aligner] Alignment failed, using fallback single-run:", err.message);
    return [{ translatedSegment: translatedText, rPr: sourceRuns[0]?.rPr ?? null }];
  }
}
```

---

### Step 4 — Modify the DOCX write-back function

In `server/parsers/docx-structured.js`, find the function that reconstructs the paragraph XML after translation (it likely loops over translated segments and calls something like `buildRunXml(text, rPr)`).

Replace the **single-run write-back** with this multi-run approach:

```javascript
import { alignTranslationToRuns } from "./run-aligner.js";

/**
 * Rebuilds a paragraph's XML <w:r> nodes using aligned run formatting.
 * 
 * @param {object} originalParagraph - raw paragraph XML node from fast-xml-parser
 * @param {string} translatedText - full translated string for this paragraph
 * @param {string} sourceLang
 * @param {string} targetLang
 * @returns {Promise<Array>} - array of <w:r> XML node objects ready for XMLBuilder
 */
async function buildAlignedRuns(originalParagraph, translatedText, sourceLang, targetLang) {
  const runMap = extractRunMap(originalParagraph);
  const alignedRuns = await alignTranslationToRuns(runMap, translatedText, sourceLang, targetLang);

  return alignedRuns
    .filter(r => r.translatedSegment && r.translatedSegment.length > 0)
    .map(({ translatedSegment, rPr }) => {
      const run = {
        "w:t": {
          "#text": translatedSegment,
          "@_xml:space": "preserve",
        },
      };
      if (rPr) {
        run["w:rPr"] = rPr;
      }
      return { "w:r": run };
    });
}
```

Then in the main export/build function where translated paragraphs are assembled, replace:

```javascript
// OLD (single run per paragraph):
const singleRun = buildSingleRun(translatedText, firstRunRPr);
paragraph["w:r"] = singleRun;
```

With:

```javascript
// NEW (aligned multi-run per paragraph):
const alignedRuns = await buildAlignedRuns(para, translatedText, sourceLang, targetLang);
paragraph["w:r"] = alignedRuns;
```

---

### Step 5 — Add a feature flag to skip alignment for performance

Not every export needs this (e.g., plain text exports don't care). Add an option:

```javascript
// In server/routes/export.js, add to the export request body options:
const useRunAlignment = req.body.preserveInlineFormatting ?? true;

// Pass it down to the DOCX builder:
await buildTranslatedDocx(segments, { useRunAlignment, sourceLang, targetLang });
```

In `docx-structured.js`, gate the alignment call:

```javascript
const runs = options.useRunAlignment
  ? await buildAlignedRuns(para, translatedText, sourceLang, targetLang)
  : [buildSingleRun(translatedText, firstRunRPr)];
```

---

### Acceptance Criteria for Improvement 1

- [ ] Upload a DOCX with at least one paragraph containing mixed bold + normal text (e.g., "Please sign the **contract** by Friday").
- [ ] Translate it to Hindi via the Translation Editor.
- [ ] Export as DOCX.
- [ ] Open the exported DOCX in Microsoft Word or LibreOffice.
- [ ] Confirm that the bold is applied only to the Hindi equivalent of "contract", not the entire sentence.
- [ ] Confirm that a paragraph with no mixed formatting exports without any LLM alignment call (check server logs).
- [ ] Confirm that if the alignment LLM call fails (e.g., rate limit), it gracefully falls back to a single-run export without crashing.

---

---

# IMPROVEMENT 2: Expand FLORES-200 Benchmarking to All 22 Indian Languages

## Problem Statement

The current `server/flores-eval.js` file only evaluates translation quality for the **English → Hindi** language pair. The platform claims to support all 22 scheduled Indian languages via Sarvam AI and Gemini, but there is no automated quality validation for Assamese, Bengali, Gujarati, Kannada, Malayalam, Marathi, Odia, Punjabi, Tamil, Telugu, Urdu, and others.

## Goal

Refactor `server/flores-eval.js` to support **dynamic, multi-language evaluation** across any language pair that ClearLingo supports. Add a new API endpoint that accepts a target language and returns a full benchmark report with BLEU scores, edit distance, and glossary compliance per language pair.

---

## Step-by-Step Implementation

### Step 1 — Understand the existing flores-eval.js structure

Open `server/flores-eval.js`. It currently:
1. Has a hardcoded set of EN→HI sentence pairs (likely ~50-100 pairs from the FLORES-200 devtest set).
2. Calls the translation pipeline for each pair.
3. Computes BLEU score and edit distance.
4. Returns a result object.

You need to make steps 1 and 3 dynamic.

---

### Step 2 — Create a FLORES seed data file for all Indian languages

Create: `data_seeds/flores_indian_languages.json`

This file should be structured as follows. Include at least **20 sentence pairs per language** from the FLORES-200 devtest dataset (sentences 1–20 of the devtest split are standard across all FLORES evaluations, so the source English sentences are the same for all languages — only the reference translations differ):

```json
{
  "hi": {
    "language_name": "Hindi",
    "sarvam_code": "hi-IN",
    "pairs": [
      {
        "source": "The cat sat on the mat.",
        "reference": "बिल्ली चटाई पर बैठी थी।"
      },
      {
        "source": "She opened the door and walked inside.",
        "reference": "उसने दरवाज़ा खोला और अंदर चली गई।"
      }
      // ... at least 20 pairs
    ]
  },
  "bn": {
    "language_name": "Bengali",
    "sarvam_code": "bn-IN",
    "pairs": [
      {
        "source": "The cat sat on the mat.",
        "reference": "বিড়ালটি মাদুরের উপর বসেছিল।"
      }
      // ... at least 20 pairs
    ]
  },
  "ta": {
    "language_name": "Tamil",
    "sarvam_code": "ta-IN",
    "pairs": []
  },
  "te": { "language_name": "Telugu", "sarvam_code": "te-IN", "pairs": [] },
  "mr": { "language_name": "Marathi", "sarvam_code": "mr-IN", "pairs": [] },
  "gu": { "language_name": "Gujarati", "sarvam_code": "gu-IN", "pairs": [] },
  "kn": { "language_name": "Kannada", "sarvam_code": "kn-IN", "pairs": [] },
  "ml": { "language_name": "Malayalam", "sarvam_code": "ml-IN", "pairs": [] },
  "pa": { "language_name": "Punjabi", "sarvam_code": "pa-IN", "pairs": [] },
  "or": { "language_name": "Odia", "sarvam_code": "or-IN", "pairs": [] },
  "as": { "language_name": "Assamese", "sarvam_code": "as-IN", "pairs": [] },
  "ur": { "language_name": "Urdu", "sarvam_code": "ur-IN", "pairs": [] }
}
```

**Important:** Use the AI4Bharat Samanantar dataset or the official FLORES-200 devtest set for reference translations. Do not fabricate reference translations — quality of BLEU evaluation depends entirely on the accuracy of the reference.

---

### Step 3 — Refactor flores-eval.js

Replace the hardcoded EN→HI evaluation with a dynamic function:

```javascript
// server/flores-eval.js (refactored)
import { readFileSync } from "fs";
import { translateWithOrchestrator } from "./llm-orchestrator.js";
import { editDistance } from "./gemini.js";

// Load the FLORES seed data
const FLORES_DATA = JSON.parse(
  readFileSync("data_seeds/flores_indian_languages.json", "utf-8")
);

/**
 * Compute BLEU-1 score (unigram precision) between hypothesis and reference.
 * This is a lightweight BLEU implementation — sufficient for relative comparison.
 * 
 * @param {string} hypothesis - model translation output
 * @param {string} reference - gold reference translation
 * @returns {number} BLEU-1 score between 0 and 1
 */
function computeBLEU1(hypothesis, reference) {
  const hypTokens = hypothesis.trim().split(/\s+/);
  const refTokens = new Set(reference.trim().split(/\s+/));
  const matches = hypTokens.filter(t => refTokens.has(t)).length;
  return hypTokens.length > 0 ? matches / hypTokens.length : 0;
}

/**
 * Run FLORES-200 evaluation for a specific language pair.
 * 
 * @param {string} targetLangCode - ISO code like "hi", "bn", "ta"
 * @param {object} options
 * @param {number} options.maxPairs - max pairs to evaluate (default: all)
 * @param {Function} options.onProgress - callback(current, total) for SSE streaming
 * @returns {Promise<EvalResult>}
 */
export async function runFloresEval(targetLangCode, options = {}) {
  const langData = FLORES_DATA[targetLangCode];
  if (!langData) {
    throw new Error(`No FLORES data available for language: ${targetLangCode}`);
  }

  const pairs = options.maxPairs
    ? langData.pairs.slice(0, options.maxPairs)
    : langData.pairs;

  if (pairs.length === 0) {
    return {
      language: targetLangCode,
      language_name: langData.language_name,
      status: "NO_DATA",
      message: "No reference pairs available for this language. Add pairs to data_seeds/flores_indian_languages.json.",
      bleu1: null,
      avgEditDistance: null,
      testedPairs: 0,
    };
  }

  const results = [];
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];
    if (options.onProgress) options.onProgress(i + 1, pairs.length);

    try {
      // Use the same orchestrator the app uses — this tests the real pipeline
      const translation = await translateWithOrchestrator({
        sourceText: pair.source,
        sourceLang: "en",
        targetLang: targetLangCode,
        context: "FLORES-200 benchmark evaluation",
        skipTMWrite: true,  // Don't pollute TM with benchmark data
      });

      const bleu = computeBLEU1(translation.translatedText, pair.reference);
      const editDist = editDistance(translation.translatedText, pair.reference);

      results.push({
        source: pair.source,
        reference: pair.reference,
        hypothesis: translation.translatedText,
        bleu1: bleu,
        editDistance: editDist,
        matchType: translation.matchType,
        model: translation.model,
      });
    } catch (err) {
      results.push({
        source: pair.source,
        error: err.message,
        bleu1: 0,
        editDistance: 999,
      });
    }
  }

  const avgBLEU = results.reduce((s, r) => s + r.bleu1, 0) / results.length;
  const avgEditDist = results.reduce((s, r) => s + r.editDistance, 0) / results.length;
  const exactHits = results.filter(r => r.matchType === "EXACT").length;
  const errorCount = results.filter(r => r.error).length;

  return {
    language: targetLangCode,
    language_name: langData.language_name,
    status: "COMPLETE",
    bleu1: parseFloat(avgBLEU.toFixed(4)),
    avgEditDistance: parseFloat(avgEditDist.toFixed(2)),
    exactHits,
    testedPairs: results.length,
    errorCount,
    perPairResults: results,
    evaluatedAt: new Date().toISOString(),
  };
}

/**
 * Run FLORES evaluation across ALL languages in the seed data.
 * Returns an array of EvalResult objects.
 * 
 * @param {object} options
 * @param {number} options.maxPairsPerLanguage - limit pairs per lang (default: 20)
 * @param {Function} options.onLanguageComplete - callback(langCode, result) 
 * @returns {Promise<Array<EvalResult>>}
 */
export async function runFullFloresEval(options = {}) {
  const languages = Object.keys(FLORES_DATA);
  const results = [];

  for (const langCode of languages) {
    const result = await runFloresEval(langCode, {
      maxPairs: options.maxPairsPerLanguage ?? 20,
    });
    results.push(result);
    if (options.onLanguageComplete) options.onLanguageComplete(langCode, result);
  }

  return results;
}
```

---

### Step 4 — Add the API endpoint in server/routes/training.js

In `server/routes/training.js`, add these two new endpoints:

```javascript
import { runFloresEval, runFullFloresEval } from "../flores-eval.js";

// Single language FLORES eval with SSE streaming progress
router.get("/flores-eval/:langCode", async (req, res) => {
  const { langCode } = req.params;
  const maxPairs = parseInt(req.query.maxPairs ?? "20");

  // Set up SSE headers for streaming progress
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    const result = await runFloresEval(langCode, {
      maxPairs,
      onProgress: (current, total) => {
        res.write(`data: ${JSON.stringify({ type: "progress", current, total })}\n\n`);
      },
    });
    res.write(`data: ${JSON.stringify({ type: "complete", result })}\n\n`);
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: "error", message: err.message })}\n\n`);
  } finally {
    res.end();
  }
});

// Full multi-language FLORES eval
router.post("/flores-eval/full", async (req, res) => {
  const maxPairsPerLanguage = req.body.maxPairsPerLanguage ?? 10;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    const allResults = await runFullFloresEval({
      maxPairsPerLanguage,
      onLanguageComplete: (langCode, result) => {
        res.write(`data: ${JSON.stringify({ type: "language_complete", langCode, result })}\n\n`);
      },
    });
    res.write(`data: ${JSON.stringify({ type: "all_complete", results: allResults })}\n\n`);
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: "error", message: err.message })}\n\n`);
  } finally {
    res.end();
  }
});
```

---

### Step 5 — Add FLORES results to the Training Pipeline UI

In `src/app/screens/TrainingPipeline.tsx`, find the existing FLORES evaluation section.

Add a new **"Multi-Language Benchmark"** panel that:
1. Shows a dropdown to select a specific language OR a "Run All Languages" button.
2. Displays a live progress bar per language as results stream in via SSE.
3. Renders a table with columns: Language | BLEU-1 | Avg Edit Distance | Pairs Tested | Status.
4. Color-codes rows: green for BLEU > 0.5, yellow for 0.3–0.5, red for < 0.3, gray for NO_DATA.

The SSE consumption pattern:

```typescript
const eventSource = new EventSource(`/api/training/flores-eval/${selectedLang}?maxPairs=20`);
eventSource.onmessage = (e) => {
  const data = JSON.parse(e.data);
  if (data.type === "progress") setProgress({ current: data.current, total: data.total });
  if (data.type === "complete") { setResult(data.result); eventSource.close(); }
  if (data.type === "error") { setError(data.message); eventSource.close(); }
};
```

---

### Acceptance Criteria for Improvement 2

- [ ] `GET /api/training/flores-eval/hi` returns a valid SSE stream with BLEU-1 and edit distance for Hindi.
- [ ] `GET /api/training/flores-eval/bn` returns `status: "NO_DATA"` with a helpful message until Bengali pairs are added.
- [ ] `POST /api/training/flores-eval/full` streams per-language results and finishes with all results.
- [ ] Training Pipeline UI shows the multi-language benchmark panel.
- [ ] BLEU scores for EN→HI are equal to or better than the previous hardcoded implementation.
- [ ] Benchmark data does NOT write to the `tm_records` or `translation_log` tables (`skipTMWrite: true`).

---

---

# IMPROVEMENT 3: Database Migration — Redis + pgvector

## Problem Statement

ClearLingo currently uses `better-sqlite3` for all storage: translation cache, 768-dim vector embeddings, and all transactional data. This works for a single-user hackathon demo but has three critical limitations for enterprise use:

1. **SQLite is single-writer** — concurrent translation jobs cause `SQLITE_BUSY` errors.
2. **768-dim vectors stored as JSON text** — vector search requires loading ALL embeddings into memory and computing cosine similarity in JavaScript. This does not scale beyond ~5000 TM records.
3. **No TTL / cache eviction** — the `translation_cache` table grows unbounded.

## Goal

Migrate two specific storage concerns to dedicated systems:
- **`translation_cache` table** → **Redis** (with TTL-based eviction, O(1) lookup by cache key)
- **`tm_records` vector embeddings** → **pgvector** (PostgreSQL + pgvector extension for native ANN search)

All other tables stay in SQLite. This is a **hybrid storage architecture**, not a full migration.

---

## Step-by-Step Implementation

### Step 1 — Install new dependencies

```bash
npm install ioredis pg pgvector
```

- `ioredis` — Redis client (better async support than `redis` package)
- `pg` — PostgreSQL client
- `pgvector` — pgvector helper for Node.js

---

### Step 2 — Add environment variables

In `.env`, add:

```env
# Redis
REDIS_URL=redis://localhost:6379
REDIS_CACHE_TTL_SECONDS=604800   # 7 days

# PostgreSQL + pgvector
POSTGRES_URL=postgresql://clearlingo:password@localhost:5432/clearlingo
POSTGRES_VECTOR_TABLE=tm_vectors

# Feature flags (set to false to stay on SQLite during transition)
USE_REDIS_CACHE=false
USE_PGVECTOR=false
```

Add these to `.env.example` as well with placeholder values.

---

### Step 3 — Create `server/cache-redis.js`

This module wraps Redis and provides the same interface as the SQLite cache:

```javascript
// server/cache-redis.js
import Redis from "ioredis";

let redisClient = null;

function getRedis() {
  if (!redisClient) {
    redisClient = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      connectTimeout: 3000,
    });
    redisClient.on("error", (err) => {
      console.warn("[Redis] Connection error:", err.message);
    });
  }
  return redisClient;
}

/**
 * Build the cache key used in Redis (same format as SQLite cache key).
 * Key format: "tc:{sourceHash}:{sourceLang}:{targetLang}:{modelId}"
 */
export function buildCacheKey(sourceText, sourceLang, targetLang, modelId = "default") {
  // Use a simple hash of the source text
  const hash = Buffer.from(sourceText).toString("base64").slice(0, 32);
  return `tc:${hash}:${sourceLang}:${targetLang}:${modelId}`;
}

/**
 * Get a cached translation from Redis.
 * @returns {Promise<string|null>} translated text or null on miss/error
 */
export async function getCachedTranslation(sourceText, sourceLang, targetLang, modelId) {
  if (process.env.USE_REDIS_CACHE !== "true") return null;
  try {
    const redis = getRedis();
    const key = buildCacheKey(sourceText, sourceLang, targetLang, modelId);
    const cached = await redis.get(key);
    return cached ? JSON.parse(cached) : null;
  } catch (err) {
    console.warn("[Redis] Cache get failed:", err.message);
    return null; // Graceful degradation — fall through to LLM
  }
}

/**
 * Store a translation in Redis with TTL.
 */
export async function setCachedTranslation(sourceText, sourceLang, targetLang, modelId, translatedText) {
  if (process.env.USE_REDIS_CACHE !== "true") return;
  try {
    const redis = getRedis();
    const key = buildCacheKey(sourceText, sourceLang, targetLang, modelId);
    const ttl = parseInt(process.env.REDIS_CACHE_TTL_SECONDS ?? "604800");
    await redis.set(key, JSON.stringify(translatedText), "EX", ttl);
  } catch (err) {
    console.warn("[Redis] Cache set failed:", err.message);
    // Non-fatal — translation already happened, just not cached
  }
}

/**
 * Delete all cache keys (for testing/reset).
 */
export async function flushTranslationCache() {
  if (process.env.USE_REDIS_CACHE !== "true") return 0;
  try {
    const redis = getRedis();
    const keys = await redis.keys("tc:*");
    if (keys.length > 0) await redis.del(...keys);
    return keys.length;
  } catch (err) {
    console.warn("[Redis] Cache flush failed:", err.message);
    return 0;
  }
}

export async function closeRedis() {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}
```

---

### Step 4 — Create `server/vector-pg.js`

This module handles pgvector operations:

```javascript
// server/vector-pg.js
import pg from "pg";
import pgvector from "pgvector/pg";

const { Pool } = pg;
let pool = null;

function getPool() {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.POSTGRES_URL });
    pool.on("error", (err) => console.warn("[pgvector] Pool error:", err.message));
  }
  return pool;
}

/**
 * Initialize the pgvector extension and create the tm_vectors table.
 * Call this once at server startup.
 */
export async function initPgVector() {
  if (process.env.USE_PGVECTOR !== "true") return;
  const client = await getPool().connect();
  try {
    await client.query("CREATE EXTENSION IF NOT EXISTS vector");
    await client.query(`
      CREATE TABLE IF NOT EXISTS tm_vectors (
        id          TEXT PRIMARY KEY,          -- matches tm_records.id in SQLite
        source_lang TEXT NOT NULL,
        target_lang TEXT NOT NULL,
        source_text TEXT NOT NULL,
        target_text TEXT NOT NULL,
        context     TEXT,
        embedding   vector(768),               -- 768-dim Gemini embedding
        approved_at TEXT,
        created_at  TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS tm_vectors_embedding_idx
      ON tm_vectors USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 100)
    `);
    console.log("[pgvector] Table and index initialized.");
  } finally {
    client.release();
  }
}

/**
 * Insert or update a TM record with its embedding.
 * Called when a segment is approved (same trigger as SQLite tm_records insert).
 */
export async function upsertTMVector(record) {
  if (process.env.USE_PGVECTOR !== "true") return;
  const client = await getPool().connect();
  try {
    await pgvector.registerType(client);
    await client.query(`
      INSERT INTO tm_vectors (id, source_lang, target_lang, source_text, target_text, context, embedding, approved_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (id) DO UPDATE SET
        target_text = EXCLUDED.target_text,
        embedding = EXCLUDED.embedding,
        approved_at = EXCLUDED.approved_at
    `, [
      record.id,
      record.source_lang,
      record.target_lang,
      record.source_text,
      record.target_text,
      record.context ?? "",
      pgvector.toSql(record.embedding),  // float[] → pgvector format
      record.approved_at ?? new Date().toISOString(),
    ]);
  } finally {
    client.release();
  }
}

/**
 * Find the top-K most similar TM records for a query embedding.
 * Uses pgvector ANN search — much faster than JS cosine similarity loop.
 * 
 * @param {number[]} queryEmbedding - 768-dim float array
 * @param {string} sourceLang
 * @param {string} targetLang
 * @param {number} topK - number of results to return (default: 5)
 * @param {number} threshold - minimum cosine similarity (default: 0.75)
 * @returns {Promise<Array<{id, source_text, target_text, similarity}>>}
 */
export async function searchTMVectors(queryEmbedding, sourceLang, targetLang, topK = 5, threshold = 0.75) {
  if (process.env.USE_PGVECTOR !== "true") return [];
  const client = await getPool().connect();
  try {
    await pgvector.registerType(client);
    const result = await client.query(`
      SELECT
        id,
        source_text,
        target_text,
        context,
        1 - (embedding <=> $1::vector) AS similarity
      FROM tm_vectors
      WHERE source_lang = $2
        AND target_lang = $3
        AND 1 - (embedding <=> $1::vector) >= $4
      ORDER BY embedding <=> $1::vector
      LIMIT $5
    `, [
      pgvector.toSql(queryEmbedding),
      sourceLang,
      targetLang,
      threshold,
      topK,
    ]);
    return result.rows;
  } finally {
    client.release();
  }
}
```

---

### Step 5 — Wire into existing modules with feature flags

In `server/rag-engine.js`, find the **Tier 2 semantic search** (the cosine similarity loop over SQLite embeddings). Add a pgvector fast-path before the existing slow path:

```javascript
import { searchTMVectors } from "./vector-pg.js";

// In the findSemanticMatch() function, BEFORE the existing SQLite loop:
if (process.env.USE_PGVECTOR === "true") {
  const pgResults = await searchTMVectors(queryEmbedding, sourceLang, targetLang, 5, threshold);
  if (pgResults.length > 0) {
    return {
      ...pgResults[0],
      similarity: pgResults[0].similarity,
      tier: "SEMANTIC_PGVECTOR",
    };
  }
  // If pgvector returns nothing, fall through to SQLite path as safety net
}
// ... existing SQLite cosine similarity code continues here
```

In `server/llm-orchestrator.js`, find the `translation_cache` lookup. Add Redis fast-path:

```javascript
import { getCachedTranslation, setCachedTranslation } from "./cache-redis.js";

// At the start of translateSegment():
const redisCached = await getCachedTranslation(sourceText, sourceLang, targetLang, modelId);
if (redisCached) {
  return { translatedText: redisCached, matchType: "CACHE_REDIS", cost: 0 };
}

// ... existing SQLite cache lookup ...
// ... LLM call ...

// After successful LLM translation, write to Redis:
await setCachedTranslation(sourceText, sourceLang, targetLang, modelId, translatedText);
```

---

### Step 6 — Add migration script: `server/scripts/migrate-to-pgvector.js`

```javascript
// server/scripts/migrate-to-pgvector.js
// One-time migration: reads all tm_records from SQLite and writes to pgvector

import { getDb } from "../db.js";
import { upsertTMVector, initPgVector } from "../vector-pg.js";

async function migrate() {
  await initPgVector();
  const db = getDb();
  const records = db.prepare("SELECT * FROM tm_records WHERE embedding IS NOT NULL").all();
  
  console.log(`Migrating ${records.length} TM records to pgvector...`);
  let success = 0, failed = 0;

  for (const record of records) {
    try {
      const embedding = JSON.parse(record.embedding);
      await upsertTMVector({ ...record, embedding });
      success++;
      if (success % 100 === 0) console.log(`  Progress: ${success}/${records.length}`);
    } catch (err) {
      console.error(`  Failed record ${record.id}:`, err.message);
      failed++;
    }
  }

  console.log(`Migration complete. Success: ${success}, Failed: ${failed}`);
}

migrate().catch(console.error);
```

Add to `package.json` scripts:

```json
"migrate:pgvector": "node server/scripts/migrate-to-pgvector.js"
```

---

### Step 7 — Add health check for Redis + pgvector

In `server/index.js`, in the `GET /api/health` endpoint, add:

```javascript
// Redis health
let redisStatus = "DISABLED";
if (process.env.USE_REDIS_CACHE === "true") {
  try {
    const redis = getRedis();
    await redis.ping();
    redisStatus = "CONNECTED";
  } catch {
    redisStatus = "ERROR";
  }
}

// pgvector health
let pgvectorStatus = "DISABLED";
if (process.env.USE_PGVECTOR === "true") {
  try {
    const pool = getPool();
    await pool.query("SELECT 1");
    pgvectorStatus = "CONNECTED";
  } catch {
    pgvectorStatus = "ERROR";
  }
}

// Add to health response:
res.json({
  ...existingHealthData,
  storage: {
    sqlite: "ACTIVE",
    redis: redisStatus,
    pgvector: pgvectorStatus,
  }
});
```

---

### Acceptance Criteria for Improvement 3

- [ ] With `USE_REDIS_CACHE=false` and `USE_PGVECTOR=false`, the app behaves IDENTICALLY to before (all SQLite paths).
- [ ] With `USE_REDIS_CACHE=true`, the second translation of an identical segment returns from Redis (check via `/api/health` or server logs).
- [ ] With `USE_PGVECTOR=true`, semantic TM search uses the pgvector ANN index instead of JS cosine loop (verify via `tier: "SEMANTIC_PGVECTOR"` in logs).
- [ ] `npm run migrate:pgvector` successfully copies all SQLite TM embeddings to pgvector.
- [ ] `/api/health` shows `storage.redis` and `storage.pgvector` status.
- [ ] No breaking changes to any existing API endpoints.
- [ ] Errors in Redis/pgvector gracefully fall back to SQLite — never crash the server.

---

---

# IMPROVEMENT 4: Real-Time Collaborative Editing with Socket.io

## Problem Statement

The current `TranslationEditor.tsx` is single-user. When two linguists open the same project simultaneously, they each see stale data and their approvals/rejections can overwrite each other. SQLite also throws `SQLITE_BUSY` errors under concurrent writes.

## Goal

Add **Google Docs-style real-time collaboration** to the Translation Editor:
- Presence indicators showing which user is editing which segment.
- Live segment status updates pushed to all connected clients.
- Segment locking: a segment being edited by User A shows as "locked" to User B (read-only with lock indicator).
- Optimistic UI updates with server reconciliation.

---

## Step-by-Step Implementation

### Step 1 — Install Socket.io

```bash
npm install socket.io socket.io-client
```

---

### Step 2 — Integrate Socket.io into the Express server

In `server/index.js`, upgrade the Express HTTP server to a Socket.io server:

```javascript
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";

// Replace: const app = express();  →  Keep app, but also create httpServer:
const app = express();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: ["http://localhost:5173", "http://localhost:3000"],
    methods: ["GET", "POST"],
  },
  transports: ["websocket", "polling"],
});

// IMPORTANT: Replace app.listen() with httpServer.listen():
// OLD: app.listen(PORT, ...)
// NEW:
httpServer.listen(PORT, () => {
  console.log(`ClearLingo server running on port ${PORT}`);
});

// Export io so routes can emit events:
export { io };
```

---

### Step 3 — Design the real-time event protocol

Define these Socket.io events (document them clearly):

```
CLIENT → SERVER:
  join_project        { projectId, userId, userName }    — join a project room
  leave_project       { projectId, userId }              — leave a project room
  segment_focus       { projectId, segmentId, userId }   — user starts editing a segment
  segment_blur        { projectId, segmentId, userId }   — user stops editing
  segment_updated     { projectId, segmentId, newTarget, userId } — user typed new translation
  segment_approved    { projectId, segmentId, userId }   — user approved a segment
  segment_rejected    { projectId, segmentId, userId }   — user rejected a segment

SERVER → CLIENT (broadcast to project room):
  user_joined         { userId, userName, activeSegment }
  user_left           { userId }
  presence_update     { users: [{userId, userName, activeSegmentId}] }
  segment_locked      { segmentId, lockedBy: {userId, userName} }
  segment_unlocked    { segmentId }
  segment_status_changed  { segmentId, status, updatedBy }
  segment_text_changed    { segmentId, newTarget, updatedBy }
```

---

### Step 4 — Create `server/collab-manager.js`

This module manages in-memory collaboration state (which user has which segment locked):

```javascript
// server/collab-manager.js
// In-memory collaboration state manager
// Note: For multi-server deployments, this should move to Redis pub/sub.

const projectRooms = new Map(); 
// Map<projectId, {
//   users: Map<userId, {userName, socketId, activeSegmentId}>,
//   locks: Map<segmentId, userId>
// }>

export function getOrCreateRoom(projectId) {
  if (!projectRooms.has(projectId)) {
    projectRooms.set(projectId, {
      users: new Map(),
      locks: new Map(),
    });
  }
  return projectRooms.get(projectId);
}

export function joinRoom(projectId, userId, userName, socketId) {
  const room = getOrCreateRoom(projectId);
  room.users.set(userId, { userName, socketId, activeSegmentId: null });
  return getPresenceSnapshot(projectId);
}

export function leaveRoom(projectId, userId) {
  const room = projectRooms.get(projectId);
  if (!room) return { releasedSegments: [] };

  // Release all segment locks held by this user
  const releasedSegments = [];
  for (const [segmentId, lockHolder] of room.locks.entries()) {
    if (lockHolder === userId) {
      room.locks.delete(segmentId);
      releasedSegments.push(segmentId);
    }
  }

  room.users.delete(userId);
  if (room.users.size === 0) projectRooms.delete(projectId);

  return { releasedSegments };
}

export function lockSegment(projectId, segmentId, userId) {
  const room = getOrCreateRoom(projectId);
  const existingLock = room.locks.get(segmentId);
  if (existingLock && existingLock !== userId) {
    return { success: false, lockedBy: existingLock };
  }
  room.locks.set(segmentId, userId);
  const user = room.users.get(userId);
  if (user) user.activeSegmentId = segmentId;
  return { success: true };
}

export function unlockSegment(projectId, segmentId, userId) {
  const room = getOrCreateRoom(projectId);
  const existingLock = room.locks.get(segmentId);
  if (existingLock === userId) {
    room.locks.delete(segmentId);
    const user = room.users.get(userId);
    if (user) user.activeSegmentId = null;
  }
}

export function getPresenceSnapshot(projectId) {
  const room = projectRooms.get(projectId);
  if (!room) return [];
  return Array.from(room.users.entries()).map(([userId, data]) => ({
    userId,
    userName: data.userName,
    activeSegmentId: data.activeSegmentId,
  }));
}

export function isSegmentLocked(projectId, segmentId, requestingUserId) {
  const room = projectRooms.get(projectId);
  if (!room) return false;
  const lockHolder = room.locks.get(segmentId);
  return lockHolder && lockHolder !== requestingUserId;
}
```

---

### Step 5 — Register Socket.io event handlers in server/index.js

```javascript
import {
  joinRoom, leaveRoom, lockSegment, unlockSegment,
  getPresenceSnapshot, isSegmentLocked
} from "./collab-manager.js";

io.on("connection", (socket) => {
  console.log(`[WS] Client connected: ${socket.id}`);
  let currentProjectId = null;
  let currentUserId = null;

  socket.on("join_project", ({ projectId, userId, userName }) => {
    currentProjectId = projectId;
    currentUserId = userId;
    socket.join(`project:${projectId}`);

    const presence = joinRoom(projectId, userId, userName, socket.id);

    // Tell the joining user about current presence
    socket.emit("presence_update", { users: presence });
    // Tell everyone else this user joined
    socket.to(`project:${projectId}`).emit("user_joined", { userId, userName, activeSegmentId: null });
  });

  socket.on("leave_project", ({ projectId, userId }) => {
    const { releasedSegments } = leaveRoom(projectId, userId);
    socket.leave(`project:${projectId}`);
    releasedSegments.forEach(segId => {
      io.to(`project:${projectId}`).emit("segment_unlocked", { segmentId: segId });
    });
    io.to(`project:${projectId}`).emit("user_left", { userId });
  });

  socket.on("segment_focus", ({ projectId, segmentId, userId, userName }) => {
    const result = lockSegment(projectId, segmentId, userId);
    if (result.success) {
      io.to(`project:${projectId}`).emit("segment_locked", {
        segmentId,
        lockedBy: { userId, userName },
      });
    } else {
      socket.emit("segment_lock_denied", {
        segmentId,
        lockedBy: result.lockedBy,
      });
    }
  });

  socket.on("segment_blur", ({ projectId, segmentId, userId }) => {
    unlockSegment(projectId, segmentId, userId);
    io.to(`project:${projectId}`).emit("segment_unlocked", { segmentId });
  });

  socket.on("segment_updated", ({ projectId, segmentId, newTarget, userId }) => {
    // Broadcast text change to other users in real-time (not saved yet)
    socket.to(`project:${projectId}`).emit("segment_text_changed", {
      segmentId, newTarget, updatedBy: userId,
    });
  });

  socket.on("segment_approved", ({ projectId, segmentId, userId }) => {
    unlockSegment(projectId, segmentId, userId);
    io.to(`project:${projectId}`).emit("segment_status_changed", {
      segmentId, status: "APPROVED", updatedBy: userId,
    });
  });

  socket.on("segment_rejected", ({ projectId, segmentId, userId }) => {
    unlockSegment(projectId, segmentId, userId);
    io.to(`project:${projectId}`).emit("segment_status_changed", {
      segmentId, status: "REJECTED", updatedBy: userId,
    });
  });

  socket.on("disconnect", () => {
    if (currentProjectId && currentUserId) {
      const { releasedSegments } = leaveRoom(currentProjectId, currentUserId);
      releasedSegments.forEach(segId => {
        io.to(`project:${currentProjectId}`).emit("segment_unlocked", { segmentId: segId });
      });
      io.to(`project:${currentProjectId}`).emit("user_left", { userId: currentUserId });
    }
  });
});
```

---

### Step 6 — Also emit events from HTTP approval route

In `server/routes/approve.js`, after a successful DB write, broadcast the change:

```javascript
import { io } from "../index.js";

// After db.prepare("UPDATE segments...").run(...):
io.to(`project:${projectId}`).emit("segment_status_changed", {
  segmentId,
  status: newStatus,
  updatedBy: req.body.userId ?? "unknown",
});
```

---

### Step 7 — Create `src/app/hooks/useCollaboration.ts`

```typescript
// src/app/hooks/useCollaboration.ts
import { useEffect, useRef, useState, useCallback } from "react";
import { io as socketIO, Socket } from "socket.io-client";

interface CollabUser {
  userId: string;
  userName: string;
  activeSegmentId: string | null;
}

interface SegmentLock {
  segmentId: string;
  lockedBy: { userId: string; userName: string };
}

interface UseCollaborationOptions {
  projectId: string;
  userId: string;
  userName: string;
  onSegmentStatusChange: (segmentId: string, status: string) => void;
  onSegmentTextChange: (segmentId: string, newTarget: string) => void;
}

export function useCollaboration({
  projectId,
  userId,
  userName,
  onSegmentStatusChange,
  onSegmentTextChange,
}: UseCollaborationOptions) {
  const socketRef = useRef<Socket | null>(null);
  const [connectedUsers, setConnectedUsers] = useState<CollabUser[]>([]);
  const [segmentLocks, setSegmentLocks] = useState<Map<string, SegmentLock>>(new Map());
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const socket = socketIO("http://localhost:3001", {
      transports: ["websocket"],
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setIsConnected(true);
      socket.emit("join_project", { projectId, userId, userName });
    });

    socket.on("disconnect", () => setIsConnected(false));

    socket.on("presence_update", ({ users }: { users: CollabUser[] }) => {
      setConnectedUsers(users.filter(u => u.userId !== userId));
    });

    socket.on("user_joined", (user: CollabUser) => {
      setConnectedUsers(prev => [...prev.filter(u => u.userId !== user.userId), user]);
    });

    socket.on("user_left", ({ userId: leftId }: { userId: string }) => {
      setConnectedUsers(prev => prev.filter(u => u.userId !== leftId));
    });

    socket.on("segment_locked", (lock: SegmentLock) => {
      if (lock.lockedBy.userId !== userId) {
        setSegmentLocks(prev => new Map(prev).set(lock.segmentId, lock));
      }
    });

    socket.on("segment_unlocked", ({ segmentId }: { segmentId: string }) => {
      setSegmentLocks(prev => {
        const next = new Map(prev);
        next.delete(segmentId);
        return next;
      });
    });

    socket.on("segment_status_changed", ({ segmentId, status }: { segmentId: string; status: string }) => {
      onSegmentStatusChange(segmentId, status);
    });

    socket.on("segment_text_changed", ({ segmentId, newTarget }: { segmentId: string; newTarget: string }) => {
      onSegmentTextChange(segmentId, newTarget);
    });

    return () => {
      socket.emit("leave_project", { projectId, userId });
      socket.disconnect();
    };
  }, [projectId, userId]);

  const focusSegment = useCallback((segmentId: string) => {
    socketRef.current?.emit("segment_focus", { projectId, segmentId, userId, userName });
  }, [projectId, userId, userName]);

  const blurSegment = useCallback((segmentId: string) => {
    socketRef.current?.emit("segment_blur", { projectId, segmentId, userId });
  }, [projectId, userId]);

  const broadcastTextChange = useCallback((segmentId: string, newTarget: string) => {
    socketRef.current?.emit("segment_updated", { projectId, segmentId, newTarget, userId });
  }, [projectId, userId]);

  const broadcastApproval = useCallback((segmentId: string) => {
    socketRef.current?.emit("segment_approved", { projectId, segmentId, userId });
  }, [projectId, userId]);

  const broadcastRejection = useCallback((segmentId: string) => {
    socketRef.current?.emit("segment_rejected", { projectId, segmentId, userId });
  }, [projectId, userId]);

  const isLockedByOther = useCallback((segmentId: string) => {
    const lock = segmentLocks.get(segmentId);
    return lock ? { locked: true, lockedBy: lock.lockedBy } : { locked: false };
  }, [segmentLocks]);

  return {
    isConnected,
    connectedUsers,
    focusSegment,
    blurSegment,
    broadcastTextChange,
    broadcastApproval,
    broadcastRejection,
    isLockedByOther,
  };
}
```

---

### Step 8 — Integrate into TranslationEditor.tsx

In `src/app/screens/TranslationEditor.tsx`:

1. **Add a temporary userId** for this session (until auth is added):

```typescript
const sessionUserId = useMemo(() => `user_${Math.random().toString(36).slice(2, 8)}`, []);
const sessionUserName = "Linguist"; // Can be a prompt or localStorage value
```

2. **Initialize the collaboration hook:**

```typescript
const {
  isConnected,
  connectedUsers,
  focusSegment,
  blurSegment,
  broadcastTextChange,
  broadcastApproval,
  broadcastRejection,
  isLockedByOther,
} = useCollaboration({
  projectId: currentProject?.id ?? "",
  userId: sessionUserId,
  userName: sessionUserName,
  onSegmentStatusChange: (segId, status) => {
    // Update the segment in local state/store
    updateSegmentStatus(segId, status); // implement this in store.ts
  },
  onSegmentTextChange: (segId, newTarget) => {
    updateSegmentTarget(segId, newTarget); // implement this in store.ts
  },
});
```

3. **In each SegmentRow**, wire up focus/blur/lock:

```typescript
// When the textarea for a segment is focused:
onFocus={() => focusSegment(segment.id)}
// When blurred:
onBlur={() => blurSegment(segment.id)}
// When text changes:
onChange={(e) => {
  updateLocalTarget(segment.id, e.target.value);
  broadcastTextChange(segment.id, e.target.value);
}}

// Lock indicator:
const lockStatus = isLockedByOther(segment.id);
if (lockStatus.locked) {
  // Show: <Badge>🔒 Editing: {lockStatus.lockedBy.userName}</Badge>
  // Disable the textarea: disabled={true}
}
```

4. **Add a Presence Bar** at the top of the editor:

```tsx
{/* Presence indicator — show connected collaborators */}
{isConnected && connectedUsers.length > 0 && (
  <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 border-b border-blue-100 text-sm text-blue-700">
    <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
    <span>{connectedUsers.length} collaborator{connectedUsers.length > 1 ? "s" : ""} online:</span>
    {connectedUsers.map(u => (
      <span key={u.userId} className="font-medium">
        {u.userName}
        {u.activeSegmentId && <span className="text-blue-400 font-normal"> (editing)</span>}
      </span>
    ))}
  </div>
)}
```

---

### Step 9 — Add updateSegmentStatus and updateSegmentTarget to store.ts

In `src/app/store.ts`, in `useAppStore`, add:

```typescript
updateSegmentStatus: (segmentId: string, status: string) =>
  set((state) => ({
    segments: state.segments.map((s) =>
      s.id === segmentId ? { ...s, status } : s
    ),
  })),

updateSegmentTarget: (segmentId: string, target: string) =>
  set((state) => ({
    segments: state.segments.map((s) =>
      s.id === segmentId ? { ...s, target_text: target } : s
    ),
  })),
```

---

### Acceptance Criteria for Improvement 4

- [ ] Open the Translation Editor in two separate browser windows for the same project.
- [ ] Presence bar appears in both windows showing the other user.
- [ ] Click into a segment textarea in Window A — Window B shows that segment as locked with a 🔒 indicator and the textarea is disabled.
- [ ] Click away in Window A — Window B immediately shows the segment as unlocked.
- [ ] Approve a segment in Window A — Window B's segment row instantly shows APPROVED status without a page refresh.
- [ ] Close Window A — Window B removes it from the presence bar within 5 seconds.
- [ ] With only one user (no other window open), the editor behaves exactly as before (no UI changes, no extra indicators).
- [ ] Server console shows `[WS] Client connected:` and `[WS] Client disconnected:` for each window.

---

---

# GENERAL IMPLEMENTATION GUIDELINES

## Order of Implementation

Implement in this order to minimize risk:

1. **Improvement 2 (FLORES)** — Pure backend, no breaking changes, no new dependencies already installed.
2. **Improvement 1 (Run Alignment)** — Backend only, additive to existing DOCX parser, feature-flagged.
3. **Improvement 4 (WebSockets)** — Full-stack, moderate complexity, well-isolated via the hook.
4. **Improvement 3 (Redis/pgvector)** — Infrastructure change, last because it requires external services.

## Do Not Break

- The existing `better-sqlite3` WAL mode setup in `server/db.js` — do not modify the schema migration logic.
- The existing 14-table schema — only add new tables/columns, never remove or rename.
- The existing `useAppStore` and `useDashboardStore` Zustand stores — add actions, never remove.
- The existing API contracts for `/api/translate`, `/api/parse`, `/api/approve`, `/api/export` — all must continue to work unchanged.
- The `MOCK_MODE=true` offline demo mode — all new features must either work in mock mode or gracefully no-op.

## Error Handling Standard

All new async operations must follow this pattern:

```javascript
try {
  // new operation
} catch (err) {
  console.warn(`[ModuleName] Operation failed (non-fatal): ${err.message}`);
  // Fall back to existing behavior
  // Never let a new improvement crash the existing translation pipeline
}
```

## Testing Each Improvement

After implementing each improvement, run:

```bash
npm run server   # Verify server starts without errors
npm run dev      # Verify frontend builds without TypeScript errors
```

Then manually test the acceptance criteria listed under each improvement.

---

*Generated for ClearLingo v0.0.1 | Team SourceShipIt/WordX*
*Implementation target: Post-hackathon production hardening*
