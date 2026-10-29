import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "../database/index.js";
import { getConfig } from "../config.js";
import { auditLog, type AuditLogEntry } from "../security/auditLog.js";
import { LOGIN_ACTIONS, type AuthEventAction } from "../auth/loginAudit.js";

export type SubscriptionTier = "free" | "creator" | "pro" | "max" | "enterprise";
export type UserRole = "user" | "admin";

/** Các tier hợp lệ: khớp với bảng `plans` (creator/pro/max) và tier phi trả phí (free/enterprise). */
export const USER_TIERS: SubscriptionTier[] = ["free", "creator", "pro", "max", "enterprise"];

/** Tier gắn với một gói cước có thật trong bảng `plans` (id gói trùng tên tier). */
export const PLAN_BACKED_TIERS = new Set<string>(["creator", "pro", "max"]);

export interface AdminUserRecord {
    id: string;
    username: string;
    name: string;
    email: string;
    role: UserRole;
    tier: string;
    credits: number;
    totalCredits: number;
    creditPercent: number;
    status: "active" | "banned";
    provider: "local" | "google";
    planId?: string | null;
    planExpiresAt?: string | null;
    createdAt: string;
    updatedAt: string;
    deletedAt?: string | null;
    lastLoginIp?: string;
    lastLoginAt?: string | null;
    signupIp?: string;
    lastLocation?: string;
    lastIsp?: string;
}

/** Bộ lọc + sắp xếp + phân trang cho danh sách người dùng ở cổng quản trị. */
export interface AdminUserQuery {
    search?: string;
    role?: string;
    tier?: string;
    status?: string;
    includeDeleted?: boolean;
    /** Chỉ lấy đúng các ID này (dùng cho "xuất CSV người dùng đã chọn"). */
    ids?: string[];
    sortBy?: string;
    sortOrder?: "asc" | "desc";
    page?: number;
    limit?: number;
}

/** Một dòng lịch sử đăng nhập hiển thị ở cổng quản trị. */
export interface UserLoginLog {
    id: string;
    action: string;
    ipAddress: string | null;
    location: string | null;
    isp: string | null;
    userAgent: string;
    provider: string;
    status: string;
    createdAt: string;
}

const ADMIN_USERS_MAX_LIMIT = 100;
const ADMIN_USERS_DEFAULT_LIMIT = 25;
/** Giới hạn khi xuất CSV (không phân trang). */
export const ADMIN_USERS_EXPORT_MAX = 10000;

/**
 * Cột người dùng + thông tin đăng nhập gần nhất.
 *
 * Thông tin IP/vị trí được suy ra từ `audit_logs` (nguồn duy nhất) thay vì các
 * cột `last_login_ip`/`last_location`/`signup_ip` vốn chưa từng tồn tại trong
 * bảng `users` — đó là lý do bảng quản trị luôn hiển thị "N/A" và "Chưa đăng nhập".
 */
const USER_SELECT_SQL = `
    u.id, u.username, u.display_name, u.email, u.role, u.tier, u.credits, u.total_credits, u.status,
    u.google_id, u.plan_id, u.plan_expires_at, u.created_at, u.updated_at, u.deleted_at,
    ll.ip_address AS last_login_ip,
    ll.created_at AS last_login_at,
    ll.details->>'location' AS last_location,
    ll.details->>'isp' AS last_isp,
    sl.ip_address AS signup_ip
`;

const USER_SELECT_FROM_SQL = `
    FROM users u
    LEFT JOIN LATERAL (
        SELECT ip_address, created_at, details
        FROM audit_logs
        WHERE user_id = u.id AND action = 'auth.login' AND status = 'success'
        ORDER BY created_at DESC
        LIMIT 1
    ) ll ON TRUE
    LEFT JOIN LATERAL (
        SELECT ip_address
        FROM audit_logs
        WHERE user_id = u.id AND action = 'auth.register'
        ORDER BY created_at ASC
        LIMIT 1
    ) sl ON TRUE
`;

const USER_SORT_COLUMNS: Record<string, string> = {
    createdAt: "created_at",
    credits: "credits",
    name: "username",
    email: "email",
    role: "role",
    tier: "tier",
    status: "status",
    lastLoginAt: "last_login_at",
};

