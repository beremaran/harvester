# Single-image cookie/session harvester.
# Base image ships Chromium + all system deps matching the pinned Playwright.
FROM mcr.microsoft.com/playwright/python:v1.49.1-noble AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8080

WORKDIR /srv

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

EXPOSE 8080

# Runtime default: serve the API.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port \"${PORT:-8080}\""]

# ---------------------------------------------------------------------------
# Test stage: adds dev deps + tests. Build with `--target test` to run them.
FROM base AS test

COPY requirements-dev.txt .
RUN pip install --no-cache-dir -r requirements-dev.txt

COPY tests ./tests
COPY pytest.ini .

CMD ["pytest", "-v", "tests"]
