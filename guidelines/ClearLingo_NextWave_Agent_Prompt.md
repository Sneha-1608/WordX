# ClearLingo — Next-Wave Improvements: Agent Implementation Prompt
# 7 Production Enhancements (No Auth/RBAC)

> **For the AI Agent:** Read this entire document before writing a single line of code.
> Before implementing ANY UI component or frontend screen, read the skill at:
> `/mnt/skills/public/frontend-design/SKILL.md`
> This skill defines the design philosophy — follow it exactly for all React/TSX work.
> Before creating any file or document output, check `/mnt/skills/public/` for a relevant skill.
Also use any other useful skill avalible to u in .agent folder
---

## BRIEFING: What ClearLingo Is

ClearLingo is a full-stack AI-powered Computer-Assisted Translation (CAT) platform.

**Tech Stack:**
- Frontend: React 18 + Vite 6.3 + Tailwind CSS 4 + Zustand + Radix UI + Framer Motion + Recharts
- Backend: Node.js (ESM modules — use `import/export` everywhere, NO `require()`) + Express 5
- Database: better-sqlite3 (WAL mode, 14-table schema in `server/db.js`)
- AI: Google Gemini 2.0 Flash + Sarvam AI
- Already installed in previous sprint: Socket.io, ioredis, pg, pgvector

**Project Root:** `d:\Codes\Hackathon\`

**Non-Negotiable Rules:**
1. All backend files use ESM (`import`/`export`). No `require()`.
2. All new DB columns use `addColumnIfNotExists()` — never drop/rename existing columns.
3. Every new feature must fail gracefully — if it errors, the existing translation pipeline must still work.
4. The `MOCK_MODE=true` env var enables offline demo mode — new features must no-op cleanly when mock mode is active.
5. Existing API contracts for `/api/translate`, `/api/parse`, `/api/approve`, `/api/export`, `/api/segments/:projectId` must not change signatures.

---

## Implementation Order

Implement strictly in this sequence to manage dependency risk:

1. **Improvement 5** — Incremental SSE Streaming Translation (backend only, highest UX ROI)
2. **Improvement 7** — Auto-Propagation of Identical Segments (backend only, ~20 lines)
3. **Improvement 8** — Audit Trail & Revision History per Segment (backend + small UI)
4. **Improvement 6** — TMX/XLIFF Export (backend only, XML generation)
5. **Improvement 3** — Per-Language-Pair Analytics (backend + Recharts UI)
6. **Improvement 4** — In-Context DOCX Preview (full-stack, most complex UI)
7. **Improvement 1** — CMS Webhook / API Connector Layer (backend only)

---

---

# IMPROVEMENT 5: Incremental SSE Streaming Translation

## Problem

`POST /api/translate` currently blocks until ALL segments are translated and returns them all at once. For a 100-segment document, the user stares at a spinner for 30–60 seconds. TM EXACT hits (which take ~2ms) are held back waiting for the slowest LLM call.

## Goal

Convert the batch translation endpoint into a **Server-Sent Events (SSE) stream**. Each segment result is emitted to the client as soon as it is ready. The frontend renders segments progressively — TM hits appear immediately, LLM segments trickle in as they complete.

---

## Backend Changes

### Step 1 — Add a new streaming endpoint in `server/routes/translate.js`

Keep the existing `POST /api/translate` endpoint UNCHANGED (backward compat). Add a NEW endpoint alongside it:

```javascript
// POST /api/translate/stream
// Body: same as /api/translate — { projectId, segments, targetLang, sourceLang, styleProfile, context }
// Response: text/event-stream

router.post("/stream", async (req, res) => {
  // Set SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering if behind proxy
  res.flushHeaders(); // send headers immediately

  const { projectId, segments, targetLang, sourceLang, styleProfile, context } = req.body;

  if (!segments || !Array.isArray(segments)) {
    res.write(`data: ${JSON.stringify({ type: "error", message: "segments array required" })}\n\n`);
    return res.end();
  }

  // Emit a start event with total count
  res.write(`data: ${JSON.stringify({ type: "start", total: segments.length })}\n\n`);

  let completed = 0;
  const errors = [];

  // Process segments CONCURRENTLY with a concurrency limit of 5
  // Use a simple semaphore pattern so we don't hammer the LLM rate limiter
  const CONCURRENCY = 5;
  const queue = [...segments];
  let active = 0;

  await new Promise((resolve) => {
    function processNext() {
      while (active < CONCURRENCY && queue.length > 0) {
        const segment = queue.shift();
        active++;

        translateSegment(segment, { targetLang, sourceLang, styleProfile, context, projectId })
          .then((result) => {
            completed++;
            // Emit each result as it completes
            res.write(`data: ${JSON.stringify({
              type: "segment_done",
              segmentId: segment.id,
              idx: segment.idx,
              translatedText: result.translatedText,
              matchType: result.matchType,
              tmScore: result.tmScore ?? null,
              model: result.model ?? null,
              cost: result.cost ?? 0,
              current: completed,
              total: segments.length,
            })}\n\n`);
          })
          .catch((err) => {
            completed++;
            errors.push({ segmentId: segment.id, error: err.message });
            res.write(`data: ${JSON.stringify({
              type: "segment_error",
              segmentId: segment.id,
              idx: segment.idx,
              error: err.message,
              current: completed,
              total: segments.length,
            })}\n\n`);
          })
          .finally(() => {
            active--;
            processNext();
            if (active === 0 && queue.length === 0) resolve();
          });
      }
    }
    processNext();
  });

  // Emit completion summary
  res.write(`data: ${JSON.stringify({
    type: "complete",
    total: segments.length,
    errors: errors.length,
    errorDetails: errors,
  })}\n\n`);

  res.end();
});
```

The `translateSegment()` function referenced above is the existing per-segment translation logic already in `translate.js` — extract it into a named async function if it isn't already.

---

## Frontend Changes

### Step 2 — Update the translation trigger in TranslationEditor.tsx

**Before touching any code, read `/mnt/skills/public/frontend-design/SKILL.md` for UI design guidance.**

In `TranslationEditor.tsx`, find where `POST /api/translate` is called. Replace it with a streaming fetch to `POST /api/translate/stream` using the browser's `ReadableStream` / `EventSource`-style reader:

```typescript
async function translateWithStreaming(payload: TranslatePayload) {
  setIsTranslating(true);
  setTranslationProgress({ current: 0, total: payload.segments.length });

  const response = await fetch("/api/translate/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.body) throw new Error("No response body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const event = JSON.parse(line.slice(6));
        handleStreamEvent(event);
      } catch {
        // malformed chunk, skip
      }
    }
  }

  setIsTranslating(false);
}

