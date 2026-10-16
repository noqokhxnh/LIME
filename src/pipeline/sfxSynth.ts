import { type Browser, type Page } from "playwright";
import {
    type TimelineEvent,
    type TimelineMaterial,
    timelineEventSchema,
} from "../llm/schema.js";
import { launchPreviewBrowser, loadAndPreparePage } from "./preview.js";
import { RNG } from "./rng.js";

export {
    type TimelineEvent,
    type TimelineMaterial,
    timelineEventSchema,
};

export const DEFAULT_SFX_SAMPLE_RATE = 44100;

export interface SynthesizedAudio {
    left: Float32Array;
    right: Float32Array;
    sampleRate: number;
    duration: number;
}

/**
 * Phân bổ âm lượng kênh trái/phải theo giá trị pan [-1, 1] sử dụng thuật toán Constant Power Panning.
 */
export function applyPan(
    mono: Float32Array,
    pan: number = 0
): { left: Float32Array; right: Float32Array } {
    const clampedPan = Math.max(-1, Math.min(1, pan));
    const angle = ((clampedPan + 1) * Math.PI) / 4;
    const gainL = Math.cos(angle);
    const gainR = Math.sin(angle);

    const left = new Float32Array(mono.length);
    const right = new Float32Array(mono.length);
    for (let i = 0; i < mono.length; i++) {
        left[i] = mono[i] * gainL;
        right[i] = mono[i] * gainR;
    }
    return { left, right };
}

/**
 * Vật liệu "air" (whoosh): Tiếng gió lướt nhanh tạo bởi tiếng ồn hồng qua bộ lọc dải thông
 * quét tần số (swept bandpass filter) và envelope cong mượt mà.
 */
export function synthesizeAir(
    intensity: number,
    options?: {
        seed?: number;
        sampleRate?: number;
        pan?: number;
    }
): SynthesizedAudio {
    const sampleRate = options?.sampleRate ?? DEFAULT_SFX_SAMPLE_RATE;
    const clampedIntensity = Math.max(0, Math.min(1, intensity));
    const seed = options?.seed ?? 0x414952; // 'AIR'
    const rng = RNG(seed);

    // Thời lượng và độ lợi tỉ lệ thuận với intensity (0.2s - 0.65s)
    const duration = 0.2 + clampedIntensity * 0.45;
    const numSamples = Math.max(1, Math.floor(duration * sampleRate));
    const gain = 0.2 + clampedIntensity * 0.75;

    const mono = new Float32Array(numSamples);

    // Trạng thái bộ lọc Paul Kellet pink noise
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;

    // Trạng thái bộ lọc Biquad bandpass
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;

    const Q = 1.8;
    for (let i = 0; i < numSamples; i++) {
        const progress = i / numSamples;
        const env = Math.sin(Math.PI * progress) ** 1.8;

        // Sinh tiếng ồn trắng từ seeded PRNG thuần túy (không dùng Math.random)
        const white = rng() * 2 - 1;

        // Tiếng ồn hồng (pink noise)
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.153852;
        const pink = b0 + b1 + b2 + white * 0.5362;

        // Quét tần số trung tâm từ 900Hz lên 3200Hz rồi hạ dần
        const fc = 900 + 2300 * env;
        const w0 = (2 * Math.PI * fc) / sampleRate;
        const alpha = Math.sin(w0) / (2 * Q);

        const a0 = 1 + alpha;
        const a1 = -2 * Math.cos(w0);
        const a2 = 1 - alpha;
        const coefB0 = alpha / a0;
        const coefB2 = -alpha / a0;
        const coefA1 = a1 / a0;
        const coefA2 = a2 / a0;

        const input = pink * 0.4 + white * 0.6;
        const filtered = coefB0 * input + coefB2 * x2 - coefA1 * y1 - coefA2 * y2;

        x2 = x1;
        x1 = input;
        y2 = y1;
        y1 = filtered;

        mono[i] = filtered * gain * env;
    }

    const { left, right } = applyPan(mono, options?.pan ?? 0);
    return {
        left,
        right,
        sampleRate,
        duration,
    };
}

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
