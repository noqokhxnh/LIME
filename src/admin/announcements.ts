import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { v4 } from "uuid";
import { db } from "../database/index.js";
import { getConfig } from "../config.js";

/**
 * System Broadcast Banner — kho thông báo toàn hệ thống.
 *
 * Mỗi bản ghi là một banner có thể hiển thị cho toàn bộ người dùng (đã đăng nhập
 * lẫn khách chưa đăng nhập): bảo trì, ra mắt tính năng mới, cảnh báo… Thông báo có
 * lịch chạy (`starts_at`/`ends_at`), mức ưu tiên, và cờ cho phép người dùng đóng.
 *
 * Kho hoạt động ở hai chế độ giống `userStore`: dùng PostgreSQL khi có
 * `DATABASE_URL`, nếu không thì lùi về tệp JSON `data/announcements.json` để môi
 * trường dev/test vẫn chạy được. Danh sách thông báo luôn ít (vài chục bản) nên
 * việc lọc/sắp xếp/phân trang được thực hiện trong bộ nhớ cho cả hai chế độ —
 * đảm bảo hành vi giống nhau tuyệt đối.
 */

export const ANNOUNCEMENT_KINDS = ["info", "feature", "warning", "maintenance"] as const;
export type AnnouncementKind = (typeof ANNOUNCEMENT_KINDS)[number];

export const ANNOUNCEMENT_AUDIENCES = ["all", "users", "guests"] as const;
export type AnnouncementAudience = (typeof ANNOUNCEMENT_AUDIENCES)[number];

/** Trạng thái suy diễn từ cờ bật/tắt + lịch chạy. */
export type AnnouncementStatus = "active" | "scheduled" | "expired" | "draft";

export interface Announcement {
    id: string;
    title: string;
    body: string;
    kind: AnnouncementKind;
    priority: number;
    isActive: boolean;
    startsAt: string | null;
    endsAt: string | null;
    dismissible: boolean;
    linkUrl: string | null;
    linkLabel: string | null;
    audience: AnnouncementAudience;
    createdBy?: string | null;
    createdAt: string;
    updatedAt: string;
}

export type AnnouncementInput = Pick<
    Announcement,
    | "title"
    | "body"
    | "kind"
    | "priority"
    | "isActive"
    | "startsAt"
    | "endsAt"
    | "dismissible"
    | "linkUrl"
    | "linkLabel"
    | "audience"
>;

const STORAGE_FILE = join(process.cwd(), "data", "announcements.json");
const isTestEnv = process.env.NODE_ENV === "test" || process.argv.some((arg) => arg.includes("test"));

let cache: Announcement[] = [];
let isLoaded = false;

function ensureLoaded(): void {
    if (isLoaded) return;
    isLoaded = true;

    try {
        if (existsSync(STORAGE_FILE)) {
            const raw = readFileSync(STORAGE_FILE, "utf8");
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                cache = parsed.filter((a: any) => a && a.id).map((a: any) => normalizeStored(a));
            }
        }
    } catch (err) {
        console.error("[Announcements] Failed to read announcements from disk:", err);
    }
}

function saveToDisk(): void {
    if (isTestEnv) return;
    try {
        const dir = join(process.cwd(), "data");
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
        const tempFile = `${STORAGE_FILE}.tmp`;
        writeFileSync(tempFile, JSON.stringify(cache, null, 2), "utf8");
        renameSync(tempFile, STORAGE_FILE);
    } catch (err: any) {
        if (err?.code !== "EACCES") {
            console.error("[Announcements] Failed to persist announcements to disk:", err);
        }
    }
}

function toIsoOrNull(value: unknown): string | null {
    if (value === undefined || value === null || value === "") return null;
    const parsed = new Date(value as string);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString();
}

function normalizeStored(a: any): Announcement {
    return {
        id: String(a.id),
        title: String(a.title ?? ""),
        body: String(a.body ?? ""),
        kind: ANNOUNCEMENT_KINDS.includes(a.kind) ? a.kind : "info",
        priority: Number.isFinite(Number(a.priority)) ? Math.trunc(Number(a.priority)) : 0,
        isActive: a.isActive !== false && a.is_active !== false,
        startsAt: toIsoOrNull(a.startsAt ?? a.starts_at ?? null),
        endsAt: toIsoOrNull(a.endsAt ?? a.ends_at ?? null),
        dismissible: a.dismissible !== false,
        linkUrl: a.linkUrl ?? a.link_url ?? null,
        linkLabel: a.linkLabel ?? a.link_label ?? null,
        audience: ANNOUNCEMENT_AUDIENCES.includes(a.audience) ? a.audience : "all",
        createdBy: a.createdBy ?? a.created_by ?? null,
        createdAt: a.createdAt ? new Date(a.createdAt).toISOString() : new Date().toISOString(),
        updatedAt: a.updatedAt ? new Date(a.updatedAt).toISOString() : new Date().toISOString(),
    };
}

function formatRow(row: any): Announcement {
    return normalizeStored(row);
}

/** Nạp toàn bộ thông báo (PostgreSQL nếu có cấu hình, ngược lại đọc tệp JSON). */
async function loadAll(): Promise<Announcement[]> {
    const config = getConfig();
    if (config.DATABASE_URL) {
        try {
            const res = await db.query(
                `SELECT * FROM announcements ORDER BY priority DESC, created_at DESC`
            );
            cache = res.rows.map(formatRow);
            isLoaded = true;
            return cache;
        } catch (err) {
            console.error("[Announcements] DB error in loadAll, falling back to cache:", err);
        }
    }
    ensureLoaded();
    return cache;
}

