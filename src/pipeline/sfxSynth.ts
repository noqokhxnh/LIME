import { type Browser, type Page } from "playwright";
import {
    type TimelineEvent,
    type TimelineMaterial,
    timelineEventSchema,
} from "../llm/schema.js";
import { launchPreviewBrowser, loadAndPreparePage } from "./preview.js";

export {
    type TimelineEvent,
    type TimelineMaterial,
    timelineEventSchema,
};

export const DEFAULT_SFX_SAMPLE_RATE = 44100;

/**
 * Trích xuất danh sách timeline events từ một Playwright Page đã chuẩn bị xong.
 * Gọi window.__events() từ comp. Nếu không khai báo hoặc rỗng, trả về mảng rỗng [].
 */
export async function extractTimelineEventsFromPage(page: Page): Promise<TimelineEvent[]> {
    try {
        const rawEvents = await page.evaluate(() => {
            const win = window as any;
            if (typeof win.__events === "function") {
                return win.__events();
            }
            if (Array.isArray(win.__timelineEvents)) {
                return win.__timelineEvents;
            }
            return [];
        });

        if (!Array.isArray(rawEvents)) {
            return [];
        }

        return rawEvents
            .map((item: any) => {
                const parsed = timelineEventSchema.safeParse(item);
                return parsed.success ? parsed.data : null;
            })
            .filter((e): e is TimelineEvent => e !== null)
            .sort((a, b) => a.t - b.t);
    } catch (err: any) {
        console.warn("[Spec E] Không thể trích xuất timeline events từ trang:", err?.message || err);
        return [];
    }
}

/**
 * Mở file HTML trong headless Chromium và lấy danh sách timeline events từ window.__events().
 */
export async function extractTimelineEventsFromHtml(
    htmlPath: string,
    existingBrowser?: Browser
): Promise<TimelineEvent[]> {
    const shouldClose = !existingBrowser;
    const browser = existingBrowser ?? (await launchPreviewBrowser());
    try {
        const page = await browser.newPage();
        await loadAndPreparePage(page, htmlPath, 1920, 1080);
        const events = await extractTimelineEventsFromPage(page);
        await page.close();
        return events;
    } catch (err: any) {
        console.warn(`[Spec E] Lỗi khi trích xuất events từ file ${htmlPath}:`, err?.message || err);
        return [];
    } finally {
        if (shouldClose) {
            await browser.close().catch(() => {});
        }
    }
}

/**
 * Mã hóa dữ liệu PCM Float32 [-1, 1] thành buffer định dạng RIFF WAV 16-bit chuẩn (mono hoặc stereo).
 */
export function encodeWavBuffer(
    channels: Float32Array | [Float32Array, Float32Array],
    sampleRate: number = DEFAULT_SFX_SAMPLE_RATE
): Buffer {
    const isStereo = Array.isArray(channels);
    const numChannels = isStereo ? 2 : 1;
    const left = isStereo ? channels[0] : channels;
    const right = isStereo ? channels[1] : channels;
    const numSamples = left.length;

    const bytesPerSample = 2; // 16-bit
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = numSamples * blockAlign;
    const buffer = Buffer.alloc(44 + dataSize);

    // RIFF chunk descriptor
    buffer.write("RIFF", 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write("WAVE", 8);

    // "fmt " sub-chunk
    buffer.write("fmt ", 12);
    buffer.writeUInt32LE(16, 16); // Subchunk1Size = 16 for PCM
    buffer.writeUInt16LE(1, 20); // AudioFormat = 1 (Linear PCM)
    buffer.writeUInt16LE(numChannels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(byteRate, 28);
    buffer.writeUInt16LE(blockAlign, 32);
    buffer.writeUInt16LE(16, 34); // BitsPerSample = 16

    // "data" sub-chunk
    buffer.write("data", 36);
    buffer.writeUInt32LE(dataSize, 40);

    let offset = 44;
    for (let i = 0; i < numSamples; i++) {
        // Kênh trái
        const sL = Math.max(-1, Math.min(1, left[i]));
        const valL = sL < 0 ? sL * 0x8000 : sL * 0x7fff;
        buffer.writeInt16LE(Math.round(valL), offset);
        offset += 2;

        // Kênh phải nếu stereo
        if (isStereo) {
            const sR = Math.max(-1, Math.min(1, right[i]));
            const valR = sR < 0 ? sR * 0x8000 : sR * 0x7fff;
            buffer.writeInt16LE(Math.round(valR), offset);
            offset += 2;
        }
    }

    return buffer;
}
