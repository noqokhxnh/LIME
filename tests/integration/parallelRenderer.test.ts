import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { renderVideo } from '../../src/pipeline/renderer.js';

describe('Integration: Parallel Chunked Rendering & Fast Concat', () => {
    const testDir = join(process.cwd(), 'tmp', 'test-parallel-render');
    const htmlPath = join(testDir, 'index.html');
    const audioPath = join(testDir, 'silent.mp3');

    before(() => {
        if (!existsSync(testDir)) {
            mkdirSync(testDir, { recursive: true });
        }

        // Tạo file HTML động chuẩn GSAP mockup
        const htmlContent = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body { margin: 0; background: #0f172a; color: #f8fafc; font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; }
        .box { width: 120px; height: 120px; background: #22c55e; border-radius: 16px; }
    </style>
</head>
<body>
    <div class="box" id="box"></div>
    <script>
        window.__seekTo = function(t) {
            var box = document.getElementById('box');
            if (box) {
                box.style.transform = 'rotate(' + (t * 180) + 'deg) scale(' + (1 + Math.sin(t)) + ')';
            }
        };
        window.__ready = true;
    </script>
</body>
</html>`;
        writeFileSync(htmlPath, htmlContent, 'utf-8');

        // Tạo 1 file audio im lặng 2 giây để test muxing
        try {
            execSync(`ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=stereo -t 2 "${audioPath}"`, { stdio: 'ignore' });
        } catch {
            // Nếu ffmpeg không sinh được lavfi audio thì bỏ qua
        }
    });

    after(() => {
        if (existsSync(testDir)) {
            rmSync(testDir, { recursive: true, force: true });
        }
    });

    it('phải render song song 4 chunks và ghép nối thành công file MP4 hoàn chỉnh', async () => {
        const outputPath = join(testDir, 'output_parallel_4.mp4');
        const progressLogs: string[] = [];

        const resultPath = await renderVideo({
            htmlPath,
            audioPath,
            outputPath,
            width: 640,
            height: 360,
            fps: 30,
            durationSec: 2, // 60 frames -> 4 chunks (15 frames/chunk)
            concurrency: 4,
            onProgress: (msg, pct) => {
                progressLogs.push(`${msg} (${pct}%)`);
            },
        });

        assert.strictEqual(resultPath, outputPath);
        assert.ok(existsSync(outputPath), 'File MP4 đầu ra phải tồn tại');

        // Kiểm tra tất cả chunk tạm đã được dọn sạch
        assert.ok(!existsSync(join(testDir, 'chunk_0.mp4')), 'chunk_0.mp4 phải được dọn dẹp');
        assert.ok(!existsSync(join(testDir, 'chunk_1.mp4')), 'chunk_1.mp4 phải được dọn dẹp');
        assert.ok(!existsSync(join(testDir, 'chunk_2.mp4')), 'chunk_2.mp4 phải được dọn dẹp');
        assert.ok(!existsSync(join(testDir, 'chunk_3.mp4')), 'chunk_3.mp4 phải được dọn dẹp');

        // Kiểm tra tiến độ báo cáo
        assert.ok(progressLogs.length > 0, 'Phải có log tiến độ');
        assert.ok(progressLogs.some(l => l.includes('parallel chunks')), 'Log phải thông báo chế độ parallel chunks');
        assert.ok(progressLogs.some(l => l.includes('100%')), 'Tiến độ phải đạt 100% khi kết thúc');

        // Kiểm tra thông số video qua ffprobe nếu có
        try {
            const probe = execSync(
                `ffprobe -v error -select_streams v:0 -show_entries stream=nb_frames,duration,codec_name -of default=noprint_wrappers=1 "${outputPath}"`,
                { encoding: 'utf-8' }
            );
            assert.ok(probe.includes('codec_name=h264'), 'Video phải encode h264');
            console.log('ffprobe output:', probe.trim());
        } catch {
            // ffprobe tùy chọn
        }
    });

    it('phải render an toàn khi chỉ định concurrency = 1 (single worker fallback)', async () => {
        const outputPath = join(testDir, 'output_single_1.mp4');

        const resultPath = await renderVideo({
            htmlPath,
            audioPath,
            outputPath,
            width: 640,
            height: 360,
            fps: 30,
            durationSec: 1, // 30 frames
            concurrency: 1,
        });

        assert.strictEqual(resultPath, outputPath);
        assert.ok(existsSync(outputPath));
    });
});
