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
  python -m verbai.pipeline --mode setup --tm_data tm_segments.json

  # Train
  python -m verbai.pipeline --mode train --train_data train.json

  # Translate a single segment
  python -m verbai.pipeline --mode translate --source "Your text" --lang hi --domain legal

  # Full evaluation (with competitor comparison)
  python -m verbai.pipeline --mode eval --test_data test.json
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from collections import defaultdict
from pathlib import Path
from typing import Dict, List, Optional

import evaluate
import numpy as np

from verbai.config import VerbAIConfig, get_config, COMPETITOR_BENCHMARKS
from verbai.rag.retriever import HybridRetriever, RetrievalConfig, TMSegment
from verbai.training.qlora_finetune import QLoRAConfig, train as qlora_train
from verbai.training.dpo_train import DPOPipelineConfig, run_dpo_pipeline
from verbai.inference.translate import (
    InferenceConfig,
    VerbAIModel,
    translate,
    translate_batch,
    check_glossary_compliance,
)

logger = logging.getLogger("verbai.pipeline")


# ---------------------------------------------------------------------------
# Error helpers
# ---------------------------------------------------------------------------

class VerbAIError(Exception):
    """Base exception for VerbAI pipeline errors."""
    pass


class ModelNotFoundError(VerbAIError):
    """Raised when a required model checkpoint is missing."""
    pass


class TMIndexNotFoundError(VerbAIError):
    """Raised when the TM index directory is missing or empty."""
    pass


def _check_tm_index(cfg: VerbAIConfig) -> bool:
    """Check if the TM index directory exists and has the required files."""
    index_dir = Path(cfg.tm_index_dir)
    required_files = [
        "dense_primary.index",
        "dense_secondary.index",
        "segments.json",
    ]
    if not index_dir.exists():
        return False
    return all((index_dir / f).exists() for f in required_files)


def _check_model_path(path: str, label: str) -> None:
    """Raise ModelNotFoundError if path doesn't exist."""
    if not Path(path).exists():
        raise ModelNotFoundError(
            f"{label} not found at '{path}'. "
            f"Have you run training first?  "
            f"Use: python -m verbai.pipeline --mode train --train_data your_data.json"
        )


# ---------------------------------------------------------------------------
# Setup: build RAG index
# ---------------------------------------------------------------------------

def setup_rag(tm_data_path: str, cfg: VerbAIConfig | None = None) -> HybridRetriever:
    cfg = cfg or get_config()
    print("\n=== [SETUP] Building Hybrid RAG index (v2) ===")

    if not Path(tm_data_path).exists():
        raise FileNotFoundError(
            f"TM data file not found: {tm_data_path}\n"
            f"Please provide a JSON file with TM segments."
        )

    with open(tm_data_path, "r", encoding="utf-8") as f:
        raw = json.load(f)

    if not raw:
        raise VerbAIError(
            f"TM data file is empty: {tm_data_path}\n"
            f"Need at least 1 TM segment to build the index."
        )

    segments = [TMSegment(**r) for r in raw]

    retrieval_cfg = RetrievalConfig(
        faiss_index="hnsw",
        domain_strict=cfg.domain_strict,
        device=cfg.device,
    )
    retriever = HybridRetriever(retrieval_cfg)
    retriever.build_index(segments)
    retriever.save(cfg.tm_index_dir)
    return retriever


# ---------------------------------------------------------------------------
# Training: QLoRA → DPO
# ---------------------------------------------------------------------------

