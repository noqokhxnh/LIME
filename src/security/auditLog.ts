import { v4 } from "uuid";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "../database/index.js";
import { getConfig } from "../config.js";

export interface AuditLogEntry {
    id: string;
    action: string;
    userId?: string;
    userEmail?: string;
    ip?: string;
    status: "success" | "failure" | "warning";
    details?: any;
    timestamp: string;
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
            `INSERT INTO audit_logs (id, action, user_id, user_email, ip_address, status, details, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (id) DO NOTHING`,
            [
                item.id,
                item.action,
                item.userId || null,
                item.userEmail || null,
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

export const auditLog = {
    record(entry: Omit<AuditLogEntry, "id" | "timestamp">): AuditLogEntry {
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
        persistToDb(item).catch(() => {});

        return item;
    },

    /**
     * Như `record()` nhưng chờ ghi xong bản ghi vào PostgreSQL.
     *
     * Dùng cho các sự kiện mà ngay sau đó cần truy vấn lại từ DB (ví dụ: lịch sử
     * đăng nhập hiển thị ở cổng quản trị).
     */
    async recordAndPersist(entry: Omit<AuditLogEntry, "id" | "timestamp">): Promise<AuditLogEntry> {
        const item = this.record(entry);
        await persistToDb(item);
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

    clear(): void {
        ensureLoaded();
        auditLogs.length = 0;
        saveToDisk();

        const config = getConfig();
        if (config.DATABASE_URL) {
            db.query("TRUNCATE TABLE audit_logs").catch((err) => {
                console.error("[AuditLog] Failed to truncate audit_logs in DB:", err);
            });
        }
    },

    async initFromDatabase(): Promise<void> {
        ensureLoaded();
        const config = getConfig();
        if (!config.DATABASE_URL) return;

        try {
            const res = await db.query(
                `SELECT id, action, user_id, user_email, ip_address, status, details, created_at
                 FROM audit_logs
                 ORDER BY created_at DESC
                 LIMIT 500`
            );
            if (res.rows.length > 0) {
                const dbLogs: AuditLogEntry[] = res.rows.map((r: any) => ({
                    id: r.id,
                    action: r.action,
                    userId: r.user_id || undefined,
                    userEmail: r.user_email || undefined,
                    ip: r.ip_address || undefined,
                    status: r.status as any,
                    details: r.details,
                    timestamp: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
                }));

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
