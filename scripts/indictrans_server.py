#!/usr/bin/env python3
"""
IndicTrans2 Translation Microservice for ClearLingo
====================================================

Flask server wrapping IndicTransToolkit to provide local neural machine
translation for all 22 scheduled Indian languages.

Models:
  - ai4bharat/indictrans2-en-indic-dist-200M  (English → Indic)
  - ai4bharat/indictrans2-indic-en-1B          (Indic → English)

Endpoints:
  POST /translate       — Single text translation
  POST /translate/batch — Batch translation (array)
  GET  /health          — Model readiness check

Usage:
  python scripts/indictrans_server.py
"""

import os
import sys
import time
import json
import logging
from pathlib import Path

# Load .env from project root
_env_path = Path(__file__).resolve().parent.parent / ".env"
if _env_path.exists():
    with open(_env_path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, val = line.partition("=")
                os.environ.setdefault(key.strip(), val.strip())

# Add IndicTransToolkit to path
TOOLKIT_PATH = Path(__file__).resolve().parent.parent / "IndicTransToolkit"
if TOOLKIT_PATH.exists():
    sys.path.insert(0, str(TOOLKIT_PATH))

# ═══════════════════════════════════════════════════════════════
# Language Code Mapping: ClearLingo → IndicTrans2 (Flores-200)
# ═══════════════════════════════════════════════════════════════

CLEARLINGO_TO_INDICTRANS = {
    # ── English (source) ──
    "en":     "eng_Latn",
    "en_US":  "eng_Latn",
    "en_IN":  "eng_Latn",

    # ── 22 Scheduled Indian Languages ──
    "hi_IN":  "hin_Deva",   # Hindi
    "bn_IN":  "ben_Beng",   # Bengali
    "ta_IN":  "tam_Taml",   # Tamil
    "te_IN":  "tel_Telu",   # Telugu
    "mr_IN":  "mar_Deva",   # Marathi
    "gu_IN":  "guj_Gujr",   # Gujarati
    "kn_IN":  "kan_Knda",   # Kannada
    "ml_IN":  "mal_Mlym",   # Malayalam
    "pa_IN":  "pan_Guru",   # Punjabi
    "or_IN":  "ory_Orya",   # Odia
    "as_IN":  "asm_Beng",   # Assamese
    "ur_PK":  "urd_Arab",   # Urdu
    "ne_NP":  "npi_Deva",   # Nepali
    "sa_IN":  "san_Deva",   # Sanskrit
    "mai_IN": "mai_Deva",   # Maithili
    "kok_IN": "kok_Deva",   # Konkani
    "doi_IN": "doi_Deva",   # Dogri
    "sd_IN":  "snd_Deva",   # Sindhi (Devanagari script variant)
    "ks_IN":  "kas_Arab",   # Kashmiri
    "mni_IN": "mni_Mtei",   # Manipuri (Meitei script)
    "brx_IN": "brx_Deva",   # Bodo
    "sat_IN": "sat_Olck",   # Santali
    "si_LK":  "sin_Sinh",   # Sinhala
}

# Indic language codes (everything except english variants)
INDIC_CODES = {k for k, v in CLEARLINGO_TO_INDICTRANS.items()
               if k not in ("en", "en_US", "en_IN")}
ENGLISH_CODES = {"en", "en_US", "en_IN"}

# ═══════════════════════════════════════════════════════════════
# Model Loading (both directions)
# ═══════════════════════════════════════════════════════════════

logging.basicConfig(level=logging.INFO, format="[IndicTrans2] %(message)s")
log = logging.getLogger("indictrans2")

# Global model state — two models for bidirectional translation
_en2indic_model = None
_en2indic_tokenizer = None
_indic2en_model = None
_indic2en_tokenizer = None
_ip = None
_device = "cpu"
_ready = False
_load_error = None
_en2indic_model_name = "ai4bharat/indictrans2-en-indic-dist-200M"
_indic2en_model_name = "ai4bharat/indictrans2-indic-en-1B"


def load_models():
    """Load both IndicTrans2 models + tokenizers + IndicProcessor."""
    global _en2indic_model, _en2indic_tokenizer
    global _indic2en_model, _indic2en_tokenizer
    global _ip, _device, _ready, _load_error

    try:
        import torch
        from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

        # Import our pure-Python IndicProcessor (Windows-compatible, no Cython needed)
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            "indic_processor",
            str(Path(__file__).resolve().parent / "indic_processor.py")
        )
        ip_module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(ip_module)
        IndicProcessor = ip_module.IndicProcessor

        _device = "cuda" if torch.cuda.is_available() else "cpu"
        gpu_name = torch.cuda.get_device_name(0) if torch.cuda.is_available() else "N/A"
        log.info(f"Device: {_device} ({gpu_name})")

        # HuggingFace token for gated model access
        hf_token = os.environ.get("HF_TOKEN", None)
        if hf_token:
            log.info("Using HF_TOKEN for gated model access")

        # ── Model 1: English → Indic (200M distilled, fast) ──
        log.info(f"Loading EN→Indic model: {_en2indic_model_name} ...")
        _en2indic_tokenizer = AutoTokenizer.from_pretrained(
            _en2indic_model_name, trust_remote_code=True, token=hf_token
        )
        _en2indic_model = AutoModelForSeq2SeqLM.from_pretrained(
            _en2indic_model_name, trust_remote_code=True, token=hf_token
        ).to(_device)
        _en2indic_model.eval()
        log.info(f"✅ EN→Indic model loaded on {_device}")

        # ── Model 2: Indic → English (1B, higher quality) ──
        log.info(f"Loading Indic→EN model: {_indic2en_model_name} ...")
        _indic2en_tokenizer = AutoTokenizer.from_pretrained(
            _indic2en_model_name, trust_remote_code=True, token=hf_token
        )
        _indic2en_model = AutoModelForSeq2SeqLM.from_pretrained(
            _indic2en_model_name, trust_remote_code=True, token=hf_token
        ).to(_device)
        _indic2en_model.eval()
        log.info(f"✅ Indic→EN model loaded on {_device}")

        # ── Shared processor ──
        _ip = IndicProcessor(inference=True)
        _ready = True
        log.info("✅ Both models loaded and ready!")

    except Exception as e:
        _load_error = str(e)
        _ready = False
        log.error(f"❌ Failed to load models: {e}")
        import traceback
        traceback.print_exc()


