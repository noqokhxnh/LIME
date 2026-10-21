import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calculateRenderChunks } from "../../src/pipeline/renderer.js";

describe("calculateRenderChunks (Issue #35)", () => {
    it("chia đều frame cho các chunk", () => {
        const chunks = calculateRenderChunks(90, 30, 3, "/tmp");
        assert.equal(chunks.length, 3);
        assert.deepEqual(chunks.map(c => c.frameCount), [30, 30, 30]);
        assert.equal(chunks[0].startFrame, 0);
        assert.equal(chunks[0].endFrame, 30);
        assert.equal(chunks[2].startFrame, 60);
        assert.equal(chunks[2].endFrame, 90);
    });

    it("phần dư phân bổ cho các chunk đầu", () => {
        const chunks = calculateRenderChunks(100, 30, 3, "/tmp");
        assert.equal(chunks.length, 3);
        assert.deepEqual(chunks.map(c => c.frameCount), [34, 33, 33]);
    });

    it("giới hạn chunk theo minFramesPerChunk (mặc định 15)", () => {
        // 20 frame, xin 4 chunk nhưng mỗi chunk tối thiểu 15 frame → chỉ 1 chunk
        const chunks = calculateRenderChunks(20, 30, 4, "/tmp");
        assert.equal(chunks.length, 1);
        assert.equal(chunks[0].frameCount, 20);
    });

    it("tổng frame của các chunk bằng totalFrames", () => {
        for (const total of [1, 15, 16, 45, 100, 300]) {
            const chunks = calculateRenderChunks(total, 30, 4, "/tmp");
            const sum = chunks.reduce((a, c) => a + c.frameCount, 0);
            assert.equal(sum, total, `total=${total}`);
            // Các chunk liên tiếp nhau, không chồng lấp, không hở
            for (let i = 1; i < chunks.length; i++) {
                assert.equal(chunks[i].startFrame, chunks[i-1].endFrame);
            }
        }
    });

    it("tính đúng thời gian bắt đầu/kết thúc theo fps", () => {
        const chunks = calculateRenderChunks(60, 30, 2, "/tmp");
        assert.equal(chunks[0].startTimeSec, 0);
        assert.equal(chunks[0].endTimeSec, 1);
        assert.equal(chunks[1].startTimeSec, 1);
        assert.equal(chunks[1].endTimeSec, 2);
    });

    it("đường dẫn chunk output nằm trong tempDir", () => {
        const chunks = calculateRenderChunks(60, 30, 2, "/tmp/xyz");
        assert.ok(chunks[0].chunkOutputPath.startsWith("/tmp/xyz"));
        assert.ok(chunks[0].chunkOutputPath.endsWith("chunk_0.mp4"));
        assert.ok(chunks[1].chunkOutputPath.endsWith("chunk_1.mp4"));
    });

    it("xử lý giá trị biên: totalFrames=0, concurrency=0", () => {
        const chunks = calculateRenderChunks(0, 30, 0, "/tmp");
        assert.equal(chunks.length, 1);
        assert.equal(chunks[0].frameCount, 1);
    });
});
