# Implementing DeepTrans Studio Features into ClearLingo

After reading through DeepTrans Studio's codebase and comparing it with your existing ClearLingo architecture, here's a practical assessment of **what you already have**, **what's worth adopting**, and **how** to wire it in.

---

## Your Current Architecture (Quick Recap)

| Layer | ClearLingo (what you have) | DeepTrans (what they have) |
|---|---|---|
| **File Parsing** | `mammoth` (DOCX→HTML), `pdf-parse`, `jszip` (PPTX), `xlsx` | Custom XML parser (`fast-xml-parser` + `jszip`), run-level styling extraction |
| **Segmentation** | `smartSplit()` — regex sentence splitting with abbreviation protection | Sentence-level placeholders + paragraph "runs" with bold/colour metadata |
| **Translation Memory** | SQLite + 768-dim embeddings via `text-embedding-005`. Three-tier lookup (Exact → Fuzzy → New) | Redis + BullMQ queues + Milvus vector DB. TMX/CSV import worker |
| **LLM Translation** | Multi-model routing (Sarvam for Indic, Gemini for others). Glossary injection. Cache dedup. | 3-agent pipeline: Term Extract → Dict Lookup → Glossary-Embed Translate |
| **QA / Validation** | Post-translation glossary enforcement (`glossaryEnforce`). Validation via Gemini. | Dedicated QA worker: `SyntaxMarkerExtractAgent`, `SyntaxEvaluateAgent`, `SyntaxAdviceEmbedAgent` |
| **Human Review** | Revision logging with edit-distance tracking. Training pair export. | MT Review stage, post-edit agents |

---

## What's Actually Worth Adding

> **IMPORTANT:** You do NOT need to rewrite your backend. ClearLingo's layered architecture (RAG Engine → LLM Orchestrator) is already well-structured. The additions below are **enhancements**, not replacements.

### 1. Pre-Translation Term Extraction (HIGH VALUE)

**What DeepTrans does differently:** Before translating, it runs a dedicated `MonoTermExtractAgent` that asks the LLM to scan the source text and pull out domain-specific terminology (proper nouns, technical terms, acronyms). These are then looked up in a dictionary/TM before the final translation call even happens.

**Why it matters for you:** Your current pipeline sends the glossary terms you *already have* in the DB. But it doesn't discover **new** terms the document introduces. If someone uploads a legal contract with terms like "force majeure" or "indemnification", your glossary won't have them, and the LLM will translate them inconsistently across segments.

**How to add it to ClearLingo:**

Add a new function in `server/gemini.js` (or a new file `server/term-extractor.js`):

```javascript
// server/term-extractor.js
import { translateText } from './gemini.js';

/**
 * Step 0 (NEW): Extract key terms from source text before translating.
 * Returns an array of terms the LLM identified as important.
 */
export async function extractTerms(sourceText, sourceLang = 'en') {
  const prompt = `You are a terminology extraction specialist.
Analyze the following ${sourceLang} text and extract ALL:
- Domain-specific terminology
- Proper nouns and named entities  
- Technical acronyms
- Legal/medical/financial terms

Return ONLY a JSON array of objects: [{"term": "...", "category": "..."}]
No explanations. No markdown.

TEXT:
${sourceText}`;

  const raw = await translateText(prompt); // reuse your existing Gemini call
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}
```

Then wire it into `llm-orchestrator.js` → `translateBatch()`, **before** the per-segment loop:

```javascript
// Inside translateBatch(), after loading segments but before the for-loop:

// ═══ NEW: Document-level term extraction (DeepTrans pattern) ═══
const fullSourceText = segments.map(s => s.sourceText).join('\n');
const discoveredTerms = await extractTerms(fullSourceText, sourceLang);

// Cross-reference with existing glossary
for (const term of discoveredTerms) {
  const existing = glossary.find(g => 
    g.source.toLowerCase() === term.term.toLowerCase()
  );
  if (!existing) {
    console.log(`   🔍 New term discovered: "${term.term}" (${term.category})`);
    // Optionally auto-add to glossary as non-mandatory suggestion
  }
}
```