def run_training(train_data_path: str, cfg: VerbAIConfig | None = None) -> None:
    cfg = cfg or get_config()

    if not Path(train_data_path).exists():
        raise FileNotFoundError(
            f"Training data file not found: {train_data_path}\n"
            f"Please provide a JSON file with training examples."
        )

    print("\n=== [TRAIN] QLoRA v2 fine-tuning ===")
    with open(train_data_path, "r", encoding="utf-8") as f:
        train_data = json.load(f)

    if not train_data:
        raise VerbAIError("Training data is empty — need at least a few examples.")

    qlora_cfg = QLoRAConfig(
        base_model=cfg.base_model,
        output_dir=cfg.qlora_output,
        src_lang=cfg.src_lang,
        tgt_lang=cfg.tgt_lang,
        lora_r=cfg.lora_rank,
        lora_alpha=cfg.lora_alpha,
    )
    qlora_train(qlora_cfg, train_data)

    print("\n=== [TRAIN] DPO v2 preference optimisation ===")
    sources = [d["source"] for d in train_data]
    dpo_cfg = DPOPipelineConfig(
        sft_model_path=f"{cfg.qlora_output}/merged",
        output_dir=cfg.dpo_output,
        src_lang=cfg.src_lang,
        tgt_lang=cfg.tgt_lang,
        n_candidates=cfg.dpo_candidates,
        dpo_variant=cfg.dpo_variant,
        pairs_per_source=2,
    )
    run_dpo_pipeline(dpo_cfg, sources, pairs_cache="dpo_pairs_v2_cache.json")
    print("[TRAIN] Complete. Best model at:", f"{cfg.dpo_output}/merged")


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
    cfg: VerbAIConfig | None = None,
) -> Dict:
    cfg = cfg or get_config()

    # Load retriever if not provided
    if retriever is None:
        if _check_tm_index(cfg):
            retriever = HybridRetriever.load(cfg.tm_index_dir)
        else:
            logger.warning(
                "No TM index found at '%s' — RAG disabled. "
                "Run: python -m verbai.pipeline --mode setup --tm_data your_tm.json",
                cfg.tm_index_dir,
            )

    # Load model if not provided
    if vm is None:
        model_path = cfg.inference_model_path
        _check_model_path(model_path, "Inference model")
        vm = VerbAIModel(InferenceConfig(
            model_path=model_path,
            src_lang=cfg.src_lang,
            tgt_lang=cfg.tgt_lang,
            device=cfg.device,
            quality_gate_threshold=cfg.quality_gate_threshold,
        ))

    # RAG context retrieval
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
    cfg: VerbAIConfig | None = None,
) -> Dict:
    cfg = cfg or get_config()
    print("\n=== [EVAL] Running v2 evaluation ===")

    if not Path(test_data_path).exists():
        raise FileNotFoundError(f"Test data file not found: {test_data_path}")

    with open(test_data_path, "r", encoding="utf-8") as f:
        test_data = json.load(f)

    bleu_metric = evaluate.load("sacrebleu")
    chrf_metric = evaluate.load("chrf")
    bert_metric = evaluate.load("bertscore")

    predictions     = []
    references      = []
    comet_scores    = []
    glossary_scores = []
    domain_results: Dict[str, Dict[str, list]] = defaultdict(
        lambda: {"preds": [], "refs": [], "comet": []}
    )
    t0 = time.time()

    for i, item in enumerate(test_data):
        domain = item.get("domain", "general")
        result = translate_single(
            source=item["source"],
            lang=item.get("language", cfg.lang_code),
            domain=domain,
            glossary=item.get("glossary", []),
            retriever=retriever,
            vm=vm,
            cfg=cfg,
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
    bert = bert_metric.compute(predictions=predictions, references=references, lang=cfg.lang_code)

    metrics = {
        "BLEU":          round(bleu["score"], 4),
        "chrF":          round(chrf["score"], 4),
        "BERTScore_F1":  round(float(np.mean(bert["f1"])), 4),
        "COMET_avg":     round(float(np.mean(comet_scores)), 4),
        "Glossary_%":    round(float(np.mean(glossary_scores)) * 100, 2) if glossary_scores else None,
        "segments":      len(test_data),
        "elapsed_s":     round(time.time() - t0, 1),
    }

    # ── Per-domain breakdown ──────────────────────────────────────────
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

    # ── Print results ────────────────────────────────────────────────
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
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s [%(levelname)s] %(message)s",
    )

    parser = argparse.ArgumentParser(description="VerbAI Pipeline v2")
    parser.add_argument("--mode",       choices=["setup", "train", "translate", "eval"], required=True)
    parser.add_argument("--tm_data",    default="tm_segments.json")
    parser.add_argument("--train_data", default="train.json")
    parser.add_argument("--test_data",  default="test.json")
    parser.add_argument("--source",     default="")
    parser.add_argument("--lang",       default="")
    parser.add_argument("--domain",     default="general")
    args = parser.parse_args()

    cfg = get_config()

    # Use config lang_code as default if --lang not specified
    lang = args.lang or cfg.lang_code

    try:
        if args.mode == "setup":
            setup_rag(args.tm_data, cfg)

        elif args.mode == "train":
            run_training(args.train_data, cfg)

        elif args.mode == "translate":
            if not args.source:
                print("ERROR: --source required for translate mode")
                sys.exit(1)
            result = translate_single(args.source, lang, args.domain, cfg=cfg)
            print("\nTranslation:", result["translation"])
            print(f"COMET: {result['comet_score']}  MBR: {result['mbr_score']}  Fallback: {result['fallback_used']}")

        elif args.mode == "eval":
            evaluate_pipeline(args.test_data, cfg=cfg)

    except VerbAIError as e:
        logger.error("VerbAI error: %s", e)
        sys.exit(1)
    except FileNotFoundError as e:
        logger.error("File not found: %s", e)
        sys.exit(1)
    except Exception as e:
        logger.exception("Unexpected error: %s", e)
        sys.exit(1)


if __name__ == "__main__":
    main()
