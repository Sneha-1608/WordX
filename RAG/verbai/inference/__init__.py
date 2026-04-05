"""verbai.inference — COMET-MBR translation with quality gate."""

from verbai.inference.translate import (
    InferenceConfig,
    VerbAIModel,
    translate,
    translate_batch,
    check_glossary_compliance,
)

__all__ = [
    "InferenceConfig",
    "VerbAIModel",
    "translate",
    "translate_batch",
    "check_glossary_compliance",
]
