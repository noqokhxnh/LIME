import fastify, { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import fastifyMultipart from "@fastify/multipart";
import { existsSync, createReadStream, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { v4 } from "uuid";
import { getConfig } from "./config.js";
import { videoRequestSchema, type videoRequest, type videoScript } from "./llm/schema.js";
import { generateScript } from "./pipeline/scriptGenerator.js";
import { initDatabase } from "./database/index.js";
import fastifyCookie from "@fastify/cookie";
import { authRoutes } from "./auth/routes.js";
import { getQueue } from "./queue/index.js";
import { processVideoJob } from "./queue/handler.js";
import { IVideoQueue } from "./queue/interfaces.js";
import { validatePrompt } from "./security/promptGuard.js";
import { rateLimiter } from "./security/rateLimiter.js";
import { validateUploadedFile, generateSafeFilePath } from "./security/uploadGuard.js";
import { getCatalog, listBlueprints, listMotionBlocks } from "./templates/index.js";

export const jobIpMap = new Map<string, string>();

export async function buildApp(options: { logger?: boolean, queue?: IVideoQueue } = {}): Promise<FastifyInstance> {
    const queue = options.queue || await getQueue();
    const app = fastify({
        logger: options.logger ?? false,
        bodyLimit: 10 * 1024 * 1024,
    });

    await app.register(fastifyCors, { origin: true , credentials: true });
    await app.register(fastifyCookie);
    await app.register(authRoutes);

    // Đăng ký plugin xử lý upload file (multipart/form-data).
    // Giới hạn kích thước mỗi file tối đa 5MB để tránh tấn công DoS bằng file lớn.
    await app.register(fastifyMultipart, {
        limits: {
            fileSize: 5 * 1024 * 1024, // 5MB
            files: 1,                  // Chỉ chấp nhận 1 file mỗi request
        },
    });

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

    if (getConfig().QUEUE_TYPE !== 'redis') {
        queue.process(processVideoJob);
    }

    queue.events.on('completed', (args: any) => {
        const ip = jobIpMap.get(args.jobId);
        if (ip) {
            rateLimiter.releaseConcurrentJob(ip);
            jobIpMap.delete(args.jobId);
        }
    });

    queue.events.on('failed', (args: any) => {
        const ip = jobIpMap.get(args.jobId);
        if (ip) {
            rateLimiter.releaseConcurrentJob(ip);
            jobIpMap.delete(args.jobId);
        }
    });
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

    app.get("/api/catalog", async () => getCatalog());

    /** Fastify may parse repeated query keys as string[] — only accept a single string. */
    const queryString = (value: unknown): string | undefined =>
        typeof value === 'string' && value.length > 0 ? value : undefined;

    app.get("/api/catalog/blocks", async (request: FastifyRequest) => {
        const q = (request.query || {}) as Record<string, unknown>;
        const style = queryString(q.style)?.toLowerCase();
        const category = queryString(q.category);
        const runtime = queryString(q.runtime);
        let blocks = listMotionBlocks();
        if (style) {
            blocks = blocks.filter(
                (b) => b.styleAffinity.includes('any') || b.styleAffinity.includes(style as any)
            );
        }
        if (category) {
            blocks = blocks.filter((b) => b.category === category);
        }
        if (runtime === '1' || runtime === 'true') {
            blocks = blocks.filter((b) => b.runtime);
        }
        return { blocks, count: blocks.length };
    });

    app.get("/api/catalog/blueprints", async (request: FastifyRequest) => {
        const q = (request.query || {}) as Record<string, unknown>;
        const style = queryString(q.style)?.toLowerCase();
        let blueprints = listBlueprints();
        if (style) {
            blueprints = blueprints.filter(
                (b) => b.styleAffinity.includes('any' as any) || b.styleAffinity.includes(style as any)
            );
        }
        return { blueprints, count: blueprints.length };
    });

    /** Normalize client payload so template fields are never dropped / misspelled away. */
    const normalizeVideoRequestBody = (body: any) => {
        const raw = body && typeof body === 'object' ? body : {};
        const blueprintId =
            typeof raw.blueprintId === 'string' ? raw.blueprintId
            : typeof raw.blueprint_id === 'string' ? raw.blueprint_id
            : typeof raw.blueprint === 'string' ? raw.blueprint
            : undefined;

        let motionBlockIds: string[] | undefined;
        const rawBlocks = raw.motionBlockIds ?? raw.motion_block_ids ?? raw.motionBlocks;
        if (Array.isArray(rawBlocks)) {
            motionBlockIds = rawBlocks.map((id: unknown) => String(id)).filter(Boolean).slice(0, 8);
        } else if (typeof rawBlocks === 'string' && rawBlocks.trim()) {
            motionBlockIds = rawBlocks.split(',').map((s: string) => s.trim()).filter(Boolean).slice(0, 8);
        }

        return {
            ...raw,
            prompt: raw.prompt ?? raw.text ?? raw.topic,
            blueprintId: blueprintId || undefined,
            motionBlockIds: motionBlockIds?.length ? motionBlockIds : undefined,
        };
    };

    app.post("/api/script/draft", async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const normalized = normalizeVideoRequestBody(request.body);
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

    const handlePipelineRequest = async (request: FastifyRequest, reply: FastifyReply) => {
        const body = (request.body as any) || {};
        const isAsync = Boolean(body.async || (request.query as any)?.async === 'true');

        let reqData: videoRequest;
        try {
            const normalized = normalizeVideoRequestBody(body);
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

        const outputDir = join(process.cwd(), "tmp", `job-${jobId}`);

        if (isAsync) {
            jobIpMap.set(jobId, ip);
            await queue.addJob(jobId, {
                jobId,
                request: reqData,
                script: inputScript,
                bgmPath,
                skipPreview,
                outputDir
            });

            reply.status(202);
            return {
                message: "Video generation queued",
                jobId,
                checkStatusUrl: `/api/jobs/${jobId}`,
                htmlUrl: `/api/jobs/${jobId}/html`,
                audioUrl: `/api/jobs/${jobId}/audio`,
                streamUrl: `/api/jobs/${jobId}/events`
            };
        } else {
            try {
                const result = await processVideoJob({
                    jobId,
                    request: reqData,
                    script: inputScript,
                    bgmPath,
                    skipPreview,
                    outputDir
                }, async () => {});

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

    app.get("/api/jobs", async () => {
        const jobs = await queue.getJobs();
        return jobs.map((j) => ({
            jobId: j.jobId,
            status: j.status,
            createdAt: j.createdAt,
            updatedAt: j.updatedAt,
            topic: j.request.prompt,
            durationSec: j.result?.durationSec,
            error: j.error,
        }));
    });

    app.get("/api/jobs/:jobId", async (request: FastifyRequest<{ Params: { jobId: string } }>, reply: FastifyReply) => {
        const { jobId } = request.params;
        const job = await queue.getJob(jobId);
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

    app.get("/api/jobs/:jobId/events", async (request: FastifyRequest<{ Params: { jobId: string } }>, reply: FastifyReply) => {
        const { jobId } = request.params;
        
        reply.raw.setHeader('Content-Type', 'text/event-stream');
        reply.raw.setHeader('Cache-Control', 'no-cache');
        reply.raw.setHeader('Connection', 'keep-alive');
        reply.raw.flushHeaders();

        const job = await queue.getJob(jobId);
        if (!job) {
            reply.raw.write(`event: error\ndata: ${JSON.stringify({ error: 'Job not found' })}\n\n`);
            reply.raw.end();
            return;
        }

        reply.raw.write(`data: ${JSON.stringify({ status: job.status, progress: job.progress })}\n\n`);
        
        if (job.status === 'completed' || job.status === 'failed') {
            reply.raw.end();
            return;
        }

        const heartbeatInterval = setInterval(() => {
            reply.raw.write(`: heartbeat\n\n`);
        }, 15000);

        const onProgress = (args: any) => {
            if (args.jobId === jobId) {
                reply.raw.write(`data: ${JSON.stringify({ status: 'running', progress: args.data })}\n\n`);
            }
        };

        const onCompleted = (args: any) => {
            if (args.jobId === jobId) {
                reply.raw.write(`data: ${JSON.stringify({ status: 'completed', result: args.returnvalue })}\n\n`);
                reply.raw.end();
                cleanup();
            }
        };

        const onFailed = (args: any) => {
            if (args.jobId === jobId) {
                reply.raw.write(`data: ${JSON.stringify({ status: 'failed', error: args.failedReason })}\n\n`);
                reply.raw.end();
                cleanup();
            }
        };

        const cleanup = () => {
            clearInterval(heartbeatInterval);
            queue.events.removeListener('progress', onProgress);
            queue.events.removeListener('completed', onCompleted);
            queue.events.removeListener('failed', onFailed);
        };

        queue.events.on('progress', onProgress);
        queue.events.on('completed', onCompleted);
        queue.events.on('failed', onFailed);

        request.raw.on('close', cleanup);
    });

    app.get("/api/jobs/:jobId/html", async (request: FastifyRequest<{ Params: { jobId: string } }>, reply: FastifyReply) => {
        const { jobId } = request.params;
        const job = await queue.getJob(jobId);
        const htmlPath = job?.result?.finalHtmlPath ?? join(process.cwd(), "tmp", `job-${jobId}`, "index.html");
        if (!existsSync(htmlPath)) {
            reply.status(404);
            return { error: "HTML bundle not found for job" };
        }
        reply.type("text/html; charset=utf-8").send(createReadStream(htmlPath));
    });

    app.get("/api/jobs/:jobId/audio", async (request: FastifyRequest<{ Params: { jobId: string } }>, reply: FastifyReply) => {
        const { jobId } = request.params;
        const job = await queue.getJob(jobId);
        const audioPath = job?.result?.audio?.mixAudioPath ?? join(process.cwd(), "tmp", `job-${jobId}`, "mixed_audio.mp3");
        if (!existsSync(audioPath)) {
            reply.status(404);
            return { error: "Audio file not found for job" };
        }
        reply.type("audio/mpeg").send(createReadStream(audioPath));
    });

    app.get("/api/jobs/:jobId/preview/:sceneId", async (request: FastifyRequest<{ Params: { jobId: string; sceneId: string } }>, reply: FastifyReply) => {
        const { jobId, sceneId } = request.params;
        const job = await queue.getJob(jobId);
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
        const job = await queue.getJob(jobId);
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
        const job = await queue.getJob(jobId);
        const videoPath = job?.result?.videoPath ?? join(process.cwd(), "tmp", `job-${jobId}`, "final_video.mp4");
        if (!existsSync(videoPath)) {
            reply.status(404);
            return { error: "Video file not found for job" };
        }
        reply.header("Content-Disposition", `attachment; filename="video-${jobId}.mp4"`);
        reply.type("video/mp4").send(createReadStream(videoPath));
    });
    // ──────────────────────────────────────────────────────────────
    // ROUTE: POST /api/brand-kit/upload
    // Mục tiêu: Cho phép người dùng upload ảnh logo lên server.
    //
    // Quy trình xử lý:
    //   1. Nhận file qua multipart/form-data (field tên "logo")
    //   2. Đọc toàn bộ dữ liệu nhị phân vào Buffer
    //   3. Gọi validateUploadedFile() để kiểm tra bảo mật:
    //      - Kích thước <= 5MB
    //      - MIME type hợp lệ (PNG/JPEG/SVG/WEBP)
    //      - Magic bytes khớp MIME type (chống giả mạo định dạng)
    //      - SVG: sanitize loại bỏ mã độc XSS/XXE
    //   4. Lưu file với tên UUID ngẫu nhiên (chống Path Traversal)
    //   5. Trả về đường dẫn URL để dùng trong watermark.logoPath
    // ──────────────────────────────────────────────────────────────
    app.post("/api/brand-kit/upload", async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            // Lấy file từ form-data (field name phải là "logo")
            const data = await request.file();
            if (!data) {
                reply.status(400);
                return { error: 'Không tìm thấy file trong request. Hãy gửi file với field name là "logo".' };
            }

            // Đọc toàn bộ nội dung file vào Buffer để kiểm tra
            const chunks: Buffer[] = [];
            for await (const chunk of data.file) {
                chunks.push(chunk);
            }
            const fileBuffer = Buffer.concat(chunks);

            // Kiểm tra bảo mật toàn diện (kích thước, MIME, magic bytes, SVG sanitize)
            const mimeType = data.mimetype || 'application/octet-stream';
            const validation = validateUploadedFile(fileBuffer, mimeType);

            if (!validation.isValid) {
                reply.status(400);
                return { error: validation.reason };
            }

            // Tạo đường dẫn lưu file với tên UUID (an toàn, không thể đoán)
            const savePath = generateSafeFilePath(mimeType);

            // Ghi file: SVG dùng nội dung đã sanitize, các định dạng khác dùng buffer gốc
            if (mimeType === 'image/svg+xml' && validation.sanitizedContent) {
                writeFileSync(savePath, validation.sanitizedContent, 'utf-8');
            } else {
                writeFileSync(savePath, fileBuffer);
            }

            // Tạo URL công khai để client dùng trong trường watermark.logoPath
            // Đường dẫn tương đối từ thư mục gốc của dự án
            const relativeUrl = `/uploads/logos/${savePath.split(/[\\/]/).pop()}`;

            return {
                success: true,
                logoUrl: relativeUrl,   // Client dùng giá trị này làm watermark.logoPath
                filePath: savePath,     // Đường dẫn tuyệt đối trên server (dùng nội bộ)
                mimeType,
            };
        } catch (err: any) {
            reply.status(500);
            return { error: `Lỗi khi xử lý file upload: ${err.message}` };
        }
    });

    return app;
}

export async function startServer(): Promise<FastifyInstance> {
    const config = getConfig();
    const queue = await getQueue();
    queue.startListeners();
    const app = await buildApp({ queue, logger: true });
    await initDatabase();
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