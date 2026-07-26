import assert from "node:assert/strict";
import { it } from "node:test";

import {
    RenderPage,
    type PageRenderer
} from "../../src/application/render-page.js";
import type {
    RenderRequest,
    RenderResult
} from "../../src/domain/rendering.js";
import { buildScraperHandoff } from "../../src/domain/scraper-handoff.js";

it("RenderPage validates the command before calling its renderer", async () => {
    let received: RenderRequest | undefined;
    const expected: RenderResult = {
        url: "https://example.com",
        finalUrl: "https://example.com/",
        status: 200,
        title: "Example",
        html: "<html></html>",
        requestHeaders: {},
        responseHeaders: {},
        cookies: [],
        blocking: { outcome: "served", vendor: "unknown", signals: [] },
        scraper: buildScraperHandoff({
            finalUrl: "https://example.com/",
            requestHeaders: {},
            cookies: []
        }),
        durationMs: 12
    };
    const renderer: PageRenderer = {
        render(request) {
            received = request;
            return Promise.resolve(expected);
        }
    };

    const result = await new RenderPage(renderer).execute({
        url: "https://example.com",
        screenshot: true
    });

    assert.equal(result, expected);
    assert.deepEqual(received, {
        url: "https://example.com",
        timeoutMs: 30_000,
        screenshot: true,
        waitForSelector: undefined,
        proxy: undefined
    });
});
