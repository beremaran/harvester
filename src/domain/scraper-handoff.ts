/**
 * Everything a non-browser HTTP client needs to replay this session against
 * the same origin without tripping bot defence: the headers Chrome sent, the
 * order it sent them in, the cookie jar reduced to a single `Cookie` header,
 * and the transport fingerprint the request has to carry.
 */

import type { ProxyDescription } from "./proxy.js";
import type { BrowserCookie } from "./rendering.js";
import {
    chromeMajorVersion,
    profileFingerprint,
    tlsClientProfile,
    type TlsFingerprint
} from "./tls-fingerprint.js";

/**
 * Headers a replaying client must own itself. Copying ours produces either a
 * protocol error (`host`, `content-length` for the wrong body) or a silent
 * mismatch (`cookie` drifting from the jar, `accept-encoding` promising a
 * codec the client cannot decode).
 *
 * The conditional headers are here for a subtler reason. Contexts are cached
 * per origin, so they keep an HTTP cache: the *second* render of an origin is
 * a revalidation and Chrome attaches `if-none-match`. A replay is a fresh
 * request, not a revalidation, so inheriting that validator either draws a
 * bodiless 304 or -- for a consumer that allowlists replay headers -- rejects
 * the whole capture. Either way the first capture of an origin succeeds and
 * every later one fails, which reads as intermittent rather than as cache
 * state.
 */
const CLIENT_OWNED_HEADERS: Record<string, string> = {
    host: "set by the client from the request URL",
    ":authority": "HTTP/2 pseudo-header, set by the client",
    "content-length": "depends on the client's own body",
    connection: "connection-scoped, illegal over HTTP/2",
    "keep-alive": "connection-scoped, illegal over HTTP/2",
    "transfer-encoding": "connection-scoped, illegal over HTTP/2",
    cookie: "send `cookieHeader`, or let a cookie jar manage it",
    "accept-encoding": "must match the codecs the client can actually decode",
    "if-none-match": "cache validator from our context, not the replay's",
    "if-modified-since": "cache validator from our context, not the replay's",
    "if-match": "cache validator from our context, not the replay's",
    "if-unmodified-since": "cache validator from our context, not the replay's",
    "if-range": "cache validator from our context, not the replay's"
};

/**
 * Chrome's header order for a top-level document request.
 *
 * This has to be a known-good order rather than the observed one: CDP (and so
 * Playwright) hands back request headers alphabetised, and alphabetical order
 * is itself a tell — no browser sends headers that way.
 */
const CHROME_HEADER_ORDER = [
    "host",
    "sec-ch-ua",
    "sec-ch-ua-mobile",
    "sec-ch-ua-platform",
    "upgrade-insecure-requests",
    "user-agent",
    "accept",
    "sec-fetch-site",
    "sec-fetch-mode",
    "sec-fetch-user",
    "sec-fetch-dest",
    "accept-encoding",
    "accept-language",
    "cookie",
    "priority"
];

export interface TlsClientPreset {
    library: "bogdanfinn/tls-client";
    /** e.g. `chrome_133` — the `tlsClientIdentifier` for the API/Go client. */
    profile: string;
    /** POST body for the tls-client HTTP API, ready to send as-is. */
    requestPayload: Record<string, unknown>;
}

export interface ScraperProxyHandoff {
    /** Proxy the session was established through, without credentials. */
    server: string;
    /** Set when the proxy needs credentials the replaying client must supply. */
    note?: string;
}

export interface ScraperHandoff {
    /** Origin these headers and cookies are valid for. */
    origin: string;
    finalUrl: string;
    userAgent: string;
    /** Negotiated application protocol for the navigation, e.g. `h2`. */
    protocol: string;
    /** Replayable request headers, keyed by name. */
    headers: Record<string, string>;
    /** Order to send them in, including headers the client sets itself. */
    headerOrder: string[];
    /** Cookies scoped to `finalUrl`, folded into one `Cookie` header value. */
    cookieHeader: string;
    /** Header names deliberately left out of `headers`, and why. */
    clientOwnedHeaders: Record<string, string>;
    tls: TlsFingerprint;
    tlsClient: TlsClientPreset;
    /** Egress to replay through, when the render used one. */
    proxy?: ScraperProxyHandoff;
    /** Equivalent `curl_chrome*` invocation from curl-impersonate. */
    curlImpersonate: string;
}

export interface ScraperHandoffInput {
    finalUrl: string;
    requestHeaders: Record<string, string>;
    cookies: BrowserCookie[];
    protocol?: string;
    /** Measured fingerprint; falls back to the version profile when absent. */
    tls?: TlsFingerprint;
    timeoutMs?: number;
    /** Egress the render used, so the replay can leave from the same IP. */
    proxy?: ProxyDescription;
}

