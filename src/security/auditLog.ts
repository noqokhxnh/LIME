import { v4 } from "uuid";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "../database/index.js";
import { getConfig } from "../config.js";

export interface AuditLogEntry {
    id: string;
    action: string;
    /**
     * Đối tượng bị tác động (người dùng/bản ghi mục tiêu), KHÔNG phải người thực hiện.
     * Với hành động do chính người dùng thực hiện (đăng nhập, đăng ký) thì trùng actor.
     */
    userId?: string;
    userEmail?: string;
    /** Người thực hiện hành động (admin hoặc chính chủ tài khoản). */
    actorId?: string;
    actorEmail?: string;
    /** IP của người thực hiện hành động. */
    ip?: string;
    status: "success" | "failure" | "warning";
    details?: any;
    timestamp: string;
}

/** Bộ lọc + phân trang cho danh sách nhật ký kiểm toán. */
export interface AuditLogQuery {
    limit?: number;
    offset?: number;
    /** Khớp một phần của `action` (không phân biệt hoa thường). */
    action?: string;
    status?: string;
    /** Tìm trong action, email, IP và nội dung details. */
    search?: string;
    /** ISO timestamp — chỉ lấy log từ thời điểm này trở đi. */
    from?: string;
    /** ISO timestamp — chỉ lấy log tới thời điểm này. */
    to?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Cột `user_id`/`actor_id` là kiểu UUID trong PostgreSQL, nhưng một số phiên test
 * hoặc tài khoản đặc biệt dùng id dạng chuỗi. Trả về `null` để bản ghi vẫn lưu được
 * thay vì làm hỏng cả câu INSERT.
 */
function asUuid(value?: string | null): string | null {
    return value && UUID_RE.test(value) ? value : null;
}

function mapAuditRow(r: any): AuditLogEntry {
    return {
        id: r.id,
        action: r.action,
        userId: r.user_id || undefined,
        userEmail: r.user_email || undefined,
        actorId: r.actor_id || undefined,
        actorEmail: r.actor_email || undefined,
        ip: r.ip_address || undefined,
        status: r.status as AuditLogEntry["status"],
        details: r.details,
        timestamp: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
    };
}

const auditLogs: AuditLogEntry[] = [];
const MAX_LOGS = 1000;
const STORAGE_FILE = join(process.cwd(), "data", "audit-logs.json");
const isTestEnv = process.env.NODE_ENV === "test" || process.argv.some((arg) => arg.includes("test"));

let isLoaded = false;

function ensureLoaded(): void {
    if (isLoaded) return;
    isLoaded = true;

    try {
        if (existsSync(STORAGE_FILE)) {
            const raw = readFileSync(STORAGE_FILE, "utf8");
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                auditLogs.length = 0;
                auditLogs.push(...parsed);
                return;
            }
        }
    } catch (err) {
        console.error("[AuditLog] Failed to read audit logs from disk:", err);
    }
}

function saveToDisk(): void {
    if (isTestEnv) return;

    try {
        const dir = join(process.cwd(), "data");
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
        const data = JSON.stringify(auditLogs.slice(0, MAX_LOGS), null, 2);
        writeFileSync(STORAGE_FILE, data, "utf8");
    } catch (err: any) {
        if (err?.code !== "EACCES") {
            console.error("[AuditLog] Failed to persist audit logs to disk:", err);
        }
    }
}

async function persistToDb(item: AuditLogEntry): Promise<void> {
    const config = getConfig();
    if (!config.DATABASE_URL) return;

    try {
        await db.query(
            `INSERT INTO audit_logs (id, action, user_id, user_email, actor_id, actor_email, ip_address, status, details, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (id) DO NOTHING`,
            [
                item.id,
                item.action,
                asUuid(item.userId),
                item.userEmail || null,
                asUuid(item.actorId),
                item.actorEmail || null,
                item.ip || null,
                item.status,
                item.details ? JSON.stringify(item.details) : null,
                item.timestamp,
            ]
        );
    } catch (err) {
        console.error("[AuditLog] Failed to persist log to database:", err);
    }
}

/**
 * Các lần ghi DB đang chờ (fire-and-forget). Trước khi đọc lại từ DB, phải chờ chúng
 * xong, nếu không bản ghi vừa tạo trong cùng tiến trình có thể chưa xuất hiện.
 */
const pendingWrites = new Set<Promise<unknown>>();

function trackWrite<T>(promise: Promise<T>): Promise<T> {
    pendingWrites.add(promise);
    const done = () => pendingWrites.delete(promise);
    promise.then(done, done);
    return promise;
}

