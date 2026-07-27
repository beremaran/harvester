import {
    collectDefaultMetrics,
    Counter,
    Gauge,
    Histogram,
    Registry
} from "prom-client";

import type {
    AppMetrics,
    BrowserLaunchOutcome,
    RenderOutcome,
    RenderQueue,
    RenderRejection
} from "../../application/metrics.js";
import {
    BOT_CHECK_IDS,
    BOT_CHECK_STATUSES
} from "../../domain/bot-checks.js";
import { APP_VERSION } from "../../version.js";

/**
 * Render wall-clock seconds. A render request clamps to 1s..60s, so the
 * buckets straddle that range; prom-client's defaults stop at 10s and would
 * drop most of the interesting tail into `+Inf`.
 */
const RENDER_BUCKETS = [0.5, 1, 2, 5, 10, 15, 30, 60];

/**
 * Bot checks navigate with a 30s budget and then deliberately sit still for
 * up to 2.5s waiting for the detector's own scripts to settle, so a fast one
 * is still seconds long.
 */
const BOT_CHECK_BUCKETS = [1, 2.5, 5, 10, 20, 30, 60];

const RENDER_OUTCOMES: RenderOutcome[] = [
    "served",
    "challenged",
    "blocked",
    "invalid_target",
    "invalid_proxy",
    "error"
];
const RENDER_REJECTIONS: RenderRejection[] = [
    "host_not_allowed",
    "unauthorized"
];
const BROWSER_LAUNCH_OUTCOMES: BrowserLaunchOutcome[] = [
    "success",
    "failure"
];

/**
 * Builds this process's one metrics registry.
 *
 * Called from `src/server.ts` and nowhere else. A metric name may only be
 * registered once per registry and `collectDefaultMetrics` installs a fixed
 * set of them, so a registry built at module scope -- or inside
 * `createHttpServer` -- would throw the moment a second server is created,
 * which the HTTP tests do three times in one process.
 */
export function createMetricsRegistry(): AppMetrics {
    const registry = new Registry();
    collectDefaultMetrics({ register: registry });

    new Gauge({
        name: "harvester_build_info",
        help: "Always 1; the label carries the running build.",
        labelNames: ["version"],
        registers: [registry]
    }).set({ version: APP_VERSION }, 1);

    const renders = new Counter({
        name: "harvester_renders_total",
        help: "Render requests by how they ended.",
        labelNames: ["outcome"],
        registers: [registry]
    });
    const renderDurations = new Histogram({
        name: "harvester_render_duration_seconds",
        help: "Time a render request spent here, queue wait included.",
        labelNames: ["outcome"],
        buckets: RENDER_BUCKETS,
        registers: [registry]
    });
    const blocking = new Counter({
        name: "harvester_render_blocking_total",
        help: "Renders by bot-defence outcome and the vendor behind it.",
        labelNames: ["outcome", "vendor"],
        registers: [registry]
    });
    const rejections = new Counter({
        name: "harvester_renders_rejected_total",
        help: "Requests refused before any browser work started.",
        labelNames: ["reason"],
        registers: [registry]
    });
    const launches = new Counter({
        name: "harvester_browser_launches_total",
        help: "Chrome launches by result.",
        labelNames: ["outcome"],
        registers: [registry]
    });
    const browserUp = new Gauge({
        name: "harvester_browser_up",
        help: "1 while a launched Chrome is still connected.",
        registers: [registry]
    });
    const botChecks = new Counter({
        name: "harvester_bot_checks_total",
        help: "Bot-check evaluations by check and verdict.",
        labelNames: ["check", "status"],
        registers: [registry]
    });
    const botCheckDurations = new Histogram({
        name: "harvester_bot_check_duration_seconds",
        help: "Time a completed bot check took.",
        labelNames: ["check"],
        buckets: BOT_CHECK_BUCKETS,
        registers: [registry]
    });
    const tlsProbes = new Counter({
        name: "harvester_tls_fingerprint_probe_total",
        help: "TLS fingerprint probe attempts by outcome.",
        labelNames: ["outcome"],
        registers: [registry]
    });

    // The limiter is created inside createHttpServer, so it arrives later and
    // may never arrive at all; the gauges read whatever is there at scrape
    // time and report an idle queue until then.
    let queue: RenderQueue | undefined;

    new Gauge({
        name: "harvester_render_queue_active",
        help: "Renders executing right now.",
        registers: [registry],
        collect() {
            this.set(queue?.activeCount ?? 0);
        }
    });
    new Gauge({
        name: "harvester_render_queue_pending",
        help: "Renders waiting for a concurrency slot.",
        registers: [registry],
        collect() {
            this.set(queue?.pendingCount ?? 0);
        }
    });
    new Gauge({
        name: "harvester_render_concurrency_limit",
        help: "Renders allowed to run at once.",
        registers: [registry],
        collect() {
            this.set(queue?.concurrency ?? 0);
        }
    });

    // A series that first appears when something breaks is missing from the
    // dashboard until the first incident, which is exactly when nobody wants
    // to find out a panel was never wired up. Every bounded label set is
    // published at zero from boot; only the vendor label is left out, because
    // its values come from what the defences reveal, not from us.
    for (const outcome of RENDER_OUTCOMES) {
        renders.inc({ outcome }, 0);
    }
    for (const reason of RENDER_REJECTIONS) {
        rejections.inc({ reason }, 0);
    }
    for (const outcome of BROWSER_LAUNCH_OUTCOMES) {
        launches.inc({ outcome }, 0);
    }
    for (const check of BOT_CHECK_IDS) {
        for (const status of BOT_CHECK_STATUSES) {
            botChecks.inc({ check, status }, 0);
        }
    }
    tlsProbes.inc({ outcome: "failed" }, 0);

    return {
        contentType: registry.contentType,
        scrape: () => registry.metrics(),
        trackRenderQueue: (tracked) => {
            queue = tracked;
        },
        renderCompleted: (outcome, seconds) => {
            renders.inc({ outcome });
            renderDurations.observe({ outcome }, seconds);
        },
        renderRejected: (reason) => {
            rejections.inc({ reason });
        },
        renderClassified: (outcome, vendor) => {
            blocking.inc({ outcome, vendor });
        },
        browserLaunched: (outcome) => {
            launches.inc({ outcome });
        },
        browserUp: (up) => {
            browserUp.set(up ? 1 : 0);
        },
        botCheckVerdict: (check, status) => {
            botChecks.inc({ check, status });
        },
        botCheckDuration: (check, seconds) => {
            botCheckDurations.observe({ check }, seconds);
        },
        tlsProbeCompleted: (outcome) => {
            tlsProbes.inc({ outcome });
        }
    };
}
