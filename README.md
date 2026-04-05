<p align="center">
  <img src="https://img.shields.io/badge/VerbAI-Enterprise%20Translation-4a7c2e?style=for-the-badge&logoColor=white" alt="VerbAI Badge"/>
</p>

<h1 align="center">🌐 VerbAI</h1>

<p align="center">
  <strong>AI-Powered Enterprise Translation Platform</strong><br/>
  RAG · Semantic TM · Multi-Model LLM Orchestration · Continuous Learning
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react" alt="React"/>
  <img src="https://img.shields.io/badge/Vite-8-646CFF?style=flat-square&logo=vite" alt="Vite"/>
  <img src="https://img.shields.io/badge/Express-5-000000?style=flat-square&logo=express" alt="Express"/>
  <img src="https://img.shields.io/badge/Tailwind-4-06B6D4?style=flat-square&logo=tailwindcss" alt="Tailwind"/>
  <img src="https://img.shields.io/badge/SQLite-WAL-003B57?style=flat-square&logo=sqlite" alt="SQLite"/>
  <img src="https://img.shields.io/badge/Gemini-2.0%20Flash-4285F4?style=flat-square&logo=google" alt="Gemini"/>
  <img src="https://img.shields.io/badge/Languages-40+-green?style=flat-square" alt="Languages"/>
</p>

---

## 🎯 What is VerbAI?

VerbAI is a **full-stack, AI-powered Computer-Assisted Translation (CAT) platform** that combines a **Translation Memory (TM) engine**, **Retrieval-Augmented Generation (RAG)**, and **multi-model LLM orchestration** (Google Gemini + Sarvam AI) — all in a single-server, zero-infrastructure Node.js application.

### Why VerbAI?

| Problem | VerbAI Solution |
|---|---|
| Enterprise translation is slow & expensive | AI + TM leverage reduces cost by **94%+** |
| Inconsistent glossary usage across translators | **Mandatory glossary enforcement** at prompt + post-translation audit |
| Poor Indian language support in general-purpose LLMs | **Sarvam AI** (Gemma3-4B by AI4Bharat) for all **22 scheduled Indian languages** |
| Translation quality degrades without feedback | **QLoRA fine-tuning pipeline** retrains on human corrections |
| Document formatting lost after translation | **Structured DOCX parser** preserves bold/italic/underline per-run |

---

## 🏗️ Architecture

VerbAI follows a **6-Layer Architecture**, with each layer as an independent, composable module:

```
┌─────────────────────────────────────────────────────────┐
│               Layer 1: Web UI (React 19)                │
│   Home · Upload · Editor · Validation · Analytics       │
│   Training Pipeline · Human Approval · About            │
├─────────────────────────────────────────────────────────┤
│              Layer 2: API Gateway (Express 5)            │
│   /parse · /translate · /validate · /approve · /export   │
│   /rag · /llm · /training · /analytics · /import-tm      │
├─────────────────────────────────────────────────────────┤
│              Layer 3: Core RAG Engine                    │
│   Vector TM (SQLite + 768-dim embeddings)                │
│   Glossary Enforcement · Style Profiles · Revisions      │
├─────────────────────────────────────────────────────────┤
│           Layer 4: LLM Orchestration Engine              │
│   Gemini 2.0 Flash · Sarvam AI · LoRA Adapters           │
│   Smart Routing · Translation Cache · QA Agent            │
├─────────────────────────────────────────────────────────┤
│           Layer 5: Training Pipeline                     │
│   Dataset Extraction · QLoRA Fine-Tuning (Simulated)     │
│   A/B Testing · Auto-Deploy · Rollback                   │
├─────────────────────────────────────────────────────────┤
│           Layer 6: Analytics Dashboard                   │
│   TM Leverage · Glossary Compliance · Cost Savings       │
│   Segment Velocity · Language Coverage                   │
└─────────────────────────────────────────────────────────┘
```

---

## ✨ Key Features

- **🔍 Three-Tier TM Lookup** — Exact string match → Semantic vector search (cosine similarity) → Edit distance fallback
- **🤖 Smart Model Routing** — Automatically selects Sarvam AI for Indian languages, Gemini for everything else
- **📊 Real-Time Analytics** — TM leverage, glossary compliance, cost savings, segment velocity dashboards
- **🔄 Continuous Learning** — QLoRA fine-tuning pipeline that learns from human corrections
- **📝 Format-Preserving Translation** — DOCX parser preserves bold, italic, underline, font color, and heading structure
- **✅ 5-Point Quality Engine** — Automated validation checking spelling, grammar, consistency, formatting, and glossary
- **🌊 Glassmorphism UI** — Interactive wave background, glass surfaces, dark/light theme toggle

---

