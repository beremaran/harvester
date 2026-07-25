import path from "node:path";
import { fileURLToPath } from "node:url";

import { RenderPage } from "./application/render-page.js";
import { RunBotCheck } from "./application/run-bot-check.js";
import { loadConfig } from "./config.js";
import { createHttpServer } from "./http/create-http-server.js";
import { BrowserManager } from "./infrastructure/playwright/browser-manager.js";
import {
    PlaywrightBotCheckRunner
} from "./infrastructure/playwright/playwright-bot-check-runner.js";
import {
    PlaywrightPageRenderer
} from "./infrastructure/playwright/playwright-page-renderer.js";
import {
    PlaywrightTlsFingerprintProbe
} from "./infrastructure/playwright/tls-fingerprint-probe.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(currentDir, "../web-dist");
const config = loadConfig();
const browsers = new BrowserManager({
    channel: config.browserChannel,
    headless: config.headless,
    viewport: config.viewport
});
const tlsFingerprints = new PlaywrightTlsFingerprintProbe(
    browsers,
    { probeUrl: config.tlsProbeUrl },
    (error) => console.warn("TLS fingerprint probe failed", error)
);
const renderer = new PlaywrightPageRenderer(
    browsers,
    {
        locale: config.locale,
        timezone: config.timezone,
        viewport: config.viewport,
        userAgent: config.userAgent
    },
    Date.now,
    tlsFingerprints
);
const app = await createHttpServer({
    renderPage: new RenderPage(renderer),
    runBotCheck: new RunBotCheck(
        new PlaywrightBotCheckRunner(browsers, { viewport: config.viewport })
    ),
    concurrency: config.renderConcurrency,
    webRoot
});
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) {
        return;
    }
    shuttingDown = true;

    app.log.info({ signal }, "shutting down");

    await app.close();
    await renderer.close();
    await tlsFingerprints.close();
    await browsers.close();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await app.listen({
    host: "0.0.0.0",
    port: config.port
});
