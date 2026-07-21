# Single-image cookie/session harvester.
# Base image ships Chromium + all system deps matching the pinned Playwright.
FROM mcr.microsoft.com/playwright/python:v1.61.0-noble AS base
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PORT=8080

WORKDIR /srv

COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-install-project --no-dev

COPY app ./app
RUN uv sync --locked --no-dev

ENV PATH="/srv/.venv/bin:${PATH}"

EXPOSE 8080

# Runtime default: serve the API.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port \"${PORT:-8080}\""]

# ---------------------------------------------------------------------------
# Test stage: adds dev deps + tests. Build with `--target test` to run them.
FROM base AS test

RUN uv sync --locked

COPY tests ./tests
COPY pytest.ini .

CMD ["pytest", "-v", "tests"]
