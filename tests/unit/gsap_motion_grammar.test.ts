import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    lintSceneMotion,
    type MotionLintUnit,
    type SceneMotionLintInput,
} from '../../src/pipeline/gsapLinter.js';
import { checkGsapLintLeg } from '../../src/pipeline/oracleQa.js';
import type { videoScript } from '../../src/llm/schema.js';

function motion(
    code: string,
    extra?: Partial<Omit<SceneMotionLintInput, 'sceneId' | 'units'>>
): SceneMotionLintInput {
    return {
        sceneId: 'scene_1',
        duration: 1,
        units: [{ code }],
        ...extra,
    };
}

function rules(input: SceneMotionLintInput): string[] {
    return lintSceneMotion(input).map((v) => v.type);
}

describe('LINEAR_EASE (#124)', () => {
    it('báo khi tween x dùng ease none', () => {
        const violations = lintSceneMotion(
            motion(`const tl = gsap.timeline({ paused: true });\ntl.to(".box", { x: 100, ease: "none", duration: 1 }, 0);`)
        );
        assert.equal(violations.length, 1);
        assert.equal(violations[0].type, 'LINEAR_EASE');
        assert.match(violations[0].message, /x/);
        assert.match(violations[0].message, /none/);
        assert.equal(violations[0].sceneId, 'scene_1');
        assert.equal(violations[0].line, 2);
    });

    it('báo khi scale dùng ease linear', () => {
        const violations = lintSceneMotion(
            motion(`gsap.fromTo(".box", { scale: 0 }, { scale: 1, ease: "linear", duration: 1 });`)
        );
        assert.equal(violations.length, 1);
        assert.equal(violations[0].type, 'LINEAR_EASE');
    });

    it('không báo với ease có gia tốc', () => {
        assert.deepEqual(
            rules(motion(`gsap.to(".box", { x: 100, ease: "power2.out", duration: 1 });`)),
            []
        );
        assert.deepEqual(
            rules(motion(`gsap.to(".box", { scale: 1.2, ease: "back.out(1.7)", duration: 1 });`)),
            []
        );
    });

    it('miễn tween opacity chuyển cảnh dùng ease none', () => {
        const types = rules(motion(`gsap.to(".box", { opacity: 0, ease: "none", duration: 1 });`));
        assert.equal(types.includes('LINEAR_EASE'), false);
    });

    it('miễn camera layer trên container scene (#122)', () => {
        const types = rules(
            motion(`gsap.to("#scene_1", { scale: 1.05, ease: "none", duration: 1 });`)
        );
        assert.equal(types.includes('LINEAR_EASE'), false);
        assert.equal(types.includes('MOVE_LIBRARY_BYPASS'), true);
    });
});

describe('FADE_ONLY_SCENE (#124)', () => {
    it('báo khi scene chỉ có tween opacity', () => {
        const violations = lintSceneMotion(
            motion(
                `const tl = gsap.timeline({ paused: true });
tl.to(".a", { opacity: 1, duration: 0.4 }, 0);
tl.to(".b", { opacity: 0, duration: 0.4 }, 0.5);`
            )
        );
        assert.equal(violations.length, 1);
        assert.equal(violations[0].type, 'FADE_ONLY_SCENE');
        assert.match(violations[0].message, /opacity/);
        assert.equal(violations[0].line, 2);
    });

    it('không báo khi có thêm transform', () => {
        const violations = lintSceneMotion(
            motion(
                `const tl = gsap.timeline({ paused: true });
tl.to(".a", { opacity: 1, duration: 0.4 }, 0);
tl.to(".b", { y: 20, duration: 0.4 }, 0.5);`
            )
        );
        assert.equal(violations.some((v) => v.type === 'FADE_ONLY_SCENE'), false);
    });

    it('miễn khi scene khai camera đang chạy', () => {
        const violations = lintSceneMotion(
            motion(`gsap.to(".a", { opacity: 1, duration: 1 });`, { cameraMove: 'push-in' })
        );
        assert.equal(violations.length, 0);
    });

    it('vẫn báo khi camera locked (không có chuyển động nào)', () => {
        const violations = lintSceneMotion(
            motion(`gsap.to(".a", { opacity: 1, duration: 1 });`, { cameraMove: 'locked' })
        );
        assert.equal(violations.length, 1);
        assert.equal(violations[0].type, 'FADE_ONLY_SCENE');
    });
});