function normalizeAdminUserPaging(params: AdminUserQuery, maxLimit = ADMIN_USERS_MAX_LIMIT) {
    const rawLimit = Number(params.limit);
    const limit =
        Number.isFinite(rawLimit) && rawLimit > 0
            ? Math.min(Math.floor(rawLimit), maxLimit)
            : ADMIN_USERS_DEFAULT_LIMIT;
    const rawPage = Number(params.page);
    const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;
    return { page, limit, offset: (page - 1) * limit };
}

/** Dựng mệnh đề WHERE trên các cột đã được expose bởi USER_SELECT_SQL. */
function buildAdminUserWhere(params: AdminUserQuery): { whereClause: string; values: any[] } {
    const conditions: string[] = [];
    const values: any[] = [];

    if (params.ids && params.ids.length > 0) {
        values.push(params.ids);
        conditions.push(`id::text = ANY($${values.length}::text[])`);
    }

    const status = params.status && params.status !== "all" ? params.status : undefined;
    if (status === "deleted") {
        conditions.push("deleted_at IS NOT NULL");
    } else if (status === "banned") {
        conditions.push("status = 'banned' AND deleted_at IS NULL");
    } else if (status === "active") {
        conditions.push("status <> 'banned' AND deleted_at IS NULL");
    } else if (!params.includeDeleted) {
        conditions.push("deleted_at IS NULL");
    }

    if (params.role && params.role !== "all") {
        values.push(params.role);
        conditions.push(`role = $${values.length}`);
    }

    if (params.tier && params.tier !== "all") {
        values.push(params.tier);
        conditions.push(`tier = $${values.length}`);
    }

    const search = (params.search || "").trim();
    if (search) {
        values.push(`%${search}%`);
        const i = values.length;
        conditions.push(
            `(username ILIKE $${i} OR display_name ILIKE $${i} OR email ILIKE $${i} OR id::text ILIKE $${i}` +
                ` OR COALESCE(last_login_ip, '') ILIKE $${i}` +
                ` OR COALESCE(signup_ip, '') ILIKE $${i}` +
                ` OR COALESCE(last_location, '') ILIKE $${i}` +
                ` OR COALESCE(last_isp, '') ILIKE $${i})`
        );
    }

    return {
        whereClause: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
        values,
    };
}

/** Sắp xếp an toàn theo whitelist + khoá phụ để phân trang ổn định. */
function buildAdminUserOrder(params: AdminUserQuery): string {
    const column = USER_SORT_COLUMNS[params.sortBy || "createdAt"] || "created_at";
    const direction = params.sortOrder === "asc" ? "ASC" : "DESC";
    return `${column} ${direction}, id ASC`;
}

const STORAGE_FILE = join(process.cwd(), "data", "users.json");
const isTestEnv = process.env.NODE_ENV === "test" || process.argv.some((arg) => arg.includes("test"));

const SUPER_ADMIN_UUID = "00000000-0000-4000-a000-000000000001";
const ADMIN_EMAIL = "khanh2k5xxx@gmail.com";

const inMemoryUsers = new Map<string, AdminUserRecord>();
let isLoaded = false;

function ensureLoaded(): void {
    if (isLoaded) return;
    isLoaded = true;

    // Seed Super Admin by default
    const now = new Date().toISOString();
    const superAdmin: AdminUserRecord = {
        id: SUPER_ADMIN_UUID,
        username: "khanh2k5xxx",
        name: "Nguyễn Quang Khánh",
        email: ADMIN_EMAIL,
        role: "admin",
        tier: "enterprise",
        credits: 10000,
        totalCredits: 10000,
        creditPercent: 100,
        status: "active",
        provider: "local",
        createdAt: now,
        updatedAt: now,
    };
    inMemoryUsers.set(superAdmin.id, superAdmin);
    inMemoryUsers.set(superAdmin.email.toLowerCase(), superAdmin);

    try {
        // Khi đã có DATABASE_URL, Postgres là nguồn sự thật duy nhất: không
        // nạp users.json (bản sao bóng có thể chứa user đã bị xoá/khoá ở DB
        // và cả hash mật khẩu) vào bộ nhớ nữa.
        if (!getConfig().DATABASE_URL && existsSync(STORAGE_FILE)) {
            const raw = readFileSync(STORAGE_FILE, "utf8");
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                for (const u of parsed) {
                    if (u && u.id) {
                        inMemoryUsers.set(u.id, u);
                        if (u.email) inMemoryUsers.set(u.email.toLowerCase(), u);
                    }
                }
            }
        }
    } catch (err) {
        console.error("[UserStore] Failed to read users from disk:", err);
    }
}

