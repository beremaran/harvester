import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import {
    RenderPage,
    type PageRenderer
} from "../../src/application/render-page.js";
import {
    RunBotCheck,
    type BotCheckRunner
} from "../../src/application/run-bot-check.js";
import type { BotCheckResult } from "../../src/domain/bot-checks.js";
import type { RenderResult } from "../../src/domain/rendering.js";
import { buildScraperHandoff } from "../../src/domain/scraper-handoff.js";
import { createHttpServer } from "../../src/http/create-http-server.js";
import { APP_VERSION } from "../../src/version.js";

const renderResult: RenderResult = {
    url: "https://example.com",
    finalUrl: "https://example.com/",
    status: 200,
    title: "Example",
    html: "<html></html>",
    requestHeaders: { "user-agent": "Chrome/133.0.0.0" },
    responseHeaders: {},
    cookies: [],
    blocking: { outcome: "served", vendor: "unknown", signals: [] },
    scraper: buildScraperHandoff({
        finalUrl: "https://example.com/",
        requestHeaders: { "user-agent": "Chrome/133.0.0.0" },
        cookies: []
    }),
    durationMs: 10
};
const botCheckResult: BotCheckResult = {
    id: "rebrowser",
    url: "https://bot-detector.rebrowser.net/",
    title: "Bot detector",
    screenshot: "",
    evaluations: [],
    durationMs: 10,
    checkedAt: "2026-07-24T00:00:00.000Z"
};
const renderer: PageRenderer = {
    render: () => Promise.resolve(renderResult)
};
const botChecks: BotCheckRunner = {
    run: () => Promise.resolve(botCheckResult)
};
const app = await createHttpServer({
    renderPage: new RenderPage(renderer),
    runBotCheck: new RunBotCheck(botChecks),
    concurrency: 2,
    logger: false
});

after(() => app.close());

describe("HTTP server", () => {
    it("reports queue health", async () => {
        const response = await app.inject({ method: "GET", url: "/health" });

        assert.equal(response.statusCode, 200);
        assert.deepEqual(response.json(), {
            status: "ok",
            version: APP_VERSION,
            active: 0,
            pending: 0
        });
    });

    it("runs a valid render command", async () => {
        const response = await app.inject({
            method: "POST",
            url: "/render",
            payload: { url: "https://example.com" }
        });

        assert.equal(response.statusCode, 200);
        assert.deepEqual(response.json(), renderResult);
        // The replay kit must survive JSON serialisation intact — it is the
        // whole point of the endpoint for non-browser consumers.
        assert.equal(
            response.json().scraper.tlsClient.profile,
            "chrome_133"
        );
    });

    it("maps domain input errors to a bad request", async () => {
        const response = await app.inject({
            method: "POST",
            url: "/render",
            payload: { url: "file:///tmp/page.html" }
        });

        assert.equal(response.statusCode, 400);
        assert.deepEqual(response.json(), {
            error: "only HTTP and HTTPS URLs are supported"
        });
    });
});
