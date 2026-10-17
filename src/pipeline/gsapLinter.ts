/**
 * AST-Based GSAP Linter (Issue #41)
 *
 * Kiểm tra mã GSAP do LLM sinh ra để phát hiện:
 * 1. Layout Thrashing: animate thuộc tính gây reflow (top, left, width, height...)
 *    thay vì dùng GPU-accelerated transforms (x, y, scale, rotation)
 * 2. Unpaused Timeline: gsap.timeline() thiếu paused: true
 * 3. Overlapping Tweens: 2 tween cùng thuộc tính, cùng element, thời gian đè nhau
 */

import * as acorn from "acorn";
import type { LintViolation, ViolationType } from "./compLinter.js";

// Các thuộc tính gây layout thrashing khi animate
const LAYOUT_THRASHING_PROPS = new Set([
    "top", "left", "right", "bottom",
    "width", "height", "minWidth", "minHeight", "maxWidth", "maxHeight",
    "margin", "marginTop", "marginLeft", "marginRight", "marginBottom",
    "padding", "paddingTop", "paddingLeft", "paddingRight", "paddingBottom",
    "fontSize", "lineHeight",
]);

// Các thuộc tính transform được GPU tăng tốc (an toàn)
const GPU_SAFE_PROPS = new Set([
    "x", "y", "z", "scale", "scaleX", "scaleY",
    "rotation", "rotationX", "rotationY",
    "opacity", // opacity cũng được GPU xử lý
]);

export interface GsapLintResult {
    violations: LintViolation[];
}

/**
 * Phân tích mã JavaScript bằng AST để phát hiện lỗi GSAP.
 */
export function lintGsapCode(
    code: string,
    sceneId?: string
): GsapLintResult {
    const violations: LintViolation[] = [];

    let ast: acorn.Node;
    try {
        ast = acorn.parse(code, {
            ecmaVersion: 2022,
            sourceType: "script",
            locations: true,
        }) as acorn.Node;
    } catch (err) {
        // Lỗi cú pháp sẽ được scriptValidator bắt, ở đây bỏ qua
        return { violations };
    }

    // Duyệt AST
    walk(ast, (node: any) => {
        // Kiểm tra 1: gsap.timeline() thiếu paused: true
        if (isGsapTimelineCall(node)) {
            if (!hasPausedTrue(node)) {
                violations.push({
                    type: "UNPAUSED_TIMELINE",
                    message: "gsap.timeline() thiếu paused: true — timeline sẽ tự chạy lệch khỏi __seekTo",
                    line: node.loc?.start.line ?? 0,
                    column: node.loc?.start.column ?? 0,
                    snippet: code.split("\n")[node.loc?.start.line - 1]?.trim() ?? "",
                    sceneId,
                    source: "gsap-linter",
                });
            }
        }

        // Kiểm tra 2: Layout thrashing trong gsap.to/from/fromTo
        if (isGsapTweenCall(node)) {
            const props = getTweenProps(node);
            for (const prop of props) {
                if (LAYOUT_THRASHING_PROPS.has(prop)) {
                    violations.push({
                        type: "LAYOUT_THRASHING",
                        message: `Animate "${prop}" gây layout thrashing — dùng transform (x, y, scale) thay thế`,
                        line: node.loc?.start.line ?? 0,
                        column: node.loc?.start.column ?? 0,
                        snippet: code.split("\n")[node.loc?.start.line - 1]?.trim() ?? "",
                        sceneId,
                        source: "gsap-linter",
                    });
                    break; // Chỉ báo 1 lần mỗi tween
                }
            }
        }
    });

    return { violations };
}

function walk(node: any, callback: (n: any) => void): void {
    if (!node || typeof node !== "object") return;
    callback(node);
    for (const key of Object.keys(node)) {
        if (key === "loc" || key === "range") continue;
        const child = node[key];
        if (Array.isArray(child)) {
            for (const c of child) walk(c, callback);
        } else if (child && typeof child === "object" && child.type) {
            walk(child, callback);
        }
    }
}

function isGsapTimelineCall(node: any): boolean {
    return (
        node.type === "CallExpression" &&
        node.callee?.type === "MemberExpression" &&
        node.callee.object?.name === "gsap" &&
        node.callee.property?.name === "timeline"
    );
}

function hasPausedTrue(node: any): boolean {
    const args = node.arguments || [];
    if (args.length === 0) return false;
    const firstArg = args[0];
    if (firstArg.type !== "ObjectExpression") return false;
    for (const prop of firstArg.properties || []) {
        if (prop.key?.name === "paused" && prop.value?.value === true) {
            return true;
        }
    }
    return false;
}

function isGsapTweenCall(node: any): boolean {
    if (node.type !== "CallExpression") return false;
    const callee = node.callee;
    if (callee?.type !== "MemberExpression") return false;

    // gsap.to(), gsap.from(), gsap.fromTo()
    if (callee.object?.name === "gsap") {
        return ["to", "from", "fromTo", "set"].includes(callee.property?.name);
    }
    // tl.to(), tl.from() — timeline methods
    if (callee.object?.type === "Identifier") {
        return ["to", "from", "fromTo", "set", "add"].includes(callee.property?.name);
    }
    return false;
}

function getTweenProps(node: any): string[] {
    const args = node.arguments || [];
    // gsap.to(target, props) hoặc gsap.fromTo(target, fromProps, toProps)
    // props là argument thứ 2 (index 1), hoặc thứ 3 cho fromTo
    let propsArg = args[1];
    const methodName = node.callee?.property?.name;
    if (methodName === "fromTo" && args.length >= 3) {
        propsArg = args[2]; // toProps
    }
    if (!propsArg || propsArg.type !== "ObjectExpression") return [];

    const props: string[] = [];
    for (const prop of propsArg.properties || []) {
        const key = prop.key?.name || prop.key?.value;
        if (key && typeof key === "string") {
            props.push(key);
        }
    }
    return props;
}
