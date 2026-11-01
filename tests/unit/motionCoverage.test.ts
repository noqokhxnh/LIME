import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    checkMotionCoverageLeg,
    computeMotionCoverage,
    runOracleQa,
    type DOMSampler,
    type MotionSampler,
    type SceneMotionSample,
} from '../../src/pipeline/oracleQa.js';
import type { videoScript } from '../../src/llm/schema.js';

function sample(transform: string, opacity = '1'): SceneMotionSample {
    return { elements: [{ path: '0', transform, opacity }] };
}

describe('computeMotionCoverage (#125)', () => {
    it('ít hơn 2 mẫu → 0 và không có khoảng nào', () => {
        assert.deepEqual(computeMotionCoverage([]), {
            coverage: 0,
            movingIntervals: 0,
            totalIntervals: 0,
        });
        assert.deepEqual(computeMotionCoverage([sample('a')]), {
            coverage: 0,
            movingIntervals: 0,
            totalIntervals: 0,
        });
    });

    it('mọi mẫu giống nhau → coverage 0', () => {
        const samples = [sample('none'), sample('none'), sample('none')];
        assert.deepEqual(computeMotionCoverage(samples), {
            coverage: 0,
            movingIntervals: 0,
            totalIntervals: 2,
        });
    });

    it('mọi khoảng đều đổi transform → coverage 1', () => {
        const samples = [sample('a'), sample('b'), sample('c')];
        assert.deepEqual(computeMotionCoverage(samples), {
            coverage: 1,
            movingIntervals: 2,
            totalIntervals: 2,
        });
    });

    it('tính đúng tỉ lệ khi chỉ một phần khoảng có chuyển động', () => {
        const samples = [sample('a'), sample('b'), sample('b'), sample('b')];
        assert.deepEqual(computeMotionCoverage(samples), {
            coverage: 1 / 3,
            movingIntervals: 1,
            totalIntervals: 3,
        });
    });

    it('đổi opacity cũng tính là chuyển động', () => {
        assert.equal(computeMotionCoverage([sample('a', '0'), sample('a', '1')]).coverage, 1);
    });

    it('số phần tử đổi (DOM thay đổi) tính là chuyển động', () => {
        const first: SceneMotionSample = { elements: [{ path: '0', transform: 'a', opacity: '1' }] };
        const second: SceneMotionSample = {
            elements: [
                { path: '0', transform: 'a', opacity: '1' },
                { path: '1', transform: 'a', opacity: '1' },
            ],
        };
        assert.equal(computeMotionCoverage([first, second]).coverage, 1);
    });
});

describe('checkMotionCoverageLeg (#125)', () => {
    it('lấy mẫu đúng cửa sổ thời gian từng scene và trả report-only', async () => {
        const calls: Array<{ t: number; sceneId: string }> = [];
        const sampler: MotionSampler = async (t, sceneId) => {
            calls.push({ t, sceneId });
            // scene_1 chuyển động mọi mẫu; scene_2 đứng yên.
            return sceneId === 'scene_1' ? sample(`t${t}`) : sample('static');
        };

        const leg = await checkMotionCoverageLeg(
            [{ id: 'scene_1' }, { id: 'scene_2' }] as any,
            { scene_1: 2, scene_2: 1 },
            sampler,
            0.5
        );

        assert.equal(leg.status, 'pass');
        assert.equal(leg.strict, false);
        assert.equal(leg.intervalSec, 0.5);
        assert.equal(leg.scenes.length, 2);
        assert.equal(leg.scenes[0].coverage, 1);
        assert.equal(leg.scenes[0].movingIntervals, 4);
        assert.equal(leg.scenes[0].totalIntervals, 4);
        assert.equal(leg.scenes[1].coverage, 0);
        assert.equal(leg.scenes[1].totalIntervals, 2);

        // scene_2 bắt đầu ngay sau scene_1 (t = 2).
        const scene2Calls = calls.filter((c) => c.sceneId === 'scene_2');
        assert.equal(scene2Calls[0].t, 2);
        assert.equal(scene2Calls[scene2Calls.length - 1].t, 3);
    });

    it('scene không có duration được ghi reason thay vì làm hỏng leg', async () => {
        const leg = await checkMotionCoverageLeg(
            [{ id: 'scene_1' }] as any,
            {},
            async () => sample('a')
        );
        assert.equal(leg.status, 'pass');
        assert.equal(leg.scenes[0].coverage, 0);
        assert.match(leg.scenes[0].reason ?? '', /duration/);
    });

    it('sampler trả null → ghi reason, không throw', async () => {
        const leg = await checkMotionCoverageLeg(
            [{ id: 'scene_1' }] as any,
            { scene_1: 1 },
            async () => null
        );
        assert.equal(leg.scenes[0].coverage, 0);
        assert.match(leg.scenes[0].reason ?? '', /không tìm thấy/);
    });

    it('sampler throw → ghi reason, không throw', async () => {
        const leg = await checkMotionCoverageLeg(
            [{ id: 'scene_1' }] as any,
            { scene_1: 1 },
            async () => {
                throw new Error('boom');
            }
        );
        assert.match(leg.scenes[0].reason ?? '', /boom/);
    });
});