## 🛠️ Tech Stack

### Frontend
| Technology | Purpose |
|---|---|
| **React 19** + **Vite 8** | UI framework & dev server |
| **Tailwind CSS 4** | Utility-first styling |
| **Zustand** | Global state management |
| **Radix UI** | Accessible headless components |
| **Recharts** | Dashboard charts & visualizations |
| **Framer Motion** | Animations & transitions |
| **Lucide React** | Icon library |
| **React Router 7** | Client-side routing |

### Backend
| Technology | Purpose |
|---|---|
| **Node.js (ESM)** + **Express 5** | Runtime & HTTP framework |
| **better-sqlite3** | Embedded DB (WAL mode, 14 tables) |
| **Google Generative AI SDK** | Gemini 2.0 Flash + text-embedding-005 |
| **Sarvam AI REST API** | Indian language translation |
| **Mammoth / JSZip / pdf-parse** | Document parsing (DOCX, PDF) |
| **pdfkit / docx** | Document export |

### ML Pipeline (Python)
| Technology | Purpose |
|---|---|
| **PyTorch + Transformers** | Model backbone |
| **PEFT + TRL** | QLoRA fine-tuning & DPO alignment |
| **FAISS** | Vector index for RAG retrieval |
| **sacrebleu + COMET** | Translation quality metrics |

---

## 🌍 Supported Languages (40+)

| Category | Languages | Engine |
|---|---|---|
| **Indian** (22) | Hindi, Bengali, Tamil, Telugu, Marathi, Gujarati, Kannada, Malayalam, Punjabi, Odia, Assamese, Urdu, Nepali, Sanskrit, Maithili, Konkani, Dogri, Sindhi, Kashmiri, Manipuri, Bodo, Santali | Sarvam AI |
| **European** (10) | Spanish, French, German, Italian, Portuguese, Dutch, Russian, Polish, Swedish, Turkish | Gemini |
| **East Asian** (3) | Japanese, Korean, Chinese | Gemini |
| **Other** (3) | Arabic, Thai, Vietnamese | Gemini |

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** 18+ 
- **npm** 9+
- **Python** 3.10+ (optional, for ML pipeline)

### 1. Clone & Install

```bash
git clone https://github.com/Sneha-1608/WordX.git
cd WordX
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your API keys:

```env
GEMINI_API_KEY=your_gemini_api_key_here
SARVAM_API_KEY=your_sarvam_api_key_here
MOCK_MODE=false    # Set to true for offline demo (no API calls)
PORT=3001
```

### 3. Start the Application

```bash
# Terminal 1 — Backend (port 3001)
npm run server

# Terminal 2 — Frontend (port 5173)
npm run dev
```

### 4. Open in Browser

Navigate to **http://localhost:5173** and start translating!

> **💡 Mock Mode:** Set `MOCK_MODE=true` in `.env` to run without API keys — uses realistic sample data for demo purposes.

---

## 📂 Project Structure

```
WordX/
├── server/                          # Backend (Layers 2–6)
│   ├── index.js                     # Express entrypoint & API gateway
│   ├── db.js                        # SQLite schema (14 tables) & migrations
│   ├── gemini.js                    # Gemini API client (translate, embed, validate)
│   ├── rag-engine.js                # Core RAG: TM lookup, glossary, style profiles
│   ├── llm-orchestrator.js          # Multi-model routing & batch translation
│   ├── sarvam.js                    # Sarvam AI (22 Indian languages)
│   ├── training-pipeline.js         # QLoRA training, A/B testing, deployment
│   ├── term-extractor.js            # Pre-translation term discovery
│   ├── flores-eval.js               # FLORES-200 quality benchmark
│   ├── middleware.js                # Rate limiter (15 RPM) & error handling
│   ├── parsers/
│   │   └── docx-structured.js       # Format-preserving DOCX parser
│   └── routes/
│       ├── parse.js                 # Document upload + TM processing
│       ├── translate.js             # Batch translation (SSE streaming)
│       ├── validate.js              # 5-point quality engine
│       ├── approve.js               # Segment approval + TM write
│       ├── export.js                # DOCX/PDF/TXT export
│       ├── analytics.js             # Dashboard metrics
│       └── training.js              # Training pipeline + SSE logs
├── src/                             # Frontend (Layer 1)
│   ├── App.jsx                      # Main app with wave background & navigation
│   ├── app/
│   │   ├── routes.tsx               # React Router configuration
│   │   ├── store.ts                 # Zustand stores
│   │   └── screens/
│   │       ├── Home.tsx             # Landing page
│   │       ├── DocumentUpload.tsx   # Drag-and-drop upload
│   │       ├── TranslationEditor.tsx # Side-by-side editor
│   │       ├── Validation.tsx       # Quality audit results
│   │       ├── Analytics.tsx        # Metrics dashboard
│   │       └── TrainingPipeline.tsx # Training management
│   └── components/                  # Reusable UI components
├── RAG/                             # Python RAG retrieval module
├── IndicTrans2/                     # IndicTrans2 model integration
├── IndicTransToolkit/               # AI4Bharat toolkit
├── data_seeds/                      # Seed TM data (EN→HI, EN→FR)
├── .env.example                     # Environment variable template
├── package.json                     # Node.js dependencies
├── requirements.txt                 # Python ML dependencies
└── vite.config.js                   # Vite build configuration
```

---

## 🔄 Translation Workflow

```
  📄 Upload Document (DOCX/PDF)
          │
          ▼
  🔍 Parse & Segment Text
          │
          ▼
  ⚡ Two-Pass TM Lookup
     ├── Pass 1: Exact string match (SQLite, ~0ms)
     └── Pass 2: Batch embed → Vector search (1 API call)
          │
          ▼
  🤖 LLM Translation
     ├── EXACT match → Use TM directly (₹0 cost)
     ├── FUZZY match → LLM refines with TM reference
     └── NEW → Full LLM translation + glossary injection
          │
          ▼
  ✅ Human Review & Approval
     └── Approved segments → Written back to TM
          │
          ▼
  📊 Quality Validation (5-point check)
          │
          ▼
  📥 Export (DOCX / PDF / TXT)