def _select_model_and_tokenizer(src_flores, tgt_flores):
    """Select the correct model based on translation direction using Flores codes."""
    src_is_english = src_flores == "eng_Latn"
    tgt_is_english = tgt_flores == "eng_Latn"

    if src_is_english and not tgt_is_english:
        # English → Indic
        return _en2indic_model, _en2indic_tokenizer, _en2indic_model_name
    elif not src_is_english and tgt_is_english:
        # Indic → English
        return _indic2en_model, _indic2en_tokenizer, _indic2en_model_name
    elif not src_is_english and not tgt_is_english:
        # Indic → Indic: use indic→en model for first hop
        return _indic2en_model, _indic2en_tokenizer, _indic2en_model_name
    else:
        raise ValueError("Cannot translate English to English")


def translate_texts(texts, src_lang_code, tgt_lang_code):
    """
    Translate a list of texts from src_lang to tgt_lang using IndicTrans2.

    Args:
        texts: list of strings
        src_lang_code: IndicTrans2 code (e.g. 'eng_Latn')
        tgt_lang_code: IndicTrans2 code (e.g. 'hin_Deva')

    Returns:
        list of translated strings, elapsed_ms
    """
    import torch

    if not _ready:
        raise RuntimeError("Models not loaded")

    model, tokenizer, model_name = _select_model_and_tokenizer(src_lang_code, tgt_lang_code)

    start = time.time()

    # Preprocess
    log.info(f"Preprocessing {len(texts)} texts [{src_lang_code}→{tgt_lang_code}]...")
    batch = _ip.preprocess_batch(
        texts, src_lang=src_lang_code, tgt_lang=tgt_lang_code
    )
    log.info(f"Preprocessed batch: {batch[:2]}...")

    # Tokenize
    inputs = tokenizer(
        batch,
        truncation=True,
        padding="longest",
        max_length=256,
        return_tensors="pt",
        return_attention_mask=True,
    ).to(_device)
    log.info(f"Tokenized input shape: {inputs['input_ids'].shape}")

    # Generate
    with torch.no_grad():
        generated = model.generate(
            **inputs,
            use_cache=False,
            min_length=0,
            max_length=256,
            num_beams=5,
            num_return_sequences=1,
        )
    log.info(f"Generated shape: {generated.shape}")

    # Decode — handle both old and new tokenizer APIs
    try:
        with tokenizer.as_target_tokenizer():
            decoded = tokenizer.batch_decode(
                generated.detach().cpu().tolist(),
                skip_special_tokens=True,
                clean_up_tokenization_spaces=True,
            )
    except AttributeError:
        # Fallback if as_target_tokenizer() not available
        decoded = tokenizer.batch_decode(
            generated.detach().cpu().tolist(),
            skip_special_tokens=True,
            clean_up_tokenization_spaces=True,
        )
    log.info(f"Decoded: {decoded[:2]}...")

    # Postprocess
    translations = _ip.postprocess_batch(decoded, lang=tgt_lang_code)

    elapsed_ms = round((time.time() - start) * 1000)
    log.info(
        f"[{model_name.split('/')[-1]}] Translated {len(texts)} text(s) "
        f"[{src_lang_code}→{tgt_lang_code}] in {elapsed_ms}ms"
    )

    return translations, elapsed_ms, model_name


# ═══════════════════════════════════════════════════════════════
# Flask App
# ═══════════════════════════════════════════════════════════════

