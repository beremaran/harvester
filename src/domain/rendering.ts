import type { BlockAssessment } from "./blocking.js";
import type { ScraperHandoff } from "./scraper-handoff.js";

export const DEFAULT_RENDER_TIMEOUT_MS = 30_000;
export const MIN_RENDER_TIMEOUT_MS = 1_000;
export const MAX_RENDER_TIMEOUT_MS = 60_000;

export interface RenderCommand {
    url: string;
    timeoutMs?: number;
    screenshot?: boolean;
    waitForSelector?: string;
}

export interface RenderRequest {
    url: string;
    timeoutMs: number;
    screenshot: boolean;
    waitForSelector: string | undefined;
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
        waitForSelector: command.waitForSelector || undefined
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
