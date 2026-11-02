import { readFileSync } from "node:fs";
import type { AssetRow } from "../database/assets.js";
import { describeImages, type VisionCaption } from "../llm/vision.js";

// ============================================================
// ASSET CAPTION (#103) — mô tả asset tự động bằng vision model
// File: src/pipeline/assetCaption.ts
//
// Ảnh: đọc thẳng file → base64 → vision model.
// Kết quả { description, tags } ghi ngược vào DB (xem src/queue/assetCaption.ts).
// ============================================================

/**
 * Sinh caption cho một asset ảnh bằng vision model.
 * KHÔNG ghi DB — caller (background job) chịu trách nhiệm lưu.
 */
export async function captionAsset(asset: AssetRow, signal?: AbortSignal): Promise<VisionCaption> {
    // Chỉ mô tả ảnh. Asset video (nếu còn sót trong DB cũ) bỏ qua — giữ mô tả rỗng.
    if (asset.kind !== "image") {
        return { description: asset.description || "", tags: asset.tags || [] };
    }

    const buf = readFileSync(asset.filePath);
    // SVG không phải raster — vision model không đọc được, bỏ qua.
    if (asset.mimeType === "image/svg+xml") {
        return { description: asset.description || "", tags: asset.tags || [] };
    }
    return describeImages([{ mimeType: asset.mimeType, dataBase64: buf.toString("base64") }], signal);
}
