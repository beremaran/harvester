import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    InvalidProxyError,
    createProxySettings,
    describeProxy,
    proxyKey
} from "../../src/domain/proxy.js";

describe("createProxySettings", () => {
    it("keeps a full proxy URL and its separate credentials", () => {
        assert.deepEqual(
            createProxySettings({
                server: "http://proxy.example:3128",
                username: "scout",
                password: "hunter2",
                bypass: ".internal, localhost"
            }),
            {
                server: "http://proxy.example:3128",
                username: "scout",
                password: "hunter2",
                bypass: ".internal, localhost"
            }
        );
    });

    it("reads a scheme-less server as an HTTP proxy", () => {
        assert.equal(
            createProxySettings({ server: " proxy.example:3128 " }).server,
            "http://proxy.example:3128"
        );
    });

    it("lifts credentials out of the URL, since Chrome ignores them there", () => {
        assert.deepEqual(
            createProxySettings({
                server: "http://scout:p%40ss@proxy.example:3128"
            }),
            {
                server: "http://proxy.example:3128",
                username: "scout",
                password: "p@ss",
                bypass: undefined
            }
        );
    });

    it("supports socks proxies without credentials", () => {
        assert.equal(
            createProxySettings({ server: "socks5://proxy.example:1080" })
                .server,
            "socks5://proxy.example:1080"
        );
        assert.throws(
            () => createProxySettings({
                server: "socks5://scout:hunter2@proxy.example:1080"
            }),
            InvalidProxyError
        );
    });

    it("rejects a blank, unparseable, or unsupported server", () => {
        assert.throws(
            () => createProxySettings({ server: "  " }),
            /enter a proxy server/
        );
        assert.throws(
            () => createProxySettings({ server: "http://" }),
            InvalidProxyError
        );
        assert.throws(
            () => createProxySettings({ server: "ftp://proxy.example:21" }),
            /only http, https, socks4, and socks5 proxies are supported/
        );
    });
});

describe("describeProxy", () => {
    it("reports the egress without leaking credentials", () => {
        const settings = createProxySettings({
            server: "http://scout:hunter2@proxy.example:3128"
        });

        assert.deepEqual(describeProxy(settings, "request"), {
            server: "http://proxy.example:3128",
            source: "request",
            authenticated: true
        });
    });
});

describe("proxyKey", () => {
    it("separates direct traffic from each proxy identity", () => {
        const one = createProxySettings({ server: "http://a.example:3128" });
        const two = createProxySettings({ server: "http://b.example:3128" });
        const asOther = createProxySettings({
            server: "http://scout@a.example:3128"
        });

        assert.equal(proxyKey(undefined), "direct");
        assert.notEqual(proxyKey(one), proxyKey(two));
        assert.notEqual(proxyKey(one), proxyKey(asOther));
        assert.equal(
            proxyKey(one),
            proxyKey(createProxySettings({ server: "a.example:3128" }))
        );
    });

    it("ignores the password, which cannot change who we look like", () => {
        assert.equal(
            proxyKey(createProxySettings({
                server: "http://scout:one@a.example:3128"
            })),
            proxyKey(createProxySettings({
                server: "http://scout:two@a.example:3128"
            }))
        );
    });
});
