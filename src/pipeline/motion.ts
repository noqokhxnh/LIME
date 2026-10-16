import type { Page } from "playwright";

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
