import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    DEFAULT_TLS_FINGERPRINT_PROBE_URL,
    loadConfig
} from "../../src/config.js";

describe("loadConfig", () => {
    it("uses safe defaults", () => {
        assert.deepEqual(loadConfig({}), {
            port: 8082,
            renderConcurrency: 3,
            browserChannel: "chrome",
            headless: true,
            locale: "en-AU",
            timezone: "Australia/Sydney",
            viewport: { width: 1440, height: 900 },
            userAgent: undefined,
            tlsProbeUrl: DEFAULT_TLS_FINGERPRINT_PROBE_URL
        });
    });

    it("disables the TLS probe when its URL is blank", () => {
        assert.equal(
            loadConfig({ TLS_FINGERPRINT_PROBE_URL: "" }).tlsProbeUrl,
            undefined
        );
    });

    it("reads valid settings", () => {
        assert.deepEqual(
            loadConfig({
                PORT: "9000",
                RENDER_CONCURRENCY: "5",
                BROWSER_CHANNEL: "",
                HEADLESS: "false",
                LOCALE: "en-GB",
                TIMEZONE: "Europe/London",
                VIEWPORT_WIDTH: "1280",
                VIEWPORT_HEIGHT: "720",
                USER_AGENT: "PostureAssessment/1.0",
                TLS_FINGERPRINT_PROBE_URL: "https://probe.internal/api"
            }),
            {
                port: 9000,
                renderConcurrency: 5,
                browserChannel: "",
                headless: false,
                locale: "en-GB",
                timezone: "Europe/London",
                viewport: { width: 1280, height: 720 },
                userAgent: "PostureAssessment/1.0",
                tlsProbeUrl: "https://probe.internal/api"
            }
        );
    });

    it("rejects invalid numeric settings", () => {
        assert.throws(
            () => loadConfig({ PORT: "not-a-number" }),
            /PORT must be a positive integer/
        );
        assert.throws(
            () => loadConfig({ RENDER_CONCURRENCY: "0" }),
            /RENDER_CONCURRENCY must be a positive integer/
        );
    });
});
