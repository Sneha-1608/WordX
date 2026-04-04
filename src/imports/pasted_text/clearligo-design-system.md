Create a complete Figma design system and all landing page screens for 
"ClearLingo" — a B2B enterprise AI translation platform. The visual 
style must match the aesthetic of dontboardme.com: bold oversized 
typography, generous whitespace, dark/light section contrast, smooth 
scroll-section layout, and a premium SaaS feel. Think Linear.app meets 
Vercel meets a fintech dashboard.

═══════════════════════════════════════
PART 1 — DESIGN SYSTEM (Build this first)
═══════════════════════════════════════

── COLOR STYLES ──
Create these exact named color styles:
  • Brand/Indigo      #1E1B4B   (primary dark)
  • Brand/Emerald     #10B981   (accent, CTA, success)
  • Brand/Emerald-Light #D1FAE5 (emerald tint backgrounds)
  • UI/Slate          #64748B   (body text, muted)
  • UI/Slate-Light    #94A3B8   (placeholder, captions)
  • UI/Border         #E2E8F0   (card borders, dividers)
  • UI/Surface        #F8FAFC   (alternate section bg)
  • UI/White          #FFFFFF
  • Dark/900          #0F0D2E   (darkest — footer bg)
  • Status/Success    #10B981
  • Status/Warning    #F59E0B
  • Status/Error      #EF4444

── TEXT STYLES ──
Font family: DM Sans for all UI. JetBrains Mono for code/TM segments.
Create these named text styles:

  Display/Hero        DM Sans Black 900, 96px, line-height 100%, 
                      letter-spacing -2px, color Brand/Indigo
  Display/H1          DM Sans Black 900, 72px, line-height 105%, 
                      letter-spacing -1.5px
  Display/H2          DM Sans Bold 700, 56px, line-height 110%, 
                      letter-spacing -1px
  Display/H3          DM Sans Bold 700, 36px, line-height 115%
  Display/H4          DM Sans SemiBold 600, 28px, line-height 120%
  Body/XL             DM Sans Regular 400, 20px, line-height 170%
  Body/LG             DM Sans Regular 400, 18px, line-height 175%
  Body/MD             DM Sans Regular 400, 16px, line-height 175%
  Body/SM             DM Sans Medium 500, 14px, line-height 160%
  Label/Caps          DM Sans Medium 500, 11px, line-height 140%, 
                      letter-spacing 2px, UPPERCASE
  Code/MD             JetBrains Mono Regular 400, 13px, line-height 180%
  Code/SM             JetBrains Mono Regular 400, 11px, line-height 170%

── SPACING & GRID ──
Base unit: 8px grid. All spacing is a multiple of 8.
Common values to apply: 8 / 16 / 24 / 32 / 48 / 64 / 80 / 96 / 128px
Page max-width: 1280px, centered, with 80px horizontal padding on desktop.
Section vertical padding: 120px top and bottom.

── EFFECTS STYLES ──
  Shadow/SM     0px 1px 3px rgba(0,0,0,0.08), 0px 1px 2px rgba(0,0,0,0.06)
  Shadow/MD     0px 4px 16px rgba(0,0,0,0.08), 0px 2px 4px rgba(0,0,0,0.04)
  Shadow/LG     0px 20px 48px rgba(0,0,0,0.10), 0px 8px 16px rgba(0,0,0,0.06)
  Shadow/Glow   0px 0px 32px rgba(16,185,129,0.25)  (Emerald glow for CTA)
  Blur/Glass    background blur 12px (for frosted nav)

── BORDER RADIUS ──
  Radius/SM   8px    (tags, badges, inputs)
  Radius/MD   16px   (small cards)
  Radius/LG   24px   (main cards)
  Radius/XL   32px   (feature panels)
  Radius/Full 9999px (pills, buttons)

═══════════════════════════════════════
PART 2 — COMPONENT LIBRARY
(Build all as reusable components with variants)
═══════════════════════════════════════

