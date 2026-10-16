/**
 * Bảng tra cứu (Look-up Table) chuyển đổi giá trị byte sRGB [0..255] sang giá trị ánh sáng tuyến tính (linear light) [0..1]
 */
export const SRGB_TO_LINEAR_LUT = new Float32Array(256);

for (let i = 0; i < 256; i++) {
    const c = i / 255;
    SRGB_TO_LINEAR_LUT[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Chuyển đổi một kênh màu sRGB [0..255] sang không gian ánh sáng tuyến tính [0..1]
 */
export function srgbToLinear(c: number): number {
    const norm = Math.min(255, Math.max(0, c)) / 255;
    return norm <= 0.04045 ? norm / 12.92 : Math.pow((norm + 0.055) / 1.055, 2.4);
}

/**
 * Chuyển đổi một kênh màu từ không gian ánh sáng tuyến tính [0..1] về byte sRGB [0..255]
 */
export function linearToSrgb(lin: number): number {
    if (lin <= 0) return 0;
    if (lin >= 1) return 255;
    const s = lin <= 0.0031308 ? 12.92 * lin : 1.055 * Math.pow(lin, 1 / 2.4) - 0.055;
    return Math.min(255, Math.max(0, Math.round(s * 255)));
}

/**
 * Pha trộn danh sách các giá trị màu sRGB [0..255] trong không gian ánh sáng tuyến tính.
 * Đảm bảo tính chất: trung bình của 0 và 255 cho ra ~188 thay vì 127.5 như sRGB thô.
 */
export function blendChannelsLinear(values: number[]): number {
    if (values.length === 0) return 0;
    if (values.length === 1) return values[0];

    let sumLinear = 0;
    for (let i = 0; i < values.length; i++) {
        const v = values[i];
        if (v >= 0 && v <= 255 && Number.isInteger(v)) {
            sumLinear += SRGB_TO_LINEAR_LUT[v];
        } else {
            sumLinear += srgbToLinear(v);
        }
    }
    return linearToSrgb(sumLinear / values.length);
}

/**
 * Bộ tích luỹ khung hình ánh sáng tuyến tính tái sử dụng buffer bộ nhớ cao (zero GC pressure).
 */
export class LinearLightAccumulator {
    public readonly width: number;
    public readonly height: number;
    public count: number;
    private readonly linearSum: Float32Array;

    constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
        this.count = 0;
        this.linearSum = new Float32Array(width * height * 4);
    }

    reset(): void {
        this.count = 0;
        this.linearSum.fill(0);
    }

    addFrame(rgba: Uint8Array): void {
        const sum = this.linearSum;
        const len = this.width * this.height * 4;
        for (let i = 0; i < len; i += 4) {
            sum[i] += SRGB_TO_LINEAR_LUT[rgba[i]];
            sum[i + 1] += SRGB_TO_LINEAR_LUT[rgba[i + 1]];
            sum[i + 2] += SRGB_TO_LINEAR_LUT[rgba[i + 2]];
            sum[i + 3] += rgba[i + 3];
        }
        this.count++;
    }

    toRgba(out?: Uint8Array): Uint8Array {
        if (this.count === 0) {
            throw new Error("Chưa có khung hình nào được tích luỹ vào LinearLightAccumulator");
        }
        const len = this.width * this.height * 4;
        const result = out || new Uint8Array(len);
        const invK = 1 / this.count;
        const sum = this.linearSum;

        for (let i = 0; i < len; i += 4) {
            result[i] = linearToSrgb(sum[i] * invK);
            result[i + 1] = linearToSrgb(sum[i + 1] * invK);
            result[i + 2] = linearToSrgb(sum[i + 2] * invK);
            result[i + 3] = Math.min(255, Math.max(0, Math.round(sum[i + 3] * invK)));
        }
        return result;
    }
}

/**
 * Tính trung bình danh sách các khung hình RGBA trong không gian ánh sáng tuyến tính (Spec D).
 * KHÔNG BAO GIỜ tính trung bình pixel sRGB trực tiếp vì sẽ tạo ra vệt mờ tối xám bẩn.
 */
export function averageFramesLinear(
    frames: Uint8Array[],
    width: number,
    height: number
): Uint8Array {
    if (frames.length === 0) {
        throw new Error("Danh sách khung hình rỗng");
    }
    if (frames.length === 1) {
        return new Uint8Array(frames[0]);
    }

    const accumulator = new LinearLightAccumulator(width, height);
    for (const frame of frames) {
        accumulator.addFrame(frame);
    }
    return accumulator.toRgba();
}
