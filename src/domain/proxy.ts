/**
 * Egress proxy settings for a render.
 *
 * A proxy can come from the environment (every render uses it) or from the
 * request body (that render only). Both go through `createProxySettings`, so
 * the same validation and normalisation applies wherever it was configured.
 */

export interface ProxyCommand {
    server: string;
    username?: string;
    password?: string;
    bypass?: string;
}

export interface ProxySettings {
    /** Scheme, host, and port only — credentials are split out. */
    server: string;
    username: string | undefined;
    password: string | undefined;
    /** Comma-separated hosts to reach directly, e.g. `.internal, localhost`. */
    bypass: string | undefined;
}

export type ProxySource = "request" | "config";

/** What a render reports about its egress. Credentials are never included. */
export interface ProxyDescription {
    server: string;
    source: ProxySource;
    authenticated: boolean;
}

const SUPPORTED_PROTOCOLS = ["http:", "https:", "socks4:", "socks5:"];

export class InvalidProxyError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "InvalidProxyError";
    }
}

export function createProxySettings(command: ProxyCommand): ProxySettings {
    const raw = command.server.trim();

    if (!raw) {
        throw new InvalidProxyError("enter a proxy server");
    }

    // Playwright reads a scheme-less `host:3128` as an HTTP proxy; URL parsing
    // would read `host` as the scheme, so spell it out before parsing.
    const url = parseProxyUrl(
        /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`
    );

    if (!SUPPORTED_PROTOCOLS.includes(url.protocol)) {
        throw new InvalidProxyError(
            "only http, https, socks4, and socks5 proxies are supported"
        );
    }

    if (!url.hostname) {
        throw new InvalidProxyError("the proxy server needs a host");
    }

    // Chrome ignores credentials embedded in `--proxy-server`, so lift them
    // out of the URL and let Playwright answer the proxy auth challenge.
    const username = decode(url.username) || command.username?.trim() || undefined;
    const password = decode(url.password) || command.password || undefined;

    if (username && url.protocol.startsWith("socks")) {
        throw new InvalidProxyError(
            "Chromium cannot authenticate to a SOCKS proxy — use an"
            + " http proxy, or an IP-allowlisted SOCKS endpoint"
        );
    }

    return {
        server: `${url.protocol}//${url.host}`,
        username,
        password,
        bypass: command.bypass?.trim() || undefined
    };
}

export function describeProxy(
    settings: ProxySettings,
    source: ProxySource
): ProxyDescription {
    return {
        server: settings.server,
        source,
        authenticated: Boolean(settings.username)
    };
}

/**
 * Identity of a proxy for context reuse. Two renders may only share a browser
 * context when they leave through the same proxy as the same user — otherwise
 * one origin's session would be visible from a second exit IP, which is
 * exactly the inconsistency a defence looks for.
 */
export function proxyKey(settings: ProxySettings | undefined): string {
    if (!settings) {
        return "direct";
    }

    return [
        settings.server,
        settings.username ?? "",
        settings.bypass ?? ""
    ].join("|");
}

function parseProxyUrl(value: string): URL {
    try {
        return new URL(value);
    } catch {
        throw new InvalidProxyError("enter a valid proxy server URL");
    }
}

function decode(value: string): string {
    return value ? decodeURIComponent(value) : "";
}
