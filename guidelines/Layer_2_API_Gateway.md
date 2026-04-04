# Layer 2: API Gateway
## Next.js API Routes

---

## Overview

Layer 2 is the **API routing layer** of ClearLingo. It is implemented as **Next.js 14 API Routes** (server-side route handlers inside the App Router). This layer acts as the middleware between the Web UI (Layer 1) and the Core RAG Engine (Layer 3), LLM Orchestration (Layer 4), and the SQL Database. Every user action in the frontend translates into an API call handled by this layer.

All routes are TypeScript API Route handlers living under the `/app/api/` directory.

---

## API Endpoints (Left to Right from Architecture Diagram)

### 2.1 `POST /api/parse` — Document Parsing & Smart Segmentation

**Purpose:** Receives the uploaded file, parses it, and returns a structured array of translatable segments with formatting information preserved.

**Detailed Steps:**

1. **Receive the file** via `multipart/form-data` from the frontend Document Upload component.
2. **Detect file type** from the extension (`.docx` or `.pdf`).
3. **Parse the document:**
   - For `.docx` files → use **mammoth.js** to convert to HTML, then extract text by paragraph tags (`<p>`, `<li>`, `<h1>`–`<h6>`).
   - For `.pdf` files → use **pdf-parse** to extract raw text blocks.
4. **Smart Segmentation:**
   - Split the extracted text by paragraph boundaries (newlines, HTML block elements).
   - Apply a **regex abbreviation boundary detector** that avoids splitting on abbreviations like "Dr.", "U.S.", "Inc.", "e.g.":
     ```typescript
     // Example regex: split on period + space + uppercase letter, but not abbreviations
     const sentenceBoundary = /(?<!\b(?:Dr|Mr|Mrs|Ms|Inc|Ltd|e\.g|i\.e|U\.S))\.\s+(?=[A-Z])/g;
     ```
   - Each resulting segment is assigned a unique UUID, an index for ordering, and metadata about its original position/formatting in the document.
5. **Preserve formatting metadata:**
   - Track which segments were headings, bullet points, numbered lists, or plain paragraphs.
   - Store this mapping so the Export endpoint (Step 8) can reconstruct the document structure.
6. **Return the response:**
   ```json
   {
     "projectId": "uuid-v4",
     "segments": [
       { "id": "seg-001", "index": 0, "sourceText": "Terms and Conditions Apply.", "formatType": "heading" },
       { "id": "seg-002", "index": 1, "sourceText": "All users must verify their account details.", "formatType": "paragraph" }
     ],
     "totalSegments": 15,
     "documentName": "report_2024.docx"
   }
   ```

---

### 2.2 `POST /api/validate` — Source Quality Validation (5 Checks)

**Purpose:** Takes the parsed segments and runs 5 quality checks on the source content *before* any translation happens. This prevents errors from multiplying across 22 target languages.

**Detailed Steps:**

1. **Receive the segment array** from the frontend in JSON body.
2. **Concatenate all segment texts** into a single batch payload.
3. **Send to Gemini 1.5 Flash (Layer 4)** with two structured prompts:
   - **Prompt 1:** "Identify 5 core terminology inconsistencies in this extracted text. Return them as structured JSON `{ issue, correction }`."
   - **Prompt 2:** "Identify any grammatical English errors or mixed date formats."
4. **Run the 5 checks** (combining LLM output with deterministic rules):

   | # | Check | Method | Example Issue |
   |---|---|---|---|
   | 1 | **Spell Check** | LLM batch analysis | "recieve" → "receive" |
   | 2 | **Terminology Consistency** | LLM + string comparison | "ecommerce" vs "e-commerce" in different segments |
   | 3 | **Date/Number Normalization** | Regex + LLM | "03/18/2026" vs "18-03-2026" mixed formats |
   | 4 | **Punctuation Styles** | Regex rules | Missing period at end of sentence |
   | 5 | **Segment Length Flags** | Programmatic check | Segments with >200 chars or <3 chars flagged |

