import type { BlockAssessment } from "./blocking.js";
import {
    createProxySettings,
    type ProxyCommand,
    type ProxyDescription,
    type ProxySettings
} from "./proxy.js";
import type { ScraperHandoff } from "./scraper-handoff.js";

export const DEFAULT_RENDER_TIMEOUT_MS = 30_000;
export const MIN_RENDER_TIMEOUT_MS = 1_000;
export const MAX_RENDER_TIMEOUT_MS = 60_000;

export interface RenderCommand {
    url: string;
    timeoutMs?: number;
    screenshot?: boolean;
    waitForSelector?: string;
    /** Overrides the configured proxy for this render only. */
    proxy?: ProxyCommand;
    /**
     * Extra headers the page sends with every request, e.g. a retailer API's
     * expected `accept`. They flow into the handoff's recorded headers.
     */
    extraHeaders?: Record<string, string>;
}

export interface RenderRequest {
    url: string;
    timeoutMs: number;
    screenshot: boolean;
    waitForSelector: string | undefined;
    proxy: ProxySettings | undefined;
    extraHeaders: Record<string, string> | undefined;
}

export interface BrowserCookie {
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: "Strict" | "Lax" | "None";
}

export interface RenderResult {
    url: string;
    finalUrl: string;
    status: number;
    title: string;
    html: string;
    screenshot?: string;
    requestHeaders: Record<string, string>;
    responseHeaders: Record<string, string>;
    cookies: BrowserCookie[];
    blocking: BlockAssessment;
    /** Egress used for this render; absent when it went out direct. */
    proxy?: ProxyDescription;
    /** Replay kit for a non-browser HTTP client: headers, cookies, TLS. */
    scraper: ScraperHandoff;
    durationMs: number;
}

export class InvalidRenderTargetError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "InvalidRenderTargetError";
    }
}

export function createRenderRequest(command: RenderCommand): RenderRequest {
    return {
        url: parseWebUrl(command.url),
        timeoutMs: clampTimeout(command.timeoutMs),
        screenshot: command.screenshot ?? false,
        waitForSelector: command.waitForSelector || undefined,
        proxy: command.proxy ? createProxySettings(command.proxy) : undefined,
        extraHeaders: sanitizeExtraHeaders(command.extraHeaders)
    };
}

/**
 * Drops entries a browser context must own itself; pseudo/authority headers
 * can never be replayed and a spoofed host would break the origin.
 */
const EXTRA_HEADER_BLOCKLIST = new Set([
    "host",
    "content-length",
    "connection",
    "keep-alive",
    "transfer-encoding",
    "te",
    "upgrade"
]);

function sanitizeExtraHeaders(
    headers: Record<string, string> | undefined
): Record<string, string> | undefined {
    if (!headers) {
        return undefined;
    }

    const entries = Object.entries(headers).filter(([name, value]) => {
        const normalized = name.trim().toLowerCase();
        return normalized.length > 0
            && !normalized.startsWith(":")
            && !EXTRA_HEADER_BLOCKLIST.has(normalized)
            && value.length > 0;
    });

    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function parseWebUrl(value: string): string {
    let url: URL;

    try {
        url = new URL(value);
    } catch {
        throw new InvalidRenderTargetError("enter a valid URL");
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new InvalidRenderTargetError(
            "only HTTP and HTTPS URLs are supported"
        );
    }

    return value;
}

function clampTimeout(value = DEFAULT_RENDER_TIMEOUT_MS): number {
    return Math.min(
        Math.max(value, MIN_RENDER_TIMEOUT_MS),
        MAX_RENDER_TIMEOUT_MS
    );
}
