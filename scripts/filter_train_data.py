"""
Filter and score EN→HI translation pairs from Samanantar/IITB seed data
for fine-tuning a Hindi translation model.

Outputs: filtered_train_data.jsonl (instruction-tuning format)
Dependencies: stdlib only (json, re, collections)
"""

import json
import re
from collections import Counter

# ─── Configuration ───────────────────────────────────────────────────────────

INPUT_PATH = "data_seeds/samanantar_iitb_en_hi_seed.json"
OUTPUT_PATH = "filtered_train_data.jsonl"

MIN_WORDS = 5
MAX_WORDS = 50
MAX_ENGLISH_RATIO = 0.30
TOP_K = 5000

# Domain glossary — terms that signal high-value training pairs
GLOSSARY = [
    "authorization", "indemnity", "invoice", "patient",
    "clause", "payment", "contract", "diagnosis",
]

# ─── Helpers ─────────────────────────────────────────────────────────────────

def word_count(text):
    """Count words by splitting on whitespace."""
    return len(text.split())


def english_char_ratio(text):
    """
    Fraction of alphabetic characters in `text` that are ASCII letters.
    Returns 0.0 if there are no alphabetic characters at all.
    """
    alpha_chars = [ch for ch in text if ch.isalpha()]
    if not alpha_chars:
        return 0.0
    english_chars = [ch for ch in alpha_chars if ch.isascii()]
    return len(english_chars) / len(alpha_chars)


def is_same_text(source, target):
    """Check if source and target are effectively identical (untranslated)."""
    return source.strip().lower() == target.strip().lower()


# ─── Filter ──────────────────────────────────────────────────────────────────

def passes_filter(pair):
    """
    Return True if the pair survives all quality filters.
    """
    src = pair.get("source", "").strip()
    tgt = pair.get("target", "").strip()

    # 1. Empty check
    if not src or not tgt:
        return False

    # 2. Word-count bounds (applied to source — the English side)
    wc = word_count(src)
    if wc < MIN_WORDS or wc > MAX_WORDS:
        return False

    # 3. Identical source/target (untranslated)
    if is_same_text(src, tgt):
        return False

    # 4. Target contains too much English (poorly translated)
    if english_char_ratio(tgt) > MAX_ENGLISH_RATIO:
        return False

    return True


# ─── Score (0–100) ───────────────────────────────────────────────────────────

def score_pair(pair):
    """
    Score a translation pair from 0–100 based on three factors:
      • Length ratio between source and target  (0–35 points)
      • Glossary overlap                        (0–30 points)
      • Sentence length sweet spot (10–30 words) (0–35 points)
    """
    src = pair["source"].strip()
    tgt = pair["target"].strip()

    src_words = word_count(src)
    tgt_words = word_count(tgt)

    # ── 1. Length-ratio score (max 35) ────────────────────────────────────
    # Hindi translations are typically 0.8×–1.5× the English word count.
    # Penalise extreme mismatches progressively.
    if tgt_words == 0:
        ratio_score = 0.0
    else:
        ratio = src_words / tgt_words
        # Ideal band: 0.6–1.8  →  full marks
        if 0.6 <= ratio <= 1.8:
            ratio_score = 35.0
        else:
            deviation = min(abs(ratio - 0.6), abs(ratio - 1.8))
            ratio_score = max(0.0, 35.0 - deviation * 20.0)

    # ── 2. Glossary overlap score (max 30) ────────────────────────────────
    src_lower = src.lower()
    hits = sum(1 for term in GLOSSARY if term in src_lower)
    # Each hit is worth 10 pts, capped at 30
    glossary_score = min(hits * 10.0, 30.0)

    # ── 3. Length sweet-spot score (max 35) ───────────────────────────────
    # Peak at 10–30 words; gentle roll-off outside that band.
    if 10 <= src_words <= 30:
        length_score = 35.0
    elif src_words < 10:
        length_score = 35.0 * (src_words / 10.0)
    else:  # src_words > 30
        length_score = max(0.0, 35.0 * (1.0 - (src_words - 30) / 20.0))

    total = ratio_score + glossary_score + length_score
    return round(min(total, 100.0), 2)


# ─── Main ────────────────────────────────────────────────────────────────────

def main():
    # Load
    with open(INPUT_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)

    total_loaded = len(data)
    print(f"[1/4] Loaded {total_loaded:,} pairs from {INPUT_PATH}")

    # Filter
    filtered = [p for p in data if passes_filter(p)]
    print(f"[2/4] After filtering: {len(filtered):,} pairs "
          f"(removed {total_loaded - len(filtered):,})")

    # Score & sort
    scored = [(score_pair(p), p) for p in filtered]
    scored.sort(key=lambda x: x[0], reverse=True)

    # Take top-K
    export_set = scored[:TOP_K]
    num_exported = len(export_set)

    # Export as JSONL in instruction-tuning format
    with open(OUTPUT_PATH, "w", encoding="utf-8") as out:
        for score, pair in export_set:
            record = {
                "prompt": f"Translate from en to hi:\n{pair['source'].strip()}",
                "completion": pair["target"].strip(),
            }
            out.write(json.dumps(record, ensure_ascii=False) + "\n")

    avg_score = (sum(s for s, _ in export_set) / num_exported) if num_exported else 0.0

    # ── Summary ──────────────────────────────────────────────────────────
    print(f"[3/4] Exported {num_exported:,} pairs → {OUTPUT_PATH}")
    print(f"[4/4] Summary:")
    print(f"       Total pairs loaded   : {total_loaded:,}")
    print(f"       Pairs after filtering : {len(filtered):,}")
    print(f"       Pairs exported        : {num_exported:,}")
    print(f"       Average score         : {avg_score:.2f}")

    # Score distribution
    if export_set:
        brackets = Counter()
        for s, _ in export_set:
            bucket = int(s // 10) * 10
            brackets[bucket] += 1
        print("\n       Score distribution:")
        for bucket in sorted(brackets.keys(), reverse=True):
            bar = "█" * (brackets[bucket] // 2 or 1)
            print(f"         {bucket:>3}–{bucket+9:<3} : {brackets[bucket]:>4}  {bar}")


if __name__ == "__main__":
    main()