function handleStreamEvent(event: StreamEvent) {
  switch (event.type) {
    case "start":
      setTranslationProgress({ current: 0, total: event.total });
      break;
    case "segment_done":
      // Update this specific segment in Zustand store immediately
      updateSegmentTranslation(event.segmentId, {
        target_text: event.translatedText,
        match_type: event.matchType,
        tm_score: event.tmScore,
        status: "PENDING",
      });
      setTranslationProgress(prev => ({ ...prev, current: event.current }));
      break;
    case "segment_error":
      markSegmentError(event.segmentId, event.error);
      setTranslationProgress(prev => ({ ...prev, current: event.current }));
      break;
    case "complete":
      setTranslationProgress({ current: event.total, total: event.total });
      break;
  }
}
```

### Step 3 — Add a live progress bar UI component

Replace the existing full-screen loading spinner during translation with an **inline progress bar** at the top of the segment list:

```tsx
{isTranslating && (
  <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b px-6 py-3">
    <div className="flex items-center justify-between mb-2">
      <span className="text-sm font-medium">
        Translating… {translationProgress.current} / {translationProgress.total} segments
      </span>
      <span className="text-xs text-muted-foreground">
        {Math.round((translationProgress.current / translationProgress.total) * 100)}%
      </span>
    </div>
    <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
      <div
        className="h-full bg-primary transition-all duration-300 ease-out rounded-full"
        style={{ width: `${(translationProgress.current / translationProgress.total) * 100}%` }}
      />
    </div>
  </div>
)}
```

Segments that have arrived should be rendered and interactable immediately — the user should be able to approve TM hits while LLM segments are still processing.

### Step 4 — Add to Zustand store

In `src/app/store.ts`, add these actions to `useAppStore`:

```typescript
updateSegmentTranslation: (segmentId: string, data: Partial<Segment>) =>
  set((state) => ({
    segments: state.segments.map((s) =>
      s.id === segmentId ? { ...s, ...data } : s
    ),
  })),

markSegmentError: (segmentId: string, error: string) =>
  set((state) => ({
    segments: state.segments.map((s) =>
      s.id === segmentId ? { ...s, translationError: error } : s
    ),
  })),

setTranslationProgress: (progress: { current: number; total: number } | ((prev: any) => any)) =>
  set((state) => ({
    translationProgress: typeof progress === "function"
      ? progress(state.translationProgress)
      : progress,
  })),
```

### Acceptance Criteria
- [ ] Uploading a 50-segment document shows segments appearing one-by-one rather than all at once
- [ ] EXACT TM hits appear within 1 second — before LLM segments arrive
- [ ] User can approve already-arrived segments while translation is still in progress
- [ ] Progress bar shows accurate `X / Y segments` count
- [ ] Old `POST /api/translate` still works unchanged (no regression)
- [ ] If the SSE connection drops mid-stream, an error toast appears and the partial results are preserved

---

---

# IMPROVEMENT 7: Auto-Propagation of Identical Segments

## Problem

If a document has 5 occurrences of "Please sign here." and the translator approves segment 3, segments 7, 14, 22, and 41 still show as PENDING with identical source text. The translator has to approve each one manually.

## Goal

When a segment is approved and written to the TM, automatically find all other segments in the same project with the same source text, set their `target_text` and `status` to the approved values, and broadcast the changes via Socket.io.

---

## Backend Changes

### Step 1 — Modify `server/routes/approve.js`

After the existing approval DB write, add:

```javascript
import { io } from "../index.js";

// After: db.prepare("UPDATE segments SET status=?, target_text=? WHERE id=?").run(...)
// Add auto-propagation:

const approvedSegment = db.prepare("SELECT * FROM segments WHERE id = ?").get(segmentId);

if (approvedSegment && approvedSegment.status === "APPROVED") {
  // Find all other PENDING segments in this project with identical source text
  const identicalSegments = db.prepare(`
    SELECT id FROM segments
    WHERE project_id = ?
      AND source_text = ?
      AND id != ?
      AND status = 'PENDING'
  `).all(approvedSegment.project_id, approvedSegment.source_text, segmentId);

  if (identicalSegments.length > 0) {
    const propagateStmt = db.prepare(`
      UPDATE segments
      SET target_text = ?,
          status = 'APPROVED',
          match_type = 'PROPAGATED',
          tm_score = 1.0
      WHERE id = ?
    `);

    const propagated = [];
    for (const seg of identicalSegments) {
      propagateStmt.run(approvedSegment.target_text, seg.id);
      propagated.push(seg.id);
    }

    // Broadcast propagated approvals to all connected clients in this project
    if (io) {
      io.to(`project:${approvedSegment.project_id}`).emit("segments_propagated", {
        sourceSegmentId: segmentId,
        propagatedIds: propagated,
        targetText: approvedSegment.target_text,
        status: "APPROVED",
      });
    }

    // Include propagation info in the HTTP response
    res.json({
      ...existingResponse,
      propagated: {
        count: propagated.length,
        segmentIds: propagated,
      },
    });
    return; // exit early, response already sent
  }
}
```

### Step 2 — Add `PROPAGATED` as a valid match_type

In `server/db.js`, in the schema or migration section, ensure `match_type` accepts `'PROPAGATED'` — if there's a CHECK constraint, update it. If not, no change needed.

### Step 3 — Frontend: Handle propagation Socket.io event

In `TranslationEditor.tsx`, inside the `useCollaboration` hook integration (or directly in the Socket.io event handlers), add:

```typescript
socket.on("segments_propagated", ({ propagatedIds, targetText, status }) => {
  // Update all propagated segments in Zustand store
  propagatedIds.forEach((segId: string) => {
    updateSegmentTranslation(segId, {
      target_text: targetText,
      status: "APPROVED",
      match_type: "PROPAGATED",
    });
  });

  // Show a toast notification
  toast.success(`Auto-propagated to ${propagatedIds.length} identical segment${propagatedIds.length > 1 ? "s" : ""}`);
});
```

### Step 4 — Visual indicator for propagated segments

In `SegmentRow.tsx` (or wherever the match type badge is rendered), add a new badge variant for `PROPAGATED`:

```tsx
// In the match type badge logic, add:
case "PROPAGATED":
  return <Badge variant="outline" className="text-purple-600 border-purple-300 bg-purple-50">⟳ Propagated</Badge>;
```

### Acceptance Criteria
- [ ] Document with 3 occurrences of "Introduction" — approving one auto-approves the other two
- [ ] Toast confirms how many segments were propagated
- [ ] Propagated segments show the "⟳ Propagated" badge
- [ ] In a 2-browser collab session, the second browser sees propagation in real time
- [ ] Segments that are already APPROVED or REJECTED are NOT overwritten by propagation
- [ ] Response body of `POST /api/approve` includes `propagated: { count, segmentIds }`

---

---

# IMPROVEMENT 8: Audit Trail & Revision History per Segment

## Problem

The `revisions` table already logs human corrections, but there is no API to retrieve the history for a specific segment, and no UI to view it. Enterprise clients and QA managers need to see the full edit chain: what the AI originally produced → what a human changed it to → when it was approved.

## Goal

Add a segment history API endpoint and a slide-in history drawer in the Translation Editor, showing the full timeline of changes for any segment.

---

## Backend Changes

### Step 1 — Add history endpoint in `server/index.js` or a new route file

```javascript
// GET /api/segments/:segmentId/history
// Returns the full revision history for a segment, ordered chronologically

