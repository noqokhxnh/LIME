import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { rmSync, existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import { getCurrentUser, revokeUserSessions, type AuthUser } from "../auth/session.js";
import {
    userStore,
    USER_TIERS,
    ADMIN_USERS_EXPORT_MAX,
    type UserRole,
    type SubscriptionTier,
    type AdminUserQuery,
} from "./userStore.js";
import { systemSettings, validateSettingsPatch } from "./systemSettings.js";
import { auditLog, type AuditLogEntry } from "../security/auditLog.js";
import { pageViewTracker, extractClientIp } from "../security/pageViewTracker.js";
import { maintenanceTracker } from "./maintenanceTracker.js";
import {
    announcementsStore,
    ANNOUNCEMENT_KINDS,
    ANNOUNCEMENT_AUDIENCES,
    type AnnouncementInput,
} from "./announcements.js";
import {
    helpdeskStore,
    TICKET_STATUSES,
    TICKET_CATEGORIES,
    TICKET_PRIORITIES,
    REFUND_STATUSES,
    getRefundPayload,
    type TicketStatus,
    type TicketPriority,
    type RefundStatus,
    type RefundRequestPayload,
} from "../helpdesk/store.js";
import { defaultTokenTracker } from "../usage/tokenTracker.js";
import { billingStorage } from "../billing/storage.js";
import { getBankByCode } from "../billing/banks.js";
import { generateNapasQrString, generateQrImageUrl } from "../billing/napas.js";
import type { Order, Plan } from "../billing/types.js";
import { computeAnalytics, type AnalyticsJob, type DistributionItem } from "./analytics.js";
import { getConfig } from "../config.js";
import { db } from "../database/index.js";
import { createTTSClient } from "../pipeline/audioSysnthesis.js";
import { getLLMClientFactory } from "../llm/client.js";
import { videoScriptSchema, type videoScript } from "../llm/schema.js";
import type { IVideoQueue, JobUpdate } from "../queue/interfaces.js";
import { isJobVideoAvailable } from "../queue/jobVideo.js";
import {
    isAllowedContainer,
    getContainersStatus,
    streamDockerLogs,
    getDockerLogsSnapshot,
    ALLOWED_CONTAINERS,
    type AllowedContainer,
} from "./dockerLogs.js";

/**
 * Thông tin VietQR để quản trị quét trả tiền lại cho khách.
 *
 * Dựng từ chính số tài khoản + ngân hàng người dùng đã nhập và số tiền của đơn
 * hàng, nội dung chuyển khoản kèm mã ticket để khi tiền về còn đối soát được.
 * Trả `null` khi thiếu dữ liệu (không có gì để quét thì giao diện ẩn khối QR).
 */
function buildRefundQr(payload: RefundRequestPayload, ticketCode: string) {
    const bank = getBankByCode(payload.bankCode);
    if (!bank || !payload.bankAccount || !payload.amountVnd || payload.amountVnd <= 0) return null;

    // Nội dung chuyển khoản: không dấu, ngắn gọn — nhiều app ngân hàng cắt dấu.
    const memo = `HOAN TIEN ${ticketCode}`;

    return {
        bankCode: bank.code,
        bankName: bank.name,
        bankAccount: payload.bankAccount,
        amountVnd: payload.amountVnd,
        memo,
        image: generateQrImageUrl({
            bankCode: bank.code,
            bankAccount: payload.bankAccount,
            amount: payload.amountVnd,
            memo,
            accountName: payload.accountHolder || undefined,
        }),
        content: generateNapasQrString({
            bankBin: bank.bin,
            bankAccount: payload.bankAccount,
            amount: payload.amountVnd,
            memo,
        }),
    };
}

/**
 * Đọc `limit`/`page` từ query string của các danh sách quản trị.
 *
 * Theo quy ước: chỉ phân trang khi client thực sự gửi `limit`; nếu không thì giữ
 * nguyên hành vi cũ (không truyền thì danh sách dùng giới hạn mặc định của nó).
 */
function parseListPaging(query: any): { limit?: number; page: number; error?: string } {
    const limitProvided = query.limit !== undefined && query.limit !== "";
    let limit: number | undefined;
    if (limitProvided) {
        const parsed = parseInt(query.limit, 10);
        if (!Number.isFinite(parsed) || parsed < 1) {
            return { page: 1, error: "Tham số 'limit' không hợp lệ." };
        }
        limit = parsed;
    }

    let page = 1;
    if (query.page !== undefined && query.page !== "") {
        const parsedPage = parseInt(query.page, 10);
        if (!Number.isFinite(parsedPage) || parsedPage < 1) {
            return { page: 1, error: "Tham số 'page' không hợp lệ." };
        }
        page = parsedPage;
    }

    return { limit, page: limitProvided ? page : 1 };
}

/** Đọc khoảng thời gian `from`/`to` (ISO hoặc YYYY-MM-DD) từ query string. */
function parseDateRange(query: any): { from?: string; to?: string; error?: string } {
    const read = (value: any, label: string): { value?: string; error?: string } => {
        if (value === undefined || value === null || value === "") return {};
        if (typeof value !== "string") return { error: `Tham số '${label}' không hợp lệ.` };
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
            return { error: `Tham số '${label}' không phải thời gian hợp lệ.` };
        }
        return { value: parsed.toISOString() };
    };

    const from = read(query.from, "from");
    if (from.error) return { error: from.error };
    const to = read(query.to, "to");
    if (to.error) return { error: to.error };
    return { from: from.value, to: to.value };
}

async function verifyAdminUser(request: FastifyRequest): Promise<{ isAdmin: boolean; user?: AuthUser; error?: string }> {
    const user = await getCurrentUser(request);
    if (!user) {
        return { isAdmin: false, error: "Yêu cầu đăng nhập tài khoản quản trị." };
    }
    if (user.role !== "admin") {
        return { isAdmin: false, error: "Bạn không có quyền truy cập cổng Quản trị Super Admin." };
    }
    if (user.status === "banned") {
        return { isAdmin: false, error: "Tài khoản quản trị của bạn đã bị khóa." };
    }
    return { isAdmin: true, user };
}

/**
 * Ghi nhật ký cho một hành động quản trị, tự động kèm danh tính người thực hiện
 * (actor) và IP của họ.
 *
 * Trước đây mỗi nơi gọi `auditLog.record()` tự truyền thông tin người thực hiện vào
 * `details` (updatedBy/deletedBy/...) và KHÔNG nơi nào ghi IP, nên nhật ký thiếu hẳn
 * manh mối truy vết "ai làm, từ đâu".
 */
function auditAdminAction(
    request: FastifyRequest,
    check: { user?: AuthUser },
    entry: Omit<AuditLogEntry, "id" | "timestamp" | "actorId" | "actorEmail" | "ip">
): AuditLogEntry {
    return auditLog.record({
        ...entry,
        actorId: check.user?.id,
        actorEmail: check.user?.email,
        ip: extractClientIp(request),
    });
}

const SUPER_ADMIN_EMAIL = "khanh2k5xxx@gmail.com";
const SUPER_ADMIN_IDS = new Set([
    "00000000-0000-4000-a000-000000000001",
    "admin-khanh2k5xxx",
]);

/** Tài khoản Super Admin tối cao: không được xoá, hạ quyền hay khoá. */
function isSuperAdminAccount(target?: { id?: string; email?: string } | null): boolean {
    if (!target) return false;
    if (target.email && target.email.toLowerCase() === SUPER_ADMIN_EMAIL) return true;
    return Boolean(target.id && SUPER_ADMIN_IDS.has(target.id));
}

const USER_STATUSES = ["all", "active", "banned", "deleted"] as const;
const USER_ROLES = ["user", "admin"] as const;
/** Trạng thái hợp lệ của một bản ghi nhật ký kiểm toán. */
const AUDIT_LOG_STATUSES = ["success", "failure", "warning"];
/** Giới hạn cứng số bản ghi nhật ký mỗi trang. */
const AUDIT_LOGS_MAX_LIMIT = 500;
/** Trạng thái lọc hợp lệ của giao dịch chưa khớp đơn. */
const UNMATCHED_STATUSES = ["pending", "resolved", "refunded", "all"];
/** Loại nguồn hợp lệ của một bản ghi hoàn tiền. */
const REFUND_SOURCE_TYPES = ["unmatched", "duplicate", "refund_request"];
/**
 * Giới hạn mặc định của danh sách unmatched/duplicate khi client KHÔNG gửi `limit`
 * (giữ nguyên hành vi cũ: `LIMIT 100`). Phải khớp hằng số trong `billing/storage.ts`.
 */
const ADMIN_PAYMENTS_DEFAULT_LIMIT = 100;
/** Giới hạn độ dài mật khẩu admin đặt hộ (khớp /api/auth/reset-password). */
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;

function validatePasswordStrength(password: string): string | null {
    if (password.length < PASSWORD_MIN_LENGTH) {
        return `Mật khẩu phải có ít nhất ${PASSWORD_MIN_LENGTH} ký tự.`;
    }
    if (password.length > PASSWORD_MAX_LENGTH) {
        return `Mật khẩu tối đa ${PASSWORD_MAX_LENGTH} ký tự.`;
    }
    if (!/[A-Za-z]/.test(password)) {
        return "Mật khẩu phải có ít nhất 1 chữ cái.";
    }
    if (!/[0-9]/.test(password)) {
        return "Mật khẩu phải có ít nhất 1 chữ số.";
    }
    return null;
}

/**
 * Sinh mật khẩu tạm ngẫu nhiên mạnh (14 ký tự, luôn có chữ và số).
 *
 * Trước đây hệ thống luôn đặt mật khẩu về "12345678" và trả về nguyên văn — ai
 * biết quy tắc này đều có thể đăng nhập vào bất kỳ tài khoản nào vừa bị admin
 * đặt lại mật khẩu.
 */
