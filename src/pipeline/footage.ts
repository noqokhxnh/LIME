/**
 * Footage fetcher (Pixabay) — điền ảnh stock thật vào slot {{SCENE_IMAGE}}.
 *
 * Thiết kế:
 * - Scene nào khai `footageQuery` trong kịch bản thì hệ thống tìm 1 ảnh thật
 *   trên Pixabay, tải về, nhúng dạng data URI vào imageMap cho assembleHTML.
 *   Data URI giữ render tất định và offline tuyệt đối (networkGuard không
 *   phải mở thêm host nào; trang render không gọi mạng).
 * - Không có PIXABAY_API_KEY, API lỗi, hoặc không có kết quả → trả map rỗng /
 *   thiếu scene đó. Mọi lỗi đều nuốt tại đây: footage là lớp trang trí,
 *   TUYỆT ĐỐI không được làm hỏng job.
 * - Cache theo (query, orientation) trong tmp/footage-cache, TTL 24 giờ —
 *   đúng điều khoản Pixabay (cache kết quả, không gọi lặp vô ích) và làm
 *   các lần QA retry gần như miễn phí.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { videoScript } from "../llm/schema.js";

export interface FootageOptions {
    apiKey?: string;
    fetchFn?: typeof fetch;
    cacheDir?: string;
    orientation?: "horizontal" | "vertical";
    onProgress?: (msg: string) => void;
    now?: () => number;
}

const PIXABAY_API_URL = "https://pixabay.com/api/";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MIN_IMAGE_BYTES = 8 * 1024;

interface CacheEntry {
    fetchedAt: number;
    dataUri: string;
    pageUrl: string;
}

function cacheKeyFor(query: string, orientation?: string): string {
    return createHash("sha256")
        .update(`${orientation || "any"}::${query.trim().toLowerCase()}`)
        .digest("hex")
        .slice(0, 32);
}

async function fetchWithTimeout(fetchFn: typeof fetch, url: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        return await fetchFn(url, { signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

async function downloadAsDataUri(fetchFn: typeof fetch, url: string): Promise<string | null> {
    const res = await fetchWithTimeout(fetchFn, url);
    if (!res.ok) return null;
    const contentType = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!contentType.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < MIN_IMAGE_BYTES || buf.length > MAX_IMAGE_BYTES) return null;
    return `data:${contentType};base64,${buf.toString("base64")}`;
}

async function searchAndDownload(
    fetchFn: typeof fetch,
    apiKey: string,
    query: string,
    orientation?: string
): Promise<CacheEntry | null> {
    const params = new URLSearchParams({
        key: apiKey,
        q: query,
        per_page: "3",
        image_type: "photo",
        safesearch: "true",
    });
    if (orientation) params.set("orientation", orientation);
    const res = await fetchWithTimeout(fetchFn, `${PIXABAY_API_URL}?${params.toString()}`);
    if (!res.ok) return null;
    const body: any = await res.json().catch(() => null);
    const hit = body?.hits?.[0];
    const fileUrl = hit?.largeImageURL || hit?.webformatURL;
    if (!fileUrl) return null;
    const dataUri = await downloadAsDataUri(fetchFn, fileUrl);
    if (!dataUri) return null;
    return { fetchedAt: Date.now(), dataUri, pageUrl: String(hit?.pageURL || "") };
}

async function resolveQuery(
    fetchFn: typeof fetch,
    apiKey: string,
    query: string,
    orientation: string | undefined,
    cacheDir: string,
    now: () => number
): Promise<string | null> {
    const cachePath = join(cacheDir, `${cacheKeyFor(query, orientation)}.json`);
    try {
        const raw = await readFile(cachePath, "utf8");
        const entry = JSON.parse(raw) as CacheEntry;
        if (entry?.dataUri && now() - entry.fetchedAt < CACHE_TTL_MS) {
            return entry.dataUri;
        }
    } catch {
        // cache miss hoặc file hỏng — đi tiếp xuống API
    }
    const entry = await searchAndDownload(fetchFn, apiKey, query, orientation);
    if (!entry) return null;
    entry.fetchedAt = now();
    await writeFile(cachePath, JSON.stringify(entry), "utf8").catch(() => {});
    return entry.dataUri;
}

/**
 * Dựng imageMap (sceneId -> [dataUri]) cho mọi scene có footageQuery.
 * Trả {} khi chưa cấu hình PIXABAY_API_KEY — pipeline chạy như cũ.
 */
export async function buildSceneImageMap(
    script: videoScript,
    options: FootageOptions = {}
): Promise<Record<string, string[]>> {
    const apiKey = options.apiKey ?? process.env.PIXABAY_API_KEY;
    if (!apiKey) return {};
    const fetchFn = options.fetchFn ?? fetch;
    const cacheDir = options.cacheDir ?? join(process.cwd(), "tmp", "footage-cache");
    const now = options.now ?? Date.now;
    await mkdir(cacheDir, { recursive: true }).catch(() => {});

    const map: Record<string, string[]> = {};
    const byQuery = new Map<string, Promise<string | null>>();
    for (const scene of script.scenes) {
        const query = (scene.footageQuery || "").trim();
        if (query.length < 3) continue;
        const dedupeKey = cacheKeyFor(query, options.orientation);
        if (!byQuery.has(dedupeKey)) {
            byQuery.set(
                dedupeKey,
                resolveQuery(fetchFn, apiKey, query, options.orientation, cacheDir, now).catch(() => null)
            );
        }
        const dataUri = await byQuery.get(dedupeKey)!;
        if (dataUri) {
            map[scene.id] = [dataUri];
            options.onProgress?.(`Footage: đã gắn ảnh thật cho ${scene.id} ("${query}")`);
        }
    }
    return map;
}
