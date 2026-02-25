# =============================================================================
# Stage 1 – build the React/Vite frontend
# =============================================================================
FROM node:22-alpine AS frontend

WORKDIR /app

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ .
RUN npm run build          # produces /app/dist


# =============================================================================
# Stage 2 – Python backend that also serves the compiled frontend
# =============================================================================
FROM python:3.12-slim AS backend

WORKDIR /app

# cfgrib (pulled in by herbie-data) needs the eccodes C library.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libeccodes-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies before copying the full source so that this
# layer is cached as long as pyproject.toml is unchanged.
COPY backend/pyproject.toml .
RUN pip install --no-cache-dir --upgrade pip && pip install --no-cache-dir .

# Copy the application source.
COPY backend/ .

# Copy the compiled frontend assets into a directory that FastAPI will serve.
COPY --from=frontend /app/dist ./frontend_dist

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
