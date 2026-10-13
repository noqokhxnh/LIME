import { v4 } from "uuid";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyRequest } from "fastify";
import { db } from "../database/index.js";
import { getConfig } from "../config.js";
import { resolveIpGeo, normalizeLocationString, formatIspName, formatCountryName } from "./geoIp.js";
import { getCurrentUser } from "../auth/session.js";

export interface PageViewEntry {
    id: string;
    ip: string;
    path: string;
    userAgent: string;
    browser: string;
    os: string;
    device: "Desktop" | "Mobile" | "Tablet" | "Bot";
    referrer: string;
    location: string;
    isp: string;
    country?: string;
    city?: string;
    userId?: string;
    userEmail?: string;
    userName?: string;
    timestamp: string;
}

export interface PageViewStats {
    totalViews: number;
    uniqueVisitors: number;
    todayViews: number;
    todayVisitors: number;
    userViews: number;
    guestViews: number;
    topPages: Array<{ path: string; count: number; percentage: number }>;
    topReferrers: Array<{ referrer: string; count: number; percentage: number }>;
    deviceBreakdown: Array<{ device: string; count: number; percentage: number }>;
    browserBreakdown: Array<{ browser: string; count: number; percentage: number }>;
    userBreakdown: Array<{ name: string; count: number; percentage: number }>;
    topLocations: Array<{ location: string; count: number; percentage: number }>;
    dailyTrends: Array<{ date: string; views: number; uniqueVisitors: number }>;
}

const pageViews: PageViewEntry[] = [];
const MAX_VIEWS = 5000;
const STORAGE_FILE = join(process.cwd(), "data", "page-views.json");
const isTestEnv = process.env.NODE_ENV === "test" || process.argv.some((arg) => arg.includes("test"));

let isLoaded = false;
const recentHits = new Map<string, { id: string; timestamp: number }>();
const DEBOUNCE_WINDOW_MS = 5000;

function ensureLoaded(): void {
    if (isLoaded) return;
    isLoaded = true;

    try {
        if (existsSync(STORAGE_FILE)) {
            const raw = readFileSync(STORAGE_FILE, "utf8");
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                pageViews.length = 0;
                for (const item of parsed) {
                    if (item && typeof item === "object") {
                        if (item.location) item.location = normalizeLocationString(item.location);
                        if (item.isp) item.isp = formatIspName(item.isp);
                        pageViews.push(item);
                    }
                }
                return;
            }
        }
    } catch (err) {
        console.error("[PageViewTracker] Failed to read page views from disk:", err);
    }
}

function saveToDisk(): void {
    if (isTestEnv) return;

    try {
        const dir = join(process.cwd(), "data");
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
        const data = JSON.stringify(pageViews.slice(0, MAX_VIEWS), null, 2);
        writeFileSync(STORAGE_FILE, data, "utf8");
    } catch (err: any) {
        if (err?.code !== "EACCES") {
            console.error("[PageViewTracker] Failed to persist page views to disk:", err);
        }
    }
}

async function persistToDb(item: PageViewEntry): Promise<void> {
    const config = getConfig();
    if (!config.DATABASE_URL) return;

    try {
        await db.query(
            `INSERT INTO page_views (id, ip, path, user_agent, browser, os, device, referrer, location, isp, country, city, user_id, user_email, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
             ON CONFLICT (id) DO NOTHING`,
            [
                item.id,
                item.ip,
                item.path,
                item.userAgent || null,
                item.browser || null,
                item.os || null,
                item.device || null,
                item.referrer || null,
                item.location || null,
                item.isp || null,
                item.country || null,
                item.city || null,
                item.userId || null,
                item.userEmail || null,
                item.timestamp,
            ]
        );
    } catch (err) {
        console.error("[PageViewTracker] Failed to persist view to database:", err);
    }
}

