/**
 * CDP BeginFrame Capture & Static Frame Deduplication (Issue #40)
 *
 * Sử dụng Chrome DevTools Protocol `HeadlessExperimental.beginFrame` để chụp
 * frame một cách nguyên tử (Layout -> Paint -> Composite trong một thao tác),
 * thay vì `page.screenshot()` phải qua nhiều tầng Playwright.
 *
 * Lợi ích:
 * - `hasDamage` flag từ Chromium cho biết có thay đổi thị giác hay không
 * - Frame tĩnh: bỏ qua decode, tái sử dụng buffer cũ (tiết kiệm 30-50% thời gian)
 * - Đồng bộ với chu kỳ composite, tránh frame flicker
 *
 * Tham khảo: heygen-com/hyperframes (packages/engine/src/services/frameCapture.ts)
 */

import type { Page } from "playwright";

export interface CdpFrameResult {
    /** true nếu có thay đổi thị giác so với frame trước */
    hasDamage: boolean;
    /** Dữ liệu screenshot (base64). Chỉ có khi hasDamage=true hoặc lần đầu */
    screenshotData?: string;
}

export interface CdpCaptureSession {
    /** Chụp frame tại timestamp. Trả về hasDamage + screenshotData */
    captureFrame(): Promise<CdpFrameResult>;
    /**
     * Kiểm tra có thay đổi thị giác không (Issue #40).
     * Chỉ gọi beginFrame KHÔNG kèm screenshot — nhanh hơn, dùng để quyết định
     * có cần screenshot lại hay tái sử dụng frame cũ.
     */
    checkDamage(): Promise<boolean>;
    /** Đóng CDP session */
    close(): Promise<void>;
    /** true nếu CDP BeginFrame khả dụng, false nếu phải fallback về screenshot */
    readonly isCdpAvailable: boolean;
}

/**
 * Tạo CDP capture session cho một page.
 * Nếu CDP không khả dụng (trình duyệt không hỗ trợ), trả về session fallback
 * dùng `page.screenshot()` với hasDamage luôn là true.
 */
/**
 * Áp dụng determinism guards để chống frame flicker (Issue #38).
 *
 * - Freeze mọi CSS animation/transition không do GSAP kiểm soát
 * - Đảm bảo fonts và images đã load xong trước khi render
 */
export async function applyDeterminismGuards(page: Page): Promise<void> {
    await page.evaluate(() => {
        // Freeze CSS animations/transitions
        const style = document.createElement("style");
        style.id = "__lime-determinism-guards";
        style.textContent = `
            *, *::before, *::after {
                animation-play-state: paused !important;
                transition: none !important;
            }
        `;
        document.head.appendChild(style);
    });

    // Chờ fonts
    await page.evaluate(async () => {
        if (document.fonts?.ready) {
            await Promise.race([
                document.fonts.ready,
                new Promise((r) => setTimeout(r, 5000)),
            ]);
        }
    });

    // Chờ images
    await page.evaluate(async () => {
        const imgs = Array.from(document.querySelectorAll("img"));
        await Promise.all(
            imgs.map((img) =>
                img.complete
                    ? Promise.resolve()
                    : new Promise((resolve) => {
                          img.onload = () => resolve(null);
                          img.onerror = () => resolve(null);
                          setTimeout(() => resolve(null), 5000);
                      })
            )
        );
    });
}

export async function createCdpCaptureSession(page: Page): Promise<CdpCaptureSession> {
    try {
        const client = await page.context().newCDPSession(page);

        // Kiểm tra HeadlessExperimental có khả dụng không
        await client.send("HeadlessExperimental.beginFrame", {
            screenshot: { format: "jpeg", quality: 90 },
        });

        let firstFrame = true;

        return {
            isCdpAvailable: true,

            async captureFrame(): Promise<CdpFrameResult> {
                const result = await client.send("HeadlessExperimental.beginFrame", {
                    screenshot: { format: "jpeg", quality: 90 },
                }) as { hasDamage?: boolean; screenshotData?: string };

                const hasDamage = result.hasDamage ?? true;

                // Frame đầu tiên luôn cần screenshot
                if (firstFrame) {
                    firstFrame = false;
                    return { hasDamage: true, screenshotData: result.screenshotData };
                }

                return {
                    hasDamage,
                    screenshotData: hasDamage ? result.screenshotData : undefined,
                };
            },

            async checkDamage(): Promise<boolean> {
                // Frame đầu tiên luôn coi như có damage
                if (firstFrame) {
                    return true;
                }
                try {
                    const result = await client.send("HeadlessExperimental.beginFrame", {}) as {
                        hasDamage?: boolean;
                    };
                    return result.hasDamage ?? true;
                } catch {
                    // Nếu lỗi, coi như có damage để an toàn (fallback về screenshot)
                    return true;
                }
            },

            async close(): Promise<void> {
                await client.detach().catch(() => {});
            },
        };
    } catch (err) {
        // Fallback: CDP không khả dụng, dùng page.screenshot()
        console.warn("[CDP] BeginFrame không khả dụng, fallback về page.screenshot():", (err as Error).message);

        return {
            isCdpAvailable: false,

            async captureFrame(): Promise<CdpFrameResult> {
                const buf = await page.screenshot({
                    type: "jpeg",
                    quality: 90,
                    animations: "disabled",
                    timeout: 8000,
                });
                return {
                    hasDamage: true,
                    screenshotData: buf.toString("base64"),
                };
            },

            async checkDamage(): Promise<boolean> {
                // Fallback không có CDP → luôn coi như có damage
                return true;
            },

            async close(): Promise<void> {
                // Không có gì để đóng
            },
        };
    }
}
