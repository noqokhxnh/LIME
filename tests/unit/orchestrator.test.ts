import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { runFullPipeline, type orchestratorOptions } from '../../src/pipeline/orchestrator.js';
import { setLLMClient, resetLLMClient, type LLMClient } from '../../src/llm/client.js';
import { setTTSClient, resetTTSClient, generateSilence, type TTSClient } from '../../src/pipeline/audioSysnthesis.js';
import { resetConfig } from '../../src/config.js';
import { type videoRequest, type videoScript, type pipelineProgess } from '../../src/llm/schema.js';

class MockOrchLLMClient implements LLMClient {
    readonly provider = 'mock-llm';
    constructor(private response: string) {}
    async generate(): Promise<string> {
        return this.response;
    }
}

class MockOrchTTSClient implements TTSClient {
    readonly provider = 'mock-tts';
    public shouldFail = false;

    async synthesize(_text: string, outputPath: string): Promise<void> {
        if (this.shouldFail) {
            throw new Error('TTS Network Connection Error');
        }
        await generateSilence(outputPath, 1.5);
    }
}

describe('Module 8: Pipeline Orchestrator (src/pipeline/orchestrator.ts)', () => {
    let testTempDir: string;
    let mockTTS: MockOrchTTSClient;

    const sampleScript: videoScript = {
        id: 'orch-script-01',
        title: 'Video Orchestrator Test',
        description: 'Kịch bản kiểm thử điều phối toàn trình',
        globalStyles: 'body { margin: 0; }',
        globalSetupJs: 'console.log("ready");',
        scenes: [
            {
                id: 'scene-1',
                title: 'Mở Đầu',
                voiceOverText: 'Chào mừng các bạn đến với hệ thống.',
                visualDescription: '',
                htmlCode: '<div class="scene" id="scene-1"><h1>Intro</h1></div>',
                cssCode: '',
                jsCode: 'tl.to("#scene-1", { duration: {{SCENE_DURATION}}, opacity: 1 });',
                transition: 'fade',
                backgroundColor: '#000000',
            },
            {
                id: 'scene-2',
                title: 'Kết Thúc',
                voiceOverText: 'Cảm ơn đã theo dõi video.',
                visualDescription: '',
                htmlCode: '<div class="scene" id="scene-2"><h1>Outro</h1></div>',
                cssCode: '',
                jsCode: 'tl.to("#scene-2", { duration: {{SCENE_DURATION}}, opacity: 1 });',
                transition: 'none',
                backgroundColor: '#111111',
            },
        ],
        colorPalette: {
            primary: '#3b82f6',
            secondary: '#1d4ed8',
            accent: '#f59e0b',
            background: '#0f172a',
            text: '#ffffff',
        },
        fontFamily: 'Inter',
    };

    const validVideoRequest: videoRequest = {
        promt: 'Video kiểm thử tính năng điều phối pipeline',
        aspectRatio: '16:9',
        targetDurationSec: 30,
        language: 'vi',
        style: 'modern',
    };

    beforeEach(() => {
        resetConfig();
        resetLLMClient();
        resetTTSClient();

        mockTTS = new MockOrchTTSClient();
        setTTSClient(mockTTS);
        setLLMClient(new MockOrchLLMClient(JSON.stringify(sampleScript)));

        testTempDir = mkdtempSync(join(tmpdir(), 'orch-test-'));
    });

    afterEach(() => {
        resetConfig();
        resetLLMClient();
        resetTTSClient();

        if (existsSync(testTempDir)) {
            rmSync(testTempDir, { recursive: true, force: true });
        }
    });

    describe('TC-ORC-001: Thực thi thành công toàn trình (End-to-End Pipeline)', () => {
        it('phải hoàn thành tất cả các giai đoạn, tạo artifact và ghi nhận timing', async () => {
            const progressUpdates: pipelineProgess[] = [];
            const jobDir = join(testTempDir, 'job-e2e');

            const result = await runFullPipeline({
                request: validVideoRequest,
                outputDir: jobDir,
                onProgress: (p) => progressUpdates.push(p),
            });

            // 1. Kiểm tra kết quả trả về
            assert.ok(result.jobId, 'Phải có jobId');
            assert.strictEqual(result.workDir, jobDir);
            assert.ok(result.durationSec > 0, 'durationSec phải > 0');
            assert.strictEqual(result.scences.length, 2);
            assert.strictEqual(result.resolution, '1920x1080');

            // 2. Kiểm tra các artifact vật lý trên đĩa
            assert.ok(existsSync(result.finalHtmlPath), 'File index.html cuối cùng phải tồn tại');
            assert.ok(existsSync(result.audio.mixAudioPath), 'File audio mix phải tồn tại');
            assert.ok(existsSync(join(jobDir, 'previews')), 'Thư mục previews phải tồn tại');
            assert.ok(result.preview, 'Phải có kết quả previews');
            assert.strictEqual(result.preview?.previews.length, 2);

            // 3. Kiểm tra timing ghi nhận các giai đoạn
            assert.ok('script_generation' in result.timing);
            assert.ok('estimate_duration' in result.timing);
            assert.ok('html_assembly' in result.timing);
            assert.ok('preview' in result.timing);
            assert.ok('audio_synthesis' in result.timing);
        });
    });

    describe('TC-ORC-002: Bỏ qua bước tạo kịch bản khi đầu vào đã có sẵn Script', () => {
        it('phải sử dụng inputScript và đặt timing script_generation bằng 0', async () => {
            const progressUpdates: pipelineProgess[] = [];
            const jobDir = join(testTempDir, 'job-preset-script');

            const result = await runFullPipeline({
                request: validVideoRequest,
                script: sampleScript, // Đã có sẵn script
                outputDir: jobDir,
                skipPreview: true,
                onProgress: (p) => progressUpdates.push(p),
            });

            assert.strictEqual(result.timing['script_generation'], 0);
            assert.ok(
                progressUpdates.some((p) => p.message.includes('Sử dụng kịch bản đã có sẵn')),
                'Phải có thông báo sử dụng kịch bản có sẵn'
            );
        });
    });

    describe('TC-ORC-003: Chặn kịch bản vượt quá 150% thời lượng mục tiêu', () => {
        it('phải ném Error khi thời lượng ước tính vượt quá 150% targetDurationSec', async () => {
            // Target là 10 giây, nhưng 2 scene ước tính tối thiểu 2.5s * 2 = 5s
            // Tạo script có nhiều từ để thời lượng vượt 15 giây (10 * 1.5)
            const longTextScript: videoScript = {
                ...sampleScript,
                scenes: [
                    {
                        ...sampleScript.scenes[0],
                        voiceOverText:
                            'Một đoạn văn bản rất dài với vô số từ ngữ nhằm đẩy thời lượng ước lượng lên cao hơn nhiều lần so với ngưỡng cho phép của video ngắn mười giây. Càng nhiều từ thì thời lượng phát âm càng kéo dài.',
                    },
                    {
                        ...sampleScript.scenes[1],
                        voiceOverText:
                            'Đoạn văn thứ hai cũng tiếp tục kéo dài thời gian phát biểu để đảm bảo tổng thời lượng vượt xa một trăm năm mươi phần trăm ngưỡng thời lượng mục tiêu ban đầu.',
                    },
                ],
            };

            const strictRequest: videoRequest = {
                ...validVideoRequest,
                targetDurationSec: 10, // 150% là 15 giây
            };

            await assert.rejects(
                async () => {
                    await runFullPipeline({
                        request: strictRequest,
                        script: longTextScript,
                        outputDir: join(testTempDir, 'job-oversized'),
                        skipPreview: true,
                    });
                },
                /exceeds target \(10s\) by more than 50%/
            );
        });
    });

    describe('TC-ORC-004: Theo dõi tính liên tục và hợp lệ của Progress Callback', () => {
        it('phải phát ra các phase tuần tự với tiến trình từ 0 đến 100', async () => {
            const progressUpdates: pipelineProgess[] = [];
            const jobDir = join(testTempDir, 'job-progress');

            await runFullPipeline({
                request: validVideoRequest,
                script: sampleScript,
                outputDir: jobDir,
                skipPreview: true,
                onProgress: (p) => progressUpdates.push(p),
            });

            // Tất cả progress phải nằm trong khoảng [0, 100]
            for (const p of progressUpdates) {
                assert.ok(p.progress >= 0 && p.progress <= 100, `Progress ${p.progress} phải nằm trong [0, 100]`);
            }

            // Thứ tự các phase phải xuất hiện
            const phases = progressUpdates.map((p) => p.phase);
            assert.ok(phases.includes('script_generation'));
            assert.ok(phases.includes('estimate_duration'));
            assert.ok(phases.includes('html_assembly'));
            assert.ok(phases.includes('audio_synthesis'));
        });
    });

    describe('TC-ORC-005: Quản lý và làm sạch thư mục tạm cô lập', () => {
        it('phải tạo ra 2 jobId và 2 không gian làm việc độc lập', async () => {
            const jobDir1 = join(testTempDir, 'job-iso-1');
            const jobDir2 = join(testTempDir, 'job-iso-2');

            const res1 = await runFullPipeline({
                request: validVideoRequest,
                script: sampleScript,
                outputDir: jobDir1,
                skipPreview: true,
            });

            const res2 = await runFullPipeline({
                request: validVideoRequest,
                script: sampleScript,
                outputDir: jobDir2,
                skipPreview: true,
            });

            assert.notStrictEqual(res1.jobId, res2.jobId);
            assert.notStrictEqual(res1.workDir, res2.workDir);
            assert.ok(existsSync(res1.finalHtmlPath));
            assert.ok(existsSync(res2.finalHtmlPath));
        });
    });

    describe('TC-ORC-006: Xử lý ngoại lệ và ghi log khi bất kỳ phase nào thất bại', () => {
        it('phải bắt lỗi, ghi log "Pipeline failed" và ném ngoại lệ khi TTS gặp lỗi', async () => {
            mockTTS.shouldFail = true; // Kích hoạt lỗi TTS
            const progressUpdates: pipelineProgess[] = [];
            const jobDir = join(testTempDir, 'job-fail');

            await assert.rejects(
                async () => {
                    await runFullPipeline({
                        request: validVideoRequest,
                        script: sampleScript,
                        outputDir: jobDir,
                        skipPreview: true,
                        onProgress: (p) => progressUpdates.push(p),
                    });
                },
                /TTS Network Connection Error/
            );

            // Kiểm tra log ghi nhận lỗi
            assert.ok(
                progressUpdates.some((p) => p.message.includes('Pipeline failed: TTS Network Connection Error')),
                'onProgress phải ghi nhận thông báo Pipeline failed'
            );
        });
    });
});
