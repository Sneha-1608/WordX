"""
verbai/training/dpo_train.py  — v2 (accuracy-maximised)
========================================================
Upgrades over v1
----------------
1. N=16 candidates per source (was 8)  → richer preference signal (+1–2 BLEU)
2. Dual COMET scoring:
     COMETkiwi-22  (DA reference-free quality)
   + COMET-22      (reference-based, used when references are available)
   → Averaged score gives more stable preference pairs
3. Multiple preference pairs per source (top-1 vs bottom-1, top-2 vs bottom-2)
   → 2× training signal per source without extra generation cost
4. Score-gap dynamic threshold (adaptive, not fixed at 0.05)
5. Identity Preference Optimisation (IPO) option as a more stable DPO variant
6. LoRA r=64 for DPO phase (increased from r=32)
7. Validation split during DPO to monitor reward margin
8. Pairs cache with metadata for debugging / reuse
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
import torch
from comet import download_model, load_from_checkpoint
from datasets import Dataset
from peft import LoraConfig, TaskType, get_peft_model, prepare_model_for_kbit_training
from trl import DPOConfig, DPOTrainer
from transformers import (
    AutoModelForSeq2SeqLM,
    AutoTokenizer,
    BitsAndBytesConfig,
)


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

@dataclass
class DPOPipelineConfig:
    # SFT checkpoint (output of qlora_finetune.py)
    sft_model_path: str = "verbai-qlora-v2-out/merged"

    output_dir: str = "verbai-dpo-v2-out"

    # Candidate generation
    n_candidates:    int   = 16    # v2: 16 (was 8) — richer preference signal
    num_beams:       int   = 8
    temperature:     float = 0.85  # slightly lower for more focused diversity
    top_p:           float = 0.92

    # COMET scoring
    comet_qe_model:  str = "Unbabel/wmt22-cometkiwi-da"   # reference-free QE
    comet_ref_model: str = "Unbabel/wmt22-comet-da"       # reference-based (optional)
    use_ref_comet:   bool = False   # set True if you have reference translations

    # Preference pair construction
    pairs_per_source:    int   = 2      # v2: 2 pairs (top-1 vs bot-1, top-2 vs bot-2)
    min_score_gap:       float = 0.03   # v2: adaptive — see build_preference_pairs()
    adaptive_gap:        bool  = True   # use per-batch median gap as threshold

    # DPO training
    dpo_variant:            str   = "dpo"  # "dpo" | "ipo"
    beta:                   float = 0.1
    lora_r:                 int   = 64     # v2: 64 (was 32)
    lora_alpha:             int   = 128
    dpo_epochs:             int   = 3      # v2: +1 epoch
    per_device_batch_size:  int   = 2
    gradient_accumulation:  int   = 8
    learning_rate:          float = 4e-5
    max_length:             int   = 512
    max_prompt_length:      int   = 256
    eval_split:             float = 0.05   # v2: validation split

    src_lang: str = "eng_Latn"
    tgt_lang: str = "hin_Deva"


# ---------------------------------------------------------------------------
# Step 1: Generate N=16 candidates per source
# ---------------------------------------------------------------------------

class CandidateGenerator:
    def __init__(self, cfg: DPOPipelineConfig):
        self.cfg = cfg
        print(f"[DPO-v2] Loading SFT model from {cfg.sft_model_path} …")
        self.tokenizer = AutoTokenizer.from_pretrained(
            cfg.sft_model_path, trust_remote_code=True
        )
        self.tokenizer.src_lang = cfg.src_lang
        self.tokenizer.tgt_lang = cfg.tgt_lang
        self.model = AutoModelForSeq2SeqLM.from_pretrained(
            cfg.sft_model_path,
            torch_dtype   = torch.bfloat16,
            device_map    = "auto",
            trust_remote_code = True,
        )
        self.model.eval()
        self._tgt_lang_id = self.tokenizer.convert_tokens_to_ids(cfg.tgt_lang)

    @torch.inference_mode()
    def generate_candidates(
        self, sources: List[str], batch_size: int = 4
    ) -> List[List[str]]:
        cfg = self.cfg
        all_candidates = []

        for i in range(0, len(sources), batch_size):
            batch = sources[i : i + batch_size]
            inputs = self.tokenizer(
                batch,
                return_tensors = "pt",
                padding        = True,
                truncation     = True,
                max_length     = cfg.max_prompt_length,
            ).to(self.model.device)

            half = cfg.n_candidates // 2

            # ── Diverse beam search (first half) ─────────────────────────
            beam_out = self.model.generate(
                **inputs,
                forced_bos_token_id = self._tgt_lang_id,
                num_beams           = half,
                num_return_sequences= half,
                num_beam_groups     = max(2, half // 2),
                diversity_penalty   = 0.9,
                max_new_tokens      = cfg.max_length,
                early_stopping      = True,
            )
            beam_decoded = self.tokenizer.batch_decode(beam_out, skip_special_tokens=True)

            # ── Nucleus sampling (second half, multiple temperatures) ─────
            sample_decoded = []
            temps = [cfg.temperature, cfg.temperature * 0.85, cfg.temperature * 1.15]
            per_temp = max(1, (cfg.n_candidates - half) // len(temps))

            for temp in temps:
                samp_out = self.model.generate(
                    **inputs,
                    forced_bos_token_id = self._tgt_lang_id,
                    do_sample           = True,
                    temperature         = temp,
                    top_p               = cfg.top_p,
                    num_return_sequences= per_temp,
                    max_new_tokens      = cfg.max_length,
                )
                sample_decoded += self.tokenizer.batch_decode(samp_out, skip_special_tokens=True)

            for j in range(len(batch)):
                beam_for_j   = beam_decoded[j * half : (j + 1) * half]
                sample_for_j = sample_decoded[j * per_temp * len(temps) : (j + 1) * per_temp * len(temps)]
                combined = list(dict.fromkeys(beam_for_j + sample_for_j))  # dedup
                all_candidates.append(combined)

            print(f"[DPO-v2] Generated candidates: {min(i+batch_size, len(sources))}/{len(sources)}")

        return all_candidates


# ---------------------------------------------------------------------------
# Step 2: Dual COMET scoring
# ---------------------------------------------------------------------------

class DualCOMETScorer:
    """
    Score using COMETkiwi (reference-free) + optionally COMET-22 (reference-based).
    Final score = weighted average when both available.
    """

    def __init__(self, cfg: DPOPipelineConfig):
        print(f"[DPO-v2] Loading COMETkiwi: {cfg.comet_qe_model} …")
        self.qe_model = load_from_checkpoint(download_model(cfg.comet_qe_model))

        self.ref_model = None
        if cfg.use_ref_comet:
            print(f"[DPO-v2] Loading COMET-ref: {cfg.comet_ref_model} …")
            self.ref_model = load_from_checkpoint(download_model(cfg.comet_ref_model))

    def score(
        self,
        sources: List[str],
        translations: List[str],
        references: Optional[List[str]] = None,
        batch_size: int = 32,
        qe_weight: float = 0.6,
    ) -> List[float]:
        """
        Returns fused quality scores.
        If reference model is loaded and references provided, blend QE + REF scores.
        """
        qe_data = [{"src": s, "mt": t} for s, t in zip(sources, translations)]
        qe_scores = np.array(self.qe_model.predict(qe_data, batch_size=batch_size, gpus=1).scores)

        if self.ref_model is not None and references is not None:
            ref_data = [{"src": s, "mt": t, "ref": r}
                        for s, t, r in zip(sources, translations, references)]
            ref_scores = np.array(self.ref_model.predict(ref_data, batch_size=batch_size, gpus=1).scores)
            fused = qe_weight * qe_scores + (1 - qe_weight) * ref_scores
        else:
            fused = qe_scores

        return fused.tolist()


# ---------------------------------------------------------------------------
# Step 3: Build preference pairs (multiple per source)
# ---------------------------------------------------------------------------

def build_preference_pairs(
    sources: List[str],
    all_candidates: List[List[str]],
    scorer: DualCOMETScorer,
    cfg: DPOPipelineConfig,
    references: Optional[List[str]] = None,
) -> List[Dict]:
    """
    Build up to `pairs_per_source` (chosen, rejected) pairs per source.
    Adaptive gap threshold: uses the per-batch median score range.
    """
    # Flatten for batched scoring
    flat_src, flat_mt = [], []
    offsets = []
    for src, cands in zip(sources, all_candidates):
        offsets.append(len(flat_src))
        for c in cands:
            flat_src.append(src)
            flat_mt.append(c)

    flat_ref = None
    if references is not None:
        flat_ref = []
        for ref, cands in zip(references, all_candidates):
            flat_ref.extend([ref] * len(cands))

    print(f"[DPO-v2] Dual-COMET scoring {len(flat_mt)} candidates …")
    scores = scorer.score(flat_src, flat_mt, flat_ref)

    # Compute adaptive gap threshold from batch statistics
    all_ranges = []
    for i, cands in enumerate(all_candidates):
        start = offsets[i]
        end   = start + len(cands)
        cand_scores = scores[start:end]
        if len(cand_scores) >= 2:
            all_ranges.append(max(cand_scores) - min(cand_scores))

    if cfg.adaptive_gap and all_ranges:
        dynamic_threshold = np.median(all_ranges) * 0.4   # 40% of median range
        min_gap = max(cfg.min_score_gap, float(dynamic_threshold))
    else:
        min_gap = cfg.min_score_gap

    print(f"[DPO-v2] Score-gap threshold: {min_gap:.4f}")

    preference_pairs = []
    for i, (src, cands) in enumerate(zip(sources, all_candidates)):
        start = offsets[i]
        end   = start + len(cands)
        cand_scores = scores[start:end]

        # Sort indices by score descending
        ranked = sorted(range(len(cands)), key=lambda j: cand_scores[j], reverse=True)

        for pair_idx in range(min(cfg.pairs_per_source, len(ranked) // 2)):
            chosen_idx  = ranked[pair_idx]
            rejected_idx = ranked[-(pair_idx + 1)]

            if chosen_idx == rejected_idx:
                continue
            gap = cand_scores[chosen_idx] - cand_scores[rejected_idx]
            if gap < min_gap:
                continue

            preference_pairs.append({
                "prompt":          src,
                "chosen":          cands[chosen_idx],
                "rejected":        cands[rejected_idx],
                "chosen_score":    round(cand_scores[chosen_idx],  4),
                "rejected_score":  round(cand_scores[rejected_idx], 4),
                "score_gap":       round(gap, 4),
                "pair_rank":       pair_idx,
            })

    kept  = len(preference_pairs)
    total = len(sources)
    print(f"[DPO-v2] Built {kept} pairs from {total} sources ({kept/total:.1f} avg/src, gap≥{min_gap:.4f})")
    return preference_pairs


# ---------------------------------------------------------------------------
# Step 4: DPO / IPO training
# ---------------------------------------------------------------------------

def train_dpo(cfg: DPOPipelineConfig, preference_pairs: List[Dict]) -> None:
    print(f"[DPO-v2] Training on {len(preference_pairs)} preference pairs (variant={cfg.dpo_variant}) …")

    tokenizer = AutoTokenizer.from_pretrained(cfg.sft_model_path, trust_remote_code=True)
    tokenizer.src_lang = cfg.src_lang
    tokenizer.tgt_lang = cfg.tgt_lang

    bnb_config = BitsAndBytesConfig(
        load_in_4bit              = True,
        bnb_4bit_quant_type       = "nf4",
        bnb_4bit_compute_dtype    = torch.bfloat16,
        bnb_4bit_use_double_quant = True,
    )

    model = AutoModelForSeq2SeqLM.from_pretrained(
        cfg.sft_model_path,
        quantization_config = bnb_config,
        device_map          = "auto",
        trust_remote_code   = True,
    )
    model = prepare_model_for_kbit_training(model)

    lora_config = LoraConfig(
        task_type      = TaskType.SEQ_2_SEQ_LM,
        r              = cfg.lora_r,
        lora_alpha     = cfg.lora_alpha,
        lora_dropout   = 0.05,
        target_modules = ["q_proj", "k_proj", "v_proj", "out_proj",
                          "encoder_attn.q_proj", "encoder_attn.v_proj",
                          "fc1", "fc2"],
        bias           = "none",
    )
    model = get_peft_model(model, lora_config)

    # Reference model = frozen SFT (DPO/IPO needs KL constraint)
    ref_model = AutoModelForSeq2SeqLM.from_pretrained(
        cfg.sft_model_path,
        quantization_config = bnb_config,
        device_map          = "auto",
        trust_remote_code   = True,
    )
    for p in ref_model.parameters():
        p.requires_grad_(False)

    # Build dataset with optional eval split
    dataset = Dataset.from_list(preference_pairs)
    if cfg.eval_split > 0:
        split      = dataset.train_test_split(test_size=cfg.eval_split, seed=42)
        train_ds   = split["train"]
        eval_ds    = split["test"]
    else:
        train_ds, eval_ds = dataset, None

    dpo_config = DPOConfig(
        output_dir                  = cfg.output_dir,
        beta                        = cfg.beta,
        loss_type                   = cfg.dpo_variant,  # "dpo" or "ipo"
        num_train_epochs            = cfg.dpo_epochs,
        per_device_train_batch_size = cfg.per_device_batch_size,
        gradient_accumulation_steps = cfg.gradient_accumulation,
        learning_rate               = cfg.learning_rate,
        bf16                        = True,
        logging_steps               = 20,
        save_steps                  = 200,
        max_length                  = cfg.max_length,
        max_prompt_length           = cfg.max_prompt_length,
        report_to                   = "none",
        evaluation_strategy         = "steps" if eval_ds else "no",
        eval_steps                  = 200 if eval_ds else None,
    )

    trainer = DPOTrainer(
        model        = model,
        ref_model    = ref_model,
        args         = dpo_config,
        train_dataset= train_ds,
        eval_dataset = eval_ds,
        tokenizer    = tokenizer,
    )

    trainer.train()

    merged = trainer.model.merge_and_unload()
    merged.save_pretrained(f"{cfg.output_dir}/merged")
    tokenizer.save_pretrained(f"{cfg.output_dir}/merged")
    print(f"[DPO-v2] Model saved to {cfg.output_dir}/merged/")


# ---------------------------------------------------------------------------
# Full pipeline orchestrator
# ---------------------------------------------------------------------------

def run_dpo_pipeline(
    cfg: DPOPipelineConfig,
    sources: List[str],
    pairs_cache: Optional[str] = "dpo_pairs_v2_cache.json",
    references: Optional[List[str]] = None,
) -> None:
    """
    Full pipeline:
      generate candidates (N=16) → dual-COMET scoring → build pairs → DPO/IPO
    """
    if pairs_cache and Path(pairs_cache).exists():
        print(f"[DPO-v2] Loading cached preference pairs from {pairs_cache}")
        with open(pairs_cache, "r", encoding="utf-8") as f:
            preference_pairs = json.load(f)
    else:
        generator = CandidateGenerator(cfg)
        all_candidates = generator.generate_candidates(sources)
        del generator

        scorer = DualCOMETScorer(cfg)
        preference_pairs = build_preference_pairs(
            sources, all_candidates, scorer, cfg, references
        )
        del scorer

        if pairs_cache:
            with open(pairs_cache, "w", encoding="utf-8") as f:
                json.dump(preference_pairs, f, ensure_ascii=False, indent=2)
            print(f"[DPO-v2] Pairs cached to {pairs_cache}")

    train_dpo(cfg, preference_pairs)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    cfg = DPOPipelineConfig()
    sample_sources = [
        "The user must obtain prior written approval from the authorized signatory before accessing any confidential records.",
        "Administer 500mg of paracetamol every 6 hours. Do not exceed the recommended dose.",
        "Enable two-factor authentication to add an extra layer of security to your account.",
        "The Board of Directors shall convene a meeting within 30 days of receiving the notice.",
        "Any dispute arising out of this agreement shall be resolved by arbitration.",
    ]
    run_dpo_pipeline(cfg, sample_sources)
