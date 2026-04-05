"""
verbai/config.py — Centralised configuration (env-var overridable)
==================================================================
Single source of truth for all VerbAI v2 settings.

Every field reads from an environment variable first, falling back to a
sensible default.  Import this module everywhere instead of scattering
hardcoded values across files.

Environment variables
---------------------
VERBAI_BASE_MODEL          ai4bharat/indictrans2-en-indic-dist-200M
VERBAI_TGT_LANG            hin_Deva
VERBAI_SRC_LANG            eng_Latn
VERBAI_LANG_CODE           hi
VERBAI_LORA_RANK           128
VERBAI_LORA_ALPHA          256
VERBAI_DPO_CANDIDATES      16
VERBAI_DPO_VARIANT         dpo          (dpo | ipo)
VERBAI_QUALITY_GATE        0.70
VERBAI_DOMAIN_STRICT       false
VERBAI_TM_INDEX_DIR        verbai_tm_index_v2
VERBAI_QLORA_OUTPUT        verbai-qlora-v2-out
VERBAI_DPO_OUTPUT          verbai-dpo-v2-out
VERBAI_DEVICE              cuda         (cuda | cpu)
VERBAI_API_PORT            8000
"""

from __future__ import annotations

import logging
import os
import sys
from dataclasses import dataclass, field
from typing import Dict

logger = logging.getLogger("verbai.config")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _env(key: str, default: str) -> str:
    """Read an env var with fallback."""
    return os.environ.get(key, default)


def _env_bool(key: str, default: bool) -> bool:
    """Read an env var as bool (true/1/yes → True)."""
    val = os.environ.get(key)
    if val is None:
        return default
    return val.strip().lower() in ("true", "1", "yes")


def _env_int(key: str, default: int) -> int:
    val = os.environ.get(key)
    if val is None:
        return default
    try:
        return int(val)
    except ValueError:
        logger.warning("Invalid int for %s=%r, using default %d", key, val, default)
        return default


def _env_float(key: str, default: float) -> float:
    val = os.environ.get(key)
    if val is None:
        return default
    try:
        return float(val)
    except ValueError:
        logger.warning("Invalid float for %s=%r, using default %f", key, val, default)
        return default


# ---------------------------------------------------------------------------
# Main config dataclass
# ---------------------------------------------------------------------------

