import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import pLimit from "p-limit";

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
    /** When set, every route except /health requires this bearer token. */
    apiKey?: string;
    /** When non-empty, /render targets are limited to these hostnames. */
    allowedHosts?: string[];
}

export async function createHttpServer(
    dependencies: HttpServerDependencies
): Promise<FastifyInstance> {
    const app = Fastify({
        logger: dependencies.logger ?? true,
        bodyLimit: 32 * 1024
    });
    const schedule = pLimit(dependencies.concurrency);
    const allowedHosts = new Set(dependencies.allowedHosts ?? []);

    if (dependencies.apiKey) {
        const expected = `Bearer ${dependencies.apiKey}`;
        app.addHook("onRequest", async (request, reply) => {
            if (request.url === "/health") {
                return;
            }
            if (request.headers.authorization !== expected) {
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

    app.post<{ Body: RenderCommand }>(
        "/render",
        { schema: { body: renderRequestSchema } },
        async (request, reply) => {
            if (
                allowedHosts.size > 0
                && !allowedHosts.has(hostnameOf(request.body.url))
            ) {
                return reply.code(403).send({
                    error: "render target host is not allowed"
                });
            }
            try {
                return await schedule(
                    () => dependencies.renderPage.execute(request.body)
                );
            } catch (error) {
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
