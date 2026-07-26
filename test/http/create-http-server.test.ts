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
const securedApp = await createHttpServer({
    renderPage: new RenderPage(renderer),
    runBotCheck: new RunBotCheck(botChecks),
    concurrency: 1,
    logger: false,
    apiKey: "test-key",
    allowedHosts: ["www.example.com"]
});

after(async () => {
    await app.close();
    await securedApp.close();
});

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

    it("rejects an unusable proxy before starting a browser", async () => {
        const response = await app.inject({
            method: "POST",
            url: "/render",
            payload: {
                url: "https://example.com",
                proxy: { server: "ftp://proxy.example:21" }
            }
        });

        assert.equal(response.statusCode, 400);
        assert.deepEqual(response.json(), {
            error: "only http, https, socks4, and socks5 proxies are supported"
        });
    });

    it("rejects a proxy without a server", async () => {
        const response = await app.inject({
            method: "POST",
            url: "/render",
            payload: { url: "https://example.com", proxy: { username: "a" } }
        });

        assert.equal(response.statusCode, 400);
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

    it("forwards extra headers to the renderer", async () => {
        let seen: Record<string, string> | undefined;
        const capturing = await createHttpServer({
            renderPage: new RenderPage({
                render: (request) => {
                    seen = request.extraHeaders;
                    return Promise.resolve(renderResult);
                }
            }),
            runBotCheck: new RunBotCheck(botChecks),
            concurrency: 1,
            logger: false
        });

        const response = await capturing.inject({
            method: "POST",
            url: "/render",
            payload: {
                url: "https://example.com",
                extraHeaders: { accept: "application/json" }
            }
        });

        assert.equal(response.statusCode, 200);
        assert.deepEqual(seen, { accept: "application/json" });
        await capturing.close();
    });
});

describe("HTTP server with auth and an allowlist", () => {
    const secured = securedApp;

    it("leaves /health open", async () => {
        const response = await secured.inject({ method: "GET", url: "/health" });

        assert.equal(response.statusCode, 200);
    });

    it("rejects a missing or wrong bearer token", async () => {
        for (const authorization of [undefined, "Bearer wrong"]) {
            const response = await secured.inject({
                method: "POST",
                url: "/render",
                headers: authorization ? { authorization } : {},
                payload: { url: "https://www.example.com" }
            });

            assert.equal(response.statusCode, 401);
            assert.deepEqual(response.json(), { error: "unauthorized" });
        }
    });

    it("rejects a target outside the allowlist", async () => {
        const response = await secured.inject({
            method: "POST",
            url: "/render",
            headers: { authorization: "Bearer test-key" },
            payload: { url: "https://evil.example.net/" }
        });

        assert.equal(response.statusCode, 403);
        assert.deepEqual(response.json(), {
            error: "render target host is not allowed"
        });
    });

    it("renders an allowed host with the right token", async () => {
        const response = await secured.inject({
            method: "POST",
            url: "/render",
            headers: { authorization: "Bearer test-key" },
            payload: { url: "https://www.example.com/path" }
        });

        assert.equal(response.statusCode, 200);
        assert.deepEqual(response.json(), renderResult);
    });
});