describe('STATIC_TOO_LONG (#124)', () => {
    it('báo scene pop-in rồi đứng yên quá 1s', () => {
        const violations = lintSceneMotion(
            motion(
                `const tl = gsap.timeline({ paused: true });
tl.to(".a", { y: 0, duration: 0.4 }, 0);`,
                { duration: 8 }
            )
        );
        assert.equal(violations.length, 1);
        assert.equal(violations[0].type, 'STATIC_TOO_LONG');
        assert.match(violations[0].message, /7\.6s/);
    });

    it('báo khoảng lặng giữa hai tween', () => {
        const violations = lintSceneMotion(
            motion(
                `const tl = gsap.timeline({ paused: true });
tl.to(".a", { y: 0, duration: 0.4 }, 0);
tl.to(".b", { y: 10, duration: 0.4 }, 4);`,
                { duration: 5 }
            )
        );
        assert.equal(violations.length, 1);
        assert.equal(violations[0].type, 'STATIC_TOO_LONG');
        assert.match(violations[0].message, /3\.6s/);
    });

    it('không báo khi tween rải đều scene', () => {
        assert.deepEqual(
            rules(
                motion(
                    `const tl = gsap.timeline({ paused: true });
tl.to(".a", { y: 0, duration: 0.5 }, 0);
tl.to(".b", { y: 10, duration: 0.5 }, 1.5);
tl.to(".c", { y: 20, duration: 0.5 }, 3);
tl.to(".d", { y: 30, duration: 0.5 }, 4.5);`,
                    { duration: 5 }
                )
            ),
            []
        );
    });

    it('miễn scene khai nearStill có chủ đích', () => {
        assert.deepEqual(
            rules(
                motion(`gsap.to(".a", { y: 0, duration: 0.4 }, 0);`, {
                    duration: 8,
                    nearStill: { from: 1, to: 3 },
                })
            ),
            []
        );
    });

    it('bỏ qua khi không biết duration hoặc timeline vô hạn', () => {
        assert.deepEqual(rules(motion(`gsap.to(".a", { y: 0, duration: 0.4 }, 0);`, { duration: undefined })), []);
        assert.deepEqual(
            rules(
                motion(`gsap.to(".a", { y: 0, duration: 0.4, repeat: -1 }, 0);`, { duration: 8 })
            ),
            []
        );
    });

    it('không kết luận "không có tween" khi code lỗi cú pháp', () => {
        assert.deepEqual(
            rules(motion(`gsap.to(".a", { y: 0, duration: 0.4 }, 0); ))) syntax error`, { duration: 8 })),
            []
        );
    });

    it('coi duration động / loop là ambient phủ tới cuối scene', () => {
        const code = `const tl = gsap.timeline({ paused: true });
const ambientDur = Math.max(0.5, 8 - 1.2);
tl.to(".beam", { rotation: 360, duration: ambientDur, ease: "none" }, 0.75);`;
        assert.deepEqual(rules(motion(code, { duration: 8 })), []);
    });

    it('gộp tween từ jsCode và script inline trước khi đo khoảng lặng', () => {
        const violations = lintSceneMotion({
            sceneId: 'scene_1',
            duration: 2.2,
            units: [
                {
                    code: `const tl = gsap.timeline({ paused: true });\ntl.to(".a", { y: 0, duration: 0.5 }, 0);`,
                },
                {
                    code: `const tl2 = gsap.timeline({ paused: true });\ntl2.to(".b", { y: 10, duration: 0.5 }, 1.2);`,
                    lineOffset: 9,
                },
            ],
        });
        assert.equal(violations.some((v) => v.type === 'STATIC_TOO_LONG'), false);
    });
});

