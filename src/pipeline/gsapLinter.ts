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

/** Các key trong vars object không phải thuộc tính animate. */
const NON_ANIMATED_VARS = new Set([
    "duration", "delay", "ease", "repeat", "repeatDelay", "repeatRefresh",
    "yoyo", "yoyoEase", "stagger", "overwrite", "paused", "immediateRender",
    "lazy", "callbackScope", "onComplete", "onCompleteParams", "onStart",
    "onStartParams", "onUpdate", "onUpdateParams", "onRepeat", "onRepeatParams",
    "onReverseComplete", "onReverseCompleteParams", "onInterrupt", "data",
    "id", "keyframes", "runBackwards", "startAt", "inherit", "defaults",
    "scrollTrigger", "motionPath", "physics2D", "snap", "modifiers",
]);

/** Một tween đã trích xuất, đủ thông tin để so chồng lấn thời gian. */
export interface GsapTweenInfo {
    /** Target tĩnh (selector/identifier). null = target động, không phân tích. */
    target: string | null;
    props: string[];
    /** Giá trị `ease` dạng literal (đã lowercase); null = mặc định GSAP. */
    ease: string | null;
    start: number;
    end: number;
    /** repeat: -1 → không xác định được điểm kết thúc. */
    unbounded: boolean;
    /** Không resolve được start/duration → bỏ khỏi phân tích chồng lấn. */
    resolvable: boolean;
    /** Resolve được thời điểm bắt đầu (position + delay là literal). */
    startKnown: boolean;
    /** Resolve được duration (không phải biểu thức động như `dur - 1.2`). */
    durationKnown: boolean;
    line: number;
    column: number;
}

