export const BOT_CHECKS = [
  {
    id: "rebrowser",
    label: "Rebrowser bot detector",
    shortLabel: "Rebrowser",
    url: "https://bot-detector.rebrowser.net/",
    description:
      "Runs the full Playwright probe set, including exposed functions and page evaluations.",
  },
  {
    id: "sannysoft",
    label: "Sannysoft anti-bot",
    shortLabel: "Sannysoft",
    url: "https://bot.sannysoft.com/",
    description:
      "Checks WebDriver, Chrome APIs, plug-ins, languages, WebGL, and common fingerprints.",
  },
  {
    id: "deviceinfo",
    label: "Device & Browser Info",
    shortLabel: "Device Info",
    url: "https://deviceandbrowserinfo.com/are_you_a_bot",
    description:
      "Checks user agent, WebDriver, Playwright, frames, CDP, client hints, GPU, and worker signals.",
  },
  {
    id: "browserleaks",
    label: "BrowserLeaks JavaScript",
    shortLabel: "BrowserLeaks",
    url: "https://browserleaks.com/javascript",
    description:
      "Shows the JavaScript, screen, user-agent, platform, and WebDriver values sites can read.",
  },
] as const;

export type BotCheckId = (typeof BOT_CHECKS)[number]["id"];
export type BotCheckDefinition = (typeof BOT_CHECKS)[number];
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
  return BOT_CHECKS.some((check) => check.id === value);
}