describe('MOVE_LIBRARY_BYPASS (#124)', () => {
    it('báo khi tự animate scale trên container scene', () => {
        const violations = lintSceneMotion(
            motion(`const tl = gsap.timeline({ paused: true });\ntl.to("#scene_1", { scale: 1.2, duration: 1 }, 0);`)
        );
        assert.equal(violations.length, 1);
        assert.equal(violations[0].type, 'MOVE_LIBRARY_BYPASS');
        assert.equal(violations[0].line, 2);
        assert.match(violations[0].message, /scene\.camera/);
    });

    it('báo cả x/y trên container', () => {
        assert.deepEqual(
            rules(motion(`gsap.to("#scene_1", { x: 40, y: -20, duration: 1 });`)),
            ['MOVE_LIBRARY_BYPASS']
        );
    });

    it('không báo khi animate phần tử con', () => {
        assert.deepEqual(rules(motion(`gsap.to(".card", { scale: 1.2, duration: 1 });`)), []);
    });

    it('không báo khi container chỉ đổi opacity', () => {
        const types = rules(motion(`gsap.to("#scene_1", { opacity: 0, duration: 1 });`));
        assert.equal(types.includes('MOVE_LIBRARY_BYPASS'), false);
    });

    it('miễn transform đi kèm fade — đó là transition vào/ra, không phải camera', () => {
        const types = rules(
            motion(`gsap.to("#scene_1", { scale: 1.05, opacity: 0, duration: 1 });`)
        );
        assert.equal(types.includes('MOVE_LIBRARY_BYPASS'), false);
    });
});

describe('checkGsapLintLeg — 4 rule anti-slop (#124)', () => {
    function makeScript(jsCode: string, overrides?: Record<string, unknown>): videoScript {
        return {
            id: 's',
            title: 't',
            description: '',
            globalStyles: '',
            globalSetupJs: '',
            scenes: [
                {
                    id: 'scene_1',
                    title: 'S1',
                    voiceOverText: 't1',
                    visualDescription: '',
                    htmlCode: '<div class="box"></div>',
                    cssCode: '',
                    jsCode,
                    transition: 'none',
                    backgroundColor: '#000',
                    duration: 1,
                    ...overrides,
                },
            ],
            boundaries: [],
            colorPalette: {
                primary: '#000',
                secondary: '#111',
                accent: '#222',
                background: '#333',
                text: '#fff',
            },
            fontFamily: 'Inter',
        } as unknown as videoScript;
    }

    it('mặc định warn-only: job vẫn pass nhưng có vi phạm', () => {
        const leg = checkGsapLintLeg(
            makeScript(`gsap.to(".box", { x: 100, ease: "none", duration: 1 });`)
        );
        assert.equal(leg.status, 'warn');
        assert.equal(leg.violations[0].rule, 'LINEAR_EASE');
        assert.equal(leg.violations[0].sceneId, 'scene_1');
        assert.equal(leg.violations[0].line, 1);
    });

    it('gsapLintStrict biến thành fail', () => {
        const leg = checkGsapLintLeg(
            makeScript(`gsap.to(".box", { x: 100, ease: "none", duration: 1 });`),
            { strict: true }
        );
        assert.equal(leg.status, 'fail');
        assert.equal(leg.violations[0].rule, 'LINEAR_EASE');
    });

    it('dùng duration từ audioResult (scencesDuration) để đo khoảng lặng', () => {
        const leg = checkGsapLintLeg(
            makeScript(`gsap.to(".box", { y: 10, duration: 0.4 }, 0);`, { duration: undefined }),
            { durations: { scene_1: 8 } }
        );
        assert.equal(leg.violations.some((v) => v.rule === 'STATIC_TOO_LONG'), true);
    });

    it('cộng lineOffset của script inline vào số dòng báo lỗi', () => {
        const html = `<div class="box"></div>
<script>
gsap.to("#scene_1", { scale: 1.1, duration: 1 });
</script>`;
        const leg = checkGsapLintLeg(makeScript('', { htmlCode: html }));
        const bypass = leg.violations.find((v) => v.rule === 'MOVE_LIBRARY_BYPASS');
        assert.ok(bypass);
        assert.equal(bypass?.line, 3);
    });

    it('4 rule chạy dưới 20ms cho một scene', () => {
        const code = `const tl = gsap.timeline({ paused: true });
tl.to(".a", { x: 10, ease: "none", duration: 0.4 }, 0);
tl.to(".b", { opacity: 0, duration: 0.4 }, 0.5);
tl.to("#scene_1", { scale: 1.05, duration: 0.4 }, 1);
tl.to(".c", { y: 10, duration: 0.4 }, 1.5);`;
        const started = performance.now();
        lintSceneMotion({ sceneId: 'scene_1', duration: 8, units: [{ code }] });
        const elapsed = performance.now() - started;
        assert.ok(elapsed < 20, `lintSceneMotion mất ${elapsed.toFixed(2)}ms (> 20ms)`);
    });
});
