import { v4 } from "uuid";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseUserAgent } from "../security/pageViewTracker.js";

export interface MaintenanceLogEntry {
    id: string;
    ip: string;
    country: string;
    city: string;
    asn: string;
    userAgent: string;
    browser: string;
    os: string;
    device: "Desktop" | "Mobile" | "Tablet" | "Bot";
    url: string;
    referer: string;
    timestamp: string; // ISO string
}

export interface MaintenanceStats {
    totalLogs: number;
    uniqueIps: number;
    todayLogs: number;
    topLocations: Array<{ location: string; count: number; percentage: number }>;
    topAsns: Array<{ asn: string; count: number; percentage: number }>;
    topUrls: Array<{ url: string; count: number; percentage: number }>;
    deviceBreakdown: Array<{ device: string; count: number; percentage: number }>;
}

const STORAGE_FILE = join(process.cwd(), "data", "maintenance-logs.json");
const logs: MaintenanceLogEntry[] = [];
let isLoaded = false;
let lastSyncTimestamp = 0;
let ongoingSyncPromise: Promise<{ syncedCount: number; total: number }> | null = null;

function ensureLoaded(): void {
    if (isLoaded) return;
    isLoaded = true;

    try {
        if (existsSync(STORAGE_FILE)) {
            const raw = readFileSync(STORAGE_FILE, "utf8");
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                logs.length = 0;
                logs.push(...parsed);
            }
        }
    } catch (err) {
        console.error("[MaintenanceTracker] Failed to read logs from disk:", err);
    }
}

function saveToDisk(): boolean {
    try {
        const dir = join(process.cwd(), "data");
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
        const tempFile = `${STORAGE_FILE}.tmp`;
        writeFileSync(tempFile, JSON.stringify(logs.slice(0, 5000), null, 2), "utf8");
        renameSync(tempFile, STORAGE_FILE);
        return true;
    } catch (err) {
        console.error("[MaintenanceTracker] Failed to save logs to disk:", err);
        return false;
    }
}

