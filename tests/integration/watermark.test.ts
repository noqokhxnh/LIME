import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync, statSync } from 'node:fs';
import { renderVideo } from '../../src/pipeline/renderer.js';
import { buildWatermarkFilter } from '../../src/pipeline/watermarkFilter.js';
import { LOGOS_DIR } from '../../src/security/uploadGuard.js';
import { type WatermarkConfig } from '../../src/llm/schema.js';

// =========================================================================
// INTEGRATION TEST: tests/integration/watermark.test.ts
// Mục tiêu: Kiểm thử tích hợp toàn trình (E2E) xuất video có đóng dấu logo.
//           Khẳng định file final_video.mp4 được sinh ra và dung lượng hợp lệ (> 1KB).
// Lệnh chạy: node.exe --import tsx tests/integration/watermark.test.ts
// =========================================================================

describe('E2E Integration Test: Watermark Video Rendering (src/pipeline/renderer.ts)', () => {
    let testWorkDir: string;
    let htmlPath: string;
    let logoPath: string;
    let outputPath: string;

    // Ảnh PNG mẫu hợp lệ (100x100)
    // Được mã hóa Base64 để tạo file thật trên đĩa không phụ thuộc mạng
    const SAMPLE_PNG_BASE64 =
        'iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAIAAAD/gAIDAAAACXBIWXMAAAABAAAAAQBPJcTWAAAA' +
        '6UlEQVR4nO3QwQkAIRDAwBXsv+TjWjAvEWYqCFkz33Bm3w54iVmBWYFZgVmBWYFZgVmBWYFZgVmB' +
        'WYFZgVmBWYFZgVmBWYFZgVmBWYFZgVmBWYFZgVmBWYFZgVmBWYFZgVmBWYFZgVmBWYFZgVmBWYFZ' +
        'gVmBWYFZgVmBWYFZgVmBWYFZgVmBWYFZgVmBWYFZgVmBWYFZgVmBWYFZgVmBWYFZgVmBWYFZgVmB' +
        'WYFZgVmBWYFZgVmBWYFZgVmBWYFZgVmBWYFZgVmBWYFZgVmBWYFZgVmBWYFZgVmBWYFZgVmBWYFZ' +
        'gVmBWcEPja4CjBR9UO0AAAAASUVORK5CYII=';

    before(() => {
        // Tạo thư mục tạm cô lập cho bài test
        testWorkDir = mkdtempSync(join(tmpdir(), 'watermark-e2e-'));

        // 1. Tạo file HTML chứa animation và cờ báo hiệu window.__ready = true
        htmlPath = join(testWorkDir, 'test_scene.html');
        const htmlContent = `<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="utf-8">
    <title>Watermark Integration Test Scene</title>
    <style>
        body {
            margin: 0;
            padding: 0;
            background: #0f172a;
            color: #ffffff;
            font-family: sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
        }
        .title {
            font-size: 36px;
            color: #38bdf8;
            font-weight: bold;
        }
    </style>
</head>
<body>
    <div class="title">LIME Watermark E2E Test</div>
    <script>
        // Cờ sẵn sàng để Playwright nhận diện đã nạp trang xong
        window.__ready = true;
    </script>
</body>
</html>`;
        writeFileSync(htmlPath, htmlContent, 'utf-8');

        // 2. Tạo file ảnh logo PNG mẫu trên đĩa.
        //    Logo phải nằm trong thư mục logos được phép (LOGOS_DIR) vì
        //    renderer chỉ chấp nhận logoPath đã qua kiểm tra giới hạn phạm vi.
        mkdirSync(LOGOS_DIR, { recursive: true });
        logoPath = join(LOGOS_DIR, `watermark-e2e-${Date.now()}.png`);
        writeFileSync(logoPath, Buffer.from(SAMPLE_PNG_BASE64, 'base64'));

        // 3. Đường dẫn file video đầu ra
        outputPath = join(testWorkDir, 'final_video.mp4');
    });

    after(() => {
        // Dọn dẹp thư mục tạm sau khi hoàn tất test
        if (existsSync(testWorkDir)) {
            try {
                rmSync(testWorkDir, { recursive: true, force: true });
            } catch {
                // Bỏ qua lỗi khóa file tạm trên Windows nếu có
            }
        }
        // Dọn dẹp file logo test trong thư mục logos được phép
        try {
            if (logoPath && existsSync(logoPath)) rmSync(logoPath, { force: true });
        } catch {
            // Bỏ qua lỗi dọn dẹp
        }
    });

    it('TC-E2E-001: Bộ lọc watermark được tính toán chính xác với cấu hình logo mẫu', () => {
        const watermarkConfig: WatermarkConfig = {
            logoPath,
            position: 'bottom-right',
            scalePercent: 15,
            opacity: 0.8,
        };

        const filterResult = buildWatermarkFilter(watermarkConfig, 1280, 720, '0:v', '1:v');

        assert.ok(filterResult.filterComplex, 'filterComplex phải là chuỗi không rỗng');
        assert.ok(filterResult.filterComplex.includes('scale='), 'Phải có bộ lọc scale');
        assert.ok(filterResult.filterComplex.includes('colorchannelmixer=aa=0.8'), 'Phải chỉnh độ trong suốt opacity 0.8');
        assert.ok(filterResult.filterComplex.includes('overlay='), 'Phải có bộ lọc overlay');
        assert.strictEqual(filterResult.outputLabel, '[outv]', 'Luồng hình ảnh đầu ra phải là [outv]');
    });

    it('TC-E2E-002: Xuất video thành công có chứa logo, sinh file final_video.mp4 hợp lệ (> 1KB)', async (t) => {
        const watermarkConfig: WatermarkConfig = {
            logoPath,
            position: 'bottom-right',
            scalePercent: 15,
            opacity: 0.8,
        };

        try {
            // Thử gọi renderVideo thật
            await renderVideo({
                htmlPath,
                audioPath: join(testWorkDir, 'non_existent_audio.mp3'),
                outputPath,
                width: 640,
                height: 360,
                fps: 10,
                durationSec: 1, // 1 giây ngắn để render nhanh
                watermark: watermarkConfig,
            });
        } catch (err: any) {
            // Trường hợp môi trường thiếu binary ffmpeg hoặc Chromium trên host
            const isMissingDependency =
                err.message?.includes('ENOENT') ||
                err.message?.includes('browserType.launch') ||
                err.message?.includes('spawn ffmpeg') ||
                err.code === 'ENOENT';

            if (isMissingDependency) {
                t.skip(`Môi trường thiếu binary ffmpeg hoặc Chromium: ${err.message}`);
                return;
            }
            throw err;
        }

        // Khẳng định 1: File final_video.mp4 phải tồn tại trên đĩa
        assert.ok(existsSync(outputPath), 'File final_video.mp4 phải tồn tại trên đĩa');

        // Khẳng định 2: Dung lượng video hợp lệ (> 1KB)
        const stats = statSync(outputPath);
        assert.ok(
            stats.size > 1024,
            `Dung lượng video (${stats.size} bytes) phải lớn hơn ngưỡng tối thiểu 1KB`
        );
    });
});