const GSAP_DEFAULT_DURATION = 0.5;
const OVERLAP_EPSILON = 1e-6;

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

    const registeredTimelines = collectRegisteredTimelines(ast);

    // Duyệt AST
    walk(ast, (node: any) => {
        // Kiểm tra 1: gsap.timeline() thiếu paused: true (trừ timeline đã đăng ký)
        if (isGsapTimelineCall(node)) {
            if (!hasPausedTrue(node) && !isRegisteredTimeline(node, registeredTimelines)) {
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

    // Kiểm tra 3: Overlapping tweens (#41)
    const tweenNodes: any[] = [];
    walk(ast, (node: any) => {
        if (isGsapTweenCall(node) && node.callee?.property?.name !== "add") {
            tweenNodes.push(node);
        }
    });
    violations.push(...findOverlappingTweens(tweenNodes, code, sceneId));

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


/**
 * Timeline đã đăng ký với `window.__registerScene(...)` được master timeline
 * (đang paused) điều khiển, nên KHÔNG cần `paused: true`.
 *
 * Prompt của pipeline hướng dẫn đúng mẫu này:
 *   const tl = gsap.timeline();
 *   ...
 *   window.__registerScene('scene_1', tl, dur);
 * Nếu cứ bắt buộc `paused: true` thì mọi scene do LLM sinh ra đều bị báo oan.
 * Vì vậy chỉ báo UNPAUSED_TIMELINE cho timeline không được đăng ký.
 */
function collectRegisteredTimelines(ast: any): {
    bindings: Map<any, string>;
    registeredNames: Set<string>;
    inlineRegistered: Set<any>;
} {
    const bindings = new Map<any, string>();
    walk(ast, (node: any) => {
        if (node.type !== "VariableDeclarator" || node.id?.type !== "Identifier" || !node.init) return;
        walk(node.init, (inner: any) => {
            if (isGsapTimelineCall(inner)) bindings.set(inner, node.id.name);
        });
    });

    const registeredNames = new Set<string>();
    const inlineRegistered = new Set<any>();
    walk(ast, (node: any) => {
        if (node.type !== "CallExpression") return;
        const callee = node.callee;
        const isRegister =
            (callee?.type === "Identifier" && callee.name === "__registerScene") ||
            (callee?.type === "MemberExpression" && callee.property?.name === "__registerScene");
        if (!isRegister) return;
        const arg = node.arguments?.[1];
        if (arg?.type === "Identifier") {
            registeredNames.add(arg.name);
        } else if (arg) {
            walk(arg, (inner: any) => {
                if (isGsapTimelineCall(inner)) inlineRegistered.add(inner);
            });
        }
    });

    return { bindings, registeredNames, inlineRegistered };
}

function isRegisteredTimeline(
    node: any,
    registered: ReturnType<typeof collectRegisteredTimelines>
): boolean {
    if (registered.inlineRegistered.has(node)) return true;
    const name = registered.bindings.get(node);
    return name !== undefined && registered.registeredNames.has(name);
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

    const method = callee.property?.name;
    const obj = callee.object;

    // gsap.to(), gsap.from(), gsap.fromTo()
    if (obj?.name === "gsap") {
        return ["to", "from", "fromTo", "set"].includes(method);
    }
    // tl.to(), tl.from() — timeline methods (kể cả chuỗi .to().to())
    if (obj?.type === "Identifier" || obj?.type === "CallExpression" || obj?.type === "MemberExpression") {
        return ["to", "from", "fromTo", "set", "add"].includes(method);
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

// ---------------------------------------------------------------------------
// OVERLAPPING_TWEEN (#41)
// ---------------------------------------------------------------------------

interface TimelineCursor {
    lastStart: number;
    lastEnd: number;
}

function isGlobalGsapCall(node: any): boolean {
    const obj = node?.callee?.object;
    return obj?.type === "Identifier" && obj.name === "gsap";
}

/** Lấy key của timeline mà tween được gắn vào (hỗ trợ cả chuỗi .to().to()). */
function timelineKey(node: any): string {
    let root = node?.callee?.object;
    let chainStart: number | null = null;
    while (root && (root.type === "MemberExpression" || root.type === "CallExpression")) {
        if (root.type === "CallExpression") {
            chainStart = root.start;
            root = root.callee;
        } else {
            root = root.object;
        }
    }
    if (root?.type === "Identifier" && root.name !== "gsap") return root.name;
    if (chainStart !== null) return `chain@${chainStart}`;
    if (root?.type === "Identifier") return root.name;
    return `unknown@${node?.start ?? 0}`;
}

function getVarsObject(node: any): any | null {
    const args = node.arguments || [];
    const method = node.callee?.property?.name;
    const vars = method === "fromTo" ? args[2] : args[1];
    return vars && vars.type === "ObjectExpression" ? vars : null;
}

function findVarsProp(vars: any, name: string): any | null {
    if (!vars) return null;
    for (const prop of vars.properties || []) {
        const key = prop.key?.name ?? prop.key?.value;
        if (key === name) return prop.value;
    }
    return null;
}

/** Đọc số từ literal hoặc unary minus literal; null nếu là biểu thức động. */
function readNumber(valueNode: any): number | null {
    if (!valueNode) return null;
    if (valueNode.type === "Literal" && typeof valueNode.value === "number") {
        return valueNode.value;
    }
    if (
        valueNode.type === "UnaryExpression" &&
        valueNode.operator === "-" &&
        valueNode.argument?.type === "Literal" &&
        typeof valueNode.argument.value === "number"
    ) {
        return -valueNode.argument.value;
    }
    return null;
}

/** Target tĩnh: selector string, identifier, mảng literal, querySelector("..."). */
function extractTarget(arg: any): string | null {
    if (!arg) return null;
    if (arg.type === "Literal" && typeof arg.value === "string") return arg.value;
    if (arg.type === "Identifier") return `id:${arg.name}`;
    if (arg.type === "ArrayExpression") {
        const parts: string[] = [];
        for (const el of arg.elements || []) {
            const t = extractTarget(el);
            if (t === null) return null;
            parts.push(t);
        }
        return `[${parts.sort().join(",")}]`;
    }
    if (arg.type === "CallExpression" && arg.callee?.type === "MemberExpression") {
        const method = arg.callee.property?.name;
        const first = arg.arguments?.[0];
        if (
            (method === "querySelector" || method === "querySelectorAll" || method === "getElementById") &&
            first?.type === "Literal" &&
            typeof first.value === "string"
        ) {
            return method === "getElementById" ? `#${first.value}` : first.value;
        }
    }
    return null;
}

function extractAnimatedProps(vars: any): string[] {
    const props: string[] = [];
    for (const prop of vars?.properties || []) {
        const key = prop.key?.name ?? prop.key?.value;
        if (typeof key !== "string") continue;
        if (NON_ANIMATED_VARS.has(key)) continue;
        if (key.startsWith("on")) continue;
        props.push(key);
    }
    return props;
}

/** Đọc `ease` dạng literal; biểu thức động (vd ease: someVar) → null. */
function extractEase(vars: any): string | null {
    const value = findVarsProp(vars, "ease");
    if (!value) return null;
    if (value.type === "Literal" && typeof value.value === "string") {
        return value.value.trim().toLowerCase();
    }
    return null;
}

function parsePositionString(raw: string): { base: "prevStart" | "prevEnd"; offset: number } | null {
    const s = raw.trim();
    if (s === "<") return { base: "prevStart", offset: 0 };
    if (s === ">") return { base: "prevEnd", offset: 0 };

    let base: "prevStart" | "prevEnd" = "prevEnd";
    let rest = s;
    if (rest.startsWith("<")) {
        base = "prevStart";
        rest = rest.slice(1);
    } else if (rest.startsWith(">")) {
        base = "prevEnd";
        rest = rest.slice(1);
    }
    if (rest === "") return { base, offset: 0 };

    const relative = /^([+-])=\s*(\d*\.?\d+)$/.exec(rest);
    if (relative) return { base, offset: Number(`${relative[1]}${relative[2]}`) };
    return null;
}

/**
 * Trích xuất toàn bộ tween và resolve thời điểm bắt đầu/kết thúc theo timeline.
 * Chỉ tween có target tĩnh + start/duration xác định mới được dùng để so chồng lấn.
 */
export function collectGsapTweens(nodes: any[], code: string): GsapTweenInfo[] {
    const sorted = [...nodes].sort((a, b) => (a.start ?? 0) - (b.start ?? 0) || (a.end ?? 0) - (b.end ?? 0));
    const cursors = new Map<string, TimelineCursor>();
    const tweens: GsapTweenInfo[] = [];

    for (const node of sorted) {
        const method = node.callee?.property?.name;
        const vars = getVarsObject(node);
        const target = extractTarget(node.arguments?.[0]);
        const props = extractAnimatedProps(vars);
        const ease = extractEase(vars);

        let resolvable = true;
        let startKnown = true;
        let durationKnown = true;
        let unbounded = false;

        // duration + repeat
        let duration = method === "set" ? 0 : GSAP_DEFAULT_DURATION;
        const durationNode = findVarsProp(vars, "duration");
        if (durationNode) {
            const parsed = readNumber(durationNode);
            if (parsed === null) {
                resolvable = false;
                durationKnown = false;
            } else {
                duration = parsed;
            }
        }
        const repeat = readNumber(findVarsProp(vars, "repeat"));
        if (repeat === -1) {
            unbounded = true;
        } else if (repeat !== null && repeat > 0) {
            const repeatDelay = readNumber(findVarsProp(vars, "repeatDelay")) ?? 0;
            duration = duration * (1 + repeat) + repeatDelay * repeat;
        }

        const delayNode = findVarsProp(vars, "delay");
        const delay = readNumber(delayNode) ?? 0;
        if (delayNode && readNumber(delayNode) === null) {
            resolvable = false;
            startKnown = false;
        }

        // start
        let start = 0;
        if (isGlobalGsapCall(node)) {
            // gsap.to/from/fromTo không nhận position — luôn bắt đầu ở 0 + delay
            start = delay;
        } else {
            const key = timelineKey(node);
            const cursor = cursors.get(key) ?? { lastStart: 0, lastEnd: 0 };
            const positionArg = method === "fromTo" ? node.arguments?.[3] : node.arguments?.[2];

            if (!positionArg) {
                start = cursor.lastEnd + delay;
            } else if (positionArg.type === "Literal" && typeof positionArg.value === "number") {
                start = positionArg.value + delay;
            } else if (positionArg.type === "Literal" && typeof positionArg.value === "string") {
                const pos = parsePositionString(positionArg.value);
                if (!pos) {
                    resolvable = false;
                    startKnown = false;
                    start = cursor.lastEnd + delay;
                } else if (pos.base === "prevStart") {
                    start = cursor.lastStart + pos.offset + delay;
                } else {
                    start = cursor.lastEnd + pos.offset + delay;
                }
            } else {
                resolvable = false;
                startKnown = false;
                start = cursor.lastEnd + delay;
            }

            cursors.set(key, { lastStart: start, lastEnd: start + duration });
        }

        tweens.push({
            target,
            props,
            ease,
            start,
            end: start + duration,
            unbounded,
            resolvable: resolvable && target !== null && props.length > 0,
            startKnown,
            durationKnown,
            line: node.loc?.start.line ?? 0,
            column: node.loc?.start.column ?? 0,
        });
    }

    return tweens;
}

/** Báo khi 2 tween cùng target + cùng thuộc tính giao khoảng thời gian. */
export function findOverlappingTweens(
    nodes: any[],
    code: string,
    sceneId?: string
): LintViolation[] {
    const tweens = collectGsapTweens(nodes, code).filter((t) => t.resolvable && !t.unbounded);
    const violations: LintViolation[] = [];
    const lines = code.split("\n");

    for (let i = 0; i < tweens.length; i++) {
        for (let j = i + 1; j < tweens.length; j++) {
            const a = tweens[i];
            const b = tweens[j];
            if (a.target !== b.target) continue;
            if (!(a.start < b.end - OVERLAP_EPSILON && b.start < a.end - OVERLAP_EPSILON)) continue;

            const shared = a.props.filter((p) => b.props.includes(p));
            if (shared.length === 0) continue;

            const shown = shared.slice(0, 3).join(", ");
            const suffix = shared.length > 3 ? `, +${shared.length - 3}` : "";
            violations.push({
                type: "OVERLAPPING_TWEEN",
                message:
                    `Hai tween cùng target "${a.target}" cùng animate "${shown}${suffix}" chồng thời gian ` +
                    `(${a.start.toFixed(2)}–${a.end.toFixed(2)}s và ${b.start.toFixed(2)}–${b.end.toFixed(2)}s) — ` +
                    `tween sau sẽ ghi đè tween trước; gộp thành một tween hoặc lệch thời điểm`,
                line: b.line,
                column: b.column,
                snippet: lines[b.line - 1]?.trim() ?? "",
                sceneId,
                source: "gsap-linter",
            });
        }
    }

    return violations;
}

// ---------------------------------------------------------------------------
// Anti-slop motion grammar (#124)
// ---------------------------------------------------------------------------

/**
 * Thuộc tính "chuyển động biểu đạt" — animate bằng ease tuyến tính là dấu hiệu
 * slideshow: phần tử trượt/phóng đều đều như máy, không có gia tốc.
 */
const EXPRESSIVE_MOTION_PROPS = new Set(["x", "y", "scale", "scaleX", "scaleY"]);

/** GSAP coi `none` và `linear` là cùng một thứ. */
const LINEAR_EASES = new Set(["none", "linear", "linear.none"]);

/** Khoảng lặng tối đa (giây) trước khi báo STATIC_TOO_LONG. */
const DEFAULT_STATIC_GAP_SEC = 1;

export interface MotionLintUnit {
    code: string;
    /** Dòng bắt đầu của unit trong file gốc (script inline trong HTML). */
    lineOffset?: number;
}

export interface SceneMotionLintInput {
    sceneId: string;
    /** Độ dài scene (giây); không có → bỏ qua STATIC_TOO_LONG. */
    duration?: number;
    /** Scene khai đứng yên có chủ đích → miễn STATIC_TOO_LONG. */
    nearStill?: { from: number; to: number };
    /** Camera move đã khai (#122); camera chạy thì scene không còn "chỉ fade". */
    cameraMove?: string;
    units: MotionLintUnit[];
}

export interface SceneMotionLintOptions {
    /** Ngưỡng im lặng (giây) trước khi báo STATIC_TOO_LONG. Mặc định 1. */
    staticGapSec?: number;
}

interface UnitTween extends GsapTweenInfo {
    unit: MotionLintUnit;
    /** Dòng trong unit (chưa cộng lineOffset). */
    unitLine: number;
}

function parseTweenNodes(code: string): any[] | null {
    let ast: acorn.Node;
    try {
        ast = acorn.parse(code, {
            ecmaVersion: 2022,
            sourceType: "script",
            locations: true,
        }) as acorn.Node;
    } catch {
        // Cú pháp hỏng do scriptValidator xử lý; trả null để caller biết là
        // "không đọc được", khác với "scene không có tween nào".
        return null;
    }
    const nodes: any[] = [];
    walk(ast, (node: any) => {
        if (isGsapTweenCall(node) && node.callee?.property?.name !== "add") {
            nodes.push(node);
        }
    });
    return nodes;
}

/**
 * Chấm ngữ pháp chuyển động của MỘT scene trên toàn bộ code của scene
 * (`jsCode` + các `<script>` inline trong `htmlCode`).
 *
 * Cả 4 rule đều warn-only: caller quyết định warn/fail (cùng cơ chế
 * `gsapLintStrict` của #41).
 */
export function lintSceneMotion(
    input: SceneMotionLintInput,
    options?: SceneMotionLintOptions
): LintViolation[] {
    const gapSec = options?.staticGapSec ?? DEFAULT_STATIC_GAP_SEC;
    const sceneSelector = `#${input.sceneId}`;
    const violations: LintViolation[] = [];

    const tweens: UnitTween[] = [];
    let parseFailed = false;
    for (const unit of input.units) {
        if (!unit.code || !unit.code.trim()) continue;
        const nodes = parseTweenNodes(unit.code);
        if (nodes === null) {
            parseFailed = true;
            continue;
        }
        for (const tween of collectGsapTweens(nodes, unit.code)) {
            tweens.push({
                ...tween,
                unit,
                unitLine: tween.line,
                line: tween.line + (unit.lineOffset ?? 0),
            });
        }
    }

    const report = (
        type: ViolationType,
        message: string,
        tween?: UnitTween,
        line = 1
    ): void => {
        const unitLine = tween?.unitLine ?? line;
        violations.push({
            type,
            message,
            line: tween?.line ?? line,
            column: tween?.column ?? 0,
            snippet:
                (tween?.unit.code.split("\n")[unitLine - 1] ??
                    input.units[0]?.code.split("\n")[line - 1] ??
                    "").trim(),
            sceneId: input.sceneId,
            source: "gsap-linter",
        });
    };

    const expressiveProps = (tween: GsapTweenInfo): string[] =>
        tween.props.filter((prop) => EXPRESSIVE_MOTION_PROPS.has(prop));

    // 1. LINEAR_EASE — chuyển động biểu đạt chạy đều đều như máy.
    for (const tween of tweens) {
        if (!tween.ease || !LINEAR_EASES.has(tween.ease)) continue;
        const props = expressiveProps(tween);
        if (props.length === 0) continue;
        // Camera layer (#122) do pipeline gắn và cố ý dùng ease 'none' để seek-safe;
        // animate container scene là lỗi khác, đã có MOVE_LIBRARY_BYPASS.
        if (tween.target === sceneSelector) continue;
        report(
            "LINEAR_EASE",
            `Tween "${props.join(", ")}" dùng ease '${tween.ease}' — chuyển động biểu đạt cần ease có gia tốc (power2.out, back.out, …), ease tuyến tính đọc như slideshow`,
            tween
        );
    }

    // 2. FADE_ONLY_SCENE — scene chỉ biết mờ dần, không có chuyển động thật.
    const animated = tweens.filter((tween) => tween.props.length > 0);
    const cameraMoving = !!input.cameraMove && input.cameraMove !== "locked";
    if (animated.length > 0 && !cameraMoving) {
        const fadeOnly = animated.every((tween) =>
            tween.props.every((prop) => prop === "opacity" || prop === "autoAlpha")
        );
        if (fadeOnly) {
            report(
                "FADE_ONLY_SCENE",
                `Scene chỉ có tween opacity (${animated.length} tween) — không có chuyển động nào khác; thêm transform/scale hoặc chuyển động nền thay vì chỉ fade`,
                animated[0]
            );
        }
    }

    // 3. STATIC_TOO_LONG — scene đứng yên quá lâu giữa các tween.
    const duration = input.duration;
    if (
        !input.nearStill &&
        typeof duration === "number" &&
        Number.isFinite(duration) &&
        duration > 0
    ) {
        // Không đoán khi start không resolve được hoặc parse hỏng.
        const trustworthy = !parseFailed && tweens.every((tween) => tween.startKnown);
        if (trustworthy) {
            const intervals = tweens
                .map((tween) => {
                    // duration động (`dur - 1.2`) hoặc loop vô hạn: coi như phủ tới
                    // cuối scene — ambient chạy dài, không phải scene đứng yên.
                    const end =
                        tween.durationKnown && !tween.unbounded
                            ? tween.end
                            : Math.max(tween.start, duration);
                    return [tween.start, end] as [number, number];
                })
                .sort((a, b) => a[0] - b[0]);
            const merged: Array<[number, number]> = [];
            for (const interval of intervals) {
                const last = merged[merged.length - 1];
                if (last && interval[0] <= last[1] + OVERLAP_EPSILON) {
                    last[1] = Math.max(last[1], interval[1]);
                } else {
                    merged.push([interval[0], interval[1]]);
                }
            }

            let gap: { from: number; to: number } = { from: 0, to: duration };
            if (merged.length > 0) {
                gap = { from: 0, to: Math.min(merged[0][0], duration) };
                for (let i = 1; i < merged.length; i += 1) {
                    const from = merged[i - 1][1];
                    const to = merged[i][0];
                    if (to - from > gap.to - gap.from) gap = { from, to };
                }
                const tailFrom = Math.min(merged[merged.length - 1][1], duration);
                if (duration - tailFrom > gap.to - gap.from) {
                    gap = { from: tailFrom, to: duration };
                }
            }

            const gapLength = Math.max(0, gap.to - gap.from);
            if (gapLength > gapSec + OVERLAP_EPSILON) {
                // Chọn tween gần khoảng lặng nhất để chỉ đúng dòng cần sửa.
                let anchor: UnitTween | undefined;
                let best = Number.POSITIVE_INFINITY;
                for (const tween of tweens) {
                    const distance = Math.min(
                        Math.abs(tween.end - gap.from),
                        Math.abs(tween.start - gap.to)
                    );
                    if (distance < best) {
                        best = distance;
                        anchor = tween;
                    }
                }
                const where =
                    tweens.length === 0
                        ? `Scene không có tween nào trong ${duration.toFixed(1)}s`
                        : `Không có chuyển động mới trong ${gapLength.toFixed(1)}s (${gap.from.toFixed(1)}–${gap.to.toFixed(1)}s / scene ${duration.toFixed(1)}s)`;
                report(
                    "STATIC_TOO_LONG",
                    `${where} — scene dừng quá lâu; thêm tween hoặc khai nearStill nếu đứng yên có chủ đích`,
                    anchor
                );
            }
        }
    }

    // 4. MOVE_LIBRARY_BYPASS — tự animate container thay vì khai scene.camera.
    for (const tween of tweens) {
        if (tween.target !== sceneSelector) continue;
        const props = expressiveProps(tween);
        if (props.length === 0) continue;
        // Transform + fade cùng lúc là transition vào/ra, không phải camera.
        // Chỉ transform thuần trên container mới là "tự làm camera".
        if (tween.props.some((prop) => prop === "opacity" || prop === "autoAlpha")) continue;
        report(
            "MOVE_LIBRARY_BYPASS",
            `Tự animate "${props.join(", ")}" trên container scene ${sceneSelector} — khai scene.camera (push-in, pan-left, …) để pipeline điều khiển thay vì tự animate container`,
            tween
        );
    }

    return violations;
}
