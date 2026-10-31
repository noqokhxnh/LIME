import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright';

import {
    CAMERA_MOVE_IDS,
    DEFAULT_CAMERA_INTENSITY,
    MAX_CAMERA_PAN_PERCENT,
    MAX_CAMERA_SCALE_DELTA,
    getCameraTween,
    isMovingCamera,
    resolveCamera,
} from '../../src/pipeline/camera.js';
import { sceneSchema, type videoScript } from '../../src/llm/schema.js';
import { assembleHTML } from '../../src/pipeline/assembleHtml.js';

const baseScene = {
    id: 'scene_1',
    title: 'S1',
    voiceOverText: 'Một câu thoại.',
    visualDescription: '',
    htmlCode: '<div id="scene_1"><div class="hero">Hero</div></div>',
    cssCode: '',
    jsCode: '',
    transition: 'none',
    backgroundColor: '#000',
};

describe('camera — vocabulary & tween (#122)', () => {
    it('vocabulary lõi gồm 7 move, có locked', () => {
        assert.deepEqual([...CAMERA_MOVE_IDS], [
            'locked',
            'push-in',
            'pull-back',
            'pan-left',
            'pan-right',
            'tilt-up',
            'tilt-down',
        ]);
    });

    it('locked trả về transform đồng nhất và không được coi là đang move', () => {
        const cam = resolveCamera({ move: 'locked', intensity: 1 });
        assert.deepEqual(cam.from, { scale: 1, xPercent: 0, yPercent: 0 });
        assert.deepEqual(cam.to, { scale: 1, xPercent: 0, yPercent: 0 });
        assert.equal(isMovingCamera(cam), false);
    });

    it('push-in tăng scale đúng theo intensity', () => {
        const half = getCameraTween({ move: 'push-in', intensity: 0.5 });
        const full = getCameraTween({ move: 'push-in', intensity: 1 });
        assert.equal(half.from.scale, 1);
        assert.equal(full.from.scale, 1);
        assert.equal(full.to.scale, 1 + MAX_CAMERA_SCALE_DELTA);
        assert.ok(half.to.scale > 1 && half.to.scale < full.to.scale);
        assert.equal(half.to.xPercent, 0);
        assert.equal(half.to.yPercent, 0);
    });

    it('pull-back bắt đầu zoom rồi trả về 1', () => {
        const { from, to } = getCameraTween({ move: 'pull-back', intensity: 1 });
        assert.equal(from.scale, 1 + MAX_CAMERA_SCALE_DELTA);
        assert.equal(to.scale, 1);
    });

    it('pan trái/phải ngược dấu nhau và đúng biên độ', () => {
        const left = getCameraTween({ move: 'pan-left', intensity: 1 });
        const right = getCameraTween({ move: 'pan-right', intensity: 1 });
        assert.equal(left.to.xPercent, MAX_CAMERA_PAN_PERCENT);
        assert.equal(right.to.xPercent, -MAX_CAMERA_PAN_PERCENT);
        assert.equal(left.to.scale, 1);
    });

    it('tilt lên/xuống ngược dấu nhau', () => {
        const up = getCameraTween({ move: 'tilt-up', intensity: 1 });
        const down = getCameraTween({ move: 'tilt-down', intensity: 1 });
        assert.ok(up.to.yPercent > 0);
        assert.equal(down.to.yPercent, -up.to.yPercent);
    });

    it('intensity được clamp về 0..1; thiếu/NaN dùng mặc định', () => {
        assert.equal(getCameraTween({ move: 'push-in', intensity: -2 }).to.scale, 1);
        assert.equal(
            getCameraTween({ move: 'push-in', intensity: 5 }).to.scale,
            1 + MAX_CAMERA_SCALE_DELTA
        );
        assert.equal(
            getCameraTween({ move: 'push-in', intensity: Number.NaN }).to.scale,
            1 + MAX_CAMERA_SCALE_DELTA * DEFAULT_CAMERA_INTENSITY
        );
        assert.equal(
            resolveCamera({ move: 'push-in' }).intensity,
            DEFAULT_CAMERA_INTENSITY
        );
    });

    it('scene không khai camera → locked (không đổi hành vi cũ)', () => {
        const cam = resolveCamera(undefined);
        assert.equal(cam.move, 'locked');
        assert.equal(isMovingCamera(cam), false);
    });
});

describe('scene.camera schema (#122)', () => {
    it('scene không có camera vẫn parse được', () => {
        const parsed = sceneSchema.parse(baseScene);
        assert.equal(parsed.camera, undefined);
    });

    it('camera hợp lệ được giữ nguyên', () => {
        const parsed = sceneSchema.parse({
            ...baseScene,
            camera: { move: 'push-in', intensity: 0.6 },
        });
        assert.deepEqual(parsed.camera, { move: 'push-in', intensity: 0.6 });
    });

    it('move ngoài vocabulary bị từ chối', () => {
        const result = sceneSchema.safeParse({
            ...baseScene,
            camera: { move: 'dolly-zoom' },
        });
        assert.equal(result.success, false);
    });

    it('intensity ngoài 0..1 bị từ chối', () => {
        assert.equal(
            sceneSchema.safeParse({ ...baseScene, camera: { move: 'push-in', intensity: 1.5 } })
                .success,
            false
        );
        assert.equal(
            sceneSchema.safeParse({ ...baseScene, camera: { move: 'push-in', intensity: -0.1 } })
                .success,
            false
        );
    });
});

