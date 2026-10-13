import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "../database/index.js";
import { getConfig } from "../config.js";

export type SubscriptionTier = "free" | "creator" | "pro" | "max" | "enterprise";
export type UserRole = "user" | "admin";

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
    signupIp?: string;
    lastLocation?: string;
    lastIsp?: string;
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
        if (existsSync(STORAGE_FILE)) {
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

    return {
        id: row.id,
        username: row.username || row.email?.split("@")[0] || "user",
        name: row.username || row.email?.split("@")[0] || "User",
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
        lastLoginIp: row.last_login_ip,
        signupIp: row.signup_ip,
        lastLocation: row.last_location,
        lastIsp: row.last_isp,
    };
}

export const userStore = {
    async findById(id: string): Promise<AdminUserRecord | null> {
        ensureLoaded();
        const config = getConfig();
        if (config.DATABASE_URL) {
            try {
                const res = await db.query(
                    `SELECT id, username, email, role, tier, credits, total_credits, status,
                            google_id, plan_id, plan_expires_at, created_at, updated_at, deleted_at
                     FROM users
                     WHERE id = $1 OR LOWER(email) = LOWER($1)
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
                    SELECT id, username, email, role, tier, credits, total_credits, status,
                           google_id, plan_id, plan_expires_at, created_at, updated_at, deleted_at
                    FROM users
                `;
                if (!options?.includeDeleted) {
                    query += ` WHERE deleted_at IS NULL`;
                }
                query += ` ORDER BY created_at DESC`;
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
        if (config.DATABASE_URL) {
            try {
                await db.query(
                    `UPDATE users
                     SET tier = $1,
                         plan_expires_at = NOW() + ($2 || ' days')::interval,
                         updated_at = NOW()
                     WHERE id = $3`,
                    [tier, durationDays.toString(), userId]
                );
            } catch (err) {
                console.error("[UserStore] DB error in updateTier:", err);
            }
        }
        const u = await this.findById(userId);
        if (u) {
            u.tier = tier;
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

    async getUserLoginLogs(userId: string, limit: number = 50): Promise<any[]> {
        const config = getConfig();
        if (config.DATABASE_URL) {
            try {
                const res = await db.query(
                    `SELECT id, action, ip_address, status, details, created_at
                     FROM audit_logs
                     WHERE user_id = $1
                     ORDER BY created_at DESC
                     LIMIT $2`,
                    [userId, limit]
                );
                return res.rows.map((r: any) => ({
                    id: r.id,
                    ipAddress: r.ip_address || "127.0.0.1",
                    location: r.details?.location || "Không xác định",
                    isp: r.details?.isp || "Không xác định",
                    userAgent: r.details?.userAgent || "",
                    provider: r.details?.provider || "local",
                    status: r.status,
                    timestamp: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
                }));
            } catch (err) {
                console.error("[UserStore] DB error in getUserLoginLogs:", err);
            }
        }
        return [];
    },
};