function saveToDisk(): void {
    if (isTestEnv) return;
    // Có DATABASE_URL thì không ghi bản sao bóng users.json ra đĩa (tránh
    // tồn đọng PII/hash mật khẩu ngoài DB và tránh nạp lại dữ liệu cũ).
    if (getConfig().DATABASE_URL) return;
    try {
        const dir = join(process.cwd(), "data");
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
        const unique = Array.from(new Set(inMemoryUsers.values()));
        writeFileSync(STORAGE_FILE, JSON.stringify(unique, null, 2), "utf8");
    } catch (err: any) {
        if (err?.code !== "EACCES") {
            console.error("[UserStore] Failed to persist users to disk:", err);
        }
    }
}

function formatUserRow(row: any): AdminUserRecord {
    const credits = Number(row.credits ?? 20);
    const totalCredits = Math.max(Number(row.total_credits ?? 20), 1);
    const creditPercent = Math.min(100, Math.max(0, Math.round((credits / totalCredits) * 100)));
    const username = row.username || row.email?.split("@")[0] || "user";
    const emailLocalPart = row.email?.split("@")[0] || "";
    // Tài khoản Google cũ có username `google_<id>_<hex>`; nếu chưa có
    // display_name thì hiển thị phần trước @ của email thay vì ID.
    const fallbackName =
        /^google_[A-Za-z0-9]+_[0-9a-f]+$/i.test(username) && emailLocalPart
            ? emailLocalPart
            : username;

    return {
        id: row.id,
        username,
        name: row.display_name || fallbackName || "User",
        email: row.email,
        role: row.role === "admin" ? "admin" : "user",
        tier: row.tier || "free",
        credits,
        totalCredits,
        creditPercent,
        status: row.status === "banned" ? "banned" : "active",
        provider: row.google_id ? "google" : "local",
        planId: row.plan_id || null,
        planExpiresAt: row.plan_expires_at ? new Date(row.plan_expires_at).toISOString() : null,
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
        updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
        deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : null,
        lastLoginIp: row.last_login_ip || undefined,
        lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : null,
        signupIp: row.signup_ip || undefined,
        lastLocation: row.last_location || undefined,
        lastIsp: row.last_isp || undefined,
    };
}

