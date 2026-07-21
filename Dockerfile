# Cookie/session harvester production image.
# Base image ships Chromium + all system deps matching the pinned Playwright.
# Playwright is pinned to 1.52.0 (not the latest) because that's the newest
# version whose Python driver still ships unbundled lib/server/chromium/*.js
# files -- required for the rebrowser-patches CDP stealth patch below to have
# something to patch. See ENABLE_CDP_STEALTH_PATCH in README.md.
# For tests, see Dockerfile.test.
FROM mcr.microsoft.com/playwright/python:v1.52.0-noble
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PORT=8080 \
    REBROWSER_PATCHES_RUNTIME_FIX_MODE=0

WORKDIR /srv

COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-install-project --no-dev

# Patches the Playwright Node driver to stop calling CDP Runtime.enable
# (a leak used by anti-bot fingerprinting like Iphey's hasCDP check).
# Inert unless REBROWSER_PATCHES_RUNTIME_FIX_MODE is overridden at runtime
# (see ENABLE_CDP_STEALTH_PATCH in config.py/README.md). Needs system
# node/npm -- the base image only ships the Node binary bundled inside the
# Playwright driver itself, not a usable `npx`, and is removed afterward
# since nothing at runtime needs it.
RUN apt-get update -qq \
    && apt-get install -y -qq --no-install-recommends nodejs npm patch \
    && npx --yes rebrowser-patches@latest patch \
         --packagePath=/srv/.venv/lib/python3.14/site-packages/playwright/driver/package \
    && apt-get purge -y -qq nodejs npm patch \
    && apt-get autoremove -y -qq \
    && rm -rf /var/lib/apt/lists/*

COPY src README.md ./
RUN uv sync --locked --no-dev

ENV PATH="/srv/.venv/bin:${PATH}"

EXPOSE 8080

# Runtime default: serve the API.
CMD ["sh", "-c", "exec uvicorn harvester.main:app --host 0.0.0.0 --port \"${PORT:-8080}\""]
