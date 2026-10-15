import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    videoScriptSchema,
    boundarySchema,
    mechanismSchema,
    checkRhythm,
    type videoScript,
} from '../../src/llm/schema.js';
import { validateScript, formatZodIssues } from '../../src/pipeline/scriptValidator.js';
import {
    MOTION_DURATION_TOKENS,
    MOTION_EASING_TOKENS,
    MOTION_STAGGER_TOKENS,
    ANTI_SLOP_LAWS,
} from '../../src/constants/motionTokens.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('Spec A: Motion Constitution & Carry Plan (Workstream WS-A)', () => {
    const valid3SceneScript: videoScript = {
        id: 'script-spec-a-01',
        title: 'Video Demo Spec A Motion Constitution',
        description: 'Kiểm thử toàn diện schema boundary, carry plan, và nhịp điệu rhythm',
        globalStyles: 'body { margin: 0; background: #0b0c10; font-family: Inter; }',
        globalSetupJs: 'console.log("Timeline init");',
        scenes: [
            {
                id: 'scene-1',
                title: 'Mở màn ấn tượng',
                voiceOverText: 'Chào mừng các bạn đến với công nghệ video tự động thế hệ mới.',
                visualDescription: 'Kinetic type xuất hiện với ease.enter, kèm icon phát sáng',
                htmlCode: '<div class="scene" id="scene-1"><h1 class="title">Tương Lai</h1></div>',
                cssCode: '#scene-1 { display: flex; }',
                jsCode: 'tl.from("#scene-1 .title", { y: 30, opacity: 0, duration: 0.6, ease: "expo.out" });',
                transition: 'fade',
                backgroundColor: '#0b0c10',
                duration: 2.0, // Shot ngắn: 2s
            },
            {
                id: 'scene-2',
                title: 'Phân tích dữ liệu',
                voiceOverText: 'Hệ thống tối ưu hóa từng khung hình với tốc độ kết xuất vượt trội.',
                visualDescription: 'Biểu đồ thanh bar-chart count up giá trị, có khoảng near-still 2.0s',
                htmlCode: '<div class="scene" id="scene-2"><div class="chart">...</div></div>',
                cssCode: '#scene-2 { display: flex; }',
                jsCode: 'tl.from("#scene-2 .chart", { scale: 0.9, opacity: 0, duration: 0.8, ease: "back.out(1.7)" });',
                transition: 'none',
                backgroundColor: '#0b0c10',
                duration: 8.0, // Shot trung bình: 8s
                nearStill: { from: 2.0, to: 4.0 }, // 4.0 - 2.0 = 2.0s >= 1.5s
            },
            {
                id: 'scene-3',
                title: 'Kêu gọi hành động',
                voiceOverText: 'Hãy trải nghiệm ngay hôm nay để nâng tầm quy trình sản xuất nội dung của bạn.',
                visualDescription: 'Card lockup xuất hiện và giữ vững đến hết video',
                htmlCode: '<div class="scene" id="scene-3"><div class="cta">Bắt Đầu Ngay</div></div>',
                cssCode: '#scene-3 { display: flex; }',
                jsCode: 'tl.from("#scene-3 .cta", { scale: 0.8, opacity: 0, duration: 1.0, ease: "expo.out" });',
                transition: 'zoom-in',
                backgroundColor: '#0b0c10',
                duration: 12.0, // Shot dài: 12s (12 / 2 = 6 >= 4)
            },
        ],
        boundaries: [
            {
                id: 'b1',
                fromScene: 'scene-1',
                toScene: 'scene-2',
                carry: {
                    element: '#scene-1 .title',
                    mechanism: 'morph',
                },
            },
            {
                id: 'b2',
                fromScene: 'scene-2',
                toScene: 'scene-3',
                carry: {
                    element: '#scene-2 .chart',
                    mechanism: 'hardCut',
                    reason: 'Chuyển cảnh dứt khoát sang nhịp CTA kết luận theo cấu trúc Story Spine',
                },
            },
        ],
        colorPalette: {
            primary: '#3b82f6',
            secondary: '#1d4ed8',
            accent: '#f59e0b',
            background: '#0b0c10',
            text: '#ffffff',
        },
        fontFamily: 'Inter',
    };

    describe('1. Kịch bản 3 scene hợp lệ (Validation PASS)', () => {
        it('phải parse thành công kịch bản đầy đủ boundaries, carry plan, rhythm đạt chuẩn', () => {
            const parseResult = videoScriptSchema.safeParse(valid3SceneScript);
            assert.strictEqual(parseResult.success, true, 'Kịch bản chuẩn phải validate thành công');
            if (parseResult.success) {
                assert.strictEqual(parseResult.data.scenes.length, 3);
                assert.strictEqual(parseResult.data.boundaries.length, 2);
                assert.strictEqual(parseResult.data.boundaries[0].carry.mechanism, 'morph');
                assert.strictEqual(parseResult.data.boundaries[1].carry.mechanism, 'hardCut');
                assert.ok(parseResult.data.boundaries[1].carry.reason);
            }
        });

        it('phải vượt qua validateScript trong scriptValidator', () => {
            const result = validateScript(valid3SceneScript);
            assert.strictEqual(result.valid, true);
            assert.strictEqual(result.errors.length, 0);
            assert.ok(result.data);
            assert.strictEqual(result.data?.boundaries.length, 2);
        });

        it('phải chấp nhận tất cả các mechanism hợp lệ trong enum', () => {
            const mechanisms = ['morph', 'zoomThrough', 'iris', 'gather', 'handoff'] as const;
            for (const mech of mechanisms) {
                const b = boundarySchema.safeParse({
                    id: 'b-test',
                    fromScene: 'scene-1',
                    toScene: 'scene-2',
                    carry: {
                        element: '#hero',
                        mechanism: mech,
                    },
                });
                assert.strictEqual(b.success, true, `Mechanism ${mech} phải hợp lệ`);
            }
        });

        it('tương thích ngược: script 1 scene từ DB cũ không có boundaries vẫn parse thành công nhờ default([])', () => {
            const legacy1SceneScript = {
                id: 'legacy-1',
                title: 'Video đơn cảnh',
                description: 'Kịch bản cũ không có trường boundaries',
                globalStyles: 'body { margin: 0; }',
                globalSetupJs: 'console.log("Ready");',
                scenes: [valid3SceneScript.scenes[0]],
                colorPalette: valid3SceneScript.colorPalette,
                fontFamily: 'Inter',
            };

            const parseResult = videoScriptSchema.safeParse(legacy1SceneScript);
            assert.strictEqual(parseResult.success, true);
            if (parseResult.success) {
                assert.deepStrictEqual(parseResult.data.boundaries, []);
            }
        });
    });

    describe('2. Bắt lỗi vi phạm Boundary & Carry Plan (Validation REJECT)', () => {
        it('phải reject khi thiếu trường boundaries', () => {
            const scriptWithoutBoundaries = { ...valid3SceneScript };
            delete (scriptWithoutBoundaries as any).boundaries;

            const result = videoScriptSchema.safeParse(scriptWithoutBoundaries);
            assert.strictEqual(result.success, false, 'Thiếu boundaries phải bị từ chối');

            const valResult = validateScript(scriptWithoutBoundaries);
            assert.strictEqual(valResult.valid, false);
            assert.ok(
                valResult.errors.some((e) => e.includes('boundaries')),
                'Thông báo lỗi phải chỉ rõ trường boundaries'
            );
        });

        it('phải reject khi số boundaries != scenes.length - 1', () => {
            // 3 scenes nhưng chỉ có 1 boundary (thiếu)
            const scriptWithFewerBoundaries = {
                ...valid3SceneScript,
                boundaries: [valid3SceneScript.boundaries[0]],
            };
            const resFewer = videoScriptSchema.safeParse(scriptWithFewerBoundaries);
            assert.strictEqual(resFewer.success, false);
            if (!resFewer.success) {
                const hasCountError = resFewer.error.issues.some((i) =>
                    i.message.includes('Số lượng boundaries (1) phải bằng scenes.length - 1 (2)')
                );
                assert.ok(hasCountError, 'Phải có lỗi về số lượng boundaries');
            }

            // 3 scenes nhưng có 3 boundaries (thừa)
            const scriptWithMoreBoundaries = {
                ...valid3SceneScript,
                boundaries: [
                    ...valid3SceneScript.boundaries,
                    {
                        id: 'b3',
                        fromScene: 'scene-3',
                        toScene: 'scene-4',
                        carry: { element: '#cta', mechanism: 'morph' as const },
                    },
                ],
            };
            const resMore = videoScriptSchema.safeParse(scriptWithMoreBoundaries);
            assert.strictEqual(resMore.success, false);
        });

        it('phải reject khi carry thiếu element hoặc element rỗng', () => {
            const scriptMissingElement = {
                ...valid3SceneScript,
                boundaries: [
                    {
                        id: 'b1',
                        fromScene: 'scene-1',
                        toScene: 'scene-2',
                        carry: {
                            element: '', // Rỗng
                            mechanism: 'morph' as const,
                        },
                    },
                    valid3SceneScript.boundaries[1],
                ],
            };
            const result = videoScriptSchema.safeParse(scriptMissingElement);
            assert.strictEqual(result.success, false, 'carry.element rỗng phải bị từ chối');
        });

        it('phải reject khi carry thiếu mechanism hoặc mechanism không nằm trong enum', () => {
            const scriptInvalidMechanism = {
                ...valid3SceneScript,
                boundaries: [
                    {
                        id: 'b1',
                        fromScene: 'scene-1',
                        toScene: 'scene-2',
                        carry: {
                            element: '#title',
                            mechanism: 'wipe-right' as any, // Không hợp lệ
                        },
                    },
                    valid3SceneScript.boundaries[1],
                ],
            };
            const result = videoScriptSchema.safeParse(scriptInvalidMechanism);
            assert.strictEqual(result.success, false, 'mechanism không hợp lệ phải bị từ chối');
        });

        it('phải reject khi mechanism là hardCut nhưng không có reason', () => {
            const scriptHardCutNoReason = {
                ...valid3SceneScript,
                boundaries: [
                    valid3SceneScript.boundaries[0],
                    {
                        id: 'b2',
                        fromScene: 'scene-2',
                        toScene: 'scene-3',
                        carry: {
                            element: '#scene-2 .chart',
                            mechanism: 'hardCut' as const,
                            // Thiếu reason
                        },
                    },
                ],
            };
            const result = videoScriptSchema.safeParse(scriptHardCutNoReason);
            assert.strictEqual(result.success, false, 'hardCut thiếu reason phải bị từ chối');
            if (!result.success) {
                const issue = result.error.issues.find((i) =>
                    i.message.includes('hardCut') && i.message.includes('reason')
                );
                assert.ok(issue, 'Phải có thông báo yêu cầu reason khi dùng hardCut');
            }
        });

        it('phải reject khi mechanism là hardCut nhưng reason chỉ chứa khoảng trắng', () => {
            const scriptHardCutEmptyReason = {
                ...valid3SceneScript,
                boundaries: [
                    valid3SceneScript.boundaries[0],
                    {
                        id: 'b2',
                        fromScene: 'scene-2',
                        toScene: 'scene-3',
                        carry: {
                            element: '#scene-2 .chart',
                            mechanism: 'hardCut' as const,
                            reason: '   ', // Chỉ khoảng trắng
                        },
                    },
                ],
            };
            const result = videoScriptSchema.safeParse(scriptHardCutEmptyReason);
            assert.strictEqual(result.success, false, 'hardCut có reason rỗng phải bị từ chối');
        });

        it('phải reject khi boundary không liên tục (sai fromScene hoặc toScene)', () => {
            const scriptDiscontinuous = {
                ...valid3SceneScript,
                boundaries: [
                    valid3SceneScript.boundaries[0], // scene-1 -> scene-2
                    {
                        id: 'b2',
                        fromScene: 'scene-1', // Lỗi: đáng lẽ phải là scene-2
                        toScene: 'scene-3',
                        carry: {
                            element: '#card',
                            mechanism: 'morph' as const,
                        },
                    },
                ],
            };
            const result = videoScriptSchema.safeParse(scriptDiscontinuous);
            assert.strictEqual(result.success, false, 'Boundary không liên tục phải bị từ chối');
            if (!result.success) {
                const issue = result.error.issues.find((i) =>
                    i.message.includes('không liên tục')
                );
                assert.ok(issue, 'Phải có thông báo lỗi boundary không liên tục');
            }
        });
    });

    describe('3. Bắt lỗi vi phạm Rhythm (Numerical Rhythm Constraints)', () => {
        it('phải reject khi kịch bản có nhịp đều (CV < 0.3 - uniform cadence)', () => {
            const uniformScript = {
                ...valid3SceneScript,
                scenes: valid3SceneScript.scenes.map((s) => ({
                    ...s,
                    duration: 5.0, // Tất cả đều 5 giây -> stdDev = 0, CV = 0 < 0.3
                })),
            };
            const result = videoScriptSchema.safeParse(uniformScript);
            assert.strictEqual(result.success, false, 'Uniform cadence phải bị từ chối');
            if (!result.success) {
                const issue = result.error.issues.find((i) =>
                    i.message.includes('CV') || i.message.includes('cadence')
                );
                assert.ok(issue, 'Phải có thông báo lỗi hệ số biến thiên CV < 0.3');
            }
        });

        it('phải reject khi tỉ số shot dài nhất / ngắn nhất < 4 (max/min < 4)', () => {
            const lowRatioScript = {
                ...valid3SceneScript,
                scenes: [
                    { ...valid3SceneScript.scenes[0], duration: 4.0 },
                    { ...valid3SceneScript.scenes[1], duration: 5.0 },
                    { ...valid3SceneScript.scenes[2], duration: 6.0 }, // 6.0 / 4.0 = 1.5 < 4
                ],
            };
            const result = videoScriptSchema.safeParse(lowRatioScript);
            assert.strictEqual(result.success, false, 'Tỉ số shot < 4 phải bị từ chối');
            if (!result.success) {
                const issue = result.error.issues.find((i) =>
                    i.message.includes('Tỉ số shot dài nhất / ngắn nhất')
                );
                assert.ok(issue, 'Phải có thông báo lỗi tỉ số shot max/min < 4');
            }
        });

        it('phải reject khi kịch bản thiếu đoạn near-still >= 1.5s', () => {
            const noNearStillScript = {
                ...valid3SceneScript,
                scenes: valid3SceneScript.scenes.map((s) => {
                    const copy = { ...s };
                    delete copy.nearStill;
                    copy.visualDescription = 'Chuyển động liên tục, không có khoảng lặng nào';
                    return copy;
                }),
            };
            const result = videoScriptSchema.safeParse(noNearStillScript);
            assert.strictEqual(result.success, false, 'Thiếu near-still phải bị từ chối');
            if (!result.success) {
                const issue = result.error.issues.find((i) =>
                    i.message.includes('near-still')
                );
                assert.ok(issue, 'Phải có thông báo lỗi thiếu near-still >= 1.5s');
            }
        });
    });

    describe('4. Helper checkRhythm tính toán chính xác số liệu thống kê', () => {
        it('tính toán chính xác CV, min, max, ratio và nhận diện nearStill với mảng đối tượng scene', () => {
            const scenes = [
                { duration: 2.0 },
                { duration: 8.0, nearStill: { from: 1.0, to: 3.5 } }, // 2.5s >= 1.5s
                { duration: 12.0 },
            ];

            const result = checkRhythm(scenes);

            assert.strictEqual(result.valid, true);
            assert.strictEqual(result.min, 2.0);
            assert.strictEqual(result.max, 12.0);
            assert.strictEqual(result.ratio, 6.0); // 12 / 2 = 6 >= 4
            assert.strictEqual(result.hasNearStill, true);

            // Mean = (2 + 8 + 12) / 3 = 7.3333...
            const expectedMean = 22 / 3;
            assert.ok(Math.abs(result.mean - expectedMean) < 1e-6);

            // Variance = ((2 - 7.333)^2 + (8 - 7.333)^2 + (12 - 7.333)^2) / 3 = 16.8888...
            // StdDev = sqrt(16.8888...) ≈ 4.1096
            // CV = 4.1096 / 7.3333 ≈ 0.5604 >= 0.3
            assert.ok(result.cv >= 0.3, `CV (${result.cv}) phải >= 0.3`);
            assert.strictEqual(result.errors.length, 0);
        });

        it('tính toán chính xác với mảng số thực thô (number[])', () => {
            const durations = [2.0, 8.0, 12.0];
            const result = checkRhythm(durations);

            assert.strictEqual(result.min, 2.0);
            assert.strictEqual(result.max, 12.0);
            assert.strictEqual(result.ratio, 6.0);
            assert.ok(result.cv >= 0.3);
            // Mảng số thô không có khai báo nearStill -> hasNearStill = false
            assert.strictEqual(result.hasNearStill, false);
            assert.strictEqual(result.valid, false, 'Thiếu nearStill nên valid phải là false');
            assert.ok(result.errors.some((e) => e.includes('near-still')));
        });

        it('nhận diện nearStill từ chuỗi visualDescription', () => {
            const scenesWithTextStill = [
                { duration: 2.0, visualDescription: 'Intro nhanh' },
                { duration: 8.0, visualDescription: 'Biểu đồ xuất hiện và giữ nguyên near-still 2.0s để người xem đọc' },
                { duration: 12.0, visualDescription: 'Outro' },
            ];

            const result = checkRhythm(scenesWithTextStill);
            assert.strictEqual(result.hasNearStill, true, 'Phải nhận diện near-still từ visualDescription');
            assert.strictEqual(result.valid, true);
        });

        it('bỏ qua kiểm tra rhythm khi kịch bản chỉ có 1 scene hoặc rỗng', () => {
            const singleScene = [{ duration: 10.0 }];
            const resultSingle = checkRhythm(singleScene);
            assert.strictEqual(resultSingle.valid, true);
            assert.strictEqual(resultSingle.errors.length, 0);

            const emptyScenes: any[] = [];
            const resultEmpty = checkRhythm(emptyScenes);
            assert.strictEqual(resultEmpty.valid, true);
            assert.strictEqual(resultEmpty.errors.length, 0);
        });
    });

    describe('5. LIME Motion Tokens & Anti-Slop Constitution Constants', () => {
        it('chứa đầy đủ bảng token Duration với các mốc chuẩn xác', () => {
            assert.ok(MOTION_DURATION_TOKENS['dur.micro']);
            assert.ok(MOTION_DURATION_TOKENS['dur.fast']);
            assert.ok(MOTION_DURATION_TOKENS['dur.base']);
            assert.ok(MOTION_DURATION_TOKENS['dur.slow']);
            assert.ok(MOTION_DURATION_TOKENS['dur.cinematic']);

            assert.strictEqual(MOTION_DURATION_TOKENS['dur.micro'].minMs, 150);
            assert.strictEqual(MOTION_DURATION_TOKENS['dur.micro'].maxMs, 200);
            assert.strictEqual(MOTION_DURATION_TOKENS['dur.base'].minMs, 450);
            assert.strictEqual(MOTION_DURATION_TOKENS['dur.base'].maxMs, 600);
            assert.strictEqual(MOTION_DURATION_TOKENS['dur.cinematic'].minMs, 1000);
        });

        it('chứa đầy đủ bảng token Easing mapping chuẩn GSAP', () => {
            assert.strictEqual(MOTION_EASING_TOKENS['ease.enter'].gsap, 'expo.out');
            assert.strictEqual(MOTION_EASING_TOKENS['ease.pop'].gsap, 'back.out(1.7)');
            assert.strictEqual(MOTION_EASING_TOKENS['ease.playful'].gsap, 'elastic.out(1, 0.5)');
            assert.strictEqual(MOTION_EASING_TOKENS['ease.camera'].gsap, 'circ.out');
            assert.strictEqual(MOTION_EASING_TOKENS['ease.flow'].gsap, 'sine.inOut');
        });

        it('chứa đầy đủ bảng Pattern Stagger Tokens', () => {
            assert.strictEqual(MOTION_STAGGER_TOKENS['stagger.grid'].sec, 0.04);
            assert.strictEqual(MOTION_STAGGER_TOKENS['stagger.list'].sec, 0.08);
            assert.strictEqual(MOTION_STAGGER_TOKENS['stagger.dramatic'].sec, 0.15);
        });

        it('chứa đầy đủ 5 Luật Anti-Slop', () => {
            assert.strictEqual(ANTI_SLOP_LAWS.length, 5);
            assert.ok(ANTI_SLOP_LAWS[0].includes('Cấm fade opacity 0->1'));
            assert.ok(ANTI_SLOP_LAWS[1].includes('Cấm easing tuyến tính'));
            assert.ok(ANTI_SLOP_LAWS[2].includes('Mọi move phải có damping hoặc overshoot'));
            assert.ok(ANTI_SLOP_LAWS[3].includes('Cấm 2 scene liên tiếp dùng cùng một cơ chế vào cảnh'));
            assert.ok(ANTI_SLOP_LAWS[4].includes('Mọi duration/easing/stagger phải tham chiếu token'));
        });

        it('đảm bảo đồng bộ và không drift token giữa motionTokens.ts và system.txt prompt', () => {
            const systemPromptPath = join(__dirname, '../../src/llm/system.txt');
            const promptText = readFileSync(systemPromptPath, 'utf-8');

            // All duration tokens must be present in prompt
            for (const key of Object.keys(MOTION_DURATION_TOKENS)) {
                assert.ok(promptText.includes(key), `Token ${key} phải có mặt trong system.txt`);
            }

            // All easing tokens and their gsap mappings must be present in prompt
            for (const [key, val] of Object.entries(MOTION_EASING_TOKENS)) {
                assert.ok(promptText.includes(key), `Token ${key} phải có mặt trong system.txt`);
                assert.ok(promptText.includes(val.gsap), `GSAP easing ${val.gsap} cho ${key} phải có trong system.txt`);
            }

            // All stagger tokens must be present in prompt
            for (const key of Object.keys(MOTION_STAGGER_TOKENS)) {
                assert.ok(promptText.includes(key), `Token ${key} phải có mặt trong system.txt`);
            }
        });
    });
});
