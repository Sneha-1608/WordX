# Layer 6: Analytics
## Live Dashboard

---

## Overview

Layer 6 is the **real-time monitoring and business intelligence layer** of ClearLingo. It provides a live dashboard that tracks the system's core KPIs: **TM Leverage Rate**, **Glossary Compliance**, and **Cost Savings**. This layer is critical for demonstrating ROI to stakeholders and judges — it makes the "94% TM Leverage" claim tangible and verifiable in real-time.

The dashboard updates live as reviewers approve translations, providing instant feedback on how each approval impacts overall system performance.

---

## 6.1 TM Leverage: 94% Target

**Purpose:** Track and display the percentage of translation segments served from Translation Memory (exact + fuzzy matches) vs. segments requiring full LLM translation.

### Detailed Steps

1. **Metric Definition:**
   ```
   TM Leverage Rate = (Exact Matches + Fuzzy Matches) / Total Segments × 100
   ```
   - **Exact Match:** Score = 1.0 — identical source string found in TM
   - **Fuzzy Match:** Score ≥ 0.75 — semantically similar match found via cosine similarity
   - **New:** Score < 0.75 — no useful match; requires LLM translation

2. **Data Collection:**
   - Every translation request logged in the `translation_log` table:
     ```sql
     CREATE TABLE translation_log (
       id          INTEGER PRIMARY KEY,
       segmentId   TEXT,
       matchType   TEXT,      -- 'EXACT', 'FUZZY', 'NEW'
       tmScore     REAL,
       sourceLang  TEXT,
       targetLang  TEXT,
       processedAt TEXT DEFAULT (datetime('now'))
     );
     ```
   - On each `/api/translate` call, the match type and score are recorded.

3. **Real-Time Calculation:**
   ```sql
   SELECT
     COUNT(CASE WHEN matchType IN ('EXACT', 'FUZZY') THEN 1 END) * 100.0 / COUNT(*) AS leverageRate,
     COUNT(CASE WHEN matchType = 'EXACT' THEN 1 END) AS exactCount,
     COUNT(CASE WHEN matchType = 'FUZZY' THEN 1 END) AS fuzzyCount,
     COUNT(CASE WHEN matchType = 'NEW' THEN 1 END) AS newCount
   FROM translation_log
   WHERE projectId = ?;
   ```

4. **Dashboard Display:**
   - **Hero Widget:** A large circular gauge or animated progress bar showing the current leverage rate.
   - Animated on page load from 0% → current value using Framer Motion.
   - Color-coded: Green (≥90%), Yellow (70–89%), Red (<70%).
   - Breakdown bar chart showing Exact vs. Fuzzy vs. New segment counts.

5. **Live Updates:**
   - When a reviewer approves a segment (via `/api/approve`), the leverage rate recalculates.
   - The Zustand store's `recalculateLeverage()` action fires.
   - The gauge animates smoothly to the new percentage.
   - A propagation toast may appear: "3 Identical Segments Auto-Approved!" — each approval bumps the TM leverage for future documents.

6. **Target: 94%**
   - Achieved by seeding the TM with Document A (approved translations), then translating Document B (which has 5 exact + 5 fuzzy + 5 new segments).
   - Over time, as more documents are processed, the leverage rate naturally increases toward 94%+.

---

## 6.2 Glossary Compliance: 99.8%

**Purpose:** Track the percentage of translations that correctly use all mandated glossary terms.

### Detailed Steps

1. **Metric Definition:**
   ```
   Glossary Compliance = Segments with All Glossary Terms Present / Segments with Glossary Terms Required × 100
   ```

2. **Data Collection:**
   - After each translation, the post-translation glossary check (Layer 2, Step C) records:
     ```sql
     CREATE TABLE glossary_checks (
       id          INTEGER PRIMARY KEY,
       segmentId   TEXT,
       totalTerms  INTEGER,    -- Number of glossary terms applicable
       matchedTerms INTEGER,   -- Number correctly used in translation
       violations  TEXT,       -- JSON array of missing terms
       checkedAt   TEXT DEFAULT (datetime('now'))
     );
     ```

3. **Compliance Calculation:**
   ```sql
   SELECT
     COUNT(CASE WHEN matchedTerms = totalTerms THEN 1 END) * 100.0 / COUNT(*) AS complianceRate,
     COUNT(CASE WHEN matchedTerms < totalTerms THEN 1 END) AS violationCount
   FROM glossary_checks
   WHERE totalTerms > 0;
   ```

