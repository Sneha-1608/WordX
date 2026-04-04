# Layer 1: Web UI
## Next.js 14 App Router + shadcn/ui

---

## Overview

Layer 1 is the **user-facing presentation layer** of ClearLingo. It is built entirely using **Next.js 14 (App Router)** with **shadcn/ui** components, **Tailwind CSS 3** for styling, and **Framer Motion 11** for animations. This layer handles every visual interaction — from uploading documents, to validating source content, to editing translations side-by-side, to exporting the final approved output.

The design philosophy is **Professional, Clean, Trustworthy** — it should look like specialized B2B enterprise software (think Salesforce, Atlassian, or modern fintech dashboards), not a student project.

---

## Components of Layer 1 (Left to Right from Architecture Diagram)

### 1.1 Document Upload

**Purpose:** The entry point for every translation project. Users upload DOCX or PDF files here.

**Detailed Steps:**

1. A **drag-and-drop dropzone** component is rendered using shadcn/ui's Card primitive with a dashed border area.
2. The user drags a `.docx` or `.pdf` file into the dropzone, or clicks to open a native file picker.
3. On file drop, the file is read as an `ArrayBuffer` in the browser.
4. The file is sent to **Layer 2** via a `POST` request to `/api/parse`.
5. While the file is parsing, a **skeleton loader** (not a spinner) is displayed across the segment table area to indicate processing.
6. The parsing library used:
   - **mammoth.js** for DOCX files — extracts paragraphs with formatting preservation.
   - **pdf-parse** for PDF files — extracts text blocks.
7. The parsed text is split by paragraph breaks and refined using **regex abbreviation boundary detection** to produce clean translation segments.
8. Once parsing is complete, the segments are stored in the **Zustand global state** and the UI transitions to the Validation screen.

**Key UI Details:**
- File type validation occurs client-side before upload (only `.docx` and `.pdf` accepted).
- File size indicator and filename display after selection.
- Error toasts shown for unsupported formats.

---

### 1.2 Smart Segmentation Engine (mammoth.js)

**Purpose:** Converts raw uploaded documents into an array of translatable segments while preserving formatting structure.

**Detailed Steps:**

1. After upload, `mammoth.js` or `pdf-parse` processes the file buffer server-side (in the API route).
2. Raw extracted text is split by **paragraph boundaries** (newlines, `<p>` tags in DOCX HTML output).
3. A **regex-based sentence boundary detector** further splits paragraphs if needed, being careful around abbreviations like "Dr.", "U.S.", "etc." which should not trigger a split.
4. Each resulting segment is assigned a unique `id`, a `status` field (`'PENDING'`), and an index for ordering.
5. The segment array is returned to the frontend and loaded into Zustand state:

```typescript
interface Segment {
  id: string;
  index: number;
  sourceText: string;
  targetText: string | null;
  tmScore: number | null;       // e.g., 1.0, 0.92, 0.0
  matchType: 'EXACT' | 'FUZZY' | 'NEW' | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  violation: boolean;           // glossary violation flag
}
```

6. The segment list is the foundation data structure that drives every downstream feature in the UI.

---

### 1.3 Source Validation Engine

**Purpose:** Runs 5 quality checks on the *source* document **before** any translation begins. This catches errors early so they don't propagate across 22 target languages.

**Detailed Steps:**

1. After segmentation, a "Validate Source" step is triggered (either automatically or via button click).
2. The frontend sends the segment array to `/api/validate` (Layer 2).
3. While the 5 checks run, the UI shows a **loading skeleton** with animated pulse effects and text: "Running 5 quality checks…"
4. The 5 checks performed (via Gemini 1.5 Flash in Layer 4):
   - **Spell Check:** Detects misspelled words using LLM batch payload.
   - **Terminology Consistency:** Ensures the same term isn't written differently across segments (e.g., "ecommerce" vs "e-commerce").
   - **Date/Number Normalizations:** Ensures dates and numbers follow a consistent format (e.g., MM/DD/YYYY vs DD-MM-YYYY).
   - **Punctuation Style:** Checks for missing or inconsistent punctuation.
   - **Segment Length Flags:** Flags unusually long or short segments that may need manual review.
5. The UI reveals a **Validation Scorecard** (e.g., "Quality Score: 87/100").
6. Below the scorecard, an expandable accordion list shows each issue with its category, the segment it affects, and a suggested correction.
7. An **"Auto-Fix Source Issues"** button applies all corrections to the source segments in one click.
8. After fixing (or accepting as-is), the user clicks **"Start Translation"** to proceed.

**Key UI Details:**
- Each check category has an icon and count badge.
- Issues are color-coded by severity (red = critical, yellow = warning).
- Accordion items expand to show full context of each issue.

---

### 1.4 Real-Time Collaborative Editor (Side-by-Side)

**Purpose:** The core hero feature of ClearLingo — the split-pane translation editor where linguists review, edit, and approve translations.

**Detailed Steps:**

1. The editor screen is laid out in a **split view**:
   - **Left Panel (30%):** Document structure outline, TM configuration toggles, analytics mini-chart, glossary preview.
   - **Right Panel (70%):** The **Segment Array Table** — the main work area.

2. Each segment occupies one row in the table with these columns:
   - **Status Icon:** A colored badge dot:
     - 🟡 Yellow = Needs Review
     - 🟢 Green = Approved
     - 🔴 Red = Rejected
   - **TM Match Pillar:** A colored badge showing the leverage origin:
     - `[ 100% Exact ]` — Emerald green — fetched from SQLite TM
     - `[ 90% Fuzzy ]` — Blue — cosine similarity match from vector DB
     - `[ AI Translated ]` — Gray — Gemini/IndicTrans2 output (new segment)
   - **Source Text (Left):** Read-only, un-editable original sentence.
   - **Target Text (Right):** An editable `<textarea>` that auto-expands to fit content. Pre-filled with the TM match or LLM translation.