app.get("/api/segments/:segmentId/history", (req, res) => {
  const { segmentId } = req.params;

  // Get the base segment info
  const segment = db.prepare(`
    SELECT s.id, s.source_text, s.original_target, s.target_text, s.status,
           s.match_type, s.tm_score, s.created_at, s.updated_at
    FROM segments s
    WHERE s.id = ?
  `).get(segmentId);

  if (!segment) {
    return res.status(404).json({ error: "Segment not found" });
  }

  // Get all revisions for this segment
  const revisions = db.prepare(`
    SELECT id, source_text, original_output, human_revision,
           edit_distance, created_at
    FROM revisions
    WHERE segment_id = ?
    ORDER BY created_at ASC
  `).all(segmentId);

  // Build a timeline: start with the AI output, then each human revision
  const timeline = [];

  // First entry: original AI/TM output
  timeline.push({
    type: "AI_OUTPUT",
    label: segment.match_type === "EXACT" ? "TM Exact Match" :
           segment.match_type === "FUZZY" ? "TM Fuzzy Match (LLM refined)" :
           segment.match_type === "PROPAGATED" ? "Auto-Propagated" : "LLM Translation",
    text: segment.original_target,
    timestamp: segment.created_at,
    editDistance: null,
  });

  // Add each human revision
  for (const rev of revisions) {
    timeline.push({
      type: "HUMAN_EDIT",
      label: "Human Revision",
      text: rev.human_revision,
      previousText: rev.original_output,
      editDistance: rev.edit_distance,
      timestamp: rev.created_at,
    });
  }

  // Final approved state (if different from last revision)
  if (segment.status === "APPROVED") {
    const lastText = revisions.length > 0
      ? revisions[revisions.length - 1].human_revision
      : segment.original_target;

    if (lastText !== segment.target_text) {
      timeline.push({
        type: "APPROVED",
        label: "Approved",
        text: segment.target_text,
        timestamp: segment.updated_at,
      });
    } else {
      // Mark the last entry as approved
      if (timeline.length > 0) {
        timeline[timeline.length - 1].approved = true;
        timeline[timeline.length - 1].approvedAt = segment.updated_at;
      }
    }
  }

  res.json({
    segmentId,
    sourceText: segment.source_text,
    currentText: segment.target_text,
    status: segment.status,
    totalEdits: revisions.length,
    timeline,
  });
});
```

### Step 2 — Ensure `created_at` and `updated_at` columns exist on `segments`

In `server/db.js`, add these if they don't already exist using `addColumnIfNotExists()`:

```javascript
addColumnIfNotExists("segments", "created_at", "TEXT DEFAULT (datetime('now'))");
addColumnIfNotExists("segments", "updated_at", "TEXT DEFAULT (datetime('now'))");
```

Also update the approve route to set `updated_at`:

```javascript
db.prepare("UPDATE segments SET status=?, target_text=?, updated_at=datetime('now') WHERE id=?")
  .run(status, targetText, segmentId);
```

---

## Frontend Changes

**Before writing any UI, read `/mnt/skills/public/frontend-design/SKILL.md`.**

### Step 3 — Create `src/app/components/SegmentHistoryDrawer.tsx`

Use Radix UI `Sheet` (slide-in drawer from the right) to show the history timeline:

```tsx
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@radix-ui/react-dialog"; // or the existing Radix Sheet component
import { useState, useEffect } from "react";

interface HistoryEntry {
  type: "AI_OUTPUT" | "HUMAN_EDIT" | "APPROVED";
  label: string;
  text: string;
  previousText?: string;
  editDistance?: number | null;
  timestamp: string;
  approved?: boolean;
}

interface SegmentHistoryDrawerProps {
  segmentId: string | null;  // null = closed
  sourceText: string;
  onClose: () => void;
}