export const userStore = {
    async findById(id: string): Promise<AdminUserRecord | null> {
        ensureLoaded();
        const config = getConfig();
        if (config.DATABASE_URL) {
            try {
                // LƯU Ý: không được viết `WHERE id = $1 OR LOWER(email) = LOWER($1)`.
                // PostgreSQL suy luận kiểu tham số từ cả hai vế nên câu lệnh lỗi
                // "function lower(uuid) does not exist", khiến findById luôn thất bại
                // và âm thầm rơi về cache bộ nhớ (nguyên nhân gốc của việc cổng quản
                // trị hiển thị dữ liệu cũ/N/A và /api/auth/me trả 401 sai).
                const uuidLike = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
                    id
                );
                const whereClause = uuidLike
                    ? "u.id = $1::uuid"
                    : "LOWER(u.email) = LOWER($1)";
                const res = await db.query(
                    `SELECT ${USER_SELECT_SQL}
                     ${USER_SELECT_FROM_SQL}
                     WHERE ${whereClause}
                     LIMIT 1`,
                    [id]
                );
                if (res.rows.length > 0) {
                    const u = formatUserRow(res.rows[0]);
                    inMemoryUsers.set(u.id, u);
                    inMemoryUsers.set(u.email.toLowerCase(), u);
                    return u;
                }
            } catch (err) {
                // DB query may fail if DB is offline, fall back to memory
                console.error("[UserStore] DB error in findById:", err);
            }
        }
        return inMemoryUsers.get(id) || inMemoryUsers.get(id.toLowerCase()) || null;
    },

    async upsertUser(user: Partial<AdminUserRecord> & { id: string }): Promise<AdminUserRecord> {
        ensureLoaded();
        const existing = inMemoryUsers.get(user.id);
        const credits = Number(user.credits ?? existing?.credits ?? 20);
        const totalCredits = Math.max(Number(user.totalCredits ?? existing?.totalCredits ?? 20), 1);
        const creditPercent = Math.min(100, Math.max(0, Math.round((credits / totalCredits) * 100)));

        const record: AdminUserRecord = {
            id: user.id,
            username: user.username || existing?.username || user.email?.split("@")[0] || "user",
            name: user.name || existing?.name || user.username || "User",
            email: user.email || existing?.email || `${user.id}@example.com`,
            role: user.role || existing?.role || "user",
            tier: user.tier || existing?.tier || "free",
            credits,
            totalCredits,
            creditPercent,
            status: user.status || existing?.status || "active",
            provider: user.provider || existing?.provider || "local",
            planId: user.planId ?? existing?.planId ?? null,
            planExpiresAt: user.planExpiresAt ?? existing?.planExpiresAt ?? null,
            createdAt: user.createdAt || existing?.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            deletedAt: user.deletedAt ?? existing?.deletedAt ?? null,
            lastLoginIp: user.lastLoginIp ?? existing?.lastLoginIp,
            lastLoginAt: user.lastLoginAt ?? existing?.lastLoginAt ?? null,
            signupIp: user.signupIp ?? existing?.signupIp,
            lastLocation: user.lastLocation ?? existing?.lastLocation,
            lastIsp: user.lastIsp ?? existing?.lastIsp,
        };

        inMemoryUsers.set(record.id, record);
        inMemoryUsers.set(record.email.toLowerCase(), record);
        saveToDisk();
        return record;
    },

    async listUsers(options?: { includeDeleted?: boolean }): Promise<AdminUserRecord[]> {
        ensureLoaded();
        const config = getConfig();
        if (config.DATABASE_URL) {
            try {
                let query = `
                    SELECT ${USER_SELECT_SQL}
                    ${USER_SELECT_FROM_SQL}
                `;
                if (!options?.includeDeleted) {
                    query += ` WHERE u.deleted_at IS NULL`;
                }
                query += ` ORDER BY u.created_at DESC`;
                const res = await db.query(query);
                const list = res.rows.map(formatUserRow);
                for (const u of list) {
                    inMemoryUsers.set(u.id, u);
                    inMemoryUsers.set(u.email.toLowerCase(), u);
                }
                return list;
            } catch (err) {
                console.error("[UserStore] DB error in listUsers:", err);
            }
        }

        const unique = Array.from(new Set(inMemoryUsers.values()));
        if (options?.includeDeleted) return unique;
        return unique.filter((u) => !u.deletedAt);
    },

    /**
     * Tìm nhanh ID người dùng khớp `search` theo username/email/tên.
     *
     * Dùng cho tìm kiếm job theo email người tạo: thay vì nạp toàn bộ bảng `users`
     * vào RAM rồi so khớp, ta để PostgreSQL lọc (tận dụng chỉ mục trigram
     * `idx_users_email_trgm` / `idx_users_username_trgm`).
     */
    async findIdsBySearch(search: string, limit = 500): Promise<string[]> {
        ensureLoaded();
        const term = (search || "").trim();
        if (!term) return [];
        const config = getConfig();

        if (config.DATABASE_URL) {
            try {
                const res = await db.query(
                    `SELECT id::text AS id FROM users
                     WHERE deleted_at IS NULL
                       AND (username ILIKE $1 OR email ILIKE $1 OR COALESCE(name, '') ILIKE $1)
                     LIMIT $2`,
                    [`%${term}%`, limit]
                );
                return res.rows.map((r: any) => String(r.id));
            } catch (err) {
                console.error("[UserStore] DB error in findIdsBySearch:", err);
            }
        }

        const unique = Array.from(new Set(inMemoryUsers.values()));
        const needle = term.toLowerCase();
        return unique
            .filter((u) => !u.deletedAt)
            .filter((u) => `${u.username} ${u.email} ${u.name || ""}`.toLowerCase().includes(needle))
            .slice(0, limit)
            .map((u) => u.id);
    },

    /**
     * Tra cứu email của nhiều người dùng trong **một** truy vấn (`id = ANY(...)`)
     * thay vì gọi `findById` từng người — dùng khi làm giàu danh sách job.
     */
    async findEmailsByIds(ids: string[]): Promise<Map<string, string>> {
        ensureLoaded();
        const map = new Map<string, string>();
        const unique = Array.from(new Set((ids || []).filter((id): id is string => Boolean(id))));
        if (unique.length === 0) return map;
        const config = getConfig();

        if (config.DATABASE_URL) {
            try {
                const res = await db.query(
                    `SELECT id::text AS id, email FROM users WHERE id::text = ANY($1::text[])`,
                    [unique]
                );
                for (const row of res.rows) map.set(String(row.id), row.email);
                return map;
            } catch (err) {
                console.error("[UserStore] DB error in findEmailsByIds:", err);
            }
        }

        for (const id of unique) {
            const u = inMemoryUsers.get(id) || inMemoryUsers.get(id.toLowerCase());
            if (u?.email) map.set(id, u.email);
        }
        return map;
    },

    /**
     * Danh sách người dùng cho cổng quản trị: lọc + sắp xếp + phân trang ở phía server.
     *
     * Trước đây route `/api/admin/users` nạp toàn bộ bảng `users` vào RAM rồi mới
     * lọc/sắp xếp/phân trang, khiến mỗi lần mở tab Người dùng phải đọc hết mọi bản
     * ghi. Nay đẩy hết xuống SQL để tận dụng các chỉ mục
     * `idx_users_active_created_at`, `idx_users_role/tier/status` và chỉ mục
     * trigram cho tìm kiếm chuỗi con.
     */
    async listUsersForAdmin(
        params: AdminUserQuery = {},
        options: { maxLimit?: number } = {}
    ): Promise<{ users: AdminUserRecord[]; total: number }> {
        ensureLoaded();
        const maxLimit = options.maxLimit ?? ADMIN_USERS_MAX_LIMIT;
        const { limit, offset } = normalizeAdminUserPaging(params, maxLimit);
        const config = getConfig();

        if (config.DATABASE_URL) {
            try {
                const { whereClause, values } = buildAdminUserWhere(params);
                const orderClause = buildAdminUserOrder(params);

                const countRes = await db.query(
                    `WITH base AS (SELECT ${USER_SELECT_SQL} ${USER_SELECT_FROM_SQL})
                     SELECT COUNT(*)::int AS total FROM base ${whereClause}`,
                    values
                );
                const total = Number(countRes.rows[0]?.total ?? 0);

                const listValues = [...values, limit, offset];
                const res = await db.query(
                    `WITH base AS (SELECT ${USER_SELECT_SQL} ${USER_SELECT_FROM_SQL})
                     SELECT * FROM base ${whereClause}
                     ORDER BY ${orderClause}
                     LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
                    listValues
                );

                const users = res.rows.map(formatUserRow);
                for (const u of users) {
                    inMemoryUsers.set(u.id, u);
                    inMemoryUsers.set(u.email.toLowerCase(), u);
                }
                return { users, total };
            } catch (err) {
                console.error("[UserStore] DB error in listUsersForAdmin:", err);
            }
        }

        // Không có DB: mô phỏng đúng ngữ nghĩa bộ lọc/sắp xếp của SQL ở trên.
        const status = params.status && params.status !== "all" ? params.status : undefined;
        const role = params.role && params.role !== "all" ? params.role : undefined;
        const tier = params.tier && params.tier !== "all" ? params.tier : undefined;
        const search = (params.search || "").trim().toLowerCase();

        const list = Array.from(new Set(inMemoryUsers.values())).filter((u) => {
            const isDeleted = Boolean(u.deletedAt);
            if (params.ids && params.ids.length > 0 && !params.ids.includes(u.id)) return false;
            if (status === "deleted" && !isDeleted) return false;
            if (status === "banned" && !(u.status === "banned" && !isDeleted)) return false;
            if (status === "active" && !(u.status !== "banned" && !isDeleted)) return false;
            if (!status && !params.includeDeleted && isDeleted) return false;
            if (role && u.role !== role) return false;
            if (tier && u.tier !== tier) return false;
            if (search) {
                const haystack = [
                    u.username,
                    u.email,
                    u.id,
                    u.name,
                    u.lastLoginIp,
                    u.signupIp,
                    u.lastLocation,
                    u.lastIsp,
                ]
                    .filter(Boolean)
                    .join(" ")
                    .toLowerCase();
                if (!haystack.includes(search)) return false;
            }
            return true;
        });

        const sortBy = params.sortBy || "createdAt";
        const direction = params.sortOrder === "asc" ? 1 : -1;
        const valueOf = (u: AdminUserRecord): string | number => {
            switch (sortBy) {
                case "credits":
                    return u.credits;
                case "name":
                    return (u.username || "").toLowerCase();
                case "email":
                    return (u.email || "").toLowerCase();
                case "role":
                    return u.role;
                case "tier":
                    return u.tier;
                case "status":
                    return u.status;
                case "lastLoginAt":
                    return u.lastLoginAt || "";
                default:
                    return u.createdAt;
            }
        };
        list.sort((a, b) => {
            const va = valueOf(a);
            const vb = valueOf(b);
            if (va < vb) return -1 * direction;
            if (va > vb) return 1 * direction;
            return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        });

        return { users: list.slice(offset, offset + limit), total: list.length };
    },

    async updateUserRole(userId: string, role: UserRole): Promise<AdminUserRecord | null> {
        ensureLoaded();
        const config = getConfig();
        if (config.DATABASE_URL) {
            try {
                await db.query(
                    `UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2`,
                    [role, userId]
                );
            } catch (err) {
                console.error("[UserStore] DB error in updateUserRole:", err);
            }
        }
        const u = await this.findById(userId);
        if (u) {
            u.role = role;
            u.updatedAt = new Date().toISOString();
            saveToDisk();
        }
        return u;
    },

    async updateTier(userId: string, tier: string, durationDays: number = 30): Promise<AdminUserRecord | null> {
        ensureLoaded();
        const config = getConfig();
        // Đồng bộ `plan_id` với tier: chỉ free/enterprise là không gắn với một gói
        // bán ra cụ thể (creator/pro/max). Trước đây chỉ đổi `tier` nên `plan_id` vẫn
        // giữ giá trị cũ, khiến hồ sơ người dùng hiển thị gói cước mâu thuẫn.
        const planId = PLAN_BACKED_TIERS.has(tier) ? tier : null;
        if (config.DATABASE_URL) {
            try {
                await db.query(
                    `UPDATE users
                     SET tier = $1,
                         plan_id = $2,
                         plan_expires_at = NOW() + ($3 || ' days')::interval,
                         updated_at = NOW()
                     WHERE id = $4`,
                    [tier, planId, durationDays.toString(), userId]
                );
            } catch (err) {
                console.error("[UserStore] DB error in updateTier:", err);
            }
        }
        const u = await this.findById(userId);
        if (u) {
            u.tier = tier;
            u.planId = planId;
            const exp = new Date();
            exp.setDate(exp.getDate() + durationDays);
            u.planExpiresAt = exp.toISOString();
            u.updatedAt = new Date().toISOString();
            saveToDisk();
        }
        return u;
    },

    async setCredits(userId: string, credits: number): Promise<AdminUserRecord | null> {
        ensureLoaded();
        const safeCredits = Math.max(0, credits);
        const config = getConfig();
        if (config.DATABASE_URL) {
            try {
                await db.query(
                    `UPDATE users
                     SET credits = $1,
                         total_credits = GREATEST(total_credits, $1),
                         updated_at = NOW()
                     WHERE id = $2`,
                    [safeCredits, userId]
                );
            } catch (err) {
                console.error("[UserStore] DB error in setCredits:", err);
            }
        }
        const u = await this.findById(userId);
        if (u) {
            u.credits = safeCredits;
            u.totalCredits = Math.max(u.totalCredits, safeCredits);
            u.creditPercent = Math.min(100, Math.max(0, Math.round((u.credits / u.totalCredits) * 100)));
            u.updatedAt = new Date().toISOString();
            saveToDisk();
        }
        return u;
    },

    async addCredits(userId: string, amount: number): Promise<AdminUserRecord | null> {
        ensureLoaded();
        const u = await this.findById(userId);
        if (!u) return null;
        return this.setCredits(userId, u.credits + Math.max(0, amount));
    },

    async deductCredits(userId: string, amount: number): Promise<{ success: boolean; remaining: number }> {
        ensureLoaded();
        const u = await this.findById(userId);
        if (!u) return { success: false, remaining: 0 };
        const newCredits = Math.max(0, u.credits - Math.abs(amount));
        await this.setCredits(userId, newCredits);
        return { success: true, remaining: newCredits };
    },

    async setUserStatus(userId: string, status: "active" | "banned"): Promise<AdminUserRecord | null> {
        ensureLoaded();
        const config = getConfig();
        if (config.DATABASE_URL) {
            try {
                await db.query(
                    `UPDATE users SET status = $1, updated_at = NOW() WHERE id = $2`,
                    [status, userId]
                );
            } catch (err) {
                console.error("[UserStore] DB error in setUserStatus:", err);
            }
        }
        const u = await this.findById(userId);
        if (u) {
            u.status = status;
            u.updatedAt = new Date().toISOString();
            saveToDisk();
        }
        return u;
    },

    async restoreUser(userId: string): Promise<AdminUserRecord | null> {
        ensureLoaded();
        const config = getConfig();
        if (config.DATABASE_URL) {
            try {
                await db.query(
                    `UPDATE users SET deleted_at = NULL, status = 'active', updated_at = NOW() WHERE id = $1`,
                    [userId]
                );
            } catch (err) {
                console.error("[UserStore] DB error in restoreUser:", err);
            }
        }
        const u = await this.findById(userId);
        if (u) {
            u.deletedAt = null;
            u.status = "active";
            u.updatedAt = new Date().toISOString();
            saveToDisk();
        }
        return u;
    },

    async deleteUser(userId: string, options: { soft?: boolean } = { soft: true }): Promise<boolean> {
        ensureLoaded();
        const u = await this.findById(userId);
        if (!u) return false;
        if (u.email === ADMIN_EMAIL || u.id === SUPER_ADMIN_UUID) {
            throw new Error("Không thể xóa tài khoản Super Admin tối cao.");
        }

        const config = getConfig();
        if (options.soft) {
            const now = new Date().toISOString();
            if (config.DATABASE_URL) {
                try {
                    await db.query(
                        `UPDATE users SET deleted_at = NOW(), status = 'banned', updated_at = NOW() WHERE id = $1`,
                        [userId]
                    );
                } catch (err) {
                    console.error("[UserStore] DB error in soft delete:", err);
                }
            }
            u.deletedAt = now;
            u.status = "banned";
            u.updatedAt = now;
            saveToDisk();
            return true;
        }

        // Hard delete
        if (config.DATABASE_URL) {
            try {
                await db.query(`DELETE FROM users WHERE id = $1`, [userId]);
            } catch (err) {
                console.error("[UserStore] DB error in hard delete:", err);
            }
        }
        inMemoryUsers.delete(u.id);
        inMemoryUsers.delete(u.email.toLowerCase());
        saveToDisk();
        return true;
    },

    /**
     * Lịch sử đăng nhập / đăng ký / đổi mật khẩu của một người dùng.
     *
     * Đọc từ `audit_logs` (nguồn bền vững) và hợp nhất với bộ đệm trong bộ nhớ để
     * sự kiện vừa xảy ra hiển thị ngay lập tức, kể cả khi bản ghi DB chưa kịp ghi
     * xong hoặc môi trường không có PostgreSQL.
     */
    async getUserLoginLogs(userId: string, limit: number = 50): Promise<UserLoginLog[]> {
        const requested = Number(limit);
        const safeLimit = Number.isFinite(requested) && requested > 0 ? Math.min(Math.floor(requested), 200) : 50;
        const merged = new Map<string, UserLoginLog>();
        const config = getConfig();

        if (config.DATABASE_URL) {
            try {
                const res = await db.query(
                    `SELECT id, action, ip_address, status, details, created_at
                     FROM audit_logs
                     WHERE user_id = $1 AND action = ANY($2::text[])
                     ORDER BY created_at DESC
                     LIMIT $3`,
                    [userId, LOGIN_ACTIONS, safeLimit]
                );
                for (const r of res.rows) {
                    merged.set(r.id, {
                        id: r.id,
                        action: r.action,
                        ipAddress: r.ip_address || null,
                        location: r.details?.location || null,
                        isp: r.details?.isp || null,
                        userAgent: r.details?.userAgent || "",
                        provider: r.details?.provider || "local",
                        status: r.status,
                        createdAt: r.created_at
                            ? new Date(r.created_at).toISOString()
                            : new Date().toISOString(),
                    });
                }
            } catch (err) {
                console.error("[UserStore] DB error in getUserLoginLogs:", err);
            }
        }

        for (const entry of auditLog.getRecent(300)) {
            if (merged.size >= safeLimit) break;
            if (entry.userId !== userId) continue;
            if (!LOGIN_ACTIONS.includes(entry.action as AuthEventAction)) continue;
            if (merged.has(entry.id)) continue;
            merged.set(entry.id, {
                id: entry.id,
                action: entry.action,
                ipAddress: entry.ip || null,
                location: entry.details?.location || null,
                isp: entry.details?.isp || null,
                userAgent: entry.details?.userAgent || "",
                provider: entry.details?.provider || "local",
                status: entry.status,
                createdAt: entry.timestamp,
            });
        }

        return Array.from(merged.values())
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .slice(0, safeLimit);
    },
};
