import { WatermarkConfig } from '../llm/schema.js';

export interface WatermarkFilterResult {
    /** Chuỗi biểu thức bộ lọc phức hợp cho FFmpeg (-filter_complex) */
    filterComplex: string;
    /** Tên nhãn luồng hình ảnh video đầu ra sau khi đã ghép lớp logo */
    outputLabel: string;
}

/**
 * Hàm tính toán bộ lọc ghép logo/watermark lên video cho FFmpeg.
 * 
 * Quy trình xử lý gồm 2 giai đoạn trong đồ thị lọc (filtergraph):
 * 1. Tiền xử lý logo [wm]:
 *    - scale: Thu phóng chiều rộng logo theo scalePercent của videoWidth, chiều cao để -1 để FFmpeg tự giữ tỉ lệ gốc của logo.
 *    - format=rgba: Chuyển sang định dạng màu có kênh Alpha trong suốt.
 *    - colorchannelmixer=aa=opacity: Nhân kênh Alpha với hệ số mờ để chỉnh độ trong suốt.
 * 2. Ghép lớp overlay:
 *    - Đè luồng [wm] lên luồng [videoLabel] tại tọa độ (xExpr, yExpr).
 *    - Trả về luồng kết quả [outputLabel].
 * 
 * @param config Cấu hình logo (vị trí, scale, opacity, tọa độ x/y)
 * @param videoWidth Chiều rộng video xuất xưởng (ví dụ: 1920)
 * @param videoHeight Chiều cao video xuất xưởng (ví dụ: 1080)
 * @param videoLabel Nhãn luồng video nền đầu vào (mặc định '0:v')
 * @param logoLabel Nhãn luồng ảnh logo đầu vào (mặc định '2:v')
 * @param padding Khoảng cách lùi vào từ mép khung hình (mặc định 24 pixel)
 */
export function buildWatermarkFilter(
    config: WatermarkConfig,
    videoWidth: number,
    videoHeight: number,
    videoLabel = '0:v',
    logoLabel = '2:v',
    padding = 24
): WatermarkFilterResult {
    // 1. Tính chiều rộng logo theo tỉ lệ phần trăm chiều rộng video
    const scaleRatio = config.scalePercent / 100;
    const targetWidth = Math.max(1, Math.round(videoWidth * scaleRatio));
    
    // Đảm bảo opacity nằm trong khoảng an toàn 0.1 đến 1.0
    const opacity = Math.min(1.0, Math.max(0.1, config.opacity));

    // Bước 1: Scale logo giữ nguyên tỉ lệ gốc (h=-1) và gán độ mờ Alpha
    const prepareLogo = `[${logoLabel}]scale=${targetWidth}:-1,format=rgba,colorchannelmixer=aa=${opacity}[wm]`;

    // Bước 2: Tính toán biểu thức tọa độ vị trí X và Y
    let xExpr = `${padding}`;
    let yExpr = `${padding}`;

    switch (config.position) {
        case 'top-left':
            // Góc trên - Trái: cách mép trái padding px, cách mép trên padding px
            xExpr = `${padding}`;
            yExpr = `${padding}`;
            break;
        case 'top-right':
            // Góc trên - Phải: chiều rộng video trừ chiều rộng logo trừ khoảng cách đệm
            xExpr = `main_w-overlay_w-${padding}`;
            yExpr = `${padding}`;
            break;
        case 'bottom-left':
            // Góc dưới - Trái: cách mép trái padding px, chiều cao video trừ chiều cao logo trừ đệm
            xExpr = `${padding}`;
            yExpr = `main_h-overlay_h-${padding}`;
            break;
        case 'bottom-right':
            // Góc dưới - Phải: sát mép dưới và mép phải (có lùi padding px)
            xExpr = `main_w-overlay_w-${padding}`;
            yExpr = `main_h-overlay_h-${padding}`;
            break;
        case 'custom':
            // Tọa độ tùy biến tự do theo phần trăm:
            // xPercent = 0% nghĩa là sát mép trái, 100% nghĩa là sát mép phải
            const xp = (config.xPercent ?? 5) / 100;
            const yp = (config.yPercent ?? 5) / 100;
            xExpr = `(main_w-overlay_w)*${xp}`;
            yExpr = `(main_h-overlay_h)*${yp}`;
            break;
    }

    // Bước 3: Ghép lớp video và logo
    const overlay = `[${videoLabel}][wm]overlay=x='${xExpr}':y='${yExpr}'[outv]`;

    return {
        filterComplex: `${prepareLogo};${overlay}`,
        outputLabel: '[outv]',
    };
}
