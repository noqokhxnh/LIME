import { describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * Test cho CDP BeginFrame Capture (Issue #40).
 * 
 * Vì CDP cần browser thật, test này chỉ kiểm tra:
 * 1. Module export đúng interface
 * 2. Fallback session hoạt động khi CDP không khả dụng
 * 
 * Integration test với browser thật nằm ở tests/integration/.
 */
describe("cdpCapture (Issue #40)", () => {
    it("export đúng các hàm", async () => {
        const mod = await import("../../src/pipeline/cdpCapture.js");
        assert.equal(typeof mod.createCdpCaptureSession, "function");
    });

    it("fallback session: checkDamage luôn trả về true", async () => {
        // Mock page với context không hỗ trợ CDP
        const mockPage = {
            context: () => ({
                newCDPSession: async () => {
                    throw new Error("CDP not supported");
                },
            }),
            screenshot: async () => Buffer.from("fake-jpeg-data"),
        } as any;

        const mod = await import("../../src/pipeline/cdpCapture.js");
        const session = await mod.createCdpCaptureSession(mockPage);
        
        // Fallback → isCdpAvailable = false
        assert.equal(session.isCdpAvailable, false);
        
        // checkDamage luôn true trong fallback
        const hasDamage = await session.checkDamage();
        assert.equal(hasDamage, true);
        
        // captureFrame trả về screenshot
        const result = await session.captureFrame();
        assert.equal(result.hasDamage, true);
        assert.ok(result.screenshotData);
        
        await session.close();
    });
});
