# Stage 1: Build React 18 Control Plane (Vite)
FROM node:20-alpine AS frontend-builder
WORKDIR /frontend
COPY control_plane/package.json ./
RUN npm install --no-audit --no-fund
COPY control_plane/ ./
RUN npm run build

# Stage 2: Production Python FastAPI + Sandbox Orchestrator
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    gcc \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Pre-warm pip and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend source and built React control plane
COPY agent/ ./agent/
COPY sandbox/ ./sandbox/
COPY server/ ./server/
COPY benchmarks/ ./benchmarks/
COPY tests/ ./tests/
COPY pytest.ini .
COPY --from=frontend-builder /frontend/dist ./control_plane/dist

# Non-root user for isolated sandbox security
RUN useradd -m -u 1000 harnessuser && chown -R harnessuser:harnessuser /app
USER harnessuser

EXPOSE 8000 10000

CMD ["sh", "-c", "uvicorn server.app:app --host 0.0.0.0 --port ${PORT:-8000}"]