/** Trạng thái hiệu lực tại thời điểm `now` (mili giây). */
export function getAnnouncementStatus(a: Announcement, now: number = Date.now()): AnnouncementStatus {
    if (!a.isActive) return "draft";
    if (a.startsAt && now < new Date(a.startsAt).getTime()) return "scheduled";
    if (a.endsAt && now > new Date(a.endsAt).getTime()) return "expired";
    return "active";
}

function isLiveAt(a: Announcement, now: number): boolean {
    if (!a.isActive) return false;
    if (a.startsAt && now < new Date(a.startsAt).getTime()) return false;
    if (a.endsAt && now > new Date(a.endsAt).getTime()) return false;
    return true;
}

function sortForDisplay(list: Announcement[]): Announcement[] {
    return [...list].sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
}

async function persistRow(a: Announcement): Promise<void> {
    const config = getConfig();
    if (config.DATABASE_URL) {
        await db.query(
            `INSERT INTO announcements
                (id, title, body, kind, priority, is_active, starts_at, ends_at,
                 dismissible, link_url, link_label, audience, created_by, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
             ON CONFLICT (id) DO UPDATE SET
                 title = EXCLUDED.title,
                 body = EXCLUDED.body,
                 kind = EXCLUDED.kind,
                 priority = EXCLUDED.priority,
                 is_active = EXCLUDED.is_active,
                 starts_at = EXCLUDED.starts_at,
                 ends_at = EXCLUDED.ends_at,
                 dismissible = EXCLUDED.dismissible,
                 link_url = EXCLUDED.link_url,
                 link_label = EXCLUDED.link_label,
                 audience = EXCLUDED.audience,
                 updated_at = EXCLUDED.updated_at`,
            [
                a.id,
                a.title,
                a.body,
                a.kind,
                a.priority,
                a.isActive,
                a.startsAt,
                a.endsAt,
                a.dismissible,
                a.linkUrl,
                a.linkLabel,
                a.audience,
                a.createdBy || null,
                a.createdAt,
                a.updatedAt,
            ]
        );
        return;
    }
    saveToDisk();
}

export const announcementsStore = {
    /** Toàn bộ thông báo cho cổng quản trị (đã lọc + phân trang). */
    async listForAdmin(options: {
        status?: AnnouncementStatus | "all";
        kind?: AnnouncementKind | "all";
        search?: string;
        page?: number;
        limit?: number;
    } = {}): Promise<{ items: Announcement[]; total: number; page: number; limit: number; totalPages: number }> {
        const all = await loadAll();
        const now = Date.now();
        const status = options.status || "all";
        const kind = options.kind || "all";
        const search = (options.search || "").trim().toLowerCase();
        const page = Math.max(1, options.page || 1);
        const limit = Math.max(1, Math.min(100, options.limit || 25));

        let filtered = all;
        if (kind !== "all") {
            filtered = filtered.filter((a) => a.kind === kind);
        }
        if (status !== "all") {
            filtered = filtered.filter((a) => getAnnouncementStatus(a, now) === status);
        }
        if (search) {
            filtered = filtered.filter(
                (a) =>
                    a.title.toLowerCase().includes(search) ||
                    a.body.toLowerCase().includes(search)
            );
        }

        filtered = sortForDisplay(filtered);
        const total = filtered.length;
        const totalPages = Math.ceil(total / limit) || 1;
        const start = (page - 1) * limit;

        return { items: filtered.slice(start, start + limit), total, page, limit, totalPages };
    },

    /** Thông báo đang hiệu lực cho một nhóm người xem (`user` hoặc `guest`). */
    async listPublic(viewer: "user" | "guest"): Promise<Announcement[]> {
        const all = await loadAll();
        const now = Date.now();
        const wantedAudience = viewer === "user" ? "users" : "guests";
        const live = all.filter(
            (a) => isLiveAt(a, now) && (a.audience === "all" || a.audience === wantedAudience)
        );
        return sortForDisplay(live);
    },

    async findById(id: string): Promise<Announcement | null> {
        const all = await loadAll();
        return all.find((a) => a.id === id) || null;
    },

    async create(input: AnnouncementInput, actorEmail?: string): Promise<Announcement> {
        const now = new Date().toISOString();
        const record: Announcement = {
            id: v4(),
            ...input,
            createdBy: actorEmail || null,
            createdAt: now,
            updatedAt: now,
        };
        cache = [...cache.filter((a) => a.id !== record.id), record];
        isLoaded = true;
        await persistRow(record);
        return record;
    },

    async update(id: string, patch: Partial<AnnouncementInput>): Promise<Announcement | null> {
        const all = await loadAll();
        const existing = all.find((a) => a.id === id);
        if (!existing) return null;

        const updated: Announcement = {
            ...existing,
            ...patch,
            id: existing.id,
            createdBy: existing.createdBy,
            createdAt: existing.createdAt,
            updatedAt: new Date().toISOString(),
        };
        cache = cache.map((a) => (a.id === id ? updated : a));
        await persistRow(updated);
        return updated;
    },

    async remove(id: string): Promise<boolean> {
        const all = await loadAll();
        if (!all.some((a) => a.id === id)) return false;

        const config = getConfig();
        cache = cache.filter((a) => a.id !== id);
        if (config.DATABASE_URL) {
            await db.query(`DELETE FROM announcements WHERE id = $1`, [id]);
        } else {
            saveToDisk();
        }
        return true;
    },

    async getStats(): Promise<{ total: number; active: number; scheduled: number; expired: number; draft: number }> {
        const all = await loadAll();
        const now = Date.now();
        const stats = { total: all.length, active: 0, scheduled: 0, expired: 0, draft: 0 };
        for (const a of all) {
            stats[getAnnouncementStatus(a, now)]++;
        }
        return stats;
    },
};
