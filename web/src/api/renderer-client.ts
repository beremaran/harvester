import type {
  BotCheckId,
  BotCheckResult,
} from "@/domain/bot-checks";
import type {
  RenderOptions,
  RenderResult,
} from "@/domain/rendering";

export async function checkRendererHealth(): Promise<boolean> {
  try {
    const response = await fetch("/health");
    return response.ok;
  } catch {
    return false;
  }
}

export async function requestRender(
  options: RenderOptions,
): Promise<RenderResult> {
  return requestJson<RenderResult>(
    "/render",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(options),
    },
    "The render failed.",
  );
}

export async function requestBotCheck(
  id: BotCheckId,
): Promise<BotCheckResult> {
  return requestJson<BotCheckResult>(
    `/bot-check/${id}`,
    { method: "POST" },
    "The bot check failed.",
  );
}

async function requestJson<T extends object>(
  input: RequestInfo | URL,
  init: RequestInit,
  fallbackError: string,
): Promise<T> {
  const response = await fetch(input, init);
  const body = (await response.json()) as T | { error?: string };

  if (!response.ok) {
    const message =
      "error" in body && body.error ? body.error : fallbackError;
    throw new Error(message);
  }

  return body as T;
}
