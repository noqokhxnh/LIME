import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildWatermarkFilter } from '../../src/pipeline/watermarkFilter.js';
import type { WatermarkConfig } from '../../src/llm/schema.js';

// ============================================================
// UNIT TEST MODULE: src/pipeline/watermarkFilter.ts
// Mục tiêu: Kiểm tra hàm buildWatermarkFilter() tính đúng
//           chuỗi bộ lọc FFmpeg cho mọi tình huống đặt logo.
// Chạy lệnh: node.exe --import tsx tests/unit/watermarkFilter.test.ts
// ============================================================

describe('Module: watermarkFilter (src/pipeline/watermarkFilter.ts)', () => {

    // ----------------------------------------------------------
    // Dữ liệu cấu hình logo dùng chung cho nhiều test case
    // videoWidth = 1920, videoHeight = 1080 (Full HD)
    // ----------------------------------------------------------
    const VIDEO_W = 1920;
    const VIDEO_H = 1080;
    const DEFAULT_PADDING = 24; // khoảng cách lùi mép mặc định (px)

    // ─────────────────────────────────────────────────────────
    // TC-WMF-001: Kiểm tra TỌA ĐỘ 4 GÓC
    // ─────────────────────────────────────────────────────────
    describe('TC-WMF-001: Tính tọa độ 4 góc cố định', () => {

        it('góc top-left: x và y phải bằng padding (24px)', () => {
            const config: WatermarkConfig = {
                logoPath: '/tmp/logo.png',
                position: 'top-left',
                scalePercent: 10,
                opacity: 1.0,
            };

            const result = buildWatermarkFilter(config, VIDEO_W, VIDEO_H);

            // Biểu thức FFmpeg cho góc trên-trái phải chứa x=24 và y=24
            assert.ok(
                result.filterComplex.includes(`x='${DEFAULT_PADDING}'`),
                `Kỳ vọng x='${DEFAULT_PADDING}' nhưng nhận được: ${result.filterComplex}`
            );
            assert.ok(
                result.filterComplex.includes(`y='${DEFAULT_PADDING}'`),
                `Kỳ vọng y='${DEFAULT_PADDING}' nhưng nhận được: ${result.filterComplex}`
            );
        });

        it('góc top-right: x phải là main_w-overlay_w-24, y phải bằng 24', () => {
            const config: WatermarkConfig = {
                logoPath: '/tmp/logo.png',
                position: 'top-right',
                scalePercent: 10,
                opacity: 1.0,
            };

            const result = buildWatermarkFilter(config, VIDEO_W, VIDEO_H);

            assert.ok(
                result.filterComplex.includes(`x='main_w-overlay_w-${DEFAULT_PADDING}'`),
                `Kỳ vọng x='main_w-overlay_w-24' nhưng nhận được: ${result.filterComplex}`
            );
            assert.ok(
                result.filterComplex.includes(`y='${DEFAULT_PADDING}'`),
                `Kỳ vọng y='24' nhưng nhận được: ${result.filterComplex}`
            );
        });

        it('góc bottom-left: x phải bằng 24, y phải là main_h-overlay_h-24', () => {
            const config: WatermarkConfig = {
                logoPath: '/tmp/logo.png',
                position: 'bottom-left',
                scalePercent: 10,
                opacity: 1.0,
            };

            const result = buildWatermarkFilter(config, VIDEO_W, VIDEO_H);

            assert.ok(
                result.filterComplex.includes(`x='${DEFAULT_PADDING}'`),
                `Kỳ vọng x='24' nhưng nhận được: ${result.filterComplex}`
            );
            assert.ok(
                result.filterComplex.includes(`y='main_h-overlay_h-${DEFAULT_PADDING}'`),
                `Kỳ vọng y='main_h-overlay_h-24' nhưng nhận được: ${result.filterComplex}`
            );
        });

        it('góc bottom-right: x phải là main_w-overlay_w-24, y phải là main_h-overlay_h-24', () => {
            const config: WatermarkConfig = {
                logoPath: '/tmp/logo.png',
                position: 'bottom-right',
                scalePercent: 10,
                opacity: 1.0,
            };

            const result = buildWatermarkFilter(config, VIDEO_W, VIDEO_H);

            assert.ok(
                result.filterComplex.includes(`x='main_w-overlay_w-${DEFAULT_PADDING}'`),
                `Kỳ vọng x='main_w-overlay_w-24' nhưng nhận được: ${result.filterComplex}`
            );
            assert.ok(
                result.filterComplex.includes(`y='main_h-overlay_h-${DEFAULT_PADDING}'`),
                `Kỳ vọng y='main_h-overlay_h-24' nhưng nhận được: ${result.filterComplex}`
            );
        });
    });

    // ─────────────────────────────────────────────────────────
    // TC-WMF-002: Kiểm tra TỌA ĐỘ TÙY BIẾN (position = 'custom')
    // ─────────────────────────────────────────────────────────
    describe('TC-WMF-002: Tính tọa độ tùy biến theo phần trăm (custom)', () => {

        it('xPercent=50, yPercent=50 => logo nằm ở chính giữa màn hình', () => {
            const config: WatermarkConfig = {
                logoPath: '/tmp/logo.png',
                position: 'custom',
                scalePercent: 10,
                opacity: 1.0,
                xPercent: 50,  // 50% → hệ số 0.5 trong biểu thức FFmpeg
                yPercent: 50,
            };

            const result = buildWatermarkFilter(config, VIDEO_W, VIDEO_H);

            // Kỳ vọng biểu thức: (main_w-overlay_w)*0.5 và (main_h-overlay_h)*0.5
            assert.ok(
                result.filterComplex.includes(`(main_w-overlay_w)*0.5`),
                `Kỳ vọng (main_w-overlay_w)*0.5 nhưng nhận được: ${result.filterComplex}`
            );
            assert.ok(
                result.filterComplex.includes(`(main_h-overlay_h)*0.5`),
                `Kỳ vọng (main_h-overlay_h)*0.5 nhưng nhận được: ${result.filterComplex}`
            );
        });

        it('xPercent=0, yPercent=0 => logo nằm ở góc trên-trái (x=0, y=0)', () => {
            const config: WatermarkConfig = {
                logoPath: '/tmp/logo.png',
                position: 'custom',
                scalePercent: 10,
                opacity: 1.0,
                xPercent: 0,
                yPercent: 0,
            };

            const result = buildWatermarkFilter(config, VIDEO_W, VIDEO_H);

            // 0/100 = 0 → (main_w-overlay_w)*0
            assert.ok(
                result.filterComplex.includes(`(main_w-overlay_w)*0`),
                `Kỳ vọng (main_w-overlay_w)*0 nhưng nhận được: ${result.filterComplex}`
            );
            assert.ok(
                result.filterComplex.includes(`(main_h-overlay_h)*0`),
                `Kỳ vọng (main_h-overlay_h)*0 nhưng nhận được: ${result.filterComplex}`
            );
        });

        it('custom không có xPercent/yPercent => fallback về giá trị mặc định 5%', () => {
            // Trường hợp người dùng chọn custom nhưng quên điền xPercent/yPercent
            const config: WatermarkConfig = {
                logoPath: '/tmp/logo.png',
                position: 'custom',
                scalePercent: 10,
                opacity: 1.0,
                // xPercent và yPercent không được truyền vào => undefined
            };

            const result = buildWatermarkFilter(config, VIDEO_W, VIDEO_H);

            // 5/100 = 0.05 → đây là giá trị fallback được khai báo trong watermarkFilter.ts
            assert.ok(
                result.filterComplex.includes(`(main_w-overlay_w)*0.05`),
                `Kỳ vọng fallback (main_w-overlay_w)*0.05 nhưng nhận được: ${result.filterComplex}`
            );
        });
    });

    // ─────────────────────────────────────────────────────────
    // TC-WMF-003: Kiểm tra tính toán CHIỀU RỘNG LOGO (scalePercent)
    // ─────────────────────────────────────────────────────────
    describe('TC-WMF-003: Tính chiều rộng logo theo scalePercent', () => {

        it('scalePercent=10 trên video 1920px => chiều rộng logo phải là 192px (chiều cao chẵn -2)', () => {
            const config: WatermarkConfig = {
                logoPath: '/tmp/logo.png',
                position: 'top-left',
                scalePercent: 10,   // 10% của 1920 = 192
                opacity: 1.0,
            };

            const result = buildWatermarkFilter(config, VIDEO_W, VIDEO_H);

            // Phần scale trong chuỗi filter phải chứa "scale=192:-2" để đảm bảo kích thước chẵn
            assert.ok(
                result.filterComplex.includes('scale=192:-2'),
                `Kỳ vọng scale=192:-2 nhưng nhận được: ${result.filterComplex}`
            );
        });

        it('scalePercent=25 trên video 1920px => chiều rộng logo phải là 480px (chiều cao chẵn -2)', () => {
            const config: WatermarkConfig = {
                logoPath: '/tmp/logo.png',
                position: 'top-left',
                scalePercent: 25,   // 25% của 1920 = 480
                opacity: 1.0,
            };

            const result = buildWatermarkFilter(config, VIDEO_W, VIDEO_H);

            assert.ok(
                result.filterComplex.includes('scale=480:-2'),
                `Kỳ vọng scale=480:-2 nhưng nhận được: ${result.filterComplex}`
            );
        });

        it('scalePercent=50 trên video 1080px (dọc) => chiều rộng logo phải là 540px (chiều cao chẵn -2)', () => {
            const config: WatermarkConfig = {
                logoPath: '/tmp/logo.png',
                position: 'top-left',
                scalePercent: 50,   // 50% của 1080 = 540
                opacity: 1.0,
            };

            // Dùng video dọc 1080x1920 (TikTok/Reels)
            const result = buildWatermarkFilter(config, 1080, 1920);

            assert.ok(
                result.filterComplex.includes('scale=540:-2'),
                `Kỳ vọng scale=540:-2 nhưng nhận được: ${result.filterComplex}`
            );
        });

        it('scalePercent không hợp lệ (NaN) => fallback về 15% (288px trên video 1920)', () => {
            const config: any = {
                logoPath: '/tmp/logo.png',
                position: 'top-left',
                scalePercent: NaN,
                opacity: 1.0,
            };

            const result = buildWatermarkFilter(config, VIDEO_W, VIDEO_H);

            assert.ok(
                result.filterComplex.includes('scale=288:-2'),
                `Kỳ vọng fallback scale=288:-2 nhưng nhận được: ${result.filterComplex}`
            );
        });

        it('targetWidth là số lẻ => tự động làm tròn lên số chẵn tiếp theo', () => {
            // scalePercent=11 trên video 1080px: 1080 * 0.11 = 118.8 -> round = 119 (lẻ) -> làm tròn thành 120
            const config: WatermarkConfig = {
                logoPath: '/tmp/logo.png',
                position: 'top-left',
                scalePercent: 11,
                opacity: 1.0,
            };

            const result = buildWatermarkFilter(config, 1080, 1920);

            assert.ok(
                result.filterComplex.includes('scale=120:-2'),
                `Kỳ vọng số chẵn scale=120:-2 nhưng nhận được: ${result.filterComplex}`
            );
        });
    });

    // ─────────────────────────────────────────────────────────
    // TC-WMF-004: Kiểm tra OPACITY (độ mờ / trong suốt)
    // ─────────────────────────────────────────────────────────
    describe('TC-WMF-004: Áp dụng đúng giá trị opacity vào colorchannelmixer', () => {

        it('opacity=1.0 (đục hoàn toàn) => chuỗi filter phải chứa aa=1', () => {
            const config: WatermarkConfig = {
                logoPath: '/tmp/logo.png',
                position: 'top-left',
                scalePercent: 10,
                opacity: 1.0,
            };

            const result = buildWatermarkFilter(config, VIDEO_W, VIDEO_H);

            assert.ok(
                result.filterComplex.includes('colorchannelmixer=aa=1'),
                `Kỳ vọng aa=1 nhưng nhận được: ${result.filterComplex}`
            );
        });

        it('opacity=0.5 (mờ 50%) => chuỗi filter phải chứa aa=0.5', () => {
            const config: WatermarkConfig = {
                logoPath: '/tmp/logo.png',
                position: 'top-left',
                scalePercent: 10,
                opacity: 0.5,
            };

            const result = buildWatermarkFilter(config, VIDEO_W, VIDEO_H);

            assert.ok(
                result.filterComplex.includes('colorchannelmixer=aa=0.5'),
                `Kỳ vọng aa=0.5 nhưng nhận được: ${result.filterComplex}`
            );
        });

        it('opacity=0.1 (giá trị tối thiểu hợp lệ) => chuỗi filter phải chứa aa=0.1', () => {
            const config: WatermarkConfig = {
                logoPath: '/tmp/logo.png',
                position: 'top-left',
                scalePercent: 10,
                opacity: 0.1,
            };

            const result = buildWatermarkFilter(config, VIDEO_W, VIDEO_H);

            assert.ok(
                result.filterComplex.includes('colorchannelmixer=aa=0.1'),
                `Kỳ vọng aa=0.1 nhưng nhận được: ${result.filterComplex}`
            );
        });

        it('opacity vượt quá 1.0 => phải bị kẹp (clamp) xuống 1.0', () => {
            // Dữ liệu lỗi: người dùng truyền opacity=2.5 (ngoài khoảng hợp lệ)
            const config: WatermarkConfig = {
                logoPath: '/tmp/logo.png',
                position: 'top-left',
                scalePercent: 10,
                opacity: 2.5, // schema sẽ chặn điều này, nhưng hàm cũng phải tự bảo vệ
            };

            const result = buildWatermarkFilter(config, VIDEO_W, VIDEO_H);

            // Hàm phải tự giới hạn opacity về tối đa 1.0
            assert.ok(
                result.filterComplex.includes('colorchannelmixer=aa=1'),
                `Kỳ vọng aa=1 sau khi clamp nhưng nhận được: ${result.filterComplex}`
            );
        });

        it('opacity nhỏ hơn 0.1 => phải bị kẹp (clamp) lên 0.1', () => {
            const config: WatermarkConfig = {
                logoPath: '/tmp/logo.png',
                position: 'top-left',
                scalePercent: 10,
                opacity: 0.01, // giá trị quá nhỏ, ngoài khoảng hợp lệ
            };

            const result = buildWatermarkFilter(config, VIDEO_W, VIDEO_H);

            // Hàm phải kẹp opacity lên tối thiểu 0.1
            assert.ok(
                result.filterComplex.includes('colorchannelmixer=aa=0.1'),
                `Kỳ vọng aa=0.1 sau khi clamp nhưng nhận được: ${result.filterComplex}`
            );
        });
    });

    // ─────────────────────────────────────────────────────────
    // TC-WMF-005: Kiểm tra CẤU TRÚC đầu ra của hàm
    // ─────────────────────────────────────────────────────────
    describe('TC-WMF-005: Kiểm tra cấu trúc object WatermarkFilterResult', () => {

        it('kết quả phải có đủ 2 trường: filterComplex (string) và outputLabel (string)', () => {
            const config: WatermarkConfig = {
                logoPath: '/tmp/logo.png',
                position: 'bottom-right',
                scalePercent: 15,
                opacity: 0.8,
            };

            const result = buildWatermarkFilter(config, VIDEO_W, VIDEO_H);

            // Kiểm tra kiểu dữ liệu đúng định dạng
            assert.strictEqual(typeof result.filterComplex, 'string', 'filterComplex phải là string');
            assert.strictEqual(typeof result.outputLabel, 'string', 'outputLabel phải là string');

            // outputLabel phải chứa nhãn luồng video đầu ra (mặc định là [outv])
            assert.strictEqual(result.outputLabel, '[outv]', 'outputLabel mặc định phải là [outv]');
        });

        it('filterComplex phải chứa dấu chấm phẩy (;) ngăn cách 2 giai đoạn lọc', () => {
            // Chuỗi filter hợp lệ gồm 2 phần nối bởi dấu ";"
            // Phần 1: chuẩn bị logo [wm]
            // Phần 2: ghép overlay [outv]
            const config: WatermarkConfig = {
                logoPath: '/tmp/logo.png',
                position: 'top-right',
                scalePercent: 20,
                opacity: 0.7,
            };

            const result = buildWatermarkFilter(config, VIDEO_W, VIDEO_H);

            // Chuỗi filter phải có đúng 1 dấu ";" ngăn 2 giai đoạn
            const parts = result.filterComplex.split(';');
            assert.strictEqual(parts.length, 2, `filterComplex phải có 2 phần ngăn bởi ";", nhưng nhận được ${parts.length} phần`);
        });

        it('filterComplex phải chứa nhãn [wm] làm cầu nối giữa 2 giai đoạn lọc', () => {
            const config: WatermarkConfig = {
                logoPath: '/tmp/logo.png',
                position: 'top-left',
                scalePercent: 10,
                opacity: 1.0,
            };

            const result = buildWatermarkFilter(config, VIDEO_W, VIDEO_H);

            // Nhãn trung gian [wm] phải xuất hiện ở cuối phần 1 và đầu phần 2
            assert.ok(
                result.filterComplex.includes('[wm]'),
                `filterComplex phải chứa nhãn trung gian [wm], nhưng nhận được: ${result.filterComplex}`
            );
        });

        it('filterComplex phải chứa format=rgba để xử lý đúng kênh Alpha trong suốt', () => {
            const config: WatermarkConfig = {
                logoPath: '/tmp/logo.png',
                position: 'top-left',
                scalePercent: 10,
                opacity: 0.9,
            };

            const result = buildWatermarkFilter(config, VIDEO_W, VIDEO_H);

            assert.ok(
                result.filterComplex.includes('format=rgba'),
                `filterComplex phải chứa "format=rgba" để hỗ trợ PNG trong suốt, nhưng nhận được: ${result.filterComplex}`
            );
        });
    });

    // ─────────────────────────────────────────────────────────
    // TC-WMF-006: Kiểm tra PADDING TÙY BIẾN (tham số padding)
    // ─────────────────────────────────────────────────────────
    describe('TC-WMF-006: Tùy chỉnh khoảng cách đệm từ mép (padding)', () => {

        it('padding=50 => tọa độ corner phải dùng 50 thay vì 24 mặc định', () => {
            const config: WatermarkConfig = {
                logoPath: '/tmp/logo.png',
                position: 'bottom-right',
                scalePercent: 10,
                opacity: 1.0,
            };

            // Truyền padding=50 (tham số thứ 6 của hàm)
            const result = buildWatermarkFilter(config, VIDEO_W, VIDEO_H, '0:v', '2:v', 50);

            assert.ok(
                result.filterComplex.includes('main_w-overlay_w-50'),
                `Kỳ vọng padding 50 trong biểu thức x nhưng nhận được: ${result.filterComplex}`
            );
            assert.ok(
                result.filterComplex.includes('main_h-overlay_h-50'),
                `Kỳ vọng padding 50 trong biểu thức y nhưng nhận được: ${result.filterComplex}`
            );
        });
    });

    // ─────────────────────────────────────────────────────────
    // TC-WMF-007: Kiểm tra NHÃN LUỒNG tùy chỉnh (videoLabel & logoLabel)
    // ─────────────────────────────────────────────────────────
    describe('TC-WMF-007: Tùy chỉnh nhãn luồng video và logo', () => {

        it('videoLabel="1:v" và logoLabel="3:v" => filterComplex phải dùng đúng nhãn đó', () => {
            // Trường hợp video có audio thì luồng video nền có thể là "1:v" thay vì "0:v"
            const config: WatermarkConfig = {
                logoPath: '/tmp/logo.png',
                position: 'top-left',
                scalePercent: 10,
                opacity: 1.0,
            };

            const result = buildWatermarkFilter(config, VIDEO_W, VIDEO_H, '1:v', '3:v');

            // Phần chuẩn bị logo phải dùng nhãn [3:v]
            assert.ok(
                result.filterComplex.includes('[3:v]'),
                `Kỳ vọng nhãn logo [3:v] nhưng nhận được: ${result.filterComplex}`
            );
            // Phần overlay phải dùng nhãn video [1:v]
            assert.ok(
                result.filterComplex.includes('[1:v]'),
                `Kỳ vọng nhãn video [1:v] nhưng nhận được: ${result.filterComplex}`
            );
        });
    });
});
