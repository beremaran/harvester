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
import {
    InvalidRenderTargetError,
    MAX_RENDER_TIMEOUT_MS,
    MIN_RENDER_TIMEOUT_MS,
    type RenderCommand
} from "../domain/rendering.js";

export interface HttpServerDependencies {
    renderPage: RenderPageUseCase;
    runBotCheck: RunBotCheckUseCase;
    concurrency: number;
    webRoot?: string;
    logger?: boolean;
}

export async function createHttpServer(
    dependencies: HttpServerDependencies
): Promise<FastifyInstance> {
    const app = Fastify({
        logger: dependencies.logger ?? true,
        bodyLimit: 32 * 1024
    });
    const schedule = pLimit(dependencies.concurrency);

    app.get("/health", async () => ({
        status: "ok",
        active: schedule.activeCount,
        pending: schedule.pendingCount
    }));

    app.post<{ Body: RenderCommand }>(
        "/render",
        { schema: { body: renderRequestSchema } },
        async (request, reply) => {
            try {
                return await schedule(
                    () => dependencies.renderPage.execute(request.body)
                );
            } catch (error) {
                if (error instanceof InvalidRenderTargetError) {
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
        }
    }
} as const;

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
