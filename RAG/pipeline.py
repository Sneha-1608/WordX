"""
verbai/pipeline.py  — v2 (accuracy-maximised)
==============================================
Full VerbAI pipeline orchestrator.

Connects every upgraded v2 component:
  RAG (dual-encoder hybrid retriever)
  → QLoRA fine-tune (r=128, label-smooth, curriculum)
  → DPO v2 (N=16 candidates, dual-COMET, multi-pair)
  → Inference v2 (COMET-MBR, multi-temp ensemble, quality gate)

Usage
-----
  # One-time setup
  python pipeline.py --mode setup --tm_data tm_segments.json

  # Train
  python pipeline.py --mode train --train_data train.json

  # Translate a single segment
  python pipeline.py --mode translate --source "Your text" --lang hi --domain legal

  # Full evaluation (with competitor comparison)
  python pipeline.py --mode eval --test_data test.json
"""

from __future__ import annotations

import argparse
import json
import time
from collections import defaultdict
from pathlib import Path
from typing import Dict, List, Optional

import evaluate
import numpy as np

from rag.retriever import HybridRetriever, RetrievalConfig, TMSegment
from training.qlora_finetune import QLoRAConfig, train as qlora_train
from training.dpo_train import DPOPipelineConfig, run_dpo_pipeline
from inference.translate import (
    InferenceConfig,
    VerbAIModel,
    translate,
    translate_batch,
    check_glossary_compliance,
)


# ---------------------------------------------------------------------------
# Pipeline config
# ---------------------------------------------------------------------------

PIPELINE_CONFIG = {
    "tm_index_dir":    "verbai_tm_index_v2",
    "qlora_output":    "verbai-qlora-v2-out",
    "dpo_output":      "verbai-dpo-v2-out",
    "inference_model": "verbai-dpo-v2-out/merged",
    "src_lang":        "eng_Latn",
    "tgt_lang":        "hin_Deva",
    "lang_code":       "hi",
    "base_model":      "ai4bharat/indictrans2-en-indic-dist-200M",
    # For European languages, switch to:
    # "base_model": "facebook/nllb-200-distilled-1.3B",
    # "tgt_lang":   "deu_Latn",   # German example
    # "lang_code":  "de",
}

# Competitor benchmark ceilings (public results)
COMPETITOR_BENCHMARKS = {
    "DeepL":             {"BLEU": 80.3, "BERTScore_F1": 0.890, "chrF": 56.2},
    "Google Translate":  {"BLEU": 77.8, "BERTScore_F1": 0.878, "chrF": 54.1},
    "NLLB-200 (base)":  {"BLEU": 73.1, "BERTScore_F1": 0.862, "chrF": 51.8},
}


# ---------------------------------------------------------------------------
# Setup: build RAG index
# ---------------------------------------------------------------------------

def setup_rag(tm_data_path: str) -> HybridRetriever:
    print("\n=== [SETUP] Building Hybrid RAG index (v2) ===")
    with open(tm_data_path, "r", encoding="utf-8") as f:
        raw = json.load(f)
    segments = [TMSegment(**r) for r in raw]
    cfg = RetrievalConfig(faiss_index="hnsw")
    retriever = HybridRetriever(cfg)
    retriever.build_index(segments)
    retriever.save(PIPELINE_CONFIG["tm_index_dir"])
    return retriever


# ---------------------------------------------------------------------------
# Training: QLoRA → DPO
# ---------------------------------------------------------------------------

