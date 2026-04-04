"""
ClearLingo - Multi-Language Dataset Downloader (v2)
Downloads FLORES-200 from HuggingFace Datasets Server API.
No pip install needed — uses only stdlib (urllib + json).
"""

import os
import sys
import json
import time
import urllib.request
import urllib.error

# Fix Windows Unicode output
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

# ═══════════════════════════════════════════════════════════════
# Language Configuration
# Maps ClearLingo code -> FLORES-200 HuggingFace config name
# ═══════════════════════════════════════════════════════════════

LANGUAGES = {
    # Indian Languages
    'hi_IN': {'flores': 'hin_Deva', 'name': 'Hindi'},
    'bn_IN': {'flores': 'ben_Beng', 'name': 'Bengali'},
    'ta_IN': {'flores': 'tam_Taml', 'name': 'Tamil'},
    'te_IN': {'flores': 'tel_Telu', 'name': 'Telugu'},
    'mr_IN': {'flores': 'mar_Deva', 'name': 'Marathi'},
    'gu_IN': {'flores': 'guj_Gujr', 'name': 'Gujarati'},
    'kn_IN': {'flores': 'kan_Knda', 'name': 'Kannada'},
    'ml_IN': {'flores': 'mal_Mlym', 'name': 'Malayalam'},
    'pa_IN': {'flores': 'pan_Guru', 'name': 'Punjabi'},
    'or_IN': {'flores': 'ory_Orya', 'name': 'Odia'},
    'as_IN': {'flores': 'asm_Beng', 'name': 'Assamese'},
    'ur_PK': {'flores': 'urd_Arab', 'name': 'Urdu'},
    'ne_NP': {'flores': 'npi_Deva', 'name': 'Nepali'},
    'sa_IN': {'flores': 'san_Deva', 'name': 'Sanskrit'},
    # European Languages
    'es_ES': {'flores': 'spa_Latn', 'name': 'Spanish'},
    'fr_FR': {'flores': 'fra_Latn', 'name': 'French'},
    'de_DE': {'flores': 'deu_Latn', 'name': 'German'},
    'it_IT': {'flores': 'ita_Latn', 'name': 'Italian'},
    'pt_BR': {'flores': 'por_Latn', 'name': 'Portuguese'},
    'nl_NL': {'flores': 'nld_Latn', 'name': 'Dutch'},
    'ru_RU': {'flores': 'rus_Cyrl', 'name': 'Russian'},
    'pl_PL': {'flores': 'pol_Latn', 'name': 'Polish'},
    'sv_SE': {'flores': 'swe_Latn', 'name': 'Swedish'},
    'tr_TR': {'flores': 'tur_Latn', 'name': 'Turkish'},
    # East Asian
    'ja_JP': {'flores': 'jpn_Jpan', 'name': 'Japanese'},
    'ko_KR': {'flores': 'kor_Hang', 'name': 'Korean'},
    'zh_CN': {'flores': 'zho_Hans', 'name': 'Chinese'},
    # Other
    'ar_SA': {'flores': 'arb_Arab', 'name': 'Arabic'},
    'th_TH': {'flores': 'tha_Thai', 'name': 'Thai'},
    'vi_VN': {'flores': 'vie_Latn', 'name': 'Vietnamese'},
}

EN_FLORES = 'eng_Latn'
OUTPUT_DIR = 'data_seeds'
API_BASE = 'https://datasets-server.huggingface.co/rows'
DATASET = 'facebook/flores'
SPLITS = ['dev', 'devtest']
PAGE_SIZE = 100


def fetch_rows(config, split, offset=0, length=PAGE_SIZE):
    """Fetch rows from HuggingFace Datasets Server API."""
    url = f"{API_BASE}?dataset={DATASET}&config={config}&split={split}&offset={offset}&length={length}"
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'ClearLingo/1.0'})
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            return data.get('rows', [])
    except urllib.error.HTTPError as e:
        if e.code == 429:
            print(f"\n    Rate limited, waiting 5s...")
            time.sleep(5)
            return fetch_rows(config, split, offset, length)
        return []
    except Exception as e:
        return []


def fetch_all_sentences(config, split):
    """Fetch ALL sentences for a language config + split, paginating through the API."""
    sentences = []
    offset = 0
    while True:
        rows = fetch_rows(config, split, offset, PAGE_SIZE)
        if not rows:
            break
        for row in rows:
            cell = row.get('row', {})
            sentence = cell.get('sentence', '').strip()
            if sentence:
                sentences.append(sentence)
        if len(rows) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
        time.sleep(0.15)  # Be polite to the API
    return sentences


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    print("=" * 55)
    print("  ClearLingo - FLORES-200 Dataset Downloader (v2)")
    print(f"  Source: HuggingFace ({DATASET})")
    print(f"  Target languages: {len(LANGUAGES)}")
    print("=" * 55)

    # Step 1: Download English sentences (shared across all pairs)
    print("\n[1/3] Downloading English FLORES sentences...")
    en_sentences = {}
    for split in SPLITS:
        sents = fetch_all_sentences(EN_FLORES, split)
        en_sentences[split] = sents
        print(f"  English {split}: {len(sents)} sentences")
        if len(sents) == 0:
            print(f"  WARNING: Could not fetch English {split} data!")

    total_en = sum(len(s) for s in en_sentences.values())
    if total_en == 0:
        print("\nERROR: Could not download English sentences. Check your internet connection.")
        print("The HuggingFace API (datasets-server.huggingface.co) may be temporarily down.")
        sys.exit(1)

    # Step 2: Download each target language and create pairs
    print(f"\n[2/3] Downloading {len(LANGUAGES)} target languages...")
    grand_total = 0
    summary = []

    for lang_code, lang_info in LANGUAGES.items():
        flores_code = lang_info['flores']
        name = lang_info['name']
        sys.stdout.write(f"  {name} ({lang_code}): ")
        sys.stdout.flush()

        pairs = []
        for split in SPLITS:
            tgt_sents = fetch_all_sentences(flores_code, split)
            en_sents = en_sentences.get(split, [])

            count = min(len(en_sents), len(tgt_sents))
            for i in range(count):
                src = en_sents[i].strip()
                tgt = tgt_sents[i].strip()
                if src and tgt and len(src) > 3 and len(tgt) > 1:
                    pairs.append({
                        "source": src,
                        "target": tgt,
                        "sourceLang": "en",
                        "targetLang": lang_code,
                        "dataset": "flores-200",
                        "domain": "general"
                    })

        if len(pairs) == 0:
            print("No data found")
            continue

        # Deduplicate by source text
        seen = set()
        deduped = []
        for pair in pairs:
            key = pair['source'].lower().strip()
            if key not in seen:
                seen.add(key)
                deduped.append(pair)

        # Save JSON
        output_path = os.path.join(OUTPUT_DIR, f"seed_en_{lang_code}.json")
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(deduped, f, ensure_ascii=False, indent=2)

        grand_total += len(deduped)
        summary.append((name, lang_code, len(deduped)))
        print(f"{len(deduped)} pairs")

    # Summary
    print(f"\n[3/3] SUMMARY")
    print("=" * 55)
    print(f"  {'Language':<15} {'Code':<8} {'Pairs':>8}")
    print("  " + "-" * 35)
    for name, code, total in summary:
        print(f"  {name:<15} {code:<8} {total:>8}")
    print("  " + "-" * 35)
    print(f"  {'GRAND TOTAL':<15} {'':8} {grand_total:>8}")
    print(f"\n  Next: run 'node seed_tm.js' to load into SQLite.")


if __name__ == "__main__":
    main()
