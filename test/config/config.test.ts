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
            browserExecutablePath: undefined,
            headless: true,
            locale: "en-AU",
            timezone: "Australia/Sydney",
            viewport: { width: 1440, height: 900 },
            userAgent: undefined,
            tlsProbeUrl: DEFAULT_TLS_FINGERPRINT_PROBE_URL,
            proxy: undefined,
            apiKey: undefined,
            allowedHosts: []
        });
    });

    it("reads the API key and allowed hosts", () => {
        assert.equal(loadConfig({ API_KEY: "  secret " }).apiKey, "secret");
        assert.equal(loadConfig({ API_KEY: " " }).apiKey, undefined);
        assert.deepEqual(
            loadConfig({ ALLOWED_HOSTS: " WWW.Example.com, ,api.example.com " }).allowedHosts,
            ["www.example.com", "api.example.com"]
        );
        assert.deepEqual(loadConfig({ ALLOWED_HOSTS: " " }).allowedHosts, []);
    });

    it("reads proxy settings and validates them", () => {
        assert.deepEqual(
            loadConfig({
                PROXY_SERVER: "proxy.example:3128",
                PROXY_USERNAME: "scout",
                PROXY_PASSWORD: "hunter2",
                PROXY_BYPASS: ".internal"
            }).proxy,
            {
                server: "http://proxy.example:3128",
                username: "scout",
                password: "hunter2",
                bypass: ".internal"
            }
        );
        assert.equal(loadConfig({ PROXY_SERVER: "  " }).proxy, undefined);
        assert.throws(
            () => loadConfig({ PROXY_SERVER: "ftp://proxy.example:21" }),
            /only http, https, socks4, and socks5 proxies are supported/
        );
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
                BROWSER_EXECUTABLE_PATH: "/usr/local/bin/harvester-browser",
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
                browserExecutablePath: "/usr/local/bin/harvester-browser",
                headless: false,
                locale: "en-GB",
                timezone: "Europe/London",
                viewport: { width: 1280, height: 720 },
                userAgent: "PostureAssessment/1.0",
                tlsProbeUrl: "https://probe.internal/api",
                proxy: undefined,
                apiKey: undefined,
                allowedHosts: []
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