export function parseUserAgent(uaString?: string): {
    browser: string;
    os: string;
    device: "Desktop" | "Mobile" | "Tablet" | "Bot";
} {
    const ua = (uaString || "").trim();
    if (!ua) {
        return { browser: "Không xác định", os: "Không xác định", device: "Desktop" };
    }

    // 1. Bot detection
    const isBot = /bot|crawl|spider|slurp|curl|wget|python|postman|mediapartners|googlebot|bingbot|yandex|duckduckgo|baiduspider|facebookexternalhit|whatsapp|telegram|discordbot|headlesschrome/i.test(ua);
    if (isBot) {
        let botName = "Bot / Crawler";
        if (/googlebot/i.test(ua)) botName = "Googlebot";
        else if (/bingbot/i.test(ua)) botName = "Bingbot";
        else if (/curl/i.test(ua)) botName = "cURL";
        else if (/postman/i.test(ua)) botName = "Postman";
        else if (/python/i.test(ua)) botName = "Python Script";
        return { browser: botName, os: "Bot Agent", device: "Bot" };
    }

    // 2. Device detection
    let device: "Desktop" | "Mobile" | "Tablet" | "Bot" = "Desktop";
    if (/ipad|tablet|(android(?!.*mobile))|playbook|silk|kindle/i.test(ua)) {
        device = "Tablet";
    } else if (/mobile|iphone|ipod|windows phone|blackberry|bb10/i.test(ua)) {
        device = "Mobile";
    }

    // 3. Operating System
    let os = "Khác";
    if (/windows nt 10/i.test(ua)) os = "Windows 10/11";
    else if (/windows nt 6\.3/i.test(ua)) os = "Windows 8.1";
    else if (/windows nt 6\.2/i.test(ua)) os = "Windows 8";
    else if (/windows nt 6\.1/i.test(ua)) os = "Windows 7";
    else if (/windows/i.test(ua)) os = "Windows";
    else if (/mac os x/i.test(ua) || /macintosh/i.test(ua)) {
        os = /iphone|ipad|ipod/i.test(ua) ? "iOS" : "macOS";
    } else if (/android/i.test(ua)) os = "Android";
    else if (/linux/i.test(ua)) os = "Linux";
    else if (/cros/i.test(ua)) os = "Chrome OS";

    // 4. Browser
    let browser = "Khác";
    const edgMatch = ua.match(/Edg(?:e)?\/([0-9]+)/i);
    const operaMatch = ua.match(/(?:OPR|Opera)\/([0-9]+)/i);
    const chromeMatch = ua.match(/Chrome\/([0-9]+)/i);
    const firefoxMatch = ua.match(/Firefox\/([0-9]+)/i);
    const safariMatch = ua.match(/Version\/([0-9]+).*Safari/i);
    const samsungMatch = ua.match(/SamsungBrowser\/([0-9]+)/i);

    if (samsungMatch) browser = `Samsung Internet ${samsungMatch[1]}`;
    else if (edgMatch) browser = `Edge ${edgMatch[1]}`;
    else if (operaMatch) browser = `Opera ${operaMatch[1]}`;
    else if (chromeMatch) browser = `Chrome ${chromeMatch[1]}`;
    else if (firefoxMatch) browser = `Firefox ${firefoxMatch[1]}`;
    else if (safariMatch) browser = `Safari ${safariMatch[1]}`;
    else if (/safari/i.test(ua)) browser = "Safari";

    return { browser, os, device };
}

export function extractClientIp(request: FastifyRequest): string {
    const cfIp = (request.headers["cf-connecting-ip"] as string)?.trim();
    const realIp = (request.headers["x-real-ip"] as string)?.trim();
    const clientIp = (request.headers["x-client-ip"] as string)?.trim();
    const forwarded = request.headers["x-forwarded-for"] as string | undefined;
    const forwardedFirst = forwarded ? forwarded.split(",")[0].trim() : undefined;

    return cfIp || realIp || clientIp || forwardedFirst || request.ip || "127.0.0.1";
}