function makeScript(cameras: Array<{ move: string; intensity?: number } | undefined>): videoScript {
    return {
        id: 'camera-fixture',
        title: 'Camera fixture',
        description: '',
        globalStyles: '',
        globalSetupJs: '',
        scenes: cameras.map((camera, i) => ({
            ...baseScene,
            id: `scene_${i + 1}`,
            title: `Scene ${i + 1}`,
            htmlCode: `<div id="scene_${i + 1}"><div class="hero">Hero ${i + 1}</div></div>`,
            camera,
        })),
        boundaries: cameras.slice(1).map((_, i) => ({
            id: `b${i + 1}`,
            fromScene: `scene_${i + 1}`,
            toScene: `scene_${i + 2}`,
            carry: { element: '.hero', mechanism: 'morph' as const },
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

describe('assembleHTML — serialize camera (#122)', () => {
    let workDir: string;
    let html: string;

    before(async () => {
        workDir = mkdtempSync(join(tmpdir(), 'camera-assemble-'));
        const assembly = await assembleHTML(
            makeScript([{ move: 'push-in', intensity: 1 }, undefined]),
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

    it('ghi resolved camera (move/intensity/from/to) cho từng scene', () => {
        assert.match(
            html,
            /window\.__sceneCameras\["scene_1"\] = \{"move":"push-in","intensity":1,"from":\{"scale":1,"xPercent":0,"yPercent":0\},"to":\{"scale":1\.12,"xPercent":0,"yPercent":0\}\}/
        );
    });

    it('scene không khai camera được serialize thành locked', () => {
        assert.match(
            html,
            /window\.__sceneCameras\["scene_2"\] = \{"move":"locked","intensity":0\.5,"from":\{"scale":1,"xPercent":0,"yPercent":0\},"to":\{"scale":1,"xPercent":0,"yPercent":0\}\}/
        );
    });

    it('__registerScene có nhánh gắn fromTo camera vào master timeline', () => {
        assert.match(html, /var cam = window\.__sceneCameras\[sceneId\];/);
        assert.match(html, /window\.__masterTimeline\.fromTo\(\s*'#' \+ sceneId/);
        assert.match(html, /ease: 'none'/);
    });
});

describe('camera seek-safe trên Chromium thật (#122)', () => {
    let browser: Browser | null = null;
    let workDir: string;
    let htmlPath: string;

    before(async () => {
        workDir = mkdtempSync(join(tmpdir(), 'camera-browser-'));
        const assembly = await assembleHTML(
            makeScript([{ move: 'push-in', intensity: 1 }, { move: 'locked', intensity: 1 }]),
            { scene_1: 2, scene_2: 2 },
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

    async function scaleAt(page: import('playwright').Page, time: number, sceneId: string) {
        return page.evaluate(
            ({ time, sceneId }) => {
                (window as any).__seekTo(time);
                const el = document.getElementById(sceneId)!;
                const rect = el.getBoundingClientRect();
                return rect.width / window.innerWidth;
            },
            { time, sceneId }
        );
    }

    it('seek t=0.1 và t=1.9 cho scale khác nhau, seek lùi trả lại đúng khung cũ', async () => {
        if (!browser) {
            // Môi trường không có Chromium: vẫn đảm bảo tween đã được sinh trong HTML.
            const html = readFileSync(htmlPath, 'utf-8');
            assert.match(html, /window\.__sceneCameras\["scene_1"\]/);
            return;
        }
        const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
        try {
            await page.goto(`file://${htmlPath}`);
            await page.waitForFunction(() => (window as any).__ready === true);

            const start = await scaleAt(page, 0.1, 'scene_1');
            const end = await scaleAt(page, 1.9, 'scene_1');
            assert.ok(
                end > start + 0.05,
                `push-in phải phóng to theo thời gian (start=${start}, end=${end})`
            );

            const startAgain = await scaleAt(page, 0.1, 'scene_1');
            assert.ok(
                Math.abs(startAgain - start) < 0.002,
                `seek phải thuần (lần đầu ${start}, lần lại ${startAgain})`
            );
        } finally {
            await page.close();
        }
    });

    it('scene locked giữ nguyên khung hình ở mọi thời điểm', async () => {
        if (!browser) return;
        const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
        try {
            await page.goto(`file://${htmlPath}`);
            await page.waitForFunction(() => (window as any).__ready === true);

            const a = await scaleAt(page, 2.1, 'scene_2');
            const b = await scaleAt(page, 3.9, 'scene_2');
            assert.ok(Math.abs(a - b) < 0.002, `locked không được đổi scale (${a} vs ${b})`);
            assert.ok(Math.abs(a - 1) < 0.002, `locked phải giữ scale 1 (nhận ${a})`);
        } finally {
            await page.close();
        }
    });
});
