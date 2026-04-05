"""
VerbAI v2 — Maximum Accuracy Translation Pipeline
===================================================
RAG + QLoRA + DPO + COMET-MBR + COMETkiwi

Package structure:
  verbai.rag.retriever        — Hybrid RAG retrieval
  verbai.training.qlora_finetune — QLoRA fine-tuning
  verbai.training.dpo_train   — DPO preference optimisation
  verbai.inference.translate   — COMET-MBR inference
  verbai.pipeline             — Full orchestrator
  verbai.config               — Centralised configuration
  verbai.api                  — FastAPI REST wrapper
"""

__version__ = "2.0.0"