export function SegmentHistoryDrawer({ segmentId, sourceText, onClose }: SegmentHistoryDrawerProps) {
  const [history, setHistory] = useState<{ timeline: HistoryEntry[]; totalEdits: number } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!segmentId) return;
    setLoading(true);
    fetch(`/api/segments/${segmentId}/history`)
      .then(r => r.json())
      .then(data => { setHistory(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [segmentId]);

  return (
    <Sheet open={!!segmentId} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-[480px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Segment History</SheetTitle>
          <p className="text-sm text-muted-foreground mt-1 font-mono bg-muted px-2 py-1 rounded">
            {sourceText}
          </p>
        </SheetHeader>

        {loading && <div className="py-8 text-center text-muted-foreground">Loading history…</div>}

        {history && (
          <div className="mt-6 relative">
            {/* Vertical timeline line */}
            <div className="absolute left-4 top-0 bottom-0 w-px bg-border" />

            <div className="space-y-6 pl-10">
              {history.timeline.map((entry, i) => (
                <div key={i} className="relative">
                  {/* Timeline dot */}
                  <div className={`absolute -left-[26px] w-3 h-3 rounded-full border-2 ${
                    entry.type === "AI_OUTPUT" ? "bg-blue-500 border-blue-300" :
                    entry.type === "HUMAN_EDIT" ? "bg-amber-500 border-amber-300" :
                    "bg-green-500 border-green-300"
                  }`} />

                  <div className="bg-card border rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        entry.type === "AI_OUTPUT" ? "bg-blue-100 text-blue-700" :
                        entry.type === "HUMAN_EDIT" ? "bg-amber-100 text-amber-700" :
                        "bg-green-100 text-green-700"
                      }`}>
                        {entry.label}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(entry.timestamp).toLocaleString()}
                      </span>
                    </div>

                    <p className="text-sm">{entry.text}</p>

                    {entry.editDistance != null && (
                      <p className="text-xs text-muted-foreground">
                        Edit distance from previous: <span className="font-mono">{entry.editDistance}</span>
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <p className="mt-6 text-xs text-muted-foreground text-center">
              {history.totalEdits} human edit{history.totalEdits !== 1 ? "s" : ""} recorded
            </p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
```

### Step 4 — Add history button to each segment row

In `SegmentRow.tsx` (or wherever the approve/reject buttons are rendered), add a small history icon button:

```tsx
import { History } from "lucide-react";

// In the segment action buttons area:
<button
  onClick={() => onOpenHistory(segment.id, segment.source_text)}
  className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
  title="View segment history"
>
  <History className="w-3.5 h-3.5" />
</button>
```

In `TranslationEditor.tsx`, add state for the history drawer:

```typescript
const [historyDrawer, setHistoryDrawer] = useState<{ segmentId: string; sourceText: string } | null>(null);

// Pass to each segment row:
onOpenHistory={(segmentId, sourceText) => setHistoryDrawer({ segmentId, sourceText })}

// Render the drawer once at the bottom of the editor:
<SegmentHistoryDrawer
  segmentId={historyDrawer?.segmentId ?? null}
  sourceText={historyDrawer?.sourceText ?? ""}
  onClose={() => setHistoryDrawer(null)}
/>
```

### Acceptance Criteria
- [ ] `GET /api/segments/:segmentId/history` returns a timeline array with correct ordering
- [ ] Clicking the history icon on any segment opens the drawer
- [ ] AI_OUTPUT entry always appears first (blue dot)
- [ ] Human edits appear in chronological order (amber dots)
- [ ] Edit distance is shown for each human revision
- [ ] A segment with no human edits shows only the AI_OUTPUT entry
- [ ] Drawer closes cleanly and the editor remains fully usable

---

---

# IMPROVEMENT 6: TMX/XLIFF Export (Industry Standard Interoperability)

## Problem

ClearLingo can import TMX/CSV files but cannot export its Translation Memory in standard formats. This means the TM is trapped inside the platform. Enterprise clients expect to be able to take their translation assets and use them in other tools (Trados, MemoQ, DeepL, etc.).

## Goal

Add two export endpoints:
1. `GET /api/export/tmx/:langPair` — exports `tm_records` as TMX 1.4b XML
2. `GET /api/export/xliff/:projectId` — exports a project's segments as XLIFF 1.2 XML (standard bilingual exchange format)

---

## Backend Changes

### Step 1 — Create `server/routes/export-tm.js`

```javascript
// server/routes/export-tm.js
import { Router } from "express";
import { getDb } from "../db.js";

const router = Router();

/**
 * Generate valid TMX 1.4b XML string from an array of TM records.
 */
function buildTMX(records, sourceLang, targetLang) {
  const escape = (str) => String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  const tus = records.map(r => `
    <tu creationdate="${new Date(r.approved_at ?? Date.now()).toISOString().replace(/[-:]/g, "").slice(0, 15)}Z">
      <tuv xml:lang="${escape(sourceLang.toUpperCase())}">
        <seg>${escape(r.source_text)}</seg>
      </tuv>
      <tuv xml:lang="${escape(targetLang.toUpperCase())}">
        <seg>${escape(r.target_text)}</seg>
      </tuv>
    </tu>`).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE tmx SYSTEM "tmx14.dtd">
<tmx version="1.4">
  <header
    creationtool="ClearLingo"
    creationtoolversion="1.0"
    datatype="plaintext"
    segtype="sentence"
    adminlang="en-US"
    srclang="${escape(sourceLang.toUpperCase())}"
    o-tmf="ClearLingo TM"
  />
  <body>
${tus}
  </body>
</tmx>`;
}

/**
 * Generate valid XLIFF 1.2 XML string from an array of project segments.
 */
function buildXLIFF(segments, sourceLang, targetLang, projectName) {
  const escape = (str) => String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  const units = segments.map((s, i) => `
    <trans-unit id="${escape(s.id)}" resname="segment_${i + 1}">
      <source xml:lang="${escape(sourceLang)}">${escape(s.source_text)}</source>
      <target xml:lang="${escape(targetLang)}" state="${
        s.status === "APPROVED" ? "final" :
        s.status === "REJECTED" ? "needs-review-translation" : "translated"
      }">${escape(s.target_text ?? "")}</target>
      <note>match_type: ${escape(s.match_type)} | tm_score: ${s.tm_score ?? "N/A"}</note>
    </trans-unit>`).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">
  <file
    source-language="${escape(sourceLang)}"
    target-language="${escape(targetLang)}"
    datatype="plaintext"
    original="${escape(projectName)}"
    tool-id="clearlingo"
    date="${new Date().toISOString()}"
  >
    <header>
      <tool tool-id="clearlingo" tool-name="ClearLingo" tool-version="1.0"/>
    </header>
    <body>
${units}
    </body>
  </file>
</xliff>`;
}

// GET /api/export-tm/tmx/:sourceLang/:targetLang
// Downloads all TM records for this language pair as TMX 1.4b
router.get("/tmx/:sourceLang/:targetLang", (req, res) => {
  const { sourceLang, targetLang } = req.params;
  const db = getDb();

  const records = db.prepare(`
    SELECT source_text, target_text, approved_at
    FROM tm_records
    WHERE source_lang = ? AND target_lang = ?
    ORDER BY approved_at DESC
  `).all(sourceLang, targetLang);

  if (records.length === 0) {
    return res.status(404).json({
      error: `No TM records found for ${sourceLang} → ${targetLang}`
    });
  }

  const tmx = buildTMX(records, sourceLang, targetLang);
  const filename = `clearlingo_tm_${sourceLang}_${targetLang}_${Date.now()}.tmx`;

  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(tmx);
});

// GET /api/export-tm/xliff/:projectId
// Downloads all segments for a project as XLIFF 1.2
router.get("/xliff/:projectId", (req, res) => {
  const { projectId } = req.params;
  const db = getDb();

  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId);
  if (!project) return res.status(404).json({ error: "Project not found" });

  const segments = db.prepare(`
    SELECT id, source_text, target_text, status, match_type, tm_score, idx
    FROM segments
    WHERE project_id = ?
    ORDER BY idx ASC
  `).all(projectId);

  const xliff = buildXLIFF(
    segments,
    project.source_language,
    project.target_language,
    project.name
  );

  const filename = `${project.name.replace(/\s+/g, "_")}_${Date.now()}.xliff`;

  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(xliff);
});

export default router;
```

### Step 2 — Mount the router in `server/index.js`

```javascript
import exportTmRoutes from "./routes/export-tm.js";
app.use("/api/export-tm", exportTmRoutes);
```

### Step 3 — Add export buttons to the Analytics screen and Translation Editor

**Read `/mnt/skills/public/frontend-design/SKILL.md` before writing any UI.**

In `src/app/screens/Analytics.tsx`, find the TM records section. Add two download buttons:

```tsx
// TMX Export button — for each language pair shown in analytics
<a
  href={`/api/export-tm/tmx/${sourceLang}/${targetLang}`}
  download
  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-md hover:bg-muted transition-colors"
>
  <Download className="w-3.5 h-3.5" />
  Export TMX
</a>
```

In `TranslationEditor.tsx`, in the project header/toolbar area, add:

```tsx
<a
  href={`/api/export-tm/xliff/${currentProject?.id}`}
  download
  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-md hover:bg-muted"
>
  <FileCode className="w-3.5 h-3.5" />
  Export XLIFF
</a>
```

### Acceptance Criteria
- [ ] `GET /api/export-tm/tmx/en/hi` downloads a valid `.tmx` file that opens in a text editor without XML parse errors
- [ ] `GET /api/export-tm/xliff/:projectId` downloads a valid `.xliff` file
- [ ] TMX file contains correct `<header>` with `srclang` attribute
- [ ] XLIFF `state` attribute is `"final"` for APPROVED segments, `"translated"` for PENDING
- [ ] Special characters (`&`, `<`, `>`) are properly escaped in the XML output
- [ ] Empty TM pair returns 404 with a helpful message, not a broken XML file
- [ ] Download triggers a real browser file download (not opens in tab)

---

---

# IMPROVEMENT 3: Per-Language-Pair Analytics

## Problem

The Analytics dashboard shows aggregate TM leverage, cost savings, and segment velocity across the entire platform. There is no way to drill down by language pair or by project. A PM managing 5 projects across 8 language pairs has no visibility into which specific combinations are underperforming.

## Goal

Add a new "Language Pairs" tab to the Analytics screen with:
- A summary table of all active language pairs and their performance metrics
- A drill-down view for any selected language pair showing per-project breakdown
- A Recharts bar chart comparing BLEU score / TM leverage across language pairs

---

## Backend Changes

### Step 1 — Add analytics endpoint in `server/routes/analytics.js`

```javascript
// GET /api/analytics/language-pairs
// Returns aggregated metrics grouped by source_lang → target_lang

router.get("/language-pairs", (req, res) => {
  const db = getDb();

  const pairs = db.prepare(`
    SELECT
      p.source_language   AS sourceLang,
      p.target_language   AS targetLang,
      COUNT(DISTINCT p.id)                  AS projectCount,
      COUNT(s.id)                           AS totalSegments,
      SUM(CASE WHEN s.status = 'APPROVED' THEN 1 ELSE 0 END)  AS approvedSegments,
      SUM(CASE WHEN s.match_type = 'EXACT' THEN 1 ELSE 0 END) AS exactMatches,
      SUM(CASE WHEN s.match_type = 'FUZZY' THEN 1 ELSE 0 END) AS fuzzyMatches,
      SUM(CASE WHEN s.match_type = 'NEW' THEN 1 ELSE 0 END)   AS newTranslations,
      AVG(CASE WHEN s.tm_score IS NOT NULL THEN s.tm_score ELSE NULL END) AS avgTmScore,
      COUNT(DISTINCT tm.id)                 AS tmRecordCount
    FROM projects p
    LEFT JOIN segments s ON s.project_id = p.id
    LEFT JOIN tm_records tm ON tm.source_lang = p.source_language AND tm.target_lang = p.target_language
    GROUP BY p.source_language, p.target_language
    ORDER BY totalSegments DESC
  `).all();

  // Compute derived metrics
  const enriched = pairs.map(pair => ({
    ...pair,
    tmLeverageRate: pair.totalSegments > 0
      ? parseFloat(((pair.exactMatches + pair.fuzzyMatches) / pair.totalSegments * 100).toFixed(1))
      : 0,
    approvalRate: pair.totalSegments > 0
      ? parseFloat((pair.approvedSegments / pair.totalSegments * 100).toFixed(1))
      : 0,
    estimatedCostSavingsPct: pair.totalSegments > 0
      ? parseFloat(((pair.exactMatches * 400 + pair.fuzzyMatches * 360) /
          (pair.totalSegments * 400) * 100).toFixed(1))
      : 0,
  }));

  res.json(enriched);
});

// GET /api/analytics/language-pairs/:sourceLang/:targetLang/projects
// Per-project breakdown for a specific language pair

router.get("/language-pairs/:sourceLang/:targetLang/projects", (req, res) => {
  const { sourceLang, targetLang } = req.params;
  const db = getDb();

  const projects = db.prepare(`
    SELECT
      p.id, p.name, p.created_at,
      COUNT(s.id)                                               AS totalSegments,
      SUM(CASE WHEN s.status = 'APPROVED' THEN 1 ELSE 0 END)   AS approvedSegments,
      SUM(CASE WHEN s.match_type = 'EXACT' THEN 1 ELSE 0 END)  AS exactMatches,
      SUM(CASE WHEN s.match_type = 'FUZZY' THEN 1 ELSE 0 END)  AS fuzzyMatches,
      SUM(CASE WHEN s.match_type = 'NEW' THEN 1 ELSE 0 END)    AS newTranslations
    FROM projects p
    LEFT JOIN segments s ON s.project_id = p.id
    WHERE p.source_language = ? AND p.target_language = ?
    GROUP BY p.id
    ORDER BY p.created_at DESC
  `).all(sourceLang, targetLang);

  res.json(projects);
});
```

---

## Frontend Changes

**Before writing any UI, read `/mnt/skills/public/frontend-design/SKILL.md`.**

### Step 2 — Add "Language Pairs" tab to `Analytics.tsx`

The existing Analytics screen has tabs (look for a Radix `Tabs` component or a custom tab switcher). Add a new tab called "Language Pairs".

The tab content should have:

**Section A — Summary Table**

A styled table with columns:
| Language Pair | Projects | Segments | TM Leverage | Approval Rate | TM Records | Cost Savings |
|---|---|---|---|---|---|---|

Each row is clickable — clicking drills into that pair.

**Section B — Recharts Bar Chart**

A grouped bar chart using Recharts `BarChart` comparing all language pairs on:
- TM Leverage Rate (%)
- Approval Rate (%)

```tsx
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

// Data: array of { name: "EN→HI", tmLeverage: 94, approvalRate: 87 }
const chartData = languagePairs.map(p => ({
  name: `${p.sourceLang.toUpperCase()}→${p.targetLang.toUpperCase()}`,
  "TM Leverage": p.tmLeverageRate,
  "Approval Rate": p.approvalRate,
}));

<ResponsiveContainer width="100%" height={300}>
  <BarChart data={chartData}>
    <CartesianGrid strokeDasharray="3 3" />
    <XAxis dataKey="name" />
    <YAxis unit="%" domain={[0, 100]} />
    <Tooltip formatter={(v) => `${v}%`} />
    <Legend />
    <Bar dataKey="TM Leverage" fill="var(--color-primary)" radius={[4,4,0,0]} />
    <Bar dataKey="Approval Rate" fill="var(--color-secondary, #8884d8)" radius={[4,4,0,0]} />
  </BarChart>
</ResponsiveContainer>
```

**Section C — Drill-Down Panel**

When a language pair row is clicked, show a slide-in panel (or expandable section below the table) with the per-project breakdown table for that pair.

### Acceptance Criteria
- [ ] "Language Pairs" tab appears in Analytics screen
- [ ] Summary table correctly shows TM leverage % and project count per pair
- [ ] Bar chart renders with correct data labels
- [ ] Clicking a row fetches and shows the per-project breakdown
- [ ] Zero-segment language pairs still show in the table (0% leverage, 0 segments)
- [ ] Metrics update correctly when new projects are added

---

---

# IMPROVEMENT 4: In-Context DOCX Preview

## Problem

Translators work in a plain segment-list view with no visual context. They cannot see how their translation will look in the final document — whether a sentence wraps oddly, whether a heading is too long, whether a table cell overflows. This leads to post-export surprises.

## Goal

Add a **Preview Panel** to the Translation Editor showing side-by-side HTML renders of the source document and the (partially) translated document, updated live as segments are approved.

---

## Backend Changes

### Step 1 — Add HTML preview endpoint in `server/routes/parse.js` or a new route

When a document is parsed, ClearLingo already has the DOCX content. Add an endpoint that returns the document as HTML using Mammoth (already installed):

```javascript
// GET /api/preview/:projectId
// Returns { sourceHtml: string, translatedHtml: string }

router.get("/preview/:projectId", async (req, res) => {
  const { projectId } = req.params;
  const db = getDb();

  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId);
  if (!project) return res.status(404).json({ error: "Project not found" });

  // Get all segments ordered by idx
  const segments = db.prepare(`
    SELECT idx, source_text, target_text, status
    FROM segments
    WHERE project_id = ?
    ORDER BY idx ASC
  `).all(projectId);

  // Build simple HTML by joining segments with paragraph breaks
  // Source HTML
  const sourceHtml = segments
    .map(s => `<p data-segment-idx="${s.idx}" class="cl-segment">${escapeHtml(s.source_text)}</p>`)
    .join("\n");

  // Translated HTML — use target_text if available, fallback to source
  const translatedHtml = segments
    .map(s => `<p data-segment-idx="${s.idx}" class="cl-segment cl-${s.status?.toLowerCase() ?? 'pending'}">${
      escapeHtml(s.target_text ?? s.source_text)
    }</p>`)
    .join("\n");

  res.json({ sourceHtml, translatedHtml });
});

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
```

---

## Frontend Changes

**Before writing any UI, read `/mnt/skills/public/frontend-design/SKILL.md`.**

### Step 2 — Create `src/app/components/DocumentPreviewPanel.tsx`

```tsx
import { useEffect, useState, useRef } from "react";
import { Eye, EyeOff, RefreshCw } from "lucide-react";

interface DocumentPreviewPanelProps {
  projectId: string;
  // Pass this to force refresh when a segment is approved:
  lastApprovedAt: number;
}

export function DocumentPreviewPanel({ projectId, lastApprovedAt }: DocumentPreviewPanelProps) {
  const [preview, setPreview] = useState<{ sourceHtml: string; translatedHtml: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [activePane, setActivePane] = useState<"split" | "source" | "translated">("split");

  const fetchPreview = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/preview/${projectId}`);
      const data = await res.json();
      setPreview(data);
    } finally {
      setLoading(false);
    }
  };

  // Fetch on mount and whenever a segment is approved
  useEffect(() => { fetchPreview(); }, [projectId, lastApprovedAt]);

  return (
    <div className="flex flex-col h-full border-l bg-card">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b">
        <span className="text-sm font-medium flex items-center gap-2">
          <Eye className="w-4 h-4" /> Document Preview
        </span>
        <div className="flex items-center gap-1">
          {["split", "source", "translated"].map(mode => (
            <button
              key={mode}
              onClick={() => setActivePane(mode as any)}
              className={`px-2 py-1 text-xs rounded capitalize ${
                activePane === mode ? "bg-primary text-primary-foreground" : "hover:bg-muted"
              }`}
            >
              {mode}
            </button>
          ))}
          <button onClick={fetchPreview} className="ml-2 p-1 hover:bg-muted rounded" title="Refresh">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Preview panes */}
      <div className={`flex-1 overflow-hidden flex ${activePane === "split" ? "flex-row" : "flex-col"}`}>
        {(activePane === "split" || activePane === "source") && (
          <div className="flex-1 overflow-y-auto p-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Source
            </p>
            <div
              className="prose prose-sm max-w-none text-foreground"
              dangerouslySetInnerHTML={{ __html: preview?.sourceHtml ?? "<p class='text-muted-foreground'>Loading…</p>" }}
            />
          </div>
        )}

        {activePane === "split" && <div className="w-px bg-border flex-shrink-0" />}

        {(activePane === "split" || activePane === "translated") && (
          <div className="flex-1 overflow-y-auto p-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Translation
            </p>
            <div
              className="prose prose-sm max-w-none text-foreground"
              dangerouslySetInnerHTML={{ __html: preview?.translatedHtml ?? "<p class='text-muted-foreground'>Loading…</p>" }}
            />
          </div>
        )}
      </div>

      {/* Status summary */}
      <style>{`
        .cl-segment { margin-bottom: 0.75rem; line-height: 1.6; padding: 2px 4px; border-radius: 3px; }
        .cl-approved { background-color: rgba(34,197,94,0.1); }
        .cl-rejected { background-color: rgba(239,68,68,0.1); }
        .cl-pending { background-color: transparent; }
      `}</style>
    </div>
  );
}
```

### Step 3 — Integrate the preview panel into TranslationEditor.tsx

The editor currently has a single-column segment list. Add the preview as a **collapsible right panel**:

```tsx
const [showPreview, setShowPreview] = useState(false);
const [lastApprovedAt, setLastApprovedAt] = useState(Date.now());

// In the approve handler, after the API call succeeds:
setLastApprovedAt(Date.now()); // triggers preview refresh

// In the layout JSX, wrap the existing segment list in a flex container:
<div className="flex flex-1 overflow-hidden">
  {/* Segment list — existing content */}
  <div className={`flex-1 overflow-y-auto ${showPreview ? "max-w-[55%]" : "w-full"}`}>
    {/* ...existing segment rows... */}
  </div>

  {/* Preview panel */}
  {showPreview && currentProject && (
    <DocumentPreviewPanel
      projectId={currentProject.id}
      lastApprovedAt={lastApprovedAt}
    />
  )}
</div>

{/* Toggle button in the toolbar */}
<button
  onClick={() => setShowPreview(v => !v)}
  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-md transition-colors ${
    showPreview ? "bg-primary text-primary-foreground" : "hover:bg-muted"
  }`}
>
  {showPreview ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
  {showPreview ? "Hide Preview" : "Show Preview"}
</button>
```

### Acceptance Criteria
- [ ] "Show Preview" button in translation editor toolbar toggles the preview panel
- [ ] Preview shows source HTML on the left and translated HTML on the right in split mode
- [ ] Approved segments appear with a green tint in the translated pane
- [ ] Preview refreshes automatically after each segment approval
- [ ] The "source / translated / split" mode toggle works correctly
- [ ] Preview panel does not affect segment editing or scrolling in the left pane
- [ ] Preview renders correctly for documents with 100+ segments (virtual scrolling or CSS overflow)

---

---

# IMPROVEMENT 1: CMS Webhook / API Connector Layer

## Problem

Every translation in ClearLingo requires manually uploading a file through the UI. Enterprise clients whose content lives in a CMS (Contentful, Strapi, WordPress, custom APIs) must export content, upload it, translate it, download the result, and re-import it manually. This is a critical workflow bottleneck.

## Goal

Build a generic **Webhook Ingestion API** that external systems can push content to. ClearLingo will automatically create a project, run translation, and optionally POST the results to a callback URL.

---

## Backend Changes

### Step 1 — Create `server/routes/webhook.js`

```javascript
// server/routes/webhook.js
import { Router } from "express";
import { getDb } from "../db.js";
import { v4 as uuidv4 } from "uuid";
import { translateWithOrchestrator } from "../llm-orchestrator.js";

const router = Router();

/**
 * POST /api/webhook/ingest
 * 
 * Accepts a JSON payload from any external CMS or content system.
 * Creates a project, segments the content, runs translation, stores results.
 * Optionally POSTs translated content back to a callback URL.
 *
 * Request body schema:
 * {
 *   source: string,               // REQUIRED: Source text content
 *   sourceLang: string,           // REQUIRED: e.g. "en"
 *   targetLang: string,           // REQUIRED: e.g. "hi"
 *   projectName?: string,         // Optional: defaults to "Webhook_<timestamp>"
 *   contentId?: string,           // Optional: external ID from the CMS (stored for traceability)
 *   callbackUrl?: string,         // Optional: URL to POST results back to
 *   callbackSecret?: string,      // Optional: Bearer token for the callback POST
 *   styleProfile?: string,        // Optional: "professional" | "legal" | "casual" | "medical"
 *   context?: string,             // Optional: domain context for TM search
 *   segmentBy?: "sentence" | "paragraph",  // Optional: default "sentence"
 * }
 *
 * Response:
 * {
 *   jobId: string,       // UUID for this translation job
 *   projectId: string,   // ClearLingo project ID
 *   status: "queued",    // always "queued" — translation happens async
 *   segmentCount: number,
 *   estimatedSeconds: number,
 *   statusUrl: string,   // poll this for job status
 * }
 */
router.post("/ingest", async (req, res) => {
  const {
    source,
    sourceLang,
    targetLang,
    projectName,
    contentId,
    callbackUrl,
    callbackSecret,
    styleProfile = "professional",
    context = "",
    segmentBy = "sentence",
  } = req.body;

  // Validate required fields
  if (!source || typeof source !== "string" || source.trim().length === 0) {
    return res.status(400).json({ error: "source text is required" });
  }
  if (!sourceLang || !targetLang) {
    return res.status(400).json({ error: "sourceLang and targetLang are required" });
  }

  const db = getDb();
  const jobId = uuidv4();
  const projectId = uuidv4();
  const now = new Date().toISOString();
  const name = projectName ?? `Webhook_${Date.now()}`;

  // Segment the source text
  const rawSegments = segmentBy === "paragraph"
    ? source.split(/\n{2,}/).map(s => s.trim()).filter(Boolean)
    : source.match(/[^.!?]+[.!?]+/g)?.map(s => s.trim()).filter(Boolean) ?? [source];

  // Create project in DB
  db.prepare(`
    INSERT INTO projects (id, name, source_language, target_language, style_profile, context, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(projectId, name, sourceLang, targetLang, styleProfile, context, now);

  // Create segments in DB
  const insertSegment = db.prepare(`
    INSERT INTO segments (id, project_id, idx, source_text, status, format_type, created_at)
    VALUES (?, ?, ?, ?, 'PENDING', 'webhook', ?)
  `);
  rawSegments.forEach((text, i) => {
    insertSegment.run(uuidv4(), projectId, i, text, now);
  });

  // Store webhook job metadata
  // (We add a webhook_jobs table — see Step 2)
  db.prepare(`
    INSERT INTO webhook_jobs (id, project_id, content_id, callback_url, callback_secret, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'queued', ?)
  `).run(jobId, projectId, contentId ?? null, callbackUrl ?? null, callbackSecret ?? null, now);

  // Respond immediately with job ID — translation happens async
  res.status(202).json({
    jobId,
    projectId,
    status: "queued",
    segmentCount: rawSegments.length,
    estimatedSeconds: Math.ceil(rawSegments.length * 0.5),
    statusUrl: `/api/webhook/jobs/${jobId}`,
  });

  // Run translation asynchronously (don't await — response already sent)
  processWebhookJob(jobId, projectId, rawSegments, {
    sourceLang, targetLang, styleProfile, context, callbackUrl, callbackSecret
  }).catch(err => {
    console.error(`[webhook] Job ${jobId} failed:`, err.message);
    db.prepare("UPDATE webhook_jobs SET status='failed', error=? WHERE id=?")
      .run(err.message, jobId);
  });
});

/**
 * Async translation runner for webhook jobs.
 * Translates all segments, writes results, fires callback if configured.
 */
async function processWebhookJob(jobId, projectId, rawSegments, options) {
  const db = getDb();
  db.prepare("UPDATE webhook_jobs SET status='processing' WHERE id=?").run(jobId);

  const segments = db.prepare("SELECT * FROM segments WHERE project_id = ? ORDER BY idx ASC").all(projectId);
  const results = [];

  for (const segment of segments) {
    try {
      const result = await translateWithOrchestrator({
        sourceText: segment.source_text,
        sourceLang: options.sourceLang,
        targetLang: options.targetLang,
        context: options.context,
        styleProfile: options.styleProfile,
      });

      db.prepare("UPDATE segments SET target_text=?, match_type=?, tm_score=?, status='PENDING' WHERE id=?")
        .run(result.translatedText, result.matchType, result.tmScore ?? null, segment.id);

      results.push({ idx: segment.idx, source: segment.source_text, translation: result.translatedText });
    } catch (err) {
      results.push({ idx: segment.idx, source: segment.source_text, error: err.message });
    }
  }

  // Mark job complete
  db.prepare("UPDATE webhook_jobs SET status='completed', completed_at=? WHERE id=?")
    .run(new Date().toISOString(), jobId);

  // Fire callback if URL provided
  if (options.callbackUrl) {
    try {
      await fetch(options.callbackUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(options.callbackSecret ? { Authorization: `Bearer ${options.callbackSecret}` } : {}),
        },
        body: JSON.stringify({
          jobId,
          projectId,
          status: "completed",
          segments: results,
          translatedText: results.map(r => r.translation ?? r.source).join(" "),
        }),
      });
    } catch (err) {
      console.warn(`[webhook] Callback to ${options.callbackUrl} failed:`, err.message);
      db.prepare("UPDATE webhook_jobs SET callback_status='failed' WHERE id=?").run(jobId);
    }
  }
}

