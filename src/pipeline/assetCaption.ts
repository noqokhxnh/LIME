import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AssetRow } from "../database/assets.js";
import { describeImages, type VisionImageInput, type VisionCaption } from "../llm/vision.js";

const execFile = promisify(execFileCb);

// ============================================================
// ASSET CAPTION (#103) — mô tả asset tự động bằng vision model
// File: src/pipeline/assetCaption.ts
//
// Ảnh: đọc thẳng file → base64 → vision model.
// Video: dùng ffmpeg trích vài khung hình (default 3) → coi như ảnh → vision.
// Kết quả { description, tags } ghi ngược vào DB (xem src/queue/assetCaption.ts).
// ============================================================

/** Số khung hình trích từ video để mô tả. */
export const VIDEO_CAPTION_FRAMES = 3;

/** MIME thật của khung hình trích ra (luôn JPEG vì ffmpeg mã hoá jpg). */
const FRAME_MIME = "image/jpeg";

/**
 * Trích `count` khung hình JPEG từ video, trải đều theo thời lượng.
 * Trả danh sách ảnh base64 sẵn sàng đưa cho vision model.
 * Ném lỗi nếu ffmpeg không trích được khung nào hợp lệ.
 */
export async function extractVideoFrames(
    videoPath: string,
    count: number = VIDEO_CAPTION_FRAMES
): Promise<VisionImageInput[]> {
    const duration = await probeDuration(videoPath);
    const n = Math.max(1, Math.floor(count));
    const workdir = mkdtempSync(join(tmpdir(), "asset-frames-"));
    try {
        const frames: VisionImageInput[] = [];
        for (let i = 0; i < n; i++) {
            // Trải đều: t = duration * (i + 0.5) / n — né đúng khung 0s và khung cuối.
            const t = duration > 0 ? (duration * (i + 0.5)) / n : 0;
            const outPath = join(workdir, `frame-${i}.jpg`);
            await execFile("ffmpeg", [
                "-ss", t.toFixed(3),
                "-i", videoPath,
                "-frames:v", "1",
                "-vf", "scale='min(512,iw)':-2",
                "-q:v", "3",
                "-y", outPath,
            ]);
            if (!existsSync(outPath)) continue;
            const buf = readFileSync(outPath);
            if (buf.length > 0) {
                frames.push({ mimeType: FRAME_MIME, dataBase64: buf.toString("base64") });
            }
        }
        if (frames.length === 0) {
            throw new Error("ffmpeg không trích được khung hình nào từ video");
        }
        return frames;
    } finally {
        rmSync(workdir, { recursive: true, force: true });
    }
}

/** Đo thời lượng video (giây) qua ffprobe. Trả 0 nếu không đo được. */
async function probeDuration(videoPath: string): Promise<number> {
    try {
        const { stdout } = await execFile("ffprobe", [
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            videoPath,
        ]);
        const d = parseFloat(String(stdout).trim());
        return Number.isFinite(d) && d > 0 ? d : 0;
    } catch {
        return 0;
    }
}

/**
 * Sinh caption cho một asset (ảnh hoặc video) bằng vision model.
 * KHÔNG ghi DB — caller (background job) chịu trách nhiệm lưu.
 */
export async function captionAsset(asset: AssetRow, signal?: AbortSignal): Promise<VisionCaption> {
    if (asset.kind === "image") {
        const buf = readFileSync(asset.filePath);
        // SVG không phải raster — vision model không đọc được, bỏ qua.
        if (asset.mimeType === "image/svg+xml") {
            return { description: asset.description || "", tags: asset.tags || [] };
        }
        return describeImages([{ mimeType: asset.mimeType, dataBase64: buf.toString("base64") }], signal);
    }

    // Video: trích khung hình rồi mô tả như ảnh.
    const frames = await extractVideoFrames(asset.filePath);
    return describeImages(frames, signal);
}