export function buildScraperHandoff(
    input: ScraperHandoffInput
): ScraperHandoff {
    const userAgent = input.requestHeaders["user-agent"] ?? "";
    const majorVersion = chromeMajorVersion(userAgent);
    const profile = tlsClientProfile(majorVersion);
    const tls = withProfileGapNote(
        input.tls ?? profileFingerprint(majorVersion),
        majorVersion,
        profile
    );
    const headerOrder = orderHeaderNames(Object.keys(input.requestHeaders));
    const headers = Object.fromEntries(
        headerOrder
            .filter((name) => !(name in CLIENT_OWNED_HEADERS))
            .flatMap((name) => {
                const value = input.requestHeaders[name];
                return value === undefined ? [] : [[name, value] as const];
            })
    );
    const cookieHeader = buildCookieHeader(input.cookies, input.finalUrl);
    const proxy = input.proxy ? proxyHandoff(input.proxy) : undefined;

    return {
        origin: new URL(input.finalUrl).origin,
        finalUrl: input.finalUrl,
        userAgent,
        protocol: input.protocol ?? "h2",
        headers,
        headerOrder,
        cookieHeader,
        clientOwnedHeaders: pick(CLIENT_OWNED_HEADERS, headerOrder),
        tls,
        tlsClient: {
            library: "bogdanfinn/tls-client",
            profile,
            requestPayload: {
                tlsClientIdentifier: profile,
                requestUrl: input.finalUrl,
                requestMethod: "GET",
                followRedirects: true,
                insecureSkipVerify: false,
                // Chrome reshuffles its extension order on every ClientHello;
                // a fixed order is itself a fingerprint.
                withRandomTLSExtensionOrder: true,
                timeoutSeconds: Math.ceil((input.timeoutMs ?? 30_000) / 1_000),
                headers: cookieHeader
                    ? { ...headers, cookie: cookieHeader }
                    : headers,
                headerOrder,
                ...(proxy ? { proxyUrl: proxy.server } : {})
            }
        },
        ...(proxy ? { proxy } : {}),
        curlImpersonate: buildCurlCommand(
            input.finalUrl,
            headers,
            cookieHeader,
            majorVersion,
            proxy?.server
        )
    };
}

/**
 * The session above was established from the proxy's exit IP, so a replay from
 * anywhere else contradicts it. Credentials are deliberately left out: with an
 * environment-configured proxy they belong to the operator, not to whoever
 * called `/render`.
 */
function proxyHandoff(proxy: ProxyDescription): ScraperProxyHandoff {
    return {
        server: proxy.server,
        ...(proxy.authenticated
            ? {
                note: "this proxy authenticates — add the credentials as"
                    + " `scheme://user:password@host:port`"
            }
            : {})
    };
}

/**
 * Cookies the browser would attach to this URL: domain match (host-only or
 * suffix), path match, and `secure` honoured. `httpOnly` is irrelevant to a
 * non-browser client, so those are kept.
 */
export function buildCookieHeader(
    cookies: BrowserCookie[],
    targetUrl: string
): string {
    const url = new URL(targetUrl);
    const isSecure = url.protocol === "https:";

    return cookies
        .filter((cookie) => {
            if (cookie.secure && !isSecure) return false;
            if (!domainMatches(url.hostname, cookie.domain)) return false;
            return pathMatches(url.pathname, cookie.path);
        })
        .map((cookie) => `${cookie.name}=${cookie.value}`)
        .join("; ");
}

function domainMatches(hostname: string, cookieDomain: string): boolean {
    const domain = cookieDomain.startsWith(".")
        ? cookieDomain.slice(1)
        : cookieDomain;

    return hostname === domain || hostname.endsWith(`.${domain}`);
}

function pathMatches(pathname: string, cookiePath: string): boolean {
    if (!cookiePath || cookiePath === "/") return true;
    if (pathname === cookiePath) return true;

    return pathname.startsWith(
        cookiePath.endsWith("/") ? cookiePath : `${cookiePath}/`
    );
}

/**
 * The full order to send: every header Chrome sends for a document request,
 * in Chrome's order, followed by anything else observed on this request (in
 * the order it was observed) since custom headers trail the standard set.
 */
function orderHeaderNames(observed: string[]): string[] {
    const extra = observed.filter(
        (name) => !CHROME_HEADER_ORDER.includes(name)
    );

    return [...CHROME_HEADER_ORDER, ...extra];
}

/**
 * The library's newest profile can trail the Chrome we render with by several
 * releases. The handshake it produces is then a real, older Chrome rather
 * than the one in our `user-agent` — worth saying out loud, because it is a
 * mismatch a defence can notice.
 */
function withProfileGapNote(
    tls: TlsFingerprint,
    majorVersion: number,
    profile: string
): TlsFingerprint {
    const profileVersion = Number(profile.split("_").at(-1));

    if (!majorVersion || profileVersion >= majorVersion) {
        return tls;
    }

    return {
        ...tls,
        notes: [
            ...tls.notes,
            `tls-client's newest Chrome profile is ${profile}, behind the`
            + ` Chrome ${majorVersion} that rendered this page — align the`
            + ` user-agent with the profile, or the two disagree.`
        ]
    };
}

function pick(
    source: Record<string, string>,
    names: string[]
): Record<string, string> {
    return Object.fromEntries(
        names.flatMap((name) => {
            const value = source[name];
            return value === undefined ? [] : [[name, value] as const];
        })
    );
}

/**
 * curl-impersonate ships one wrapper per impersonated release, so the command
 * has to name a build that exists. Same clamping rule as the tls-client
 * profile: the newest wrapper that is not ahead of our browser.
 */
const CURL_IMPERSONATE_TARGETS = [
    99, 100, 101, 104, 107, 110, 116, 119, 120, 123, 124, 131, 133, 136
];

function buildCurlCommand(
    url: string,
    headers: Record<string, string>,
    cookieHeader: string,
    majorVersion: number,
    proxyServer?: string
): string {
    const target = CURL_IMPERSONATE_TARGETS
        .filter((version) => version <= majorVersion)
        .at(-1) ?? CURL_IMPERSONATE_TARGETS[0];
    const binary = `curl_chrome${target}`;
    const parts = Object.entries(headers).map(
        ([name, value]) => `-H ${shellQuote(`${name}: ${value}`)}`
    );

    if (cookieHeader) {
        parts.push(`-H ${shellQuote(`cookie: ${cookieHeader}`)}`);
    }

    if (proxyServer) {
        parts.push(`--proxy ${shellQuote(proxyServer)}`);
    }

    return `${binary} ${parts.join(" ")} ${shellQuote(url)}`;
}

function shellQuote(value: string): string {
    return `'${value.replaceAll("'", `'\\''`)}'`;
}
