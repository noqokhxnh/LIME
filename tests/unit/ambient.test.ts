import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright';

import {
    AMBIENT_MOVE_IDS,
    MAX_AMBIENT_PER_SCENE,
    buildAmbientTrack,
    findMissingAmbientTargets,
    getAmbientState,
    resolveAmbient,
    type AmbientMove,
} from '../../src/pipeline/ambient.js';
import { sceneAmbientSchema, sceneSchema, type videoScript } from '../../src/llm/schema.js';
import { validateAmbientTargets, validateScript } from '../../src/pipeline/scriptValidator.js';
import { assembleHTML } from '../../src/pipeline/assembleHtml.js';

const baseScene = {
    id: 'scene_1',
    title: 'S1',
    voiceOverText: 'Một câu thoại.',
    visualDescription: '',
    htmlCode: '<div id="scene_1"><div class="steam">Steam</div><div class="drop">Drop</div></div>',
    cssCode: '',
    jsCode: '',
    transition: 'none',
    backgroundColor: '#000',
};

describe('ambient — vocabulary & keyframe (#125)', () => {
    it('vocabulary gồm 6 move', () => {
        assert.deepEqual([...AMBIENT_MOVE_IDS], [
            'steam',
            'drip',
            'flicker',
            'drift',
            'parallax',
            'pulse',
        ]);
    });

    it('mỗi move có period > 0 và keyframe bắt đầu ở p=0, kết thúc ở p=1', () => {
        for (const move of AMBIENT_MOVE_IDS) {
            const track = buildAmbientTrack(move, 1);
            assert.ok(track.period > 0, `${move} phải có period dương`);
            assert.equal(track.keys[0].p, 0, `${move} keyframe đầu phải p=0`);
            assert.equal(track.keys[track.keys.length - 1].p, 1, `${move} keyframe cuối phải p=1`);
            assert.ok(track.keys.length >= 2, `${move} cần ít nhất 2 keyframe`);
        }
    });

    it('intensity = 0 giữ trạng thái tĩnh, intensity lớn hơn cho biên độ lớn hơn', () => {
        const zero = buildAmbientTrack('drift', 0);
        assert.deepEqual(
            zero.keys.map((k) => Math.abs(k.x ?? 0)),
            [0, 0, 0, 0, 0]
        );
        const half = buildAmbientTrack('drift', 0.5);
        const full = buildAmbientTrack('drift', 1);
        assert.ok(Math.abs(full.keys[2].x ?? 0) > Math.abs(half.keys[2].x ?? 0));
    });

    it('getAmbientState là hàm thuần: cùng t luôn cho cùng kết quả', () => {
        for (const move of AMBIENT_MOVE_IDS) {
            const track = buildAmbientTrack(move, 0.8);
            const first = getAmbientState(track, 1.234);
            const second = getAmbientState(track, 1.234);
            assert.deepEqual(first, second, `${move} không thuần tại cùng t`);
        }
    });

    it('trạng thái lặp lại sau đúng một chu kỳ (và với t âm)', () => {
        const track = buildAmbientTrack('steam', 1);
        assert.deepEqual(getAmbientState(track, 0.7), getAmbientState(track, 0.7 + track.period));
        assert.deepEqual(getAmbientState(track, 0.7), getAmbientState(track, 0.7 - track.period));
    });

    it('seek tiến rồi lùi trả lại đúng trạng thái ban đầu', () => {
        const track = buildAmbientTrack('steam', 1);
        const before = getAmbientState(track, 0);
        getAmbientState(track, 1);
        getAmbientState(track, 2.2);
        assert.deepEqual(getAmbientState(track, 0), before);
    });

    it('steam thay đổi giữa t=0 và t=1s', () => {
        const track = buildAmbientTrack('steam', 1);
        const start = getAmbientState(track, 0);
        const later = getAmbientState(track, 1);
        assert.notDeepEqual(start, later);
        assert.ok((later.y ?? 0) < (start.y ?? 0), 'steam phải bốc lên (y âm dần)');
    });
});

