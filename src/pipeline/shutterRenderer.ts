import type { Page } from "playwright";
import { decodePng, DecodedImage } from "./pngDecoder.js";
import { seekToTimestamp } from "./preview.js";

/**
 * Tính toán danh sách mốc thời gian của K sub-frames cho frame thứ frameIndex (Spec D).
 * Mỗi sub-frame được lấy mẫu tại t0 + (s + 0.5) / K * frameDuration.
 * Đảm bảo tính xác định (Spec B): chỉ phụ thuộc vào (frameIndex, fps, K).
 */
export function calculateSubFrameTimestamps(
    frameIndex: number,
    fps: number,
    shutterSamples: number = 8
): number[] {
    const K = Math.max(1, Math.floor(shutterSamples));
    const frameDuration = 1 / fps;
    const t0 = frameIndex * frameDuration;
    const timestamps: number[] = [];

    for (let s = 0; s < K; s++) {
        const subTime = t0 + ((s + 0.5) / K) * frameDuration;
        timestamps.push(subTime);
    }

    return timestamps;
}

/**
 * Render một sub-frame tại mốc thời gian chỉ định: tua timeline, chụp ảnh PNG và giải mã thành RGBA buffer.
 */
export async function renderSubFrame(
    page: Page,
    timeSec: number
): Promise<DecodedImage> {
    await seekToTimestamp(page, timeSec);
    const buf = await page.screenshot({
        type: "png",
        animations: "disabled",
        timeout: 8000,
    });
    return decodePng(buf);
}