// GET /api/webhook/jobs/:jobId — Poll for job status
router.get("/jobs/:jobId", (req, res) => {
  const db = getDb();
  const job = db.prepare("SELECT * FROM webhook_jobs WHERE id = ?").get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });

  const result = { jobId: job.id, projectId: job.project_id, status: job.status };

  if (job.status === "completed") {
    const segments = db.prepare(
      "SELECT idx, source_text, target_text, match_type, status FROM segments WHERE project_id = ? ORDER BY idx ASC"
    ).all(job.project_id);
    result.segments = segments;
    result.translatedText = segments.map(s => s.target_text ?? s.source_text).join(" ");
    result.completedAt = job.completed_at;
  }

  if (job.status === "failed") result.error = job.error;

  res.json(result);
});

// GET /api/webhook/jobs — List recent webhook jobs
router.get("/jobs", (req, res) => {
  const db = getDb();
  const jobs = db.prepare(`
    SELECT id, project_id, content_id, status, created_at, completed_at, error
    FROM webhook_jobs
    ORDER BY created_at DESC
    LIMIT 50
  `).all();
  res.json(jobs);
});

export default router;
```

### Step 2 — Add `webhook_jobs` table to `server/db.js`

In the schema setup section, add:

```javascript
db.exec(`
  CREATE TABLE IF NOT EXISTS webhook_jobs (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL,
    content_id      TEXT,
    callback_url    TEXT,
    callback_secret TEXT,
    status          TEXT DEFAULT 'queued',   -- queued | processing | completed | failed
    callback_status TEXT,                    -- null | fired | failed
    error           TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    completed_at    TEXT
  )
`);
```

### Step 3 — Mount the router in `server/index.js`

```javascript
import webhookRoutes from "./routes/webhook.js";
app.use("/api/webhook", webhookRoutes);
```

### Step 4 — Add Webhook Jobs panel to Analytics screen

**Read `/mnt/skills/public/frontend-design/SKILL.md` before writing UI.**

In `Analytics.tsx`, add a "Webhook Jobs" tab showing:

- A table of recent webhook jobs: Job ID | Content ID | Status | Segments | Created | Completed
- Status badges: `queued` (gray), `processing` (yellow, pulsing), `completed` (green), `failed` (red)
- A "View Project" link for completed jobs that opens the Translation Editor for that project
- An auto-refresh every 5 seconds when any job is in `queued` or `processing` state

```tsx
// Auto-refresh logic:
useEffect(() => {
  const hasActiveJobs = jobs.some(j => j.status === "queued" || j.status === "processing");
  if (!hasActiveJobs) return;
  const interval = setInterval(fetchJobs, 5000);
  return () => clearInterval(interval);
}, [jobs]);
```

### Step 5 — Add a "Test Webhook" UI panel

In the Analytics Webhook Jobs tab, add a small test form so developers can trigger a webhook from the UI without needing curl:

```tsx
<div className="border rounded-lg p-4 bg-muted/30">
  <h4 className="text-sm font-semibold mb-3">Test Webhook Ingest</h4>
  <textarea
    placeholder="Paste source text here…"
    value={testSource}
    onChange={e => setTestSource(e.target.value)}
    className="w-full h-24 text-sm font-mono border rounded p-2 bg-background resize-none"
  />
  <div className="flex gap-2 mt-2">
    <select value={testSourceLang} onChange={e => setTestSourceLang(e.target.value)} className="text-sm border rounded px-2 py-1">
      <option value="en">English</option>
    </select>
    <select value={testTargetLang} onChange={e => setTestTargetLang(e.target.value)} className="text-sm border rounded px-2 py-1">
      {/* populate from /api/languages */}
    </select>
    <button onClick={handleTestWebhook} className="px-4 py-1 text-sm bg-primary text-primary-foreground rounded">
      Send
    </button>
  </div>
  {testJobId && (
    <p className="mt-2 text-xs text-muted-foreground font-mono">
      Job ID: {testJobId} — polling for result…
    </p>
  )}
