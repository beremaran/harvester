import type { BrowserContext, Page } from "playwright";

import type { PageRenderer } from "../../application/render-page.js";
import { assessBlocking } from "../../domain/blocking.js";
import type {
    RenderRequest,
    RenderResult
} from "../../domain/rendering.js";
import { buildScraperHandoff } from "../../domain/scraper-handoff.js";
import {
    chromeMajorVersion,
    profileFingerprint
} from "../../domain/tls-fingerprint.js";
import type { BrowserProvider } from "./browser-manager.js";
import { STEALTH_INIT_SCRIPT } from "./stealth.js";
import type { TlsFingerprintProvider } from "./tls-fingerprint-probe.js";

export interface RenderContextOptions {
    locale: string;
    timezone: string;
    viewport: { width: number; height: number };
    userAgent: string | undefined;
}

const DEFAULT_CONTEXT: RenderContextOptions = {
    locale: "en-AU",
    timezone: "Australia/Sydney",
    viewport: { width: 1440, height: 900 },
    userAgent: undefined
};

export class PlaywrightPageRenderer implements PageRenderer {
    private readonly contexts = new Map<string, Promise<BrowserContext>>();
    private readonly options: RenderContextOptions;

    constructor(
        private readonly browsers: BrowserProvider,
        options: Partial<RenderContextOptions> = {},
        private readonly now: () => number = Date.now,
        private readonly tlsFingerprints: TlsFingerprintProvider = {
            fingerprint: async (userAgent) =>
                profileFingerprint(chromeMajorVersion(userAgent))
        }
    ) {
        this.options = { ...DEFAULT_CONTEXT, ...options };
    }

    async render(request: RenderRequest): Promise<RenderResult> {
        const startedAt = this.now();
        const context = await this.contextFor(request.url);
        const page = await context.newPage();

        try {
            const response = await page.goto(request.url, {
                waitUntil: "domcontentloaded",
                timeout: request.timeoutMs
            });

            if (request.waitForSelector) {
                await page.waitForSelector(request.waitForSelector, {
                    timeout: request.timeoutMs
                }).catch(() => undefined);
            }

            await page.waitForLoadState("networkidle", {
                timeout: Math.min(5_000, request.timeoutMs)
            }).catch(() => undefined);

            const requestHeaders = stripPseudoHeaders(
                response ? await response.request().allHeaders() : {}
            );
            const responseHeaders = stripPseudoHeaders(
                response ? await response.allHeaders() : {}
            );
            const cookies = await context.cookies();
            const title = await page.title();
            const finalUrl = page.url();
            const scraper = buildScraperHandoff({
                finalUrl,
                requestHeaders,
                cookies,
                protocol: (await negotiatedProtocol(page)) || "h2",
                tls: await this.tlsFingerprints.fingerprint(
                    requestHeaders["user-agent"] ?? ""
                ),
                timeoutMs: request.timeoutMs
            });

            return {
                url: request.url,
                finalUrl,
                status: response?.status() ?? 0,
                title,
                html: await page.content(),
                ...(request.screenshot
                    ? {
                        screenshot: (
                            await page.screenshot({ fullPage: true })
                        ).toString("base64")
                    }
                    : {}),
                requestHeaders,
                responseHeaders,
                cookies,
                blocking: assessBlocking({
                    status: response?.status() ?? 0,
                    title,
                    responseHeaders,
                    cookieNames: cookies.map((cookie) => cookie.name)
                }),
                scraper,
                durationMs: this.now() - startedAt
            };
        } finally {
            await page.close();
        }
    }

    /**
     * One context per origin, kept alive between renders. A fresh context per
     * request means an empty cookie jar every time, so consent and region
     * interstitials re-fire and no session is ever established.
     */
    private contextFor(url: string): Promise<BrowserContext> {
        const origin = new URL(url).origin;
        let context = this.contexts.get(origin);

        if (!context) {
            context = this.browsers.getBrowser().then(async (browser) => {
                const created = await browser.newContext({
                    locale: this.options.locale,
                    timezoneId: this.options.timezone,
                    viewport: this.options.viewport,
                    ...(this.options.userAgent
                        ? { userAgent: this.options.userAgent }
                        : {})
                });
                await created.addInitScript(STEALTH_INIT_SCRIPT);
                return created;
            }).catch((error: unknown) => {
                this.contexts.delete(origin);
                throw error;
            });
            this.contexts.set(origin, context);
        }

        return context;
    }

    async close(): Promise<void> {
        const pending = [...this.contexts.values()];
        this.contexts.clear();

        await Promise.all(pending.map(async (context) => {
            await (await context.catch(() => undefined))?.close();
        }));
    }
}

/** `h2`, `http/1.1`, or `` when the navigation timing is unavailable. */
async function negotiatedProtocol(page: Page): Promise<string> {
    return page.evaluate(() => {
        const [navigation] = performance.getEntriesByType("navigation");
        return (navigation as PerformanceNavigationTiming | undefined)
            ?.nextHopProtocol ?? "";
    }).catch(() => "");
}

function stripPseudoHeaders(
    headers: Record<string, string>
): Record<string, string> {
    return Object.fromEntries(
        Object.entries(headers).filter(([name]) => !name.startsWith(":"))
    );
}