const boxSampler: DOMSampler = async () => ({
    left: 100,
    top: 100,
    right: 300,
    bottom: 300,
    width: 200,
    height: 200,
});

function makeScript(): videoScript {
    return {
        id: 'motion-fixture',
        title: 'Motion fixture',
        description: '',
        globalStyles: '',
        globalSetupJs: '',
        scenes: [
            {
                id: 's1',
                title: 'S1',
                voiceOverText: 't1',
                visualDescription: '',
                htmlCode: '<div class="box"></div>',
                cssCode: '',
                jsCode: '',
                transition: 'fade',
                backgroundColor: '#000',
                duration: 2,
                nearStill: { from: 0, to: 2 },
            },
            {
                id: 's2',
                title: 'S2',
                voiceOverText: 't2',
                visualDescription: '',
                htmlCode: '<div class="box"></div>',
                cssCode: '',
                jsCode: '',
                transition: 'none',
                backgroundColor: '#000',
                duration: 8,
                nearStill: { from: 1, to: 3 },
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

describe('runOracleQa — leg motion (#125)', () => {
    it('ghi leg motion vào report, job vẫn pass (report-only)', async () => {
        const report = await runOracleQa({
            script: makeScript(),
            htmlPath: 'mock.html',
            width: 1920,
            height: 1080,
            fps: 30,
            domSampler: boxSampler,
            motionSampler: async (_t, sceneId) =>
                sceneId === 's1' ? sample(`t${_t}`) : sample('static'),
            audioAnalyzer: async () => ({ peakDbfs: -12, quietSec: 1.5 }),
            audioResult: {
                scencesDuration: { s1: 2.0, s2: 8.0 },
                audioFiles: {},
                totalDurationSec: 10.0,
                mixAudioPath: 'mock.mp3',
            },
        });

        assert.equal(report.legs.motion.status, 'pass');
        assert.equal(report.legs.motion.strict, false);
        assert.deepEqual(
            report.legs.motion.scenes.map((s) => ({ id: s.sceneId, coverage: s.coverage })),
            [
                { id: 's1', coverage: 1 },
                { id: 's2', coverage: 0 },
            ]
        );
        assert.equal(report.qaStatus, 'pass');
        assert.equal(report.valid, true);
    });

    it('không truyền motionSampler → leg motion pass với reason', async () => {
        const report = await runOracleQa({
            script: makeScript(),
            htmlPath: 'mock.html',
            width: 1920,
            height: 1080,
            fps: 30,
            domSampler: boxSampler,
            audioAnalyzer: async () => ({ peakDbfs: -12, quietSec: 1.5 }),
            audioResult: {
                scencesDuration: { s1: 2.0, s2: 8.0 },
                audioFiles: {},
                totalDurationSec: 10.0,
                mixAudioPath: 'mock.mp3',
            },
        });
        assert.equal(report.legs.motion.status, 'pass');
        assert.deepEqual(report.legs.motion.scenes, []);
    });
});
