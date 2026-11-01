import { videoScript } from "../llm/schema.js";
import { maskCommentsAndStrings } from "./compLinter.js";

/**
 * Chính sách nội dung cho mã scene chạy trong Chromium phía server.
 *
 * Mã scene (jsCode, globalSetupJs, script nhúng trong htmlCode) do LLM viết
 * hoặc do client gửi thẳng — đều là dữ liệu KHÔNG đáng tin, nhưng lại được
 * assembleHTML nội suy nguyên văn vào trang mà Chromium của server tải từ
 * file://. Trước đây cổng duy nhất là lint tất định (compLinter), vốn chỉ
 * chặn đồng hồ/RNG/timer — không chặn mạng hay nạp mã động, nên mã scene có
 * thể fetch tới dịch vụ nội bộ (loopback, metadata) và đưa dữ liệu ra ngoài.
 *
 * Module này là lớp chặn ở biên assemble: từ chối các nguyên thuỷ mạng và
 * nạp mã động. Đây là kiểm tra từ vựng best-effort (cùng mức đảm bảo như
 * compLinter: không resolve được indirection kiểu window['fe'+'tch']);
 * lớp phòng thủ thứ hai là networkGuard ở tầng Playwright, chặn request
 * thật bất kể mã scene lách qua cổng này bằng cách nào.
 */

export class SceneCodePolicyError extends Error {
    public violations: string[];

    constructor(message: string, violations: string[] = []) {
        super(message);
        this.name = "SceneCodePolicyError";
        this.violations = violations;
    }
}

interface PolicyRule {
    type: string;
    pattern: RegExp;
    message: string;
}

const POLICY_RULES: PolicyRule[] = [
    {
        type: "NETWORK_FETCH",
        pattern: /\b(?:window\.)?fetch\s*\(/g,
        message: "Forbidden network call fetch(). Scene code must be self-contained; assets are embedded by the pipeline.",
    },
    {
        type: "NETWORK_XHR",
        pattern: /\bXMLHttpRequest\b/g,
        message: "Forbidden network API XMLHttpRequest. Scene code must not perform network requests.",
    },
    {
        type: "NETWORK_WEBSOCKET",
        pattern: /\bWebSocket\b/g,
        message: "Forbidden network API WebSocket. Scene code must not open network connections.",
    },
    {
        type: "NETWORK_EVENTSOURCE",
        pattern: /\bEventSource\b/g,
        message: "Forbidden network API EventSource. Scene code must not open network connections.",
    },
    {
        type: "NETWORK_BEACON",
        pattern: /\bsendBeacon\s*\(/g,
        message: "Forbidden network call navigator.sendBeacon(). Scene code must not send data out.",
    },
    {
        type: "DYNAMIC_EVAL",
        pattern: /\b(?:window\.)?eval\s*\(/g,
        message: "Forbidden dynamic code execution eval(). Scene code must be static and reviewable.",
    },
    {
        type: "DYNAMIC_FUNCTION",
        pattern: /\b(?:new\s+Function|Function)\s*\(/g,
        message: "Forbidden dynamic code execution via Function constructor. Scene code must be static and reviewable.",
    },
    {
        type: "DYNAMIC_IMPORT",
        pattern: /\bimport\s*\(/g,
        message: "Forbidden dynamic import(). Scene code must not load additional code at runtime.",
    },
    {
        type: "DYNAMIC_IMPORT_SCRIPTS",
        pattern: /\bimportScripts\s*\(/g,
        message: "Forbidden importScripts(). Scene code must not load additional code at runtime.",
    },
];

/** Quét một đoạn JS (đã che chuỗi/comment như compLinter) và trả danh sách vi phạm. */
export function findSceneCodeViolations(
    code: string,
    context?: { source?: string; sceneId?: string }
): string[] {
    if (!code || typeof code !== "string") return [];
    const masked = maskCommentsAndStrings(code);
    const violations: string[] = [];
    for (const rule of POLICY_RULES) {
        rule.pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = rule.pattern.exec(masked)) !== null) {
            const loc = context?.sceneId
                ? `scene "${context.sceneId}"`
                : context?.source || "code";
            violations.push(`[${rule.type}] in ${loc}: ${rule.message}`);
        }
    }
    return violations;
}

function extractScriptsFromHtml(html: string): string[] {
    const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
    const results: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = scriptRegex.exec(html)) !== null) {
        results.push(match[1]);
    }
    return results;
}

/** Bắt cả mã nằm trong thuộc tính sự kiện inline (onerror="fetch(...)") của htmlCode. */
function findInlineHandlerViolations(html: string, sceneId?: string): string[] {
    const violations: string[] = [];
    const handlerRegex = /\bon\w+\s*=\s*("[^"]*"|'[^']*')/gi;
    let match: RegExpExecArray | null;
    while ((match = handlerRegex.exec(html)) !== null) {
        const inner = match[1].slice(1, -1);
        for (const v of findSceneCodeViolations(inner, { source: "scene.htmlCode inline handler", sceneId })) {
            violations.push(v);
        }
    }
    return violations;
}

/**
 * Assert toàn bộ script tuân thủ chính sách mã scene. Ném SceneCodePolicyError
 * nếu bất kỳ trường mã nào chứa nguyên thuỷ mạng / nạp mã động.
 */
export function assertSceneCodePolicy(script: videoScript): void {
    const violations: string[] = [];

    if (script.globalSetupJs) {
        violations.push(
            ...findSceneCodeViolations(script.globalSetupJs, { source: "globalSetupJs" })
        );
    }

    if (Array.isArray(script.scenes)) {
        for (const sc of script.scenes) {
            if (sc.jsCode) {
                violations.push(
                    ...findSceneCodeViolations(sc.jsCode, { source: "scene.jsCode", sceneId: sc.id })
                );
            }
            if (sc.htmlCode) {
                for (const code of extractScriptsFromHtml(sc.htmlCode)) {
                    violations.push(
                        ...findSceneCodeViolations(code, {
                            source: "scene.htmlCode.<script>",
                            sceneId: sc.id,
                        })
                    );
                }
                violations.push(...findInlineHandlerViolations(sc.htmlCode, sc.id));
            }
        }
    }

    if (violations.length > 0) {
        const summary = [
            `Scene code policy violated: Found ${violations.length} forbidden network/dynamic-code primitive(s):`,
            ...violations.map((v) => `  - ${v}`),
        ].join("\n");
        throw new SceneCodePolicyError(summary, violations);
    }
}