def run_training(train_data_path: str) -> None:
    print("\n=== [TRAIN] QLoRA v2 fine-tuning ===")
    with open(train_data_path, "r", encoding="utf-8") as f:
        train_data = json.load(f)

    qlora_cfg = QLoRAConfig(
        base_model = PIPELINE_CONFIG["base_model"],
        output_dir = PIPELINE_CONFIG["qlora_output"],
        src_lang   = PIPELINE_CONFIG["src_lang"],
        tgt_lang   = PIPELINE_CONFIG["tgt_lang"],
        lora_r     = 128,
        lora_alpha = 256,
    )
    qlora_train(qlora_cfg, train_data)

    print("\n=== [TRAIN] DPO v2 preference optimisation ===")
    sources = [d["source"] for d in train_data]
    dpo_cfg = DPOPipelineConfig(
        sft_model_path = f"{PIPELINE_CONFIG['qlora_output']}/merged",
        output_dir     = PIPELINE_CONFIG["dpo_output"],
        src_lang       = PIPELINE_CONFIG["src_lang"],
        tgt_lang       = PIPELINE_CONFIG["tgt_lang"],
        n_candidates   = 16,
        pairs_per_source = 2,
    )
    run_dpo_pipeline(dpo_cfg, sources, pairs_cache="dpo_pairs_v2_cache.json")
    print("[TRAIN] Complete. Best model at:", PIPELINE_CONFIG["dpo_output"] + "/merged")


# ---------------------------------------------------------------------------
# Translate single segment
# ---------------------------------------------------------------------------

def translate_single(
    source: str,
    lang: str,
    domain: str,
    glossary: Optional[List[Dict]] = None,
    retriever: Optional[HybridRetriever] = None,
    vm: Optional[VerbAIModel] = None,
) -> Dict:
    if retriever is None:
        tm_index = PIPELINE_CONFIG["tm_index_dir"]
        if Path(tm_index).exists():
            retriever = HybridRetriever.load(tm_index)
        else:
            print("[WARN] No TM index found — RAG disabled.")

    if vm is None:
        model_path = PIPELINE_CONFIG["inference_model"]
        if not Path(model_path).exists():
            model_path = f"{PIPELINE_CONFIG['qlora_output']}/merged"
        vm = VerbAIModel(InferenceConfig(model_path=model_path))

    rag_context = ""
    if retriever is not None:
        tm_segments = retriever.retrieve(source, lang=lang, domain=domain)
        rag_context = HybridRetriever.format_context(tm_segments)

    result = translate(source, vm, glossary or [], domain, rag_context)

    if glossary:
        result["glossary_compliance"] = check_glossary_compliance(
            result["translation"], glossary
        )
    return result


# ---------------------------------------------------------------------------
# Evaluation — per-domain breakdown + competitor comparison
# ---------------------------------------------------------------------------

