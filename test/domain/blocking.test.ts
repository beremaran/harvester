import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    assessBlocking,
    type BlockEvidence
} from "../../src/domain/blocking.js";

function evidence(overrides: Partial<BlockEvidence> = {}): BlockEvidence {
    return {
        status: 200,
        title: "Example",
        responseHeaders: {},
        cookieNames: [],
        ...overrides
    };
}

describe("assessBlocking", () => {
    it("reports a clean render as served with no vendor", () => {
        const assessment = assessBlocking(evidence());

        assert.equal(assessment.outcome, "served");
        assert.equal(assessment.vendor, "unknown");
        assert.deepEqual(assessment.signals, []);
    });

    it("names the vendor while still reporting a served page", () => {
        const assessment = assessBlocking(evidence({
            cookieNames: ["_abck", "bm_sz", "shopper_id"]
        }));

        assert.equal(assessment.outcome, "served");
        assert.equal(assessment.vendor, "Akamai Bot Manager");
        assert.deepEqual(
            assessment.signals.map((signal) => signal.detail),
            ["_abck", "bm_sz"]
        );
    });

    it("treats a refusal status as blocked and records it", () => {
        const assessment = assessBlocking(evidence({
            status: 403,
            cookieNames: ["_abck"]
        }));

        assert.equal(assessment.outcome, "blocked");
        assert.equal(assessment.vendor, "Akamai Bot Manager");
        assert.ok(assessment.signals.some(
            (signal) => signal.source === "status"
                && signal.detail === "HTTP 403"
        ));
    });

    it("treats an interstitial title as a challenge", () => {
        const assessment = assessBlocking(evidence({
            title: "Just a moment...",
            responseHeaders: { "cf-ray": "8a1b2c3d4e5f" }
        }));

        assert.equal(assessment.outcome, "challenged");
        assert.equal(assessment.vendor, "Cloudflare Bot Management");
        assert.ok(assessment.signals.some(
            (signal) => signal.source === "header"
                && signal.detail.startsWith("cf-ray:")
        ));
    });

    it("matches headers and cookies regardless of case", () => {
        const assessment = assessBlocking(evidence({
            cookieNames: ["VISID_INCAP_12345"],
            responseHeaders: { "X-Iinfo": "9-1234-5678" }
        }));

        assert.equal(assessment.vendor, "Imperva");
        assert.deepEqual(
            assessment.signals.map((signal) => signal.detail),
            ["visid_incap_12345", "x-iinfo: 9-1234-5678"]
        );
    });

    it("reports every vendor it finds", () => {
        const assessment = assessBlocking(evidence({
            status: 429,
            cookieNames: ["datadome", "_pxhd"]
        }));

        assert.equal(assessment.outcome, "blocked");
        assert.equal(assessment.vendor, "DataDome, PerimeterX / HUMAN");
    });
});
