import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import {
    calculateSceneTimestamps,
    launchPreviewBrowser,
    loadAndPreparePage,
    seekToTimestamp,
    generatePreviews,
    captureScenePreview,
    previewScenes,
    generateScenePreviews,
} from '../../src/pipeline/preview.js';
import { assembleHTML } from '../../src/pipeline/assembleHtml.js';
import { type scene, type videoScript, type durationMap } from '../../src/llm/schema.js';

describe('Module 7: Playwright Thumbnail Preview (src/pipeline/preview.ts)', () => {
    let testTempDir: string;

    const mockScenes: scene[] = [
        {
            id: 'scene-1',
            title: 'Khởi đầu công nghệ',
            voiceOverText: 'Chào mừng các bạn',
            visualDescription: '',
            htmlCode: '<div class="intro"><h1>Scene 1</h1></div>',
            cssCode: '.intro { background: #111; color: #fff; width: 100%; height: 100%; }',
            jsCode: '',
            transition: 'none',
            backgroundColor: '#111111',
        },
        {
            id: 'scene-2',
            title: 'Nội dung cốt lõi',
            voiceOverText: 'Chi tiết nội dung',
            visualDescription: '',
            htmlCode: '<div class="content"><h1>Scene 2</h1></div>',
            cssCode: '.content { background: #222; color: #fff; width: 100%; height: 100%; }',
            jsCode: '',
            transition: 'fade',
            backgroundColor: '#222222',
        },
    ];

    const mockScript: videoScript = {
        id: 'script-prv-01',
        title: 'Video Preview Test',
        description: 'Test chụp thumbnail qua Playwright',
        globalStyles: 'body { margin: 0; }',
        globalSetupJs: '',
        scenes: mockScenes,
        colorPalette: {
            primary: '#ff0000',
            secondary: '#00ff00',
            accent: '#0000ff',
            background: '#000000',
            text: '#ffffff',
        },
        fontFamily: 'Inter',
    };

    const mockDurations: durationMap = {
        'scene-1': 4.0,
        'scene-2': 6.0,
    };

    beforeEach(() => {
        testTempDir = mkdtempSync(join(tmpdir(), 'preview-test-'));
    });

    afterEach(() => {
        if (existsSync(testTempDir)) {
            rmSync(testTempDir, { recursive: true, force: true });
        }
    });

    describe('TC-PRV-001: Thuật toán tính toán Timestamp trung điểm của từng Scene', () => {
        it('phải tính toán chính xác mốc targetTime trung điểm (ratio = 0.5)', () => {
            const timestamps = calculateSceneTimestamps(mockScenes, mockDurations, 0.5);

            assert.strictEqual(timestamps.length, 2);

            // Scene 1: từ 0s đến 4s -> trung điểm: 0 + 4 * 0.5 = 2.0s
            assert.strictEqual(timestamps[0].startTime, 0);
            assert.strictEqual(timestamps[0].duration, 4.0);
            assert.strictEqual(timestamps[0].targetTime, 2.0);

            // Scene 2: từ 4s đến 10s -> trung điểm: 4 + 6 * 0.5 = 7.0s
            assert.strictEqual(timestamps[1].startTime, 4.0);
            assert.strictEqual(timestamps[1].duration, 6.0);
            assert.strictEqual(timestamps[1].targetTime, 7.0);
        });

        it('phải giới hạn ratio an toàn trong khoảng [0.1, 0.9] khi truyền tham số biên', () => {
            // Khi truyền ratio < 0.1 (ví dụ 0.0), hàm phải clamp lên 0.1
            const lowClamp = calculateSceneTimestamps(mockScenes, mockDurations, 0.0);
            assert.strictEqual(lowClamp[0].targetTime, 0.4); // 0 + 4 * 0.1 = 0.4s

            // Khi truyền ratio > 0.9 (ví dụ 1.0), hàm phải clamp xuống 0.9
            const highClamp = calculateSceneTimestamps(mockScenes, mockDurations, 1.0);
            assert.strictEqual(highClamp[0].targetTime, 3.6); // 0 + 4 * 0.9 = 3.6s
        });

        it('phải đảm bảo targetTime không vượt quá startTime + duration - 0.05', () => {
            const shortScene: scene[] = [
                {
                    ...mockScenes[0],
                    id: 'short-sc',
                },
            ];
            const shortDurations: durationMap = { 'short-sc': 0.1 };
            const result = calculateSceneTimestamps(shortScene, shortDurations, 0.9);

            assert.ok(result[0].targetTime <= 0.05 + 0.001);
        });
    });

    describe('TC-PRV-002: Khởi tạo Headless Chromium an toàn', () => {
        it('phải khởi tạo và đóng browser thành công mà không gây lỗi', async () => {
            const browser = await launchPreviewBrowser();
            assert.ok(browser.isConnected(), 'Chromium phải ở trạng thái kết nối');
            await browser.close();
            assert.strictEqual(browser.isConnected(), false, 'Chromium phải được đóng thành công');
        });
    });

    describe('TC-PRV-003: Chờ tín hiệu đồng bộ window.__ready', () => {
        it('phải ném Error khi đường dẫn file HTML không tồn tại', async () => {
            const browser = await launchPreviewBrowser();
            const page = await browser.newPage();

            try {
                await assert.rejects(
                    async () => {
                        await loadAndPreparePage(page, join(testTempDir, 'non-existent.html'), 640, 360, 2000);
                    },
                    /HTML file not found at/
                );
            } finally {
                await page.close();
                await browser.close();
            }
        });

        it('phải nạp thành công trang HTML có hợp đồng window.__ready = true', async () => {
            const dummyHtmlPath = join(testTempDir, 'ready_test.html');
            writeFileSync(
                dummyHtmlPath,
                '<!DOCTYPE html><html><body><h1>Ready Test</h1><script>window.__ready = true;</script></body></html>',
                'utf-8'
            );

            const browser = await launchPreviewBrowser();
            const page = await browser.newPage();

            try {
                await loadAndPreparePage(page, dummyHtmlPath, 640, 360, 5000);
                const isReady = await page.evaluate(() => (window as any).__ready);
                assert.strictEqual(isReady, true);
            } finally {
                await page.close();
                await browser.close();
            }
        });
    });

    describe('TC-PRV-004 & TC-PRV-005: Tạo Thumbnail bằng generatePreviews', () => {
        let assembledHtmlPath: string;

        beforeEach(async () => {
            const res = await assembleHTML(mockScript, mockDurations, 640, 360, testTempDir);
            assembledHtmlPath = res.htmlPath;
        });

        it('phải chụp thành công thumbnail dạng WebP cho tất cả các scene', async () => {
            const progressLogs: string[] = [];
            const result = await generatePreviews({
                htmlPath: assembledHtmlPath,
                script: mockScript,
                durations: mockDurations,
                width: 640,
                height: 360,
                format: 'webp',
                onProgress: (msg) => progressLogs.push(msg),
            });

            assert.strictEqual(result.totalScenes, 2);
            assert.strictEqual(result.durationSec, 10.0);
            assert.strictEqual(result.previews.length, 2);

            // Kiểm tra từng file ảnh
            for (const preview of result.previews) {
                assert.ok(existsSync(preview.imagePath), `File ảnh ${preview.fileName} phải tồn tại`);
                assert.strictEqual(preview.fileName.endsWith('.webp'), true);
                assert.ok(preview.timeSec > 0);
            }

            assert.strictEqual(result.previews[0].sceneId, 'scene-1');
            assert.strictEqual(result.previews[0].timeSec, 2.0);
            assert.strictEqual(result.previews[1].sceneId, 'scene-2');
            assert.strictEqual(result.previews[1].timeSec, 7.0);

            // Kiểm tra log tiến trình
            assert.ok(progressLogs.some((l) => /Chromium/i.test(l)));
            assert.ok(progressLogs.some((l) => /thumbnails/i.test(l)));
        });

        it('phải tạo Base64 Data URI khi tùy chọn includeDataUri = true', async () => {
            const result = await generatePreviews({
                htmlPath: assembledHtmlPath,
                script: mockScript,
                durations: mockDurations,
                width: 640,
                height: 360,
                format: 'webp',
                includeDataUri: true,
            });

            for (const preview of result.previews) {
                assert.ok(preview.dataUri, 'dataUri phải có giá trị');
                assert.match(preview.dataUri, /^data:image\/webp;base64,/);
            }
        });
    });

    describe('TC-PRV-006: Giải phóng tài nguyên khi gặp sự cố', () => {
        it('phải ném Error và không làm treo process khi file HTML không tồn tại', async () => {
            const badHtmlPath = join(testTempDir, 'missing_file.html');

            await assert.rejects(
                async () => {
                    await generatePreviews({
                        htmlPath: badHtmlPath,
                        script: mockScript,
                        durations: mockDurations,
                        width: 640,
                        height: 360,
                        timeoutMs: 3000,
                    });
                },
                /Preview generation failed/
            );
        });
    });

    describe('Single Scene Capture & Aliases', () => {
        it('phải chụp thành công một mốc thời gian đơn lẻ qua captureScenePreview', async () => {
            const res = await assembleHTML(mockScript, mockDurations, 640, 360, testTempDir);
            const singleOut = join(testTempDir, 'single_capture.png');

            const captureResult = await captureScenePreview({
                htmlPath: res.htmlPath,
                timeSec: 3.5,
                outputPath: singleOut,
                width: 640,
                height: 360,
                format: 'png',
            });

            assert.strictEqual(captureResult.imagePath, singleOut);
            assert.strictEqual(captureResult.timeSec, 3.5);
            assert.ok(existsSync(singleOut), 'File ảnh capture đơn lẻ phải tồn tại');
        });

        it('phải đồng nhất giữa các alias hàm previewScenes và generateScenePreviews', () => {
            assert.strictEqual(previewScenes, generatePreviews);
            assert.strictEqual(generateScenePreviews, generatePreviews);
        });
    });
});
