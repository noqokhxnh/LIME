import { describe, it } from 'node:test';
import assert from 'node:assert';
import { calculateRenderChunks } from '../../src/pipeline/renderer.js';

describe('Module: Chunked Parallel Rendering - calculateRenderChunks', () => {
    it('TC-CHK-001: Chia đều các frame khi totalFrames chia hết cho concurrency', () => {
        const chunks = calculateRenderChunks(120, 30, 4, '/tmp/test_chunks');
        assert.strictEqual(chunks.length, 4);

        assert.deepStrictEqual(chunks[0], {
            index: 0,
            startFrame: 0,
            endFrame: 30,
            frameCount: 30,
            startTimeSec: 0,
            endTimeSec: 1,
            chunkOutputPath: '/tmp/test_chunks/chunk_0.mp4',
        });

        assert.deepStrictEqual(chunks[1], {
            index: 1,
            startFrame: 30,
            endFrame: 60,
            frameCount: 30,
            startTimeSec: 1,
            endTimeSec: 2,
            chunkOutputPath: '/tmp/test_chunks/chunk_1.mp4',
        });

        assert.deepStrictEqual(chunks[2], {
            index: 2,
            startFrame: 60,
            endFrame: 90,
            frameCount: 30,
            startTimeSec: 2,
            endTimeSec: 3,
            chunkOutputPath: '/tmp/test_chunks/chunk_2.mp4',
        });

        assert.deepStrictEqual(chunks[3], {
            index: 3,
            startFrame: 90,
            endFrame: 120,
            frameCount: 30,
            startTimeSec: 3,
            endTimeSec: 4,
            chunkOutputPath: '/tmp/test_chunks/chunk_3.mp4',
        });
    });

    it('TC-CHK-002: Phân bổ phần dư chính xác khi totalFrames không chia hết cho concurrency', () => {
        // 101 frames chia 4: 26, 25, 25, 25
        const chunks = calculateRenderChunks(101, 30, 4, '/tmp/test_chunks');
        assert.strictEqual(chunks.length, 4);

        assert.strictEqual(chunks[0].frameCount, 26);
        assert.strictEqual(chunks[0].startFrame, 0);
        assert.strictEqual(chunks[0].endFrame, 26);

        assert.strictEqual(chunks[1].frameCount, 25);
        assert.strictEqual(chunks[1].startFrame, 26);
        assert.strictEqual(chunks[1].endFrame, 51);

        assert.strictEqual(chunks[2].frameCount, 25);
        assert.strictEqual(chunks[2].startFrame, 51);
        assert.strictEqual(chunks[2].endFrame, 76);

        assert.strictEqual(chunks[3].frameCount, 25);
        assert.strictEqual(chunks[3].startFrame, 76);
        assert.strictEqual(chunks[3].endFrame, 101);

        const totalFramesCount = chunks.reduce((acc, c) => acc + c.frameCount, 0);
        assert.strictEqual(totalFramesCount, 101);
    });

    it('TC-CHK-003: Đảm bảo tính liên tục của timeline (không hở frame, không chồng frame)', () => {
        const total = 1800; // 60s @ 30fps
        const chunks = calculateRenderChunks(total, 30, 4, '/tmp/test');
        
        assert.strictEqual(chunks[0].startFrame, 0);
        assert.strictEqual(chunks[chunks.length - 1].endFrame, total);

        for (let i = 0; i < chunks.length - 1; i++) {
            assert.strictEqual(
                chunks[i].endFrame,
                chunks[i + 1].startFrame,
                `Ranh giới giữa chunk ${i} và ${i + 1} phải khớp tuyệt đối`
            );
            assert.strictEqual(
                chunks[i].endTimeSec,
                chunks[i + 1].startTimeSec,
                `Timestamp giữa chunk ${i} và ${i + 1} phải khớp tuyệt đối`
            );
        }
    });

    it('TC-CHK-004: Tự động giảm concurrency cho video ngắn để tránh overhead', () => {
        // 20 frames với minFramesPerChunk = 15 -> concurrency = 2 (10, 10)
        const chunks = calculateRenderChunks(20, 30, 4, '/tmp/test', 15);
        assert.strictEqual(chunks.length, 2);
        assert.strictEqual(chunks[0].frameCount, 10);
        assert.strictEqual(chunks[1].frameCount, 10);
    });

    it('TC-CHK-005: Xử lý an toàn với các trường hợp biên (1 frame, concurrency = 1)', () => {
        const singleFrame = calculateRenderChunks(1, 30, 4, '/tmp/test');
        assert.strictEqual(singleFrame.length, 1);
        assert.strictEqual(singleFrame[0].startFrame, 0);
        assert.strictEqual(singleFrame[0].endFrame, 1);
        assert.strictEqual(singleFrame[0].frameCount, 1);

        const singleConcurrency = calculateRenderChunks(100, 30, 1, '/tmp/test');
        assert.strictEqual(singleConcurrency.length, 1);
        assert.strictEqual(singleConcurrency[0].frameCount, 100);
    });

    it('TC-CHK-006: renderVideo từ chối ngay lập tức với AbortError khi signal đã bị aborted', async () => {
        const { renderVideo } = await import('../../src/pipeline/renderer.js');
        const controller = new AbortController();
        controller.abort();

        await assert.rejects(
            async () => {
                await renderVideo({
                    htmlPath: '/dummy/index.html',
                    audioPath: '/dummy/audio.mp3',
                    outputPath: '/dummy/out.mp4',
                    width: 1920,
                    height: 1080,
                    durationSec: 5,
                    signal: controller.signal,
                });
            },
            (err: any) => {
                return err.name === 'AbortError' || err.message.includes('aborted');
            }
        );
    });

    it('TC-CHK-007: Định dạng danh sách FFmpeg concat_list.txt thoát ký tự nháy chuẩn xác', () => {
        const chunks = calculateRenderChunks(60, 30, 2, '/tmp/test dir');
        const lines = chunks
            .map(c => `file '${c.chunkOutputPath.replace(/'/g, "'\\''")}'`)
            .join('\n');

        assert.ok(lines.includes("file '/tmp/test dir/chunk_0.mp4'"));
        assert.ok(lines.includes("file '/tmp/test dir/chunk_1.mp4'"));
    });
});