@dataclass
class VerbAIConfig:
    """Centralised, env-var-overridable configuration for VerbAI v2."""

    # ── Model ────────────────────────────────────────────────────────────
    base_model: str = field(
        default_factory=lambda: _env(
            "VERBAI_BASE_MODEL",
            "ai4bharat/indictrans2-en-indic-dist-200M",
        )
    )
    src_lang: str = field(
        default_factory=lambda: _env("VERBAI_SRC_LANG", "eng_Latn")
    )
    tgt_lang: str = field(
        default_factory=lambda: _env("VERBAI_TGT_LANG", "hin_Deva")
    )
    lang_code: str = field(
        default_factory=lambda: _env("VERBAI_LANG_CODE", "hi")
    )

    # ── LoRA / QLoRA ─────────────────────────────────────────────────────
    lora_rank: int = field(
        default_factory=lambda: _env_int("VERBAI_LORA_RANK", 128)
    )
    lora_alpha: int = field(
        default_factory=lambda: _env_int("VERBAI_LORA_ALPHA", 256)
    )

    # ── DPO ──────────────────────────────────────────────────────────────
    dpo_candidates: int = field(
        default_factory=lambda: _env_int("VERBAI_DPO_CANDIDATES", 16)
    )
    dpo_variant: str = field(
        default_factory=lambda: _env("VERBAI_DPO_VARIANT", "dpo")
    )

    # ── Inference ────────────────────────────────────────────────────────
    quality_gate_threshold: float = field(
        default_factory=lambda: _env_float("VERBAI_QUALITY_GATE", 0.70)
    )

    # ── RAG ──────────────────────────────────────────────────────────────
    domain_strict: bool = field(
        default_factory=lambda: _env_bool("VERBAI_DOMAIN_STRICT", False)
    )
    tm_index_dir: str = field(
        default_factory=lambda: _env("VERBAI_TM_INDEX_DIR", "verbai_tm_index_v2")
    )

    # ── Output directories ───────────────────────────────────────────────
    qlora_output: str = field(
        default_factory=lambda: _env("VERBAI_QLORA_OUTPUT", "verbai-qlora-v2-out")
    )
    dpo_output: str = field(
        default_factory=lambda: _env("VERBAI_DPO_OUTPUT", "verbai-dpo-v2-out")
    )

    # ── Device ───────────────────────────────────────────────────────────
    device: str = field(
        default_factory=lambda: _env("VERBAI_DEVICE", "cuda")
    )

    # ── API ──────────────────────────────────────────────────────────────
    api_port: int = field(
        default_factory=lambda: _env_int("VERBAI_API_PORT", 8000)
    )

    # ── Derived ──────────────────────────────────────────────────────────
    @property
    def inference_model_path(self) -> str:
        """Path to the final DPO-merged model (preferred) or QLoRA-merged fallback."""
        dpo_merged = f"{self.dpo_output}/merged"
        qlora_merged = f"{self.qlora_output}/merged"
        if os.path.isdir(dpo_merged):
            return dpo_merged
        if os.path.isdir(qlora_merged):
            return qlora_merged
        # Return the DPO default so error messages point users to train first
        return dpo_merged

    # ── Validation ───────────────────────────────────────────────────────
    def validate(self) -> "VerbAIConfig":
        """
        Validate the configuration and apply safety fallbacks.

        - Checks CUDA availability; falls back to CPU with a warning.
        - Validates dpo_variant is known.
        - Logs the final resolved configuration.

        Returns self for chaining.
        """
        # CUDA check
        try:
            import torch
            if self.device == "cuda" and not torch.cuda.is_available():
                logger.warning(
                    "CUDA requested but not available. Falling back to CPU. "
                    "This will be significantly slower for models > 200M params."
                )
                self.device = "cpu"
            elif self.device == "cuda":
                gpu_name = torch.cuda.get_device_name(0)
                vram_gb = torch.cuda.get_device_properties(0).total_mem / (1024**3)
                logger.info("CUDA device: %s (%.1f GB VRAM)", gpu_name, vram_gb)
        except ImportError:
            logger.warning("PyTorch not installed — cannot verify CUDA. Setting device=cpu.")
            self.device = "cpu"

        # DPO variant check
        if self.dpo_variant not in ("dpo", "ipo"):
            logger.warning(
                "Unknown dpo_variant=%r, falling back to 'dpo'.", self.dpo_variant
            )
            self.dpo_variant = "dpo"

        # Log resolved config
        logger.info("VerbAI config resolved:")
        logger.info("  base_model    : %s", self.base_model)
        logger.info("  src_lang      : %s  →  tgt_lang: %s", self.src_lang, self.tgt_lang)
        logger.info("  lora_rank     : %d  /  alpha: %d", self.lora_rank, self.lora_alpha)
        logger.info("  dpo_candidates: %d  /  variant: %s", self.dpo_candidates, self.dpo_variant)
        logger.info("  quality_gate  : %.2f", self.quality_gate_threshold)
        logger.info("  domain_strict : %s", self.domain_strict)
        logger.info("  device        : %s", self.device)

        return self


# ---------------------------------------------------------------------------
# Competitor benchmarks (public results, used by evaluation)
# ---------------------------------------------------------------------------

COMPETITOR_BENCHMARKS: Dict[str, Dict[str, float]] = {
    "DeepL":            {"BLEU": 80.3, "BERTScore_F1": 0.890, "chrF": 56.2},
    "Google Translate": {"BLEU": 77.8, "BERTScore_F1": 0.878, "chrF": 54.1},
    "NLLB-200 (base)":  {"BLEU": 73.1, "BERTScore_F1": 0.862, "chrF": 51.8},
}


# ---------------------------------------------------------------------------
# Module-level singleton (lazy, created on first access)
# ---------------------------------------------------------------------------

_config: VerbAIConfig | None = None


def get_config() -> VerbAIConfig:
    """Return the validated global VerbAIConfig singleton."""
    global _config
    if _config is None:
        _config = VerbAIConfig().validate()
    return _config
