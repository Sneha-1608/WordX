# AI-Powered Translation Studio — ClearLingo
## File 06 — Hackathon Survival Guide & Dataset References

---

## 1. Highly Recommended Datasets

Since the architecture relies on general-purpose translations across 22 Indian languages, here is the master list of recommended datasets for the demo:

### For Vector Translation Memory (TM) Seeding & RAG
These provide reliable English-to-Indic parallel sentences to drop straight into the SQLite vector memory:
1. **FLORES-200 (Highest Recommendation):** Created by Meta. Covers all 22 Indian languages. Perfectly sentence-segmented and multi-domain. Use this for seeding the TM and generating fake `revisions` for QLoRA demos.
2. **WikiMatrix:** Millions of parallel sentences computationally extracted from Wikipedia. Broad vocabulary covering government, tech, and general business.
3. **GlobalVoices:** Parallel corpus of news stories. Covers conversational yet journalistic language.
4. **Tatoeba:** Massive database of short, user-contributed example sentences. Fantastic for short UI strings or button texts.

### For Layer 5 (QLoRA Fine-Tuning & Adapter Training)
1. **IndicCorp (AI4Bharat):** One of the largest collections of monolingual text for Indian languages. Crucial for fine-tuning a base model to simply *understand* Indian languages better.
2. **NLLB (No Language Left Behind):** Meta's massive dataset. Contains *NLLB-Seed* data designed to train translation models for low-resource languages (Assamese, Odia, Sindhi, etc.).
3. **BPCC (Bharat Parallel Corpus Collection):** AI4Bharat’s massive, clean compilation used to train IndicTrans2.

### For Layer 1 (Source Quality Validation)
1. **CoNLL-2014 or JFLEG:** Standard datasets for Grammatical Error Correction. Useful for evaluating how well Gemini 1.5 Flash catches typos and grammar issues.

---

## 2. 5 Critical Demoday Hacks 

Hackathons are won on smooth execution. Use these specific hacks to protect your complex Next.js + SQLite + Gemini architecture:

### Hack 1: Build a "God Mode" Fallback (The Wi-Fi Insurance Policy)
Hackathon Wi-Fi always goes down under heavy load during judging. 
- **Implementation:** In your `.env` file, add `MOCK_LLM_RESPONSES=true`. In your `/api/translate` and `/api/validate` routes, if this flag is true, add a `setTimeout` of 1.5 seconds and return a hardcoded, perfect JSON response. The judges see the exact same UI and animations, and the demo never crashes.

### Hack 2: Defeat the Gemini Rate Limit (Error 429)
Gemini 1.5 Flash free tier allows **15 requests per minute (RPM)**. 
- **Implementation:** Batch your translations! Send an array of 10 sentences to Gemini and ask it to return a JSON array of 10 translations. Alternatively, use a delay queue in Node.js to fire no more than a few requests per second.

### Hack 3: Optimize Your SQLite Vector Search
V8 is incredibly fast at in-memory math, but `JSON.parse()` is a silent performance killer if nested inside loops.
- **Implementation:** Parse the SQLite stringified vector *once* when loading the rows from the database, not inside the cosine similarity comparison loop.
```typescript
// Good: Parse once
const tmRecords = db.prepare('SELECT * FROM tm_records').all().map(row => ({
    ...row,
    vectorArray: JSON.parse(row.embedding)
}));
```

### Hack 4: The Exact Glossary Regex Check
Your architecture uses a deterministic post-check to verify glossary adherence. 
- **Implementation:** Use word boundaries (`\b`) and case-insensitive regex in JavaScript. Without word boundaries, checking for "सरकार" (Government) might falsely validate against "गैर-सरकारी" (Non-governmental).
```typescript
const regex = new RegExp(`\\b${requiredTerm}\\b`, 'i');
if (!regex.test(llmOutput)) {
    // Flag violation!
}
```

### Hack 5: Sell the "UI Illusion" of Continuous Learning
The most impressive part of the pitch is the **Atomic Continuous Learning Loop**. You must make this incredibly visual for the judges.
- **Implementation:** When clicking `[Approve]`, trigger a beautiful **React Hot Toast** notification: 🎉 *"Translation Saved to Vector DB. 3 identical segments auto-approved downstream!"* Simultaneously, use Framer Motion to make the "94% TM Leverage" gauge physically tick upwards. This visually connects the user action to the ROI.
