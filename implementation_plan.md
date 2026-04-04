# ClearLingo — 4 Post-Hackathon Improvements Implementation Plan

## Overview

Implementing all 4 improvements from the `ClearLingo_Improvements_Prompt.md` guidelines. These are **additive** enhancements — existing functionality must not break.

## Implementation Order (per guidelines)

1. **Improvement 2** — FLORES-200 Multi-Language Benchmarking (pure backend, lowest risk)
2. **Improvement 1** — Sub-Segment Style Mapping in DOCX Parser (backend, feature-flagged)
3. **Improvement 4** — Real-Time Collaborative Editing with Socket.io (full-stack)
4. **Improvement 3** — Redis + pgvector Hybrid Storage (infrastructure, feature-flagged)

---

## Proposed Changes

### Improvement 2: FLORES-200 Multi-Language Benchmarking

#### [NEW] [flores_indian_languages.json](file:///d:/Codes/Hackathon/data_seeds/flores_indian_languages.json)
- Structured seed data with 20+ sentence pairs for Hindi, and placeholder entries for all other Indian languages (bn, ta, te, mr, gu, kn, ml, pa, or, as, ur)

#### [MODIFY] [flores-eval.js](file:///d:/Codes/Hackathon/server/flores-eval.js)
- Refactor from hardcoded EN→HI to dynamic multi-language evaluation
- Add `runFloresEval(langCode, options)` and `runFullFloresEval(options)` functions
- Keep `runAutomatedQualityCheck()` intact for backward compat
- Add proper BLEU-1 computation

#### [MODIFY] [training.js](file:///d:/Codes/Hackathon/server/routes/training.js)
- Add `GET /flores-eval/:langCode` (SSE streaming single-language eval)
- Add `POST /flores-eval/full` (SSE streaming all-language eval)

---

### Improvement 1: Sub-Segment Style Mapping

#### [NEW] [run-aligner.js](file:///d:/Codes/Hackathon/server/parsers/run-aligner.js)
- Gemini-based alignment of translated text to source XML runs
- Graceful fallback to single-run on failure

#### [MODIFY] [docx-structured.js](file:///d:/Codes/Hackathon/server/parsers/docx-structured.js)
- Add `extractRunMap()` helper function
- Add `buildAlignedRuns()` async function for multi-run DOCX reconstruction

#### [MODIFY] [export.js](file:///d:/Codes/Hackathon/server/routes/export.js)
- Add `preserveInlineFormatting` option to request body
- Use `alignTranslationToRuns()` when runs metadata contains mixed formatting
- Gate behind feature flag for performance

---

### Improvement 4: Real-Time Collaboration (Socket.io)

#### [NEW] [collab-manager.js](file:///d:/Codes/Hackathon/server/collab-manager.js)
- In-memory collaboration state: rooms, users, segment locks
- Functions: `joinRoom`, `leaveRoom`, `lockSegment`, `unlockSegment`, `getPresenceSnapshot`, `isSegmentLocked`

#### [NEW] [useCollaboration.ts](file:///d:/Codes/Hackathon/src/app/hooks/useCollaboration.ts)
- React hook wrapping Socket.io client
- Handles: presence, segment locking, text/status broadcasts

#### [MODIFY] [index.js](file:///d:/Codes/Hackathon/server/index.js)
- Upgrade Express to HTTP server with Socket.io
- Register all collaboration event handlers
- Export `io` for route usage

#### [MODIFY] [approve.js](file:///d:/Codes/Hackathon/server/routes/approve.js)
- Broadcast `segment_status_changed` via Socket.io after DB writes

#### [MODIFY] [store.ts](file:///d:/Codes/Hackathon/src/app/store.ts)
- Add `updateSegmentTarget` action for real-time text sync

#### [MODIFY] [TranslationEditor.tsx](file:///d:/Codes/Hackathon/src/app/screens/TranslationEditor.tsx)
- Integrate `useCollaboration` hook
- Add presence bar, segment locking UI, real-time text/status sync

---

### Improvement 3: Redis + pgvector Hybrid Storage

#### [NEW] [cache-redis.js](file:///d:/Codes/Hackathon/server/cache-redis.js)
- Redis cache wrapper with TTL, graceful fallback

#### [NEW] [vector-pg.js](file:///d:/Codes/Hackathon/server/vector-pg.js)
- pgvector operations: init, upsert, ANN search

#### [NEW] [migrate-to-pgvector.js](file:///d:/Codes/Hackathon/server/scripts/migrate-to-pgvector.js)
- One-time migration script from SQLite embeddings to pgvector

#### [MODIFY] [.env](file:///d:/Codes/Hackathon/.env) & [.env.example](file:///d:/Codes/Hackathon/.env.example)
- Add Redis, Postgres, and feature flag variables

#### [MODIFY] [rag-engine.js](file:///d:/Codes/Hackathon/server/rag-engine.js)
- Add pgvector fast-path before SQLite cosine similarity loop

#### [MODIFY] [llm-orchestrator.js](file:///d:/Codes/Hackathon/server/llm-orchestrator.js)
- Add Redis cache fast-path before SQLite cache lookup

#### [MODIFY] [index.js](file:///d:/Codes/Hackathon/server/index.js)
- Add Redis/pgvector health status to `/api/health`

#### [MODIFY] [package.json](file:///d:/Codes/Hackathon/package.json)
- Add `ioredis`, `pg`, `pgvector`, `socket.io`, `socket.io-client` dependencies
- Add `migrate:pgvector` script

---

## User Review Required

> [!IMPORTANT]
> All 4 improvements use **feature flags** — nothing is forced on. Redis/pgvector default to `false`, run alignment is gated, Socket.io coexists with the existing HTTP server.

> [!WARNING]
> **Improvement 3 (Redis + pgvector)** requires external services to be running before enabling. The feature flags (`USE_REDIS_CACHE=false`, `USE_PGVECTOR=false`) keep the app on SQLite by default.

## Verification Plan

### Automated Tests
- `npm run server` — Verify server starts without errors after each improvement
- `npm run dev` — Verify frontend builds without TypeScript errors

### Manual Verification
- Test each acceptance criteria listed in the guidelines for each improvement
- Verify backward compatibility with existing API endpoints