5. **Compute a Quality Score** (0–100) based on the number and severity of issues found.
6. **Apply AI Batch Fix** if requested — the endpoint can auto-correct issues by sending corrections back to the source segments.
7. **Return the response:**
   ```json
   {
     "qualityScore": 87,
     "issues": [
       {
         "checkType": "terminology",
         "segmentId": "seg-003",
         "issue": "Inconsistent term: 'ecommerce' vs 'e-commerce'",
         "correction": "ecommerce",
         "severity": "warning"
       }
     ],
     "autoFixAvailable": true
   }
   ```

---

### 2.3 `POST /api/translate` — Translation Pipeline

**Purpose:** The primary translation endpoint. For each segment, it orchestrates the full RAG TM Lookup → LLM Translation → Glossary Enforcement pipeline.

**Detailed Steps:**

1. **Receive the request body:**
   ```json
   {
     "projectId": "uuid",
     "segments": [...],
     "sourceLang": "en",
     "targetLang": "hi_IN",
     "glossaryId": "glossary-general-v1"
   }
   ```

2. **For each segment, execute the Translation Pipeline in order:**

   **Step A — RAG TM Lookup (calls Layer 3):**
   - Normalize the source text (trim, lowercase for comparison).
   - **Exact Match Check:** Query SQLite for an identical source string with matching language pair → returns score `1.0`.
   - **Fuzzy Match Check (if no exact):**
     - Call `text-embedding-004` (Layer 4) to generate a 768-dimensional embedding vector.
     - Fetch all TM records for the language pair from SQLite.
     - Run **in-memory cosine similarity** against all stored embeddings.
     - Classify the result:
       - Score ≥ 0.95 → **Near-Exact** (use TM target directly)
       - Score ≥ 0.75 → **Fuzzy** (use as reference for LLM prompt)
       - Score < 0.75 → **New** (requires full LLM translation)

   **Step B — LLM Translation (for "New" segments only):**
   - Determine which LLM to use:
     - European languages → **Gemini 1.5 Flash**
     - 22 Indian languages → **AI4Bharat IndicTrans2 API**
   - Construct the **constrained prompt** including:
     - Tone/style requirements (Professional, General Purpose)
     - Required glossary term mappings (e.g., "Government" → "सरकार")
     - Fuzzy TM match references (for style context only)
   - Send the prompt and receive only the translated text (no XML, no markdown, no explanations).

   **Step C — Post-Translation Glossary Enforcement:**
   - Filter glossary to only terms present in the source segment.
   - For each mandated glossary term, check (case-insensitive) if the expected target term exists in the LLM output.
   - If missing → set `segment.violation = true` and flag for reviewer attention.

   **Step D — Style/Tone Profile Application (calls Layer 3):**
   - Look up the project's style profile from the SQL Database.
   - Apply any tone adjustments or formatting rules to the translated output.

3. **Rate Limiting Strategy:**
   - Gemini limits: **15 Requests Per Minute**.
   - Batch segments when possible, or translate synchronously per segment.
   - Cap demo documents to ~15 sentences to stay safely under RPM limitations while preserving real-time UI feel.

4. **Return the response:**
   ```json
   {
     "segments": [
       {
         "id": "seg-001",
         "sourceText": "Terms and Conditions Apply.",
         "targetText": "पूर्व प्राधिकरण आवश्यक है।",
         "tmScore": 1.0,
         "matchType": "EXACT",
         "violation": false
       },
       {
         "id": "seg-005",
         "sourceText": "Please verify your account details.",
         "targetText": "अपनी नेटवर्क स्थिति जांचें।",
         "tmScore": 0.0,
         "matchType": "NEW",
         "violation": false
       }
     ]
   }
   ```

---

### 2.4 `POST /api/approve` — Side-by-Side Review & Atomic TM Write

**Purpose:** The most critical endpoint in the system. When a reviewer clicks "Approve" on a segment, this endpoint performs the **Atomic Continuous Learning Update** — writing the approved translation into the Translation Memory so future lookups can reuse it.

**Detailed Steps:**

