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
 * Vật liệu "wood" (knock): Tiếng gõ gỗ bao gồm xung kích âm thanh cực ngắn (noise click transient)
 * kết hợp với dao động hình sin tắt dần rất nhanh (decaying sine burst fundamental).
 */
export function synthesizeWood(
    intensity: number,
    options?: {
        seed?: number;
        sampleRate?: number;
        pan?: number;
    }
): SynthesizedAudio {
    const sampleRate = options?.sampleRate ?? DEFAULT_SFX_SAMPLE_RATE;
    const clampedIntensity = Math.max(0, Math.min(1, intensity));
    const seed = options?.seed ?? 0x574f4f44; // 'WOOD'
    const rng = RNG(seed);

    // Thời lượng ngắn (0.04s - 0.12s) phản ánh đặc trưng tắt dần nhanh của chất liệu gỗ
    const duration = 0.04 + clampedIntensity * 0.08;
    const numSamples = Math.max(1, Math.floor(duration * sampleRate));
    const gain = 0.25 + clampedIntensity * 0.75;

    const mono = new Float32Array(numSamples);

    // Tần số cơ bản của khối gỗ (450Hz - 580Hz)
    const baseFreq = 480 + 100 * (1 - clampedIntensity);
    const harmonicFreq = baseFreq * 2.35; // Họa âm phi điều hòa nhẹ đặc trưng của thanh gỗ

    // Hằng số thời gian suy giảm rất nhanh: tau ~ 12ms - 28ms
    const tau = 0.012 + 0.016 * clampedIntensity;

    let phase0 = 0;
    let phase1 = 0;

    for (let i = 0; i < numSamples; i++) {
        const t = i / sampleRate;

        // Xung kích click ban đầu (transient noise click trong ~4ms đầu)
        const clickNoise = (rng() * 2 - 1) * Math.exp(-t / 0.0035);

        // Suy giảm hàm mũ cực nhanh của thân khối gỗ
        const bodyDecay = Math.exp(-t / tau);

        // Hạ tần số nhẹ trong 4ms đầu mô phỏng biến dạng khi bề mặt gỗ va chạm
        const pitchBend = 1 + 0.4 * Math.exp(-t / 0.004);
        const f0 = baseFreq * pitchBend;
        const f1 = harmonicFreq * pitchBend;

        phase0 += (2 * Math.PI * f0) / sampleRate;
        phase1 += (2 * Math.PI * f1) / sampleRate;

        const body = Math.sin(phase0) * 0.75 + Math.sin(phase1) * 0.25;

        // Trộn giữa click transient và body dao động hình sin
        const sample = (body * bodyDecay * 0.8 + clickNoise * 0.45) * gain;
        mono[i] = Math.max(-1, Math.min(1, sample));
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
 * Vật liệu "glass" (clink): Tiếng va chạm thủy tinh trong trẻo, ngân vang kim loại
 * tạo bởi tổng hợp các họa âm phi điều hòa (inharmonic partials) với các mode dao động tắt dần theo hàm mũ.
 */
export function synthesizeGlass(
    intensity: number,
    options?: {
        seed?: number;
        sampleRate?: number;
        pan?: number;
    }
): SynthesizedAudio {
    const sampleRate = options?.sampleRate ?? DEFAULT_SFX_SAMPLE_RATE;
    const clampedIntensity = Math.max(0, Math.min(1, intensity));
    const seed = options?.seed ?? 0x474c4153; // 'GLAS'
    const rng = RNG(seed);

    // Thời lượng ngân vang tỉ lệ thuận với intensity (0.25s - 0.75s)
    const duration = 0.25 + clampedIntensity * 0.5;
    const numSamples = Math.max(1, Math.floor(duration * sampleRate));
    const gain = 0.2 + clampedIntensity * 0.75;

    const mono = new Float32Array(numSamples);

    // Tần số cơ bản mode 1 của thủy tinh (~2100Hz - 2600Hz)
    const f0 = 2100 + 500 * (1 - clampedIntensity);

    // Các tỷ số mode phi điều hòa chuẩn theo mô hình rung đĩa/chuông thủy tinh (Chladni/Rayleigh modes)
    const modeRatios = [1.0, 2.32, 4.15, 5.84, 8.21];
    const modeAmps = [0.55, 0.28, 0.12, 0.06, 0.03];
    // Hằng số thời gian suy giảm: tần số càng cao thì suy hao càng nhanh
    const baseTau = 0.12 + 0.28 * clampedIntensity;
    const taus = modeRatios.map((ratio) => baseTau / Math.pow(ratio, 0.55));

    const phases = [0, 0, 0, 0, 0];

    for (let i = 0; i < numSamples; i++) {
        const t = i / sampleRate;

        // Tiếng gõ chạm cực bén (strike transient noise < 3ms)
        const strike = (rng() * 2 - 1) * Math.exp(-t / 0.0025);

        let modalSum = 0;
        for (let m = 0; m < modeRatios.length; m++) {
            const freq = f0 * modeRatios[m];
            phases[m] += (2 * Math.PI * freq) / sampleRate;
            const decay = Math.exp(-t / taus[m]);
            modalSum += Math.sin(phases[m]) * modeAmps[m] * decay;
        }

        const sample = (modalSum * 0.85 + strike * 0.3) * gain;
        mono[i] = Math.max(-1, Math.min(1, sample));
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
 * Vật liệu "sub" (thump): Âm trầm tần số thấp đặc trưng cho cú đập mạnh,
 * tạo bởi sóng sin quét hạ tần số từ 60Hz xuống 30Hz với năng lượng tập trung hoàn toàn dưới 100Hz.
 */
export function synthesizeSub(
    intensity: number,
    options?: {
        seed?: number;
        sampleRate?: number;
        pan?: number;
    }
): SynthesizedAudio {
    const sampleRate = options?.sampleRate ?? DEFAULT_SFX_SAMPLE_RATE;
    const clampedIntensity = Math.max(0, Math.min(1, intensity));

    // Thời lượng âm trầm (0.15s - 0.50s)
    const duration = 0.15 + clampedIntensity * 0.35;
    const numSamples = Math.max(1, Math.floor(duration * sampleRate));
    const gain = 0.3 + clampedIntensity * 0.7;

    const mono = new Float32Array(numSamples);

    // Hằng số phân rã biên độ âm trầm (80ms - 220ms)
    const tauAmp = 0.08 + 0.14 * clampedIntensity;
    // Tốc độ quét hạ tần số từ 60Hz xuống 30Hz
    const tauPitch = 0.06 + 0.04 * clampedIntensity;

    let phase = 0;

    for (let i = 0; i < numSamples; i++) {
        const t = i / sampleRate;

        // Quét tần số hạ dần: 30Hz + 30Hz * e^(-t / tauPitch) => từ 60Hz trượt xuống 30Hz
        const freq = 30 + 30 * Math.exp(-t / tauPitch);

        phase += (2 * Math.PI * freq) / sampleRate;

        // Tấn công nhanh (attack 6ms) để tránh tiếng click gián đoạn pha ban đầu
        const attack = Math.min(1, t / 0.006);
        // Phân rã mượt mà theo hàm mũ
        const decay = Math.exp(-t / tauAmp);

        const sineWave = Math.sin(phase);
        // Giới hạn biên độ mềm nhẹ (soft saturation) giữ năng lượng tập trung sâu dưới 100Hz
        const sample = Math.tanh(sineWave * 1.05) * attack * decay * gain;
        mono[i] = Math.max(-1, Math.min(1, sample));
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
 * Vật liệu "bubble" (pop): Âm thanh bọt nước hoặc nút bấm nảy (pitch-up blip),
 * tạo bởi sóng sin quét vút nhanh tần số lên cao (frequency sweep upward) kết hợp envelope phân rã nhanh.
 */
export function synthesizeBubble(
    intensity: number,
    options?: {
        seed?: number;
        sampleRate?: number;
        pan?: number;
    }
): SynthesizedAudio {
    const sampleRate = options?.sampleRate ?? DEFAULT_SFX_SAMPLE_RATE;
    const clampedIntensity = Math.max(0, Math.min(1, intensity));

    // Thời lượng bọt nước nổ (0.05s - 0.15s)
    const duration = 0.05 + clampedIntensity * 0.1;
    const numSamples = Math.max(1, Math.floor(duration * sampleRate));
    const gain = 0.25 + clampedIntensity * 0.75;

    const mono = new Float32Array(numSamples);

    // Tần số khởi đầu (350Hz - 550Hz) quét nhanh lên (1200Hz - 2200Hz)
    const fStart = 380 + 150 * (1 - clampedIntensity);
    const fEnd = 1300 + 800 * clampedIntensity;

    const tauAmp = 0.02 + 0.035 * clampedIntensity;
    let phase = 0;

    for (let i = 0; i < numSamples; i++) {
        const t = i / sampleRate;
        const progress = Math.min(1, t / duration);

        // Đường cong tần số quét vút lên trên (quét dạng luỹ thừa 2)
        const freq = fStart + (fEnd - fStart) * Math.pow(progress, 1.8);

        phase += (2 * Math.PI * freq) / sampleRate;

        // Tấn công cực bén trong 2.5ms đầu
        const attack = Math.min(1, t / 0.0025);
        // Suy giảm nhanh của bọt khí
        const decay = Math.exp(-t / tauAmp);

        const fundamental = Math.sin(phase);
        const secondHarmonic = Math.sin(phase * 2) * 0.15;

        const sample = (fundamental + secondHarmonic) * attack * decay * gain;
        mono[i] = Math.max(-1, Math.min(1, sample));
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
 * Hàm điều phối tổng hợp âm thanh theo đúng vật liệu chỉ định.
 */
export function synthesizeMaterial(
    material: TimelineMaterial,
    intensity: number,
    options?: {
        seed?: number;
        sampleRate?: number;
        pan?: number;
    }
): SynthesizedAudio {
    switch (material) {
        case "air":
            return synthesizeAir(intensity, options);
        case "wood":
            return synthesizeWood(intensity, options);
        case "glass":
            return synthesizeGlass(intensity, options);
        case "sub":
            return synthesizeSub(intensity, options);
        case "bubble":
            return synthesizeBubble(intensity, options);
        default: {
            const exhaustiveCheck: never = material;
            throw new Error(`[Spec E] Vật liệu không hỗ trợ: ${exhaustiveCheck}`);
        }
    }
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