COMPONENT: Button
  Variants:
    Type: Primary | Secondary | Ghost | Destructive
    Size: LG (52px h, 24px 40px padding) | MD (44px h) | SM (36px h)
    State: Default | Hover | Pressed | Disabled | Loading (spinner)
  
  Primary: bg Brand/Emerald, white text, DM Sans SemiBold 16px, 
           Radius/Full, Shadow/Glow on hover, scale 1.02
  Secondary: bg Brand/Indigo, white text, same sizing
  Ghost: transparent bg, Brand/Indigo border 1.5px, Brand/Indigo text

COMPONENT: Badge/Pill
  Variants: Type (Exact | Fuzzy | New | Violation | Success | Warning)
  Sizes: SM | MD
  
  Exact:     bg Brand/Emerald-Light, text Brand/Emerald, 
             "● 100% Exact" with a filled circle prefix
  Fuzzy:     bg #DBEAFE, text #1D4ED8, "◈ 92% Fuzzy"
  New:       bg #F1F5F9, text UI/Slate, "○ AI Translated"
  Violation: bg #FEE2E2, text #DC2626, "⚠ Glossary Violation"

COMPONENT: Navigation Bar
  Height: 72px, full width
  State: Transparent (on hero) | Frosted (scrolled, white/85% + blur 12px)
  
  Left: "ClearLingo" wordmark — "Clear" in Brand/Indigo bold, 
        "Lingo" in Brand/Emerald bold, 22px DM Sans Black
  Center: 5 nav links — Label/Caps style, UI/Slate color, 
          24px gap between links. Active state: Brand/Indigo + 
          2px Emerald underline
  Right: "Request Demo" Button/Primary/MD

COMPONENT: Section Label
  A reusable eyebrow/label above section headlines:
  Text: Label/Caps style, color UI/Slate-Light
  Left accent: 2px × 16px Brand/Emerald rectangle, vertically centered, 
               8px gap to text

COMPONENT: Feature Card (System Card)
  Size: 380px W × 480px H, Radius/LG, bg UI/White, 
        border 1px UI/Border, Shadow/MD
  
  Internal layout (auto-layout vertical, 32px padding, 24px gap):
    Top: Step number "01" — Display/H2, Brand/Emerald
    Middle: Card title — Display/H4, Brand/Indigo
    Body: Body/MD, UI/Slate, flex-grow to fill space
    Bottom: Badge/Pill component (bottom-aligned)
  
  Hover state: border color → Brand/Emerald, Shadow/LG, 
               translateY -4px (show as lifted)

