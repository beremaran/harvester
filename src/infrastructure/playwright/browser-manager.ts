import { chromium, type Browser } from "playwright";

import {
    NO_OP_METRICS,
    type BrowserMetrics
} from "../../application/metrics.js";
import { STEALTH_IGNORED_ARGS, STEALTH_LAUNCH_ARGS } from "./stealth.js";

export interface BrowserProvider {
    getBrowser(): Promise<Browser>;
}

export interface BrowserOptions {
    channel: string;
    /** Takes precedence over the channel when set. */
    executablePath: string | undefined;
    headless: boolean;
    viewport: { width: number; height: number };
}

const DEFAULT_OPTIONS: BrowserOptions = {
    channel: "chrome",
    executablePath: undefined,
    headless: true,
    viewport: { width: 1440, height: 900 }
};

export class BrowserManager implements BrowserProvider {
    private browserPromise: Promise<Browser> | undefined;
    private readonly options: BrowserOptions;

    constructor(
        options: Partial<BrowserOptions> = {},
        private readonly metrics: BrowserMetrics = NO_OP_METRICS
    ) {
        this.options = { ...DEFAULT_OPTIONS, ...options };
    }

    getBrowser(): Promise<Browser> {
        if (!this.browserPromise) {
            const { channel, executablePath, headless, viewport } =
                this.options;

            this.browserPromise = chromium.launch({
                // Playwright refuses both at once, so a path wins over a
                // channel: the arm64 image has no Google Chrome to name.
                ...(executablePath
                    ? { executablePath }
                    : channel ? { channel } : {}),
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
                this.metrics.browserLaunched("failure");
                this.metrics.browserUp(false);
                throw error;
            }).then((browser) => {
                this.metrics.browserLaunched("success");
                this.metrics.browserUp(true);
                // Chrome dying is otherwise silent: the resolved promise is
                // cached, so every later render is handed a corpse and fails
                // somewhere far from the cause. Dropping the promise makes the
                // next caller relaunch, and the gauge says how often that is
                // happening.
                browser.on("disconnected", () => {
                    this.browserPromise = undefined;
                    this.metrics.browserUp(false);
                });

                return browser;
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
