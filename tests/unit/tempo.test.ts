import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

import {
    TEMPO_IDS,
    TEMPO_PROFILES,
    resolveTempoProfile,
    plannedSceneCount,
    measureTempoBudget,
    measureBeatAlignment,
    formatTempoPrompt,
    type Tempo,
} from '../../src/llm/tempo.js';
import {
    checkRhythm,
    videoRequestSchema,
    videoScriptSchema,
    type scene,
} from '../../src/llm/schema.js';
import { checkRhythmLeg } from '../../src/pipeline/oracleQa.js';
import { generateScript } from '../../src/pipeline/scriptGenerator.js';
import { setLLMClient, resetLLMClient, type LLMClient } from '../../src/llm/client.js';
import type { videoRequest } from '../../src/llm/schema.js';

after(() => {
    resetLLMClient();
});

function makeScene(
    id: string,
    duration: number,
    extra: Partial<scene> = {}
): scene {
    return {
        id,
        title: id,
        voiceOverText: '',
        visualDescription: '',
        htmlCode: '',
        cssCode: '',
        jsCode: '',
        transition: 'none',
        backgroundColor: '#000',
        duration,
        ...extra,
    };
}

/** Script tối thiểu nhưng hợp lệ theo videoScriptSchema. */
function makeScript(durations: number[], tempo?: Tempo, nearStillIndex = 0) {
    const scenes = durations.map((d, i) =>
        makeScene(`s${i + 1}`, d, i === nearStillIndex ? { nearStill: { from: 0.5, to: 2.5 } } : {})
    );
    return {
        id: 'script-test',
        title: 'Test',
        description: 'Test',
        globalStyles: '',
        globalSetupJs: '',
        scenes,
        boundaries: scenes.slice(1).map((s, i) => ({
            id: `b${i + 1}`,
            fromScene: scenes[i].id,
            toScene: s.id,
            carry: { element: '#logo', mechanism: 'morph' as const },
        })),
        colorPalette: {
            primary: '#000',
            secondary: '#111',
            accent: '#222',
            background: '#333',
            text: '#fff',
        },
        fontFamily: 'Inter',
        ...(tempo ? { tempo } : {}),
    };
}

