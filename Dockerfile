# Cookie/session harvester production image.
# Base image ships Chromium + all system deps matching the pinned Playwright.
# For tests, see Dockerfile.test.
FROM mcr.microsoft.com/playwright/python:v1.61.0-noble
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PORT=8080

WORKDIR /srv

COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-install-project --no-dev

COPY src README.md ./
RUN uv sync --locked --no-dev

ENV PATH="/srv/.venv/bin:${PATH}"

EXPOSE 8080

# Runtime default: serve the API.
CMD ["sh", "-c", "exec uvicorn harvester.main:app --host 0.0.0.0 --port \"${PORT:-8080}\""]
