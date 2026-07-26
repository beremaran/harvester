import { createProxySettings, type ProxySettings } from "./domain/proxy.js";

export const DEFAULT_TLS_FINGERPRINT_PROBE_URL = "https://tls.peet.ws/api/all";

export interface AppConfig {
    port: number;
    renderConcurrency: number;
    browserChannel: string;
    /**
     * Browser binary to launch instead of a channel. The arm64 image sets it
     * because Google publishes Chrome for Linux on x86-64 only.
     */
    browserExecutablePath: string | undefined;
    headless: boolean;
    locale: string;
    timezone: string;
    viewport: { width: number; height: number };
    userAgent: string | undefined;
    /**
     * Endpoint the renderer hits to measure its own TLS/HTTP2 fingerprint.
     * Empty disables the probe and falls back to the Chrome version profile.
     */
    tlsProbeUrl: string | undefined;
    /** Proxy every render leaves through unless the request overrides it. */
    proxy: ProxySettings | undefined;
    /** When set, /render and /bot-check require this bearer token. */
    apiKey: string | undefined;
    /**
     * Hostnames /render may target, lowercased. Empty allows any host;
     * set it so the service cannot be used as an open render proxy.
     */
    allowedHosts: string[];
}

export function loadConfig(
    environment: NodeJS.ProcessEnv = process.env
): AppConfig {
    return {
        port: readPositiveInteger(environment.PORT, 8082, "PORT"),
        renderConcurrency: readPositiveInteger(
            environment.RENDER_CONCURRENCY,
            3,
            "RENDER_CONCURRENCY"
        ),
        browserChannel: environment.BROWSER_CHANNEL ?? "chrome",
        browserExecutablePath:
            environment.BROWSER_EXECUTABLE_PATH?.trim() || undefined,
        headless: environment.HEADLESS !== "false",
        locale: environment.LOCALE ?? "en-AU",
        timezone: environment.TIMEZONE ?? "Australia/Sydney",
        viewport: {
            width: readPositiveInteger(
                environment.VIEWPORT_WIDTH,
                1440,
                "VIEWPORT_WIDTH"
            ),
            height: readPositiveInteger(
                environment.VIEWPORT_HEIGHT,
                900,
                "VIEWPORT_HEIGHT"
            )
        },
        userAgent: environment.USER_AGENT || undefined,
        tlsProbeUrl: environment.TLS_FINGERPRINT_PROBE_URL === undefined
            ? DEFAULT_TLS_FINGERPRINT_PROBE_URL
            : environment.TLS_FINGERPRINT_PROBE_URL || undefined,
        proxy: readProxy(environment),
        apiKey: environment.API_KEY?.trim() || undefined,
        allowedHosts: (environment.ALLOWED_HOSTS ?? "")
            .split(",")
            .map((host) => host.trim().toLowerCase())
            .filter((host) => host.length > 0)
    };
}

function readProxy(
    environment: NodeJS.ProcessEnv
): ProxySettings | undefined {
    const server = environment.PROXY_SERVER?.trim();

    if (!server) {
        return undefined;
    }

    return createProxySettings({
        server,
        ...(environment.PROXY_USERNAME ? {
            username: environment.PROXY_USERNAME
        } : {}),
        ...(environment.PROXY_PASSWORD ? {
            password: environment.PROXY_PASSWORD
        } : {}),
        ...(environment.PROXY_BYPASS ? {
            bypass: environment.PROXY_BYPASS
        } : {})
    });
}

function readPositiveInteger(
    value: string | undefined,
    defaultValue: number,
    name: string
): number {
    if (value === undefined) {
        return defaultValue;
    }

    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        throw new Error(`${name} must be a positive integer`);
    }

    return parsed;
}
