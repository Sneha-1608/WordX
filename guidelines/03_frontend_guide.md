# AI-Powered Translation Studio — ClearLingo
## File 03 — Frontend Guide (V3)

---

## 1. Visual Design Philosophy

**Professional, Clean, Trustworthy.**
The application must not look like a student project. It should look like specialized B2B enterprise software (think Salesforce, Atlassian, or modern fintech dashboards).

- **Colors:** Deep Indigo (`#1E1B4B`) for sidebars, crisp White (`#FFFFFF`) for editors, vibrant Emerald (`#10B981`) for approvals/exact matches, and subtle Slate (`#64748B`) for inactive text.
- **Typography:** DM Sans or Inter for application Chrome. JetBrains Mono or DM Mono for the actual text editor segments to help spot punctuation differences.
- **Layout:** Dense information density but breathable. Avoid overly large paddings.

---

## 2. Global State Management (Zustand)

Instead of passing props 5 levels deep or leaning heavily on slow context providers, the app architecture uses `zustand` to command the UI layer.

```typescript
interface AppState {
  currentProject: Project | null;
  segments: Segment[];
  leverageRate: number; // The golden 94% stat
  activeLanguage: string; // "hi_IN" 22 Indian Languages Supported
  
  // Actions
  updateSegmentStatus: (id: string, status: 'APPROVED' | 'REJECTED') => void;
  recalculateLeverage: () => void;
  approveAllExact: () => void;
}
```

---

## 3. Screen 1: The Dashboard & Project Hub

The first screen the judges see. The goal is to highlight the **business impact**.

### Key UI Components
- **The "94% TM Leverage" Hero Stat:** A large circular gauge or progress bar. This must animate on load.
- **Total Cost Saved:** ₹40,000 -> ₹4,000. Big numbers formatted as currency.
- **Project Table:** Using `shadcn/ui` table. Shows [Name], [Source], [Target] (e.g., English -> Marathi), [Progress Bar], [Status Badge].

---

## 4. Screen 2: Pre-Translation Validation Engine

When a document is uploaded, do NOT take them straight to translation. 

### The Audit Panel
1. The uploaded file parses.
2. The UI shows a loading skeleton while it "runs 5 checks."
3. The UI reveals a Validation Scorecard (e.g., "Quality Score: 87/100").
4. A list of exact errors found in the source document appears: 
   - Terminology Inconsistencies (Accordion expanding to show context)
   - Formatting/Date Issues
   - Missing punctuation
   
*Demo Note:* Click a button "Auto-Fix Source Issues" to correct all the source errors before hitting "Start Translation."

---

## 5. Screen 3: The Stateful Translation Editor (The Core)

This is the heroic feature of the application.

### Layout Specs (Split View)
- **Left Panel (30%):** Document structure outline, TM configuration toggles, Analytics mini-chart, glossary preview limit box.
- **Right Panel (70%):** The Segment Array Table.

### The Segment Row (AgGrid/shadcn Table Row)
Each segment must have a row with these columns:
1. **Status Icon:** A tiny badge dot. (Yellow = Needs Review, Green = Approved, Red = Rejected)
2. **TM Match Pillar:** A colored badge showing leverage origin.
   - `[ 100% Exact ]` (Emerald) -> Fetched from SQLite memory
   - `[ 90% Fuzzy ]` (Blue) -> Cosine similarity match
   - `[ AI Translated ]` (Gray) -> Gemini/IndicTrans2 Output
3. **Source Text (Left):** Un-editable. Read-only original sentence.
4. **Target Text (Right):** Editable `textarea` that naturally expands to fit its content. This is filled with the LLM or TM return payload.

### The Hover Actions
When hovering over the "Target Text" cell:
- **[Approve Button]**: Big clear tick mark. Clicking this triggers the Atomic SQLite TM Update!
- **[Revert Button]**: Arrows to restart.
- **[Glossary Highlight]**: Any words present in the Target Text that correspond to the Glossary constraint are subtly highlighted yellow.

---

## 6. The Contextual AI Assistant (Slide-Over Panel)

A persistent Floating Action Button in the bottom right corner opens a `shadcn/ui` Sheet slide-over panel.
- Powered by Llama 3.1 70B (Groq) for 300 tk/s instant replies.
- Use this during the demo to ask: "Summarize this Hindi translation" or "Are there any informal words in paragraph 3?"

---

## 7. Real-Time Interactions & Animations

Animations make the app feel alive and stateful.

- **Framer Motion `layout`** transitions when rows change status. When a row changes from `Needs Review` to `Approved`, shrink its vertical height slightly and dim its opacity to 50% to focus the linguist on the next unapproved segment.
- **Propagation Toast:** When you click "Approve" on a 100% exact match, if there are identical unapproved segments lower in the document, show a toast: "3 Identical Segments Auto-Approved!" to explicitly demo the Continuous Learning loop.
- **Skeleton Loaders:** Do not use spinners for segment table generation; use skeleton text widths across the table until data populates.
