import type {
    BotCheckId,
    BotCheckResult
} from "../domain/bot-checks.js";

export interface BotCheckRunner {
    run(id: BotCheckId): Promise<BotCheckResult>;
}

export interface RunBotCheckUseCase {
    execute(id: BotCheckId): Promise<BotCheckResult>;
}

export class RunBotCheck implements RunBotCheckUseCase {
    constructor(private readonly runner: BotCheckRunner) {}

    execute(id: BotCheckId): Promise<BotCheckResult> {
        return this.runner.run(id);
    }
}