COMPONENT: Segment Row (TM Editor Row)
  Full width, height 72px, bg UI/White, border-bottom 1px UI/Border
  Auto-layout horizontal, 24px padding, 16px gap, vertically centered
  
  Columns (left to right):
    Col 1 — Status dot: 10px circle 
             (Green=Approved / Yellow=Needs Review / Red=Rejected)
    Col 2 — Badge/Pill component, 140px fixed width
    Col 3 — Source text: Code/MD, UI/Slate, flex 1
    Col 4 — Divider: 1px vertical, UI/Border, 48px tall
    Col 5 — Target text: Code/MD, Brand/Indigo, flex 1, editable style 
             (subtle background #F8FAFC, rounded 8px, padding 8px 12px)
    Col 6 — Action group: [✓ Approve] [↺ Revert] — appear on hover row

COMPONENT: Pricing Card
  Size: 360px W, auto height, Radius/LG
  Variants: Standard | Featured (Featured has Emerald 3px top border + 
            "Most Popular" badge absolute top-right)
  
  Layout: auto-layout vertical, 40px padding, 24px gap
    • Plan name: Body/SM Label/Caps style, UI/Slate
    • Price: Display/H2, Brand/Indigo (strike-through red for "Old Price")
    • Per unit: Body/SM, UI/Slate
    • Divider: 1px UI/Border
    • Feature list: 5–6 items, Body/MD, 12px gap, 
                    ✓ icon in Brand/Emerald or ✗ in Status/Error
    • CTA Button: full width, at bottom

COMPONENT: Research Card (Glass)
  Size: auto, Radius/LG, bg rgba(255,255,255,0.06), 
        border 1px rgba(255,255,255,0.12)
  (Used on dark Brand/Indigo background sections)
  
  Layout: auto-layout vertical, 32px padding, 16px gap
    • arXiv/source ID: Code/SM, Brand/Emerald
    • Paper title: Body/LG SemiBold, white
    • Description: Body/MD, rgba(255,255,255,0.65)

COMPONENT: Language Pill Card
  Size: auto (min 160px), Radius/MD, bg UI/White, 
        border 1px UI/Border, padding 16px 24px
  
  Layout: auto-layout vertical, 8px gap
    • Language English name: Body/SM Bold, Brand/Indigo
    • Native script name: Code/SM, UI/Slate
    • Bottom-right: 8px Emerald dot (status indicator)

COMPONENT: Code Block
  Radius/LG, bg Brand/Indigo (#1E1B4B), padding 24px 28px
  
  Top bar: 3 circles (12px) — red #FF5F57, yellow #FFBD2E, green #28CA42 
           — 8px gap between them (macOS traffic lights)
  
  Code area: JetBrains Mono 13px, line-height 200%
  Syntax highlighting colors:
    Keywords (const, function, return): #C084FC (purple)
    Strings: Brand/Emerald
    Numbers: #FCD34D (yellow)
    Comments: rgba(255,255,255,0.35)
    Default: rgba(255,255,255,0.85)

COMPONENT: Stat Counter Card
  Size: 200px W × 160px H, Radius/LG, bg UI/White, 
        border 1px UI/Border, padding 24px
  
  Layout: auto-layout vertical, 8px gap, center-aligned
    • Big number: Display/H2, Brand/Indigo (e.g. "94%")
    • Label: Label/Caps, UI/Slate (e.g. "TM LEVERAGE")
    • Trend: Body/SM, Brand/Emerald, "↑ +12% this month"

═══════════════════════════════════════
PART 3 — ALL SCREENS
(Desktop 1440px wide. Create mobile 390px variant for each.)
═══════════════════════════════════════

──────────────────────────────────────
SCREEN 1: Loading Screen
Frame: 1440 × 900px, bg Brand/Indigo (#1E1B4B)

Center of frame:
  • One large circle/orb: 48px diameter, bg Brand/Emerald, 
    Shadow/Glow effect — positioned mid-screen
  • Show it at 3 positions to imply bounce animation: 
    top (50% from top), mid (70%), bottom (85%) — use opacity to ghost 
    the trail positions
  • Below orb: Display/Hero text "0%" centered, white
  • Below that: Label/Caps text "PROCESSING LANGUAGE..." 
    letter-spacing 3px, UI/Slate-Light
  • Bottom center (fixed): Body/SM italic white/60% 
    "You've landed on an AI translation platform. Prepare to rethink 
    how language works."

──────────────────────────────────────
SCREEN 2: Home — Full Landing Page (1440px wide artboard, full height)
Build as a single tall artboard. Each section clearly labeled in layers.

[SECTION: NAV]
Navigation Bar component, transparent state, absolute top.

[SECTION: HERO]
Full-viewport height (900px), bg UI/White, centered content, 
max-width 1280px.

Left column (55% width), vertically centered:
  • Section Label: "AI Translation Studio"
  • Two-line massive headline, Display/Hero size (96px):
      Line 1: "Translate Once." — Brand/Indigo, left-aligned
      Line 2: "Remember Forever." — Brand/Emerald, left-aligned
  • Body/LG text below (max-width 520px, UI/Slate): 
    "ClearLingo combines Semantic Vector Memory, Constrained LLM 
    Translation, and a Human-in-the-Loop approval engine. 94% of 
    your translations are served from memory — for free."
  • Button group (32px gap): [Request Demo — Primary/LG] 
                              [View Architecture — Ghost/LG]
  • Below buttons: 3 inline stat chips in a row (16px gap each):
      Each chip: Body/SM, Brand/Indigo bold + Label/Caps UI/Slate
      "94%" TM Leverage  |  "22" Indic Languages  |  "90%" Cost Reduction

Right column (45% width):
  A floating card panel (Shadow/LG, Radius/XL, bg UI/White, 
  border 1px UI/Border, padding 32px):
    • Mini nav bar inside: "Translation Editor" label + 3 dot menu
    • 4 Segment Row components stacked:
        Row 1: Exact badge + source EN text + Hindi translation ✓ Approved (green dot)
        Row 2: Fuzzy 87% badge + source EN text + Hindi translation (yellow dot)
        Row 3: AI Translated badge + source EN text + Hindi text (yellow dot)
        Row 4: Violation badge + source EN text + red-tinted Hindi (red dot)
    • Bottom bar inside card: "4 segments | TM Leverage: 75% | 
      ₹4,000 saved" — Label/Caps, UI/Slate

Bottom of hero section: centered downward chevron icon, UI/Border color.

[SECTION: MARQUEE TICKER]
Full-width band, height 64px, bg Brand/Indigo
Single horizontal row of text items separated by Emerald diamond ◆:
  "94% TM Leverage Rate"  ◆  "90% Cost Reduction"  ◆  
  "22 Indian Languages"  ◆  "< 3ms Vector Search"  ◆  
  "Glossary Compliance 99.8%"  ◆  "Zero External Dependencies"  ◆  
  "₹36,00,000 / yr Saved"  ◆  "Atomic Continuous Learning"  ◆
Font: Body/SM Medium, white. Show items overflowing left and right 
to imply scroll motion. Duplicate row offset by 50% to show infinite 
loop state.

[SECTION: THE 4 SYSTEMS]
bg UI/White, 120px vertical padding.

Top row: 
  Left — Section Label + Display/H2 "The Four Engines Behind 94% Leverage"
  Right — Body/LG, UI/Slate, max-width 400px, 
          "A pipeline where every layer enforces the last."

Below: Horizontal scrollable row of 4 Feature Cards (380×480).
Show cards with 32px gap. First card fully visible, 4th card 
cropped at right edge to imply scrollability.
Add a pill button below-right: "← drag to explore →" — 
Ghost/SM style, UI/Slate.

[SECTION: HOW IT WORKS]
bg UI/Surface (#F8FAFC), 120px vertical padding.

Top: Section Label "process" + Display/H2 "From Upload to Institutional Memory"
     on left. Right: Body/LG, max-width 400px.

Below: 7 step rows. Each row: 1280px wide, 80px vertical padding between rows.
Alternating layout — odd rows: text 50% left + code block 50% right.
Even rows: code block 50% left + text 50% right.

Each text side:
  • Step counter: Label/Caps Brand/Emerald "01."
  • Display/H3 step title, Brand/Indigo
  • Body/LG description, UI/Slate, max-width 440px

Each code side: Code Block component, 520px wide.

Between rows: a 1px dashed vertical line, Brand/Emerald, centered 
on the step number — 40px tall connectors between each step.

Step content:
  01. Document Ingestion
      "mammoth.js and pdf-parse extract paragraphs from DOCX and PDF 
      files. A regex boundary detector produces clean segments — 
      never splitting on 'Dr.' or 'U.S.'"
      Code: shows segment array structure with id, sourceText, status fields

  02. Source Quality Validation
      "Before translation, 5 parallel audits run: spell check, 
      terminology clustering, date normalization, punctuation, and 
      segment length flags. Errors caught here don't multiply 
      across 22 languages."
      Code: shows /api/validate response JSON with qualityScore: 87

  03. Semantic TM Lookup
      "Three-tier search: exact string match (< 1ms), then vector 
      cosine similarity across all stored 768-dim embeddings 
      (< 3ms). Score ≥ 0.95 = reuse directly. No LLM needed."
      Code: shows cosineSimilarity function in TypeScript

  04. Constrained LLM Translation
      "Only new segments reach the LLM. Gemini 1.5 Flash handles 
      European. AI4Bharat IndicTrans2 handles 22 Indian languages. 
      Glossary terms are injected as hard constraints."
      Code: shows the prompt template with glossary injection

  05. Glossary Regex Verification
      "A deterministic post-check verifies every mandated glossary 
      term exists in the LLM output using word-boundary regex. 
      Violations are flagged before the reviewer ever sees them."
      Code: shows regex check with \b boundary, violation flag

  06. Human Side-by-Side Review
      "An AgGrid editor shows source and target side by side. 
      The linguist reads, edits, and approves. Raw LLM output 
      never enters the TM — only human-approved translations do."
      Code: shows Segment interface with status, violation fields

  07. Atomic TM Write
      "On approval, an atomic SQLite INSERT stores the translation 
      pair alongside its 768-dim embedding vector. The next 
      identical or paraphrased segment resolves instantly — forever."
      Code: shows INSERT INTO tm_records SQL statement

[SECTION: COMPETITIVE TABLE]
bg UI/White, 120px vertical padding.

Top: Section Label "why clearlingo?" + Display/H2 
     "DeepL translates. ClearLingo remembers."
Sub: Body/XL, UI/Slate "Every other tool is stateless. We compound."

Below: A full-width table, Radius/LG, border 1px UI/Border, 
overflow hidden.
  Header row: bg UI/Surface, 72px height.
    Col headers: "Feature" | "Trados" | "Smartcat" | "DeepL" | "ClearLingo"
    ClearLingo column header: bg Brand/Emerald, white text, 
                               DM Sans Bold, centered
  
  7 data rows, alternating bg: white / UI/Surface, 64px height each:
    Semantic TM Matching:     String    String    None     ✓ Vector Cosine
    Source Validation:        ✗         ✗         ✗        ✓ 5-Point Audit
    Glossary Enforcement:     ⚠ Manual  ⚠ Manual  None     ✓ Prompt + Regex
    Continuous Learning:      ⚠ Manual  ⚠ Manual  None     ✓ Atomic Auto
    Browser Deployment:       ✗ Desktop ✓ Cloud   ✓ API    ✓ Browser-Only
    22 Indian Languages:      ✗         ✗         ✗        ✓ IndicTrans2
    Zero External DBs:        ✗         ✗         —        ✓ SQLite Only

  ✓ = Brand/Emerald icon + text. ✗ = Status/Error icon + text. 
  ⚠ = Status/Warning icon + text.
  ClearLingo column cells: bg Brand/Emerald-Light (#D1FAE5), 
  Brand/Emerald bold text.

[SECTION: 22 LANGUAGES]
bg UI/Surface, 120px vertical padding.

Top: Section Label "language coverage" + Display/H2 
     "From Hindi to Odia. Every word counts."
Sub: Body/LG, UI/Slate, max-width 600px 
     "Powered by AI4Bharat's IndicTrans2 — government-backed, 
     open-source, enterprise-grade translation for all 22 
     official Indian languages."

Below: CSS auto grid of Language Pill Card components.
5 columns on desktop, 3 on tablet.
All 22 languages:
  Hindi (हिन्दी) | Marathi (मराठी) | Tamil (தமிழ்) | 
  Telugu (తెలుగు) | Bengali (বাংলা) | Gujarati (ગુજરાતી) | 
  Kannada (ಕನ್ನಡ) | Malayalam (മലയാളം) | Odia (ଓଡ଼ିଆ) | 
  Punjabi (ਪੰਜਾਬੀ) | Assamese (অসমীয়া) | Urdu (اردو) | 
  Konkani | Bodo | Dogri | Kashmiri | Maithili | 
  Manipuri (মৈতৈলোন্) | Nepali (नेपाली) | Sanskrit (संस्कृतम्) | 
  Santali | Sindhi (سنڌي)

[SECTION: ROI / PRICING]
bg UI/White, 120px vertical padding.

Top: Section Label "cost of translation" + Display/H2 
     "₹40,000 per document. Or ₹4,000."
Sub: Body/LG, UI/Slate "After TM seeding — 90% cost reduction."

Below: 3 Pricing Card components in a row, 32px gap, centered.
  Card 1: Standard variant — "Traditional Agency" — ₹40,000 
          (red strikethrough) — 6 negative bullets — gray CTA
  Card 2: Featured variant — "ClearLingo Enterprise" — ₹4,000 
          — "Most Popular" badge — 6 positive bullets — Emerald CTA
  Card 3: Standard variant — "Call Center ROI" — ₹30,00,000/yr 
          avoided — 3 ROI bullets — Indigo ghost CTA

Below cards: Body/SM, UI/Slate, centered, italic:
  "Based on real enterprise deployment data. 100 documents/year @ 
  agency rates vs. ClearLingo TM leverage."

[SECTION: RESEARCH]
bg Brand/Indigo (#1E1B4B), 120px vertical padding.

Top: Section Label (white) + Display/H2 white 
     "Built on peer-reviewed research."
Sub: Body/LG, Brand/Emerald "Not a wrapper. A system."

Below: 2×2 grid of Research Card (Glass) components, 24px gap.
  Card 1: arXiv:2505.20096 | MA-RAG | 
          "Multi-Agent Retrieval-Augmented Generation context 
          orchestration — the theoretical backbone of MAAR."
  Card 2: EMNLP 2025 | RAGtrans | 
          "Retrieval-Augmented Machine Translation. ClearLingo's 
          94% TM leverage smashes this published baseline."
  Card 3: arXiv:2407.01463 | Multilingual RAG Pipeline | 
          "Zero-shot multilingual RAG directly inspiring the 
          English → Hindi / Tamil / Telugu pipeline."
  Card 4: AI4Bharat | IndicTrans2 | 
          "Government-backed, open-source sequence-to-sequence 
          translation for all 22 official Indian languages."

[SECTION: FINAL CTA]
bg UI/White, full viewport height (900px), 
flex column centered both axes.

  • Display/Hero text centered, 2 lines:
      "Ready to" — Brand/Indigo
      "remember?" — Brand/Emerald
  • Body/XL centered, UI/Slate, max-width 560px:
    "While others built LLM wrappers, we built institutional 
    memory. Every approval compounds. Every match is free. 
    The system gets smarter so you don't have to translate twice."
  • Button group centered (32px gap):
    [Request Demo — Primary/LG] [Read the Docs — Ghost/LG]
  • Body/SM, UI/Slate-Light, centered, 32px below buttons:
    "Built for enterprise. Designed for India. 
    Running entirely on Next.js + SQLite."

[SECTION: FOOTER]
bg Dark/900 (#0F0D2E), 80px vertical padding.

4-column layout, 1280px max-width, 32px gap:
  Col 1 (wider): 
    ClearLingo wordmark (same style as nav)
    Body/MD, rgba(255,255,255,0.50), 16px below:
    "Semantic memory for enterprise translation. 
    MAAR Architecture. 22 Indian Languages."
    32px below: social/contact icons row

  Col 2: Label/Caps "Product" white + 
    links: Body/SM, rgba(255,255,255,0.65)
    How It Works / Languages / Architecture / Demo / Pricing

  Col 3: Label/Caps "Research" white + 
    links: Body/SM, rgba(255,255,255,0.65)
    MA-RAG Paper / RAGtrans / IndicTrans2 / FLORES-200

  Col 4: Label/Caps "Built With" white + 
    tech stack list: Body/SM, rgba(255,255,255,0.65)
    Next.js 14 App Router / SQLite + better-sqlite3 / 
    Gemini 1.5 Flash / AI4Bharat IndicTrans2 / 
    text-embedding-004 / Framer Motion 11

Bottom divider: 1px rgba(255,255,255,0.10), 32px above bottom bar.
Bottom bar: 
  Left: Body/SM rgba(255,255,255,0.40) 
        "© 2025 ClearLingo. All rights reserved."
  Right: Body/SM rgba(255,255,255,0.40) 
         "BLEU. Cosine. Human-approved."

──────────────────────────────────────
SCREEN 3: Translation Editor (Full App Screen)
Frame: 1440 × 900px

Left sidebar (260px): bg Brand/Indigo, full height
  • ClearLingo wordmark at top, 24px padding
  • Nav items: Label/Caps white/60%, 
    active item: white text + left 3px Emerald bar + bg white/8%
  • Items: Dashboard / Projects / Glossary / Analytics / Settings
  • Bottom: user avatar + name + role pill

Top bar (64px): bg UI/White, border-bottom 1px UI/Border
  • Left: Breadcrumb "Projects > Policy Document 2024 > Hindi"
  • Center: 3 tab pills — "Validation" | "Translation" | "Review" 
            (Translation is active — Emerald underline)
  • Right: Language selector dropdown + "Export DOCX" Button/Primary/SM

Main content (remaining width): bg UI/Surface
  Split into left panel (280px) and right panel (flex):
  
  Left panel: bg UI/White, border-right 1px UI/Border, padding 24px
    • Section: "TM Stats" — Stat Counter Cards 2×2 mini grid
      "94%" TM Leverage / "87" Quality Score / 
      "12" Approved / "3" Violations
    • Section: "Glossary Preview" — 
      list of term pairs (EN → HI), Body/SM, 16px gap
    • Section: "Style Profile" — 
      "Professional, General Purpose" pill

  Right panel: full height, bg UI/Surface, padding 24px
    • Column headers row: 
      Label/Caps UI/Slate "STATUS" (80px) | 
      "TM MATCH" (160px) | "SOURCE (EN)" (flex) | 
      "TARGET (HI)" (flex) | "ACTIONS" (96px)
    • 8 Segment Row components stacked with 1px UI/Border dividers:
        Row 1: ✓ Approved, [100% Exact], EN text, HI text, dimmed
        Row 2: ✓ Approved, [100% Exact], EN text, HI text, dimmed
        Row 3: ● Needs Review, [92% Fuzzy], EN text, HI text (active/focused)
        Row 4: ● Needs Review, [AI Translated], EN text, HI text
        Row 5: ● Needs Review, [AI Translated], EN text, HI text
        Row 6: ⚠ Violation, [AI Translated + ⚠], EN text, 
                HI text (red-tinted bg #FEF2F2)
        Row 7: ● Needs Review, [AI Translated], EN text, HI text
        Row 8: ● Needs Review, [AI Translated], EN text, HI text
    
    • Active row (Row 3): slightly elevated — bg UI/White, 
      Shadow/SM, border 1px Brand/Emerald — to show focused state.
      Target cell shows editable textarea style with cursor.

──────────────────────────────────────
SCREEN 4: Analytics Dashboard
Frame: 1440 × 900px (same sidebar + top bar as Screen 3)

Main content: 24px padding grid

Row 1: 4 large Stat Counter Cards full-width, evenly spaced
  "94% TM Leverage" / "₹36L Saved" / "1,247 Segments" / "99.8% Glossary"

Row 2 (2 columns):
  Left (60%): Line chart — "TM Growth Over Time" — 
    x-axis: last 7 days, y-axis: TM record count
    Line in Brand/Emerald, area fill Brand/Emerald-Light, 
    Radius/LG white card container, Shadow/SM
  
  Right (40%): Donut chart — "Segment Classification" — 
    3 segments: Exact (Emerald 52%) / Fuzzy (Blue 42%) / New (Slate 6%)
    Center label: "94%" in Display/H2 Brand/Indigo
    Legend below: 3 rows with colored dots + labels + counts

Row 3 (2 columns):
  Left (40%): Bar chart — "Cost Savings by Project" — 
    horizontal bars, Brand/Indigo fill, 5 project rows
  Right (60%): Table — "Recent Approvals" — 
    5 rows: segment preview | language | reviewer | time | status badge

──────────────────────────────────────
SCREEN 5: Mobile — Home (390px wide)
All sections from Screen 2 reflow as single column.
Key differences:
  • Hero: Headline drops to 48px, both lines left-aligned stacked
  • Hero preview card: full width, simplified 3 rows only
  • 4 Systems: single card visible, cards scroll horizontally
  • Process steps: always text above, code block below, full width
  • Comparison table: horizontal scroll, sticky first column
  • Language grid: 2-column grid
  • Pricing cards: stacked vertically
  • Research cards: stacked 1-column
  • Nav: hamburger → full-screen Indigo overlay

═══════════════════════════════════════
PART 4 — LAYER NAMING CONVENTION
Name every layer precisely:
  Pages: 00_Loading / 01_Home / 02_Editor / 03_Analytics / 04_Mobile-Home
  Sections: SECTION/Hero / SECTION/Marquee / SECTION/Systems etc.
  Components: Use exact component names from Part 2 above.
  All components: placed in a dedicated "🧱 Components" page.
  All color/text styles: placed in a "🎨 Design Tokens" page.
  Use emoji prefixes on major layer groups for visual scanning.
═══════════════════════════════════════