```

---

## 💰 Cost Model

| Match Type | Cost / Segment | Description |
|---|---|---|
| **EXACT** (TM ≥ 0.95) | ₹0 | Served from TM, no LLM call |
| **FUZZY** (TM 0.75–0.95) | ₹15 | LLM refines TM suggestion |
| **NEW** (no TM match) | ₹75 | Full LLM translation |
| Manual agency rate | ₹400 | Traditional vendor (baseline) |

> With 94% TM leverage → **~90% cost reduction** vs. agency rates.

---

## ⚡ Performance

| Operation | Before Optimization | After Optimization | Improvement |
|---|---|---|---|
| Backfill embeddings (200 records) | 40s | 0.4s | **99%** |
| Document parse TM lookup (50 segs) | 10s | 0.2s | **98%** |
| Batch translation TM lookup (50 segs) | 10s | 0.2s | **98%** |

---

## 📡 API Reference

<details>
<summary><strong>Core Translation APIs</strong></summary>

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/parse` | Upload & parse document |
| `POST` | `/api/translate` | Batch translate project |
| `POST` | `/api/validate` | 5-point quality validation |
| `POST` | `/api/approve` | Approve segment + write to TM |
| `POST` | `/api/export` | Export translated document |

</details>

<details>
<summary><strong>RAG & TM APIs</strong></summary>

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/rag/search` | Standalone TM search |
| `POST` | `/api/import-tm` | Import TMX/CSV |
| `GET` | `/api/tm-records/:language` | TM records with embeddings |

</details>

<details>
<summary><strong>Training Pipeline APIs</strong></summary>

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/training/extract` | Extract dataset from revisions |
| `POST` | `/api/training/start` | Start QLoRA training |
| `GET` | `/api/training/runs/:id/stream` | SSE training progress |
| `POST` | `/api/training/ab-test/:runId` | Run A/B evaluation |
| `POST` | `/api/training/deploy/:runId` | Deploy adapter |
| `POST` | `/api/training/rollback/:adapterId` | Rollback adapter |

</details>

<details>
<summary><strong>Analytics & Debug APIs</strong></summary>

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/analytics/dashboard` | Full dashboard data |
| `GET` | `/api/analytics/leverage` | TM leverage over time |
| `GET` | `/api/analytics/cost` | Cost savings analysis |
| `GET` | `/api/health` | System health check |
| `GET` | `/api/llm/stats` | LLM usage stats |

</details>

---

## 🧪 ML Pipeline (Advanced)

For training the QLoRA model locally:

```bash
# Install Python dependencies
pip install -r requirements.txt

# Build RAG index
python pipeline.py --mode setup --tm_data your_tm.json

# Fine-tune QLoRA + DPO
python pipeline.py --mode train --train_data your_train.json

# Translate
python pipeline.py --mode translate \
  --source "The authorized signatory must approve access." \
  --lang hi --domain legal

# Evaluate
python pipeline.py --mode eval --test_data your_test.json
```

---

## 👥 Team

**Team WordX** — Built for hackathon by passionate builders.

---

## 📄 License

This project is part of a hackathon submission. All rights reserved.

---

<p align="center">
  <sub>Built with ❤️ using React, Express, Gemini, and Sarvam AI</sub>
</p>