function generateTemporaryPassword(length = 14): string {
    const letters = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
    const digits = "23456789";
    const all = letters + digits;
    const chars: string[] = [letters[randomInt(letters.length)], digits[randomInt(digits.length)]];
    while (chars.length < length) {
        chars.push(all[randomInt(all.length)]);
    }
    for (let i = chars.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join("");
}

/** Bọc một giá trị thành ô CSV an toàn (escape dấu " và bọc trong ngoặc kép). */
function csvCell(value: unknown): string {
    const str = value === null || value === undefined ? "" : String(value);
    return `"${str.replace(/"/g, '""')}"`;
}

function buildCsv(headers: string[], rows: unknown[][]): string {
    const lines = [headers.map(csvCell).join(",")];
    for (const row of rows) {
        lines.push(row.map(csvCell).join(","));
    }
    // BOM giúp Excel đọc đúng UTF-8 (tên/gói cước tiếng Việt).
    return `\ufeff${lines.join("\r\n")}\r\n`;
}

/**
 * Chuẩn hoá + validate tham số lọc danh sách người dùng.
 * Dùng chung cho cả `GET /api/admin/users` và `GET /api/admin/users/export`.
 */
function parseAdminUserQuery(query: any): { error?: string; params?: AdminUserQuery; wantsAll?: boolean } {
    const raw = query || {};

    const statusFilter = String(raw.status ?? "all");
    if (!USER_STATUSES.includes(statusFilter as any)) {
        return { error: `Trạng thái người dùng không hợp lệ. Chỉ chấp nhận: ${USER_STATUSES.join(", ")}.` };
    }

    const roleFilter = raw.role ? String(raw.role) : "all";
    if (roleFilter !== "all" && !USER_ROLES.includes(roleFilter as any)) {
        return { error: "Vai trò không hợp lệ. Chỉ chấp nhận: user, admin." };
    }

    const tierFilter = raw.tier ? String(raw.tier) : "all";
    if (tierFilter !== "all" && !USER_TIERS.includes(tierFilter as SubscriptionTier)) {
        return { error: `Gói cước không hợp lệ. Chỉ chấp nhận: ${USER_TIERS.join(", ")}.` };
    }

    const limitParam = raw.limit;
    // Không truyền `limit` ⇒ giữ hành vi cũ (trả về toàn bộ kết quả khớp bộ lọc).
    // Giao diện quản trị luôn gửi `limit` (mặc định 25) nên vẫn được phân trang
    // phía server; nhờ vậy các client cũ không bị đổi hành vi.
    const wantsAll =
        limitParam === undefined || limitParam === null || limitParam === "" ||
        limitParam === "all" || limitParam === "0";
    const requestedLimit = Number.parseInt(limitParam, 10);
    const requestedPage = Number.parseInt(raw.page, 10);

    const ids = Array.isArray(raw.ids)
        ? raw.ids.map((v: unknown) => String(v)).filter(Boolean).slice(0, ADMIN_USERS_EXPORT_MAX)
        : undefined;

    const includeDeleted =
        statusFilter === "all" || statusFilter === "deleted" || raw.includeDeleted === "true";

    return {
        wantsAll,
        params: {
            search: String(raw.search ?? "").trim(),
            role: roleFilter,
            tier: tierFilter,
            status: statusFilter,
            includeDeleted,
            ids,
            sortBy: String(raw.sortBy ?? "createdAt"),
            sortOrder: raw.sortOrder === "asc" ? "asc" : "desc",
            page: Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1,
            limit: wantsAll
                ? ADMIN_USERS_EXPORT_MAX
                : Number.isFinite(requestedLimit) && requestedLimit > 0
                  ? requestedLimit
                  : 25,
        },
    };
}

/**
 * Kiểm tra + chuẩn hoá dữ liệu tạo/cập nhật một thông báo toàn hệ thống.
 *
 * `partial = true` dùng cho PATCH: chỉ kiểm tra và trả về những trường thực sự
 * được gửi lên, tránh vô tình ghi đè các trường khác bằng giá trị mặc định.
 */
function validateAnnouncementPayload(
    raw: any,
    partial = false
): { error?: string; value?: Partial<AnnouncementInput> } {
    if (!raw || typeof raw !== "object") {
        return { error: "Dữ liệu thông báo không hợp lệ." };
    }

    const has = (key: string) => raw[key] !== undefined;
    const value: Partial<AnnouncementInput> = {};

    if (!partial || has("title")) {
        const title = String(raw.title ?? "").trim();
        if (!title) return { error: "Tiêu đề không được để trống." };
        if (title.length > 160) return { error: "Tiêu đề tối đa 160 ký tự." };
        value.title = title;
    }

    if (!partial || has("body")) {
        const body = String(raw.body ?? "").trim();
        if (!body) return { error: "Nội dung không được để trống." };
        if (body.length > 2000) return { error: "Nội dung tối đa 2000 ký tự." };
        value.body = body;
    }

    if (!partial || has("kind")) {
        const kind = raw.kind ?? "info";
        if (!ANNOUNCEMENT_KINDS.includes(kind)) {
            return { error: `Loại thông báo không hợp lệ. Chỉ chấp nhận: ${ANNOUNCEMENT_KINDS.join(", ")}.` };
        }
        value.kind = kind;
    }

    if (!partial || has("audience")) {
        const audience = raw.audience ?? "all";
        if (!ANNOUNCEMENT_AUDIENCES.includes(audience)) {
            return { error: `Đối tượng hiển thị không hợp lệ. Chỉ chấp nhận: ${ANNOUNCEMENT_AUDIENCES.join(", ")}.` };
        }
        value.audience = audience;
    }

    if (!partial || has("priority")) {
        const priority = raw.priority === undefined ? 0 : Number(raw.priority);
        if (!Number.isInteger(priority) || priority < 0 || priority > 1000) {
            return { error: "Mức ưu tiên phải là số nguyên trong khoảng 0 – 1000." };
        }
        value.priority = priority;
    }

    if (!partial || has("isActive")) {
        value.isActive = raw.isActive === undefined ? true : Boolean(raw.isActive);
    }
    if (!partial || has("dismissible")) {
        value.dismissible = raw.dismissible === undefined ? true : Boolean(raw.dismissible);
    }

    if (!partial || has("linkUrl")) {
        const linkUrl =
            raw.linkUrl === undefined || raw.linkUrl === null || raw.linkUrl === ""
                ? null
                : String(raw.linkUrl).trim();
        if (linkUrl && !/^(https?:\/\/|\/)/i.test(linkUrl)) {
            return { error: "Liên kết phải là URL http(s) hoặc đường dẫn nội bộ bắt đầu bằng '/'." };
        }
        if (linkUrl && linkUrl.length > 500) return { error: "Liên kết tối đa 500 ký tự." };
        value.linkUrl = linkUrl;
    }

    if (!partial || has("linkLabel")) {
        const linkLabel =
            raw.linkLabel === undefined || raw.linkLabel === null || raw.linkLabel === ""
                ? null
                : String(raw.linkLabel).trim();
        if (linkLabel && linkLabel.length > 80) return { error: "Nhãn liên kết tối đa 80 ký tự." };
        value.linkLabel = linkLabel;
    }

    const parseDate = (input: any): { ok: boolean; value: string | null } => {
        if (input === undefined || input === null || input === "") return { ok: true, value: null };
        const parsed = new Date(input);
        if (Number.isNaN(parsed.getTime())) return { ok: false, value: null };
        return { ok: true, value: parsed.toISOString() };
    };

    if (!partial || has("startsAt")) {
        const parsed = parseDate(raw.startsAt);
        if (!parsed.ok) return { error: "Thời gian bắt đầu không hợp lệ." };
        value.startsAt = parsed.value;
    }
    if (!partial || has("endsAt")) {
        const parsed = parseDate(raw.endsAt);
        if (!parsed.ok) return { error: "Thời gian kết thúc không hợp lệ." };
        value.endsAt = parsed.value;
    }

    // Chỉ kiểm tra khoảng thời gian khi cả hai mốc đều được cung cấp trong payload.
    if (value.startsAt && value.endsAt) {
        if (new Date(value.startsAt).getTime() >= new Date(value.endsAt).getTime()) {
            return { error: "Thời gian kết thúc phải sau thời gian bắt đầu." };
        }
    }

    return { value };
}

export async function adminRoutes(app: FastifyInstance, opts?: { queue?: IVideoQueue }): Promise<void> {
    const getQueue = (): IVideoQueue | undefined => {
        return opts?.queue || (app as any).queue;
    };

    // -------------------------------------------------------------
    // 1. STATS & ANALYTICS & SYSTEM HEALTH
    // -------------------------------------------------------------
    app.get("/api/admin/stats", async (request: FastifyRequest, reply: FastifyReply) => {
        const check = await verifyAdminUser(request);
        if (!check.isAdmin) {
            reply.status(403);
            return { error: check.error };
        }

        const users = await userStore.listUsers();
        const queue = getQueue();
        const jobs = queue ? await queue.getJobs() : [];
        let orders: any[] = [];
        try {
            orders = await billingStorage.listOrders();
        } catch {
            orders = [];
        }
        const tokenSummary = defaultTokenTracker.getSummary();
        const config = getConfig();

        const paidOrders = orders.filter((o) => o.status === "paid");
        const totalRevenueVnd = paidOrders.reduce((sum, o) => sum + o.amount_vnd, 0);

        // Revenue today
        const todayStr = new Date().toISOString().slice(0, 10);
        const todayRevenueVnd = paidOrders
            .filter((o) => (o.paid_at || o.created_at).slice(0, 10) === todayStr)
            .reduce((sum, o) => sum + o.amount_vnd, 0);

        const activeJobs = jobs.filter((j) => j.status === "running" || j.status === "queued").length;
        const completedJobs = jobs.filter((j) => j.status === "completed").length;
        const failedJobs = jobs.filter((j) => j.status === "failed").length;
        const successRate = jobs.length > 0 ? Math.round((completedJobs / (completedJobs + failedJobs || 1)) * 100) : 100;

        const tiersCount = {
            free: users.filter((u) => u.tier === "free").length,
            creator: users.filter((u) => u.tier === "creator").length,
            pro: users.filter((u) => u.tier === "pro").length,
            max: users.filter((u) => u.tier === "max").length,
            enterprise: users.filter((u) => u.tier === "enterprise").length,
        };

        const statusCount = {
            active: users.filter((u) => u.status !== "banned").length,
            banned: users.filter((u) => u.status === "banned").length,
        };

        // System Health Metrics
        const mem = process.memoryUsage();
        const memoryMetrics = {
            rssMb: Math.round(mem.rss / 1024 / 1024),
            heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
            heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
            externalMb: Math.round(mem.external / 1024 / 1024),
        };

        let dbHealthy = false;
        if (config.DATABASE_URL) {
            try {
                await db.query("SELECT 1");
                dbHealthy = true;
            } catch {
                dbHealthy = false;
            }
        }

        const viewStats = pageViewTracker.getStats();
        const maintenanceStats = maintenanceTracker.getStats();

        const statsObj = {
            totalUsers: users.length,
            tiersCount,
            statusCount,
            jobs: {
                total: jobs.length,
                active: activeJobs,
                completed: completedJobs,
                failed: failedJobs,
                successRate,
            },
            views: {
                total: viewStats.totalViews,
                today: viewStats.todayViews,
                uniqueVisitors: viewStats.uniqueVisitors,
                todayVisitors: viewStats.todayVisitors,
            },
            maintenance: {
                total: maintenanceStats.totalLogs,
                today: maintenanceStats.todayLogs,
                uniqueIps: maintenanceStats.uniqueIps,
            },
            revenue: {
                totalVnd: totalRevenueVnd,
                todayVnd: todayRevenueVnd,
                paidOrders: paidOrders.length,
                paidOrdersCount: paidOrders.length,
                pendingOrdersCount: orders.filter((o) => o.status === "pending").length,
            },
            tokens: tokenSummary,
            health: {
                uptimeSec: Math.round(process.uptime()),
                nodeVersion: process.version,
                platform: process.platform,
                memory: memoryMetrics,
                postgresConnected: dbHealthy,
                db: { connected: dbHealthy, urlConfigured: Boolean(config.DATABASE_URL) },
                redis: { queueType: config.QUEUE_TYPE },
            },
        };

        return {
            stats: statsObj,
            users: {
                total: users.length,
                ...statusCount,
                tiers: tiersCount,
            },
            jobs: statsObj.jobs,
            revenue: statsObj.revenue,
            tokens: tokenSummary,
            system: {
                uptimeSec: Math.round(process.uptime()),
                memory: memoryMetrics,
                db: { connected: dbHealthy, urlConfigured: Boolean(config.DATABASE_URL) },
                redis: { queueType: config.QUEUE_TYPE },
                nodeVersion: process.version,
            },
        };
    });

    // -------------------------------------------------------------
    // 1b. DASHBOARD ANALYTICS (SaaS metrics)
    // -------------------------------------------------------------
    app.get("/api/admin/analytics", async (request: FastifyRequest, reply: FastifyReply) => {
        const check = await verifyAdminUser(request);
        if (!check.isAdmin) {
            reply.status(403);
            return { error: check.error };
        }

        const query = (request.query || {}) as { period?: string };
        const period = query.period;

        let users: Awaited<ReturnType<typeof userStore.listUsers>> = [];
        try {
            users = await userStore.listUsers();
        } catch {
            users = [];
        }

        let orders: Order[] = [];
        try {
            orders = await billingStorage.listOrders();
        } catch {
            orders = [];
        }

        let plans: Plan[] = [];
        try {
            plans = await billingStorage.getPlans();
        } catch {
            plans = [];
        }

        const queue = getQueue();
        let jobs: AnalyticsJob[] = [];
        try {
            if (queue) {
                const records = await queue.getJobs();
                jobs = records.map((record) => ({ status: record.status, request: record.request }));
            }
        } catch {
            jobs = [];
        }

        let topPages: DistributionItem[] = [];
        try {
            topPages = pageViewTracker.getStats(period || "30d").topPages.map((page) => ({
                name: page.path,
                count: page.count,
                percentage: page.percentage,
            }));
        } catch {
            topPages = [];
        }

        return computeAnalytics({ users, orders, plans, jobs, topPages, period });
    });

    // -------------------------------------------------------------
    // 2. USER MANAGEMENT
    // -------------------------------------------------------------
    app.get("/api/admin/users", async (request: FastifyRequest, reply: FastifyReply) => {
        const check = await verifyAdminUser(request);
        if (!check.isAdmin) {
            reply.status(403);
            return { error: check.error };
        }

        const parsed = parseAdminUserQuery(request.query);
        if (parsed.error || !parsed.params) {
            reply.status(400);
            return { error: parsed.error };
        }

        let users: any[] = [];
        let total = 0;
        try {
            const result = await userStore.listUsersForAdmin(parsed.params, {
                maxLimit: parsed.wantsAll ? ADMIN_USERS_EXPORT_MAX : undefined,
            });
            users = result.users;
            total = result.total;
        } catch (err: any) {
            request.log?.warn?.({ err: err?.message }, "[Admin] Không tải được danh sách người dùng");
        }

        // Số lượng video job chỉ cần cho các dòng đang hiển thị (queue nằm trong bộ nhớ).
        const queue = getQueue();
        const allJobs = queue ? await queue.getJobs() : [];

        const jobCountByUser = new Map<string, number>();
        for (const job of allJobs) {
            const uid = (job as any).userId;
            if (uid) {
                jobCountByUser.set(uid, (jobCountByUser.get(uid) || 0) + 1);
            }
        }

        const page = parsed.params.page || 1;
        const limit = parsed.params.limit || 25;

        return {
            users: users.map((u) => ({ ...u, jobCount: jobCountByUser.get(u.id) || 0 })),
            total,
            page: parsed.wantsAll ? 1 : page,
            limit: parsed.wantsAll ? total : limit,
        };
    });

    /**
     * Xuất CSV danh sách người dùng theo đúng bộ lọc đang áp dụng.
     *
     * Trước đây nút "Xuất CSV" ở frontend chỉ xuất các dòng đang có trên trang hiện
     * tại (tối đa `limit` bản ghi), nên xuất thiếu dữ liệu. Nay server xuất toàn bộ
     * kết quả khớp bộ lọc (hoặc đúng danh sách `ids` đã chọn).
     */
    app.get("/api/admin/users/export", async (request: FastifyRequest, reply: FastifyReply) => {
        const check = await verifyAdminUser(request);
        if (!check.isAdmin) {
            reply.status(403);
            return { error: check.error };
        }

        const parsed = parseAdminUserQuery(request.query);
        if (parsed.error || !parsed.params) {
            reply.status(400);
            return { error: parsed.error };
        }

        let users: any[] = [];
        try {
            const result = await userStore.listUsersForAdmin(
                { ...parsed.params, page: 1, limit: ADMIN_USERS_EXPORT_MAX },
                { maxLimit: ADMIN_USERS_EXPORT_MAX }
            );
            users = result.users;
        } catch (err: any) {
            request.log?.error?.({ err: err?.message }, "[Admin] Xuất CSV người dùng thất bại");
            reply.status(500);
            return { error: "Không xuất được danh sách người dùng." };
        }

        const queue = getQueue();
        const allJobs = queue ? await queue.getJobs() : [];
        const jobCountByUser = new Map<string, number>();
        for (const job of allJobs) {
            const uid = (job as any).userId;
            if (uid) jobCountByUser.set(uid, (jobCountByUser.get(uid) || 0) + 1);
        }

        const csv = buildCsv(
            [
                "ID",
                "Username",
                "Email",
                "Role",
                "Tier",
                "Credits",
                "TotalCredits",
                "Status",
                "DeletedAt",
                "PlanExpiresAt",
                "CreatedAt",
                "LastLoginAt",
                "LastLoginIp",
                "SignupIp",
                "Location",
                "ISP",
                "JobCount",
            ],
            users.map((u) => [
                u.id,
                u.username,
                u.email,
                u.role,
                u.tier,
                u.credits,
                u.totalCredits,
                u.deletedAt ? "deleted" : u.status,
                u.deletedAt || "",
                u.planExpiresAt || "",
                u.createdAt,
                u.lastLoginAt || "",
                u.lastLoginIp || "",
                u.signupIp || "",
                u.lastLocation || "",
                u.lastIsp || "",
                jobCountByUser.get(u.id) || 0,
            ])
        );

        auditAdminAction(request, check, {
            action: "admin.users_exported",
            status: "success",
            details: {
                exportedBy: check.user?.email,
                rowCount: users.length,
                filters: {
                    search: parsed.params.search || undefined,
                    status: parsed.params.status,
                    role: parsed.params.role,
                    tier: parsed.params.tier,
                    ids: parsed.params.ids?.length || 0,
                },
            },
        });

        const filename = `vidtml_users_${new Date().toISOString().slice(0, 10)}.csv`;
        reply
            .header("Content-Type", "text/csv; charset=utf-8")
            .header("Content-Disposition", `attachment; filename="${filename}"`);
        return csv;
    });

    app.post("/api/admin/users/bulk", async (request: FastifyRequest, reply: FastifyReply) => {
        const check = await verifyAdminUser(request);
        if (!check.isAdmin) {
            reply.status(403);
            return { error: check.error };
        }

        const body = (request.body as any) || {};
        const userIds: string[] = Array.isArray(body.userIds) ? body.userIds : [];
        const action: string = body.action;

        if (!userIds.length || userIds.length > 500 || !["activate", "suspend", "delete", "hard-delete"].includes(action)) {
            reply.status(400);
            return { error: "Danh sách userIds phải có từ 1 đến 500 phần tử và action phải hợp lệ." };
        }

        let processedCount = 0;
        const skippedIds: string[] = [];

        for (const id of userIds) {
            const target = await userStore.findById(id);
            if (!target) {
                skippedIds.push(id);
                continue;
            }

            // Protect Super Admin
            if (isSuperAdminAccount(target) && (action === "suspend" || action === "delete" || action === "hard-delete")) {
                skippedIds.push(id);
                continue;
            }

            try {
                if (action === "activate") {
                    await userStore.setUserStatus(id, "active");
                    if (target.deletedAt) {
                        await userStore.restoreUser(id);
                    }
                    processedCount++;
                } else if (action === "suspend") {
                    await userStore.setUserStatus(id, "banned");
                    processedCount++;
                } else if (action === "delete") {
                    await userStore.deleteUser(id, { soft: true });
                    processedCount++;
                } else if (action === "hard-delete") {
                    await userStore.deleteUser(id, { soft: false });
                    processedCount++;
                }
            } catch {
                skippedIds.push(id);
            }
        }

        auditAdminAction(request, check, {
            action: "admin.bulk_users_action",
            status: "success",
            details: {
                performedBy: check.user?.email,
                action,
                totalRequested: userIds.length,
                processedCount,
                skippedCount: skippedIds.length,
            },
        });

        return {
            success: true,
            action,
            count: processedCount,
            skipped: skippedIds.length,
        };
    });

    app.post("/api/admin/users/:userId/reset-password", async (request: FastifyRequest<{ Params: { userId: string } }>, reply: FastifyReply) => {
        const check = await verifyAdminUser(request);
        if (!check.isAdmin) {
            reply.status(403);
            return { error: check.error };
        }

        const { userId } = request.params;
        const body = (request.body as any) || {};
        const target = await userStore.findById(userId);

        if (!target) {
            reply.status(404);
            return { error: "Không tìm thấy người dùng." };
        }

        if (target.provider === "google") {
            reply.status(400);
            return {
                error: "Tài khoản này đăng nhập bằng Google nên không có mật khẩu cục bộ để đặt lại.",
            };
        }

        const config = getConfig();

        // Validate mật khẩu mới (nếu admin tự nhập) trước khi kiểm tra hạ tầng.
        let newPassword: string;
        let generated = false;
        if (body.newPassword !== undefined && body.newPassword !== null && String(body.newPassword) !== "") {
            const candidate = String(body.newPassword);
            const strengthError = validatePasswordStrength(candidate);
            if (strengthError) {
                reply.status(400);
                return { error: strengthError };
            }
            newPassword = candidate;
        } else {
            newPassword = generateTemporaryPassword();
            generated = true;
        }

        if (!config.DATABASE_URL) {
            reply.status(503);
            return { error: "Không thể đặt lại mật khẩu: hệ thống chưa cấu hình cơ sở dữ liệu." };
        }

        const passwordHash = await bcrypt.hash(newPassword, 12);
        await db.query("UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2", [passwordHash, userId]);

        // Mật khẩu mới phải có hiệu lực ngay, kể cả với phiên đang mở trước đó.
        const revokedSessions = await revokeUserSessions(userId);

        auditAdminAction(request, check, {
            action: "admin.user_password_reset",
            userId,
            userEmail: target.email,
            status: "warning",
            details: {
                resetBy: check.user?.email,
                provider: target.provider,
                generated,
                revokedSessions,
            },
        });

        return {
            success: true,
            userId,
            provider: target.provider,
            generated,
            revokedSessions,
            // Chỉ trả mật khẩu tạm khi hệ thống tự sinh, để admin gửi cho người dùng.
            temporaryPassword: generated ? newPassword : undefined,
            message: generated
                ? `Đã đặt lại mật khẩu cho ${target.email} bằng mật khẩu tạm. Hãy gửi mật khẩu này cho người dùng và yêu cầu họ đổi ngay sau khi đăng nhập.`
                : `Đã cập nhật mật khẩu mới cho ${target.email}.`,
        };
    });

    app.patch("/api/admin/users/:userId", async (request: FastifyRequest<{ Params: { userId: string } }>, reply: FastifyReply) => {
        const check = await verifyAdminUser(request);
        if (!check.isAdmin) {
            reply.status(403);
            return { error: check.error };
        }

        const { userId } = request.params;
        const body = (request.body as any) || {};
        const target = await userStore.findById(userId);

        if (!target) {
            reply.status(404);
            return { error: "Không tìm thấy người dùng." };
        }

        // ---- 1. Validate dữ liệu đầu vào (trước đây mọi giá trị đều được ép kiểu
        //         bằng `as`, nên có thể ghi vào DB một tier/role tuỳ ý) ----
        if (body.tier !== undefined && !USER_TIERS.includes(body.tier as SubscriptionTier)) {
            reply.status(400);
            return { error: `Gói cước không hợp lệ. Chỉ chấp nhận: ${USER_TIERS.join(", ")}.` };
        }
        if (body.role !== undefined && !USER_ROLES.includes(body.role as UserRole)) {
            reply.status(400);
            return { error: "Vai trò không hợp lệ. Chỉ chấp nhận: user, admin." };
        }
        if (body.status !== undefined && body.status !== "active" && body.status !== "banned") {
            reply.status(400);
            return { error: "Trạng thái không hợp lệ. Chỉ chấp nhận: active, banned." };
        }
        if (
            body.credits !== undefined &&
            (!Number.isInteger(body.credits) || body.credits < 0 || body.credits > 1000000)
        ) {
            reply.status(400);
            return { error: "Credits phải là số nguyên trong khoảng 0 - 1.000.000." };
        }
        if (
            body.creditsDelta !== undefined &&
            (!Number.isInteger(body.creditsDelta) || Math.abs(body.creditsDelta) > 1000000)
        ) {
            reply.status(400);
            return { error: "creditsDelta phải là số nguyên trong khoảng -1.000.000 - 1.000.000." };
        }
        if (
            body.durationDays !== undefined &&
            (!Number.isInteger(body.durationDays) || body.durationDays < 1 || body.durationDays > 3650)
        ) {
            reply.status(400);
            return { error: "Thời hạn gói phải là số nguyên từ 1 đến 3650 ngày." };
        }

        // ---- 2. Bảo vệ Super Admin và chính mình: không hạ quyền / khoá ----
        const isSuperAdmin = isSuperAdminAccount(target);
        const isSelf = Boolean(check.user?.id && check.user.id === target.id);

        if (isSuperAdmin || isSelf) {
            const who = isSuperAdmin ? "Super Admin tối cao" : "chính mình";
            if (body.role !== undefined && body.role !== "admin") {
                reply.status(400);
                return { error: `Không thể hạ quyền ${who}.` };
            }
            if (body.status === "banned") {
                reply.status(400);
                return { error: `Không thể khoá tài khoản ${who}.` };
            }
        }

        const changes: Record<string, unknown> = {};

        // ---- 3. Chỉ đổi gói khi tier thực sự khác, và chỉ gia hạn khi `durationDays`
        //         được gửi tường minh. Trước đây màn quản trị luôn gửi kèm
        //         tier + durationDays nên chỉ sửa credits cũng reset hạn gói về now+30 ngày. ----
        if (body.tier !== undefined && body.tier !== target.tier) {
            const durationDays = body.durationDays !== undefined ? body.durationDays : 30;
            await userStore.updateTier(userId, body.tier as SubscriptionTier, durationDays);
            changes.tier = body.tier;
            changes.durationDays = durationDays;
        } else if (body.durationDays !== undefined) {
            await userStore.updateTier(userId, target.tier, body.durationDays);
            changes.durationDays = body.durationDays;
        }

        if (typeof body.credits === "number" && body.credits !== target.credits) {
            await userStore.setCredits(userId, body.credits);
            changes.credits = body.credits;
        } else if (typeof body.creditsDelta === "number" && body.creditsDelta !== 0) {
            if (body.creditsDelta > 0) {
                await userStore.addCredits(userId, body.creditsDelta);
            } else {
                await userStore.deductCredits(userId, Math.abs(body.creditsDelta));
            }
            changes.creditsDelta = body.creditsDelta;
        }

        if (body.role !== undefined && body.role !== target.role) {
            await userStore.updateUserRole(userId, body.role as UserRole);
            changes.role = body.role;
        }

        if (
            (body.status === "active" || body.status === "banned") &&
            body.status !== target.status
        ) {
            await userStore.setUserStatus(userId, body.status);
            changes.status = body.status;
        }

        if (Object.keys(changes).length > 0) {
            auditAdminAction(request, check, {
                action: "admin.user_update",
                userId,
                userEmail: target.email,
                status: "success",
                details: { updatedBy: check.user?.email, changes },
            });
        }

        const updated = await userStore.findById(userId);
        return { success: true, user: updated, changes };
    });

    app.delete("/api/admin/users/:userId", async (request: FastifyRequest<{ Params: { userId: string }; Querystring: { hard?: string } }>, reply: FastifyReply) => {
        const check = await verifyAdminUser(request);
        if (!check.isAdmin) {
            reply.status(403);
            return { error: check.error };
        }

        const { userId } = request.params;
        const isHardDelete = request.query.hard === "true";
        const target = await userStore.findById(userId);

        if (!target) {
            reply.status(404);
            return { error: "Không tìm thấy người dùng cần xóa." };
        }

        if (check.user?.id && check.user.id === target.id) {
            reply.status(400);
            return { error: "Không thể tự xóa tài khoản quản trị của chính mình." };
        }

        try {
            await userStore.deleteUser(userId, { soft: !isHardDelete });
            auditAdminAction(request, check, {
                action: isHardDelete ? "admin.user_hard_deleted" : "admin.user_soft_deleted",
                userId,
                userEmail: target.email,
                status: "warning",
                details: { deletedBy: check.user?.email, userName: target.name, hard: isHardDelete },
            });
            return {
                success: true,
                message: isHardDelete ? `Đã xóa vĩnh viễn người dùng ${target.email}` : `Đã xóa mềm (vô hiệu hóa) người dùng ${target.email}`,
                soft: !isHardDelete,
            };
        } catch (err: any) {
            reply.status(400);
            return { error: err.message || "Không thể xóa người dùng này." };
        }
    });

    app.post("/api/admin/users/:userId/restore", async (request: FastifyRequest<{ Params: { userId: string } }>, reply: FastifyReply) => {
        const check = await verifyAdminUser(request);
        if (!check.isAdmin) {
            reply.status(403);
            return { error: check.error };
        }

        const { userId } = request.params;
        const target = await userStore.findById(userId);

        if (!target) {
            reply.status(404);
            return { error: "Không tìm thấy người dùng cần khôi phục." };
        }

        try {
            const restored = await userStore.restoreUser(userId);
            auditAdminAction(request, check, {
                action: "admin.user_restored",
                userId,
                userEmail: target.email,
                status: "success",
                details: { restoredBy: check.user?.email },
            });
            return { success: true, message: `Đã khôi phục người dùng ${target.email}`, user: restored };
        } catch (err: any) {
            reply.status(400);
            return { error: err.message || "Lỗi khôi phục người dùng." };
        }
    });

    app.get("/api/admin/users/:userId/login-logs", async (request: FastifyRequest<{ Params: { userId: string }; Querystring: { limit?: string } }>, reply: FastifyReply) => {
        const check = await verifyAdminUser(request);
        if (!check.isAdmin) {
            reply.status(403);
            return { error: check.error };
        }

        const { userId } = request.params;
        const rawLimit = Number.parseInt(request.query.limit || "50", 10);
        const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 50;

        const target = await userStore.findById(userId);
        if (!target) {
            reply.status(404);
            return { error: "Không tìm thấy người dùng." };
        }

        const logs = await userStore.getUserLoginLogs(userId, limit);

        return { logs, total: logs.length };
    });

    app.get("/api/admin/users/:userId/jobs", async (request: FastifyRequest<{ Params: { userId: string } }>, reply: FastifyReply) => {
        const check = await verifyAdminUser(request);
        if (!check.isAdmin) {
            reply.status(403);
            return { error: check.error };
        }

        const { userId } = request.params;
        const queue = getQueue();
        const allJobs = queue ? await queue.getJobs() : [];
        const userJobs = allJobs
            .filter((j: any) => j.userId === userId || j.data?.userId === userId)
            .map((j: any) => ({
                id: j.jobId,
                jobId: j.jobId,
                status: j.status,
                createdAt: j.createdAt,
                updatedAt: j.updatedAt,
                prompt: j.request?.prompt || 'Video generation',
                progress: j.progress,
                error: j.error,
                durationSec: j.result?.durationSec,
            }));

        return { jobs: userJobs, total: userJobs.length };
    });

    // -------------------------------------------------------------
    // 3. JOBS & RENDERING PIPELINE MANAGEMENT
    // -------------------------------------------------------------
    /** Các trạng thái job hợp lệ cho bộ lọc của cổng quản trị. */
    const JOB_STATUSES = ["all", "queued", "running", "completed", "failed", "qa_failed", "cancelled"];
    /** Trạng thái đã kết thúc — không thể hủy, nhưng có thể chạy lại. */
    const JOB_FINISHED_STATUSES = ["completed", "failed", "qa_failed", "cancelled"];
    const JOB_ACTIVE_STATUSES = ["queued", "running"];
    /** Chỉ những trạng thái thất bại/bị hủy mới được phép chạy lại. */
    const JOB_RETRYABLE_STATUSES = ["failed", "qa_failed", "cancelled"];

    app.get("/api/admin/jobs", async (request: FastifyRequest, reply: FastifyReply) => {
        const check = await verifyAdminUser(request);
        if (!check.isAdmin) {
            reply.status(403);
            return { error: check.error };
        }

        const query = (request.query as any) || {};
        const search = String(query.search || "").trim().toLowerCase();
        const statusFilter = String(query.status || "all");
        if (!JOB_STATUSES.includes(statusFilter)) {
            reply.status(400);
            return { error: `Trạng thái không hợp lệ. Chỉ chấp nhận: ${JOB_STATUSES.join(", ")}` };
        }

        const queue = getQueue();
        let allJobs = queue ? await queue.getJobs() : [];

        if (statusFilter !== "all") {
            allJobs = allJobs.filter((j) => j.status === statusFilter);
        }

        if (search) {
            // Tìm theo email/username người tạo cần tra ID trước (dùng chỉ mục users),
            // thay vì nạp toàn bộ bảng người dùng như trước.
            const matchedIds = new Set(await userStore.findIdsBySearch(search));
            allJobs = allJobs.filter(
                (j) =>
                    j.jobId.toLowerCase().includes(search) ||
                    (j.request?.prompt || "").toLowerCase().includes(search) ||
                    Boolean(j.userId && matchedIds.has(j.userId))
            );
        }

        allJobs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        // Chỉ phân trang khi client gửi `limit` — giữ nguyên hành vi cũ (trả hết) cho
        // các client/test chưa truyền tham số này.
        const total = allJobs.length;
        const wantsLimit = query.limit !== undefined && query.limit !== "";
        let page = 1;
        let limit = total;
        if (wantsLimit) {
            const rawLimit = Number(query.limit);
            limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 200) : 25;
            const rawPage = Number(query.page);
            page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;
        }
        const start = wantsLimit ? (page - 1) * limit : 0;
        const pageJobs = wantsLimit ? allJobs.slice(start, start + limit) : allJobs;

        // Tra email chỉ cho các job thực sự trả về (một truy vấn duy nhất).
        const emailById = await userStore.findEmailsByIds(pageJobs.map((j) => j.userId).filter(Boolean) as string[]);

        const enrichedJobs = pageJobs.map((j: any) => ({
            id: j.jobId,
            jobId: j.jobId,
            status: j.status,
            createdAt: j.createdAt,
            updatedAt: j.updatedAt,
            topic: j.request?.prompt,
            aspectRatio: j.request?.aspectRatio,
            durationSec: j.result?.durationSec,
            style: j.request?.style,
            voice: j.request?.voice,
            ttsProvider: j.request?.ttsProvider,
            error: j.error,
            userId: j.userId,
            userEmail: j.userId ? emailById.get(j.userId) || "Unknown" : "Anonymous",
            progress: j.progress,
            qaStatus: j.qaStatus ?? j.result?.qaStatus,
            degraded: Boolean(j.qaReport?.degraded ?? j.result?.qaReport?.degraded),
            hasVideo: Boolean(j.result?.videoPath || j.result?.mp4Path),
            // `hasVideo` chỉ nói job từng render ra video; `videoAvailable` nói tệp
            // còn thật trên máy chủ này hay không (tệp có thể đã bị dọn khỏi tmp,
            // hoặc job được render ở máy khác). Giao diện chỉ nên mời xem khi tệp
            // thực sự phục vụ được.
            videoAvailable: isJobVideoAvailable(j),
            hasHtml: Boolean(j.result?.finalHtmlPath),
        }));

        return { jobs: enrichedJobs, total, page, limit };
    });

    app.get("/api/admin/jobs/:jobId", async (request: FastifyRequest<{ Params: { jobId: string } }>, reply: FastifyReply) => {
        const check = await verifyAdminUser(request);
        if (!check.isAdmin) {
            reply.status(403);
            return { error: check.error };
        }

        const { jobId } = request.params;
        const queue = getQueue();
        const job: any = queue ? await queue.getJob(jobId) : null;
        if (!job) {
            reply.status(404);
            return { error: "Không tìm thấy job." };
        }

        const owner = job.userId ? await userStore.findById(job.userId) : null;

        return {
            jobId: job.jobId,
            status: job.status,
            userId: job.userId,
            userEmail: owner?.email || (job.userId ? "Unknown" : "Anonymous"),
            createdAt: job.createdAt,
            updatedAt: job.updatedAt,
            progress: job.progress,
            error: job.error,
            request: {
                prompt: job.request?.prompt,
                aspectRatio: job.request?.aspectRatio,
                style: job.request?.style,
                targetDurationSec: job.request?.targetDurationSec,
                voice: job.request?.voice,
                ttsProvider: job.request?.ttsProvider,
            },
            script: job.script || null,
            qaStatus: job.qaStatus ?? job.result?.qaStatus,
            degraded: Boolean(job.qaReport?.degraded ?? job.result?.qaReport?.degraded),
            result: job.result ? {
                durationSec: job.result.durationSec,
                hasVideo: Boolean(job.result.videoPath || job.result.mp4Path),
                videoAvailable: isJobVideoAvailable(job),
                hasHtml: Boolean(job.result.finalHtmlPath),
            } : null,
            queue: { state: job.status },
        };
    });

    app.delete("/api/admin/jobs/:jobId", async (request: FastifyRequest<{ Params: { jobId: string } }>, reply: FastifyReply) => {
        const check = await verifyAdminUser(request);
        if (!check.isAdmin) {
            reply.status(403);
            return { error: check.error };
        }

        const { jobId } = request.params;
        // Xoá job khỏi hàng đợi/bộ lưu trạng thái — trước đây route chỉ xoá thư mục
        // nên job vẫn nằm trong danh sách sau khi "xoá".
        const queue = getQueue();
        const removedFromQueue = queue ? await queue.removeJob(jobId) : false;

        // Thư mục làm việc thực tế là `tmp/job-<jobId>` (xem handlePipelineRequest).
        // Vẫn dọn thêm `tmp/<jobId>` để tương thích dữ liệu cũ.
        for (const workDir of [join(process.cwd(), "tmp", `job-${jobId}`), join(process.cwd(), "tmp", jobId)]) {
            if (existsSync(workDir)) {
                try {
                    rmSync(workDir, { recursive: true, force: true });
                } catch (err) {
                    console.error(`[Admin] Failed to remove workdir for job ${jobId}:`, err);
                }
            }
        }

        auditAdminAction(request, check, {
            action: "admin.job_deleted",
            status: "warning",
            details: { deletedBy: check.user?.email, jobId, removedFromQueue },
        });

        if (!removedFromQueue) {
            reply.status(404);
            return { error: "Không tìm thấy job.", removedFromQueue: false };
        }

        return { success: true, message: `Đã xóa job ${jobId}`, removedFromQueue: true };
    });

    app.patch("/api/admin/jobs/:jobId", async (request: FastifyRequest<{ Params: { jobId: string } }>, reply: FastifyReply) => {
        const check = await verifyAdminUser(request);
        if (!check.isAdmin) {
            reply.status(403);
            return { error: check.error };
        }

        const { jobId } = request.params;
        const body = (request.body as any) || {};
        const patch: JobUpdate = {};

        if (body.targetDurationSec !== undefined) {
            const duration = Number(body.targetDurationSec);
            if (!Number.isInteger(duration) || duration < 10 || duration > 300) {
                reply.status(400);
                return { error: "Thời lượng mục tiêu phải là số nguyên từ 10 đến 300 giây." };
            }
            patch.targetDurationSec = duration;
        }

        if (body.script !== undefined) {
            const parsed = videoScriptSchema.safeParse(body.script);
            if (!parsed.success) {
                reply.status(400);
                return { error: "Kịch bản không hợp lệ.", details: parsed.error.message };
            }
            patch.script = parsed.data as videoScript;
        }

        if (patch.targetDurationSec === undefined && patch.script === undefined) {
            reply.status(400);
            return { error: "Không có trường nào để cập nhật (targetDurationSec hoặc script)." };
        }

        const queue = getQueue();
        if (!queue) {
            reply.status(503);
            return { error: "Hàng đợi chưa sẵn sàng." };
        }

        const updated = await queue.updateJob(jobId, patch);
        if (!updated) {
            reply.status(404);
            return { error: "Không tìm thấy job." };
        }

        auditAdminAction(request, check, {
            action: "admin.job_updated",
            status: "success",
            details: { updatedBy: check.user?.email, jobId, fields: Object.keys(patch) },
        });

        return {
            success: true,
            jobId,
            targetDurationSec: updated.request?.targetDurationSec,
            hasScript: Boolean(updated.script),
            message: "Đã lưu chỉnh sửa. Có thể chạy lại job.",
        };
    });

    app.post("/api/admin/jobs/:jobId/cancel", async (request: FastifyRequest<{ Params: { jobId: string } }>, reply: FastifyReply) => {
        const check = await verifyAdminUser(request);
        if (!check.isAdmin) {
            reply.status(403);
            return { error: check.error };
        }

        const { jobId } = request.params;
        const queue = getQueue();
        if (!queue) {
            reply.status(503);
            return { error: "Hàng đợi chưa sẵn sàng." };
        }

        const job = await queue.getJob(jobId);
        if (!job) {
            reply.status(404);
            return { error: "Không tìm thấy job." };
        }
        if (JOB_FINISHED_STATUSES.includes(job.status)) {
            reply.status(409);
            return { error: `Không thể hủy job ở trạng thái "${job.status}".` };
        }

        // Trước đây route này chỉ ghi audit log mà không hủy gì cả.
        const cancelled = await queue.cancelJob(jobId);
        if (!cancelled) {
            reply.status(409);
            return { error: "Không thể hủy job ở trạng thái hiện tại." };
        }

        auditAdminAction(request, check, {
            action: "admin.job_cancelled",
            status: "warning",
            details: { cancelledBy: check.user?.email, jobId },
        });

        return { success: true, message: `Đã hủy job ${jobId}` };
    });

    app.post("/api/admin/jobs/:jobId/retry", async (request: FastifyRequest<{ Params: { jobId: string } }>, reply: FastifyReply) => {
        const check = await verifyAdminUser(request);
        if (!check.isAdmin) {
            reply.status(403);
            return { error: check.error };
        }

        const { jobId } = request.params;
        const queue = getQueue();
        if (!queue) {
            reply.status(503);
            return { error: "Hàng đợi chưa sẵn sàng." };
        }

        const job = await queue.getJob(jobId);
        if (!job) {
            reply.status(404);
            return { error: "Không tìm thấy job." };
        }
        if (JOB_ACTIVE_STATUSES.includes(job.status)) {
            reply.status(409);
            return { error: `Job đang ở trạng thái "${job.status}" — hãy hủy trước khi chạy lại.` };
        }
        if (!JOB_RETRYABLE_STATUSES.includes(job.status)) {
            reply.status(409);
            return { error: `Chỉ có thể chạy lại job thất bại hoặc đã hủy (trạng thái hiện tại: "${job.status}").` };
        }

        const retried = await queue.retryJob(jobId);
        if (!retried) {
            reply.status(409);
            return { error: `Không thể chạy lại job ở trạng thái "${job.status}".` };
        }

        auditAdminAction(request, check, {
            action: "admin.job_retried",
            status: "success",
            details: { retriedBy: check.user?.email, jobId },
        });

        return { success: true, message: `Đã đưa job ${jobId} vào hàng đợi chạy lại.` };
    });

    // -------------------------------------------------------------
    // 4. ORDERS & BILLING MANAGEMENT
    // -------------------------------------------------------------
    app.get("/api/admin/orders", async (request: FastifyRequest, reply: FastifyReply) => {
        const check = await verifyAdminUser(request);
        if (!check.isAdmin) {
            reply.status(403);
            return { error: check.error };
        }

        const query = (request.query as any) || {};
        const search = String(query.search || "").trim();
        const statusFilter = String(query.status || "all");

        const ORDER_STATUSES = ["pending", "claimed", "paid", "expired", "cancelled"];
        if (statusFilter !== "all" && !ORDER_STATUSES.includes(statusFilter)) {
            reply.status(400);
            return { error: "Trạng thái đơn hàng không hợp lệ." };
        }

        const requestedPage = Number.parseInt(query.page, 10);
        const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;
        const requestedLimit = Number.parseInt(query.limit, 10);
        const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 100) : 25;

        let orders: any[] = [];
        let total = 0;
        try {
            const result = await billingStorage.listOrdersForAdmin({
                status: statusFilter !== "all" ? statusFilter : undefined,
                search,
                page,
                limit,
            });
            orders = result.orders;
            total = result.total;
        } catch (err: any) {
            request.log?.warn?.({ err: err?.message }, "[Admin] Không tải được danh sách đơn hàng");
            orders = [];
            total = 0;
        }

        // Làm giàu dữ liệu: email/khách hàng + thông tin gói để bảng admin hiển thị đúng.
        const allUsers = await userStore.listUsers({ includeDeleted: true });
        const userMap = new Map(allUsers.map((u) => [u.id, u]));

        let planMap = new Map<string, any>();
        try {
            const plans = await billingStorage.getPlans();
            planMap = new Map(plans.map((p) => [p.id, p]));
        } catch {
            planMap = new Map();
        }

        const enrichedOrders = orders.map((o: any) => {
            const owner = userMap.get(o.user_id);
            const plan = planMap.get(o.plan_id);
            return {
                id: o.id,
                orderId: o.id,
                payCode: o.pay_code,
                userId: o.user_id,
                userEmail: owner?.email || null,
                userName: owner?.name || null,
                planId: o.plan_id,
                planName: plan?.name || o.plan_id,
                tier: o.plan_id,
                amountVnd: o.amount_vnd,
                quotaVideo: plan?.quota_video ?? null,
                planDays: plan?.days ?? null,
                status: o.status,
                expiresAt: o.expires_at,
                claimedAt: o.claimed_at ?? null,
                paidAt: o.paid_at ?? null,
                createdAt: o.created_at,
            };
        });

        return { orders: enrichedOrders, total, page, limit };
    });

    app.post("/api/admin/orders/:orderId/fulfill", async (request: FastifyRequest<{ Params: { orderId: string } }>, reply: FastifyReply) => {
        const check = await verifyAdminUser(request);
        if (!check.isAdmin) {
            reply.status(403);
            return { error: check.error };
        }

        const { orderId } = request.params;
        try {
            const order = await billingStorage.findOrderById(orderId);
            if (!order) {
                return reply.status(404).send({ error: "Không tìm thấy đơn hàng." });
            }
            if (order.status === "paid") {
                return reply.status(400).send({ error: "Đơn hàng đã được thanh toán trước đó." });
            }
            if (order.status === "cancelled") {
                return reply.status(400).send({
                    error: "Đơn hàng đã bị hủy, không thể duyệt nạp. Hãy tạo đơn mới cho khách hàng.",
                });
            }

            // Bắt buộc phải có gói cước thật: tránh cấp sai hạn mức khi gói bị xoá/đổi tên.
            const plan = await billingStorage.getPlanById(order.plan_id);
            if (!plan) {
                return reply.status(400).send({
                    error: `Không tìm thấy gói cước "${order.plan_id}" để duyệt đơn. Vui lòng kiểm tra bảng plans.`,
                });
            }
            const planDays = plan.days;
            const quotaVideo = plan.quota_video;

            const fulfillResult = await billingStorage.lockAndFulfillOrder({
                orderId: order.id,
                sepayRef: `MANUAL_${Date.now()}`,
                receivedAmount: order.amount_vnd,
                raw: { note: "Manual fulfill by admin", admin: check.user?.email },
                planDays,
                quotaVideo,
                planId: order.plan_id,
                result: "matched",
            });

            if (!fulfillResult.success) {
                return reply.status(409).send({
                    error: "Không thể duyệt đơn hàng: trạng thái đã thay đổi ở tiến trình khác. Vui lòng tải lại danh sách.",
                    reason: fulfillResult.reason,
                });
            }

            auditAdminAction(request, check, {
                action: "admin.order_manual_approved",
                status: "success",
                details: {
                    approvedBy: check.user?.email,
                    orderId: order.id,
                    payCode: order.pay_code,
                    amount: order.amount_vnd,
                    planId: order.plan_id,
                    quotaVideo,
                    planDays,
                },
            });

            return { success: true, order: fulfillResult.order || order };
        } catch (err: any) {
            reply.status(400);
            return { error: err.message || "Không thể duyệt thanh toán cho đơn hàng này." };
        }
    });

    // -------------------------------------------------------------
    // 4b. FAILED PAYMENTS & REFUNDS MANAGEMENT
    // Xử lý giao dịch thanh toán lỗi: unmatched (tiền vào nhưng không khớp
    // đơn), duplicate (2 giao dịch trùng 1 đơn), và hoàn tiền thủ công.
    // Lưu ý: SePay webhook KHÔNG trả về STK/ngân hàng của người chuyển nên
    // admin phải nhập tay thông tin này khi thực hiện hoàn tiền.
    // -------------------------------------------------------------
    const maskAccount = (acc: string): string => {
        const digits = String(acc || "").replace(/\D/g, "");
        if (digits.length <= 4) return "***" + digits;
        return "***" + digits.slice(-4);
    };

    app.get("/api/admin/unmatched", async (request: FastifyRequest, reply: FastifyReply) => {
        const check = await verifyAdminUser(request);
        if (!check.isAdmin) {
            reply.status(403);
            return { error: check.error };
        }

        const query = (request.query as any) || {};
        const status = query.status || "pending";
        if (!UNMATCHED_STATUSES.includes(status)) {
            return reply.status(400).send({ error: "Trạng thái lọc không hợp lệ." });
        }

        const paging = parseListPaging(query);
        if (paging.error) {
            return reply.status(400).send({ error: paging.error });
        }

        const range = parseDateRange(query);
        if (range.error) {
            return reply.status(400).send({ error: range.error });
        }

        const { unmatched, total } = await billingStorage.listUnmatchedPaymentsForAdmin({
            status,
            search: typeof query.search === "string" ? query.search : undefined,
            from: range.from,
            to: range.to,
            limit: paging.limit,
            page: paging.page,
        });

        return { unmatched, total, page: paging.page, limit: paging.limit ?? ADMIN_PAYMENTS_DEFAULT_LIMIT };
    });

    app.get("/api/admin/payments/duplicates", async (request: FastifyRequest, reply: FastifyReply) => {
        const check = await verifyAdminUser(request);
        if (!check.isAdmin) {
            reply.status(403);
            return { error: check.error };
        }

        const query = (request.query as any) || {};

        const paging = parseListPaging(query);
        if (paging.error) {
            return reply.status(400).send({ error: paging.error });
        }

        const range = parseDateRange(query);
        if (range.error) {
            return reply.status(400).send({ error: range.error });
        }

        const { duplicates, total } = await billingStorage.listDuplicatePaymentsForAdmin({
            search: typeof query.search === "string" ? query.search : undefined,
            from: range.from,
            to: range.to,
            limit: paging.limit,
            page: paging.page,
        });

        // Làm giàu dữ liệu bằng truy vấn gộp thay vì tra từng dòng (trước đây là N+1:
        // mỗi giao dịch trùng lặp lại 1 truy vấn đơn hàng + 1 truy vấn người dùng).
        const orderIds = duplicates.map((p) => p.order_id).filter((id): id is string => Boolean(id));
        const ordersById = await billingStorage.findOrdersByIds(orderIds);
        const userIds = Array.from(ordersById.values()).map((o) => o.user_id);
        const emailsById = await userStore.findEmailsByIds(userIds);
        const refundedPaymentIds = await billingStorage.getRefundedSourceIds(
            "duplicate",
            duplicates.map((p) => p.id)
        );

        const items = duplicates.map((p) => {
            const order = p.order_id ? ordersById.get(p.order_id) || null : null;
            return {
                ...p,
                alreadyRefunded: refundedPaymentIds.has(p.id),
                order: order
                    ? { id: order.id, pay_code: order.pay_code, amount_vnd: order.amount_vnd, status: order.status }
                    : null,
                userEmail: order ? emailsById.get(order.user_id) || null : null,
            };
        });

        return { duplicates: items, total, page: paging.page, limit: paging.limit ?? ADMIN_PAYMENTS_DEFAULT_LIMIT };
    });

    app.post(
        "/api/admin/unmatched/:id/resolve",
        async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
            const check = await verifyAdminUser(request);
            if (!check.isAdmin) {
                reply.status(403);
                return { error: check.error };
            }

            const { id } = request.params;
            const body = (request.body as any) || {};
            const orderId = body.orderId ? String(body.orderId).trim() : "";
            const adminNote = body.adminNote ? String(body.adminNote).trim() : undefined;

            if (orderId) {
                const order = await billingStorage.findOrderById(orderId);
                if (!order) {
                    return reply.status(404).send({ error: "Không tìm thấy đơn hàng để đối soát." });
                }
            }

            const existing = await billingStorage.findUnmatchedPaymentById(id);
            if (!existing) {
                return reply.status(404).send({ error: "Không tìm thấy giao dịch." });
            }
            if (existing.status !== "pending") {
                return reply.status(400).send({ error: "Giao dịch này đã được xử lý trước đó." });
            }

            const item = await billingStorage.resolveUnmatchedPayment(id, "resolved", adminNote, check.user?.email);

            auditAdminAction(request, check, {
                action: "admin.unmatched_resolved",
                status: "success",
                details: {
                    resolvedBy: check.user?.email,
                    unmatchedId: id,
                    sepayRef: item?.sepay_ref,
                    amount: item?.amount_vnd,
                    orderId: orderId || null,
                },
            });

            return { success: true, unmatched: item };
        }
    );

    app.post(
        "/api/admin/unmatched/:id/refund",
        async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
            const check = await verifyAdminUser(request);
            if (!check.isAdmin) {
                reply.status(403);
                return { error: check.error };
            }

            const { id } = request.params;
            const body = (request.body as any) || {};
            const bankAccount = body.bankAccount ? String(body.bankAccount).trim() : "";
            const bankName = body.bankName ? String(body.bankName).trim() : "";
            const adminNote = body.adminNote ? String(body.adminNote).trim() : undefined;

            if (!bankAccount || !bankName) {
                return reply.status(400).send({
                    error: "Vui lòng nhập số tài khoản và tên ngân hàng của khách hàng để hoàn tiền.",
                });
            }
            if (bankAccount.length > 50 || bankName.length > 100) {
                return reply.status(400).send({
                    error: "Số tài khoản hoặc tên ngân hàng vượt quá độ dài cho phép.",
                });
            }

            const existing = await billingStorage.findUnmatchedPaymentById(id);
            if (!existing) {
                return reply.status(404).send({ error: "Không tìm thấy giao dịch." });
            }
            if (existing.status !== "pending") {
                return reply.status(400).send({ error: "Giao dịch này đã được xử lý trước đó." });
            }

            const existingRefund = await billingStorage.findRefundBySource("unmatched", existing.id);
            if (existingRefund) {
                return reply.status(400).send({ error: "Giao dịch này đã được hoàn tiền trước đó." });
            }

            let refund: any;
            try {
                refund = await billingStorage.recordRefund({
                    source_type: "unmatched",
                    source_id: existing.id,
                    sepay_ref: existing.sepay_ref,
                    amount_vnd: existing.amount_vnd,
                    bank_account: bankAccount,
                    bank_name: bankName,
                    admin_note: adminNote,
                    refunded_by: check.user?.email,
                });
            } catch (err: any) {
                if (err?.code === "23505" || err?.message?.includes("Refund already exists")) {
                    return reply.status(400).send({ error: "Giao dịch này đã được hoàn tiền trước đó." });
                }
                throw err;
            }

            await billingStorage.resolveUnmatchedPayment(id, "refunded", adminNote, check.user?.email);

            auditAdminAction(request, check, {
                action: "admin.unmatched_refunded",
                status: "success",
                details: {
                    refundedBy: check.user?.email,
                    unmatchedId: id,
                    sepayRef: existing.sepay_ref,
                    amount: existing.amount_vnd,
                    bankName,
                    bankAccountMasked: maskAccount(bankAccount),
                },
            });

            return { success: true, refund };
        }
    );

    app.post(
        "/api/admin/payments/:paymentId/refund",
        async (request: FastifyRequest<{ Params: { paymentId: string } }>, reply: FastifyReply) => {
            const check = await verifyAdminUser(request);
            if (!check.isAdmin) {
                reply.status(403);
                return { error: check.error };
            }

            const { paymentId } = request.params;
            const body = (request.body as any) || {};
            const bankAccount = body.bankAccount ? String(body.bankAccount).trim() : "";
            const bankName = body.bankName ? String(body.bankName).trim() : "";
            const adminNote = body.adminNote ? String(body.adminNote).trim() : undefined;

            if (!bankAccount || !bankName) {
                return reply.status(400).send({
                    error: "Vui lòng nhập số tài khoản và tên ngân hàng của khách hàng để hoàn tiền.",
                });
            }
            if (bankAccount.length > 50 || bankName.length > 100) {
                return reply.status(400).send({
                    error: "Số tài khoản hoặc tên ngân hàng vượt quá độ dài cho phép.",
                });
            }

            const payment = await billingStorage.findPaymentById(paymentId);
            if (!payment) {
                return reply.status(404).send({ error: "Không tìm thấy giao dịch." });
            }
            if (payment.result !== "duplicate") {
                return reply.status(400).send({ error: "Chỉ hoàn tiền cho giao dịch trùng lặp." });
            }

            const existingRefund = await billingStorage.findRefundBySource("duplicate", payment.id);
            if (existingRefund) {
                return reply.status(400).send({ error: "Giao dịch này đã được hoàn tiền trước đó." });
            }

            let refund: any;
            try {
                refund = await billingStorage.recordRefund({
                    source_type: "duplicate",
                    source_id: payment.id,
                    sepay_ref: payment.sepay_ref,
                    amount_vnd: payment.amount_vnd,
                    bank_account: bankAccount,
                    bank_name: bankName,
                    admin_note: adminNote,
                    refunded_by: check.user?.email,
                });
            } catch (err: any) {
                if (err?.code === "23505" || err?.message?.includes("Refund already exists")) {
                    return reply.status(400).send({ error: "Giao dịch này đã được hoàn tiền trước đó." });
                }
                throw err;
            }

            auditAdminAction(request, check, {
                action: "admin.payment_refunded",
                status: "success",
                details: {
                    refundedBy: check.user?.email,
                    paymentId: payment.id,
                    sepayRef: payment.sepay_ref,
                    amount: payment.amount_vnd,
                    bankName,
                    bankAccountMasked: maskAccount(bankAccount),
                },
            });

            return { success: true, refund };
        }
    );

    app.post(
        "/api/admin/orders/:orderId/cancel",
        async (request: FastifyRequest<{ Params: { orderId: string } }>, reply: FastifyReply) => {
            const check = await verifyAdminUser(request);
            if (!check.isAdmin) {
                reply.status(403);
                return { error: check.error };
            }

            const { orderId } = request.params;
            const order = await billingStorage.findOrderById(orderId);
            if (!order) {
                return reply.status(404).send({ error: "Không tìm thấy đơn hàng." });
            }

            const cancelled = await billingStorage.cancelOrder(orderId);
            if (!cancelled) {
                return reply.status(400).send({ error: "Chỉ hủy được đơn hàng đang chờ thanh toán." });
            }

            auditAdminAction(request, check, {
                action: "admin.order_cancelled",
                status: "success",
                details: {
                    cancelledBy: check.user?.email,
                    orderId: order.id,
                    payCode: order.pay_code,
                    amount: order.amount_vnd,
                },
            });

            return { success: true, order: cancelled };
        }
    );

    app.get("/api/admin/refunds", async (request: FastifyRequest, reply: FastifyReply) => {
        const check = await verifyAdminUser(request);
        if (!check.isAdmin) {
            reply.status(403);
            return { error: check.error };
        }

        const query = (request.query as any) || {};

        const sourceType = typeof query.sourceType === "string" ? query.sourceType.trim() : "";
        if (sourceType && sourceType !== "all" && !REFUND_SOURCE_TYPES.includes(sourceType)) {
            return reply.status(400).send({ error: "Loại nguồn hoàn tiền không hợp lệ." });
        }

        const paging = parseListPaging(query);
        if (paging.error) {
            return reply.status(400).send({ error: paging.error });
        }

        const range = parseDateRange(query);
        if (range.error) {
            return reply.status(400).send({ error: range.error });
        }

        const { refunds, total } = await billingStorage.listRefundsForAdmin({
            sourceType: sourceType || undefined,
            search: typeof query.search === "string" ? query.search : undefined,
            from: range.from,
            to: range.to,
            limit: paging.limit,
            page: paging.page,
        });

        return { refunds, total, page: paging.page, limit: paging.limit ?? ADMIN_PAYMENTS_DEFAULT_LIMIT };
    });

    // -------------------------------------------------------------
    // 4d. YÊU CẦU HOÀN TIỀN CỦA NGƯỜI DÙNG
    //
    // Người dùng gửi từ widget Hỗ trợ (danh mục "refund") kèm giao dịch lỗi, số
    // tài khoản, ngân hàng, (tuỳ chọn) ảnh chụp và lý do. Quản trị duyệt → từ chối
    // → chuyển tiền; khi chuyển tiền thành công thì ghi vào sổ `refunds` để đối soát.
    // Danh sách kèm sẵn mã VietQR (dựng từ số tài khoản + ngân hàng của khách) để
    // quản trị quét trả tiền lại ngay trên màn hình.
    // -------------------------------------------------------------

    app.get("/api/admin/refund-requests", async (request: FastifyRequest, reply: FastifyReply) => {
        const check = await verifyAdminUser(request);
        if (!check.isAdmin) {
            reply.status(403);
            return { error: check.error };
        }

        const query = (request.query as any) || {};
        const statusFilter = String(query.status || "all");
        if (statusFilter !== "all" && !REFUND_STATUSES.includes(statusFilter as RefundStatus)) {
            return reply
                .status(400)
                .send({ error: `Trạng thái không hợp lệ. Chỉ chấp nhận: ${REFUND_STATUSES.join(", ")}.` });
        }

        const page = parseInt(query.page, 10) || 1;
        const limit = parseInt(query.limit, 10) || 25;

        const result = await helpdeskStore.listRefundRequests({
            status: statusFilter,
            search: String(query.search || ""),
            page,
            limit,
        });

        return {
            success: true,
            total: result.total,
            page: result.page,
            limit: result.limit,
            totalPages: result.totalPages,
            stats: result.stats,
            requests: result.items.map((t) => {
                const refund = getRefundPayload(t);
                return {
                    ticketId: t.id,
                    code: t.code,
                    userId: t.userId,
                    userEmail: t.userEmail,
                    subject: t.subject,
                    ticketStatus: t.status,
                    priority: t.priority,
                    createdAt: t.createdAt,
                    lastMessageAt: t.lastMessageAt,
                    refund,
                    qr: refund ? buildRefundQr(refund, t.code) : null,
                };
            }),
        };
    });

    app.patch(
        "/api/admin/refund-requests/:id",
        async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
            const check = await verifyAdminUser(request);
            if (!check.isAdmin) {
                reply.status(403);
                return { error: check.error };
            }

            const { id } = request.params;
            const body = (request.body as any) || {};
            const nextStatus = String(body.status || "");
            const note = body.note === undefined || body.note === null ? "" : String(body.note).trim();

            if (!REFUND_STATUSES.includes(nextStatus as RefundStatus)) {
                return reply
                    .status(400)
                    .send({ error: `Trạng thái không hợp lệ. Chỉ chấp nhận: ${REFUND_STATUSES.join(", ")}.` });
            }
            if (nextStatus === "pending") {
                return reply.status(400).send({ error: "Không thể đưa yêu cầu trở lại trạng thái chờ xử lý." });
            }
            if (note.length > 1000) {
                return reply.status(400).send({ error: "Ghi chú tối đa 1000 ký tự." });
            }
            if (nextStatus === "rejected" && note.length < 3) {
                return reply.status(400).send({ error: "Vui lòng ghi rõ lý do từ chối để người dùng hiểu." });
            }

            const ticket = await helpdeskStore.findById(id);
            const refund = ticket ? getRefundPayload(ticket) : null;
            if (!ticket || ticket.category !== "refund" || !refund) {
                reply.status(404);
                return { error: "Không tìm thấy yêu cầu hoàn tiền." };
            }

            // Chỉ cho phép đi tới theo đúng luồng: chờ → duyệt → đã chuyển tiền.
            const ALLOWED_FROM: Record<Exclude<RefundStatus, "pending">, RefundStatus[]> = {
                approved: ["pending"],
                rejected: ["pending", "approved"],
                refunded: ["approved"],
            };
            if (!ALLOWED_FROM[nextStatus as Exclude<RefundStatus, "pending">].includes(refund.status)) {
                return reply.status(409).send({
                    error: `Không thể chuyển yêu cầu từ trạng thái "${refund.status}" sang "${nextStatus}".`,
                });
            }

            const nowIso = new Date().toISOString();
            const adminEmail = check.user?.email || "admin";
            let refundId = refund.refundId;
            let refundedAt = refund.refundedAt;

            if (nextStatus === "refunded") {
                // Ghi vào sổ hoàn tiền để đối soát; `sepay_ref` ưu tiên mã giao dịch
                // thật của đơn, nếu đơn chưa từng khớp giao dịch nào thì dùng mã đơn.
                const payment = await billingStorage.findPaymentByOrderId(refund.orderId);
                try {
                    const recorded = await billingStorage.recordRefund({
                        source_type: "refund_request",
                        source_id: ticket.id,
                        sepay_ref: payment?.sepay_ref || refund.payCode,
                        amount_vnd: refund.amountVnd,
                        bank_account: refund.bankAccount,
                        bank_name: refund.bankName,
                        admin_note: note || `Hoàn theo yêu cầu ${ticket.code}`,
                        refunded_by: adminEmail,
                    });
                    refundId = recorded.id;
                    refundedAt = recorded.refunded_at;
                } catch (err: any) {
                    if (err?.code === "23505" || /already exists/i.test(err?.message || "")) {
                        return reply.status(409).send({ error: "Yêu cầu này đã được ghi nhận hoàn tiền trước đó." });
                    }
                    throw err;
                }

                // Đơn chưa xử lý thì đóng lại để một giao dịch về muộn không kích hoạt
                // gói nữa (tránh vừa được hoàn tiền vừa được cấp dịch vụ).
                await billingStorage.cancelOrder(refund.orderId);
            }

            const updatedPayload: RefundRequestPayload = {
                ...refund,
                status: nextStatus as RefundStatus,
                adminNote: note || refund.adminNote,
                reviewedBy: adminEmail,
                reviewedAt: nowIso,
                refundId,
                refundedAt,
            };

            await helpdeskStore.updateTicketContext(ticket.id, {
                ...(ticket.context || {}),
                refund: updatedPayload,
            });

            // Cho người dùng biết kết quả ngay trong hội thoại của widget.
            const amountText = refund.amountVnd.toLocaleString("vi-VN");
            const notices: Record<Exclude<RefundStatus, "pending">, string> = {
                approved: `Yêu cầu hoàn tiền ${amountText} ₫ cho giao dịch ${refund.payCode} đã được duyệt. Đội ngũ LIME sẽ chuyển khoản trong thời gian sớm nhất.`,
                rejected: `Yêu cầu hoàn tiền cho giao dịch ${refund.payCode} chưa được chấp nhận. Lý do: ${note}`,
                refunded: `Đã hoàn ${amountText} ₫ vào tài khoản ${refund.bankName} - ${maskAccount(refund.bankAccount)}. Cảm ơn bạn đã kiên nhẫn chờ đợi.`,
            };
            await helpdeskStore.addMessage(ticket.id, {
                senderType: "admin",
                senderId: check.user?.id || null,
                senderEmail: adminEmail,
                body: notices[nextStatus as Exclude<RefundStatus, "pending">],
            });

            if (nextStatus === "refunded" || nextStatus === "rejected") {
                await helpdeskStore.updateTicket(ticket.id, { status: "resolved" });
            }

            auditAdminAction(request, check, {
                action: `admin.refund_request_${nextStatus}`,
                status: "success",
                details: {
                    ticketId: ticket.id,
                    code: ticket.code,
                    userId: ticket.userId,
                    orderId: refund.orderId,
                    payCode: refund.payCode,
                    amount: refund.amountVnd,
                    bankName: refund.bankName,
                    bankAccountMasked: maskAccount(refund.bankAccount),
                    refundId,
                    note: note || undefined,
                },
            });

            return { success: true, refund: updatedPayload, ticket: await helpdeskStore.getTicket(ticket.id) };
        }
    );

    // -------------------------------------------------------------
    // 5. SYSTEM SETTINGS & PROVIDER CONNECTIVITY
    // -------------------------------------------------------------
    app.get("/api/admin/settings", async (request: FastifyRequest, reply: FastifyReply) => {
        const check = await verifyAdminUser(request);
        if (!check.isAdmin) {
            reply.status(403);
            return { error: check.error };
        }

        const settings = systemSettings.get();
        const config = getConfig();

        const llmStatus: Record<string, { configured: boolean; defaultModel: string; note: string }> = {
            deepseek: {
                configured: Boolean(config.DeepSeek_APIKEY),
                defaultModel: config.DeepSeek_Model || "deepseek-chat",
                note: "DeepSeek AI (deepseek-chat, deepseek-reasoner)",
            },
            gemini: {
                configured: Boolean(config.Gemini_APIKEY),
                defaultModel: config.Gemini_Model || "gemini-3.5-flash",
                note: "Google Gemini (gemini-3.5-flash, gemini-2.5-pro)",
            },
            claude: {
                configured: Boolean(config.Claude_APIKEY),
                defaultModel: config.Claude_Model || "claude sonnet 4.5",
                note: "Anthropic Claude (claude sonnet 4.5)",
            },
            openai: {
                configured: Boolean(config.OpenAI_APIKEY),
                defaultModel: config.OpenAI_Model || "gpt-5.3-codex",
                note: "OpenAI GPT (gpt-5.3-codex, gpt-4o)",
            },
            "9router": {
                configured: Boolean(config.NineRouter_APIKEY || process.env.NINEROUTER_API_KEY),
                defaultModel: config.NineRouter_Model || "ag/gemini-3.8-flash-high",
                note: "Local AI Router (http://localhost:20128/v1)",
            },
        };

        const ttsStatus: Record<string, { configured: boolean; defaultVoice: string; free?: boolean; note: string }> = {
            edge: {
                configured: true,
                free: true,
                defaultVoice: "vi-VN-HoaiMyNeural",
                note: "Edge TTS (100% Miễn phí, không cần API Key)",
            },
            vieneu: {
                configured: true,
                defaultVoice: "Minh Quân",
                note: "VieNeu-TTS (Local AI Docker port 7860)",
            },
            openai: {
                configured: Boolean(config.OpenAI_APIKEY),
                defaultVoice: "alloy",
                note: "OpenAI TTS (alloy, echo, fable, onyx, nova, shimmer)",
            },
            google: {
                configured: Boolean(config.Google_TTS_APIKEY),
                defaultVoice: "vi-VN-Standard-A",
                note: "Google Cloud Text-to-Speech",
            },
            elevenlabs: {
                configured: Boolean(config.Elevenlabs_API_KEY),
                defaultVoice: config.Elevenlabs_Voice_ID || "",
                note: "ElevenLabs AI Voice",
            },
        };

        return {
            settings: {
                ...settings,
                llmProvider: settings.defaultLlmProvider,
                llmModel: settings.defaultLlmModel || (llmStatus[settings.defaultLlmProvider]?.defaultModel) || "",
                ttsProvider: settings.defaultTtsProvider,
                ttsVoice: settings.defaultTtsVoice || (ttsStatus[settings.defaultTtsProvider]?.defaultVoice) || "",
                renderConcurrency: settings.maxConcurrentJobs,
            },
            providersStatus: {
                llm: llmStatus,
                tts: ttsStatus,
            },
        };
    });

    app.put("/api/admin/settings", async (request: FastifyRequest, reply: FastifyReply) => {
        const check = await verifyAdminUser(request);
        if (!check.isAdmin) {
            reply.status(403);
            return { error: check.error };
        }

        const body = (request.body as any) || {};

        // Kiểm tra hợp lệ trước khi lưu (trước đây nhận thẳng `any` và lưu bừa).
        const validationError = validateSettingsPatch(body);
        if (validationError) {
            reply.status(400);
            return { error: validationError };
        }

        const updated = systemSettings.update(body, check.user?.email);

        auditAdminAction(request, check, {
            action: "admin.settings_updated",
            status: "success",
            details: { updatedBy: check.user?.email, changes: body },
        });

        return { success: true, settings: updated };
    });

    app.post("/api/admin/test-provider", async (request: FastifyRequest, reply: FastifyReply) => {
        const check = await verifyAdminUser(request);
        if (!check.isAdmin) {
            reply.status(403);
            return { error: check.error };
        }

        const body = (request.body as any) || {};
        const { type, provider, model } = body;
        const startTime = Date.now();

        const llmProviders = ["deepseek", "gemini", "claude", "openai", "9router"];
        const ttsProviders = ["edge", "vieneu", "openai", "google", "elevenlabs"];
        const targetType = type || (llmProviders.includes(provider) ? "llm" : ttsProviders.includes(provider) ? "tts" : undefined);

        if (targetType === "postgres" || type === "postgres") {
            const config = getConfig();
            if (!config.DATABASE_URL) {
                return { success: false, provider: "postgres", latencyMs: 0, message: "DATABASE_URL chưa được cấu hình." };
            }
            try {
                await db.query("SELECT 1");
                return { success: true, provider: "postgres", latencyMs: Date.now() - startTime, message: "Kết nối PostgreSQL ổn định!" };
            } catch (err: any) {
                return { success: false, provider: "postgres", latencyMs: Date.now() - startTime, message: `Lỗi kết nối PostgreSQL: ${err.message}` };
            }
        }

        if (targetType === "llm") {
            const config = getConfig();
            const targetProvider = provider || config.LLM_Provider || "deepseek";
            const targetModel = model || body.model || "";

            let hasKey = false;
            if (targetProvider === "deepseek") hasKey = Boolean(config.DeepSeek_APIKEY);
            else if (targetProvider === "gemini") hasKey = Boolean(config.Gemini_APIKEY);
            else if (targetProvider === "claude") hasKey = Boolean(config.Claude_APIKEY);
            else if (targetProvider === "openai") hasKey = Boolean(config.OpenAI_APIKEY);
            else if (targetProvider === "9router") hasKey = true;

            if (!hasKey) {
                return {
                    success: false,
                    provider: targetProvider,
                    latencyMs: 0,
                    message: `Chưa cấu hình API Key cho nhà cung cấp [${targetProvider.toUpperCase()}] trong tệp .env`,
                };
            }

            // Thực hiện lời gọi thật tới nhà cung cấp thay vì trả về độ trễ giả.
            try {
                const client = getLLMClientFactory()(targetProvider, config);
                const responseText = await client.generate(
                    "Bạn là trợ lý kiểm tra kết nối. Chỉ trả lời ngắn gọn.",
                    'Trả về đúng chuỗi JSON sau: {"status":"ok"}',
                    AbortSignal.timeout(15000)
                );
                const latencyMs = Date.now() - startTime;
                const preview = String(responseText ?? "").trim().slice(0, 120);
                return {
                    success: true,
                    provider: targetProvider,
                    model: targetModel || undefined,
                    latencyMs,
                    message: `Kết nối LLM [${targetProvider.toUpperCase()}]${targetModel ? ` (Model: ${targetModel})` : ""} thành công (${latencyMs}ms). Phản hồi: ${preview}`,
                };
            } catch (err: any) {
                return {
                    success: false,
                    provider: targetProvider,
                    model: targetModel || undefined,
                    latencyMs: Date.now() - startTime,
                    message: `Không kết nối được LLM [${targetProvider.toUpperCase()}]: ${err?.message || err}`,
                };
            }
        }
        if (targetType === "tts") {
            const config = getConfig();
            const targetTts = provider || config.TTS_Provider || "edge";
            const targetVoice = body.voice || config.TTS_Voice || "vi-VN-HoaiMyNeural";
            const sampleText = (body.text || "Xin chào, đây là giọng đọc thử nghiệm của hệ thống LIME.").trim();

            let hasKey = true;
            if (targetTts === "openai") hasKey = Boolean(config.OpenAI_APIKEY);
            else if (targetTts === "google") hasKey = Boolean(config.Google_TTS_APIKEY);
            else if (targetTts === "elevenlabs") hasKey = Boolean(config.Elevenlabs_API_KEY);

            if (!hasKey) {
                return {
                    success: false,
                    provider: targetTts,
                    latencyMs: 0,
                    message: `Chưa cấu hình API Key cho giọng đọc [${targetTts.toUpperCase()}] trong tệp .env`,
                };
            }

            // Luôn tổng hợp thật một mẫu ngắn để xác thực nhà cung cấp, thay vì trả về
            // độ trễ giả như trước đây.
            const tempFile = join(tmpdir(), `tts_sample_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.mp3`);
            try {
                const client = createTTSClient(targetTts);
                await client.synthesize(sampleText, tempFile, { voice: targetVoice });
                const audioBuffer = readFileSync(tempFile);
                const audioBase64 = audioBuffer.toString("base64");
                try { unlinkSync(tempFile); } catch {}

                const latencyMs = Date.now() - startTime;
                return {
                    success: true,
                    provider: targetTts,
                    voice: targetVoice,
                    audioBase64,
                    latencyMs,
                    message: `Đã sinh mẫu giọng đọc [${targetVoice}] thành công (${latencyMs}ms).`,
                };
            } catch (err: any) {
                try { if (existsSync(tempFile)) unlinkSync(tempFile); } catch {}
                return {
                    success: false,
                    provider: targetTts,
                    voice: targetVoice,
                    latencyMs: Date.now() - startTime,
                    message: `Lỗi sinh giọng đọc mẫu: ${err.message || err}`,
                };
            }
        }

        reply.status(400);
        return { error: `Loại kiểm tra không hợp lệ hoặc nhà cung cấp không được hỗ trợ: ${type || provider || "(trống)"}` };
    });

    // -------------------------------------------------------------
    // 6. AUDIT LOGS
    // -------------------------------------------------------------
    app.get("/api/admin/audit-logs", async (request: FastifyRequest, reply: FastifyReply) => {
        const check = await verifyAdminUser(request);
        if (!check.isAdmin) {
            reply.status(403);
            return { error: check.error };
        }

        const query = (request.query as any) || {};

        // Chỉ phân trang khi client thực sự gửi `limit`; nếu không thì giữ nguyên
        // hành vi cũ (lấy 150 bản ghi mới nhất).
        const limitProvided = query.limit !== undefined && query.limit !== "";
        const parsedLimit = parseInt(query.limit, 10);
        if (limitProvided && (!Number.isFinite(parsedLimit) || parsedLimit < 1)) {
            reply.status(400);
            return { error: "Tham số 'limit' không hợp lệ." };
        }
        const limit = limitProvided ? Math.min(parsedLimit, AUDIT_LOGS_MAX_LIMIT) : 150;

        let page = 1;
        if (limitProvided) {
            const parsedPage = parseInt(query.page, 10);
            if (query.page !== undefined && query.page !== "" && (!Number.isFinite(parsedPage) || parsedPage < 1)) {
                reply.status(400);
                return { error: "Tham số 'page' không hợp lệ." };
            }
            page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
        }

        const status = typeof query.status === "string" ? query.status.trim() : "";
        if (status && !AUDIT_LOG_STATUSES.includes(status)) {
            reply.status(400);
            return { error: `Trạng thái nhật ký không hợp lệ: ${status}` };
        }

        const { logs, total } = await auditLog.list({
            limit,
            offset: limitProvided ? (page - 1) * limit : 0,
            action: typeof query.action === "string" ? query.action : undefined,
            status: status || undefined,
            search: typeof query.search === "string" ? query.search : undefined,
            from: typeof query.from === "string" && query.from ? query.from : undefined,
            to: typeof query.to === "string" && query.to ? query.to : undefined,
        });

        return { logs, total, page, limit };
    });

    app.delete("/api/admin/audit-logs", async (request: FastifyRequest, reply: FastifyReply) => {
        const check = await verifyAdminUser(request);
        if (!check.isAdmin) {
            reply.status(403);
            return { error: check.error };
        }

        const query = (request.query as any) || {};
        const status = typeof query.status === "string" ? query.status.trim() : "";
        if (status && !AUDIT_LOG_STATUSES.includes(status)) {
            reply.status(400);
            return { error: `Trạng thái nhật ký không hợp lệ: ${status}` };
        }

        const filter = {
            action: typeof query.action === "string" && query.action ? query.action : undefined,
            status: status || undefined,
            search: typeof query.search === "string" && query.search ? query.search : undefined,
            from: typeof query.from === "string" && query.from ? query.from : undefined,
            to: typeof query.to === "string" && query.to ? query.to : undefined,
        };

        try {
            // Phải chờ xoá xong rồi mới ghi bản ghi "đã xoá", nếu không bản ghi đó sẽ
            // bị chính thao tác xoá (đang chạy nền) cuốn mất.
            await auditLog.clear(filter);
        } catch (err: any) {
            reply.status(500);
            return { error: `Không xoá được nhật ký kiểm toán: ${err?.message || err}` };
        }

        // Ghi và CHỜ lưu vào DB để nhật ký "đã xoá" xuất hiện ngay ở lần đọc kế tiếp.
        await auditLog.recordAndPersist({
            action: "admin.logs_cleared",
            status: "warning",
            actorId: check.user?.id,
            actorEmail: check.user?.email,
            ip: extractClientIp(request),
            details: { clearedBy: check.user?.email, filter: Object.keys(filter).length ? filter : "all" },
        });

        return { success: true, message: "Đã xóa sạch toàn bộ nhật ký kiểm toán." };
    });

    // -------------------------------------------------------------
    // 7. PAGE VIEWS & VISITOR MANAGEMENT
    // -------------------------------------------------------------
    app.get("/api/admin/views", async (request: FastifyRequest, reply: FastifyReply) => {
        const check = await verifyAdminUser(request);
        if (!check.isAdmin) {
            reply.status(403);
            return { error: check.error };
        }

        const query = (request.query as any) || {};
        const page = parseInt(query.page, 10) || 1;
        const limit = parseInt(query.limit, 10) || 25;
        const search = query.search;
        const path = query.path;
        const device = query.device;
        const period = query.period;
        const userType = query.userType;
        const country = query.country;

        const result = pageViewTracker.getRecent({ page, limit, search, path, device, period, userType, country });
        const availableCountries = pageViewTracker.getAllCountries();
        return { success: true, ...result, availableCountries };
    });

    app.get("/api/admin/views/stats", async (request: FastifyRequest, reply: FastifyReply) => {
        const check = await verifyAdminUser(request);
        if (!check.isAdmin) {
            reply.status(403);
            return { error: check.error };
        }

        const query = (request.query as any) || {};
        const period = query.period || "all";
        const stats = pageViewTracker.getStats(period);
        return { success: true, stats };
    });

    app.delete("/api/admin/views", async (request: FastifyRequest, reply: FastifyReply) => {
        const check = await verifyAdminUser(request);
        if (!check.isAdmin) {
            reply.status(403);
            return { error: check.error };
        }

        pageViewTracker.clear();
        auditAdminAction(request, check, {
            action: "admin.views_cleared",
            status: "warning",
            details: { clearedBy: check.user?.email },
        });

        return { success: true, message: "Đã xóa toàn bộ lịch sử lượt xem trang." };
    });

    // ==========================================
    // MAINTENANCE VISITOR LOGS
    // ==========================================
    app.get("/api/admin/maintenance", async (request: FastifyRequest, reply: FastifyReply) => {
        const check = await verifyAdminUser(request);
        if (!check.isAdmin) {
            reply.status(403);
            return { error: check.error };
        }

        try {
            await maintenanceTracker.syncIfNeeded(10000);
        } catch (e: any) {
            request.log?.warn?.({ err: e.message }, "[Maintenance] Auto-sync warning");
        }

        const query = (request.query as any) || {};
        const page = parseInt(query.page, 10) || 1;
        const limit = parseInt(query.limit, 10) || 25;
        const search = query.search;

        const result = maintenanceTracker.getRecent({ page, limit, search });
        return { success: true, ...result };
    });

    app.get("/api/admin/maintenance/stats", async (request: FastifyRequest, reply: FastifyReply) => {
        const check = await verifyAdminUser(request);
        if (!check.isAdmin) {
            reply.status(403);
            return { error: check.error };
        }

        try {
            await maintenanceTracker.syncIfNeeded(10000);
        } catch (e: any) {
            request.log?.warn?.({ err: e.message }, "[Maintenance] Auto-sync stats warning");
        }

        const stats = maintenanceTracker.getStats();
        return { success: true, stats };
    });

    app.post("/api/admin/maintenance/sync", async (request: FastifyRequest, reply: FastifyReply) => {
        const check = await verifyAdminUser(request);
        if (!check.isAdmin) {
            reply.status(403);
            return { error: check.error };
        }

        try {
            const syncResult = await maintenanceTracker.syncFromCloudflare();
            auditAdminAction(request, check, {
                action: "admin.maintenance_synced",
                status: "success",
                details: {
                    syncedCount: syncResult.syncedCount,
                    total: syncResult.total,
                    syncedBy: check.user?.email,
                },
            });

            return {
                success: true,
                message: `Đã đồng bộ thành công ${syncResult.syncedCount} lượt truy cập mới từ Cloudflare.`,
                ...syncResult,
            };
        } catch (err: any) {
            return reply.status(500).send({
                success: false,
                error: `Không thể đồng bộ từ Cloudflare: ${err.message}`,
            });
        }
    });

    app.delete("/api/admin/maintenance", async (request: FastifyRequest, reply: FastifyReply) => {
        const check = await verifyAdminUser(request);
        if (!check.isAdmin) {
            reply.status(403);
            return { error: check.error };
        }

        maintenanceTracker.clear();
        auditAdminAction(request, check, {
            action: "admin.maintenance_cleared",
            status: "warning",
            details: { clearedBy: check.user?.email },
        });

        return { success: true, message: "Đã xóa toàn bộ lịch sử khách truy cập khi bảo trì." };
    });

    // ==========================================
    // SYSTEM BROADCAST BANNER (ANNOUNCEMENTS)
    // ==========================================
    const ANNOUNCEMENT_STATUSES = ["all", "active", "scheduled", "expired", "draft"] as const;

    app.get("/api/admin/announcements", async (request: FastifyRequest, reply: FastifyReply) => {
        const check = await verifyAdminUser(request);
        if (!check.isAdmin) {
            reply.status(403);
            return { error: check.error };
        }

        const query = (request.query as any) || {};
        const statusFilter = String(query.status || "all");
        if (!ANNOUNCEMENT_STATUSES.includes(statusFilter as any)) {
            reply.status(400);
            return { error: `Trạng thái không hợp lệ. Chỉ chấp nhận: ${ANNOUNCEMENT_STATUSES.join(", ")}.` };
        }
        const kindFilter = query.kind ? String(query.kind) : "all";
        if (kindFilter !== "all" && !ANNOUNCEMENT_KINDS.includes(kindFilter as any)) {
            reply.status(400);
            return { error: `Loại thông báo không hợp lệ. Chỉ chấp nhận: ${ANNOUNCEMENT_KINDS.join(", ")}.` };
        }

        const page = parseInt(query.page, 10) || 1;
        const limit = parseInt(query.limit, 10) || 25;

        const result = await announcementsStore.listForAdmin({
            status: statusFilter as any,
            kind: kindFilter as any,
            search: String(query.search || ""),
            page,
            limit,
        });
        const stats = await announcementsStore.getStats();

        return { success: true, ...result, stats };
    });

    app.post("/api/admin/announcements", async (request: FastifyRequest, reply: FastifyReply) => {
        const check = await verifyAdminUser(request);
        if (!check.isAdmin) {
            reply.status(403);
            return { error: check.error };
        }

        const parsed = validateAnnouncementPayload(request.body, false);
        if (parsed.error || !parsed.value) {
            reply.status(400);
            return { error: parsed.error };
        }

        const created = await announcementsStore.create(parsed.value as AnnouncementInput, check.user?.email);
        auditAdminAction(request, check, {
            action: "admin.announcement_created",
            status: "success",
            details: { createdBy: check.user?.email, announcementId: created.id, title: created.title, kind: created.kind },
        });

        return { success: true, announcement: created };
    });

    app.patch(
        "/api/admin/announcements/:id",
        async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
            const check = await verifyAdminUser(request);
            if (!check.isAdmin) {
                reply.status(403);
                return { error: check.error };
            }

            const { id } = request.params;
            const existing = await announcementsStore.findById(id);
            if (!existing) {
                reply.status(404);
                return { error: "Không tìm thấy thông báo." };
            }

            const parsed = validateAnnouncementPayload(request.body, true);
            if (parsed.error || !parsed.value) {
                reply.status(400);
                return { error: parsed.error };
            }
            if (Object.keys(parsed.value).length === 0) {
                reply.status(400);
                return { error: "Không có trường nào để cập nhật." };
            }

            // Kiểm tra khoảng thời gian trên giá trị sau khi trộn với bản ghi hiện tại.
            const mergedStart = parsed.value.startsAt !== undefined ? parsed.value.startsAt : existing.startsAt;
            const mergedEnd = parsed.value.endsAt !== undefined ? parsed.value.endsAt : existing.endsAt;
            if (mergedStart && mergedEnd && new Date(mergedStart).getTime() >= new Date(mergedEnd).getTime()) {
                reply.status(400);
                return { error: "Thời gian kết thúc phải sau thời gian bắt đầu." };
            }

            const updated = await announcementsStore.update(id, parsed.value);
            auditAdminAction(request, check, {
                action: "admin.announcement_updated",
                status: "success",
                details: { updatedBy: check.user?.email, announcementId: id, fields: Object.keys(parsed.value) },
            });

            return { success: true, announcement: updated };
        }
    );

    app.post(
        "/api/admin/announcements/:id/toggle",
        async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
            const check = await verifyAdminUser(request);
            if (!check.isAdmin) {
                reply.status(403);
                return { error: check.error };
            }

            const { id } = request.params;
            const existing = await announcementsStore.findById(id);
            if (!existing) {
                reply.status(404);
                return { error: "Không tìm thấy thông báo." };
            }

            const updated = await announcementsStore.update(id, { isActive: !existing.isActive });
            auditAdminAction(request, check, {
                action: "admin.announcement_toggled",
                status: "success",
                details: { toggledBy: check.user?.email, announcementId: id, isActive: updated?.isActive },
            });

            return { success: true, announcement: updated };
        }
    );

    app.delete(
        "/api/admin/announcements/:id",
        async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
            const check = await verifyAdminUser(request);
            if (!check.isAdmin) {
                reply.status(403);
                return { error: check.error };
            }

            const { id } = request.params;
            const existing = await announcementsStore.findById(id);
            if (!existing) {
                reply.status(404);
                return { error: "Không tìm thấy thông báo." };
            }

            await announcementsStore.remove(id);
            auditAdminAction(request, check, {
                action: "admin.announcement_deleted",
                status: "warning",
                details: { deletedBy: check.user?.email, announcementId: id, title: existing.title },
            });

            return { success: true, message: "Đã xóa thông báo." };
        }
    );

    // ==========================================
    // HELPDESK / TICKETING
    // Quản trị xử lý yêu cầu hỗ trợ của người dùng:
    // xem danh sách, mở hội thoại, phản hồi (kể cả ghi chú nội bộ ẩn với
    // người dùng), đổi trạng thái và mức ưu tiên. Mọi thao tác ghi vào audit log.
    // ==========================================

    app.get("/api/admin/tickets", async (request: FastifyRequest, reply: FastifyReply) => {
        const check = await verifyAdminUser(request);
        if (!check.isAdmin) {
            reply.status(403);
            return { error: check.error };
        }

        const query = (request.query as any) || {};
        const statusFilter = String(query.status || "all");
        if (statusFilter !== "all" && !TICKET_STATUSES.includes(statusFilter as any)) {
            reply.status(400);
            return { error: `Trạng thái không hợp lệ. Chỉ chấp nhận: ${TICKET_STATUSES.join(", ")}.` };
        }
        const categoryFilter = String(query.category || "all");
        if (categoryFilter !== "all" && !TICKET_CATEGORIES.includes(categoryFilter as any)) {
            reply.status(400);
            return { error: `Danh mục không hợp lệ. Chỉ chấp nhận: ${TICKET_CATEGORIES.join(", ")}.` };
        }
        const priorityFilter = String(query.priority || "all");
        if (priorityFilter !== "all" && !TICKET_PRIORITIES.includes(priorityFilter as any)) {
            reply.status(400);
            return { error: `Mức ưu tiên không hợp lệ. Chỉ chấp nhận: ${TICKET_PRIORITIES.join(", ")}.` };
        }

        const page = parseInt(query.page, 10) || 1;
        const limit = parseInt(query.limit, 10) || 25;

        const result = await helpdeskStore.listForAdmin({
            status: statusFilter,
            category: categoryFilter,
            priority: priorityFilter,
            search: String(query.search || ""),
            page,
            limit,
        });
        const stats = await helpdeskStore.getStats();

        return { success: true, ...result, stats };
    });

    app.get("/api/admin/tickets/stats", async (request: FastifyRequest, reply: FastifyReply) => {
        const check = await verifyAdminUser(request);
        if (!check.isAdmin) {
            reply.status(403);
            return { error: check.error };
        }

        const stats = await helpdeskStore.getStats();
        return { success: true, stats };
    });

    app.get(
        "/api/admin/tickets/:id",
        async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
            const check = await verifyAdminUser(request);
            if (!check.isAdmin) {
                reply.status(403);
                return { error: check.error };
            }

            const ticket = await helpdeskStore.getTicket(request.params.id);
            if (!ticket) {
                reply.status(404);
                return { error: "Không tìm thấy yêu cầu hỗ trợ." };
            }

            return { success: true, ticket };
        }
    );

    app.post(
        "/api/admin/tickets/:id/messages",
        async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
            const check = await verifyAdminUser(request);
            if (!check.isAdmin) {
                reply.status(403);
                return { error: check.error };
            }

            const ticket = await helpdeskStore.findById(request.params.id);
            if (!ticket) {
                reply.status(404);
                return { error: "Không tìm thấy yêu cầu hỗ trợ." };
            }
            if (ticket.status === "closed") {
                reply.status(409);
                return { error: "Yêu cầu này đã đóng. Mở lại trước khi phản hồi." };
            }

            const body = (request.body as any) || {};
            const text = String(body.body ?? "").trim();
            if (text.length < 1 || text.length > 5000) {
                reply.status(400);
                return { error: "Nội dung phản hồi phải từ 1 đến 5000 ký tự." };
            }
            const isInternal = Boolean(body.isInternal);

            try {
                const updated = await helpdeskStore.addMessage(ticket.id, {
                    senderType: "admin",
                    senderId: check.user?.id,
                    senderEmail: check.user?.email,
                    body: text,
                    isInternal,
                });
                if (!updated) {
                    reply.status(404);
                    return { error: "Không tìm thấy yêu cầu hỗ trợ." };
                }

                auditAdminAction(request, check, {
                    action: isInternal ? "admin.ticket_noted" : "admin.ticket_replied",
                    status: isInternal ? "warning" : "success",
                    details: {
                        email: check.user?.email,
                        ticketId: ticket.id,
                        ticketCode: ticket.code,
                        isInternal,
                    },
                });

                return { success: true, ticket: updated };
            } catch (err: any) {
                reply.status(500);
                return { error: `Không gửi được phản hồi: ${err.message || err}` };
            }
        }
    );

    app.patch(
        "/api/admin/tickets/:id",
        async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
            const check = await verifyAdminUser(request);
            if (!check.isAdmin) {
                reply.status(403);
                return { error: check.error };
            }

            const existing = await helpdeskStore.findById(request.params.id);
            if (!existing) {
                reply.status(404);
                return { error: "Không tìm thấy yêu cầu hỗ trợ." };
            }

            const body = (request.body as any) || {};
            const patch: { status?: TicketStatus; priority?: TicketPriority } = {};

            if (body.status !== undefined) {
                const status = String(body.status);
                if (!TICKET_STATUSES.includes(status as any)) {
                    reply.status(400);
                    return { error: `Trạng thái không hợp lệ. Chỉ chấp nhận: ${TICKET_STATUSES.join(", ")}.` };
                }
                patch.status = status as TicketStatus;
            }
            if (body.priority !== undefined) {
                const priority = String(body.priority);
                if (!TICKET_PRIORITIES.includes(priority as any)) {
                    reply.status(400);
                    return { error: `Mức ưu tiên không hợp lệ. Chỉ chấp nhận: ${TICKET_PRIORITIES.join(", ")}.` };
                }
                patch.priority = priority as TicketPriority;
            }
            if (Object.keys(patch).length === 0) {
                reply.status(400);
                return { error: "Cần truyền ít nhất status hoặc priority để cập nhật." };
            }

            const updated = await helpdeskStore.updateTicket(existing.id, patch);
            if (!updated) {
                reply.status(404);
                return { error: "Không tìm thấy yêu cầu hỗ trợ." };
            }

            auditAdminAction(request, check, {
                action: "admin.ticket_updated",
                status: "warning",
                details: {
                    email: check.user?.email,
                    ticketId: existing.id,
                    ticketCode: existing.code,
                    ...patch,
                },
            });

            return { success: true, ticket: updated };
        }
    );

    // =========================================================================
    // Docker Logs Management (docker logs -f)
    // =========================================================================

    app.get("/api/admin/docker-logs/containers", async (request: FastifyRequest, reply: FastifyReply) => {
        const check = await verifyAdminUser(request);
        if (!check.isAdmin) {
            reply.status(403);
            return { error: check.error };
        }
        const containers = await getContainersStatus();
        return { containers };
    });

    app.get(
        "/api/admin/docker-logs/stream",
        async (
            request: FastifyRequest<{ Querystring: { container?: string; tail?: string } }>,
            reply: FastifyReply
        ) => {
            const check = await verifyAdminUser(request);
            if (!check.isAdmin) {
                reply.status(403);
                return { error: check.error };
            }

            const { container, tail: rawTail } = request.query;
            if (!container || !isAllowedContainer(container)) {
                reply.status(400);
                return { error: `Container không hợp lệ. Chỉ chấp nhận: ${ALLOWED_CONTAINERS.join(", ")}.` };
            }

            const tail = rawTail ? parseInt(rawTail, 10) : 100;
            const sanitizedTail = Number.isFinite(tail) && tail > 0 ? tail : 100;

            reply.raw.setHeader("Content-Type", "text/event-stream");
            reply.raw.setHeader("Cache-Control", "no-cache");
            reply.raw.setHeader("Connection", "keep-alive");
            reply.raw.flushHeaders();

            reply.raw.write(
                `event: connected\ndata: ${JSON.stringify({ container, timestamp: new Date().toISOString() })}\n\n`
            );

            const heartbeatTimer = setInterval(() => {
                try {
                    reply.raw.write(`: ping\n\n`);
                } catch {}
            }, 15000);

            const logHandle = streamDockerLogs(
                container as AllowedContainer,
                { tail: sanitizedTail, follow: true },
                {
                    onData: (text, streamType) => {
                        try {
                            reply.raw.write(
                                `event: log\ndata: ${JSON.stringify({ text, stream: streamType, timestamp: new Date().toISOString() })}\n\n`
                            );
                        } catch {}
                    },
                    onError: (err) => {
                        try {
                            reply.raw.write(`event: err\ndata: ${JSON.stringify({ message: err.message })}\n\n`);
                            reply.raw.end();
                        } catch {}
                    },
                    onEnd: () => {
                        try {
                            reply.raw.write(`event: end\ndata: ${JSON.stringify({ message: "Stream kết thúc" })}\n\n`);
                            reply.raw.end();
                        } catch {}
                    },
                }
            );

            const cleanup = () => {
                clearInterval(heartbeatTimer);
                logHandle.abort();
            };

            request.raw.on("close", cleanup);
            request.raw.on("error", cleanup);
        }
    );

    app.get(
        "/api/admin/docker-logs/download",
        async (
            request: FastifyRequest<{ Querystring: { container?: string; tail?: string } }>,
            reply: FastifyReply
        ) => {
            const check = await verifyAdminUser(request);
            if (!check.isAdmin) {
                reply.status(403);
                return { error: check.error };
            }

            const { container, tail: rawTail } = request.query;
            if (!container || !isAllowedContainer(container)) {
                reply.status(400);
                return { error: `Container không hợp lệ. Chỉ chấp nhận: ${ALLOWED_CONTAINERS.join(", ")}.` };
            }

            const tail = rawTail ? parseInt(rawTail, 10) : 1000;
            const sanitizedTail = Number.isFinite(tail) && tail > 0 ? tail : 1000;

            try {
                const text = await getDockerLogsSnapshot(container as AllowedContainer, sanitizedTail);
                const filename = `${container}-logs-${new Date().toISOString().slice(0, 10)}.txt`;

                reply.header("Content-Type", "text/plain; charset=utf-8");
                reply.header("Content-Disposition", `attachment; filename="${filename}"`);
                return reply.send(text);
            } catch (err: any) {
                reply.status(500);
                return { error: `Không thể tải log: ${err.message}` };
            }
        }
    );
}