1. **Receive the approval payload:**
   ```json
   {
     "sourceText": "Terms and Conditions Apply.",
     "targetText": "पूर्व प्राधिकरण आवश्यक है।",
     "sourceLang": "en",
     "targetLang": "hi_IN",
     "projectId": "uuid",
     "segmentId": "seg-001"
   }
   ```

2. **Generate the embedding vector:**
   - Call Google `text-embedding-004` API to create a 768-dimensional embedding of the source text.
   - Result: `embedding = [0.124, 0.442, -0.331, ...]`

3. **Atomic INSERT into SQLite TM:**
   ```sql
   INSERT INTO tm_records (source, target, sourceLang, targetLang, embedding, approvedAt, approvedBy)
   VALUES (?, ?, ?, ?, ?, datetime('now'), ?);
   ```
   - The embedding is stored as a JSON-stringified array in the SQLite column.

4. **Propagation Check — Auto-approve identical segments:**
   - Query the current project's remaining unapproved segments.
   - If any have identical source text to the just-approved segment → auto-approve them too.
   - Return the count of propagated approvals for the toast notification: "3 Identical Segments Auto-Approved!"

5. **Collect training data (for Layer 5):**
   - If the reviewer edited the target text before approving (human revision), log the original LLM output alongside the final approved version as a training data pair.
   - This feeds into the QLoRA fine-tuning dataset.

6. **Return the response:**
   ```json
   {
     "success": true,
     "tmRecordId": "tm-uuid",
     "propagatedCount": 3,
     "newLeverageRate": 0.94
   }
   ```

> **⚠️ CRITICAL RULE:** Translations are ONLY written to the TM after a human approves them. Never before. This single rule determines the integrity of the entire product.

---

### 2.5 `POST /api/export` — Structure-Preserved Export

**Purpose:** Exports the final approved translations as a downloadable DOCX or PDF file, preserving the original document's formatting structure.

**Detailed Steps:**

1. **Receive the export request:**
   ```json
   {
     "projectId": "uuid",
     "format": "docx",       // or "pdf"
     "targetLang": "hi_IN"
   }
   ```

2. **Fetch all approved segments** for the project from the database, including their formatting metadata (heading, paragraph, list item, etc.).

3. **Reconstruct the document structure:**
   - Map each segment back to its original position and format type (captured during parsing in `/api/parse`).
   - For DOCX: Use a library like `docx` (npm) to programmatically build Word documents with proper headings, paragraphs, and lists.
   - For PDF: Use a library like `pdfkit` or `jspdf` to generate formatted PDFs.

4. **Insert translated text** into the reconstructed structure, replacing source text at each position.

5. **Generate the output file** and return it as a binary download with appropriate `Content-Type` and `Content-Disposition` headers:
   ```
   Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document
   Content-Disposition: attachment; filename="policy_translated_hi_IN.docx"
   ```

6. The frontend receives the blob and triggers an auto-download.

---

## Data Flow Summary

```
Layer 1 (UI)  ──POST /api/parse──►  Layer 2 (API)  ──mammoth/pdf-parse──►  Parsed Segments
Layer 1 (UI)  ──POST /api/validate──►  Layer 2 (API)  ──Gemini 1.5──►  Quality Report
Layer 1 (UI)  ──POST /api/translate──►  Layer 2 (API)  ──Layer 3 + Layer 4──►  Translated Segments
Layer 1 (UI)  ──POST /api/approve──►  Layer 2 (API)  ──SQLite INSERT + Embedding──►  TM Updated
Layer 1 (UI)  ──POST /api/export──►  Layer 2 (API)  ──docx/pdfkit──►  Downloaded File
```

---

## Error Handling Strategy

| Error Scenario | Handling |
|---|---|
| File parse failure | Return 400 with descriptive error; show toast in UI |
| Gemini API rate limit (429) | Retry with exponential backoff; queue remaining segments |
| Embedding API failure | Fall back to exact string match only |
| SQLite write failure | Return 500; transaction rollback ensures data integrity |
| Unsupported language pair | Return 400 with supported language list |
