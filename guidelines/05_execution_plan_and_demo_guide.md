# AI-Powered Translation Studio — ClearLingo
## File 05 — Execution Plan & Demo Guide (V3)

---

## 1. The 8-Hour Hackathon Build Plan

You do not have time to build a distributed microservice architecture. You have time to build a robust monolithic Next.js application with a local SQLite database that demos perfectly.

**Hour 1-2: Foundation & Database**
- Initialize Next.js 14 App Router project.
- Install `better-sqlite3`, `shadcn/ui`, `lucide-react`, `mammoth`, `pdf-parse`.
- Create `./clearlingo.db` and the single table: `tm_records (id, source, target, sourceLang, targetLang, embedding)`.

**Hour 3-4: UI Shell & Upload**
- Build the Layout: Sidebar, Dashboard metrics (94% gauge), main Editor area.
- Build the File Upload dropzone.
- Hook up `mammoth.js` to extract paragraphs from a test DOCX file.

**Hour 5-6: Validations & Translations**
- Build the `POST /api/validate` route calling Gemini 1.5 for the Source Quality validation.
- Build the `POST /api/translate` route.
- Implement the SQLite `searchTM` exact string and cosine similarity functions.

**Hour 7-8: Editor Interactions & Review**
- Build the Side-by-Side editing AgGrid/Table.
- Implement the "Target Editor Context Bubble" with Glossary checks.
- Build `POST /api/tm/approve` to grab the user edits, generate the final vector, and save to SQLite.

---

## 2. The 90-Second Judge Pitch

### Hook (15 seconds)
"70% of enterprise translation costs are wasted re-translating content that has already been approved before. Current tools like DeepL are just machine translators — they have no institutional memory. String-based CAT tools miss paraphrased data. We built ClearLingo, a Semantic Multi-Agent RAG Translation Studio that slashes costs by 90% by remembering everything you approve."

### The Problem (20 seconds)
"Government bodies and enterprises across India need documents translated into 22 distinct languages. If a document says 'Terms and Conditions Apply' vs 'Conditions and Terms Are Applicable', a string-matcher misses it. ClearLingo catches meaning using Euclidean Vector Memory, giving us a 94% Translation Memory leverage rate."

### The Demo Flow (40 seconds)
*(Person 1 is speaking, Person 2 is clicking exactly when told)*
"Watch this. Document 1 uploads. Notice it runs 5 Source Quality checks *before* translating. We see inconsistent terminology highlighted here. 
Now, we translate. Gemini 1.5 Flash outputs suggestions, but our glossary constraints are hard-coded into the prompt.
*(Person 2 clicks 'Approve')*
As I approve this row, the system doesn't just save a text file. It writes a 768-dimensional vector into our local SQLite instance.
If we upload Document 2 right now, identical sentences are instantly approved. Fuzzy sentences are pulled from memory, skipping the LLM entirely."

### The Close (15 seconds)
"While others built simple LLM wrappers, we built a Stateful Enterprise Production Pipeline running entirely on Next.js and SQLite. We brought institutional memory to 22 Indian languages."

---

## 3. Demo Rehearsal Checklist

The demo requires two specific documents engineered to show off the system.

**Document A: "The Seed Document"**
- A 15-sentence general document containing 2 intentional spelling errors and a specific glossary term ("Government").

**Document B: "The Leverage Document"**
- A 15-sentence document with:
  - 5 Exact matching sentences from Document A (to show 100% TM reuse).
  - 5 Fuzzy matching paraphrased sentences (to show Vector TM catching meaning).
  - 5 Brand new sentences containing the Glossary keyword (to prove prompt-level enforcement still applies).

**Demo Instructions Setup:**
1. Stop the Next.js Dev Server.
2. Delete `clearlingo.db` (Start Fresh).
3. Start the Server.
4. Upload Document A. Approve 5 segments.
5. Upload Document B. Point to the UI returning "Exact Match" and "Fuzzy Match".
6. Profit.