describe('resolveAmbient — chuẩn hoá khai báo (#125)', () => {
    it('mặc định from=0, to=hết scene', () => {
        const [item] = resolveAmbient([{ move: 'steam', target: '.steam' }], 4);
        assert.equal(item.from, 0);
        assert.equal(item.to, 4);
        assert.ok(item.period > 0);
        assert.ok(item.keys.length >= 2);
    });

    it('cắt from/to vào [0, duration]', () => {
        const [item] = resolveAmbient(
            [{ move: 'drift', target: '.steam', from: -2, to: 99 }],
            5
        );
        assert.equal(item.from, 0);
        assert.equal(item.to, 5);
    });

    it('bỏ mục rỗng thời lượng hoặc move/target không hợp lệ', () => {
        assert.deepEqual(
            resolveAmbient([{ move: 'steam', target: '.steam', from: 2, to: 2 }], 4),
            []
        );
        assert.deepEqual(
            resolveAmbient([{ move: 'explode' as AmbientMove, target: '.steam' }], 4),
            []
        );
        assert.deepEqual(resolveAmbient([{ move: 'steam', target: '   ' }], 4), []);
    });

    it(`giữ tối đa ${MAX_AMBIENT_PER_SCENE} move mỗi scene`, () => {
        const resolved = resolveAmbient(
            [
                { move: 'steam', target: '.steam' },
                { move: 'drift', target: '.drop' },
                { move: 'pulse', target: '.steam' },
            ],
            4
        );
        assert.equal(resolved.length, MAX_AMBIENT_PER_SCENE);
    });
});

describe('scene.ambient schema (#125)', () => {
    it('scene không có ambient vẫn parse được', () => {
        assert.equal(sceneSchema.parse(baseScene).ambient, undefined);
    });

    it('ambient hợp lệ được giữ nguyên', () => {
        const parsed = sceneSchema.parse({
            ...baseScene,
            ambient: [{ move: 'steam', target: '.steam', intensity: 0.6, from: 0.2, to: 3 }],
        });
        assert.deepEqual(parsed.ambient, [
            { move: 'steam', target: '.steam', intensity: 0.6, from: 0.2, to: 3 },
        ]);
    });

    it('move ngoài vocabulary bị từ chối', () => {
        assert.equal(
            sceneSchema.safeParse({
                ...baseScene,
                ambient: [{ move: 'explode', target: '.steam' }],
            }).success,
            false
        );
    });

    it('to <= from bị từ chối', () => {
        assert.equal(
            sceneAmbientSchema.safeParse({ move: 'steam', target: '.steam', from: 2, to: 2 })
                .success,
            false
        );
        assert.equal(
            sceneAmbientSchema.safeParse({ move: 'steam', target: '.steam', from: 3, to: 1 })
                .success,
            false
        );
    });

    it('quá 2 move bị từ chối', () => {
        const result = sceneSchema.safeParse({
            ...baseScene,
            ambient: [
                { move: 'steam', target: '.a' },
                { move: 'drift', target: '.b' },
                { move: 'pulse', target: '.c' },
            ],
        });
        assert.equal(result.success, false);
    });
});

describe('validateAmbientTargets (#125)', () => {
    it('báo target không tồn tại trong htmlCode/jsCode', () => {
        const missing = findMissingAmbientTargets({
            htmlCode: '<div class="steam"></div>',
            jsCode: '',
            ambient: [{ move: 'steam', target: '.smoke' }],
        });
        assert.deepEqual(missing, ['.smoke']);
    });

    it('chấp nhận phần tử do jsCode sinh ra', () => {
        const missing = findMissingAmbientTargets({
            htmlCode: '<div id="scene_1"></div>',
            jsCode: 'document.querySelector("#scene_1").innerHTML = "<div class=\\"smoke\\"></div>";',
            ambient: [{ move: 'steam', target: '.smoke' }],
        });
        assert.deepEqual(missing, []);
    });

    it('validateScript từ chối script có ambient target sai', () => {
        const script = makeScript([
            { move: 'steam', target: '.smoke' },
            undefined,
        ]);
        const result = validateScript(script);
        assert.equal(result.valid, false);
        assert.ok(
            result.errors.some((e) => e.includes('.smoke')),
            `phải nêu target thiếu: ${result.errors.join(' | ')}`
        );
    });

    it('validateScript chấp nhận ambient target tồn tại', () => {
        const script = makeScript([{ move: 'steam', target: '.steam' }, undefined]);
        const result = validateScript(script);
        assert.equal(result.valid, true, result.formattedErrorMessage);
    });

    it('validateAmbientTargets trả rỗng khi không có ambient', () => {
        assert.deepEqual(validateAmbientTargets(makeScript([undefined, undefined])), []);
    });
});

