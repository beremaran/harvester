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
}

export interface RenderRequest {
    url: string;
    timeoutMs: number;
    screenshot: boolean;
    waitForSelector: string | undefined;
    proxy: ProxySettings | undefined;
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
        proxy: command.proxy ? createProxySettings(command.proxy) : undefined
    };
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
