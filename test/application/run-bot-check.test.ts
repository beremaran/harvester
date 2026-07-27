import assert from "node:assert/strict";
import { it } from "node:test";

import type { BotCheckMetrics } from "../../src/application/metrics.js";
import {
    RunBotCheck,
    type BotCheckRunner
} from "../../src/application/run-bot-check.js";
import type {
    BotCheckId,
    BotCheckStatus
} from "../../src/domain/bot-checks.js";

it("RunBotCheck records every verdict and the run's own timing", async () => {
    const verdicts: [BotCheckId, BotCheckStatus][] = [];
    let seconds: number | undefined;
    const metrics: BotCheckMetrics = {
        botCheckVerdict: (check, status) => {
            verdicts.push([check, status]);
        },
        botCheckDuration: (_check, value) => {
            seconds = value;
        }
    };
    const runner: BotCheckRunner = {
        run: (id) => Promise.resolve({
            id,
            url: "https://bot-detector.rebrowser.net/",
            title: "Bot detector",
            screenshot: "",
            evaluations: [
                { name: "dummyFn", status: "pass" },
                { name: "sourceUrl", status: "pass" },
                { name: "mainWorldExecution", status: "fail" }
            ],
            durationMs: 4_500,
            checkedAt: "2026-07-26T00:00:00.000Z"
        })
    };

    const result = await new RunBotCheck(runner, metrics).execute("rebrowser");

    assert.equal(result.durationMs, 4_500);
    assert.deepEqual(verdicts, [
        ["rebrowser", "pass"],
        ["rebrowser", "pass"],
        ["rebrowser", "fail"]
    ]);
    assert.equal(seconds, 4.5);
});