---

### 2. Structured DOCX Parsing (MEDIUM VALUE)

**What DeepTrans does differently:** Instead of using `mammoth` (which converts DOCX→HTML and loses granular formatting), it parses the raw OOXML directly. It knows that paragraph 3, run 2 is bold + 14pt + blue. After translation, it can reconstruct the document with the original formatting intact.

**Why it matters for you:** Your current flow is: `mammoth → HTML → regex strip tags → plain text segments`. This works for translation, but when exporting back to DOCX via `server/routes/export.js`, you're recreating formatting from scratch — you've lost the original structure.

**How to add it (if you want richer exports):**

Your `parse.js` already has `parseDocx()` using mammoth. You could add an *alternative* parser alongside it:

```javascript
// In server/routes/parse.js — add a structured parser option

import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';

async function parseDocxStructured(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const docXml = await zip.file('word/document.xml')?.async('string');
  if (!docXml) throw new Error('Invalid DOCX');

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
  });
  const doc = parser.parse(docXml);
  const body = doc?.document?.body;
  const paragraphs = Array.isArray(body?.p) ? body.p : body?.p ? [body.p] : [];

  const segments = [];
  for (const p of paragraphs) {
    const runs = Array.isArray(p?.r) ? p.r : p?.r ? [p.r] : [];
    let text = '';
    const formatting = [];

    for (const r of runs) {
      const t = typeof r?.t === 'string' ? r.t : r?.t?.['#text'] || '';
      const rPr = r?.rPr || {};
      formatting.push({
        text: t,
        bold: !!rPr?.b,
        italic: !!rPr?.i,
        color: rPr?.color?.['@_val'] || null,
      });
      text += t;
    }

    if (text.trim().length > 3) {
      segments.push({
        text: text.trim(),
        formatType: 'paragraph',
        runs: formatting,  // preserve for export reconstruction
      });
    }
  }
  return segments;
}
```

> **TIP:** You don't need to replace mammoth. Keep it as the default, and use the structured parser only when the user wants "format-preserving" export.

---

### 3. Post-Translation QA Agent (HIGH VALUE)

**What DeepTrans does differently:** After translation, a dedicated QA worker (`qaWorker`) automatically checks:
- Did the translation respect all glossary terms?
- Are there syntax / grammar issues in the target language?  
- Does the sentence structure make sense?

It runs `SyntaxMarkerExtractAgent` → `SyntaxEvaluateAgent` → `SyntaxAdviceEmbedAgent`.

**Why it matters for you:** Your `glossaryEnforce()` already does deterministic glossary checking. But it doesn't catch *semantic* errors — cases where the translation is grammatically wrong, or the tone shifted, or a number got mangled.

**How to add it to ClearLingo:**

Add a QA validation step in `server/gemini.js`:

```javascript
/**
 * Post-translation QA check via LLM.
 * Returns { passed: boolean, issues: string[] }
 */
export async function qaCheck(sourceText, translatedText, targetLang) {
  const prompt = `You are a translation quality auditor.
Compare the source and translation below. Check for:
1. Missing or added information
2. Number/date/proper noun errors  
3. Grammar issues in the target language
4. Tone inconsistency

Source (English): "${sourceText}"
Translation (${targetLang}): "${translatedText}"

Return ONLY a JSON object: {"passed": true/false, "issues": ["issue 1", ...]}
If the translation is good, return: {"passed": true, "issues": []}`;

  const raw = await model.generateContent(prompt);
  try {
    return JSON.parse(raw.response.text());
  } catch {
    return { passed: true, issues: [] };
  }
}
```

Then call it inside `translateBatch()` after each LLM translation, before writing to DB:

```javascript
// After translateSegment() returns, before DB update:
if (status === 'success' && matchType === 'NEW') {
  const qa = await qaCheck(seg.sourceText, llmResult.targetText, targetLang);
  if (!qa.passed) {
    console.log(`   ⚠️ QA issues: ${qa.issues.join(', ')}`);
    // Store issues for human review
    result.qaIssues = qa.issues;
  }
}
```