function makeScript(
    ambient: Array<{ move: string; target: string; intensity?: number } | undefined>
): videoScript {
    return {
        id: 'ambient-fixture',
        title: 'Ambient fixture',
        description: '',
        globalStyles: '',
        globalSetupJs: '',
        scenes: ambient.map((item, i) => ({
            ...baseScene,
            id: `scene_${i + 1}`,
            title: `Scene ${i + 1}`,
            htmlCode: `<div id="scene_${i + 1}"><div class="steam">Steam ${i + 1}</div></div>`,
            duration: i === 0 ? 2 : 8,
            nearStill: i === 1 ? { from: 1, to: 3 } : undefined,
            ambient: item ? [item] : undefined,
        })),
        boundaries: ambient.slice(1).map((_, i) => ({
            id: `b${i + 1}`,
            fromScene: `scene_${i + 1}`,
            toScene: `scene_${i + 2}`,
            carry: { element: '.steam', mechanism: 'morph' as const },
        })),
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

describe('assembleHTML — serialize ambient (#125)', () => {
    let workDir: string;
    let html: string;

    before(async () => {
        workDir = mkdtempSync(join(tmpdir(), 'ambient-assemble-'));
        const assembly = await assembleHTML(
            makeScript([{ move: 'steam', target: '.steam', intensity: 1 }, undefined]),
            { scene_1: 2, scene_2: 3 },
            640,
            360,
            workDir
        );
        html = readFileSync(assembly.htmlPath, 'utf-8');
    });

    after(() => {
        rmSync(workDir, { recursive: true, force: true });
    });

    it('ghi resolved ambient (move/target/from/to/period/keys) cho từng scene', () => {
        assert.match(html, /window\.__sceneAmbient\["scene_1"\] = \[\{"move":"steam","target":"\.steam","from":0,"to":2,"period":2\.4,"keys":/);
    });

    it('scene không khai ambient được serialize thành mảng rỗng', () => {
        assert.match(html, /window\.__sceneAmbient\["scene_2"\] = \[\];/);
    });

    it('runtime có __updateAmbient và __seekTo gọi nó', () => {
        assert.match(html, /window\.__updateAmbient = function\(timeInSec\)/);
        assert.match(html, /window\.__seekTo = function\(timeInSec\)[\s\S]{0,400}__updateAmbient\(timeInSec\)/);
        assert.match(html, /window\.__updateAmbient\(0\);/);
    });

    it('ambient không được gắn vào master timeline (tránh duration = Infinity)', () => {
        assert.doesNotMatch(html, /__masterTimeline\.to\([^)]*ambient/i);
    });
});

describe('ambient seek-safe trên Chromium thật (#125)', () => {
    let browser: Browser | null = null;
    let workDir: string;
    let htmlPath: string;

    before(async () => {
        workDir = mkdtempSync(join(tmpdir(), 'ambient-browser-'));
        const assembly = await assembleHTML(
            makeScript([{ move: 'steam', target: '.steam', intensity: 1 }, undefined]),
            { scene_1: 4, scene_2: 2 },
            640,
            360,
            workDir
        );
        htmlPath = assembly.htmlPath;
        try {
            browser = await chromium.launch();
        } catch {
            browser = null;
        }
    });

    after(async () => {
        if (browser) await browser.close();
        rmSync(workDir, { recursive: true, force: true });
    });

    async function signatureAt(page: import('playwright').Page, time: number) {
        return page.evaluate((t: number) => {
            (window as any).__seekTo(t);
            const el = document.querySelector('#scene_1 .steam') as HTMLElement;
            const cs = window.getComputedStyle(el);
            return { transform: cs.transform, opacity: cs.opacity };
        }, time);
    }

    it('t=0 và t=1s khác nhau, seek lùi trả lại đúng trạng thái cũ', async () => {
        if (!browser) {
            const html = readFileSync(htmlPath, 'utf-8');
            assert.match(html, /window\.__sceneAmbient\["scene_1"\]/);
            return;
        }
        const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
        try {
            await page.goto(`file://${htmlPath}`);
            await page.waitForFunction(() => (window as any).__ready === true);

            const start = await signatureAt(page, 0);
            const later = await signatureAt(page, 1);
            assert.notDeepEqual(later, start, 'steam phải chuyển động sau 1s');

            const startAgain = await signatureAt(page, 0);
            assert.deepEqual(startAgain, start, 'seek phải thuần (không trôi)');
        } finally {
            await page.close();
        }
    });

    it('scene không khai ambient giữ nguyên phần tử', async () => {
        if (!browser) return;
        const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
        try {
            await page.goto(`file://${htmlPath}`);
            await page.waitForFunction(() => (window as any).__ready === true);

            const a = await page.evaluate(() => {
                (window as any).__seekTo(4.2);
                const el = document.querySelector('#scene_2 .steam') as HTMLElement;
                return window.getComputedStyle(el).transform;
            });
            const b = await page.evaluate(() => {
                (window as any).__seekTo(5.9);
                const el = document.querySelector('#scene_2 .steam') as HTMLElement;
                return window.getComputedStyle(el).transform;
            });
            assert.equal(a, b, 'scene không ambient không được đổi transform');
        } finally {
            await page.close();
        }
    });
});
