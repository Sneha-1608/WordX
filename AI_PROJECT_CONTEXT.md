# VerbAI (formerly ClearLingo) - AI Context & Codebase Summary

> **INSTRUCTIONS FOR AI AGENT:** You are reading the core technical summary for **VerbAI**, an AI-Powered Enterprise Translation Platform with Retrieval-Augmented Generation (RAG), Semantic Translation Memory (TM), and LLM Orchestration. Use this file as your primary context when writing, refactoring, or debugging code in this repository.

---

## 1. Project Identity & Purpose
- **Current Brand:** VerbAI (legacy name "ClearLingo" may still appear in some file names or database tables).
- **Goal:** Enterprise document translation platform combining a Translation Memory (TM) engine, RAG, and multi-model LLM orchestration (Google Gemini + Sarvam AI / IndicTransToolkit) in a robust, zero-infrastructure Node.js + React stack.
- **Value Prop:** Reduces costs by caching approved translations in TM (Semantic Vector Search) and guarantees consistency with a strict glossary enforcement engine.

---

## 2. Technology Stack
**Frontend:**
- **Framework:** React 18 + Vite (TypeScript/TSX used for UI logic)
- **Styling:** Tailwind CSS V4 + Radix UI (accessible headless components)
- **State Management:** Zustand (`src/app/store.ts` contains `useAppStore` for global state and `useDashboardStore` for analytics)
- **Routing:** React Router 7 (`src/app/routes.tsx`)
- **Key UI Libraries:** Recharts (Analytics), Framer Motion (Animations, e.g. RippleGrid on Home page), Sonner (Toasts)

**Backend:**
- **Framework:** Node.js (ESM) + Express 5
- **Database:** `better-sqlite3` embedded SQLite with WAL mode enabled.
- **AI/LLM Providers:**
  - Google Gemini 2.0 Flash (General translation, validation, QA, 768-dim embeddings via `text-embedding-005`).
  - Sarvam AI & IndicTransToolkit (Dedicated engine for 22 scheduled Indian languages).
- **Document Parsing:** Mammoth (DOCX text), JSZip & fast-xml-parser (Structured DOCX formatting), pdf-parse.

---

## 3. High-Level Architecture & Project Structure
This app serves both the frontend and API from a unified project boundary, typically ran via `npm run dev:all` (Vite + Node Express + Python server for IndicTrans).

### `d:\Codes\Real Hackathon\server\` (Layer 2-6: Backend & API Gateway)
- `index.js`: Main Express entrypoint. Mounts all API routes (`/api/*`).
- `db.js`: Initializes SQLite (`clearlingo.db`) and defines schemas for TM, projects, segments, glossary, and logging. 
- `gemini.js`: Google Gemini API client setup, handles embeddings and LLM generations with fallbacks.
- `sarvam.js` / `indictrans.js`: Modules connecting to Indian language specific translation services.
- `llm-orchestrator.js`: Core brain. Routes translation intelligently. If target language is Indic -> use Sarvam/IndicTransToolkit. Otherwise -> Gemini. Includes `translateBatch()` pipeline.
- `rag-engine.js`: Manages the Semantic TM. Calculates cosine similarity across vectors to find EXACT strings or FUZZY concepts.
- `training-pipeline.js`: Continuous enhancement pipeline utilizing `revisions` (human corrections) to simulate fine-tuning (QLoRA) over models. 
- `routes/`: Express router files broken out by business logic (`parse.js`, `translate.js`, `approve.js`, `analytics.js`).

### `d:\Codes\Real Hackathon\src\` (Layer 1: Web UI)
- `main.tsx` / `app/App.tsx`: App bootstrapping.
- `app/routes.tsx`: Defines standard screens.
- **Screens (`src/app/screens/`):**
  - `Home.tsx`: The landing page. heavily animated with Framer Motion and features a dynamic `RippleGrid` background component.
  - `DocumentUpload.tsx`: Drag-and-drop parsing screen mapping to `/api/parse`.
  - `TranslationEditor.tsx`: Side-by-side editing grid for human-in-the-loop linguists. Allows segment approval, regex glossary verification warnings, and TM score badges.
  - `Validation.tsx`: 5-point quality engine audit results.
  - `Analytics.tsx`: High-level metrics dashboard showing TM leverage and savings.
  - `TrainingPipeline.tsx`: Simulated A/B testing and local fine-tuning dashboard.
- **Components (`src/app/components/`):** Standardized, reusable components (`FeatureCard.tsx`, `SegmentRow.tsx`, `Button.tsx`, `Navigation.tsx`).

---

## 4. Key Workflows & Engineering Details

### Translation Workflow:
1. **Document Ingestion:** User uploads a `.docx` or `.pdf`.
2. **Segmentation & Parse:** `server/routes/parse.js` breaks text into segments.
3. **Pre-Translation RAG lookup:** 
   - Tier 1: Exact TM string match (SQLite lookup). Result skips LLM.
   - Tier 2: Vector search. Segments are converted into 768-dim embeddings via Gemini and compared via Cosine Similarity (`rag-engine.js`). Matches ≥ 0.95 skip LLM. Matches between 0.75-0.95 are "Fuzzy" and fed to the LLM to refine.
4. **Constrained Translation:** LLM Orchestrator (`llm-orchestrator.js`) builds a prompt injecting Mandatory Glossary Terms for any "New" or "Fuzzy" segments.
5. **Human Review & Feedback:** User approves segments in `TranslationEditor.tsx`.
6. **Atomic Memory Sync:** Approved segments are automatically written back to TM in the DB.

### Environment & Hackathon Workarounds:
- The backend features a `MOCK_MODE=false` flag. If API keys are missing or limits are hit, it can fall back to stubbed data.
- **Training Pipeline (`training-pipeline.js`):** In local/hackathon mode, real `unsloth` and `trl` Python deep learning modules might be disabled or mocked out to prevent failure on machines without heavy GPUs. It uses a "simulated endpoint" concept to display progress in the UI while bypassing actual tensor operations when dependencies are missing.
- **Indic Translations:** Indian languages rely heavily on the IndicTransToolkit / AI4Bharat integration. If these give environment errors, the fallback orchestrator routes text to Gemini 1.5 Flash.

---

## 5. Typical Tasks & Safe Instructions
- **Rebranding Iteration:** All brand text should be exactly "VerbAI" or "Verb AI" (not ClearLingo).
- **CSS / UI Modifiers:** Stick to Tailwind classes and local CSS variables defined in `src/styles/theme.css` and `tailwind.css`. Animations should leverage Framer Motion or existing utility classes.
- **Database Migrations:** If adding fields to `db.js`, utilize the implemented `addColumnIfNotExists()` functionality as this uses `better-sqlite3`. No ORMs (Prisma/TypeORM) are involved. Keep SQL raw.

> Use this file as your foundation context when navigating the `d:\Codes\Real Hackathon` workspace.