export const maintenanceTracker = {
    getAll(): MaintenanceLogEntry[] {
        ensureLoaded();
        return [...logs];
    },

    getRecent(options: {
        page?: number;
        limit?: number;
        search?: string;
    } = {}): {
        logs: MaintenanceLogEntry[];
        total: number;
        page: number;
        totalPages: number;
    } {
        ensureLoaded();
        const page = Math.max(1, options.page || 1);
        const limit = Math.max(1, Math.min(100, options.limit || 25));
        const search = (options.search || "").trim().toLowerCase();

        let filtered = logs;
        if (search) {
            filtered = logs.filter((item) => {
                return (
                    (item.ip && item.ip.toLowerCase().includes(search)) ||
                    (item.city && item.city.toLowerCase().includes(search)) ||
                    (item.country && item.country.toLowerCase().includes(search)) ||
                    (item.asn && item.asn.toLowerCase().includes(search)) ||
                    (item.url && item.url.toLowerCase().includes(search)) ||
                    (item.browser && item.browser.toLowerCase().includes(search)) ||
                    (item.os && item.os.toLowerCase().includes(search))
                );
            });
        }

        const total = filtered.length;
        const totalPages = Math.ceil(total / limit) || 1;
        const start = (page - 1) * limit;
        const pageLogs = filtered.slice(start, start + limit);

        return {
            logs: pageLogs,
            total,
            page,
            totalPages,
        };
    },

    getStats(): MaintenanceStats {
        ensureLoaded();
        const totalLogs = logs.length;
        const uniqueIps = new Set(logs.map((l) => l.ip).filter(Boolean)).size;

        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const todayLogs = logs.filter((l) => new Date(l.timestamp).getTime() >= startOfToday).length;

        const locationMap = new Map<string, number>();
        const asnMap = new Map<string, number>();
        const urlMap = new Map<string, number>();
        const deviceMap = new Map<string, number>();

        for (const item of logs) {
            const loc = [item.city, item.country].filter(Boolean).join(", ") || "Không rõ";
            locationMap.set(loc, (locationMap.get(loc) || 0) + 1);

            const asn = item.asn || "Không rõ";
            asnMap.set(asn, (asnMap.get(asn) || 0) + 1);

            let cleanUrl = item.url;
            try {
                const u = new URL(item.url);
                cleanUrl = u.pathname;
            } catch (_) {}
            urlMap.set(cleanUrl, (urlMap.get(cleanUrl) || 0) + 1);

            const dev = item.device || "Desktop";
            deviceMap.set(dev, (deviceMap.get(dev) || 0) + 1);
        }

        const toList = (map: Map<string, number>, keyName: string) => {
            return Array.from(map.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([key, count]) => ({
                    [keyName]: key,
                    count,
                    percentage: totalLogs > 0 ? Math.round((count / totalLogs) * 100) : 0,
                })) as any;
        };

        return {
            totalLogs,
            uniqueIps,
            todayLogs,
            topLocations: toList(locationMap, "location"),
            topAsns: toList(asnMap, "asn"),
            topUrls: toList(urlMap, "url"),
            deviceBreakdown: toList(deviceMap, "device"),
        };
    },

    async syncFromCloudflare(
        secretKey: string = process.env.CF_MAINTENANCE_SYNC_SECRET || process.env.MAINTENANCE_SYNC_SECRET || "lime_maintenance_secret_2026"
    ): Promise<{
        syncedCount: number;
        total: number;
    }> {
        if (ongoingSyncPromise) {
            return ongoingSyncPromise;
        }

        const task = (async () => {
            ensureLoaded();
            const endpoint = "https://limestudio.id.vn/api/internal/maintenance-logs";

            try {
                const res = await fetch(endpoint, {
                    method: "GET",
                    headers: {
                        Authorization: `Bearer ${secretKey}`,
                    },
                    signal: AbortSignal.timeout(10000),
                });

                if (!res.ok) {
                    const errText = await res.text();
                    throw new Error(`Cloudflare sync failed [${res.status}]: ${errText}`);
                }

                const data = await res.json() as { success: boolean; logs?: any[] };
                const remoteLogs = data.logs || [];
                const syncIds = remoteLogs
                    .map((entry) => entry._sync_id)
                    .filter((id): id is number => Number.isInteger(id) && id > 0);
                let addedCount = 0;

                for (const r of remoteLogs) {
                    const uaParsed = parseUserAgent(r.user_agent);
                    const isoTime = r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString();

                    const isDup = logs.some(
                        (existing) =>
                            existing.ip === (r.ip || "") &&
                            existing.url === (r.url || "") &&
                            Math.abs(new Date(existing.timestamp).getTime() - new Date(isoTime).getTime()) < 3000
                    );

                    if (!isDup) {
                        logs.unshift({
                            id: v4(),
                            ip: r.ip || "Không rõ",
                            country: r.country || "",
                            city: r.city || "",
                            asn: r.asn || "",
                            userAgent: r.user_agent || "",
                            browser: uaParsed.browser,
                            os: uaParsed.os,
                            device: uaParsed.device,
                            url: r.url || "/",
                            referer: r.referer || "",
                            timestamp: isoTime,
                        });
                        addedCount++;
                    }
                }

                if (!saveToDisk()) {
                    throw new Error("Không thể ghi nhật ký vào ổ đĩa; dữ liệu Cloudflare được giữ nguyên.");
                }

                if (syncIds.length > 0) {
                    const acknowledge = await fetch(endpoint, {
                        method: "POST",
                        headers: {
                            Authorization: `Bearer ${secretKey}`,
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify({ syncIds }),
                        signal: AbortSignal.timeout(10000),
                    });
                    if (!acknowledge.ok) {
                        throw new Error(`Không thể xác nhận đồng bộ Cloudflare [${acknowledge.status}]. Dữ liệu đã lưu local và sẽ được đối chiếu ở lần đồng bộ sau.`);
                    }
                }

                lastSyncTimestamp = Date.now();
                return { syncedCount: addedCount, total: logs.length };
            } catch (err: any) {
                console.error("[MaintenanceTracker] Error syncing from Cloudflare:", err.message);
                throw err;
            } finally {
                ongoingSyncPromise = null;
            }
        })();

        ongoingSyncPromise = task;
        return task;
    },

    async syncIfNeeded(minIntervalMs: number = 15000): Promise<{ syncedCount: number; total: number }> {
        ensureLoaded();
        if (ongoingSyncPromise) {
            return ongoingSyncPromise;
        }
        if (Date.now() - lastSyncTimestamp < minIntervalMs) {
            return { syncedCount: 0, total: logs.length };
        }
        return this.syncFromCloudflare();
    },

    getLastSyncTime(): number {
        return lastSyncTimestamp;
    },

    clear(): void {
        ensureLoaded();
        logs.length = 0;
        saveToDisk();
    },
};
