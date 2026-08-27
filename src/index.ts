import fastify from "fastify";
import fastifyCors from "@fastify/cors";
import { getConfig } from "./config";

const config = getConfig();

const app = fastify({
    logger: true,
    bodyLimit: 10 * 1024 * 1024,
});

async function bootstrap() {
    try {
        await app.register(fastifyCors, { origin: true });

        app.get("/", async () => {
            return { status: "ok", timestamp: new Date().toISOString() };
        });

        await app.listen({ port: config.PORT, host: "0.0.0.0" });
    } catch (err) {
        app.log.error(err);
        process.exit(1);
    }
}

bootstrap();