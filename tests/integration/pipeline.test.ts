import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFullPipeline } from "../../src/pipeline/orchestrator.js";
import { setLLMClient, resetLLMClient, type LLMClient } from "../../src/llm/client.js";
import { setTTSClient, resetTTSClient, generateSilence, type TTSClient } from "../../src/pipeline/audioSysnthesis.js";
import { resetConfig } from "../../src/config.js";
import { type videoRequest, type videoScript, type pipelineProgess } from "../../src/llm/schema.js";

class IntegrationMockLLM implements LLMClient {
    readonly provider = "mock-integration-llm";
    constructor(private scriptData: videoScript) {}
    async generate(): Promise<string> {
        return JSON.stringify(this.scriptData);
    }
}

class IntegrationMockTTS implements TTSClient {
    readonly provider = "mock-integration-tts";
    async synthesize(text: string, outputPath: string): Promise<void> {
        // Cảnh 1 ngắn (1.5s), cảnh 2 dài (6.5s) để đạt tỷ số nhịp điệu (ratio >= 4, CV >= 0.3)
        const duration = text.includes("Khởi động") ? 1.5 : 6.5;
        await generateSilence(outputPath, duration);
    }
}

const sampleScript: videoScript = {
    id: "integration-script-001",
    title: "Integration Test Video",
    description: "E2E Pipeline Integration Test",
    globalStyles: "body { margin: 0; background: #000; }",
    globalSetupJs: "console.log('E2E Ready');",
    scenes: [
        {
            id: "scene-1",
            title: "Cảnh 1: Khởi động",
            voiceOverText: "Khởi động kịch bản thử nghiệm tích hợp.",
            visualDescription: "Phần tử chính xuất hiện",
            htmlCode: '<div class="scene" id="scene-1"><div id="shared-box" style="position:absolute;left:200px;top:200px;width:150px;height:150px;background:#3b82f6;"></div><h1>LIME E2E</h1></div>',
            cssCode: "#scene-1 { display: flex; justify-content: center; }",
            jsCode: "const tl = gsap.timeline(); tl.to('#shared-box', { duration: {{SCENE_DURATION}}, opacity: 1 });",
            transition: "fade",
            backgroundColor: "#0a0a0a",
        },
        {
            id: "scene-2",
            title: "Cảnh 2: Kết thúc",
            voiceOverText: "Cảm ơn bạn đã xem toàn bộ quy trình kiểm thử tích hợp tự động.",
            visualDescription: "Phần tử tiếp tục chuyển động với đoạn nghỉ",
            nearStill: { from: 1.0, to: 3.0 },
            htmlCode: '<div class="scene" id="scene-2"><div id="shared-box" style="position:absolute;left:220px;top:200px;width:150px;height:150px;background:#10b981;"></div><h2>Hoàn thành</h2></div>',
            cssCode: "#scene-2 { text-align: center; }",
            jsCode: "const tl = gsap.timeline(); tl.to('#shared-box', { duration: {{SCENE_DURATION}}, scale: 1.05 });",
            transition: "none",
            backgroundColor: "#141414",
        },
    ],
    boundaries: [
        {
            id: "b1",
            fromScene: "scene-1",
            toScene: "scene-2",
            carry: {
                element: "#shared-box",
                mechanism: "morph",
            },
        },
    ],
    colorPalette: {
        primary: "#3b82f6",
        secondary: "#10b981",
        accent: "#f59e0b",
        background: "#0a0a0a",
        text: "#ffffff",
    },
    fontFamily: "Inter",
};

test("E2E Integration: Pipeline Orchestrator executes all phases cleanly", async () => {
    resetConfig();
    resetLLMClient();
    resetTTSClient();

    const tempDir = mkdtempSync(join(tmpdir(), "lime-e2e-"));
    const mockLLM = new IntegrationMockLLM(sampleScript);
    const mockTTS = new IntegrationMockTTS();

    setLLMClient(mockLLM);
    setTTSClient(mockTTS);

    const progressLogs: pipelineProgess[] = [];
    const request: videoRequest = {
        prompt: "Video thử nghiệm tích hợp toàn trình 2 cảnh",
        aspectRatio: "16:9",
        targetDurationSec: 10,
        language: "vi",
        style: "modern",
    };

    try {
        const result = await runFullPipeline({
            request,
            script: sampleScript,
            outputDir: tempDir,
            skipPreview: true,
            skipRender: true,
            onProgress: (p) => progressLogs.push(p),
        });

        // 1. Verify result structure
        assert.ok(result.jobId);
        assert.equal(result.resolution, "1920x1080");
        assert.equal(result.scences.length, 2);
        assert.ok(result.durationSec > 0);

        // 2. Verify artifact files on disk
        assert.ok(existsSync(result.finalHtmlPath));
        assert.ok(existsSync(result.audio.mixAudioPath));

        // 3. Verify HTML bundle contents (Motion Toolkit and GSAP integration)
        const htmlContent = readFileSync(result.finalHtmlPath, "utf-8");
        assert.ok(htmlContent.includes("window.__seekTo"));
        assert.ok(htmlContent.includes("scene-1"));
        assert.ok(htmlContent.includes("scene-2"));

        // 4. Verify progress events
        assert.ok(progressLogs.length >= 4);
        assert.ok(progressLogs.some((p) => p.phase === "html_assembly"));
        assert.ok(progressLogs.some((p) => p.phase === "audio_synthesis"));
        assert.ok(progressLogs.some((p) => p.phase === "oracle_qa"));
    } finally {
        resetLLMClient();
        resetTTSClient();
        resetConfig();
        if (existsSync(tempDir)) {
            rmSync(tempDir, { recursive: true, force: true });
        }
    }
});
