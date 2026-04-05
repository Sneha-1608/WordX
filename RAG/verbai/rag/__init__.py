"""verbai.rag — Hybrid RAG retrieval (LaBSE + mE5 + BM25 + RapidFuzz)."""

from verbai.rag.retriever import HybridRetriever, RetrievalConfig, TMSegment

__all__ = ["HybridRetriever", "RetrievalConfig", "TMSegment"]