4. **Dashboard Display:**
   - A percentage badge or progress indicator showing compliance rate.
   - Color: Green (≥99%), Yellow (95–98.9%), Red (<95%).
   - A list of recent violations with the segment, the missing term, and a link to fix it.

5. **Violation Handling:**
   - When a glossary violation is detected, the segment is flagged in the editor with a red warning icon.
   - The reviewer can see which specific term was missing and manually correct the translation.
   - After correction and approval, the compliance rate updates.

6. **Why 99.8%:**
   - The constrained LLM prompt injects glossary terms directly.
   - The deterministic post-check catches any LLM failures.
   - Double enforcement (prompt + regex check) ensures near-perfect compliance.

---

## 6.3 Cost Savings: Manual → Automated

**Purpose:** Track and display the financial impact of TM leverage — how much translation cost is saved by reusing approved translations instead of paying for full LLM/human translation.

### Detailed Steps

1. **Cost Model:**
   | Translation Method | Cost per Segment |
   |---|---|
   | Full human translation | ₹200–₹500 per segment |
   | LLM translation + review | ₹50–₹100 per segment |
   | TM Exact Match (automated) | ₹0 per segment |
   | TM Fuzzy Match (minimal review) | ₹10–₹20 per segment |

2. **Data Collection:**
   - Each translated segment is tagged with its method (TM Exact, TM Fuzzy, LLM New).
   - Cost per method is configured in the system settings.
   - Running totals are maintained:
     ```sql
     SELECT
       SUM(CASE WHEN matchType = 'NEW' THEN costPerNew ELSE 0 END) AS actualCost,
       COUNT(*) * costPerManual AS manualCost,
       (COUNT(*) * costPerManual) -
         SUM(CASE WHEN matchType = 'NEW' THEN costPerNew ELSE 0 END) AS savings
     FROM translation_log;
     ```

3. **Dashboard Display:**
   - **Before vs. After:** Large formatted currency numbers — "₹40,000 → ₹4,000" — showing 90% cost reduction.
   - **Savings Gauge:** Shows cumulative savings over time with a trend line.
   - **Per-Project Breakdown:** Table showing each project's cost vs. what manual translation would have cost.
   - **ROI Calculator:** Interactive widget where judges can input their translation volume to see projected savings.

4. **Real-Time Updates:**
   - Every time a segment is served from TM (instead of LLM), the cost saved increments.
   - The dashboard reflects this immediately.
   - Trend arrows show improvement over time.

5. **Demo Impact:**
   - Document A: All segments are NEW → full LLM cost incurred.
   - Document B: 10 of 15 segments from TM → 67% cost reduction visible instantly.
   - This demonstrates the **compounding value** of the TM over time.

---

## Additional Dashboard Panels

### Segments Processed Counter
- Total segments translated today/this week/all-time.
- Trend arrow showing velocity changes.

### Average Review Time
- Time between when a translation is shown and when the reviewer approves it.
- Lower times indicate better first-pass quality (validates LoRA improvements from Layer 5).

### Language Coverage Map
- Visual indicator showing which of the 22 Indian languages have active TM data.
- Heat map intensity based on TM record count per language.

### TM Growth Chart
- Line chart showing how TM records accumulate over time.
- Milestone markers at key thresholds (100, 500, 1000 records).

---

## Technical Implementation

### Data Flow to Dashboard

```
Layer 2 (API)  ──logs──►  SQLite Tables ──queries──► Dashboard API
     │                      │                              │
     │                      ├── translation_log            │
     │                      ├── glossary_checks            │
     │                      └── tm_records (count)         │
     │                                                     ▼
     └──────────── Zustand Store ◄──── Real-time Updates ──┘
                        │
                        ▼
                 Dashboard UI Components
                 (Gauges, Charts, Tables)
```

### Zustand Dashboard State

```typescript
interface DashboardState {
  leverageRate: number;       // 0.94
  glossaryCompliance: number; // 0.998
  totalSegments: number;
  exactMatches: number;
  fuzzyMatches: number;
  newTranslations: number;
  costSaved: number;          // in ₹
  manualCost: number;         // baseline ₹
  tmRecordCount: number;

  // Actions
  refreshMetrics: () => Promise<void>;
  recalculateLeverage: () => void;
}
```

### Refresh Strategy
- Metrics refresh on every `/api/approve` call.
- Dashboard polls every 10 seconds as a fallback.
- Framer Motion `layout` animations smooth all number transitions.