</div>
```

### Acceptance Criteria
- [ ] `POST /api/webhook/ingest` returns 202 with a `jobId` within 100ms (async processing)
- [ ] `GET /api/webhook/jobs/:jobId` returns `status: "processing"` during translation, then `status: "completed"` with segments
- [ ] Completed jobs have `translatedText` as a joined string of all translated segments
- [ ] If `callbackUrl` is provided, a POST is fired to it when translation completes
- [ ] Failed jobs (e.g. bad API key) show `status: "failed"` with an error message
- [ ] Analytics screen shows the Webhook Jobs tab with status badges
- [ ] Auto-refresh stops when all visible jobs are in terminal state (completed/failed)
- [ ] Test Webhook panel in UI successfully triggers and shows result

---

---

# FINAL CHECKLIST FOR THE AGENT

## After implementing ALL improvements:

### Run these checks in order:
```bash
# 1. Verify server starts clean
npm run server

# 2. Verify frontend builds with no TypeScript errors
npm run dev

# 3. Verify no regressions on core endpoints
curl http://localhost:3001/api/health
curl http://localhost:3001/api/projects
curl http://localhost:3001/api/languages
```

### Verify these files were NOT modified in breaking ways:
- `server/db.js` — Only additive changes (new tables, new columns via `addColumnIfNotExists`)
- `server/gemini.js` — No changes unless strictly necessary
- `server/rag-engine.js` — Only additions, no signature changes
- `src/app/store.ts` — Only new actions added, no existing actions removed or renamed

### Required new files (create all of these):
- `server/routes/export-tm.js`
- `server/routes/webhook.js`
- `src/app/components/SegmentHistoryDrawer.tsx`
- `src/app/components/DocumentPreviewPanel.tsx`

### Required modifications:
- `server/routes/translate.js` — Add `/stream` endpoint
- `server/routes/approve.js` — Add auto-propagation + Socket.io broadcast
- `server/routes/analytics.js` — Add language-pair endpoints
- `server/routes/parse.js` — Add `/preview/:projectId` endpoint
- `server/index.js` — Mount new routers + add webhook_jobs table init
- `server/db.js` — Add `webhook_jobs` table, add `created_at`/`updated_at` to segments
- `src/app/screens/TranslationEditor.tsx` — Add streaming, preview panel, history drawer, propagation toast
- `src/app/screens/Analytics.tsx` — Add Language Pairs tab + Webhook Jobs tab
- `src/app/store.ts` — Add new actions

### UI Design Reminder
**Every time you create or modify a TSX file**, apply the principles from `/mnt/skills/public/frontend-design/SKILL.md`:
- Choose distinctive, intentional typography (not Inter/Roboto)
- Use the existing ClearLingo design tokens from `src/styles/theme.css`
- Animate meaningful state transitions (segment appearing, drawer sliding, progress filling)
- Never add UI that looks generic or out of place with the existing editor aesthetic

---

*ClearLingo v0.1.0 — Next-Wave Improvements Prompt*
*Team SourceShipIt/WordX*