3. **Hover Actions** on the Target Text cell:
   - **[✓ Approve]:** Triggers atomic approval — writes the source-target pair + embedding to SQLite via `/api/approve`. This is the **single most important interaction** in the app.
   - **[↺ Revert]:** Resets the target text to its original LLM/TM output.
   - **[Glossary Highlight]:** Words in the target text matching glossary constraints are highlighted yellow.

4. **Framer Motion Animations:**
   - When a row transitions from `Needs Review` → `Approved`, its height shrinks slightly and opacity dims to 50%, focusing the linguist on the next unapproved row.
   - **Propagation Toast:** If approving a 100% exact match, and identical unapproved segments exist lower in the document, a toast appears: "3 Identical Segments Auto-Approved!" — demonstrating continuous learning.

5. The editor supports keyboard shortcuts for efficient review workflows.

---

### 1.5 Live Cursors (Yjs)

**Purpose:** Enables real-time multi-user collaboration, showing live cursor positions of other collaborators in the translation editor.

**Detailed Steps:**

1. **Yjs** (a CRDT-based real-time collaboration framework) is integrated into the editor.
2. When multiple users open the same project:
   - Each user gets a uniquely colored cursor.
   - Cursor positions and selections sync in real-time across all connected clients.
3. Yjs handles conflict resolution through its CRDT (Conflict-free Replicated Data Type) algorithm:
   - If two users edit the same segment simultaneously, both changes are preserved and merged.
4. A small **avatar/name tag** floats next to each live cursor to identify who is editing.
5. The provider connects via WebSocket to maintain the sync channel.
6. This feature is crucial for team-based translation scenarios where multiple linguists work on different sections of the same document simultaneously.

---

### 1.6 Analytics Dashboard

**Purpose:** Displays business-impact metrics in real-time, helping demonstrate ROI to stakeholders and judges.

**Detailed Steps:**

1. The dashboard is the **first screen the judges see** upon opening the app.
2. **Key UI Components:**
   - **"94% TM Leverage" Hero Stat:** A large circular progress gauge or animated progress bar. This **must animate on page load** using Framer Motion from 0% to 94%.
   - **Total Cost Saved:** Displayed as large formatted currency numbers — e.g., "₹40,000 → ₹4,000" — showing 90% cost reduction.
   - **Project Table:** Using shadcn/ui `Table` component. Columns: `[Project Name]`, `[Source Language]`, `[Target Language]` (e.g., English → Marathi), `[Progress Bar]`, `[Status Badge]`.
3. **Real-time updates:** When a reviewer approves a segment in the editor, the dashboard metrics update live:
   - The TM leverage percentage ticks upward.
   - The cost savings recalculate.
   - The project progress bar advances.
4. Additional metrics panels:
   - **Glossary Compliance Rate:** Target 99.8%.
   - **Segments Processed Today:** Count with trend arrow.
   - **Average Review Time per Segment.**

---

### 1.7 Export Interface

**Purpose:** Allows users to export approved translations as structure-preserved DOCX or PDF files.

**Detailed Steps:**

1. Once all segments (or a selected subset) are approved, the **Export** button becomes active.
2. The user clicks Export, selects the output format:
   - **DOCX** — reconstructs the original document structure with translated text replacing the source.
   - **PDF** — generates a formatted PDF from the translated content.
3. A request is sent to `/api/export` (Layer 2) with the project ID and format preference.
4. The backend assembles the output file, **preserving the original document's formatting, headings, bullet points, and paragraph structure**.
5. The file is returned as a download link or auto-downloaded via the browser.
6. A confirmation toast: "Export Complete — document_translated_hi.docx downloaded."

---

## Design System Specifications

| Property | Value |
|---|---|
| **Primary Background** | Deep Indigo `#1E1B4B` (sidebar, nav) |
| **Content Background** | Crisp White `#FFFFFF` (editor areas) |
| **Success/Approval** | Vibrant Emerald `#10B981` |
| **Inactive/Muted Text** | Subtle Slate `#64748B` |
| **UI Typography** | DM Sans or Inter |
| **Editor Typography** | JetBrains Mono or DM Mono |
| **Component Library** | shadcn/ui (Cards, Tables, Selects, Sheets) |
| **Animation Library** | Framer Motion 11 |
| **Layout Density** | Dense but breathable — avoid overly large paddings |

---

## State Management (Zustand)

The entire UI state is managed through a **Zustand store**, avoiding deep prop drilling and slow context providers:

```typescript
interface AppState {
  currentProject: Project | null;
  segments: Segment[];
  leverageRate: number;       // The golden 94% stat
  activeLanguage: string;     // e.g., "hi_IN" — 22 Indian Languages Supported

  // Actions
  updateSegmentStatus: (id: string, status: 'APPROVED' | 'REJECTED') => void;
  recalculateLeverage: () => void;
  approveAllExact: () => void;
}
```

**TanStack Query 5** handles server API state caching independently, keeping server and client state concerns separated.

---

## Interaction Flow Summary

```
User drops file → Skeleton loader → Segments parsed → Validation scorecard shown
→ Auto-fix issues → Start Translation → Side-by-side editor loads
→ Reviewer edits/approves rows → TM updates live → Dashboard refreshes
→ Export translated document
```