---

### 4. Translation Memory Import from TMX/CSV (MEDIUM VALUE)

**What DeepTrans does:** It accepts bulk uploads of industry-standard `.tmx` files (XML format used by professional translation tools) and imports them into the vector database with embeddings.

**Why it matters:** If you or your users have existing translations from other tools (SDL Trados, memoQ, etc.), they export in TMX format. Importing these would instantly give your RAG engine thousands of pre-verified translation pairs.

**How to add it:**

Create a new route `server/routes/import-tm.js`:

```javascript
import { Router } from 'express';
import multer from 'multer';
import { XMLParser } from 'fast-xml-parser';
import ragEngine from '../rag-engine.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post('/', upload.single('file'), async (req, res) => {
  const { sourceLang = 'en', targetLang = 'hi_IN' } = req.body;
  const buf = req.file.buffer.toString('utf-8');
  
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  const obj = parser.parse(buf);
  const tus = Array.isArray(obj?.tmx?.body?.tu) 
    ? obj.tmx.body.tu 
    : obj?.tmx?.body?.tu ? [obj.tmx.body.tu] : [];

  let imported = 0;
  for (const tu of tus) {
    const tuvs = Array.isArray(tu?.tuv) ? tu.tuv : tu?.tuv ? [tu.tuv] : [];
    const source = tuvs.find(t => 
      (t['@_xml:lang'] || '').toLowerCase().startsWith(sourceLang.toLowerCase())
    );
    const target = tuvs.find(t => 
      (t['@_xml:lang'] || '').toLowerCase().startsWith(targetLang.substring(0, 2).toLowerCase())
    );
    
    if (source?.seg && target?.seg) {
      await ragEngine.tmWrite({
        sourceText: String(source.seg),
        targetText: String(target.seg),
        sourceLang,
        targetLang,
        context: 'Imported TM',
      });
      imported++;
    }
  }

  res.json({ imported, total: tus.length });
});

export default router;
```

Register it in `server/index.js`:
```javascript
import importTmRouter from './routes/import-tm.js';
app.use('/api/import-tm', importTmRouter);
```

---

## What You Should NOT Adopt

> **CAUTION:** Not everything from DeepTrans is a good fit. Their architecture has heavier infrastructure requirements.

| DeepTrans Feature | Why to Skip |
|---|---|
| **Redis + BullMQ workers** | Your SQLite + in-process approach is simpler and appropriate for your scale. BullMQ adds Redis as a hard dependency for minimal gain unless you're processing 1000+ documents concurrently. |
| **Milvus Vector DB** | You already do cosine similarity with in-memory vectors from SQLite. Milvus is overkill until you have 100K+ TM records. |
| **Prisma ORM** | You use raw `better-sqlite3` prepared statements, which are faster and give you full control. No reason to add Prisma overhead. |
| **Next.js server actions** | Your Express + Vite setup is working. Migrating to Next.js `'use server'` just to match DeepTrans would be a full rewrite with no translation-quality benefit. |
| **i18n agent system** | DeepTrans has a complex localisation system for its agent prompts. Your prompts are in English and that's fine — the translation quality doesn't depend on localising your internal prompts. |

---

## Recommended Implementation Order

| Priority | Feature | Effort | Impact |
|---|---|---|---|
| 🔴 1 | Pre-Translation Term Extraction | ~2 hours | High — catches unknown terminology before translation |
| 🔴 2 | Post-Translation QA Agent | ~2 hours | High — catches semantic errors glossary check misses |
| 🟡 3 | TMX Import Route | ~3 hours | Medium — lets you bootstrap the TM with professional data |
| 🟢 4 | Structured DOCX Parser | ~4 hours | Medium — only needed if format-preserving export is important |

---

## Summary

Your ClearLingo already has a solid foundation: layered architecture, multi-model routing, TM lookup, glossary enforcement, and revision tracking. The highest-value additions from DeepTrans are the **term extraction pre-pass** and the **LLM-based QA post-check** — both are cheap to implement (one new function + one prompt each) and directly improve translation consistency without adding infrastructure complexity.
