import type { BlockOutcome } from "../domain/blocking.js";
import type {
    BotCheckId,
    BotCheckStatus
} from "../domain/bot-checks.js";

/**
 * What the service is willing to say about itself, said without knowing how
 * it will be published. Every layer that has something worth counting takes
 * the slice of this port it needs as a trailing constructor argument with a
 * no-op default -- the same shape the injected clock and the error callback
 * already use -- so a unit test never has to know metrics exist. Only
 * `src/infrastructure/metrics` and `src/server.ts` know which exporter is on
 * the other end.
 */

/**
 * How a `/render` call ended. The first three come straight from the blocking
 * assessment and are the posture reading this service exists to produce; the
 * rest are our own refusals, kept in the same counter so "they stopped us"
 * and "we could not even ask" sit side by side in one query.
 */
export type RenderOutcome =
    | BlockOutcome
    | "invalid_target"
    | "invalid_proxy"
    | "error";

/** A request turned away before any browser work started. */
export type RenderRejection = "host_not_allowed" | "unauthorized";

export type BrowserLaunchOutcome = "success" | "failure";

/**
 * Only failure is observable from outside the probe. A measurement is
 * memoised for the life of the process and re-served to every render, so
 * counting successes on the render path would measure render volume rather
 * than probe health.
 */
export type TlsProbeOutcome = "failed";

/**
 * The part of the render limiter worth publishing. It is read when Prometheus
 * scrapes rather than tracked on every request, so the hot path stays free of
 * counter arithmetic and the numbers can never drift from the limiter's own.
 */
export interface RenderQueue {
    readonly activeCount: number;
    readonly pendingCount: number;
    readonly concurrency: number;
}

export interface RenderMetrics {
    /**
     * The bot-defence verdict for one render. The renderer works this out
     * anyway to answer the caller; recording it is what turns a per-call
     * answer into the trend that says which defence tightened, and when.
     */
    renderClassified(outcome: BlockOutcome, vendor: string): void;
}

export interface BrowserMetrics {
    browserLaunched(outcome: BrowserLaunchOutcome): void;
    browserUp(up: boolean): void;
}

export interface BotCheckMetrics {
    botCheckVerdict(check: BotCheckId, status: BotCheckStatus): void;
    botCheckDuration(check: BotCheckId, seconds: number): void;
}

export interface TlsMetrics {
    tlsProbeCompleted(outcome: TlsProbeOutcome): void;
}

export interface ServerMetrics {
    renderCompleted(outcome: RenderOutcome, seconds: number): void;
    renderRejected(reason: RenderRejection): void;
    /** Hands over the live limiter for the queue gauges to read. */
    trackRenderQueue(queue: RenderQueue): void;
    readonly contentType: string;
    scrape(): Promise<string>;
}

export interface AppMetrics extends
    RenderMetrics,
    BrowserMetrics,
    BotCheckMetrics,
    TlsMetrics,
    ServerMetrics {}

/**
 * The default every collaborator falls back to. An empty exposition is still
 * valid Prometheus text, so a server built without a registry answers
 * `/metrics` honestly instead of falling through to the SPA's index.html.
 */
export const NO_OP_METRICS: AppMetrics = {
    renderClassified: () => undefined,
    browserLaunched: () => undefined,
    browserUp: () => undefined,
    botCheckVerdict: () => undefined,
    botCheckDuration: () => undefined,
    tlsProbeCompleted: () => undefined,
    renderCompleted: () => undefined,
    renderRejected: () => undefined,
    trackRenderQueue: () => undefined,
    contentType: "text/plain; version=0.0.4; charset=utf-8",
    scrape: async () => ""
};
