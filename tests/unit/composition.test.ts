import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    measureComposition,
    checkCompositionLeg,
    runOracleQa,
    type CaptionContentElement,
    type CaptionBandSampler,
    type DOMSampler,
} from '../../src/pipeline/oracleQa.js';
import type { videoScript } from '../../src/llm/schema.js';

const W = 1080;
const H = 1920;

function box(left: number, top: number, width: number, height: number) {
    return { left, top, right: left + width, bottom: top + height, width, height };
}

function text(label: string, left: number, top: number, width = 400, height = 100): CaptionContentElement {
    return { label, box: box(left, top, width, height), kind: 'text' };
}

/** 3 phần tử nằm gọn trong 1/3 dưới khung → dồn đáy. */
const BOTTOM_HEAVY: CaptionContentElement[] = [
    text('title', 100, 1400, 800, 120),
    text('subtitle', 150, 1540, 700, 100),
    text('cta', 200, 1660, 600, 120),
];

/** Trải đều 3 vùng dọc → bố cục cân bằng. */
const BALANCED: CaptionContentElement[] = [
    text('kicker', 100, 200, 500, 80),
    text('headline', 100, 800, 800, 200),
    text('footer', 100, 1500, 600, 100),
];

describe('measureComposition — chồng lấn (#111)', () => {
    it('báo chồng lấn khi 2 phần tử chữ giao quá ngưỡng', () => {
        const a = text('a', 100, 100, 400, 200);
        const b = text('b', 300, 150, 400, 200);
        const score = measureComposition('s1', [a, b], W, H);
        assert.equal(score.overlaps.length, 1);
        assert.ok(score.maxTextOverlap >= 0.25);
        assert.equal(score.status, 'warn');
        assert.match(score.violations[0], /chồng lấn/);
    });

    it('strict biến chồng lấn thành fail', () => {
        const a = text('a', 100, 100, 400, 200);
        const b = text('b', 300, 150, 400, 200);
        const score = measureComposition('s1', [a, b], W, H, { strict: true });
        assert.equal(score.status, 'fail');
    });

    it('bỏ qua cặp cha/con (path lồng nhau)', () => {
        const parent = { ...text('card', 100, 100, 400, 300), path: '0' };
        const child = { ...text('label', 120, 140, 300, 100), path: '0/1' };
        const score = measureComposition('s1', [parent, child], W, H);
        assert.equal(score.overlaps.length, 0);
    });

    it('bỏ qua chồng lấn giữa media và chữ (text đè ảnh là chủ ý)', () => {
        const img: CaptionContentElement = {
            label: 'img',
            box: box(100, 100, 600, 400),
            kind: 'media',
        };
        const label = text('label', 150, 150, 400, 200);
        const score = measureComposition('s1', [img, label], W, H);
        assert.equal(score.overlaps.length, 0);
    });

    it('bỏ qua chồng lấn nhỏ dưới ngưỡng', () => {
        const a = text('a', 100, 100, 400, 200);
        const b = text('b', 460, 100, 400, 200); // giao 40px = 10%
        const score = measureComposition('s1', [a, b], W, H);
        assert.equal(score.overlaps.length, 0);
    });
});

describe('measureComposition — dồn đáy (#111)', () => {
    it('báo dồn đáy khi >=3 phần tử nằm ở 1/3 dưới', () => {
        const score = measureComposition('s3', BOTTOM_HEAVY, W, H);
        assert.equal(score.verticalDistribution.bottom, 1);
        assert.equal(score.violations.length, 1);
        assert.match(score.violations[0], /1\/3 dưới/);
        assert.equal(score.status, 'warn');
    });

    it('bố cục trải đều top/middle/bottom thì pass', () => {
        const score = measureComposition('s1', BALANCED, W, H);
        assert.equal(score.violations.length, 0);
        assert.equal(score.status, 'pass');
        assert.ok(score.verticalDistribution.top > 0.1);
        assert.ok(score.verticalDistribution.bottom > 0.1);
    });

    it('chỉ 2 phần tử dồn đáy thì chưa kết luận (cần >=3)', () => {
        const score = measureComposition('s1', BOTTOM_HEAVY.slice(0, 2), W, H);
        assert.equal(score.violations.length, 0);
    });

    it('phần tử nằm ngoài khung được cắt theo khung, không làm sai phân bố', () => {
        const el = text('offscreen', 100, 2600, 400, 100);
        const score = measureComposition('s1', [el], W, H);
        assert.equal(score.elementCount, 0);
        assert.equal(score.status, 'pass');
    });
});

