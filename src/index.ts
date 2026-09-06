import fastify, { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { existsSync, createReadStream, statSync } from "node:fs";
import { join } from "node:path";
import { v4 } from "uuid";
import { getConfig } from "./config.js";
import { videoRequestSchema, type videoRequest, type videoScript } from "./llm/schema.js";
import { runFullPipeline } from "./pipeline/orchestrator.js";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { jobsStore, type JobRecord } from "./jobsStore.js";

const config = getConfig();
const connection = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });

const draftQueue = new Queue("script-draft", { connection });
const videoQueue = new Queue("video-generation", { connection });

export async function buildApp(options: { logger?: boolean } = {}): Promise<FastifyInstance> {
    const app = fastify({
        logger: options.logger ?? false,
        bodyLimit: 10 * 1024 * 1024,
    });

    await app.register(fastifyCors, { origin: true });

    const frontendDir = join(process.cwd(), "frontend");
    if (existsSync(frontendDir)) {
        await app.register(fastifyStatic, {
            root: frontendDir,
            prefix: "/",
            index: false,
        });
    }

    app.get("/", async (request: FastifyRequest, reply: FastifyReply) => {
        const accept = request.headers.accept || "";
        if (accept.startsWith("text/html")) {
            const htmlPath = join(frontendDir, "index.html");
            if (existsSync(htmlPath)) {
                reply.type("text/html; charset=utf-8").send(createReadStream(htmlPath));
                return reply;
            }
        }
        return { status: "ok", timestamp: new Date().toISOString() };
    });

    app.get("/ui", async (_request: FastifyRequest, reply: FastifyReply) => {
        const htmlPath = join(frontendDir, "index.html");
        if (existsSync(htmlPath)) {
            reply.type("text/html; charset=utf-8").send(createReadStream(htmlPath));
            return reply;
        }
        reply.status(404).send("Frontend not found");
    });

    app.get("/api/health", async () => {
        const config = getConfig();
        return {
            status: "ok",
            llmProvider: config.LLM_Provider,
            ttsProvider: config.TTS_Provider,
            timestamp: new Date().toISOString(),
        };
    });

    app.post("/api/script/draft", async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const body = request.body as any;
            const normalized = {
                ...body,
                promt: body?.promt || body?.prompt,
            };
            const reqData = videoRequestSchema.parse(normalized);
            const jobId = v4();

            const job: JobRecord = {
                jobId,
                status: 'queued',
                request: reqData,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };
            await jobsStore.set(jobId, job);
            await draftQueue.add("draft", { request: reqData }, { jobId });

            reply.status(202);
            return {
                success: true,
                jobId,
                message: "Draft generation queued",
                checkStatusUrl: `/api/jobs/${jobId}`
            };
        } catch (err: any) {
            reply.status(400);
            return {
                success: false,
                error: err.message,
            };
        }
    });

    const handlePipelineRequest = async (request: FastifyRequest, reply: FastifyReply) => {
        const body = (request.body as any) || {};
        const isAsync = Boolean(body.async || (request.query as any)?.async === 'true');

        let reqData: videoRequest;
        try {
            const normalized = {
                ...body,
                promt: body?.promt || body?.prompt,
            };
            reqData = videoRequestSchema.parse(normalized);
        } catch (err: any) {
            reply.status(400);
            return { error: "Invalid video request", details: err.message };
        }

        const inputScript = body.script as videoScript | undefined;
        const bgmPath = body.bgmPath as string | undefined;
        const skipPreview = Boolean(body.skipPreview);
        const jobId = body.jobId || v4();

        const job: JobRecord = {
            jobId,
            status: 'queued',
            request: reqData,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        await jobsStore.set(jobId, job);

        if (isAsync || true) { // Defaulting to async via BullMQ as per plan
            await videoQueue.add("render", { script: inputScript, bgmPath, skipPreview }, { jobId });

            reply.status(202);
            return {
                message: "Video generation queued",
                jobId,
                checkStatusUrl: `/api/jobs/${jobId}`,
                htmlUrl: `/api/jobs/${jobId}/html`,
                audioUrl: `/api/jobs/${jobId}/audio`,
            };
        }
    };

    app.post("/api/generate", handlePipelineRequest);
    app.post("/api/pipeline", handlePipelineRequest);

    app.get("/api/jobs", async () => {
        const allJobs = await jobsStore.getAll();
        return allJobs.map((j) => ({
            jobId: j.jobId,
            status: j.status,
            createdAt: j.createdAt,
            updatedAt: j.updatedAt,
            topic: j.request.promt,
            durationSec: j.result?.durationSec,
            error: j.error,
        }));
    });

    app.get("/api/jobs/:jobId", async (request: FastifyRequest<{ Params: { jobId: string } }>, reply: FastifyReply) => {
        const { jobId } = request.params;
        const job = await jobsStore.get(jobId);
        if (!job) {
            reply.status(404);
            return { error: "Job not found" };
        }
        return {
            jobId: job.jobId,
            status: job.status,
            createdAt: job.createdAt,
            updatedAt: job.updatedAt,
            progress: job.progress,
            error: job.error,
            script: job.script,
            result: job.result ? {
                durationSec: job.result.durationSec,
                resolution: job.result.resolution,
                scenes: job.result.scences,
                timing: job.result.timing,
                htmlUrl: `/api/jobs/${job.jobId}/html`,
                audioUrl: `/api/jobs/${job.jobId}/audio`,
                preview: job.result.preview,
            } : undefined,
        };
    });

    app.get("/api/jobs/:jobId/html", async (request: FastifyRequest<{ Params: { jobId: string } }>, reply: FastifyReply) => {
        const { jobId } = request.params;
        const job = await jobsStore.get(jobId);
        const htmlPath = job?.result?.finalHtmlPath ?? join(process.cwd(), "tmp", `job-${jobId}`, "index.html");
        if (!existsSync(htmlPath)) {
            reply.status(404);
            return { error: "HTML bundle not found for job" };
        }
        reply.type("text/html; charset=utf-8").send(createReadStream(htmlPath));
    });

    app.get("/api/jobs/:jobId/audio", async (request: FastifyRequest<{ Params: { jobId: string } }>, reply: FastifyReply) => {
        const { jobId } = request.params;
        const job = await jobsStore.get(jobId);
        const audioPath = job?.result?.audio?.mixAudioPath ?? join(process.cwd(), "tmp", `job-${jobId}`, "mixed_audio.mp3");
        if (!existsSync(audioPath)) {
            reply.status(404);
            return { error: "Audio file not found for job" };
        }
        reply.type("audio/mpeg").send(createReadStream(audioPath));
    });

    app.get("/api/jobs/:jobId/preview/:sceneId", async (request: FastifyRequest<{ Params: { jobId: string; sceneId: string } }>, reply: FastifyReply) => {
        const { jobId, sceneId } = request.params;
        const job = await jobsStore.get(jobId);
        const workDir = job?.result?.workDir ?? join(process.cwd(), "tmp", `job-${jobId}`);
        const previewPath = join(workDir, "previews", `${sceneId}.webp`);
        if (!existsSync(previewPath)) {
            reply.status(404);
            return { error: "Preview thumbnail not found" };
        }
        reply.type("image/webp").send(createReadStream(previewPath));
    });

    app.get("/api/jobs/:jobId/video", async (request: FastifyRequest<{ Params: { jobId: string } }>, reply: FastifyReply) => {
        const { jobId } = request.params;
        const job = await jobsStore.get(jobId);
        const videoPath = job?.result?.videoPath ?? join(process.cwd(), "tmp", `job-${jobId}`, "final_video.mp4");
        if (!existsSync(videoPath)) {
            reply.status(404);
            return { error: "Video file not found for job" };
        }

        const stat = statSync(videoPath);
        const fileSize = stat.size;
        const range = request.headers.range;

        if (range) {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunkSize = (end - start) + 1;
            const file = createReadStream(videoPath, { start, end });
            reply.raw.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunkSize,
                'Content-Type': 'video/mp4',
            });
            file.pipe(reply.raw);
            return reply;
        } else {
            reply.raw.writeHead(200, {
                'Content-Length': fileSize,
                'Accept-Ranges': 'bytes',
                'Content-Type': 'video/mp4',
            });
            createReadStream(videoPath).pipe(reply.raw);
            return reply;
        }
    });

    app.get("/api/jobs/:jobId/download", async (request: FastifyRequest<{ Params: { jobId: string } }>, reply: FastifyReply) => {
        const { jobId } = request.params;
        const job = await jobsStore.get(jobId);
        const videoPath = job?.result?.videoPath ?? join(process.cwd(), "tmp", `job-${jobId}`, "final_video.mp4");
        if (!existsSync(videoPath)) {
            reply.status(404);
            return { error: "Video file not found for job" };
        }
        reply.header("Content-Disposition", `attachment; filename="video-${jobId}.mp4"`);
        reply.type("video/mp4").send(createReadStream(videoPath));
    });

    return app;
}

export async function startServer(): Promise<FastifyInstance> {
    const config = getConfig();
    const app = await buildApp({ logger: true });
    try {
        await app.listen({ port: config.PORT, host: "0.0.0.0" });
        console.log(`Backend server listening at http://localhost:${config.PORT}`);
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