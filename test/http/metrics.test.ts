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
import {
    createMetricsRegistry
} from "../../src/infrastructure/metrics/registry.js";

const renderResult: RenderResult = {
    url: "https://www.example.com",
    finalUrl: "https://www.example.com/",
    status: 200,
    title: "Example",
    html: "<html></html>",
    requestHeaders: {},
    responseHeaders: {},
    cookies: [],
    blocking: { outcome: "served", vendor: "unknown", signals: [] },
    scraper: buildScraperHandoff({
        finalUrl: "https://www.example.com/",
        requestHeaders: {},
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
    checkedAt: "2026-07-26T00:00:00.000Z"
};
const renderer: PageRenderer = {
    render: () => Promise.resolve(renderResult)
};
const botChecks: BotCheckRunner = {
    run: () => Promise.resolve(botCheckResult)
};
const metrics = createMetricsRegistry();
const app = await createHttpServer({
    renderPage: new RenderPage(renderer),
    runBotCheck: new RunBotCheck(botChecks),
    concurrency: 2,
    logger: false,
    apiKey: "test-key",
    allowedHosts: ["www.example.com"],
    metrics
});

after(async () => {
    await app.close();
});

async function scrape(): Promise<string> {
    const response = await app.inject({ method: "GET", url: "/metrics" });

    assert.equal(response.statusCode, 200);
    return response.body;
}

/** Reads one sample out of the exposition, e.g. `name{label="x"}`. */
function sampleOf(body: string, series: string): number | undefined {
    const line = body.split("\n").find(
        (row) => row.startsWith(`${series} `)
    );

    return line === undefined ? undefined : Number(line.slice(series.length));
}

describe("metrics endpoint", () => {
    it("serves the registry without the API key", async () => {
        // Prometheus is free to append query parameters, and the scraper has
        // no business holding the operator's token.
        const response = await app.inject({
            method: "GET",
            url: "/metrics?collect[]=nodejs"
        });

        assert.equal(response.statusCode, 200);
        assert.match(
            response.headers["content-type"] as string,
            /^text\/plain/
        );
        assert.match(response.body, /^harvester_build_info\{version="/m);
        assert.match(response.body, /^process_cpu_seconds_total /m);
    });

    it("counts a render under its blocking outcome", async () => {
        const response = await app.inject({
            method: "POST",
            url: "/render",
            headers: { authorization: "Bearer test-key" },
            payload: { url: "https://www.example.com/path" }
        });

        assert.equal(response.statusCode, 200);

        const body = await scrape();

        assert.equal(
            sampleOf(body, 'harvester_renders_total{outcome="served"}'),
            1
        );
        assert.equal(
            sampleOf(
                body,
                'harvester_render_duration_seconds_count{outcome="served"}'
            ),
            1
        );
        // Nothing was refused and nothing failed, so the other series are
        // present at zero rather than missing.
        assert.equal(
            sampleOf(body, 'harvester_renders_total{outcome="blocked"}'),
            0
        );
    });

    it("counts refusals by reason", async () => {
        await app.inject({
            method: "POST",
            url: "/render",
            headers: { authorization: "Bearer test-key" },
            payload: { url: "https://evil.example.net/" }
        });
        await app.inject({
            method: "POST",
            url: "/render",
            payload: { url: "https://www.example.com/" }
        });

        const body = await scrape();

        assert.equal(
            sampleOf(
                body,
                'harvester_renders_rejected_total{reason="host_not_allowed"}'
            ),
            1
        );
        assert.equal(
            sampleOf(
                body,
                'harvester_renders_rejected_total{reason="unauthorized"}'
            ),
            1
        );
    });

    it("maps a rejected target onto its own outcome", async () => {
        await app.inject({
            method: "POST",
            url: "/render",
            headers: { authorization: "Bearer test-key" },
            payload: {
                url: "https://www.example.com",
                proxy: { server: "ftp://proxy.example:21" }
            }
        });

        assert.equal(
            sampleOf(
                await scrape(),
                'harvester_renders_total{outcome="invalid_proxy"}'
            ),
            1
        );
    });

    it("reads the render queue when it is scraped", async () => {
        assert.equal(
            sampleOf(await scrape(), "harvester_render_concurrency_limit"),
            2
        );
        assert.equal(
            sampleOf(await scrape(), "harvester_render_queue_pending"),
            0
        );
    });
});
