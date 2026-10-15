import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    videoRequestSchema,
    videoScriptSchema,
    sceneSchema,
    durationMapSchema,
    pipelineResultSchema,
    watermarkPositionSchema,
    watermarkConfigSchema,
} from '../../src/llm/schema.js';

describe('Module 2: Schemas & Validation Contracts (src/llm/schema.ts)', () => {
    describe('TC-SCH-001: Xác thực thành công videoRequestSchema', () => {
        it('phải parse thành công yêu cầu hợp lệ và gán giá trị mặc định cho language', () => {
            const input = {
                prompt: 'Video giới thiệu trí tuệ nhân tạo thế hệ mới',
                aspectRatio: '16:9',
                targetDurationSec: 30,
                style: 'modern',
            };

            const result = videoRequestSchema.safeParse(input);

            assert.strictEqual(result.success, true);
            if (result.success) {
                assert.strictEqual(result.data.prompt, input.prompt);
                assert.strictEqual(result.data.aspectRatio, '16:9');
                assert.strictEqual(result.data.targetDurationSec, 30);
                assert.strictEqual(result.data.style, 'modern');
                assert.strictEqual(result.data.language, 'vi', 'language mặc định phải là vi');
                assert.strictEqual(result.data.customStyle, undefined);
            }
        });

        it('phải tự động ép kiểu chuỗi sang số cho targetDurationSec thông qua z.coerce', () => {
            const input = {
                prompt: 'Hướng dẫn làm video tự động bằng công nghệ AI',
                aspectRatio: '9:16',
                targetDurationSec: '45',
                language: 'en',
                style: 'classic',
                customStyle: 'Minimalist flat design with dark theme',
            };

            const result = videoRequestSchema.safeParse(input);

            assert.strictEqual(result.success, true);
            if (result.success) {
                assert.strictEqual(result.data.targetDurationSec, 45);
                assert.strictEqual(result.data.language, 'en');
                assert.strictEqual(result.data.customStyle, input.customStyle);
            }
        });

        it('phải chấp nhận tất cả các tỷ lệ khung hình và phong cách được định nghĩa', () => {
            const validAspectRatios = ['16:9', '9:16', '1:1', '4:3'] as const;
            const validStyles = ['modern', 'classic', 'stickman'] as const;

            for (const aspectRatio of validAspectRatios) {
                for (const style of validStyles) {
                    const result = videoRequestSchema.safeParse({
                        prompt: 'Prompt kiểm tra tính hợp lệ của schema',
                        aspectRatio,
                        targetDurationSec: 20,
                        style,
                    });
                    assert.strictEqual(
                        result.success,
                        true,
                        `Phải chấp nhận aspectRatio: ${aspectRatio} và style: ${style}`
                    );
                }
            }
        });
    });

    describe('TC-SCH-002: Bắt lỗi chặn các ràng buộc của videoRequestSchema', () => {
        it('phải từ chối khi prompt quá ngắn (dưới 10 ký tự)', () => {
            const result = videoRequestSchema.safeParse({
                prompt: 'ngắn',
                aspectRatio: '16:9',
                targetDurationSec: 30,
                style: 'modern',
            });

            assert.strictEqual(result.success, false);
            if (!result.success) {
                const issue = result.error.issues.find((i) => i.path.includes('prompt'));
                assert.ok(issue, 'Phải có lỗi tại trường prompt');
            }
        });

        it('phải từ chối khi targetDurationSec dưới 10 giây hoặc vượt quá 300 giây', () => {
            const underMinResult = videoRequestSchema.safeParse({
                prompt: 'Prompt hợp lệ có độ dài trên 10 ký tự',
                aspectRatio: '16:9',
                targetDurationSec: 5,
                style: 'modern',
            });
            assert.strictEqual(underMinResult.success, false, 'Dưới 10s phải bị từ chối');

            const overMaxResult = videoRequestSchema.safeParse({
                prompt: 'Prompt hợp lệ có độ dài trên 10 ký tự',
                aspectRatio: '16:9',
                targetDurationSec: 301,
                style: 'modern',
            });
            assert.strictEqual(overMaxResult.success, false, 'Vượt 300s phải bị từ chối');
        });

        it('phải từ chối khi aspectRatio không nằm trong danh sách hỗ trợ', () => {
            const result = videoRequestSchema.safeParse({
                prompt: 'Prompt hợp lệ có độ dài trên 10 ký tự',
                aspectRatio: '21:9',
                targetDurationSec: 30,
                style: 'modern',
            });

            assert.strictEqual(result.success, false);
            if (!result.success) {
                const issue = result.error.issues.find((i) => i.path.includes('aspectRatio'));
                assert.ok(issue, 'Phải có lỗi tại trường aspectRatio');
            }
        });

        it('phải từ chối khi style không nằm trong enum', () => {
            const result = videoRequestSchema.safeParse({
                prompt: 'Prompt hợp lệ có độ dài trên 10 ký tự',
                aspectRatio: '16:9',
                targetDurationSec: 30,
                style: 'anime',
            });

            assert.strictEqual(result.success, false);
            if (!result.success) {
                const issue = result.error.issues.find((i) => i.path.includes('style'));
                assert.ok(issue, 'Phải có lỗi tại trường style');
            }
        });

        it('phải từ chối khi prompt hoặc customStyle vượt quá 5000 ký tự', () => {
            const oversizedText = 'a'.repeat(5001);

            const resultprompt = videoRequestSchema.safeParse({
                prompt: oversizedText,
                aspectRatio: '16:9',
                targetDurationSec: 30,
                style: 'modern',
            });
            assert.strictEqual(resultprompt.success, false, 'prompt vượt 5000 ký tự phải bị từ chối');

            const resultCustom = videoRequestSchema.safeParse({
                prompt: 'Prompt hợp lệ có độ dài trên 10 ký tự',
                aspectRatio: '16:9',
                targetDurationSec: 30,
                style: 'modern',
                customStyle: oversizedText,
            });
            assert.strictEqual(resultCustom.success, false, 'customStyle vượt 5000 ký tự phải bị từ chối');
        });
    });

    describe('TC-SCH-003: Xác thực cấu trúc kịch bản đầy đủ với videoScriptSchema và sceneSchema', () => {
        const mockScene = {
            id: 'scene-1',
            title: 'Mở đầu ấn tượng',
            voiceOverText: 'Chào mừng các bạn đến với video hướng dẫn tạo nội dung bằng AI.',
            visualDescription: 'Chữ xuất hiện mượt mà cùng hiệu ứng hạt sáng.',
            htmlCode: '<div class="intro"><h1>Hello World</h1></div>',
            cssCode: '.intro { display: flex; justify-content: center; }',
            jsCode: 'gsap.from(".intro h1", { opacity: 0, y: 50, duration: 1 });',
            transition: 'fade' as const,
        };

        const mockScript = {
            id: 'vid-script-001',
            title: 'Giới thiệu HTML-to-Vid',
            description: 'Video demo quy trình chuyển HTML animation thành video chất lượng cao.',
            globalStyles: 'body { margin: 0; background: #0f172a; }',
            globalSetupJs: 'console.log("Global setup initialized");',
            scenes: [mockScene],
            boundaries: [],
            colorPalette: {
                primary: '#3b82f6',
                secondary: '#1d4ed8',
                accent: '#f59e0b',
                background: '#0f172a',
                text: '#ffffff',
            },
        };

        it('phải parse thành công scene hợp lệ và tự động gán backgroundColor mặc định là #000000', () => {
            const result = sceneSchema.safeParse(mockScene);

            assert.strictEqual(result.success, true);
            if (result.success) {
                assert.strictEqual(result.data.backgroundColor, '#000000', 'backgroundColor mặc định phải là #000000');
                assert.strictEqual(result.data.transition, 'fade');
            }
        });

        it('phải chấp nhận tất cả các kiểu transition trong sceneSchema', () => {
            const validTransitions = [
                'fade',
                'slide-left',
                'slide-right',
                'slide-up',
                'zoom-in',
                'zoom-out',
                'none',
            ] as const;

            for (const transition of validTransitions) {
                const result = sceneSchema.safeParse({
                    ...mockScene,
                    transition,
                });
                assert.strictEqual(result.success, true, `Transition ${transition} phải hợp lệ`);
            }
        });

        it('phải từ chối scene khi transition không hợp lệ hoặc thiếu trường bắt buộc', () => {
            const invalidTransition = sceneSchema.safeParse({
                ...mockScene,
                transition: 'flip-3d',
            });
            assert.strictEqual(invalidTransition.success, false, 'Transition không nằm trong enum phải thất bại');

            const missingVoiceOver = sceneSchema.safeParse({
                ...mockScene,
                voiceOverText: undefined,
            });
            assert.strictEqual(missingVoiceOver.success, false, 'Thiếu voiceOverText phải thất bại');
        });

        it('phải parse thành công videoScriptSchema và gán fontFamily mặc định là Inter', () => {
            const result = videoScriptSchema.safeParse(mockScript);

            assert.strictEqual(result.success, true);
            if (result.success) {
                assert.strictEqual(result.data.fontFamily, 'Inter', 'fontFamily mặc định phải là Inter');
                assert.strictEqual(result.data.scenes.length, 1);
                assert.strictEqual(result.data.colorPalette.primary, '#3b82f6');
            }
        });

        it('phải giữ nguyên fontFamily tùy chỉnh nếu được cung cấp', () => {
            const result = videoScriptSchema.safeParse({
                ...mockScript,
                fontFamily: 'Roboto',
            });

            assert.strictEqual(result.success, true);
            if (result.success) {
                assert.strictEqual(result.data.fontFamily, 'Roboto');
            }
        });

        it('phải từ chối videoScriptSchema khi thiếu trường trong colorPalette', () => {
            const invalidPaletteScript = {
                ...mockScript,
                colorPalette: {
                    primary: '#3b82f6',
                    // thiếu secondary, accent, background, text
                },
            };

            const result = videoScriptSchema.safeParse(invalidPaletteScript);
            assert.strictEqual(result.success, false, 'colorPalette thiếu trường phải bị từ chối');
        });
    });

    describe('TC-SCH-004: Xác thực durationMapSchema và pipelineResultSchema', () => {
        it('phải parse thành công durationMapSchema với cấu trúc key là chuỗi và value là số', () => {
            const validMap = {
                'scene-1': 4.5,
                'scene-2': 3.2,
                'scene-3': 5.0,
            };

            const result = durationMapSchema.safeParse(validMap);
            assert.strictEqual(result.success, true);
            if (result.success) {
                assert.strictEqual(result.data['scene-1'], 4.5);
                assert.strictEqual(result.data['scene-2'], 3.2);
            }
        });

        it('phải từ chối durationMapSchema khi value không phải là số', () => {
            const invalidMap = {
                'scene-1': 'bốn chấm năm',
            };

            const result = durationMapSchema.safeParse(invalidMap);
            assert.strictEqual(result.success, false);
        });

        it('phải parse thành công pipelineResultSchema với dữ liệu chuẩn', () => {
            const validResult = {
                videoPath: '/tmp/job-123/output.mp4',
                durationSec: 25.4,
                resolution: '1920x1080',
                scences: [
                    {
                        id: 'scene-1',
                        title: 'Mở đầu',
                        voiceOverText: 'Chào mừng các bạn.',
                        visualDescription: 'Intro scene',
                        htmlCode: '<div>Hi</div>',
                        cssCode: 'div { color: red; }',
                        jsCode: 'console.log(1);',
                        transition: 'fade',
                    },
                ],
            };

            const result = pipelineResultSchema.safeParse(validResult);
            assert.strictEqual(result.success, true);
            if (result.success) {
                assert.strictEqual(result.data.videoPath, '/tmp/job-123/output.mp4');
                assert.strictEqual(result.data.durationSec, 25.4);
                assert.strictEqual(result.data.scences.length, 1);
                assert.strictEqual(result.data.scences[0].backgroundColor, '#000000');
            }
        });

        it('phải từ chối pipelineResultSchema khi thiếu các trường bắt buộc', () => {
            const invalidResult = {
                videoPath: '/tmp/job-123/output.mp4',
                // thiếu durationSec, resolution, scences
            };

            const result = pipelineResultSchema.safeParse(invalidResult);
            assert.strictEqual(result.success, false);
        });
    });

    describe('TC-SCH-005: Xác thực watermarkConfigSchema và watermarkPositionSchema', () => {
        // Kiểm tra xem khi người dùng chỉ cung cấp đường dẫn ảnh thì hệ thống có tự gán các giá trị mặc định hợp lý không
        it('phải parse thành công watermark với các giá trị mặc định khi chỉ truyền logoPath', () => {
            const input = {
                logoPath: '/uploads/logos/brand-123.png',
            };

            const result = watermarkConfigSchema.safeParse(input);
            assert.strictEqual(result.success, true);
            if (result.success) {
                assert.strictEqual(result.data.logoPath, input.logoPath);
                assert.strictEqual(result.data.position, 'top-right', 'Vị trí mặc định phải là top-right (Góc trên - Phải)');
                assert.strictEqual(result.data.scalePercent, 15, 'Kích thước mặc định phải là 15% bề ngang video');
                assert.strictEqual(result.data.opacity, 0.8, 'Độ mờ đục mặc định phải là 0.8 (rõ nét 80%)');
            }
        });

        // Kiểm tra tính hợp lệ của tất cả 4 góc định sẵn và chế độ tự do (custom) theo tọa độ x%, y%
        it('phải chấp nhận tất cả 4 góc vị trí và vị trí custom với tọa độ xPercent, yPercent', () => {
            const validPositions = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;

            // Đảm bảo 4 góc đều được schema chấp thuận
            for (const position of validPositions) {
                const res = watermarkPositionSchema.safeParse(position);
                assert.strictEqual(res.success, true, `Vị trí ${position} phải hợp lệ`);
            }

            // Kiểm tra cấu hình vị trí tự do (custom)
            const customWatermark = {
                logoPath: 'uploads/logos/custom.svg',
                position: 'custom',
                xPercent: 80,
                yPercent: 10,
                scalePercent: 25,
                opacity: 0.5,
            };

            const result = watermarkConfigSchema.safeParse(customWatermark);
            assert.strictEqual(result.success, true);
            if (result.success) {
                assert.strictEqual(result.data.position, 'custom');
                assert.strictEqual(result.data.xPercent, 80);
                assert.strictEqual(result.data.yPercent, 10);
                assert.strictEqual(result.data.scalePercent, 25);
                assert.strictEqual(result.data.opacity, 0.5);
            }
        });

        // Kiểm tra việc chặn các dữ liệu sai: logoPath rỗng hoặc position không nằm trong danh sách
        it('phải từ chối logoPath rỗng hoặc position không hợp lệ', () => {
            const emptyPath = watermarkConfigSchema.safeParse({ logoPath: '' });
            assert.strictEqual(emptyPath.success, false, 'logoPath rỗng phải bị từ chối');

            const invalidPos = watermarkConfigSchema.safeParse({
                logoPath: 'logo.png',
                position: 'middle-center', // Vị trí không tồn tại
            });
            assert.strictEqual(invalidPos.success, false, 'Vị trí ngoài danh sách phải bị từ chối');
        });

        // Kiểm tra việc chặn các giá trị nằm ngoài giới hạn an toàn: scale (5% - 50%) và opacity (0.1 - 1.0)
        it('phải từ chối scalePercent hoặc opacity nằm ngoài khoảng cho phép', () => {
            // Trường hợp 1: scale quá nhỏ (< 5%)
            const underMinScale = watermarkConfigSchema.safeParse({
                logoPath: 'logo.png',
                scalePercent: 2,
            });
            assert.strictEqual(underMinScale.success, false, 'scalePercent < 5% phải bị từ chối');

            // Trường hợp 2: scale quá to (> 50%)
            const overMaxScale = watermarkConfigSchema.safeParse({
                logoPath: 'logo.png',
                scalePercent: 60,
            });
            assert.strictEqual(overMaxScale.success, false, 'scalePercent > 50% phải bị từ chối');

            // Trường hợp 3: opacity quá mờ (< 0.1)
            const underMinOpacity = watermarkConfigSchema.safeParse({
                logoPath: 'logo.png',
                opacity: 0.05,
            });
            assert.strictEqual(underMinOpacity.success, false, 'opacity < 0.1 phải bị từ chối');

            // Trường hợp 4: opacity vượt quá 1.0 (> 100%)
            const overMaxOpacity = watermarkConfigSchema.safeParse({
                logoPath: 'logo.png',
                opacity: 1.5,
            });
            assert.strictEqual(overMaxOpacity.success, false, 'opacity > 1.0 phải bị từ chối');
        });

        // Kiểm tra việc tích hợp cấu hình watermark vào yêu cầu tạo video tổng thể (videoRequestSchema)
        it('phải parse thành công videoRequestSchema có chứa cấu hình watermark', () => {
            const requestWithWatermark = {
                prompt: 'Video giới thiệu sản phẩm mới với logo công ty',
                aspectRatio: '16:9',
                targetDurationSec: 30,
                style: 'modern',
                watermark: {
                    logoPath: 'uploads/logos/brand.png',
                    position: 'top-left',
                    scalePercent: 20,
                    opacity: 0.9,
                },
            };

            const result = videoRequestSchema.safeParse(requestWithWatermark);
            assert.strictEqual(result.success, true);
            if (result.success) {
                assert.ok(result.data.watermark, 'Trường watermark phải tồn tại trong request');
                assert.strictEqual(result.data.watermark?.logoPath, 'uploads/logos/brand.png');
                assert.strictEqual(result.data.watermark?.position, 'top-left');
                assert.strictEqual(result.data.watermark?.scalePercent, 20);
                assert.strictEqual(result.data.watermark?.opacity, 0.9);
            }
        });
    });
});
