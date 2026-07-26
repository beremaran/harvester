# The build stage only emits JavaScript, so it runs natively on the builder
# instead of under emulation. The runtime stage follows the target platform.
FROM --platform=${BUILDPLATFORM} node:26-bookworm-slim AS build

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

FROM node:26-bookworm-slim AS runtime

ARG DEBIAN_FRONTEND=noninteractive
# Stamped by the release workflow so /health reports the published tag.
ARG APP_VERSION=""
# Set by buildx: amd64 or arm64.
ARG TARGETARCH

ENV APP_VERSION=${APP_VERSION} \
    NODE_ENV=production \
    BROWSER_CHANNEL="" \
    BROWSER_EXECUTABLE_PATH=/usr/local/bin/harvester-browser \
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
        tini \
        xvfb \
        xauth \
    # Google publishes Chrome for Linux on x86-64 only, so arm64 falls back to
    # Debian's Chromium. Both land on one path the server launches by name.
    && if [ "$TARGETARCH" = "amd64" ]; then \
        curl -fsSLo /tmp/google-chrome.deb \
            https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
        && apt-get install -y --no-install-recommends /tmp/google-chrome.deb \
        && rm -f /tmp/google-chrome.deb \
        && ln -s /opt/google/chrome/chrome /usr/local/bin/harvester-browser; \
    else \
        apt-get install -y --no-install-recommends chromium \
        && ln -s /usr/bin/chromium /usr/local/bin/harvester-browser; \
    fi \
    && fc-cache -f \
    && rm -rf /var/lib/apt/lists/* \
    && /usr/local/bin/harvester-browser --version

COPY package.json package-lock.json ./
COPY scripts ./scripts
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY --from=build /app/web-dist ./web-dist

USER node

EXPOSE 8082

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/health').then(response => { if (!response.ok) process.exit(1) }).catch(() => process.exit(1))"

# xvfb-run waits for Xvfb to signal readiness with SIGUSR1, and a PID 1 shell
# never receives it: the server would never start and the container would sit
# unhealthy forever. tini takes PID 1 so the handshake works without the caller
# having to remember `docker run --init`.
ENTRYPOINT ["/usr/bin/tini", "--"]

# Xvfb gives Chrome a real display, so HEADLESS=false renders the way a
# desktop browser does. With HEADLESS=true (the default) it costs nothing.
CMD ["xvfb-run", "-a", "-s", "-screen 0 1440x900x24", "node", "dist/server.js"]
