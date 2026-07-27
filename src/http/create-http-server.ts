import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import pLimit from "p-limit";

import {
    NO_OP_METRICS,
    type RenderOutcome,
    type ServerMetrics
} from "../application/metrics.js";
import type {
    RenderPageUseCase
} from "../application/render-page.js";
import type {
    RunBotCheckUseCase
} from "../application/run-bot-check.js";
import {
    BOT_CHECK_IDS,
    isBotCheckId
} from "../domain/bot-checks.js";
import { InvalidProxyError } from "../domain/proxy.js";
import {
    InvalidRenderTargetError,
    MAX_RENDER_TIMEOUT_MS,
    MIN_RENDER_TIMEOUT_MS,
    type RenderCommand
} from "../domain/rendering.js";
import { APP_VERSION } from "../version.js";

export interface HttpServerDependencies {
    renderPage: RenderPageUseCase;
    runBotCheck: RunBotCheckUseCase;
    concurrency: number;
    webRoot?: string;
    logger?: boolean;
    /**
     * When set, every route except the ones in OPEN_ROUTES requires this
     * bearer token.
     */
    apiKey?: string;
    /** When non-empty, /render targets are limited to these hostnames. */
    allowedHosts?: string[];
    /** Sink for the counters /metrics publishes; no-ops when omitted. */
    metrics?: ServerMetrics;
}

/**
 * Routes a caller reaches without the key. Both carry aggregate state only --
 * no target URLs, no proxy servers, no credentials -- and both are polled by
 * infrastructure (the container healthcheck, Prometheus) that has no business
 * holding the operator's token.
 */
const OPEN_ROUTES = new Set(["/health", "/metrics"]);

export async function createHttpServer(
    dependencies: HttpServerDependencies
): Promise<FastifyInstance> {
    const app = Fastify({
        logger: dependencies.logger ?? true,
        bodyLimit: 32 * 1024
    });
    const schedule = pLimit(dependencies.concurrency);
    const allowedHosts = new Set(dependencies.allowedHosts ?? []);
    const metrics = dependencies.metrics ?? NO_OP_METRICS;

    metrics.trackRenderQueue(schedule);

    if (dependencies.apiKey) {
        const expected = `Bearer ${dependencies.apiKey}`;
        app.addHook("onRequest", async (request, reply) => {
            if (OPEN_ROUTES.has(pathOf(request.url))) {
                return;
            }
            if (request.headers.authorization !== expected) {
                metrics.renderRejected("unauthorized");
                return reply.code(401).send({ error: "unauthorized" });
            }
        });
    }

    app.get("/health", async () => ({
        status: "ok",
        version: APP_VERSION,
        active: schedule.activeCount,
        pending: schedule.pendingCount
    }));

    // Registered explicitly rather than left to chance: the SPA fallback below
    // answers any unmatched GET with index.html and a 200, so a missing route
    // here would hand a scraper a page of HTML it would happily fail to parse
    // forever.
    app.get("/metrics", async (_request, reply) => {
        reply.header("content-type", metrics.contentType);
        return metrics.scrape();
    });

    app.post<{ Body: RenderCommand }>(
        "/render",
        { schema: { body: renderRequestSchema } },
        async (request, reply) => {
            if (
                allowedHosts.size > 0
                && !allowedHosts.has(hostnameOf(request.body.url))
            ) {
                metrics.renderRejected("host_not_allowed");
                return reply.code(403).send({
                    error: "render target host is not allowed"
                });
            }

            const startedAt = process.hrtime.bigint();
            try {
                const result = await schedule(
                    () => dependencies.renderPage.execute(request.body)
                );

                metrics.renderCompleted(
                    result.blocking.outcome,
                    secondsSince(startedAt)
                );
                return result;
            } catch (error) {
                metrics.renderCompleted(
                    outcomeOf(error),
                    secondsSince(startedAt)
                );
                if (
                    error instanceof InvalidRenderTargetError
                    || error instanceof InvalidProxyError
                ) {
                    return reply.code(400).send({ error: error.message });
                }
                throw error;
            }
        }
    );

    app.post<{ Params: { id: string } }>(
        "/bot-check/:id",
        { schema: { params: botCheckParamsSchema } },
        async (request, reply) => {
            if (!isBotCheckId(request.params.id)) {
                return reply.code(404).send({ error: "unknown bot check" });
            }

            const id = request.params.id;
            return schedule(
                () => dependencies.runBotCheck.execute(id)
            );
        }
    );

    if (dependencies.webRoot && existsSync(dependencies.webRoot)) {
        await app.register(fastifyStatic, {
            root: dependencies.webRoot,
            wildcard: false
        });

        app.setNotFoundHandler((request, reply) => {
            if (request.method === "GET") {
                return reply.sendFile("index.html");
            }

            return reply.code(404).send({ error: "not found" });
        });
    }

    return app;
}

const renderRequestSchema = {
    type: "object",
    additionalProperties: false,
    required: ["url"],
    properties: {
        url: {
            type: "string",
            minLength: 8,
            maxLength: 4096
        },
        timeoutMs: {
            type: "integer",
            minimum: MIN_RENDER_TIMEOUT_MS,
            maximum: MAX_RENDER_TIMEOUT_MS
        },
        screenshot: {
            type: "boolean"
        },
        waitForSelector: {
            type: "string",
            minLength: 1,
            maxLength: 256
        },
        proxy: {
            type: "object",
            additionalProperties: false,
            required: ["server"],
            properties: {
                server: { type: "string", minLength: 1, maxLength: 512 },
                username: { type: "string", maxLength: 256 },
                password: { type: "string", maxLength: 256 },
                bypass: { type: "string", maxLength: 512 }
            }
        },
        extraHeaders: {
            type: "object",
            maxProperties: 32,
            propertyNames: { maxLength: 64 },
            additionalProperties: { type: "string", maxLength: 8192 }
        }
    }
} as const;

function hostnameOf(url: string): string {
    try {
        return new URL(url).hostname.toLowerCase();
    } catch {
        return "";
    }
}

/**
 * `request.url` is the raw target and still carries the query string, which a
 * Prometheus scrape_config is free to append; comparing it whole would put
 * /metrics?foo=1 behind the key.
 */
function pathOf(url: string): string {
    const query = url.indexOf("?");
    return query === -1 ? url : url.slice(0, query);
}

function secondsSince(startedAt: bigint): number {
    return Number(process.hrtime.bigint() - startedAt) / 1e9;
}

/**
 * Derived from the error's type, never its message: proxy messages can carry
 * caller input and would turn a label into an unbounded set.
 */
function outcomeOf(error: unknown): RenderOutcome {
    if (error instanceof InvalidRenderTargetError) {
        return "invalid_target";
    }
    if (error instanceof InvalidProxyError) {
        return "invalid_proxy";
    }

    return "error";
}

const botCheckParamsSchema = {
    type: "object",
    additionalProperties: false,
    required: ["id"],
    properties: {
        id: {
            type: "string",
            enum: BOT_CHECK_IDS
        }
    }
} as const;