async function flushPendingWrites(): Promise<void> {
    while (pendingWrites.size > 0) {
        await Promise.allSettled([...pendingWrites]);
    }
}

/**
 * Dựng mệnh đề WHERE dùng chung cho `list()` và `clear()` (đều lọc theo cùng bộ tiêu chí).
 */
function buildLogWhere(filter: AuditLogQuery): { whereClause: string; params: any[] } {
    const params: any[] = [];
    const conditions: string[] = [];
    const action = (filter.action || "").trim();
    const status = (filter.status || "").trim();
    const search = (filter.search || "").trim();
    const from = (filter.from || "").trim();
    const to = (filter.to || "").trim();

    if (action) {
        params.push(`%${action}%`);
        conditions.push(`action ILIKE $${params.length}`);
    }
    if (status) {
        params.push(status);
        conditions.push(`status = $${params.length}`);
    }
    if (from) {
        params.push(from);
        conditions.push(`created_at >= $${params.length}`);
    }
    if (to) {
        params.push(to);
        conditions.push(`created_at <= $${params.length}`);
    }
    if (search) {
        params.push(`%${search}%`);
        const p = `$${params.length}`;
        conditions.push(
            `(action ILIKE ${p} OR COALESCE(user_email, '') ILIKE ${p} OR COALESCE(actor_email, '') ILIKE ${p}` +
            ` OR COALESCE(ip_address, '') ILIKE ${p} OR COALESCE(details::text, '') ILIKE ${p})`
        );
    }

    return {
        whereClause: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
        params,
    };
}

/**
 * Bản sao ngữ nghĩa của `buildLogWhere` cho chế độ in-memory (không có PostgreSQL).
 */
