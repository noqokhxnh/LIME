import { inflateSync } from "node:zlib";

/**
 * Hàm dự đoán Paeth theo đặc tả chuẩn định dạng ảnh PNG
 */
function paethPredictor(a: number, b: number, c: number): number {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
}

export interface DecodedImage {
    width: number;
    height: number;
    /** Mảng byte RGBA (4 bytes/pixel) */
    data: Uint8Array;
}

/**
 * Bộ giải mã PNG thuần TypeScript tốc độ cao sử dụng node:zlib (inflateSync).
 * Tối ưu giải nén và un-filter trực tiếp thành buffer RGBA mà không cần thư viện ngoài.
 * Hỗ trợ Color Type 2 (Truecolor RGB 24-bit) và Color Type 6 (Truecolor RGBA 32-bit).
 */
export function decodePng(buf: Buffer): DecodedImage {
    if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504E47 || buf.readUInt32BE(4) !== 0x0D0A1A0A) {
        throw new Error("Dữ liệu không phải là định dạng ảnh PNG hợp lệ");
    }

    let offset = 8;
    let width = 0;
    let height = 0;
    let bitDepth = 8;
    let colorType = 6;
    const idatChunks: Buffer[] = [];

    while (offset < buf.length) {
        const length = buf.readUInt32BE(offset);
        const type = buf.toString("ascii", offset + 4, offset + 8);
        if (type === "IHDR") {
            width = buf.readUInt32BE(offset + 8);
            height = buf.readUInt32BE(offset + 12);
            bitDepth = buf.readUInt8(offset + 16);
            colorType = buf.readUInt8(offset + 17);
            if (bitDepth !== 8) {
                throw new Error(`Chỉ hỗ trợ bitDepth=8, nhận được: ${bitDepth}`);
            }
        } else if (type === "IDAT") {
            idatChunks.push(buf.subarray(offset + 8, offset + 8 + length));
        } else if (type === "IEND") {
            break;
        }
        offset += 12 + length;
    }

    if (width === 0 || height === 0) {
        throw new Error("Không tìm thấy thông tin kích thước IHDR hợp lệ trong PNG");
    }

    const compressed = Buffer.concat(idatChunks);
    const uncompressed = inflateSync(compressed);
    const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 4;
    const stride = width * bpp;
    const out = new Uint8Array(width * height * 4);

    let srcOffset = 0;
    const rawRow = new Uint8Array(stride);
    const prevRow = new Uint8Array(stride);

    for (let y = 0; y < height; y++) {
        const filter = uncompressed[srcOffset++];
        for (let x = 0; x < stride; x++) {
            const rawByte = uncompressed[srcOffset++];
            const a = x >= bpp ? rawRow[x - bpp] : 0;
            const b = y > 0 ? prevRow[x] : 0;
            const c = y > 0 && x >= bpp ? prevRow[x - bpp] : 0;
            let val = 0;
            switch (filter) {
                case 0: // None
                    val = rawByte;
                    break;
                case 1: // Sub
                    val = (rawByte + a) & 0xFF;
                    break;
                case 2: // Up
                    val = (rawByte + b) & 0xFF;
                    break;
                case 3: // Average
                    val = (rawByte + Math.floor((a + b) / 2)) & 0xFF;
                    break;
                case 4: // Paeth
                    val = (rawByte + paethPredictor(a, b, c)) & 0xFF;
                    break;
                default:
                    throw new Error(`Bộ lọc PNG không hợp lệ: ${filter}`);
            }
            rawRow[x] = val;
        }

        prevRow.set(rawRow);
        const dstRowOffset = y * width * 4;
        if (bpp === 4) {
            out.set(rawRow, dstRowOffset);
        } else {
            for (let i = 0, j = 0; i < width; i++, j += 3) {
                const dst = dstRowOffset + (i << 2);
                out[dst] = rawRow[j];
                out[dst + 1] = rawRow[j + 1];
                out[dst + 2] = rawRow[j + 2];
                out[dst + 3] = 255;
            }
        }
    }

    return { width, height, data: out };
}
