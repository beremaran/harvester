import type { Page } from "playwright";

import type { BotCheckRunner } from "../../application/run-bot-check.js";
import type {
    BotCheckEvaluation,
    BotCheckId,
    BotCheckResult,
    BotCheckStatus
} from "../../domain/bot-checks.js";
import type { BrowserProvider } from "./browser-manager.js";
import { STEALTH_INIT_SCRIPT } from "./stealth.js";

interface BotCheckDefinition {
    url: string;
    settleMs: number;
    prepare?: (page: Page) => Promise<void>;
    probe?: (page: Page) => Promise<void>;
    collect: (page: Page) => Promise<BotCheckEvaluation[]>;
}

interface RebrowserDetection {
    type?: string;
    rating?: number;
    note?: string;
    debug?: unknown;
}

const checks: Record<BotCheckId, BotCheckDefinition> = {
    rebrowser: {
        url: "https://bot-detector.rebrowser.net/",
        settleMs: 1_000,
        probe: async (page) => {
            // Exercise the Runtime.enable leak test: touching the page-defined
            // dummyFn is what the detector watches for. The rebrowser-patches
            // runtime fix is what keeps this from being detected.
            await page.evaluate(() => {
                const candidate = (window as typeof window & {
                    dummyFn?: () => void;
                }).dummyFn;
                candidate?.();
            });

            // Trigger the sourceUrl leak test by calling getElementById in the
            // main world. It inspects the resulting Error stack for Playwright's
            // evaluate wrapper; scripts/patch-rebrowser.mjs renames that wrapper
            // off "UtilityScript", so the stack is clean and the test passes.
            await page.evaluate(() =>
                document.getElementById("detections-json")
            );

            // mainWorldExecution and exposeFunctionLeak are deliberately left
            // untriggered. Both are only detectable if we perform the leaking
            // action (a main-world getElementsByClassName call, or
            // page.exposeFunction); Playwright cannot trigger either without
            // being detected, and the render path does neither. Untriggered they
            // report a neutral "not detected" notice.
        },
        collect: async (page) => {
            const raw = await page.locator("#detections-json").inputValue();
            const detections = JSON.parse(raw) as RebrowserDetection[];

            return detections.map((detection) => ({
                name: detection.type ?? "Unknown test",
                status: ratingToStatus(detection.rating),
                ...(detection.debug === undefined
                    ? {}
                    : { value: compactValue(detection.debug) }),
                ...(detection.note
                    ? { note: stripMarkup(detection.note) }
                    : {})
            }));
        }
    },
    sannysoft: {
        url: "https://bot.sannysoft.com/",
        settleMs: 2_500,
        collect: async (page) =>
            page.locator("table tr").evaluateAll((rows) =>
                rows.flatMap((row) => {
                    const cells = Array.from(row.querySelectorAll("td"));
                    const nameCell = cells[0];
                    const result = cells[1];
                    if (!nameCell || !result) {
                        return [];
                    }

                    const status = result.classList.contains("failed")
                        ? "fail"
                        : result.classList.contains("warn")
                          ? "warn"
                          : result.classList.contains("passed")
                            ? "pass"
                            : "info";

                    return [{
                        name: nameCell.textContent?.replace(/\s+/g, " ").trim()
                            ?? "Unknown test",
                        status,
                        value: result.textContent?.replace(/\s+/g, " ").trim()
                            ?? ""
                    }];
                })
            ) as Promise<BotCheckEvaluation[]>
    },
    deviceinfo: {
        url: "https://deviceandbrowserinfo.com/are_you_a_bot",
        settleMs: 500,
        probe: async (page) => {
            await page.waitForFunction(
                () => document.querySelector("#jsonResult")
                    ?.textContent?.trim(),
                undefined,
                { timeout: 15_000 }
            );
        },
        collect: async (page) => {
            const raw = await page.locator("#jsonResult").innerText();
            const result = JSON.parse(raw) as {
                isBot?: boolean;
                details?: Record<string, boolean>;
            };
            const evaluations: BotCheckEvaluation[] = [
                {
                    name: "Overall result",
                    status: result.isBot ? "fail" : "pass",
                    value: result.isBot ? "Bot detected" : "No bot detected"
                }
            ];

            for (const [name, detected] of Object.entries(
                result.details ?? {}
            )) {
                evaluations.push({
                    name,
                    status: detected ? "fail" : "pass",
                    value: String(detected)
                });
            }

            return evaluations;
        }
    },
    browserleaks: {
        url: "https://browserleaks.com/javascript",
        settleMs: 2_500,
        collect: async (page) => {
            const facts = await page.locator("body").evaluate(() => {
                const text = (selector: string) =>
                    document.querySelector(selector)?.textContent
                        ?.replace(/\s+/g, " ")
                        .trim() ?? "";

                return {
                    userAgent: text("#js-userAgent"),
                    platform: text("#js-platform"),
                    webdriver: text("#js-webdriver"),
                    screen: [text("#js-width"), text("#js-height")]
                        .filter(Boolean)
                        .join(" × ")
                };
            });

            return Object.entries({
                "User agent": facts.userAgent,
                Platform: facts.platform,
                WebDriver: facts.webdriver,
                Screen: facts.screen
            }).map(([name, value]) => ({
                name,
                status:
                    name === "WebDriver" && /true|enabled/i.test(value)
                        ? "fail" as const
                        : value
                          ? "info" as const
                          : "warn" as const,
                value: value || "Not reported"
            }));
        }
    }
};

