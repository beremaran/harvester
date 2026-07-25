import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    DEFAULT_RENDER_TIMEOUT_MS,
    InvalidRenderTargetError,
    MAX_RENDER_TIMEOUT_MS,
    MIN_RENDER_TIMEOUT_MS,
    createRenderRequest
} from "../../src/domain/rendering.js";

describe("createRenderRequest", () => {
    it("creates a request with domain defaults", () => {
        assert.deepEqual(
            createRenderRequest({ url: "https://example.com" }),
            {
                url: "https://example.com",
                timeoutMs: DEFAULT_RENDER_TIMEOUT_MS,
                screenshot: false,
                waitForSelector: undefined
            }
        );
    });

    it("keeps a wait selector and drops an empty one", () => {
        assert.equal(
            createRenderRequest({
                url: "https://example.com",
                waitForSelector: "[data-testid=product-price]"
            }).waitForSelector,
            "[data-testid=product-price]"
        );
        assert.equal(
            createRenderRequest({
                url: "https://example.com",
                waitForSelector: ""
            }).waitForSelector,
            undefined
        );
    });

    it("clamps the timeout to the supported range", () => {
        assert.equal(
            createRenderRequest({
                url: "https://example.com",
                timeoutMs: 1
            }).timeoutMs,
            MIN_RENDER_TIMEOUT_MS
        );
        assert.equal(
            createRenderRequest({
                url: "https://example.com",
                timeoutMs: 90_000
            }).timeoutMs,
            MAX_RENDER_TIMEOUT_MS
        );
    });

    it("rejects invalid and unsupported URLs", () => {
        assert.throws(
            () => createRenderRequest({ url: "not a URL" }),
            InvalidRenderTargetError
        );
        assert.throws(
            () => createRenderRequest({ url: "file:///tmp/page.html" }),
            /only HTTP and HTTPS/
        );
    });
});