describe('Tempo (#117) — nấc nhịp cắt cảnh nối prompt + ngưỡng QA', () => {
    describe('Bảng profile là nguồn sự thật duy nhất', () => {
        it('có đủ 4 nấc và auto giữ nguyên ngưỡng cũ (không regression)', () => {
            assert.deepStrictEqual([...TEMPO_IDS], ['auto', 'fast', 'balanced', 'slow']);
            assert.strictEqual(TEMPO_PROFILES.auto.minRatio, 4);
            assert.strictEqual(TEMPO_PROFILES.auto.minCv, 0.3);
            assert.strictEqual(TEMPO_PROFILES.auto.sceneDurationSec, null);
        });

        it('fast phải khác auto (không còn trùng ngưỡng ratio >= 4)', () => {
            assert.ok(TEMPO_PROFILES.fast.minRatio > TEMPO_PROFILES.auto.minRatio);
            assert.ok(TEMPO_PROFILES.fast.minCv > TEMPO_PROFILES.auto.minCv);
        });

        it('các nấc nới dần: fast > balanced > slow', () => {
            assert.ok(TEMPO_PROFILES.fast.minRatio > TEMPO_PROFILES.balanced.minRatio);
            assert.ok(TEMPO_PROFILES.balanced.minRatio > TEMPO_PROFILES.slow.minRatio);
            assert.ok(TEMPO_PROFILES.fast.minCv > TEMPO_PROFILES.balanced.minCv);
            assert.ok(TEMPO_PROFILES.balanced.minCv > TEMPO_PROFILES.slow.minCv);
        });

        it('resolveTempoProfile chịu được giá trị rác và trả auto', () => {
            assert.strictEqual(resolveTempoProfile('slow').id, 'slow');
            assert.strictEqual(resolveTempoProfile('nope').id, 'auto');
            assert.strictEqual(resolveTempoProfile(undefined).id, 'auto');
            assert.strictEqual(resolveTempoProfile(null).id, 'auto');
        });
    });

    describe('plannedSceneCount — số beat gợi ý', () => {
        it('auto giữ đúng hành vi allocateBeats cũ', () => {
            // allocateBeats: round(15 / 4) = 4 scene
            assert.strictEqual(plannedSceneCount(15, 'auto'), 4);
            assert.strictEqual(plannedSceneCount(15), 4);
        });

        it('fast nhiều cảnh hơn slow trên cùng thời lượng', () => {
            const fast = plannedSceneCount(15, 'fast');
            const balanced = plannedSceneCount(15, 'balanced');
            const slow = plannedSceneCount(15, 'slow');
            assert.ok(fast > balanced, `${fast} > ${balanced}`);
            assert.ok(balanced > slow, `${balanced} > ${slow}`);
        });

        it('luôn >= 1 và không vượt trần maxScenes', () => {
            assert.strictEqual(plannedSceneCount(0, 'fast'), 1);
            assert.ok(plannedSceneCount(300, 'fast') <= TEMPO_PROFILES.fast.maxScenes);
        });
    });

    describe('measureTempoBudget — độ lệch so với dải đã khai', () => {
        it('auto không khai báo dải → null', () => {
            assert.strictEqual(measureTempoBudget([3, 5, 7], 'auto'), null);
        });

        it('mọi cảnh trong dải → lệch 0', () => {
            const result = measureTempoBudget([2.5, 3.0, 4.0], 'balanced');
            assert.ok(result);
            assert.strictEqual(result!.meanAbsSec, 0);
            assert.strictEqual(result!.outOfRangeScenes, 0);
            assert.strictEqual(result!.outOfRangeRatio, 0);
        });

        it('đo đúng số giây vượt ra ngoài dải', () => {
            // balanced: 2.0–4.5s; scene 1s thiếu 1.0s, scene 6.5s thừa 2.0s
            const result = measureTempoBudget([1.0, 6.5, 3.0], 'balanced');
            assert.ok(result);
            assert.strictEqual(result!.outOfRangeScenes, 2);
            assert.strictEqual(result!.meanAbsSec, 1);
            assert.strictEqual(result!.outOfRangeRatio, 0.667);
            assert.deepStrictEqual(result!.range, { min: 2, max: 4.5 });
        });

        it('bỏ qua duration không hợp lệ', () => {
            const result = measureTempoBudget([0, -1, Number.NaN, 3.0], 'balanced');
            assert.ok(result);
            assert.strictEqual(result!.outOfRangeScenes, 0);
        });
    });

    describe('measureBeatAlignment — số scene vs story spine', () => {
        it('khớp đúng số beat → score 1', () => {
            const planned = plannedSceneCount(15, 'balanced');
            const result = measureBeatAlignment(planned, 15, 'balanced');
            assert.strictEqual(result.score, 1);
            assert.strictEqual(result.plannedScenes, planned);
        });

        it('lệch 100% → score 0 (không âm)', () => {
            const planned = plannedSceneCount(15, 'balanced');
            const result = measureBeatAlignment(planned * 2, 15, 'balanced');
            assert.strictEqual(result.score, 0);
        });
    });

    describe('formatTempoPrompt — đầu viết dùng cùng số với đầu chấm', () => {
        it('nêu đúng ngưỡng ratio/CV và dải scene của tempo', () => {
            const prompt = formatTempoPrompt('fast', 15);
            assert.ok(prompt.includes('Dồn dập'));
            assert.ok(prompt.includes(`≥ ${TEMPO_PROFILES.fast.minRatio}×`));
            assert.ok(prompt.includes(`≥ ${TEMPO_PROFILES.fast.minCv}`));
            assert.ok(prompt.includes('1–2.5s'));
        });

        it('auto không ép số cảnh nhưng vẫn nêu ngưỡng tương phản', () => {
            const prompt = formatTempoPrompt('auto', 15);
            assert.ok(prompt.includes('Tự động'));
            assert.ok(prompt.includes('Không ép số cảnh'));
            assert.ok(prompt.includes('≥ 4×'));
        });

        it('luôn nhắc không bù khoảng lặng (#107)', () => {
            for (const tempo of TEMPO_IDS) {
                assert.ok(formatTempoPrompt(tempo, 20).includes('không bù khoảng lặng'));
            }
        });
    });

    describe('checkRhythm — nhận ngưỡng từ ngoài, mặc định giữ hành vi cũ', () => {
        it('không truyền ngưỡng → 4 / 0.3 / 1.5 như trước', () => {
            const result = checkRhythm([makeScene('s1', 1.5, { nearStill: { from: 0, to: 2 } }), makeScene('s2', 6)]);
            assert.strictEqual(result.valid, true);
            assert.deepStrictEqual(result.thresholds, {
                minRatio: 4,
                minCv: 0.3,
                minNearStillSec: 1.5,
            });
        });

        it('ngưỡng nới cho phép ratio 2 và CV thấp', () => {
            const scenes = [
                makeScene('s1', 4, { nearStill: { from: 0, to: 2 } }),
                makeScene('s2', 8),
            ];
            assert.strictEqual(checkRhythm(scenes).valid, false);
            assert.strictEqual(checkRhythm(scenes, { minRatio: 1.8, minCv: 0.15 }).valid, true);
        });
    });

    describe('checkRhythmLeg — QA theo tempo', () => {
        it('auto giữ nguyên hành vi: ratio 1.79 fail', () => {
            const scenes = [makeScene('s1', 1.87), makeScene('s2', 3.34), makeScene('s3', 1.92)];
            const result = checkRhythmLeg(scenes, { s1: 1.87, s2: 3.34, s3: 1.92 });
            assert.strictEqual(result.status, 'fail');
            assert.strictEqual(result.tempo, 'auto');
            assert.ok(result.reason?.includes('< 4'));
            assert.strictEqual(result.budgetDeviation, null);
        });

        it('slow: ratio ~2 KHÔNG bị degraded vì rhythm (tiêu chí nghiệm thu)', () => {
            const scenes = [
                makeScene('s1', 4.0, { nearStill: { from: 0, to: 2 } }),
                makeScene('s2', 8.0),
            ];
            const result = checkRhythmLeg(scenes, { s1: 4.0, s2: 8.0 }, { tempo: 'slow' });
            assert.strictEqual(result.status, 'pass');
            assert.strictEqual(result.ratio, 2);
            assert.strictEqual(result.thresholds?.minRatio, 1.8);
            // 4s nằm trong dải, 8s vượt dải → đúng 50% ngoài dải, chưa đủ ngưỡng cảnh báo
            assert.ok(result.budgetDeviation);
            assert.strictEqual(result.budgetDeviation!.outOfRangeRatio, 0.5);
        });

        it('fast: ratio 4.58 vẫn fail vì ngưỡng riêng là 5', () => {
            const scenes = [
                makeScene('s1', 1.2, { nearStill: { from: 0, to: 2 } }),
                makeScene('s2', 5.5),
            ];
            const result = checkRhythmLeg(scenes, { s1: 1.2, s2: 5.5 }, { tempo: 'fast' });
            assert.strictEqual(result.status, 'fail');
            assert.strictEqual(result.ratio, 4.58);
            assert.ok(result.reason?.includes('< 5'));
            // Cùng số liệu nhưng auto sẽ pass (ratio 4.58 >= 4)
            assert.strictEqual(checkRhythmLeg(scenes, { s1: 1.2, s2: 5.5 }).status, 'pass');
        });

        it('balanced: ratio 3 pass trong khi auto fail', () => {
            const scenes = [
                makeScene('s1', 2.0, { nearStill: { from: 0, to: 2 } }),
                makeScene('s2', 6.0),
            ];
            const durations = { s1: 2.0, s2: 6.0 };
            assert.strictEqual(checkRhythmLeg(scenes, durations).status, 'fail');
            assert.strictEqual(checkRhythmLeg(scenes, durations, { tempo: 'balanced' }).status, 'pass');
        });

        it('cảnh báo khi quá nửa số cảnh ngoài dải của tempo', () => {
            const scenes = [
                makeScene('s1', 8.0, { nearStill: { from: 0, to: 2 } }),
                makeScene('s2', 14.5),
            ];
            const result = checkRhythmLeg(scenes, { s1: 8.0, s2: 14.5 }, { tempo: 'slow' });
            assert.strictEqual(result.status, 'warn');
            assert.ok(result.reason?.includes('ngoài dải'));
        });

        it('báo cáo kèm beatAlignment theo tempo + thời lượng mục tiêu', () => {
            const scenes = [makeScene('s1', 2), makeScene('s2', 4), makeScene('s3', 8)];
            const result = checkRhythmLeg(scenes, { s1: 2, s2: 4, s3: 8 }, {
                tempo: 'slow',
                targetDurationSec: 15,
            });
            assert.ok(result.beatAlignment);
            assert.strictEqual(result.beatAlignment!.actualScenes, 3);
            assert.strictEqual(result.beatAlignment!.plannedScenes, plannedSceneCount(15, 'slow'));
        });

        it('một scene vẫn pass và mang theo tempo', () => {
            const result = checkRhythmLeg([makeScene('s1', 5)], undefined, { tempo: 'fast' });
            assert.strictEqual(result.status, 'pass');
            assert.strictEqual(result.tempo, 'fast');
        });
    });

    describe('Schema — tempo được truyền và validate đúng profile', () => {
        it('videoRequestSchema mặc định tempo = auto', () => {
            const req = videoRequestSchema.parse({
                prompt: 'Một video giới thiệu quán cà phê ấm áp',
                targetDurationSec: 15,
                style: 'modern',
            });
            assert.strictEqual(req.tempo, 'auto');
        });

        it('videoRequestSchema nhận cả 4 nấc', () => {
            for (const tempo of TEMPO_IDS) {
                const req = videoRequestSchema.parse({
                    prompt: 'Một video giới thiệu quán cà phê ấm áp',
                    targetDurationSec: 15,
                    style: 'modern',
                    tempo,
                });
                assert.strictEqual(req.tempo, tempo);
            }
        });

        it('script slow với ratio 2 được chấp nhận, cùng script ở auto bị loại', () => {
            const slow = videoScriptSchema.safeParse(makeScript([4, 8], 'slow'));
            assert.strictEqual(slow.success, true);

            const auto = videoScriptSchema.safeParse(makeScript([4, 8], 'auto'));
            assert.strictEqual(auto.success, false);
            if (!auto.success) {
                const messages = auto.error.issues.map((i) => i.message).join(' | ');
                assert.ok(messages.includes('>= 4'));
            }
        });

        it('script không khai báo tempo mặc định auto (không regression)', () => {
            const parsed = videoScriptSchema.safeParse(makeScript([1.5, 6]));
            assert.strictEqual(parsed.success, true);
            if (parsed.success) assert.strictEqual(parsed.data.tempo, 'auto');
        });

        it('script fast vẫn bị loại khi ratio 4', () => {
            const fast = videoScriptSchema.safeParse(makeScript([1.2, 5.5], 'fast'));
            assert.strictEqual(fast.success, false);
        });
    });

    describe('generateScript E2E (LLM giả) — prompt và script cùng một tempo', () => {
        const minimalSlowScript = {
            id: 'slow-script',
            title: 'Quán cà phê Mộc',
            description: 'Giới thiệu quán cà phê',
            globalStyles: 'body { margin: 0; font-family: Inter; }',
            globalSetupJs: '',
            scenes: [
                {
                    id: 'sc1',
                    title: 'Không gian',
                    voiceOverText:
                        'Quán cà phê Mộc mở cửa từ bảy giờ sáng với không gian gỗ ấm và ánh đèn vàng dịu.',
                    visualDescription: 'Không gian gỗ ấm, near-still 2s ở phần ánh đèn',
                    nearStill: { from: 0.5, to: 3.5 },
                    htmlCode: '<div class="slide"><h1>Mộc</h1></div>',
                    cssCode: '.slide { width: 100%; height: 100%; }',
                    jsCode: '',
                    transition: 'fade',
                    backgroundColor: '#000000',
                    duration: 4,
                },
                {
                    id: 'sc2',
                    title: 'Hạt cà phê',
                    voiceOverText:
                        'Chúng tôi rang xay tại chỗ mỗi ngày để giữ trọn hương vị nguyên bản của hạt cà phê Việt Nam.',
                    visualDescription: 'Cận cảnh hạt cà phê rang',
                    htmlCode: '<div class="slide"><h1>Rang xay</h1></div>',
                    cssCode: '.slide { width: 100%; height: 100%; }',
                    jsCode: '',
                    transition: 'fade',
                    backgroundColor: '#000000',
                    duration: 8,
                },
            ],
            boundaries: [
                { id: 'b1', fromScene: 'sc1', toScene: 'sc2', carry: { element: '#logo', mechanism: 'morph' } },
            ],
            colorPalette: {
                primary: '#111111',
                secondary: '#222222',
                accent: '#333333',
                background: '#0b0f19',
                text: '#f8fafc',
            },
            fontFamily: 'Inter',
        };

        it('tempo slow: prompt chứa hướng dẫn Thư thả và script được đóng dấu tempo', async () => {
            const capturedPrompts: string[] = [];
            let callIndex = 0;
            const fake: LLMClient = {
                provider: 'mock',
                generate: async (_systemPrompt: string, userPrompt: string) => {
                    callIndex += 1;
                    if (callIndex === 1) return 'dark-keynote';
                    capturedPrompts.push(userPrompt);
                    return JSON.stringify(minimalSlowScript);
                },
            };
            setLLMClient(fake);

            const script = await generateScript({
                prompt: 'Video giới thiệu quán cà phê Mộc, không gian ấm áp',
                style: 'modern',
                targetDurationSec: 15,
                language: 'vi',
                tempo: 'slow',
            } as videoRequest);

            assert.strictEqual(script.tempo, 'slow');
            assert.strictEqual(capturedPrompts.length, 1);
            assert.match(capturedPrompts[0], /Nhịp người dùng chọn: \*\*Thư thả\*\*/);
            assert.match(capturedPrompts[0], /3\.5–7s/);
        });

        it('cùng script đó ở tempo auto bị validate từ chối (ratio 2 < 4)', () => {
            const auto = videoScriptSchema.safeParse(minimalSlowScript);
            assert.strictEqual(auto.success, false);
        });
    });
});
