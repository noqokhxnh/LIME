import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import {
    processSceneCode,
    assembleHTML,
    assembleHtml,
    assembleCode,
    DEFAULT_TRANSPARENT_GIF,
    GSAP_CDN,
    GSAP_TEXT_PLUGIN_CDN,
    GSAP_MOTION_PATH_PLUGIN_CDN,
    STICKMAN_HELPERS_JS,
    BLOCK_HELPERS_JS,
} from '../../src/pipeline/assembleHtml.js';
import { type scene, type videoScript } from '../../src/llm/schema.js';

describe('Module 6: HTML & GSAP Packaging (src/pipeline/assembleHtml.ts)', () => {
    let testTempDir: string;

    const mockScene: scene = {
        id: 'scene-1',
        title: 'Scene Tiêu Đề',
        voiceOverText: 'Lời dẫn cho scene 1',
        visualDescription: 'Mô tả hình ảnh',
        htmlCode: '<h1 class="title">Xin Chào</h1>',
        cssCode: '.title { color: #fff; }',
        jsCode: 'tl.to(".title", { duration: {{SCENE_DURATION}} * 0.5, opacity: 1 });',
        transition: 'fade',
        backgroundColor: '#123456',
    };

    const mockScript: videoScript = {
        id: 'script-asm-01',
        title: 'Video Demo HTML Assembler',
        description: 'Test đóng gói mã nguồn HTML độc lập',
        globalStyles: '.global-box { display: flex; }',
        globalSetupJs: 'console.log("Global timeline initialized");',
        scenes: [
            mockScene,
            {
                id: 'scene-2',
                title: 'Scene Kế Tiếp',
                voiceOverText: 'Lời dẫn cho scene 2',
                visualDescription: 'Mô tả hình ảnh 2',
                htmlCode: '<div class="scene" id="scene-2"><p>Nội dung 2</p></div>',
                cssCode: 'p { font-size: 20px; }',
                jsCode: 'tl.to("#scene-2 p", { duration: {{SCENE_scene-2_DURATION}}, x: 100 });',
                transition: 'slide-left',
                backgroundColor: '#654321',
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

    const sampleDurations = {
        'scene-1': 4.5,
        'scene-2': 3.2,
    };

    beforeEach(() => {
        testTempDir = mkdtempSync(join(tmpdir(), 'asm-test-'));
    });

    afterEach(() => {
        if (existsSync(testTempDir)) {
            rmSync(testTempDir, { recursive: true, force: true });
        }
    });

    describe('TC-ASM-001: Thay thế placeholder {{SCENE_DURATION}} chuẩn xác', () => {
        it('phải thay thế {{SCENE_DURATION}} bằng định dạng số làm tròn 2 chữ số thập phân', () => {
            const result = processSceneCode(mockScene, 4.5);

            assert.doesNotMatch(result.js, /\{\{SCENE_DURATION\}\}/);
            assert.match(result.js, /duration: 4\.50 \* 0\.5/);
        });

        it('phải thay thế token định danh riêng {{SCENE_<id>_DURATION}}', () => {
            const customScene: scene = {
                ...mockScene,
                id: 'intro_scene',
                jsCode: 'gsap.to(".logo", { duration: {{SCENE_intro_scene_DURATION}} });',
            };

            const result = processSceneCode(customScene, 2.75);
            assert.doesNotMatch(result.js, /\{\{SCENE_intro_scene_DURATION\}\}/);
            assert.match(result.js, /duration: 2\.75/);
        });
    });

    describe('TC-ASM-002: Thay thế các token hình ảnh và Fallback Transparent GIF', () => {
        it('phải thay thế token hình ảnh bằng URL thực tế khi có trong mảng imageUrls', () => {
            const sceneWithImages: scene = {
                ...mockScene,
                htmlCode: '<img src="{{SCENE_IMAGE_1}}"><img src="{{SCENE_IMAGE_2}}">',
                cssCode: '.banner { background-image: url("{{SCENE_IMAGE}}"); }',
            };

            const images = ['https://example.com/photo1.jpg', 'https://example.com/photo2.jpg'];
            const result = processSceneCode(sceneWithImages, 3.0, images);

            assert.match(result.html, /src="https:\/\/example\.com\/photo1\.jpg"/);
            assert.match(result.html, /src="https:\/\/example\.com\/photo2\.jpg"/);
            assert.match(result.css, /url\("https:\/\/example\.com\/photo1\.jpg"\)/);
        });

        it('phải dùng DEFAULT_TRANSPARENT_GIF làm fallback khi không có hình ảnh được cung cấp', () => {
            const sceneWithImages: scene = {
                ...mockScene,
                htmlCode: '<img src="{{SCENE_IMAGE_1}}"><img src="{{SCENE_IMAGE_2}}"><img src="{{SCENE_IMAGE_3}}">',
            };

            // Chỉ cung cấp 1 ảnh, ảnh 2 và 3 phải dùng Transparent GIF fallback
            const images = ['https://example.com/only-one.png'];
            const result = processSceneCode(sceneWithImages, 3.0, images);

            assert.match(result.html, /src="https:\/\/example\.com\/only-one\.png"/);
            assert.ok(result.html.includes(DEFAULT_TRANSPARENT_GIF), 'Phải nhúng chuỗi Base64 GIF trong suốt');
        });
    });

    describe('TC-ASM-003: Tự động bọc Scene Container nếu thiếu ID', () => {
        it('phải bọc container <div class="scene" id="..."> khi htmlCode chưa có container', () => {
            const bareScene: scene = {
                ...mockScene,
                id: 'bare-scene-123',
                backgroundColor: '#abcdef',
                htmlCode: '<h1>Nội dung không có container</h1>',
            };

            const result = processSceneCode(bareScene, 3.0);

            assert.match(result.html, /<div class="scene" id="bare-scene-123"/);
            assert.match(result.html, /background-color: #abcdef/);
            assert.match(result.html, /<h1>Nội dung không có container<\/h1>/);
        });

        it('không được bọc thêm container nếu htmlCode đã có sẵn id của scene', () => {
            const preWrappedScene: scene = {
                ...mockScene,
                id: 'pre-wrapped',
                htmlCode: '<div class="scene" id="pre-wrapped"><p>Đã có sẵn</p></div>',
            };

            const result = processSceneCode(preWrappedScene, 3.0);

            // Kiểm tra chỉ xuất hiện đúng 1 lần id="pre-wrapped"
            const matches = result.html.match(/id="pre-wrapped"/g);
            assert.strictEqual(matches?.length, 1);
        });
    });

    describe('TC-ASM-004: Kiểm tra việc nhúng đầy đủ thư viện CDN và Font', () => {
        it('phải chứa thẻ liên kết Google Fonts và 3 thư viện GSAP CDN mặc định', async () => {
            const result = await assembleHTML(mockScript, sampleDurations, 1920, 1080, testTempDir);
            const content = result.htmlContent;

            assert.match(content, /fonts\.googleapis\.com\/css2\?family=Inter/);
            assert.ok(content.includes(GSAP_CDN), 'Phải có GSAP Core CDN');
            assert.ok(content.includes(GSAP_TEXT_PLUGIN_CDN), 'Phải có GSAP TextPlugin CDN');
            assert.ok(content.includes(GSAP_MOTION_PATH_PLUGIN_CDN), 'Phải có GSAP MotionPathPlugin CDN');
        });

        it('phải tôn trọng các đường dẫn CDN tùy chỉnh khi được truyền vào options', async () => {
            const customCdn = {
                gsap: 'https://cdn.custom.com/gsap.js',
                textPlugin: 'https://cdn.custom.com/TextPlugin.js',
                motionPathPlugin: 'https://cdn.custom.com/MotionPathPlugin.js',
            };

            const result = await assembleHTML(mockScript, sampleDurations, 1920, 1080, testTempDir, undefined, {
                customCdn,
            });

            assert.ok(result.htmlContent.includes(customCdn.gsap));
            assert.ok(result.htmlContent.includes(customCdn.textPlugin));
            assert.ok(result.htmlContent.includes(customCdn.motionPathPlugin));
        });
    });

    describe('TC-ASM-005: Kiểm tra Hợp đồng Renderer (Renderer Contract Plumbing)', () => {
        it('phải chứa đầy đủ các đối tượng và phương thức điều khiển timeline phục vụ Playwright', async () => {
            const result = await assembleHTML(mockScript, sampleDurations, 1920, 1080, testTempDir);
            const content = result.htmlContent;

            // Biến contract bắt buộc
            assert.match(content, /window\.__ready = false;/);
            assert.match(content, /window\.__masterTimeline = gsap\.timeline\(\{ paused: true \}\);/);
            assert.match(content, /window\.__sceneTimelines = \{\};/);
            assert.match(content, /window\.__sceneDurations = \{\};/);
            assert.match(content, /window\.__totalDuration = 0;/);

            // Hàm contract bắt buộc
            assert.match(content, /window\.__registerScene = function/);
            assert.match(content, /window\.__seekTo = function/);
            assert.match(content, /window\.__getTotalDuration = function/);
            assert.match(content, /window\.__splitTextChars = function/);
            assert.match(content, /window\.__splitTextWords = function/);
            assert.match(content, /window\.__rand = function/);

            // Tín hiệu kết thúc sẵn sàng ở cuối script
            assert.match(content, /window\.__ready = true;\s*<\/script>/);
        });
    });

    describe('TC-ASM-006: Kiểm tra việc nạp Stickman Helpers và Comic FX Helpers', () => {
        it('phải nhúng mã STICKMAN_HELPERS_JS với đầy đủ window.__sm và window.__fx', async () => {
            const result = await assembleHTML(mockScript, sampleDurations, 1920, 1080, testTempDir);
            const content = result.htmlContent;

            assert.ok(content.includes('window.__sm = function'), 'Phải chứa window.__sm');
            assert.ok(content.includes('window.__fx = function'), 'Phải chứa window.__fx');
            assert.ok(content.includes('stickman-svg'), 'Phải có template SVG stickman');
            assert.ok(content.includes("type === 'sweat'"), 'Phải hỗ trợ hiệu ứng sweat');
            assert.ok(content.includes("type === 'shock'"), 'Phải hỗ trợ hiệu ứng shock');
            assert.ok(content.includes("type === 'question'"), 'Phải hỗ trợ hiệu ứng question');
        });
    });

    describe('TC-ASM-006b: Motion Blocks helpers (window.__block)', () => {
        it('phải nhúng BLOCK_HELPERS_JS với 5 core blocks', async () => {
            const result = await assembleHTML(mockScript, sampleDurations, 1920, 1080, testTempDir);
            const content = result.htmlContent;

            assert.ok(content.includes('window.__block = function'), 'Phải chứa window.__block');
            assert.ok(content.includes('__block.animate'), 'Phải chứa __block.animate');
            assert.ok(BLOCK_HELPERS_JS.length > 100, 'BLOCK_HELPERS_JS export phải có nội dung');
            for (const id of ['kinetic-type', 'code-diff', 'bar-chart', 'device-showcase', 'chat-exchange']) {
                assert.ok(content.includes(id), `HTML phải chứa block ${id}`);
            }
        });
    });

    describe('TC-ASM-007: Xuất file HTML độc lập vào thư mục làm việc (WorkDir)', () => {
        it('phải ghi file index.html vật lý ra đĩa với kích thước lớn hơn 0 bytes', async () => {
            const progressLogs: string[] = [];
            const result = await assembleHTML(
                mockScript,
                sampleDurations,
                1920,
                1080,
                testTempDir,
                (msg) => progressLogs.push(msg)
            );

            assert.strictEqual(result.htmlPath, join(testTempDir, 'index.html'));
            assert.ok(existsSync(result.htmlPath), 'File index.html phải tồn tại trên đĩa');

            const fileDiskContent = readFileSync(result.htmlPath, 'utf-8');
            assert.strictEqual(fileDiskContent, result.htmlContent);
            assert.ok(fileDiskContent.length > 500, 'Dung lượng file HTML phải có ý nghĩa');

            // Kiểm tra callback onProgress
            assert.ok(progressLogs.some((l) => l.includes('Bắt đầu đóng gói')));
            assert.ok(progressLogs.some((l) => l.includes('Đã tạo file HTML')));
        });

        it('phải đồng nhất giữa các alias hàm assembleHtml và assembleCode', () => {
            assert.strictEqual(assembleHtml, assembleHTML);
            assert.strictEqual(assembleCode, assembleHTML);
        });
    });
});
