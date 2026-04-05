# ============================================================================
# VerbAI v2 — Dockerfile (CUDA 11.8 + Python 3.10)
# ============================================================================
# Build:
#   docker build -t verbai-v2 .
#
# Run (with GPU):
#   docker run --gpus all -p 8000:8000 verbai-v2
#
# Run (CPU-only, slower):
#   docker build --build-arg USE_FAISS_CPU=1 -t verbai-v2-cpu .
#   docker run -p 8000:8000 -e VERBAI_DEVICE=cpu verbai-v2-cpu
# ============================================================================

FROM nvidia/cuda:11.8.0-runtime-ubuntu22.04 AS base

# Prevent interactive prompts during apt install
ENV DEBIAN_FRONTEND=noninteractive

# Install Python 3.10 + system deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.10 \
    python3.10-venv \
    python3-pip \
    python3.10-dev \
    build-essential \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Make python3.10 the default
RUN update-alternatives --install /usr/bin/python python /usr/bin/python3.10 1 && \
    update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.10 1

# Upgrade pip
RUN python -m pip install --no-cache-dir --upgrade pip setuptools wheel

# ---------------------------------------------------------------------------
# Build arg: set USE_FAISS_CPU=1 to use faiss-cpu instead of faiss-gpu
# ---------------------------------------------------------------------------
ARG USE_FAISS_CPU=0

WORKDIR /app

# Install deps in two stages for better layer caching:
# 1. Core ML deps (rarely change)
COPY requirements.txt .
RUN if [ "$USE_FAISS_CPU" = "1" ]; then \
      sed -i 's/faiss-gpu/faiss-cpu/' requirements.txt; \
    fi && \
    python -m pip install --no-cache-dir -r requirements.txt

# 2. Copy application code
COPY verbai/ ./verbai/

# ---------------------------------------------------------------------------
# Runtime configuration
# ---------------------------------------------------------------------------
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app

# Default env vars (override at docker run time)
ENV VERBAI_DEVICE=cuda
ENV VERBAI_API_PORT=8000

EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Entrypoint: run the FastAPI server
CMD ["python", "-m", "uvicorn", "verbai.api:app", "--host", "0.0.0.0", "--port", "8000"]
