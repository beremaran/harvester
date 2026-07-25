export const BOT_CHECK_IDS = [
    "rebrowser",
    "sannysoft",
    "deviceinfo",
    "browserleaks"
] as const;

export type BotCheckId = (typeof BOT_CHECK_IDS)[number];
export type BotCheckStatus = "pass" | "fail" | "warn" | "info";

export interface BotCheckEvaluation {
    name: string;
    status: BotCheckStatus;
    value?: string;
    note?: string;
}

export interface BotCheckResult {
    id: BotCheckId;
    url: string;
    title: string;
    screenshot: string;
    evaluations: BotCheckEvaluation[];
    durationMs: number;
    checkedAt: string;
}

export function isBotCheckId(value: string): value is BotCheckId {
    return BOT_CHECK_IDS.some((id) => id === value);
}
