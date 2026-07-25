ARG DOCKER_PLATFORM=linux/amd64

FROM --platform=${DOCKER_PLATFORM} node:22-bookworm-slim AS build

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

WORKDIR /app

COPY package.json package-lock.json ./
# scripts/ holds the postinstall patch, so it must be present before npm ci.
COPY scripts ./scripts
RUN npm ci

COPY tsconfig.json ./
COPY vite.config.ts components.json ./
COPY src ./src
COPY web ./web
RUN npm run build

FROM --platform=${DOCKER_PLATFORM} node:22-bookworm-slim AS runtime

ARG DEBIAN_FRONTEND=noninteractive
# Stamped by the release workflow so /health reports the published tag.
ARG APP_VERSION=""

ENV APP_VERSION=${APP_VERSION} \
    NODE_ENV=production \
    BROWSER_CHANNEL=chrome \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    LANG=C.UTF-8 \
    PORT=8082 \
    HEADLESS=false

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        fontconfig \
        fonts-dejavu-core \
        fonts-liberation \
        fonts-noto-cjk \
        fonts-noto-color-emoji \
        fonts-noto-core \
        xvfb \
        xauth \
    && curl -fsSLo /tmp/google-chrome.deb \
        https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
    && apt-get install -y --no-install-recommends /tmp/google-chrome.deb \
    && fc-cache -f \
    && rm -f /tmp/google-chrome.deb \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY scripts ./scripts
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY --from=build /app/web-dist ./web-dist

USER node

EXPOSE 8082

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/health').then(response => { if (!response.ok) process.exit(1) }).catch(() => process.exit(1))"

# Xvfb gives Chrome a real display, so HEADLESS=false renders the way a
# desktop browser does. With HEADLESS=true (the default) it costs nothing.
CMD ["xvfb-run", "-a", "-s", "-screen 0 1440x900x24", "node", "dist/server.js"]
