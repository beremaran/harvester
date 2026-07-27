import type {
    BotCheckId,
    BotCheckResult
} from "../domain/bot-checks.js";
import { NO_OP_METRICS, type BotCheckMetrics } from "./metrics.js";

export interface BotCheckRunner {
    run(id: BotCheckId): Promise<BotCheckResult>;
}

export interface RunBotCheckUseCase {
    execute(id: BotCheckId): Promise<BotCheckResult>;
}

export class RunBotCheck implements RunBotCheckUseCase {
    constructor(
        private readonly runner: BotCheckRunner,
        private readonly metrics: BotCheckMetrics = NO_OP_METRICS
    ) {}

    async execute(id: BotCheckId): Promise<BotCheckResult> {
        const result = await this.runner.run(id);

        // Recorded here rather than in the Playwright runner because the
        // verdicts are a property of the check, not of how it was driven, and
        // because the result already carries the runner's own timing.
        for (const evaluation of result.evaluations) {
            this.metrics.botCheckVerdict(result.id, evaluation.status);
        }
        this.metrics.botCheckDuration(result.id, result.durationMs / 1_000);

        return result;
    }
}
