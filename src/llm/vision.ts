import { getConfig } from "../config.js";
import { getCandidateBaseURLs, getAuto9RouterKey } from "./client.js";

// ============================================================
// VISION MODEL (#103) — mô tả asset ảnh/video tự động
// File: src/llm/vision.ts
//
// Dùng mô hình multimodal (mặc định ag/gemini-3.8-flash-high qua 9router,
// endpoint OpenAI-compatible /chat/completions) để đọc nội dung một hoặc
// nhiều khung hình và trả về { description, tags } — thay cho việc người
// dùng phải tự gõ mô tả khi upload asset.
// ============================================================

export interface VisionImageInput {
    mimeType: string;   // e.g. image/png, image/jpeg
    dataBase64: string; // base64 (KHÔNG kèm tiền tố data:)
}

export interface VisionCaption {
    description: string;
    tags: string[];
}

const VISION_PROMPT =
    "Mô tả nội dung ảnh (hoặc các khung hình của cùng một video) bằng đúng 1 câu ngắn " +
    "tiếng Việt, kèm 2–5 tags (từ khoá, phân cách bằng dấu phẩy) mô tả chủ thể, bối cảnh, " +
    "màu sắc, tâm trạng — để khớp khi chọn cảnh trong video. " +
    'Trả về DUY NHẤT một đối tượng JSON đúng khuôn: {"description":"...","tags":["..."]}. ' +
    "Không thêm bất kỳ văn bản nào ngoài JSON.";

/**
 * Gọi mô hình vision (9router, OpenAI-compatible) với danh sách ảnh base64.
 * Trả về caption đã parse. Ném lỗi khi không có kết quả hợp lệ.
 */
export async function describeImages(
    images: VisionImageInput[],
    signal?: AbortSignal
): Promise<VisionCaption> {
    const config = getConfig();
    const baseURL = (config.NineRouter_BaseURL || "http://localhost:20128/v1").replace(/\/+$/, "");
    const model = config.Vision_Model || config.NineRouter_Model;

    let key = config.NineRouter_APIKEY || process.env.NINEROUTER_API_KEY || process.env.NINE_ROUTER_API_KEY;
    if (!key) key = getAuto9RouterKey();
    if (!key) throw new Error("9router API key is required for asset captioning");

    // OpenAI-compatible multimodal content: text + image_url (data URI).
    const content: any[] = [{ type: "text", text: VISION_PROMPT }];
    for (const img of images) {
        content.push({
            type: "image_url",
            image_url: { url: `data:${img.mimeType};base64,${img.dataBase64}` },
        });
    }

    const candidateURLs = getCandidateBaseURLs(baseURL);
    let res: Response | null = null;
    let lastNetErr: Error | null = null;

    for (const base of candidateURLs) {
        if (signal?.aborted) throw new DOMException("Operation aborted", "AbortError");
        const url = `${base}/chat/completions`;
        try {
            res = await fetch(url, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${key}`,
                    "Content-Type": "application/json",
                },
                signal,
                body: JSON.stringify({
                    model,
                    messages: [{ role: "user", content }],
                    temperature: 0.3,
                    max_tokens: 1024,
                    stream: false,
                }),
            });
            break;
        } catch (err: any) {
            if (err.name === "AbortError") throw err;
            lastNetErr = err;
            console.warn(`[Vision] Không kết nối được ${url}: ${err.message}. Thử fallback...`);
        }
    }
    if (!res) throw lastNetErr || new Error("vision: all connection candidates failed");

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Vision API Error: ${res.status} - ${err}`);
    }

    const data = await res.json() as any;
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error(`Vision API Error: no content. Raw: ${JSON.stringify(data)}`);

    return parseCaption(text);
}

/** Parse JSON caption từ text mô hình trả về — chịu cả markdown fence lẫn text thừa. */
export function parseCaption(text: string): VisionCaption {
    let raw = String(text ?? "").trim();
    // Bóc markdown fence ```json ... ```
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) raw = fence[1].trim();
    // Chỉ giữ khối JSON đầu tiên nếu có text thừa xung quanh.
    const firstBrace = raw.indexOf("{");
    const lastBrace = raw.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
        raw = raw.slice(firstBrace, lastBrace + 1);
    }

    let parsed: any;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error(`Vision returned non-JSON caption: ${String(text).slice(0, 200)}`);
    }

    const description = typeof parsed.description === "string"
        ? parsed.description.trim().slice(0, 500)
        : "";
    let tags: string[] = [];
    if (typeof parsed.tags === "string") {
        tags = parsed.tags.split(",").map((t: string) => t.trim()).filter(Boolean).slice(0, 10);
    } else if (Array.isArray(parsed.tags)) {
        tags = parsed.tags.map((t: any) => String(t).trim()).filter(Boolean).slice(0, 10);
    }

    if (!description && tags.length === 0) {
        throw new Error(`Vision returned empty caption: ${String(text).slice(0, 200)}`);
    }
    return { description, tags };
}