export const pageViewTracker = {
    async track(entry: {
        ip: string;
        path: string;
        userAgent?: string;
        referrer?: string;
        location?: string;
        isp?: string;
        country?: string;
        city?: string;
        userId?: string;
        userEmail?: string;
        userName?: string;
        request?: FastifyRequest;
    }): Promise<PageViewEntry> {
        return this.record(entry);
    },

    async record(entry: {
        ip: string;
        path: string;
        userAgent?: string;
        referrer?: string;
        location?: string;
        isp?: string;
        country?: string;
        city?: string;
        userId?: string;
        userEmail?: string;
        userName?: string;
        request?: FastifyRequest;
    }): Promise<PageViewEntry> {
        ensureLoaded();

        const ip = entry.ip || "127.0.0.1";
        const path = (entry.path || "/").split("?")[0] || "/";
        const now = Date.now();
        const hitKey = `${ip}:${path}`;

        // Debounce: check if same ip and path within 5s
        const lastHit = recentHits.get(hitKey);
        if (lastHit && now - lastHit.timestamp < DEBOUNCE_WINDOW_MS) {
            const existing = pageViews.find((v) => v.id === lastHit.id);
            if (existing) {
                if (entry.userId && !existing.userId) {
                    existing.userId = entry.userId;
                    existing.userEmail = entry.userEmail || existing.userEmail;
                    existing.userName = entry.userName || existing.userName;
                    saveToDisk();
                    persistToDb(existing).catch(() => {});
                }
                return existing;
            }
        }

        const ua = entry.userAgent || "";
        const parsedUa = parseUserAgent(ua);

        let location = entry.location || "";
        let isp = entry.isp || "";
        let country = entry.country;
        let city = entry.city;

        if (!location || !isp) {
            const geo = await resolveIpGeo(ip, entry.request);
            location = location || geo.location;
            isp = isp || geo.isp;
            country = country || geo.country;
            city = city || geo.city;
        } else {
            location = normalizeLocationString(location);
            isp = formatIspName(isp);
        }

        const cleanReferrer = (entry.referrer || "").trim() || "Trực tiếp (Direct)";

        const item: PageViewEntry = {
            id: v4(),
            ip,
            path,
            userAgent: ua,
            browser: parsedUa.browser,
            os: parsedUa.os,
            device: parsedUa.device,
            referrer: cleanReferrer,
            location: location || "Không xác định",
            isp: isp || "Không xác định",
            country,
            city,
            userId: entry.userId,
            userEmail: entry.userEmail,
            userName: entry.userName,
            timestamp: new Date().toISOString(),
        };

        pageViews.unshift(item);
        if (pageViews.length > MAX_VIEWS) {
            pageViews.pop();
        }

        recentHits.set(hitKey, { id: item.id, timestamp: now });
        saveToDisk();
        persistToDb(item).catch(() => {});

        return item;
    },

    async recordFromRequest(request: FastifyRequest, overridePath?: string): Promise<PageViewEntry | null> {
        const ip = extractClientIp(request);
        const rawUrl = overridePath || request.raw.url || request.url || "/";
        const path = rawUrl.split("?")[0] || "/";
        const userAgent = request.headers["user-agent"] as string | undefined;
        const referrer = (request.headers["referer"] as string) || (request.headers["referrer"] as string) || "";

        let userId: string | undefined;
        let userEmail: string | undefined;
        let userName: string | undefined;

        try {
            const user = await getCurrentUser(request);
            if (user) {
                userId = user.id;
                userEmail = user.email;
                userName = user.username;
            }
        } catch {}

        return this.record({
            ip,
            path,
            userAgent,
            referrer,
            userId,
            userEmail,
            userName,
            request,
        });
    },

    getRecent(options: {
        page?: number;
        limit?: number;
        search?: string;
        path?: string;
        device?: string;
        period?: string;
        userType?: string;
        country?: string;
    } = {}): { views: PageViewEntry[]; total: number; page: number; limit: number } {
        ensureLoaded();

        let filtered = [...pageViews];
        const { search, path, device, period, userType, country, page = 1, limit = 25 } = options;

        if (period && period !== "all") {
            const now = Date.now();
            const todayStr = new Date().toISOString().slice(0, 10);

            if (period === "today") {
                filtered = filtered.filter((v) => (v.timestamp || "").slice(0, 10) === todayStr);
            } else if (period === "24h") {
                const since = now - 24 * 60 * 60 * 1000;
                filtered = filtered.filter((v) => new Date(v.timestamp).getTime() >= since);
            } else if (period === "7d") {
                const since = now - 7 * 24 * 60 * 60 * 1000;
                filtered = filtered.filter((v) => new Date(v.timestamp).getTime() >= since);
            } else if (period === "30d") {
                const since = now - 30 * 24 * 60 * 60 * 1000;
                filtered = filtered.filter((v) => new Date(v.timestamp).getTime() >= since);
            }
        }

        if (path && path !== "all") {
            filtered = filtered.filter((v) => v.path === path || v.path.startsWith(`${path}/`));
        }

        if (device && device !== "all") {
            filtered = filtered.filter((v) => v.device.toLowerCase() === device.toLowerCase());
        }

        if (userType && userType !== "all") {
            if (userType === "user") {
                filtered = filtered.filter((v) => Boolean(v.userId || v.userEmail));
            } else if (userType === "guest") {
                filtered = filtered.filter((v) => !v.userId && !v.userEmail);
            }
        }

        if (country && country !== "all") {
            const cLower = country.toLowerCase().trim();
            filtered = filtered.filter((v) => {
                const itemCountry = (v.country || "").toLowerCase().trim();
                const formattedCountry = formatCountryName(v.country).toLowerCase().trim();
                const itemLocation = (v.location || "").toLowerCase().trim();

                if (cLower === "không xác định" || cLower === "unknown") {
                    return (
                        (!itemCountry || itemCountry === "không xác định") &&
                        (!itemLocation || itemLocation === "không xác định" || itemLocation.includes("mạng cục bộ") || itemLocation.includes("local") || itemLocation.includes("lan"))
                    );
                }

                return (
                    itemCountry === cLower ||
                    formattedCountry === cLower ||
                    itemCountry.includes(cLower) ||
                    formattedCountry.includes(cLower) ||
                    itemLocation.includes(cLower)
                );
            });
        }

        if (search && search.trim()) {
            const q = search.trim().toLowerCase();
            filtered = filtered.filter((v) => {
                return (
                    v.ip.toLowerCase().includes(q) ||
                    v.path.toLowerCase().includes(q) ||
                    (v.userEmail && v.userEmail.toLowerCase().includes(q)) ||
                    (v.userName && v.userName.toLowerCase().includes(q)) ||
                    v.location.toLowerCase().includes(q) ||
                    v.isp.toLowerCase().includes(q) ||
                    v.browser.toLowerCase().includes(q) ||
                    v.os.toLowerCase().includes(q) ||
                    (v.referrer && v.referrer.toLowerCase().includes(q))
                );
            });
        }

        const total = filtered.length;
        const pageNum = Math.max(1, Number(page) || 1);
        const limitNum = Math.min(100, Math.max(5, Number(limit) || 25));
        const startIndex = (pageNum - 1) * limitNum;
        const views = filtered.slice(startIndex, startIndex + limitNum);

        return {
            views,
            total,
            page: pageNum,
            limit: limitNum,
        };
    },

    getAllCountries(): Array<{ name: string; count: number }> {
        ensureLoaded();
        const counts = new Map<string, number>();
        for (const v of pageViews) {
            let c = formatCountryName(v.country) || v.country;
            if (!c && v.location) {
                const norm = normalizeLocationString(v.location);
                if (norm.includes(",")) {
                    c = norm.split(",").pop()?.trim() || norm;
                } else if (norm !== "Không xác định" && !norm.includes("Local") && !norm.includes("cục bộ")) {
                    c = norm;
                }
            }
            if (c && c !== "Không xác định") {
                counts.set(c, (counts.get(c) || 0) + 1);
            }
        }
        return Array.from(counts.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([name, count]) => ({ name, count }));
    },

    getStats(period: string = "all"): PageViewStats {
        ensureLoaded();

        let filtered = [...pageViews];
        const now = Date.now();
        const todayStr = new Date().toISOString().slice(0, 10);

        if (period && period !== "all") {
            if (period === "today") {
                filtered = filtered.filter((v) => (v.timestamp || "").slice(0, 10) === todayStr);
            } else if (period === "24h") {
                const since = now - 24 * 60 * 60 * 1000;
                filtered = filtered.filter((v) => new Date(v.timestamp).getTime() >= since);
            } else if (period === "7d") {
                const since = now - 7 * 24 * 60 * 60 * 1000;
                filtered = filtered.filter((v) => new Date(v.timestamp).getTime() >= since);
            } else if (period === "30d") {
                const since = now - 30 * 24 * 60 * 60 * 1000;
                filtered = filtered.filter((v) => new Date(v.timestamp).getTime() >= since);
            }
        }

        const totalViews = filtered.length;
        const uniqueVisitors = new Set(filtered.map((v) => v.ip)).size;

        const todayLogs = pageViews.filter((v) => (v.timestamp || "").slice(0, 10) === todayStr);
        const todayViews = todayLogs.length;
        const todayVisitors = new Set(todayLogs.map((v) => v.ip)).size;

        const getBreakdown = (extractor: (v: PageViewEntry) => string, maxItems: number = 6) => {
            const counts = new Map<string, number>();
            for (const v of filtered) {
                const val = extractor(v) || "Không xác định";
                counts.set(val, (counts.get(val) || 0) + 1);
            }
            return Array.from(counts.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, maxItems)
                .map(([name, count]) => ({
                    name,
                    count,
                    percentage: totalViews > 0 ? Math.round((count / totalViews) * 100) : 0,
                }));
        };

        const topPages = getBreakdown((v) => v.path, 8).map((item) => ({
            path: item.name,
            count: item.count,
            percentage: item.percentage,
        }));

        const topReferrers = getBreakdown((v) => {
            if (!v.referrer || v.referrer.includes("Direct") || v.referrer.includes("Trực tiếp")) return "Trực tiếp (Direct)";
            try {
                const url = new URL(v.referrer);
                return url.hostname || v.referrer;
            } catch {
                return v.referrer;
            }
        }, 6).map((item) => ({
            referrer: item.name,
            count: item.count,
            percentage: item.percentage,
        }));

        const deviceBreakdown = getBreakdown((v) => v.device, 5).map((item) => ({
            device: item.name,
            count: item.count,
            percentage: item.percentage,
        }));

        const browserBreakdown = getBreakdown((v) => v.browser, 6).map((item) => ({
            browser: item.name,
            count: item.count,
            percentage: item.percentage,
        }));

        const topLocations = getBreakdown((v) => normalizeLocationString(v.location || v.country || "Không xác định"), 6).map((item) => ({
            location: item.name,
            count: item.count,
            percentage: item.percentage,
        }));

        const last7Days: string[] = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            last7Days.push(d.toISOString().slice(0, 10));
        }

        const dailyTrends = last7Days.map((dateStr) => {
            const dayLogs = pageViews.filter((v) => (v.timestamp || "").slice(0, 10) === dateStr);
            return {
                date: dateStr,
                views: dayLogs.length,
                uniqueVisitors: new Set(dayLogs.map((v) => v.ip)).size,
            };
        });

        const userViews = filtered.filter((v) => Boolean(v.userId || v.userEmail)).length;
        const guestViews = Math.max(0, totalViews - userViews);
        const userPercentage = totalViews > 0 ? Math.round((userViews / totalViews) * 100) : 0;
        const guestPercentage = totalViews > 0 ? 100 - userPercentage : 0;

        const userBreakdown = [
            { name: "Người dùng (User)", count: userViews, percentage: userPercentage },
            { name: "Khách (Guest)", count: guestViews, percentage: guestPercentage },
        ];

        return {
            totalViews,
            uniqueVisitors,
            todayViews,
            todayVisitors,
            userViews,
            guestViews,
            topPages,
            topReferrers,
            deviceBreakdown,
            browserBreakdown,
            userBreakdown,
            topLocations,
            dailyTrends,
        };
    },

    clear(): void {
        ensureLoaded();
        pageViews.length = 0;
        recentHits.clear();
        saveToDisk();

        const config = getConfig();
        if (config.DATABASE_URL) {
            db.query("TRUNCATE TABLE page_views").catch((err) => {
                console.error("[PageViewTracker] Failed to truncate page_views in DB:", err);
            });
        }
    },

    async initFromDatabase(): Promise<void> {
        ensureLoaded();
        const config = getConfig();
        if (!config.DATABASE_URL) return;

        try {
            const res = await db.query(
                `SELECT id, ip, path, user_agent, browser, os, device, referrer, location, isp, country, city, user_id, user_email, created_at
                 FROM page_views
                 ORDER BY created_at DESC
                 LIMIT 1000`
            );
            if (res.rows.length > 0) {
                const dbViews: PageViewEntry[] = res.rows.map((r: any) => ({
                    id: r.id,
                    ip: r.ip,
                    path: r.path,
                    userAgent: r.user_agent || "",
                    browser: r.browser || "Khác",
                    os: r.os || "Khác",
                    device: r.device || "Desktop",
                    referrer: r.referrer || "Trực tiếp (Direct)",
                    location: r.location || "Không xác định",
                    isp: r.isp || "Không xác định",
                    country: r.country || undefined,
                    city: r.city || undefined,
                    userId: r.user_id || undefined,
                    userEmail: r.user_email || undefined,
                    timestamp: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
                }));

                const existingIds = new Set(pageViews.map((v) => v.id));
                for (const item of dbViews) {
                    if (!existingIds.has(item.id)) {
                        pageViews.push(item);
                        existingIds.add(item.id);
                    }
                }
                pageViews.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
                saveToDisk();
            }
        } catch (err) {
            console.error("[PageViewTracker] Failed to load views from database:", err);
        }
    },
};
