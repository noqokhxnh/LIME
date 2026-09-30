import fastify, { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { existsSync, createReadStream, statSync } from "node:fs";
import { join } from "node:path";
import { v4 } from "uuid";
import { getConfig } from "./config.js";
import { videoRequestSchema, type videoRequest, type videoScript } from "./llm/schema.js";
import { generateScript } from "./pipeline/scriptGenerator.js";
import { runFullPipeline, type fullPipelineResult } from "./pipeline/orchestrator.js";
import { initDatabase } from "./database/index.js";
import fastifyCookie from "@fastify/cookie";
import {authRoutes} from "./auth/routes.js";
import { validatePrompt } from "./security/promptGuard.js";
import { rateLimiter } from "./security/rateLimiter.js";
export interface JobRecord {
    jobId: string;
    status: 'queued' | 'running' | 'completed' | 'failed';
    request: videoRequest;
    createdAt: string;
    updatedAt: string;
    progress?: { phase: string; progress: number; message: string };
    result?: fullPipelineResult;
    error?: string;
}

export const jobsStore = new Map<string, JobRecord>();

export async function buildApp(options: { logger?: boolean } = {}): Promise<FastifyInstance> {
    const app = fastify({
        logger: options.logger ?? false,
        bodyLimit: 10 * 1024 * 1024,
    });

    await app.register(fastifyCors, { origin: true , credentials: true });
    await app.register(fastifyCookie);
    await app.register(authRoutes);

    const frontendDir = join(process.cwd(), "frontend");
    if (existsSync(frontendDir)) {
        await app.register(fastifyStatic, {
            root: frontendDir,
            prefix: "/",
            index: false,
        });
    }

    app.addHook("preHandler", async (request, reply) => {
        const url = request.url;
        if (url.startsWith("/api/script/draft") || url.startsWith("/api/pipeline") || url.startsWith("/api/generate") || url.startsWith("/api/source/")) {
            const ip = request.ip || '127.0.0.1';
            if (!rateLimiter.checkRpm(ip)) {
                reply.status(429).send({ error: "Too Many Requests (RPM exceeded)" });
                return reply;
            }

            const body = request.body as any;
            if (body && body.prompt) {
                const check = validatePrompt(body.prompt);
                if (!check.isValid) {
                    reply.status(400).send({ error: check.reason });
                    return reply;
                }
            }
        }
    });

    // Root web UI & health endpoint
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

    // Dedicated UI endpoint
    app.get("/ui", async (_request: FastifyRequest, reply: FastifyReply) => {
        const htmlPath = join(frontendDir, "index.html");
        if (existsSync(htmlPath)) {
            reply.type("text/html; charset=utf-8").send(createReadStream(htmlPath));
            return reply;
        }
        reply.status(404).send("Frontend not found");
    });

    // API health and provider status
    app.get("/api/health", async () => {
        const config = getConfig();
        return {
            status: "ok",
            llmProvider: config.LLM_Provider,
            ttsProvider: config.TTS_Provider,
            timestamp: new Date().toISOString(),
        };
    });

    // Generate script draft only
    app.post("/api/script/draft", async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const body = request.body as any;
            const normalized = {
                ...body,
                prompt: body?.prompt || body?.prompt,
            };
            const reqData = videoRequestSchema.parse(normalized);
            const script = await generateScript(reqData);
            return {
                success: true,
                script,
            };
        } catch (err: any) {
            reply.status(400);
            return {
                success: false,
                error: err.message,
            };
        }
    });

    // Pipeline runner endpoint (supports both sync and async)
    const handlePipelineRequest = async (request: FastifyRequest, reply: FastifyReply) => {
        const body = (request.body as any) || {};
        const isAsync = Boolean(body.async || (request.query as any)?.async === 'true');

        let reqData: videoRequest;
        try {
            const normalized = {
                ...body,
                prompt: body?.prompt || body?.prompt,
            };
            reqData = videoRequestSchema.parse(normalized);
        } catch (err: any) {
            reply.status(400);
            return { error: "Invalid video request", details: err.message };
        }

        const ip = request.ip || '127.0.0.1';
        if (!rateLimiter.checkAndIncrementDailyQuota(ip)) {
            reply.status(429);
            return { error: "Daily quota exceeded" };
        }
        if (!rateLimiter.acquireConcurrentJob(ip)) {
            reply.status(429);
            return { error: "Concurrency limit exceeded" };
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
        jobsStore.set(jobId, job);

        const outputDir = join(process.cwd(), "tmp", `job-${jobId}`);

        if (isAsync) {
            // Run asynchronously in background
            (async () => {
                job.status = 'running';
                job.updatedAt = new Date().toISOString();
                try {
                    const result = await runFullPipeline({
                        request: reqData,
                        script: inputScript,
                        bgmPath,
                        skipPreview,
                        outputDir,
                        onProgress: (p) => {
                            job.progress = p;
                            job.updatedAt = new Date().toISOString();
                        },
                    });
                    job.status = 'completed';
                    job.result = result;
                    job.updatedAt = new Date().toISOString();
                } catch (err: any) {
                    job.status = 'failed';
                    job.error = err.message;
                    job.updatedAt = new Date().toISOString();
                } finally {
                    rateLimiter.releaseConcurrentJob(ip);
                }
            })();

            reply.status(202);
            return {
                message: "Video generation queued",
                jobId,
                checkStatusUrl: `/api/jobs/${jobId}`,
                htmlUrl: `/api/jobs/${jobId}/html`,
                audioUrl: `/api/jobs/${jobId}/audio`,
            };
        } else {
            // Run synchronously
            job.status = 'running';
            job.updatedAt = new Date().toISOString();
            try {
                const result = await runFullPipeline({
                    request: reqData,
                    script: inputScript,
                    bgmPath,
                    skipPreview,
                    outputDir,
                    onProgress: (p) => {
                        job.progress = p;
                        job.updatedAt = new Date().toISOString();
                    },
                });
                job.status = 'completed';
                job.result = result;
                job.updatedAt = new Date().toISOString();
                return {
                    success: true,
                    jobId: result.jobId,
                    status: 'completed',
                    durationSec: result.durationSec,
                    resolution: result.resolution,
                    scenes: result.scences,
                    finalHtmlPath: result.finalHtmlPath,
                    videoPath: result.videoPath,
                    audio: result.audio,
                    preview: result.preview,
                    timing: result.timing,
                    htmlUrl: `/api/jobs/${result.jobId}/html`,
                    audioUrl: `/api/jobs/${result.jobId}/audio`,
                };
            } catch (err: any) {
                job.status = 'failed';
                job.error = err.message;
                job.updatedAt = new Date().toISOString();
                reply.status(500);
                return {
                    success: false,
                    jobId,
                    error: err.message,
                };
            } finally {
                rateLimiter.releaseConcurrentJob(ip);
            }
        }
    };

    app.post("/api/generate", handlePipelineRequest);
    app.post("/api/pipeline", handlePipelineRequest);

    // List jobs
    app.get("/api/jobs", async () => {
        return Array.from(jobsStore.values()).map((j) => ({
            jobId: j.jobId,
            status: j.status,
            createdAt: j.createdAt,
            updatedAt: j.updatedAt,
            topic: j.request.prompt,
            durationSec: j.result?.durationSec,
            error: j.error,
        }));
    });

    // Get job status/details
    app.get("/api/jobs/:jobId", async (request: FastifyRequest<{ Params: { jobId: string } }>, reply: FastifyReply) => {
        const { jobId } = request.params;
        const job = jobsStore.get(jobId);
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

    // Serve generated HTML bundle
    app.get("/api/jobs/:jobId/html", async (request: FastifyRequest<{ Params: { jobId: string } }>, reply: FastifyReply) => {
        const { jobId } = request.params;
        const job = jobsStore.get(jobId);
        const htmlPath = job?.result?.finalHtmlPath ?? join(process.cwd(), "tmp", `job-${jobId}`, "index.html");
        if (!existsSync(htmlPath)) {
            reply.status(404);
            return { error: "HTML bundle not found for job" };
        }
        reply.type("text/html; charset=utf-8").send(createReadStream(htmlPath));
    });

    // Serve generated mixed audio
    app.get("/api/jobs/:jobId/audio", async (request: FastifyRequest<{ Params: { jobId: string } }>, reply: FastifyReply) => {
        const { jobId } = request.params;
        const job = jobsStore.get(jobId);
        const audioPath = job?.result?.audio?.mixAudioPath ?? join(process.cwd(), "tmp", `job-${jobId}`, "mixed_audio.mp3");
        if (!existsSync(audioPath)) {
            reply.status(404);
            return { error: "Audio file not found for job" };
        }
        reply.type("audio/mpeg").send(createReadStream(audioPath));
    });

    // Serve preview scene screenshot
    app.get("/api/jobs/:jobId/preview/:sceneId", async (request: FastifyRequest<{ Params: { jobId: string; sceneId: string } }>, reply: FastifyReply) => {
        const { jobId, sceneId } = request.params;
        const job = jobsStore.get(jobId);
        const workDir = job?.result?.workDir ?? join(process.cwd(), "tmp", `job-${jobId}`);
        const previewPath = join(workDir, "previews", `${sceneId}.webp`);
        if (!existsSync(previewPath)) {
            reply.status(404);
            return { error: "Preview thumbnail not found" };
        }
        reply.type("image/webp").send(createReadStream(previewPath));
    });

    // Stream MP4 video with HTTP Range support
    app.get("/api/jobs/:jobId/video", async (request: FastifyRequest<{ Params: { jobId: string } }>, reply: FastifyReply) => {
        const { jobId } = request.params;
        const job = jobsStore.get(jobId);
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

    // Download MP4 video
    app.get("/api/jobs/:jobId/download", async (request: FastifyRequest<{ Params: { jobId: string } }>, reply: FastifyReply) => {
        const { jobId } = request.params;
        const job = jobsStore.get(jobId);
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
    await initDatabase(); // Initialize the database before starting the server
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