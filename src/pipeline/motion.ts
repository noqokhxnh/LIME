import type { Page } from "playwright";
import { seekToTimestamp } from "./preview.js";

/**
 * Bounding box hình học của một phần tử DOM
 */
export interface DOMBox {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

/**
 * Mô tả vector chuyển động của một phần tử trong khoảng thời gian [t0, t1] (Spec D)
 */
export interface MotionVector {
    selector: string;
    dx: number;
    dy: number;
}

/**
 * Kết quả phân tích chuyển động giữa 2 mốc thời gian
 */
export interface MotionDetectionResult {
    hasMotion: boolean;
    maxDisplacement: number;
    totalDisplacement: number;
    vectors: MotionVector[];
}

/**
 * Cấu hình Shutter Motion Blur (Spec D)
 */
export interface ShutterBlurOptions {
    /** Số lượng mẫu sub-frame (K), mặc định K=8 */
    shutterSamples?: number;
    /** Bỏ qua hiệu ứng làm mờ chuyển động */
    skipShutterBlur?: boolean;
    /** Seed sinh số ngẫu nhiên xác định (Spec B) */
    seed?: number;
}

/**
 * Lấy thông tin chuyển động do chính composition khai báo qua window.__motion(t0, t1).
 * Trả về danh sách MotionVector nếu comp có khai báo, hoặc null nếu không khai báo.
 */
export async function getCompMotion(
    page: Page,
    t0: number,
    t1: number
): Promise<MotionVector[] | null> {
    return await page.evaluate(
        ({ t0, t1 }) => {
            const win = window as any;
            if (typeof win.__motion === "function") {
                try {
                    const result = win.__motion(t0, t1);
                    if (Array.isArray(result)) {
                        return result.map((item: any) => ({
                            selector: String(item.selector || ""),
                            dx: Number(item.dx) || 0,
                            dy: Number(item.dy) || 0,
                        }));
                    }
                } catch (err) {
                    console.warn("[Motion] Lỗi khi thực thi window.__motion:", err);
                }
            }
            return null;
        },
        { t0, t1 }
    );
}

/**
 * Lấy mẫu vị trí bounding box của các phần tử DOM trên trang tại thời điểm hiện tại.
 * Tái sử dụng logic lấy mẫu và kiểm tra visibility/opacity từ Oracle QA.
 */
export async function sampleDOMBoxes(
    page: Page,
    selectors?: string[]
): Promise<Record<string, DOMBox | null>> {
    return await page.evaluate((customSels?: string[]) => {
        let sels = customSels;
        if (!sels || sels.length === 0) {
            const found = new Set<string>();
            const candidates = document.querySelectorAll(
                "#viewport [id], #viewport .scene, #viewport svg, #viewport img, #viewport h1, #viewport h2, #viewport p, #viewport .char, #viewport .word, #viewport .stickman-svg, #viewport div"
            );
            candidates.forEach((el) => {
                if (el.id) {
                    found.add("#" + el.id);
                } else if (el.className && typeof el.className === "string") {
                    const cls = el.className.trim().split(/\s+/)[0];
                    if (cls && !cls.startsWith("fx-")) {
                        found.add("." + cls);
                    }
                }
            });
            sels = Array.from(found).slice(0, 60);
        }

        const out: Record<string, { left: number; top: number; right: number; bottom: number; width: number; height: number } | null> = {};
        for (const sel of sels) {
            try {
                const el =
                    document.querySelector(sel) ||
                    document.getElementById(sel.replace(/^#/, ""));
                if (!el) {
                    out[sel] = null;
                    continue;
                }
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                if (
                    style.display === "none" ||
                    style.visibility === "hidden" ||
                    parseFloat(style.opacity || "1") <= 0.01
                ) {
                    out[sel] = null;
                    continue;
                }
                out[sel] = {
                    left: rect.left,
                    top: rect.top,
                    right: rect.right,
                    bottom: rect.bottom,
                    width: rect.width,
                    height: rect.height,
                };
            } catch {
                out[sel] = null;
            }
        }
        return out;
    }, selectors);
}

/**
 * Tính toán độ dịch chuyển từ hai tập mẫu bounding box tại t0 và t1.
 * Pure function độc lập để dễ dàng kiểm thử và đảm bảo tính xác định.
 */
export function computeDisplacementFromBoxes(
    boxes0: Record<string, DOMBox | null>,
    boxes1: Record<string, DOMBox | null>
): MotionDetectionResult {
    const vectors: MotionVector[] = [];
    let totalDisplacement = 0;
    let maxDisplacement = 0;

    const allKeys = new Set([...Object.keys(boxes0), ...Object.keys(boxes1)]);
    for (const key of allKeys) {
        const b0 = boxes0[key];
        const b1 = boxes1[key];
        if (!b0 || !b1) continue;

        const c0 = { x: b0.left + b0.width / 2, y: b0.top + b0.height / 2 };
        const c1 = { x: b1.left + b1.width / 2, y: b1.top + b1.height / 2 };
        const dx = c1.x - c0.x;
        const dy = c1.y - c0.y;
        const cornerDist = Math.hypot(b1.left - b0.left, b1.top - b0.top);
        const dist = Math.max(Math.hypot(dx, dy), cornerDist);

        if (dist > 0.01) {
            vectors.push({
                selector: key,
                dx: Math.round(dx * 100) / 100,
                dy: Math.round(dy * 100) / 100,
            });
            totalDisplacement += dist;
            if (dist > maxDisplacement) {
                maxDisplacement = dist;
            }
        }
    }

    const roundedMax = Math.round(maxDisplacement * 100) / 100;
    const roundedTotal = Math.round(totalDisplacement * 100) / 100;
    const hasMotion = roundedTotal >= 1.0;

    return {
        hasMotion,
        maxDisplacement: roundedMax,
        totalDisplacement: roundedTotal,
        vectors,
    };
}

/**
 * Tự động phát hiện chuyển động giữa t0 và t1:
 * Ưu tiên gọi window.__motion(t0, t1) nếu composition có khai báo.
 * Nếu không, tự động so sánh bounding box của các phần tử DOM tại t0 và t1.
 */
export async function detectMotion(
    page: Page,
    t0: number,
    t1: number,
    options?: {
        selectors?: string[];
        cachedBoxes0?: Record<string, DOMBox | null>;
        onSampleBoxes?: (t: number, boxes: Record<string, DOMBox | null>) => void;
    }
): Promise<MotionDetectionResult & { boxes1?: Record<string, DOMBox | null> }> {
    // 1. Kiểm tra xem comp có khai báo window.__motion(t0, t1) không
    const compVectors = await getCompMotion(page, t0, t1);
    if (compVectors !== null) {
        let total = 0;
        let max = 0;
        for (const v of compVectors) {
            const d = Math.hypot(v.dx, v.dy);
            total += d;
            if (d > max) max = d;
        }
        const roundedMax = Math.round(max * 100) / 100;
        const roundedTotal = Math.round(total * 100) / 100;
        return {
            hasMotion: roundedTotal >= 1.0,
            maxDisplacement: roundedMax,
            totalDisplacement: roundedTotal,
            vectors: compVectors,
        };
    }

    // 2. Tự động phát hiện qua bbox sampling tại t0 và t1
    let boxes0 = options?.cachedBoxes0;
    if (!boxes0) {
        await seekToTimestamp(page, t0);
        boxes0 = await sampleDOMBoxes(page, options?.selectors);
        options?.onSampleBoxes?.(t0, boxes0);
    }

    await seekToTimestamp(page, t1);
    const boxes1 = await sampleDOMBoxes(page, options?.selectors);
    options?.onSampleBoxes?.(t1, boxes1);

    const result = computeDisplacementFromBoxes(boxes0, boxes1);
    return {
        ...result,
        boxes1,
    };
}