function matchesFilter(entry: AuditLogEntry, filter: AuditLogQuery): boolean {
    const action = (filter.action || "").trim().toLowerCase();
    const status = (filter.status || "").trim();
    const search = (filter.search || "").trim().toLowerCase();
    const fromTs = filter.from ? new Date(filter.from).getTime() : NaN;
    const toTs = filter.to ? new Date(filter.to).getTime() : NaN;

    if (action && !entry.action.toLowerCase().includes(action)) return false;
    if (status && entry.status !== status) return false;

    const ts = new Date(entry.timestamp).getTime();
    if (!Number.isNaN(fromTs) && ts < fromTs) return false;
    if (!Number.isNaN(toTs) && ts > toTs) return false;

    if (search) {
        const haystack = [
            entry.action,
            entry.userEmail,
            entry.actorEmail,
            entry.ip,
            entry.details ? JSON.stringify(entry.details) : "",
        ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
        if (!haystack.includes(search)) return false;
    }
    return true;
}

/** Thêm bản ghi vào bộ nhớ (không ghi DB) và trả về bản ghi đã tạo. */
function storeLocally(entry: Omit<AuditLogEntry, "id" | "timestamp">): AuditLogEntry {
    ensureLoaded();
    const item: AuditLogEntry = {
        id: v4(),
        timestamp: new Date().toISOString(),
        ...entry,
    };
    auditLogs.unshift(item);
    if (auditLogs.length > MAX_LOGS) {
        auditLogs.pop();
    }
    saveToDisk();
    return item;
}

export const auditLog = {
    record(entry: Omit<AuditLogEntry, "id" | "timestamp">): AuditLogEntry {
        const item = storeLocally(entry);
        trackWrite(persistToDb(item));
        return item;
    },

    /**
     * Như `record()` nhưng chờ ghi xong bản ghi vào PostgreSQL.
     *
     * Dùng cho các sự kiện mà ngay sau đó cần truy vấn lại từ DB (ví dụ: lịch sử
     * đăng nhập hiển thị ở cổng quản trị).
     */
    async recordAndPersist(entry: Omit<AuditLogEntry, "id" | "timestamp">): Promise<AuditLogEntry> {
        const item = storeLocally(entry);
        await trackWrite(persistToDb(item));
        return item;
    },

    getRecent(limit: number = 50, actionFilter?: string): AuditLogEntry[] {
        ensureLoaded();
        let results = auditLogs;
        if (actionFilter) {
            results = results.filter((l) => l.action.toLowerCase().includes(actionFilter.toLowerCase()));
        }
        return results.slice(0, limit);
    },

    /**
     * Truy vấn nhật ký kèm lọc + phân trang.
     *
     * Khi có PostgreSQL thì đọc thẳng từ bảng `audit_logs` (đầy đủ lịch sử, không bị
     * giới hạn 1000 bản ghi giữ trong bộ nhớ và vẫn còn sau khi khởi động lại); khi
     * chạy in-memory thì lọc trên mảng bộ nhớ với ngữ nghĩa tương đương.
     *
     * Trả về `total` là tổng số bản ghi khớp bộ lọc (để phân trang), không phải số
     * bản ghi của trang hiện tại.
     */
    async list(query: AuditLogQuery = {}): Promise<{ logs: AuditLogEntry[]; total: number }> {
        ensureLoaded();
        const limit = Number.isFinite(query.limit)
            ? Math.min(Math.max(Math.round(Number(query.limit)), 1), 500)
            : 150;
        const offset = Number.isFinite(query.offset) ? Math.max(Math.round(Number(query.offset)), 0) : 0;

        const config = getConfig();
        if (config.DATABASE_URL) {
            try {
                // Chờ các lần ghi nền hoàn tất để bản ghi vừa tạo trong cùng tiến
                // trình chắc chắn đã có trong DB.
                await flushPendingWrites();

                const { whereClause, params } = buildLogWhere(query);

                const countRes = await db.query(
                    `SELECT COUNT(*)::int AS total FROM audit_logs ${whereClause}`,
                    params
                );
                const total = Number(countRes.rows[0]?.total ?? 0);

                const pageParams = [...params, limit, offset];
                const res = await db.query(
                    `SELECT id, action, user_id, user_email, actor_id, actor_email, ip_address, status, details, created_at
                     FROM audit_logs
                     ${whereClause}
                     ORDER BY created_at DESC
                     LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`,
                    pageParams
                );

                return { logs: res.rows.map(mapAuditRow), total };
            } catch (err) {
                console.error("[AuditLog] Lỗi truy vấn DB trong list():", err);
            }
        }

        const filtered = auditLogs.filter((entry) => matchesFilter(entry, query));
        return { logs: filtered.slice(offset, offset + limit), total: filtered.length };
    },

    /**
     * Xoá nhật ký.
     *
     * Không truyền bộ lọc = xoá sạch. Có thể truyền `action`/`status`/`from`/`to` để chỉ
     * xoá các bản ghi khớp (ví dụ dọn riêng một loại hành động).
     *
     * Đây là thao tác phá huỷ nên phải CHỜ ghi xong rồi mới báo thành công: trước đây
     * `TRUNCATE TABLE` được bắn đi mà không chờ (fire-and-forget), nên (1) lỗi bị bỏ
     * qua và API vẫn báo xoá thành công, (2) bản ghi "đã xoá nhật ký" ghi ngay sau đó
     * có thể bị chính lệnh TRUNCATE đang chạy xoá mất — mất dấu vết người thực hiện,
     * (3) một lần ghi đang chờ có thể "hồi sinh" bản ghi ngay sau khi đã xoá.
     */
    async clear(filter: AuditLogQuery = {}): Promise<void> {
        ensureLoaded();
        const hasFilter = Boolean(
            (filter.action || "").trim() ||
            (filter.status || "").trim() ||
            (filter.search || "").trim() ||
            (filter.from || "").trim() ||
            (filter.to || "").trim()
        );

        const config = getConfig();
        if (config.DATABASE_URL) {
            await flushPendingWrites();
        }

        if (hasFilter) {
            const remaining = auditLogs.filter((entry) => !matchesFilter(entry, filter));
            auditLogs.length = 0;
            auditLogs.push(...remaining);
        } else {
            auditLogs.length = 0;
        }
        saveToDisk();

        if (config.DATABASE_URL) {
            const { whereClause, params } = buildLogWhere(filter);
            await db.query(`DELETE FROM audit_logs ${whereClause}`, params);
        }
    },

    async initFromDatabase(): Promise<void> {
        ensureLoaded();
        const config = getConfig();
        if (!config.DATABASE_URL) return;

        try {
            const res = await db.query(
                `SELECT id, action, user_id, user_email, actor_id, actor_email, ip_address, status, details, created_at
                 FROM audit_logs
                 ORDER BY created_at DESC
                 LIMIT 500`
            );
            if (res.rows.length > 0) {
                const dbLogs: AuditLogEntry[] = res.rows.map(mapAuditRow);

                const existingIds = new Set(auditLogs.map((l) => l.id));
                for (const item of dbLogs) {
                    if (!existingIds.has(item.id)) {
                        auditLogs.push(item);
                        existingIds.add(item.id);
                    }
                }
                auditLogs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
                saveToDisk();
            }
        } catch (err) {
            console.error("[AuditLog] Failed to load logs from database:", err);
        }
    },
};
