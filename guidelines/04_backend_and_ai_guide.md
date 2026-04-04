# AI-Powered Translation Studio — ClearLingo
## File 04 — Backend & AI Guide (V3)

---

## 1. Zero External Dependency Architecture (SQLite)

In a Hackathon, external dependencies (Pinecone, Supabase, Redis) fail due to network, API exhaustion, or setup bugs. ClearLingo runs **completely locally** using `better-sqlite3`.

### The SQLite Vector Implementation Strategy
SQLite natively does not do vector search. However, we can use `better-sqlite3` to pull down **all** stored records for a specific language pair, and run a **very fast Cosine Similarity Array operation** in-memory using Node/TypeScript! 
For 1,000 to 5,000 translation memory records, the `V8 Node.js` engine can compute cosine similarities against all rows in less than 3ms. This beats Pinecone's network latency.

```typescript
// /lib/tm.ts (The Core TM Service Pattern)

import Database from 'better-sqlite3';

const db = new Database('clearlingo.db');

// In-Memory Cosine Similarity
function cosineSimilarity(vectorA: number[], vectorB: number[]) {
    let dotProduct = 0, normA = 0, normB = 0;
    for (let i = 0; i < vectorA.length; i++) {
        dotProduct += vectorA[i] * vectorB[i];
        normA += vectorA[i] * vectorA[i];
        normB += vectorB[i] * vectorB[i];
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function searchTM(sourceText: string, embeddingVector: number[], sourceLang: string, targetLang: string) {
    // Phase 1: Search Exact String Match (Saves 100% AI Cost)
    const exactQuery = db.prepare(`SELECT * FROM tm_records WHERE source = ? AND sourceLang = ? AND targetLang = ?`);
    const exactMatch = exactQuery.get(sourceText, sourceLang, targetLang);
    
    if (exactMatch) {
        return { match: exactMatch.target, score: 1.0, isExact: true };
    }
    
    // Phase 2: Fetch all embeddings for context pair
    const allRecords = db.prepare(`SELECT * FROM tm_records WHERE sourceLang = ? AND targetLang = ?`).all(sourceLang, targetLang);
    
    let bestMatch = null;
    let bestScore = 0;

    allRecords.forEach(record => {
        // Parse the SQLite saved JSON vector string
        const recordVector = JSON.parse(record.embedding);
        const score = cosineSimilarity(embeddingVector, recordVector);
        
        if (score > bestScore) {
            bestScore = score;
            bestMatch = record;
        }
    });

    return { match: bestMatch?.target, score: bestScore, isExact: false };
}
```

---

## 2. Gemini & IndicTrans2 Translation Strategy

After TM Search, any segment with a score `< 0.75` goes to LLM translation.
For European languages, **Gemini 1.5 Flash** via Vercel AI SDK.
For **22 Indian languages**, **AI4Bharat IndicTrans2 API**.

### The Gemini Constrained Prompt

When sending text to the LLM, you must constrain its output format heavily to adhere to the glossary.

```typescript
const prompt = `
You are a professional Enterprise Translator translating from ${sourceLang} to ${targetLang}.
You will receive a single sentence. Return ONLY the translated sentence. No XML, no markdown, no explanations.

STYLE REQUIREMENTS:
Tone: Professional, General Purpose.

REQUIRED GLOSSARY TERMS (MUST USE EXACTLY IF SOURCE TERM IS PRESENT):
${glossaryString}   // e.g. "Government" -> "Gobierno"

REFERENCE TRANSLATIONS (For Style ONLY):
${fuzzyMatch ? `Target context reference: ${fuzzyMatch}` : ''}

SOURCE TEXT:
${segment.text}
`;
```

---

## 3. Post-Translation Glossary Integrity Checks

You cannot trust an LLM completely. ClearLingo runs a deterministic Regex check AFTER the translation resolves.

1. Filter Glossary to only words present in `Source Segment`.
2. Map over the list of constraints.
3. Use a Case-Insensitive JavaScript check to see if the mapping constraint exists in the LLM Output string.
4. If missing, flag `segment.violation = true` and alert the Reviewer.

---

## 4. Source Quality Validation Engine

Because of Gemini's massive 1-Million token context window per day, we can send it the raw document for batch problem extraction.

### Validating the Source BEFORE Translation:
When document uploads:
1. Map document strings.
2. Ask Gemini 1.5: `Identify 5 core terminology inconsistencies in this extracted text. Return them as structured JSON { issue, correction }.`
3. Ask Gemini 1.5: `Identify any grammatical English errors or mixed date formats.`
4. Return the Payload to the Frontend Dashboard.

This solves errors *before* they multiply across 22 Indic Languages.

---

## 5. The Atomic Continuous Learning Update

The API endpoint `/api/tm/approve` is the entire foundation of the platform's claims.

When `[Approve]` is clicked in the frontend UI:
1. Receives `(sourceText, targetText, sourceLang, targetLang)` shape.
2. Calls Google `text-embedding-004` to create `embedding = [0.124, 0.442...]`.
3. Issues a direct `INSERT INTO tm_records (source, target, embedding...)` into the SQLite DB.
4. The backend then forces a re-pull of similar Unapproved source texts!
5. This fulfills the Continuous Learning promise instantly!
