import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { BrowserContext, Page } from "playwright";

/**
 * Chặn mạng ở tầng Playwright cho mọi trang render/preview của pipeline.
 *
 * Trang assemble chứa mã scene không đáng tin và chạy trong Chromium phía
 * server. Trước đây trang được tải không có request interception nào và
 * Chromium còn chạy với --disable-web-security, nên mã scene đọc được
 * response HTTP từ loopback/dịch vụ nội bộ rồi đưa ra ngoài qua chính
 * output render. Guard này cài route interception lên context/page:
 *
 * - file:// chỉ được đọc TRONG các thư mục gốc cho phép (thư mục job và các
 *   thư mục tài sản của app) — chặn đọc .env, /etc, thư mục job của tenant
 *   khác nằm ngoài gốc được cấp.
 * - http:// (không mã hoá) bị chặn toàn bộ; các đích pipeline dùng đều là https.
 * - https tới host nội bộ/private/loopback/link-local bị chặn (chống SSRF).
 * - fetch/XHR/beacon/eventsource/websocket chỉ tới danh sách host CDN mà
 *   trang assemble thật sự cần (GSAP, Google Fonts, Wikimedia).
 * - Tài nguyên tĩnh (script/style/image/font/media) từ host https công khai
 *   được phép để không vỡ cảnh dùng ảnh/thư viện ngoài hợp lệ.
 * - WebSocket bị đóng ngay (routeWebSocket) — render tất định không cần WS.
 *
 * Hàm quyết định `decideRequestAllowed` là hàm thuần để unit test không cần
 * trình duyệt.
 */

export const ALLOWED_FETCH_HOSTS = new Set<string>([
    "cdnjs.cloudflare.com",
    "fonts.googleapis.com",
    "fonts.gstatic.com",
    "upload.wikimedia.org",
    "commons.wikimedia.org",
]);

const SUBRESOURCE_TYPES = new Set([
    "script",
    "stylesheet",
    "image",
    "media",
    "font",
]);

export interface NetworkGuardOptions {
    /** Thư mục gốc được phép cho file:// (ngoài các gốc mặc định của app). */
    fileRoots?: string[];
    /** Bật/tắt log mỗi request bị chặn (mặc định bật, qua console.warn). */
    logBlocked?: boolean;
}

export interface RequestDecision {
    allowed: boolean;
    reason?: string;
}

function defaultFileRoots(): string[] {
    const cwd = process.cwd();
    return [join(cwd, "tmp"), join(cwd, "assets"), join(cwd, "uploads")];
}

function isPathInside(filePath: string, root: string): boolean {
    const r = resolve(root);
    const p = resolve(filePath);
    return p === r || p.startsWith(r + sep);
}

function isPrivateOrLocalHost(hostname: string): boolean {
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
        return true;
    }
    // IPv4
    const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (v4) {
        const [a, b] = [Number(v4[1]), Number(v4[2])];
        if (a === 127 || a === 10 || a === 0) return true;
        if (a === 172 && b >= 16 && b <= 31) return true;
        if (a === 192 && b === 168) return true;
        if (a === 169 && b === 254) return true; // link-local / cloud metadata
        if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT (tailnet 100.64/10)
        return false;
    }
    // IPv6: loopback, link-local, unique-local
    if (host === "::1" || host === "::") return true;
    if (host.startsWith("fe8") || host.startsWith("fe9") || host.startsWith("fea") || host.startsWith("feb")) return true;
    if (host.startsWith("fc") || host.startsWith("fd")) return true;
    return false;
}

/**
 * Quyết định một request có được phép rời khỏi trang render hay không.
 * `resourceType` là kiểu tài nguyên của Playwright (document, script, xhr, fetch, ...).
 */
export function decideRequestAllowed(
    url: string,
    resourceType: string,
    options?: NetworkGuardOptions
): RequestDecision {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return { allowed: false, reason: "invalid-url" };
    }

    const protocol = parsed.protocol;

    if (protocol === "data:" || protocol === "blob:" || protocol === "about:") {
        return { allowed: true };
    }

    if (protocol === "file:") {
        let filePath: string;
        try {
            filePath = fileURLToPath(parsed);
        } catch {
            return { allowed: false, reason: "file-url-unparsable" };
        }
        const roots = [...defaultFileRoots(), ...(options?.fileRoots ?? [])];
        if (roots.some((root) => isPathInside(filePath, root))) {
            return { allowed: true };
        }
        return { allowed: false, reason: "file-outside-allowed-roots" };
    }

    if (protocol === "http:") {
        return { allowed: false, reason: "plain-http-blocked" };
    }

    if (protocol === "https:") {
        if (isPrivateOrLocalHost(parsed.hostname)) {
            return { allowed: false, reason: "private-or-local-host" };
        }
        if (SUBRESOURCE_TYPES.has(resourceType)) {
            return { allowed: true };
        }
        // fetch/XHR/beacon/document/manifest/other: chỉ các host CDN đã biết.
        if (ALLOWED_FETCH_HOSTS.has(parsed.hostname.toLowerCase())) {
            return { allowed: true };
        }
        return { allowed: false, reason: "fetch-host-not-allowlisted" };
    }

    // ws:, wss:, chrome:, devtools:, ... — chặn hết.
    return { allowed: false, reason: `scheme-${protocol}-blocked` };
}

/**
 * Cài guard lên một BrowserContext (bảo vệ mọi page trong context) hoặc một
 * Page lẻ. Trả về bộ đếm số request đã bị chặn để nơi gọi log/kiểm chứng.
 */
export async function installNetworkGuard(
    target: BrowserContext | Page,
    options?: NetworkGuardOptions
): Promise<{ blockedCount: () => number }> {
    let blocked = 0;
    const logBlocked = options?.logBlocked !== false;

    await target.route("**/*", async (route) => {
        const request = route.request();
        const decision = decideRequestAllowed(request.url(), request.resourceType(), options);
        if (decision.allowed) {
            await route.continue().catch(() => {});
            return;
        }
        blocked += 1;
        if (logBlocked) {
            console.warn(
                `[NetworkGuard] Blocked ${request.resourceType()} ${request.url()} (${decision.reason})`
            );
        }
        await route.abort("blockedbyclient").catch(() => {});
    });

    // WebSocket không đi qua route() thường — đóng ngay mọi kết nối WS/WSS.
    const anyTarget = target as unknown as {
        routeWebSocket?: (pattern: string, handler: (ws: { close: (opts?: { code?: number; reason?: string }) => Promise<void> }) => Promise<void>) => Promise<void>;
    };
    if (typeof anyTarget.routeWebSocket === "function") {
        await anyTarget
            .routeWebSocket("**/*", async (ws) => {
                blocked += 1;
                if (logBlocked) {
                    console.warn("[NetworkGuard] Blocked WebSocket connection during render");
                }
                await ws.close({ code: 1008, reason: "WebSocket disabled during render" }).catch(() => {});
            })
            .catch(() => {});
    }

    return { blockedCount: () => blocked };
}
