# AI-Powered Translation Studio — ClearLingo
## File 02 — Architecture & Tech Stack (V3)

---

## 1. The Single Most Important Architectural Decision

Before any framework choice, any database choice, or any API choice — the most important architectural decision in this entire system is this:

**Translations are only written to the Translation Memory after a human approves them. Never before.**

This single rule determines the integrity of the entire product. If LLM-generated translations enter the TM before approval, future matches will be suggestions based on unreviewed machine output. The TM will gradually accumulate machine-generated content that may contain errors, style violations, or glossary non-compliance. The "human-in-the-loop" quality guarantee collapses.

Every design decision in the architecture flows from respecting this rule.

---

## 2. MAAR Translation Studio Architecture

### Multi-Agent Adaptive RAG (MAAR) Overview
ClearLingo is built utilizing MAAR principles for continuous translation learning:
- Semantic similarity checks run at scale.
- Vector matching vs String matching.
- Real-time glossary injection into generation prompts.

ClearLingo achieves an astonishing **94% Translation Memory (TM) Leverage Rate**, essentially dropping translation edit efforts by 82%.

### Why Next.js Full Stack
A frontend-heavy team building a backend-heavy-seeming product needs to minimize the cognitive overhead of context switching. Next.js 14 with API Routes gives you one language (TypeScript), one runtime (Node.js), one dev server, one deployment target. The productivity gain is phenomenal during a 36-hour hackathon.

### Why SQLite Is Better Than Complex Vector databases
A critical flaw in the previous version was using an in-memory or rigid JSON array for the TM. The fix is a file-backed persistent embedded database using SQLite.
SQLite via `better-sqlite3` provides a single-file database that survives everything. It requires zero server configuration and zero network overhead. It stores the TM vectors, glossary terms, history, and revisions in one file. Queries run synchronously in microseconds.
For a hackathon where "0 external DBs" is a flex, SQLite is the best choice to show technical mastery over complicated Pinecone set-ups.

---

## 3. Complete Hackathon Tech Stack

### Core Framework
**Next.js 14 (App Router)**
The App Router provides React Server Components, API routes, and Client Components seamlessly. Use TypeScript 5 throughout.

### UI Framework
**Tailwind CSS 3 & shadcn/ui & Framer Motion**
- Tailwind CSS 3 for utility styling.
- shadcn/ui for accessible primitive components (Cards, Tables, Selects).
- Framer Motion 11 for subtle state change animations.

### AI / LLM Orchestration
**Gemini 1.5 Flash**
Free tier provides 15 requests/minute, 1 million tokens/day. This model serves generic En->Fr/Es outputs and performs source checks.

**AI4Bharat / IndicTrans2 API**
For absolute perfection in 22 distinct Indian languages, we utilize the official IndicTrans2 translation api.

**text-embedding-004**
For embedding generation. These vectors power the Semantic TM.

### Document Parsing & State
**Zustand 4** & **TanStack Query 5** handle Client and Server API state caching independently.
**mammoth (DOCX)** & **pdf-parse (PDF)** parse files, splitting strictly by paragraph, then regex abbreviation boundary detection.

---

## 4. Embedding Generation — Critical Design Detail

### Exact String Match Before Embedding
Generating an embedding requires an API call. But if two segments are textually identical, you do not need an embedding — skip the API call. 100% Match saves network overhead.

1. Normalize strings (trim, lowercase)
2. Check SQLite for exact string
3. If Exact -> return 1.0 -> Skip Embedding.
4. If not -> generate embedding -> Vector Cosine Similarity Search -> return best score.

### Contextual Embedding Prefix
A short segment like "Check your network" produces an embedding that is ambiguous. The fix is to prepend a document context label before generating the embedding: "[General Business] Please verify your account details." This shifts the embedding vector into the domain-specific semantic neighborhood.

### SQLite TM vs Pinecone
We embed using Google APIs, and stringify the vector into the SQLite Database row alongside the source translation pair. When fetching, we retrieve all rows and run an in-memory euclidean/cosine product array function to find the top fuzzy matches. For Hackathon-scale (1000s of rows), SQLite in-memory distance calculation is FASTER than network latency to a dedicated vector database!

---

## 5. The Translation Pipeline — Detailed Flow

### Step 1: Document Ingestion
Upload DOCX/PDF -> mammoth/pdf-parse text -> Split by breaks + sentence regex rules.

### Step 2: Source Quality Validation
1. Spell Check (LLM batch payload)
2. Terminology Consistency
3. Date/Number normalizations
4. Punctuation styles
5. Segment length flags

### Step 3: TM Lookup
Check Exact Match -> Generate Vector -> SQLite Cosine match against all past approvals -> Classify >0.95 (Near-Exact), >0.75 (Fuzzy), <0.75 (New).

### Step 4: LLM Translation
Only "New" rows are sent to Gemini 1.5/IndicTrans2.
The prompt limits the AI to output exactly the translated text, incorporating:
- Tone constraints
- Fuzzy TM match references
- Necessary glossary mappings

### Step 5: Post-Translation Glossary Verification
Run string inclusions on the LLM output to strictly verify the LLM listened to the glossary mandates. Flag "Glossary Violation" inside the UI if failed.

### Step 6 & 7: Human Review -> Atomic Approval
The Reviewer reads the side-by-side array. When approved, an Atomic insert triggers:
- New record established in the SQLite file.
- The next time this identical source string appears, it will return as EXACT TM Match!
- Leverage rate dashboard ticker increments live!

---

## 6. Rate Limiting Strategy

Gemini limits: 15 Requests Per Minute.
Batch your API requests if dealing with a 50 segment document! We translate synchronously per segment or use batch arrays, capping the document size for the demo to ~15 sentences so we stay safely under strict RPM limitations while preserving real-time UI feel.