describe('checkCompositionLeg (#111)', () => {
    const scenes = [
        { id: 's1', duration: 2 },
        { id: 's2', duration: 8 },
    ] as any[];

    const sampler: CaptionBandSampler = async (_t, sceneId) => ({
        caption: null,
        elements: sceneId === 's2' ? BOTTOM_HEAVY : BALANCED,
    });

    it('chấm từng scene và trả điểm riêng cho báo cáo', async () => {
        const leg = await checkCompositionLeg(scenes, { s1: 2, s2: 8 }, sampler, W, H);
        assert.equal(leg.scenes.length, 2);
        assert.equal(leg.scenes[0].status, 'pass');
        assert.equal(leg.scenes[1].status, 'warn');
        assert.equal(leg.status, 'warn');
        assert.equal(leg.strict, false);
        assert.equal(leg.violations.length, 1);
        assert.match(leg.reason ?? '', /warn-only/);
    });

    it('strict: leg fail và reason không còn warn-only', async () => {
        const leg = await checkCompositionLeg(scenes, { s1: 2, s2: 8 }, sampler, W, H, {
            strict: true,
        });
        assert.equal(leg.status, 'fail');
        assert.equal(leg.strict, true);
        assert.doesNotMatch(leg.reason ?? '', /warn-only/);
    });

    it('sampler lỗi không làm sập leg', async () => {
        const broken: CaptionBandSampler = async () => {
            throw new Error('boom');
        };
        const leg = await checkCompositionLeg(scenes, { s1: 2, s2: 8 }, broken, W, H);
        assert.equal(leg.status, 'pass');
        assert.equal(leg.scenes.length, 2);
    });
});

function makeScript(): videoScript {
    return {
        id: 's',
        title: 't',
        description: '',
        globalStyles: '',
        globalSetupJs: '',
        scenes: [
            {
                id: 's1',
                title: 'S1',
                voiceOverText: 't1',
                visualDescription: '',
                htmlCode: '<div></div>',
                cssCode: '',
                jsCode: '',
                transition: 'fade',
                backgroundColor: '#000',
                duration: 2,
            },
            {
                id: 's2',
                title: 'S2',
                voiceOverText: 't2',
                visualDescription: '',
                htmlCode: '<div></div>',
                cssCode: '',
                jsCode: '',
                transition: 'none',
                backgroundColor: '#000',
                duration: 8,
                nearStill: { from: 1, to: 3 },
            },
        ],
        boundaries: [],
        colorPalette: { primary: '#000', secondary: '#111', accent: '#222', background: '#333', text: '#fff' },
        fontFamily: 'Inter',
    } as unknown as videoScript;
}

const domSampler: DOMSampler = async () => box(100, 100, 200, 200);

const contentSampler: CaptionBandSampler = async (_t, sceneId) => ({
    caption: null,
    elements: sceneId === 's2' ? BOTTOM_HEAVY : BALANCED,
});

function qaOptions() {
    return {
        script: makeScript(),
        htmlPath: 'mock.html',
        width: W,
        height: H,
        fps: 30,
        domSampler,
        contentSampler,
        audioAnalyzer: async () => ({ peakDbfs: -12, quietSec: 1.5 }),
        audioResult: {
            scencesDuration: { s1: 2.0, s2: 8.0 },
            audioFiles: {},
            totalDurationSec: 10.0,
            mixAudioPath: 'mock.mp3',
        },
    };
}

describe('Leg composition trong Oracle QA (#111)', () => {
    it('warn-only: job vẫn valid, điểm bố cục từng scene nằm trong report', async () => {
        const report = await runOracleQa(qaOptions());
        assert.equal(report.legs.composition.status, 'warn');
        assert.equal(report.qaStatus, 'warn');
        assert.equal(report.valid, true);
        assert.equal(report.legs.composition.scenes.length, 2);
        assert.equal(report.legs.composition.scenes[1].sceneId, 's2');
        assert.ok(report.warnings.some((w) => w.includes('COMPOSITION')));
        assert.equal(report.errors.length, 0);
    });

    it('compositionStrict: vi phạm thành fail và job invalid', async () => {
        const report = await runOracleQa({ ...qaOptions(), compositionStrict: true });
        assert.equal(report.legs.composition.status, 'fail');
        assert.equal(report.qaStatus, 'fail');
        assert.equal(report.valid, false);
        assert.ok(report.errors.some((e) => e.includes('COMPOSITION')));
    });

    it('không có sampler nội dung: leg pass rỗng, không đổi kết quả QA cũ', async () => {
        const { contentSampler: _omit, ...rest } = qaOptions();
        const report = await runOracleQa(rest);
        assert.equal(report.legs.composition.status, 'pass');
        assert.equal(report.legs.composition.scenes.length, 0);
    });
});
