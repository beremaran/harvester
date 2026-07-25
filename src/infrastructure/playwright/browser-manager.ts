import { chromium, type Browser } from "playwright";

import { STEALTH_IGNORED_ARGS, STEALTH_LAUNCH_ARGS } from "./stealth.js";

export interface BrowserProvider {
    getBrowser(): Promise<Browser>;
}

export interface BrowserOptions {
    channel: string;
    headless: boolean;
    viewport: { width: number; height: number };
}

const DEFAULT_OPTIONS: BrowserOptions = {
    channel: "chrome",
    headless: true,
    viewport: { width: 1440, height: 900 }
};

export class BrowserManager implements BrowserProvider {
    private browserPromise: Promise<Browser> | undefined;
    private readonly options: BrowserOptions;

    constructor(options: Partial<BrowserOptions> = {}) {
        this.options = { ...DEFAULT_OPTIONS, ...options };
    }

    getBrowser(): Promise<Browser> {
        if (!this.browserPromise) {
            const { channel, headless, viewport } = this.options;

            this.browserPromise = chromium.launch({
                ...(channel ? { channel } : {}),
                headless,
                // Suppress the automation banner so `navigator.webdriver` and
                // the headless heuristics that key off it stay quiet.
                ignoreDefaultArgs: STEALTH_IGNORED_ARGS,
                // Chrome sizes the window to the viewport so screenshots and
                // any width-sensitive layout match a real desktop session.
                args: [
                    `--window-size=${viewport.width},${viewport.height}`,
                    ...STEALTH_LAUNCH_ARGS
                ]
            }).catch((error: unknown) => {
                this.browserPromise = undefined;
                throw error;
            });
        }

        return this.browserPromise;
    }

    async close(): Promise<void> {
        if (!this.browserPromise) {
            return;
        }

        const browser = await this.browserPromise.catch(() => undefined);
        this.browserPromise = undefined;
        await browser?.close();
    }
}