export interface BotCheckRunnerOptions {
    viewport: { width: number; height: number };
}

const DEFAULT_RUNNER_OPTIONS: BotCheckRunnerOptions = {
    viewport: { width: 1440, height: 900 }
};

export class PlaywrightBotCheckRunner implements BotCheckRunner {
    private readonly options: BotCheckRunnerOptions;

    constructor(
        private readonly browsers: BrowserProvider,
        options: Partial<BotCheckRunnerOptions> = {},
        private readonly now: () => Date = () => new Date()
    ) {
        this.options = { ...DEFAULT_RUNNER_OPTIONS, ...options };
    }

    async run(id: BotCheckId): Promise<BotCheckResult> {
        const startedAt = this.now();
        const definition = checks[id];
        const browser = await this.browsers.getBrowser();
        // Match the context viewport to the launched window so window.inner*
        // and window.outer* stay consistent (the rebrowser viewport test flags
        // the mismatch a default 1280x720 context would otherwise leave).
        const context = await browser.newContext({
            viewport: this.options.viewport
        });
        await context.addInitScript(STEALTH_INIT_SCRIPT);

        try {
            const page = await context.newPage();
            await definition.prepare?.(page);
            await page.goto(definition.url, {
                waitUntil: "domcontentloaded",
                timeout: 30_000
            });
            await definition.probe?.(page);
            await page.waitForTimeout(definition.settleMs);

            const evaluations = await definition.collect(page);
            const screenshot = await page.screenshot({ fullPage: true });
            const completedAt = this.now();

            return {
                id,
                url: page.url(),
                title: await page.title(),
                screenshot: screenshot.toString("base64"),
                evaluations,
                durationMs: completedAt.getTime() - startedAt.getTime(),
                checkedAt: completedAt.toISOString()
            };
        } finally {
            await context.close();
        }
    }
}

/**
 * Maps a rebrowser detection rating onto our status vocabulary, mirroring the
 * detector's own icons: `< 0` is a clean green pass, `1` is a red detection,
 * `0.5` is a genuine amber warning, and `0` is a white "not triggered" notice —
 * informational, not a problem. Treating `0` as a warning (as a naive
 * pass/fail split does) misreports safe, dormant leak tests as issues.
 */
function ratingToStatus(rating: number | undefined): BotCheckStatus {
    if (rating === undefined) return "info";
    if (rating < 0) return "pass";
    if (rating >= 1) return "fail";
    if (rating === 0) return "info";
    return "warn";
}

function compactValue(value: unknown): string {
    if (typeof value === "string") {
        return value;
    }

    const output = JSON.stringify(value);
    return output.length > 500 ? `${output.slice(0, 497)}...` : output;
}

function stripMarkup(value: string): string {
    return value
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
