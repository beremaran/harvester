import assert from "node:assert/strict";
import { it } from "node:test";
import type { Browser } from "playwright";

import type { RenderMetrics } from "../../src/application/metrics.js";
import { profileFingerprint } from "../../src/domain/tls-fingerprint.js";
import type {
    BrowserProvider
} from "../../src/infrastructure/playwright/browser-manager.js";
import {
    PlaywrightPageRenderer
} from "../../src/infrastructure/playwright/playwright-page-renderer.js";

/**
 * The handful of Playwright calls a render makes, cast into place rather than
 * implemented: the real Browser/Page interfaces carry hundreds of members and
 * none of the rest are reachable from render().
 */
function browsersServing(
    status: number,
    responseHeaders: Record<string, string>
): BrowserProvider {
    const page = {
        goto: async () => ({
            status: () => status,
            allHeaders: async () => responseHeaders,
            request: () => ({
                allHeaders: async () => ({ "user-agent": "Chrome/133.0.0.0" })
            })
        }),
        waitForLoadState: async () => undefined,
        title: async () => "Just a moment...",
        url: () => "https://www.example.com/",
        content: async () => "<html></html>",
        evaluate: async () => "h2",
        close: async () => undefined
    };
    const context = {
        addInitScript: async () => undefined,
        newPage: async () => page,
        cookies: async () => []
    };

    return {
        getBrowser: async () => ({
            newContext: async () => context
        }) as unknown as Browser
    };
}

it("PlaywrightPageRenderer reports the defence that stopped it", async () => {
    const classified: [string, string][] = [];
    const metrics: RenderMetrics = {
        renderClassified: (outcome, vendor) => {
            classified.push([outcome, vendor]);
        }
    };
    const renderer = new PlaywrightPageRenderer(
        browsersServing(503, { "cf-ray": "8f3a1b2c3d4e5f60-SYD" }),
        {},
        Date.now,
        { fingerprint: async () => profileFingerprint(133) },
        metrics
    );

    const result = await renderer.render({
        url: "https://www.example.com/",
        timeoutMs: 30_000,
        screenshot: false,
        waitForSelector: undefined,
        proxy: undefined,
        extraHeaders: undefined
    });

    // The counter has to carry exactly what the response body carries, or the
    // dashboard and the evidence disagree about what happened.
    assert.equal(result.blocking.outcome, "blocked");
    assert.deepEqual(classified, [["blocked", "Cloudflare Bot Management"]]);
});
