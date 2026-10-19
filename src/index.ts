import fastify, { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import fastifyMultipart from "@fastify/multipart";
import { existsSync, createReadStream, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { v4 } from "uuid";
import { getConfig } from "./config.js";
import { getCurrentUser } from "./auth/session.js";
import { videoRequestSchema, videoScriptSchema, watermarkConfigSchema, type videoRequest, type videoScript } from "./llm/schema.js";
import { generateScript } from "./pipeline/scriptGenerator.js";
import { estimateDuration } from "./pipeline/estimateDuration.js";
import {
    CLARIFY_QUESTIONS,
    DEFAULT_ANSWERS,
    buildAnswerDirectives,
    buildQuestionViews,
    clarifyAnswersSchema,
    inferAnswers,
    mergeAnswers,
} from "./pipeline/clarify.js";
import { dedupeVariants, pickVariants, scoreDraft } from "./pipeline/scriptVariants.js";
import { initDatabase } from "./database/index.js";
import fastifyCookie from "@fastify/cookie";
import { authRoutes } from "./auth/routes.js";
import { billingRoutes } from "./billing/routes.js";
import { startBillingCron, stopBillingCron } from "./billing/cron.js";
import { getQueue } from "./queue/index.js";
import { processVideoJob } from "./queue/handler.js";
import { IVideoQueue } from "./queue/interfaces.js";
import { resolveJobVideoPath } from "./queue/jobVideo.js";
import { validatePrompt } from "./security/promptGuard.js";
import { rateLimiter } from "./security/rateLimiter.js";
import { validateUploadedFile, generateSafeFilePath } from "./security/uploadGuard.js";
import { getBrandKitByUserId, upsertBrandKit } from "./database/brandKit.js";
import { getCatalog, listBlueprints, listMotionBlocks } from "./templates/index.js";
import { adminRoutes } from "./admin/routes.js";
import { supportRoutes } from "./helpdesk/routes.js";
import { systemSettings } from "./admin/systemSettings.js";
import { announcementsStore } from "./admin/announcements.js";
import { pageViewTracker } from "./security/pageViewTracker.js";
import { db } from "./database/index.js";
import { hashString32, parseSeedSafe } from "./pipeline/rng.js";

export const jobIpMap = new Map<string, string>();

export async function buildApp(options: { logger?: boolean, queue?: IVideoQueue } = {}): Promise<FastifyInstance> {
    const queue = options.queue || await getQueue();
    const app = fastify({
        logger: options.logger ?? false,
        bodyLimit: 10 * 1024 * 1024,
    });

    await app.register(fastifyCors, { origin: true , credentials: true });
    await app.register(fastifyCookie);

    // Đăng ký plugin xử lý upload file (multipart/form-data).
    // Giới hạn kích thước mỗi file tối đa 5MB để tránh tấn công DoS bằng file lớn.
    // LƯU Ý: phải đăng ký TRƯỚC mọi plugin chứa route dùng `request.file()`
    // (@fastify/multipart thêm content-type parser ở scope nơi nó boot — đăng ký
    // sau sẽ làm các scope route đã tồn tại không thấy parser và trả 415).
    await app.register(fastifyMultipart, {
        limits: {
            fileSize: 5 * 1024 * 1024, // 5MB
            files: 1,                  // Chỉ chấp nhận 1 file mỗi request
        },
    });

    await app.register(authRoutes);
    await app.register(billingRoutes);
    await app.register(adminRoutes, { queue });
    // Helpdesk / Ticketing: widget "Hỗ trợ" phía người dùng (sau admin để nhất quán cấu trúc)
    await app.register(supportRoutes);

    const frontendDir = join(process.cwd(), "frontend");
    if (existsSync(frontendDir)) {
        await app.register(fastifyStatic, {
            root: frontendDir,
            prefix: "/",
            index: false,
        });
    }

    // Đăng ký phục vụ tệp tĩnh ảnh logo từ thư mục tmp/uploads/logos kèm headers bảo mật
    const logosDir = join(process.cwd(), "tmp", "uploads", "logos");
    mkdirSync(logosDir, { recursive: true });
    await app.register(fastifyStatic, {
        root: logosDir,
        prefix: "/uploads/logos/",
        decorateReply: false,
        setHeaders: (res) => {
            res.header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
            res.header("X-Content-Type-Options", "nosniff");
            res.header("X-Frame-Options", "DENY");
        },
    });

    // Đăng ký phục vụ tệp tĩnh ảnh đính kèm ticket từ thư mục tmp/uploads/tickets
    // (headers bảo mật giống thư mục logos: sandbox CSP — vẫn thấy ảnh nhưng không chạy script)
    const ticketsDir = join(process.cwd(), "tmp", "uploads", "tickets");
    mkdirSync(ticketsDir, { recursive: true });
    await app.register(fastifyStatic, {
        root: ticketsDir,
        prefix: "/uploads/tickets/",
        decorateReply: false,
        setHeaders: (res) => {
            res.header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
            res.header("X-Content-Type-Options", "nosniff");
            res.header("X-Frame-Options", "DENY");
        },
    });

    app.addHook("preHandler", async (request, reply) => {
        const url = request.url;
        const path = url.split("?")[0];

        // Chế độ bảo trì: chặn API của người dùng thường nhưng vẫn cho phép admin
        // đăng nhập/quản trị để có thể tắt bảo trì. Trước đây cờ maintenanceMode
        // chỉ được lưu mà không hề được áp dụng.
        if (systemSettings.get().maintenanceMode && path.startsWith("/api/")) {
            const alwaysAllowed =
                path.startsWith("/api/admin") ||
                path.startsWith("/api/auth") ||
                path === "/api/settings" ||
                path === "/api/announcements" ||
                // Helpdesk phải dùng được cả khi bảo trì để báo lỗi giữa chuyến
                path.startsWith("/api/support");
            if (!alwaysAllowed) {
                const user = await getCurrentUser(request);
                if (user?.role !== "admin") {
                    reply.status(503).send({ error: "Hệ thống đang bảo trì. Vui lòng thử lại sau." });
                    return reply;
                }
            }
        }

        if (
            url.startsWith("/api/script/draft") ||
            url.startsWith("/api/script/clarify") ||
            url.startsWith("/api/pipeline") ||
            url.startsWith("/api/generate") ||
            url.startsWith("/api/source/") ||
            url.startsWith("/api/brand-kit") ||
            url.startsWith("/api/user/brand-kit")
        ) {
            const ip = request.ip || '127.0.0.1';
            const body = request.body as any;

            // /api/script/draft gọi LLM song song cho từng phương án, cộng thêm một
            // lần phân loại nếu client chưa gửi answers. Tính RPM theo lượt gọi thật
            // để không ai nhân chi phí LLM lên 3 lần mà vẫn trong hạn mức.
            let rpmCost = 1;
            if (path === '/api/script/draft') {
                const requested = Number(body?.variantCount ?? 1);
                const variants = Number.isFinite(requested)
                    ? Math.min(3, Math.max(1, Math.floor(requested)))
                    : 1;
                rpmCost = variants + (body?.answers ? 0 : 1);
            } else if (path === '/api/pipeline' && (body?.autoDirect || body?.mode === 'auto')) {
                // autoDirect = 1 lần phân loại + 3 lần sinh phương án.
                rpmCost = 4;
            }

            if (!rateLimiter.checkRpm(ip, 20, rpmCost)) {
                reply.status(429).send({ error: "Too Many Requests (RPM exceeded)" });
                return reply;
            }

            const promptCandidate = body?.prompt ?? body?.text ?? body?.topic;
            if (typeof promptCandidate === 'string') {
                const check = validatePrompt(promptCandidate);
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

    // Giải phóng suất chạy song song của IP khi job kết thúc (thành công/thất bại/bị hủy).
    const releaseJobSlot = (args: any) => {
        const ip = jobIpMap.get(args?.jobId);
        if (ip) {
            rateLimiter.releaseConcurrentJob(ip);
            jobIpMap.delete(args.jobId);
        }
    };

    queue.events.on('completed', releaseJobSlot);
    queue.events.on('failed', releaseJobSlot);
    queue.events.on('cancelled', releaseJobSlot);
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
        return reply.redirect("/workspace", 302);
    });

    app.get("/workspace", async (_request: FastifyRequest, reply: FastifyReply) => {
        const htmlPath = join(frontendDir, "workspace.html");
        if (existsSync(htmlPath)) {
            reply.type("text/html; charset=utf-8").send(createReadStream(htmlPath));
            return reply;
        }
        reply.status(404).send("Workspace not found");
    });

    const serveLegal = async (_request: FastifyRequest, reply: FastifyReply) => {
        const htmlPath = join(frontendDir, "legal.html");
        if (existsSync(htmlPath)) {
            reply.type("text/html; charset=utf-8").send(createReadStream(htmlPath));
            return reply;
        }
        reply.status(404).send("Legal page not found");
    };
    app.get("/legal", serveLegal);
    app.get("/terms", serveLegal);
    app.get("/privacy", serveLegal);

    app.get("/public/logo.png", async (_request: FastifyRequest, reply: FastifyReply) => {
        const logoPath = join(frontendDir, "logo.png");
        if (existsSync(logoPath)) {
            reply.type("image/png").send(createReadStream(logoPath));
            return reply;
        }
        reply.status(404).send("Logo not found");
    });

    app.get("/admin", async (request: FastifyRequest, reply: FastifyReply) => {
        const user = await getCurrentUser(request);
        if (!user) {
            return reply.redirect("/?auth=open&error=admin_required");
        }
        if (user.role !== "admin") {
            reply.status(403);
            return reply.send({ error: "Chỉ tài khoản Super Admin mới có quyền truy cập trang quản trị." });
        }
        const htmlPath = join(frontendDir, "admin.html");
        if (existsSync(htmlPath)) {
            reply.type("text/html; charset=utf-8").send(createReadStream(htmlPath));
            return reply;
        }
        reply.status(404).send("Admin portal frontend not found");
    });

    app.get("/profile", async (request: FastifyRequest, reply: FastifyReply) => {
        const user = await getCurrentUser(request);
        if (!user) {
            return reply.redirect("/?auth=open");
        }
        const htmlPath = join(frontendDir, "profile.html");
        if (existsSync(htmlPath)) {
            reply.type("text/html; charset=utf-8").send(createReadStream(htmlPath));
            return reply;
        }
        reply.status(404).send("Profile page not found");
    });

    const serveSettings = async (request: FastifyRequest, reply: FastifyReply) => {
        const user = await getCurrentUser(request);
        if (!user) {
            return reply.redirect("/?auth=open");
        }
        const htmlPath = join(frontendDir, "settings.html");
        if (existsSync(htmlPath)) {
            reply.type("text/html; charset=utf-8").send(createReadStream(htmlPath));
            return reply;
        }
        reply.status(404).send("Settings page not found");
    };
    app.get("/setting", serveSettings);
    app.get("/settings", serveSettings);

    app.get("/api/settings", async (request: FastifyRequest) => {
        const sys = systemSettings.get();
        const user = await getCurrentUser(request);

        const currentSettings = {
            llmProvider: user?.preferences?.llmProvider || sys.defaultLlmProvider,
            llmModel: user?.preferences?.llmModel || sys.defaultLlmModel,
            ttsProvider: user?.preferences?.ttsProvider || sys.defaultTtsProvider,
            ttsVoice: user?.preferences?.ttsVoice || sys.defaultTtsVoice,
            elevenlabsApiKey: user?.preferences?.elevenlabsApiKey ? "••••••••" : "",
            maintenanceMode: sys.maintenanceMode,
            systemNotice: sys.systemNotice,
            maxConcurrentJobs: sys.maxConcurrentJobs,
            allowSandboxPayments: sys.allowSandboxPayments,
        };

        return {
            settings: currentSettings,
            userPreferences: user?.preferences || {},
            providers: {
                llm: ["deepseek", "gemini", "claude", "openai", "9router"],
                tts: ["edge", "vieneu", "openai", "google", "elevenlabs"],
            },
        };
    });

    /**
     * Banner thông báo toàn hệ thống — công khai cho cả khách chưa đăng nhập.
     *
     * Trả về các thông báo đang hiệu lực (đúng đối tượng người xem), kèm cờ
     * `maintenanceMode` và `systemNotice` cũ để giao diện hiển thị banner bảo trì
     * ngay cả khi admin bật chế độ bảo trì mà chưa tạo thông báo riêng.
     */
    app.get("/api/announcements", async (request: FastifyRequest, reply: FastifyReply) => {
        const user = await getCurrentUser(request);
        const sys = systemSettings.get();
        const announcements = await announcementsStore.listPublic(user ? "user" : "guest");

        reply.header("Cache-Control", "no-store");
        return {
            announcements,
            legacyNotice: sys.systemNotice || "",
            maintenanceMode: sys.maintenanceMode,
            viewer: user ? "user" : "guest",
        };
    });

    app.put("/api/settings", async (request: FastifyRequest, reply: FastifyReply) => {
        const user = await getCurrentUser(request);
        if (!user) {
            reply.status(401);
            return { error: "Yêu cầu đăng nhập để lưu cài đặt." };
        }

        const body = (request.body as any) || {};
        const config = getConfig();

        const currentPrefs = user.preferences || {};
        const newPrefs = {
            ...currentPrefs,
            ...(body.llmProvider ? { llmProvider: body.llmProvider } : {}),
            ...(body.llmModel ? { llmModel: body.llmModel } : {}),
            ...(body.ttsProvider ? { ttsProvider: body.ttsProvider } : {}),
            ...(body.ttsVoice ? { ttsVoice: body.ttsVoice } : {}),
            ...(body.elevenlabsApiKey !== undefined && body.elevenlabsApiKey !== "••••••••"
                ? { elevenlabsApiKey: body.elevenlabsApiKey }
                : {}),
            ...(body.watermark ? { watermark: body.watermark } : {}),
        };

        if (config.DATABASE_URL) {
            try {
                await db.query(
                    `UPDATE users SET preferences = $1, updated_at = NOW() WHERE id = $2`,
                    [JSON.stringify(newPrefs), user.id]
                );
            } catch (err) {
                console.error("[Settings] Error updating user preferences:", err);
            }
        }

        if (user.role === "admin") {
            const sysKeys = ["maintenanceMode", "registrationEnabled", "maxConcurrentJobs", "systemNotice", "allowSandboxPayments"];
            const sysUpdates: any = {};
            for (const k of sysKeys) {
                if (body[k] !== undefined) sysUpdates[k] = body[k];
            }
            if (Object.keys(sysUpdates).length > 0) {
                systemSettings.update(sysUpdates, user.email);
            }
        }

        return {
            success: true,
            preferences: newPrefs,
        };
    });

    app.addHook("onResponse", async (request) => {
        const url = request.url.split("?")[0];
        if (
            request.method === "GET" &&
            !url.startsWith("/api/") &&
            !url.startsWith("/uploads/") &&
            !url.includes(".")
        ) {
            try {
                const user = await getCurrentUser(request);
                await pageViewTracker.track({
                    ip: request.ip,
                    path: url,
                    userAgent: (request.headers["user-agent"] as string) || "",
                    referrer: (request.headers["referer"] as string) || "",
                    request,
                    userId: user?.id,
                    userEmail: user?.email,
                    userName: user?.username,
                });
            } catch {}
        }
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
        const body = (request.body as any) ?? {};
        try {
            const normalized = normalizeVideoRequestBody(body);
            // Route nháp không bắt buộc style vì người dùng chọn phong cách bằng
            // cách chọn phương án; body thiếu style thì tạm dùng 'modern'.
            const reqData = videoRequestSchema.parse({ ...normalized, style: normalized.style ?? 'modern' });

            const requestedCount = Number(body.variantCount ?? 1);
            const variantCount = Number.isFinite(requestedCount)
                ? Math.min(3, Math.max(1, Math.floor(requestedCount)))
                : 1;
            const requestedRotation = Number(body.variantRotation ?? 0);
            const rotation = Number.isFinite(requestedRotation) ? Math.max(0, Math.floor(requestedRotation)) : 0;

            let provided: ReturnType<typeof clarifyAnswersSchema.parse> = {};
            try {
                provided = clarifyAnswersSchema.parse(body.answers ?? {});
            } catch {
                provided = {};
            }

            // UI đã hỏi người dùng rồi thì không gọi LLM phân loại lần nữa.
            const needsInference = !(provided.audience && provided.purpose && provided.structure);
            const inference = needsInference ? await inferAnswers(reqData.prompt) : null;
            const answers = mergeAnswers(inference?.answers ?? DEFAULT_ANSWERS, provided);
            const confidence = {
                audience: provided.audience ? 1 : (inference?.confidence.audience ?? 0),
                purpose: provided.purpose ? 1 : (inference?.confidence.purpose ?? 0),
                structure: provided.structure ? 1 : (inference?.confidence.structure ?? 0),
            };

            const directives = buildAnswerDirectives(answers);
            const variants = pickVariants(reqData.prompt, {
                purpose: answers.purpose,
                rotation,
                count: variantCount,
            });

            const settled = await Promise.allSettled(
                variants.map(variant => generateScript(reqData, undefined, undefined, variant, directives))
            );

            const drafts = settled.flatMap((entry, index) => {
                if (entry.status !== 'fulfilled') return [];
                const variant = variants[index];
                const script = entry.value;
                const estimated = estimateDuration(script, { language: reqData.language });
                const words = script.scenes.reduce(
                    (sum, scene) => sum + (scene.voiceOverText?.trim().split(/\s+/).filter(Boolean).length ?? 0),
                    0
                );
                const { score, reason } = scoreDraft(script, reqData);
                return [{
                    key: variant.key,
                    label: variant.label,
                    hook: variant.hook,
                    style: variant.style,
                    blueprintId: variant.blueprintId,
                    script,
                    estimated: { totalDurationSec: estimated.totalDurationSec, words },
                    score,
                    reason,
                }];
            });

            const unique = dedupeVariants(drafts)
                .sort((a, b) => b.score - a.score)
                .slice(0, variantCount);

            // Một phương án là đủ cho chế độ cũ; ba phương án phải còn ít nhất 2
            // để người dùng thực sự có lựa chọn.
            const requiredSuccesses = Math.min(2, variantCount);
            if (unique.length < requiredSuccesses) {
                const details = settled
                    .filter((entry): entry is PromiseRejectedResult => entry.status === 'rejected')
                    .map(entry => entry.reason?.message ?? String(entry.reason))
                    .slice(0, 3)
                    .join(' | ');
                reply.status(502);
                return {
                    success: false,
                    error: 'Không sinh đủ phương án khác nhau. Vui lòng thử lại.',
                    details: details.slice(0, 2000),
                };
            }

            const recommended = unique[0].key;

            if (variantCount === 1) {
                // Giữ nguyên shape cũ cho client chưa nâng cấp.
                return {
                    success: true,
                    script: unique[0].script,
                    estimated: unique[0].estimated,
                    answers,
                    confidence,
                    recommended,
                };
            }

            return {
                success: true,
                drafts: unique,
                answers,
                confidence,
                recommended,
                clarifySource: inference?.source ?? 'provided',
            };
        } catch (err: any) {
            reply.status(400);
            return {
                success: false,
                error: err.message,
            };
        }
    });

    /**
     * Hỏi 3 câu làm rõ cho một prompt.
     *
     * Tách khỏi /api/script/draft để UI hiện form ngay sau ~1-2s thay vì chờ
     * sinh xong 3 phương án mới biết cần hỏi gì.
     */
    app.post("/api/script/clarify", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = (request.body as any) ?? {};
        const prompt = String(body.prompt ?? body.text ?? body.topic ?? '').trim();
        if (prompt.length < 10) {
            reply.status(400);
            return { success: false, error: 'Prompt phải có ít nhất 10 ký tự' };
        }

        const result = await inferAnswers(prompt);
        return {
            success: true,
            source: result.source,
            answers: result.answers,
            confidence: result.confidence,
            questions: buildQuestionViews(result),
            error: result.error,
        };
    });

    app.get("/api/script/clarify/questions", async () => ({
        success: true,
        questions: CLARIFY_QUESTIONS,
    }));

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

        // Kịch bản do client gửi lên phải được kiểm ngay tại route: nếu để worker
        // phát hiện thì người dùng đã bị trừ quota và nhận job failed vô nghĩa.
        let inputScript: videoScript | undefined;
        if (body.script !== undefined && body.script !== null) {
            const parsed = videoScriptSchema.safeParse(body.script);
            if (!parsed.success) {
                reply.status(400);
                return {
                    error: "Invalid script",
                    details: parsed.error.issues
                        .map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
                        .slice(0, 5)
                        .join('; '),
                };
            }
            inputScript = parsed.data;

            const estimated = estimateDuration(inputScript, { language: reqData.language });
            if (estimated.totalDurationSec > reqData.targetDurationSec * 1.5) {
                reply.status(400);
                return {
                    error: "Script too long",
                    details: `Kịch bản ước lượng ${estimated.totalDurationSec.toFixed(1)}s, vượt quá 150% mục tiêu ${reqData.targetDurationSec}s.`,
                };
            }
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

        const bgmPath = body.bgmPath as string | undefined;
        const skipPreview = Boolean(body.skipPreview);
        const autoDirect = Boolean(body.autoDirect || body.mode === 'auto');
        const autoAnswers = body.answers;
        const requestedRotation = Number(body.variantRotation ?? 0);
        const variantRotation = Number.isFinite(requestedRotation) ? Math.max(0, Math.floor(requestedRotation)) : 0;
        const jobId = body.jobId || v4();
        const defaultSeed = hashString32(jobId);
        const seed = parseSeedSafe(reqData.seed ?? body.seed, defaultSeed);

        // Xác định chủ job để cổng quản trị hiển thị/tìm kiếm theo người dùng.
        const currentUser = await getCurrentUser(request);
        const userId = currentUser?.id;

        const outputDir = join(process.cwd(), "tmp", `job-${jobId}`);

        if (isAsync) {
            jobIpMap.set(jobId, ip);
            await queue.addJob(jobId, {
                jobId,
                userId,
                request: reqData,
                script: inputScript,
                autoDirect,
                autoAnswers,
                variantRotation,
                bgmPath,
                skipPreview,
                outputDir,
                seed
            });

            reply.status(202);
            return {
                message: "Video generation queued",
                jobId,
                seed,
                checkStatusUrl: `/api/jobs/${jobId}`,
                htmlUrl: `/api/jobs/${jobId}/html`,
                audioUrl: `/api/jobs/${jobId}/audio`,
                streamUrl: `/api/jobs/${jobId}/events`
            };
        } else {
            try {
                const result = await processVideoJob({
                    jobId,
                    userId,
                    request: reqData,
                    script: inputScript,
                    autoDirect,
                    autoAnswers,
                    variantRotation,
                    bgmPath,
                    skipPreview,
                    outputDir,
                    seed
                }, async () => {});

                return {
                    success: true,
                    jobId: result.jobId,
                    seed: result.seed,
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
        // Mới nhất trước. Không dựa vào thứ tự của queue: memory queue trả theo
        // thứ tự chèn còn BullMQ trả theo từng state, nên client luôn nhận một
        // danh sách đã sắp xếp thay vì phải tự đoán.
        const timeOf = (j: { createdAt?: string; updatedAt?: string }) => {
            const t = Date.parse(j.createdAt || j.updatedAt || "");
            return Number.isFinite(t) ? t : 0;
        };
        return jobs
            .map((j) => ({
                jobId: j.jobId,
                status: j.status,
                createdAt: j.createdAt,
                updatedAt: j.updatedAt,
                topic: j.request.prompt,
                durationSec: j.result?.durationSec,
                qaStatus: j.qaStatus ?? j.result?.qaStatus,
                error: j.error,
            }))
            .sort((a, b) => timeOf(b) - timeOf(a));
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
            qaStatus: job.qaStatus ?? job.result?.qaStatus,
            qaReport: job.qaReport ?? job.result?.qaReport,
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
        const videoPath = resolveJobVideoPath(job, jobId);
        if (!existsSync(videoPath)) {
            reply.status(404);
            return { error: "Video file not found for job" };
        }

        const stat = statSync(videoPath);
        const fileSize = stat.size;
        const range = request.headers.range;
        // Video của một job là bất biến, nhưng tệp có thể bị ghi đè khi render lại
        // cùng thư mục. `no-cache` + ETag buộc trình duyệt hỏi lại: nếu tệp không
        // đổi thì chỉ tốn một 304, còn nếu đổi thì không bao giờ phát video cũ.
        const etag = `"v${fileSize.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
        const cacheHeaders = {
            'Cache-Control': 'private, no-cache',
            'ETag': etag,
            'Last-Modified': stat.mtime.toUTCString(),
        };

        if (!range && request.headers['if-none-match'] === etag) {
            reply.raw.writeHead(304, cacheHeaders);
            reply.raw.end();
            return reply;
        }

        if (range) {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunkSize = (end - start) + 1;
            const file = createReadStream(videoPath, { start, end });
            reply.raw.writeHead(206, {
                ...cacheHeaders,
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunkSize,
                'Content-Type': 'video/mp4',
            });
            file.pipe(reply.raw);
            return reply;
        } else {
            reply.raw.writeHead(200, {
                ...cacheHeaders,
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
        const videoPath = resolveJobVideoPath(job, jobId);
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
            // Yêu cầu đăng nhập: chống upload ẩn danh gây đầy ổ đĩa (DoS)
            const user = await getCurrentUser(request);
            if (!user) {
                reply.status(401);
                return { error: 'Yêu cầu đăng nhập để tải logo lên.' };
            }

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

            if (data.file.truncated) {
                reply.status(413);
                return { error: 'File tải lên bị cắt ngắn hoặc vượt quá dung lượng cho phép (tối đa 5MB).' };
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

            // Ghi file: SVG bắt buộc phải dùng nội dung đã sanitize và không được rỗng
            if (mimeType === 'image/svg+xml') {
                if (!validation.sanitizedContent || !validation.sanitizedContent.trim()) {
                    reply.status(400);
                    return { error: 'Nội dung SVG rỗng hoặc không hợp lệ sau khi làm sạch.' };
                }
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
                mimeType,
            };
            // Lưu ý: KHÔNG trả về đường dẫn tuyệt đối trên server (filePath)
            // để tránh lộ cấu trúc thư mục và tránh việc client gửi absolute path.
        } catch (err: any) {
            reply.status(500);
            return { error: `Lỗi khi xử lý file upload: ${err.message}` };
        }
    });
    // ──────────────────────────────────────────────────────────────
    // ROUTE: GET /api/user/brand-kit
    // Mục tiêu: Lấy cài đặt logo hiện tại của tài khoản người dùng.
    // Trả về null nếu người dùng chưa thiết lập brand kit lần nào.
    // ──────────────────────────────────────────────────────────────
    app.get("/api/user/brand-kit", async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            // Xác thực qua session cookie (getCurrentUser), thay vì đọc
            // (request as any).user vốn không được gán ở bất kỳ đâu.
            const user = await getCurrentUser(request);
            if (!user) {
                reply.status(401);
                return { error: 'Yêu cầu đăng nhập để truy cập cài đặt brand kit.' };
            }

            const brandKit = await getBrandKitByUserId(user.id);

            // Trả về null nếu chưa thiết lập, client tự hiển thị UI mặc định
            return { brandKit };
        } catch (err: any) {
            reply.status(500);
            return { error: `Lỗi khi đọc cài đặt brand kit: ${err.message}` };
        }
    });

    // ──────────────────────────────────────────────────────────────
    // ROUTE: PUT /api/user/brand-kit
    // Mục tiêu: Lưu (tạo mới hoặc cập nhật) cài đặt logo của người dùng.
    // Dùng upsert nên không cần kiểm tra tồn tại trước.
    // ──────────────────────────────────────────────────────────────
    app.put("/api/user/brand-kit", async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const user = await getCurrentUser(request);
            if (!user) {
                reply.status(401);
                return { error: 'Yêu cầu đăng nhập để lưu cài đặt brand kit.' };
            }

            // Lấy dữ liệu từ body và kiểm tra các trường bắt buộc
            const body = (request.body as any) || {};

            // logoUrl phải là đường dẫn logo do API upload trả về
            // (không chấp nhận absolute path để tránh hợp thức hoá LFI)
            if (typeof body.logoUrl !== 'string' || !body.logoUrl.startsWith('/uploads/logos/')) {
                reply.status(400);
                return { error: 'Trường logoUrl phải là đường dẫn logo đã upload (/uploads/logos/...).' };
            }

            // Validate toàn bộ body bằng watermarkConfigSchema (zod):
            // chặn position quá dài (cột VARCHAR(20)), scalePct/opacity ngoài khoảng, ...
            const parsed = watermarkConfigSchema.safeParse({
                logoPath: body.logoUrl,
                position: body.position ?? undefined,
                scalePercent: body.scalePct ?? undefined,
                opacity: body.opacity ?? undefined,
                xPercent: body.xPct ?? undefined,
                yPercent: body.yPct ?? undefined,
            });
            if (!parsed.success) {
                reply.status(400);
                return { error: 'Dữ liệu brand kit không hợp lệ.', details: parsed.error.flatten() };
            }
            const cfg = parsed.data;

            const saved = await upsertBrandKit(user.id, {
                logoUrl:  cfg.logoPath,
                position: cfg.position,
                scalePct: cfg.scalePercent,
                opacity:  cfg.opacity,
                xPct:     cfg.xPercent ?? null,
                yPct:     cfg.yPercent ?? null,
            });

            return { success: true, brandKit: saved };
        } catch (err: any) {
            reply.status(500);
            return { error: `Lỗi khi lưu cài đặt brand kit: ${err.message}` };
        }
    });

    return app;
}

export async function startServer(): Promise<FastifyInstance> {
    const config = getConfig();
    const queue = await getQueue();
    queue.startListeners();
    const app = await buildApp({ queue, logger: true });
    try {
        await initDatabase();
    } catch (err) {
        if (config.NODE_ENV === "development") {
            console.warn(`[Database] ⚠️ Could not connect to PostgreSQL: ${(err as Error).message}`);
            console.warn(`[Database] ⚠️ Auth & Brand Kit features will be unavailable until PostgreSQL is running.`);
        } else {
            throw err;
        }
    }
    try {
        startBillingCron(app);
        await app.listen({ port: config.PORT, host: "0.0.0.0" });
        console.log(`Backend server listening at http://localhost:${config.PORT}`);
        return app;
    } catch (err) {
        stopBillingCron();
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