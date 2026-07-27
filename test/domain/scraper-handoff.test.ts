import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { BrowserCookie } from "../../src/domain/rendering.js";
import {
    buildCookieHeader,
    buildScraperHandoff
} from "../../src/domain/scraper-handoff.js";

const CHROME_UA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
    + " (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

function cookie(overrides: Partial<BrowserCookie> = {}): BrowserCookie {
    return {
        name: "session",
        value: "abc",
        domain: ".example.com",
        path: "/",
        expires: -1,
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
        ...overrides
    };
}

const requestHeaders = {
    "sec-ch-ua": '"Chromium";v="133"',
    "user-agent": CHROME_UA,
    accept: "text/html",
    "sec-fetch-dest": "document",
    "accept-encoding": "gzip, deflate, br, zstd",
    "accept-language": "en-AU,en;q=0.9",
    cookie: "session=abc"
};

describe("scraper handoff", () => {
    it("hands over the headers a client can safely replay", () => {
        const handoff = buildScraperHandoff({
            finalUrl: "https://www.example.com/shop",
            requestHeaders,
            cookies: [cookie({ domain: ".example.com" })]
        });

        assert.equal(handoff.headers["user-agent"], CHROME_UA);
        assert.equal(handoff.headers["sec-fetch-dest"], "document");
        assert.equal(handoff.headers.cookie, undefined);
        assert.equal(handoff.headers["accept-encoding"], undefined);
        assert.ok(handoff.clientOwnedHeaders.cookie);
        assert.ok(handoff.clientOwnedHeaders["accept-encoding"]);
        assert.equal(handoff.origin, "https://www.example.com");
    });

    it("drops cache validators a re-render picked up", () => {
        // A cached context revalidates on its second render of an origin, so
        // Chrome attaches if-none-match. Replaying it asks for a bodiless 304
        // and, where the consumer allowlists replay headers, invalidates the
        // whole capture -- so the first capture of an origin works and every
        // later one fails.
        const handoff = buildScraperHandoff({
            finalUrl: "https://www.example.com/",
            requestHeaders: {
                ...requestHeaders,
                "if-none-match": 'W/"abc123"',
                "if-modified-since": "Wed, 21 Oct 2026 07:28:00 GMT"
            },
            cookies: []
        });

        assert.equal(handoff.headers["if-none-match"], undefined);
        assert.equal(handoff.headers["if-modified-since"], undefined);
        assert.ok(handoff.clientOwnedHeaders["if-none-match"]);
        assert.ok(handoff.clientOwnedHeaders["if-modified-since"]);
        // The headers that make the replay look like Chrome must survive.
        assert.equal(handoff.headers["user-agent"], CHROME_UA);
    });

    it("emits Chrome's header order, not the alphabetised one", () => {
        const handoff = buildScraperHandoff({
            finalUrl: "https://www.example.com/",
            requestHeaders: { ...requestHeaders, "x-custom": "1" },
            cookies: []
        });
        const order = handoff.headerOrder;

        assert.equal(order[0], "host");
        assert.ok(order.indexOf("user-agent") < order.indexOf("accept"));
        assert.ok(
            order.indexOf("sec-fetch-dest") < order.indexOf("accept-encoding")
        );
        assert.ok(order.indexOf("cookie") < order.indexOf("priority"));
        // Headers Chrome does not send trail the standard set.
        assert.equal(order.at(-1), "x-custom");
        assert.notDeepEqual(order, [...order].sort());
    });

    it("flags a tls-client profile behind the rendering browser", () => {
        const handoff = buildScraperHandoff({
            finalUrl: "https://www.example.com/",
            requestHeaders: {
                "user-agent": CHROME_UA.replace("Chrome/133", "Chrome/150")
            },
            cookies: []
        });

        assert.equal(handoff.tlsClient.profile, "chrome_133");
        assert.ok(
            handoff.tls.notes.some((note) => note.includes("behind the"))
        );
    });

    it("reports Chrome's pseudo-header order", () => {
        const handoff = buildScraperHandoff({
            finalUrl: "https://www.example.com/",
            requestHeaders,
            cookies: []
        });

        assert.equal(handoff.tls.http2.pseudoHeaderOrder, "m,a,s,p");
        assert.equal(
            handoff.tls.http2.fingerprint,
            "1:65536;2:0;4:6291456;6:262144|15663105|0|m,a,s,p"
        );
    });

    it("pins a tls-client profile no newer than the browser", () => {
        const handoff = buildScraperHandoff({
            finalUrl: "https://www.example.com/",
            requestHeaders,
            cookies: [cookie()],
            timeoutMs: 20_000
        });
        const payload = handoff.tlsClient.requestPayload;

        assert.equal(handoff.tlsClient.profile, "chrome_133");
        assert.equal(payload.tlsClientIdentifier, "chrome_133");
        assert.equal(payload.withRandomTLSExtensionOrder, true);
        assert.equal(payload.timeoutSeconds, 20);
        assert.deepEqual(payload.headerOrder, handoff.headerOrder);
        assert.equal(
            (payload.headers as Record<string, string>).cookie,
            "session=abc"
        );
    });

    it("falls back to the version profile when nothing was measured", () => {
        const handoff = buildScraperHandoff({
            finalUrl: "https://www.example.com/",
            requestHeaders,
            cookies: []
        });

        assert.equal(handoff.tls.source, "profile");
        assert.equal(handoff.tls.chromeMajorVersion, 133);
        assert.ok(handoff.tls.curves.includes("X25519MLKEM768"));
        assert.deepEqual(handoff.tls.alpn, ["h2", "http/1.1"]);
    });

    it("quotes header values in the curl-impersonate command", () => {
        const handoff = buildScraperHandoff({
            finalUrl: "https://www.example.com/",
            requestHeaders: { ...requestHeaders, "x-note": "it's fine" },
            cookies: [cookie()]
        });

        assert.ok(handoff.curlImpersonate.startsWith("curl_chrome133 "));
        assert.ok(handoff.curlImpersonate.includes(`'x-note: it'\\''s fine'`));
        assert.ok(handoff.curlImpersonate.includes("'cookie: session=abc'"));
    });

    it("passes the egress on without its credentials", () => {
        const handoff = buildScraperHandoff({
            finalUrl: "https://www.example.com/",
            requestHeaders,
            cookies: [],
            proxy: {
                server: "http://proxy.example:3128",
                source: "config",
                authenticated: true
            }
        });

        assert.equal(handoff.proxy?.server, "http://proxy.example:3128");
        assert.match(handoff.proxy?.note ?? "", /authenticates/);
        assert.equal(
            handoff.tlsClient.requestPayload.proxyUrl,
            "http://proxy.example:3128"
        );
        assert.ok(
            handoff.curlImpersonate.includes("--proxy 'http://proxy.example:3128'")
        );
    });

    it("leaves the egress out of a direct render", () => {
        const handoff = buildScraperHandoff({
            finalUrl: "https://www.example.com/",
            requestHeaders,
            cookies: []
        });

        assert.equal(handoff.proxy, undefined);
        assert.equal(handoff.tlsClient.requestPayload.proxyUrl, undefined);
        assert.ok(!handoff.curlImpersonate.includes("--proxy"));
    });
});

describe("cookie header", () => {
    it("includes cookies scoped to the target URL", () => {
        const header = buildCookieHeader(
            [
                cookie({ name: "a", domain: ".example.com", path: "/" }),
                cookie({ name: "b", domain: "www.example.com", path: "/shop" }),
                cookie({ name: "c", domain: ".example.com", path: "/admin" }),
                cookie({ name: "d", domain: "other.com" })
            ],
            "https://www.example.com/shop/item"
        );

        assert.equal(header, "a=abc; b=abc");
    });

    it("withholds secure cookies from plaintext URLs", () => {
        const cookies = [
            cookie({ name: "s", secure: true }),
            cookie({ name: "p", secure: false })
        ];

        assert.equal(
            buildCookieHeader(cookies, "http://www.example.com/"),
            "p=abc"
        );
        assert.equal(
            buildCookieHeader(cookies, "https://www.example.com/"),
            "s=abc; p=abc"
        );
    });

    it("does not treat a path prefix as a path match", () => {
        const header = buildCookieHeader(
            [cookie({ name: "a", path: "/shop" })],
            "https://www.example.com/shopping"
        );

        assert.equal(header, "");
    });
});
