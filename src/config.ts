export const DEFAULT_TLS_FINGERPRINT_PROBE_URL = "https://tls.peet.ws/api/all";

export interface AppConfig {
    port: number;
    renderConcurrency: number;
    browserChannel: string;
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
            : environment.TLS_FINGERPRINT_PROBE_URL || undefined
    };
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
