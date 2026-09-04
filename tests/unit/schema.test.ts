import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    videoRequestSchema,
    videoScriptSchema,
    sceneSchema,
    durationMapSchema,
    pipelineResultSchema,
} from '../../src/llm/schema.js';

describe('Module 2: Schemas & Validation Contracts (src/llm/schema.ts)', () => {
    describe('TC-SCH-001: Xác thực thành công videoRequestSchema', () => {
        it('phải parse thành công yêu cầu hợp lệ và gán giá trị mặc định cho language', () => {
            const input = {
                promt: 'Video giới thiệu trí tuệ nhân tạo thế hệ mới',
                aspectRatio: '16:9',
                targetDurationSec: 30,
                style: 'modern',
            };

            const result = videoRequestSchema.safeParse(input);

            assert.strictEqual(result.success, true);
            if (result.success) {
                assert.strictEqual(result.data.promt, input.promt);
                assert.strictEqual(result.data.aspectRatio, '16:9');
                assert.strictEqual(result.data.targetDurationSec, 30);
                assert.strictEqual(result.data.style, 'modern');
                assert.strictEqual(result.data.language, 'vi', 'language mặc định phải là vi');
                assert.strictEqual(result.data.customStyle, undefined);
            }
        });

        it('phải tự động ép kiểu chuỗi sang số cho targetDurationSec thông qua z.coerce', () => {
            const input = {
                promt: 'Hướng dẫn làm video tự động bằng công nghệ AI',
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
                        promt: 'Prompt kiểm tra tính hợp lệ của schema',
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
        it('phải từ chối khi promt quá ngắn (dưới 10 ký tự)', () => {
            const result = videoRequestSchema.safeParse({
                promt: 'ngắn',
                aspectRatio: '16:9',
                targetDurationSec: 30,
                style: 'modern',
            });

            assert.strictEqual(result.success, false);
            if (!result.success) {
                const issue = result.error.issues.find((i) => i.path.includes('promt'));
                assert.ok(issue, 'Phải có lỗi tại trường promt');
            }
        });

        it('phải từ chối khi targetDurationSec dưới 10 giây hoặc vượt quá 300 giây', () => {
            const underMinResult = videoRequestSchema.safeParse({
                promt: 'Prompt hợp lệ có độ dài trên 10 ký tự',
                aspectRatio: '16:9',
                targetDurationSec: 5,
                style: 'modern',
            });
            assert.strictEqual(underMinResult.success, false, 'Dưới 10s phải bị từ chối');

            const overMaxResult = videoRequestSchema.safeParse({
                promt: 'Prompt hợp lệ có độ dài trên 10 ký tự',
                aspectRatio: '16:9',
                targetDurationSec: 301,
                style: 'modern',
            });
            assert.strictEqual(overMaxResult.success, false, 'Vượt 300s phải bị từ chối');
        });

        it('phải từ chối khi aspectRatio không nằm trong danh sách hỗ trợ', () => {
            const result = videoRequestSchema.safeParse({
                promt: 'Prompt hợp lệ có độ dài trên 10 ký tự',
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
                promt: 'Prompt hợp lệ có độ dài trên 10 ký tự',
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

        it('phải từ chối khi promt hoặc customStyle vượt quá 5000 ký tự', () => {
            const oversizedText = 'a'.repeat(5001);

            const resultPromt = videoRequestSchema.safeParse({
                promt: oversizedText,
                aspectRatio: '16:9',
                targetDurationSec: 30,
                style: 'modern',
            });
            assert.strictEqual(resultPromt.success, false, 'promt vượt 5000 ký tự phải bị từ chối');

            const resultCustom = videoRequestSchema.safeParse({
                promt: 'Prompt hợp lệ có độ dài trên 10 ký tự',
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
});
