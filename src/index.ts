import fastify, { FastifyInstance } from "fastify";
import fastifyCors from "@fastify/cors";
import { getConfig } from "./config";

export async function buildApp(options: { logger?: boolean } = {}): Promise<FastifyInstance> {
    const app = fastify({
        logger: options.logger ?? false,
        bodyLimit: 10 * 1024 * 1024,
    });

    await app.register(fastifyCors, { origin: true });

    app.get("/", async () => {
        return { status: "ok", timestamp: new Date().toISOString() };
    });

    return app;
}

export async function startServer(): Promise<FastifyInstance> {
    const config = getConfig();
    const app = await buildApp({ logger: true });
    try {
        await app.listen({ port: config.PORT, host: "0.0.0.0" });
        return app;
    } catch (err) {
        app.log.error(err);
        process.exit(1);
    }
}

const isDirectRun = Boolean(
    process.argv[1] && (
        process.argv[1].endsWith("src/index.ts") ||
        process.argv[1].endsWith("src/index.js") ||
        process.argv[1].endsWith("dist/index.js")
    )
);

if (isDirectRun && process.env.NODE_ENV !== "test") {
    startServer();
}