try:
    from flask import Flask, request, jsonify
    from flask_cors import CORS
except ImportError:
    try:
        from flask import Flask, request, jsonify
        CORS = None
        log.warning("flask-cors not installed, CORS disabled")
    except ImportError:
        log.error("Flask not installed. Run: pip install flask flask-cors")
        sys.exit(1)

app = Flask(__name__)
if CORS:
    CORS(app)


@app.route("/health", methods=["GET"])
def health():
    """Health check endpoint."""
    return jsonify({
        "status": "ready" if _ready else "loading",
        "models": {
            "en_to_indic": _en2indic_model_name,
            "indic_to_en": _indic2en_model_name,
        },
        "device": _device,
        "error": _load_error,
        "supportedLanguages": list(INDIC_CODES),
        "languageCount": len(INDIC_CODES),
        "directions": ["en→indic", "indic→en"],
    })


@app.route("/translate", methods=["POST"])
def translate_single():
    """
    Translate a single text.
    Body: { "text": "...", "src_lang": "en", "tgt_lang": "hi_IN" }
    """
    if not _ready:
        return jsonify({"error": "Models not loaded", "detail": _load_error}), 503

    data = request.get_json(force=True)
    text = data.get("text", "")
    src_lang = data.get("src_lang", "en")
    tgt_lang = data.get("tgt_lang", "hi_IN")

    if not text:
        return jsonify({"error": "text is required"}), 400

    # Map ClearLingo codes → IndicTrans2 codes
    src_code = CLEARLINGO_TO_INDICTRANS.get(src_lang)
    tgt_code = CLEARLINGO_TO_INDICTRANS.get(tgt_lang)

    if not src_code:
        return jsonify({"error": f"Unsupported source language: {src_lang}"}), 400
    if not tgt_code:
        return jsonify({"error": f"Unsupported target language: {tgt_lang}"}), 400

    try:
        translations, elapsed_ms, model_name = translate_texts([text], src_code, tgt_code)
        return jsonify({
            "translated_text": translations[0],
            "src_lang": src_lang,
            "tgt_lang": tgt_lang,
            "model": model_name,
            "device": _device,
            "latency_ms": elapsed_ms,
            "engine": "indictrans2",
        })
    except Exception as e:
        log.error(f"Translation error: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/translate/batch", methods=["POST"])
def translate_batch():
    """
    Translate a batch of texts.
    Body: { "texts": ["...", "..."], "src_lang": "en", "tgt_lang": "hi_IN" }
    """
    if not _ready:
        return jsonify({"error": "Models not loaded", "detail": _load_error}), 503

    data = request.get_json(force=True)
    texts = data.get("texts", [])
    src_lang = data.get("src_lang", "en")
    tgt_lang = data.get("tgt_lang", "hi_IN")

    if not texts or not isinstance(texts, list):
        return jsonify({"error": "texts array is required"}), 400

    src_code = CLEARLINGO_TO_INDICTRANS.get(src_lang)
    tgt_code = CLEARLINGO_TO_INDICTRANS.get(tgt_lang)

    if not src_code:
        return jsonify({"error": f"Unsupported source language: {src_lang}"}), 400
    if not tgt_code:
        return jsonify({"error": f"Unsupported target language: {tgt_lang}"}), 400

    try:
        # Chunk into batches of 32 for memory efficiency
        CHUNK_SIZE = 32
        all_translations = []
        total_ms = 0
        used_model = None

        for i in range(0, len(texts), CHUNK_SIZE):
            chunk = texts[i : i + CHUNK_SIZE]
            translations, elapsed_ms, model_name = translate_texts(chunk, src_code, tgt_code)
            all_translations.extend(translations)
            total_ms += elapsed_ms
            used_model = model_name

        return jsonify({
            "translations": all_translations,
            "count": len(all_translations),
            "src_lang": src_lang,
            "tgt_lang": tgt_lang,
            "model": used_model,
            "device": _device,
            "latency_ms": total_ms,
            "engine": "indictrans2",
        })
    except Exception as e:
        log.error(f"Batch translation error: {e}")
        return jsonify({"error": str(e)}), 500


# ═══════════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    port = int(os.environ.get("INDICTRANS_PORT", 5400))

    print()
    log.info("=" * 60)
    log.info("  IndicTrans2 Translation Microservice")
    log.info(f"  Port: {port}")
    log.info(f"  EN→Indic: {_en2indic_model_name}")
    log.info(f"  Indic→EN: {_indic2en_model_name}")
    log.info("=" * 60)
    print()

    # Load models before starting server
    load_models()

    print()
    log.info("Endpoints:")
    log.info("  POST /translate        — Single text")
    log.info("  POST /translate/batch  — Batch texts")
    log.info("  GET  /health           — Status check")
    print()

    app.run(host="0.0.0.0", port=port, debug=False, use_reloader=False)