def evaluate_pipeline(
    test_data_path: str,
    retriever: Optional[HybridRetriever] = None,
    vm: Optional[VerbAIModel] = None,
) -> Dict:
    print("\n=== [EVAL] Running v2 evaluation ===")
    with open(test_data_path, "r", encoding="utf-8") as f:
        test_data = json.load(f)

    bleu_metric = evaluate.load("sacrebleu")
    chrf_metric = evaluate.load("chrf")
    bert_metric = evaluate.load("bertscore")

    predictions     = []
    references      = []
    comet_scores    = []
    glossary_scores = []
    domain_results: Dict[str, Dict[str, List]] = defaultdict(
        lambda: {"preds": [], "refs": [], "comet": []}
    )
    t0 = time.time()

    for i, item in enumerate(test_data):
        domain = item.get("domain", "general")
        result = translate_single(
            source   = item["source"],
            lang     = item.get("language", PIPELINE_CONFIG["lang_code"]),
            domain   = domain,
            glossary = item.get("glossary", []),
            retriever= retriever,
            vm       = vm,
        )
        pred = result["translation"]
        ref  = item["target"]

        predictions.append(pred)
        references.append(ref)
        comet_scores.append(result["comet_score"])
        domain_results[domain]["preds"].append(pred)
        domain_results[domain]["refs"].append(ref)
        domain_results[domain]["comet"].append(result["comet_score"])

        if "glossary_compliance" in result:
            glossary_scores.append(result["glossary_compliance"]["compliance_rate"])

        elapsed = time.time() - t0
        speed   = (i + 1) / elapsed
        print(f"[EVAL] {i+1}/{len(test_data)} | {speed:.1f} seg/s | COMET: {result['comet_score']:.4f}")

    # ── Global metrics ─────────────────────────────────────────────────
    bleu = bleu_metric.compute(predictions=predictions, references=[[r] for r in references])
    chrf = chrf_metric.compute(predictions=predictions, references=references)
    bert = bert_metric.compute(predictions=predictions, references=references, lang="hi")

    metrics = {
        "BLEU":          round(bleu["score"], 4),
        "chrF":          round(chrf["score"], 4),
        "BERTScore_F1":  round(float(np.mean(bert["f1"])), 4),
        "COMET_avg":     round(float(np.mean(comet_scores)), 4),
        "Glossary_%":    round(float(np.mean(glossary_scores)) * 100, 2) if glossary_scores else None,
        "segments":      len(test_data),
        "elapsed_s":     round(time.time() - t0, 1),
    }

    # ── Per-domain breakdown ────────────────────────────────────────────
    domain_metrics = {}
    for dom, ddata in domain_results.items():
        if not ddata["preds"]:
            continue
        db = bleu_metric.compute(
            predictions=ddata["preds"],
            references=[[r] for r in ddata["refs"]]
        )
        domain_metrics[dom] = {
            "BLEU":      round(db["score"], 4),
            "COMET_avg": round(float(np.mean(ddata["comet"])), 4),
            "n":         len(ddata["preds"]),
        }

    # ── Print results ──────────────────────────────────────────────────
    print("\n" + "="*65)
    print("VERBAI v2 — EVALUATION RESULTS")
    print("="*65)
    for k, v in metrics.items():
        print(f"  {k:<22}: {v}")

    print("\n── Per-Domain ──────────────────────────────────────────────────")
    for dom, dm in domain_metrics.items():
        print(f"  {dom:<12}: BLEU={dm['BLEU']:.2f}  COMET={dm['COMET_avg']:.4f}  n={dm['n']}")

    print("\n── Competitor Comparison ───────────────────────────────────────")
    for competitor, bench in COMPETITOR_BENCHMARKS.items():
        bleu_delta  = metrics["BLEU"]         - bench["BLEU"]
        bert_delta  = metrics["BERTScore_F1"] - bench["BERTScore_F1"]
        bleu_status = f"+{bleu_delta:.2f} ✓ BEATS" if bleu_delta > 0 else f"{bleu_delta:.2f} (gap)"
        bert_status = f"+{bert_delta:.4f} ✓ BEATS" if bert_delta > 0 else f"{bert_delta:.4f} (gap)"
        print(f"  vs {competitor:<22}: BLEU {bleu_status}  |  BERTScore {bert_status}")
    print("="*65)

    # Save full results
    output = {
        "metrics":        metrics,
        "domain_metrics": domain_metrics,
        "predictions":    predictions,
        "competitor_benchmarks": COMPETITOR_BENCHMARKS,
    }
    with open("eval_results_v2.json", "w") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print("Results saved to eval_results_v2.json")
    return metrics


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="VerbAI Pipeline v2")
    parser.add_argument("--mode",       choices=["setup", "train", "translate", "eval"], required=True)
    parser.add_argument("--tm_data",    default="tm_segments.json")
    parser.add_argument("--train_data", default="train.json")
    parser.add_argument("--test_data",  default="test.json")
    parser.add_argument("--source",     default="")
    parser.add_argument("--lang",       default="hi")
    parser.add_argument("--domain",     default="general")
    args = parser.parse_args()

    if args.mode == "setup":
        setup_rag(args.tm_data)

    elif args.mode == "train":
        run_training(args.train_data)

    elif args.mode == "translate":
        if not args.source:
            print("ERROR: --source required for translate mode")
            return
        result = translate_single(args.source, args.lang, args.domain)
        print("\nTranslation:", result["translation"])
        print(f"COMET: {result['comet_score']}  MBR: {result['mbr_score']}  Fallback: {result['fallback_used']}")

    elif args.mode == "eval":
        evaluate_pipeline(args.test_data)


if __name__ == "__main__":
    main()
