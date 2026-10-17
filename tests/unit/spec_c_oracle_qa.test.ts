import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';

import {
    type videoScript,
    type scene,
    type Boundary,
    type AudioResult,
    type videoRequest,
} from '../../src/llm/schema.js';
import {
    runOracleQa,
    checkRhythmLeg,
    checkContinuityLeg,
    checkCurvesLeg,
    checkFramingLeg,
    checkAudioLeg,
    type DOMBox,
    type DOMSampler,
    type BatchDOMSampler,
    type QAReport,
} from '../../src/pipeline/oracleQa.js';
import { runFullPipeline } from '../../src/pipeline/orchestrator.js';
import { setLLMClient, resetLLMClient, type LLMClient } from '../../src/llm/client.js';
import { setTTSClient, resetTTSClient, generateSilence, type TTSClient } from '../../src/pipeline/audioSysnthesis.js';
import { resetConfig } from '../../src/config.js';
import { MemoryQueue } from '../../src/queue/memoryQueue.js';

describe('Workstream WS-C (Spec C): Oracle QA Pipeline & Auto Validation', () => {

    // =========================================================================
    // SUITE 1: LEG 1 - RHYTHM
    // =========================================================================
    describe('Leg 1: Rhythm (Kiểm định nhịp điệu & đa dạng thời lượng)', () => {
        it('phải thất bại (fail) khi kịch bản có nhịp đều (CV < 0.3 - uniform cadence)', () => {
            const scenes: scene[] = [
                { id: 's1', title: 'S1', duration: 3.0, voiceOverText: 't1', visualDescription: '', htmlCode: '', cssCode: '', jsCode: '', transition: 'fade', backgroundColor: '#000' },
                { id: 's2', title: 'S2', duration: 3.0, voiceOverText: 't2', visualDescription: '', htmlCode: '', cssCode: '', jsCode: '', transition: 'none', backgroundColor: '#000' },
                { id: 's3', title: 'S3', duration: 3.0, voiceOverText: 't3', visualDescription: '', htmlCode: '', cssCode: '', jsCode: '', transition: 'none', backgroundColor: '#000' },
            ];
            const result = checkRhythmLeg(scenes);
            assert.strictEqual(result.status, 'fail');
            assert.ok(result.cv < 0.3);
            assert.ok(result.reason?.includes('CV'));
        });

        it('phải thất bại (fail) khi tỉ số max/min < 4', () => {
            const scenes: scene[] = [
                { id: 's1', title: 'S1', duration: 2.0, voiceOverText: 't1', visualDescription: '', htmlCode: '', cssCode: '', jsCode: '', transition: 'fade', backgroundColor: '#000' },
                { id: 's2', title: 'S2', duration: 3.0, voiceOverText: 't2', visualDescription: '', htmlCode: '', cssCode: '', jsCode: '', transition: 'none', backgroundColor: '#000' },
                { id: 's3', title: 'S3', duration: 6.0, voiceOverText: 't3', visualDescription: '', htmlCode: '', cssCode: '', jsCode: '', transition: 'none', backgroundColor: '#000' },
            ];
            // 6 / 2 = 3 < 4
            const result = checkRhythmLeg(scenes);
            assert.strictEqual(result.status, 'fail');
            assert.ok((result.ratio ?? 0) < 4);
            assert.ok(result.reason?.includes('Tỉ số'));
        });

        it('phải cảnh báo (warn) khi thiếu khoảng near-still >= 1.5s dù CV và ratio đạt chuẩn', () => {
            const scenes: scene[] = [
                { id: 's1', title: 'S1', duration: 2.0, voiceOverText: 't1', visualDescription: '', htmlCode: '', cssCode: '', jsCode: '', transition: 'fade', backgroundColor: '#000' },
                { id: 's2', title: 'S2', duration: 6.0, voiceOverText: 't2', visualDescription: '', htmlCode: '', cssCode: '', jsCode: '', transition: 'none', backgroundColor: '#000' },
                { id: 's3', title: 'S3', duration: 10.0, voiceOverText: 't3', visualDescription: '', htmlCode: '', cssCode: '', jsCode: '', transition: 'none', backgroundColor: '#000' },
            ];
            // ratio = 10 / 2 = 5 >= 4, CV >= 0.3, nhưng không có nearStill
            const result = checkRhythmLeg(scenes);
            assert.strictEqual(result.status, 'warn');
            assert.ok(result.cv >= 0.3);
            assert.ok((result.ratio ?? 0) >= 4);
            assert.ok(result.reason?.includes('near-still'));
        });

        it('phải đạt chuẩn (pass) khi CV >= 0.3, ratio >= 4 và có near-still >= 1.5s', () => {
            const scenes: scene[] = [
                { id: 's1', title: 'S1', duration: 2.0, voiceOverText: 't1', visualDescription: '', htmlCode: '', cssCode: '', jsCode: '', transition: 'fade', backgroundColor: '#000' },
                { id: 's2', title: 'S2', duration: 6.0, nearStill: { from: 1.0, to: 3.0 }, voiceOverText: 't2', visualDescription: '', htmlCode: '', cssCode: '', jsCode: '', transition: 'none', backgroundColor: '#000' },
                { id: 's3', title: 'S3', duration: 10.0, voiceOverText: 't3', visualDescription: '', htmlCode: '', cssCode: '', jsCode: '', transition: 'none', backgroundColor: '#000' },
            ];
            const result = checkRhythmLeg(scenes);
            assert.strictEqual(result.status, 'pass');
            assert.ok(result.cv >= 0.3);
            assert.ok((result.ratio ?? 0) >= 4);
            assert.strictEqual(result.nearStillSec, 1.5);
        });

        it('phải pass an toàn khi kịch bản chỉ có 1 scene hoặc rỗng', () => {
            const singleScene: scene[] = [
                { id: 's1', title: 'S1', duration: 5.0, voiceOverText: 't1', visualDescription: '', htmlCode: '', cssCode: '', jsCode: '', transition: 'none', backgroundColor: '#000' },
            ];
            const result = checkRhythmLeg(singleScene);
            assert.strictEqual(result.status, 'pass');
            assert.strictEqual(result.cv, 0);
        });
    });

    // =========================================================================
    // SUITE 2: LEG 2 - CONTINUITY (CARRY SCORE)
    // =========================================================================
    describe('Leg 2: Continuity (Carry Score & Chuyển động liên tục)', () => {
        const scenes: scene[] = [
            { id: 's1', title: 'S1', duration: 3.0, voiceOverText: '', visualDescription: '', htmlCode: '', cssCode: '', jsCode: '', transition: 'fade', backgroundColor: '#000' },
            { id: 's2', title: 'S2', duration: 3.0, voiceOverText: '', visualDescription: '', htmlCode: '', cssCode: '', jsCode: '', transition: 'none', backgroundColor: '#000' },
        ];
        const durations = { s1: 3.0, s2: 3.0 };
        const width = 1920;
        const height = 1080;

        it('phải đạt (pass) khi phần tử carry có bounding box overlap tại mốc t-0.15s và t+0.15s', async () => {
            const boundaries: Boundary[] = [
                { id: 'b1', fromScene: 's1', toScene: 's2', carry: { element: '#logo', mechanism: 'morph' } },
            ];
            // Mock sampler: vị trí overlap
            const domSampler: DOMSampler = async (t, selector) => {
                if (selector === '#logo') {
                    return { left: 100, top: 100, right: 300, bottom: 250, width: 200, height: 150 };
                }
                return null;
            };

            const result = await checkContinuityLeg(boundaries, scenes, durations, domSampler, width, height);
            assert.strictEqual(result.status, 'pass');
            assert.strictEqual(result.carryScore, 1.0);
            assert.strictEqual(result.failed, undefined);
        });

        it('phải đạt (pass) khi phần tử dịch chuyển trong phạm vi <= 40% đường chéo viewport', async () => {
            const boundaries: Boundary[] = [
                { id: 'b1', fromScene: 's1', toScene: 's2', carry: { element: '#badge', mechanism: 'morph' } },
            ];
            // Diagonal = sqrt(1920^2 + 1080^2) = ~2202.9px; 40% = ~881px
            const domSampler: DOMSampler = async (t, selector) => {
                if (t < 3.0) {
                    return { left: 100, top: 100, right: 200, bottom: 200, width: 100, height: 100 };
                } else {
                    // Dịch chuyển 300px ngang (<= 881px)
                    return { left: 400, top: 100, right: 500, bottom: 200, width: 100, height: 100 };
                }
            };

            const result = await checkContinuityLeg(boundaries, scenes, durations, domSampler, width, height);
            assert.strictEqual(result.status, 'pass');
            assert.strictEqual(result.carryScore, 1.0);
        });

        it('phải thất bại (fail) boundary khi phần tử nhảy vị trí quá 40% đường chéo', async () => {
            const boundaries: Boundary[] = [
                { id: 'b1', fromScene: 's1', toScene: 's2', carry: { element: '#badge', mechanism: 'morph' } },
            ];
            // Dịch chuyển 1500px ngang (> 881px)
            const domSampler: DOMSampler = async (t, selector) => {
                if (t < 3.0) {
                    return { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 };
                } else {
                    return { left: 1500, top: 900, right: 1600, bottom: 1000, width: 100, height: 100 };
                }
            };

            const result = await checkContinuityLeg(boundaries, scenes, durations, domSampler, width, height);
            assert.strictEqual(result.status, 'fail');
            assert.strictEqual(result.carryScore, 0.0);
            assert.ok(result.failed?.[0].includes('nhảy vị trí quá xa'));
        });

        it('phải thất bại (fail) boundary khi phần tử biến mất đột ngột tại mốc chuyển cảnh', async () => {
            const boundaries: Boundary[] = [
                { id: 'b1', fromScene: 's1', toScene: 's2', carry: { element: '#hero', mechanism: 'zoomThrough' } },
            ];
            const domSampler: DOMSampler = async (t, selector) => {
                if (t < 3.0) {
                    return { left: 100, top: 100, right: 200, bottom: 200, width: 100, height: 100 };
                }
                return null; // Biến mất sau mốc t
            };

            const result = await checkContinuityLeg(boundaries, scenes, durations, domSampler, width, height);
            assert.strictEqual(result.status, 'fail');
            assert.strictEqual(result.carryScore, 0);
            assert.ok(result.failed?.[0].includes('biến mất'));
        });

        it('chấp nhận hardCut có lý do hợp lệ (tính là đạt)', async () => {
            const boundaries: Boundary[] = [
                {
                    id: 'b1',
                    fromScene: 's1',
                    toScene: 's2',
                    carry: { element: '#dummy', mechanism: 'hardCut', reason: 'Chuyển đổi hoàn toàn góc nhìn sang chủ đề mới' },
                },
            ];
            const domSampler: DOMSampler = async () => null;

            const result = await checkContinuityLeg(boundaries, scenes, durations, domSampler, width, height);
            assert.strictEqual(result.status, 'pass');
            assert.strictEqual(result.carryScore, 1.0);
        });

        it('tính toán phân loại carryScore chính xác: fail (<0.5), warn (0.5..0.75), pass (>=0.75)', async () => {
            const threeScenes: scene[] = [
                { id: 's1', title: 'S1', duration: 2.0, voiceOverText: '', visualDescription: '', htmlCode: '', cssCode: '', jsCode: '', transition: 'fade', backgroundColor: '#000' },
                { id: 's2', title: 'S2', duration: 2.0, voiceOverText: '', visualDescription: '', htmlCode: '', cssCode: '', jsCode: '', transition: 'none', backgroundColor: '#000' },
                { id: 's3', title: 'S3', duration: 2.0, voiceOverText: '', visualDescription: '', htmlCode: '', cssCode: '', jsCode: '', transition: 'none', backgroundColor: '#000' },
                { id: 's4', title: 'S4', duration: 2.0, voiceOverText: '', visualDescription: '', htmlCode: '', cssCode: '', jsCode: '', transition: 'none', backgroundColor: '#000' },
            ];
            const d = { s1: 2.0, s2: 2.0, s3: 2.0, s4: 2.0 };
            const b: Boundary[] = [
                { id: 'b1', fromScene: 's1', toScene: 's2', carry: { element: '#e1', mechanism: 'morph' } },
                { id: 'b2', fromScene: 's2', toScene: 's3', carry: { element: '#e2', mechanism: 'morph' } },
                { id: 'b3', fromScene: 's3', toScene: 's4', carry: { element: '#e3', mechanism: 'morph' } },
            ];

            // Trường hợp 2/3 đạt = 0.67 -> warn
            const samplerWarn: DOMSampler = async (t, sel) => {
                if (sel === '#e1' || sel === '#e2') {
                    return { left: 50, top: 50, right: 100, bottom: 100, width: 50, height: 50 };
                }
                return null; // #e3 fail
            };
            const resWarn = await checkContinuityLeg(b, threeScenes, d, samplerWarn, width, height);
            assert.strictEqual(resWarn.status, 'warn');
            assert.strictEqual(resWarn.carryScore, 0.67);

            // Trường hợp 1/3 đạt = 0.33 -> fail
            const samplerFail: DOMSampler = async (t, sel) => {
                if (sel === '#e1') {
                    return { left: 50, top: 50, right: 100, bottom: 100, width: 50, height: 50 };
                }
                return null;
            };
            const resFail = await checkContinuityLeg(b, threeScenes, d, samplerFail, width, height);
            assert.strictEqual(resFail.status, 'fail');
            assert.strictEqual(resFail.carryScore, 0.33);
        });
    });

    // =========================================================================
    // SUITE 3: LEG 3 - CURVES (DISPLACEMENT & SPEED LIMIT)
    // =========================================================================
    describe('Leg 3: Curves (Displacement & Tốc độ chuyển động)', () => {
        const scenes: scene[] = [
            { id: 's1', title: 'S1', duration: 2.0, voiceOverText: '', visualDescription: '', htmlCode: '', cssCode: '', jsCode: '', transition: 'fade', backgroundColor: '#000', subject: '#ball' },
        ];
        const durations = { s1: 2.0 };
        const boundaries: Boundary[] = [];

        it('phải đạt (pass) khi độ dịch chuyển <= 80 px/frame tại 30 fps', async () => {
            // Giả sử ball di chuyển 600px trong 0.5s:
            // pxPerFrame = (600 / 0.5) / 30 = 40 px/frame <= 80
            const domSampler: DOMSampler = async (t) => {
                const x = 100 + t * 300;
                return { left: x, top: 100, right: x + 50, bottom: 150, width: 50, height: 50 };
            };

            const result = await checkCurvesLeg(scenes, durations, boundaries, domSampler, 30, false);
            assert.strictEqual(result.status, 'pass');
            assert.ok(result.maxPxPerFrame <= 80);
        });

        it('phải thất bại (fail) khi độ dịch chuyển > 80 px/frame mà không có shutter blur', async () => {
            // Giả sử ball dịch chuyển 3600px trong 1s (1800px trong 0.5s):
            // pxPerFrame = (1800 / 0.5) / 30 = 120 px/frame > 80
            const domSampler: DOMSampler = async (t) => {
                const x = 100 + t * 3600;
                return { left: x, top: 100, right: x + 50, bottom: 150, width: 50, height: 50 };
            };

            const result = await checkCurvesLeg(scenes, durations, boundaries, domSampler, 30, false);
            assert.strictEqual(result.status, 'fail');
            assert.ok(result.maxPxPerFrame > 80);
            assert.ok(result.reason?.includes('shutter blur'));
        });

        it('phải đạt (pass) khi độ dịch chuyển > 80 px/frame nhưng có khai báo shutter blur', async () => {
            const domSampler: DOMSampler = async (t) => {
                const x = 100 + t * 3600;
                return { left: x, top: 100, right: x + 50, bottom: 150, width: 50, height: 50 };
            };

            const result = await checkCurvesLeg(scenes, durations, boundaries, domSampler, 30, true);
            assert.strictEqual(result.status, 'pass');
            assert.ok(result.maxPxPerFrame > 80);
        });

        it('hoạt động chính xác và hiệu quả khi sử dụng batchDomSampler', async () => {
            const scenes: scene[] = [
                { id: 's1', title: 'S1', duration: 2.0, voiceOverText: '', visualDescription: '', htmlCode: '', cssCode: '', jsCode: '', transition: 'none', backgroundColor: '#000' },
            ];
            const durations = { s1: 2.0 };
            const boundaries: Boundary[] = [];
            let batchCallCount = 0;
            const batchDomSampler: BatchDOMSampler = async (t, selectors) => {
                batchCallCount++;
                const out: Record<string, DOMBox | null> = {};
                for (const sel of selectors) {
                    out[sel] = { left: 100 + t * 200, top: 100, right: 150, bottom: 150, width: 50, height: 50 };
                }
                return out;
            };
            const domSampler: DOMSampler = async () => null;

            const result = await checkCurvesLeg(scenes, durations, boundaries, domSampler, 30, false, batchDomSampler);
            assert.strictEqual(result.status, 'pass');
            assert.ok(batchCallCount > 0, 'batchDomSampler phải được gọi thay vì domSampler tuần tự');
        });
    });

    // =========================================================================
    // SUITE 4: LEG 4 - FRAMING (SUBJECT BOUNDING BOX)
    // =========================================================================
    describe('Leg 4: Framing (Chủ thể luôn nằm trong khung hình)', () => {
        const width = 1920;
        const height = 1080;

        it('phải đạt (pass) khi kịch bản không khai báo subject', async () => {
            const scenes: scene[] = [
                { id: 's1', title: 'S1', duration: 2.0, voiceOverText: '', visualDescription: '', htmlCode: '', cssCode: '', jsCode: '', transition: 'none', backgroundColor: '#000' },
            ];
            const domSampler: DOMSampler = async () => null;

            const result = await checkFramingLeg(scenes, { s1: 2.0 }, domSampler, width, height);
            assert.strictEqual(result.status, 'pass');
            assert.strictEqual(result.outOfBoundsSamples, 0);
        });

        it('phải đạt (pass) khi subject luôn nằm hoàn toàn bên trong viewport', async () => {
            const scenes: scene[] = [
                { id: 's1', title: 'S1', duration: 2.0, subject: '#hero-img', voiceOverText: '', visualDescription: '', htmlCode: '', cssCode: '', jsCode: '', transition: 'none', backgroundColor: '#000' },
            ];
            const domSampler: DOMSampler = async () => ({
                left: 500,
                top: 300,
                right: 900,
                bottom: 700,
                width: 400,
                height: 400,
            });

            const result = await checkFramingLeg(scenes, { s1: 2.0 }, domSampler, width, height);
            assert.strictEqual(result.status, 'pass');
            assert.strictEqual(result.outOfBoundsSamples, 0);
        });

        it('phải thất bại (fail) khi subject rời khung hình mà không khai báo exit', async () => {
            const scenes: scene[] = [
                { id: 's1', title: 'S1', duration: 2.0, subject: '#hero-img', voiceOverText: '', visualDescription: 'Giới thiệu nhân vật chính tập trung giữa màn hình', htmlCode: '', cssCode: '', jsCode: '', transition: 'none', backgroundColor: '#000' },
            ];
            // Sample tại t >= 1.0 bị trôi ra khỏi màn hình (left = 2000 > width 1920)
            const domSampler: DOMSampler = async (t) => {
                if (t >= 1.0) {
                    return { left: 2000, top: 300, right: 2400, bottom: 700, width: 400, height: 400 };
                }
                return { left: 500, top: 300, right: 900, bottom: 700, width: 400, height: 400 };
            };

            const result = await checkFramingLeg(scenes, { s1: 2.0 }, domSampler, width, height);
            assert.strictEqual(result.status, 'fail');
            assert.ok((result.outOfBoundsSamples ?? 0) > 0);
            assert.ok(result.reason?.includes('rơi ra ngoài khung hình'));
        });

        it('phải đạt (pass) khi subject rời khung hình nhưng có khai báo exit có chủ đích', async () => {
            const scenes: scene[] = [
                { id: 's1', title: 'S1', duration: 2.0, subject: '#hero-img', voiceOverText: '', visualDescription: 'Nhân vật nói xong và exit lướt ra ngoài màn hình', htmlCode: '', cssCode: '', jsCode: '', transition: 'slide-left', backgroundColor: '#000' },
            ];
            const domSampler: DOMSampler = async () => ({
                left: 2000,
                top: 300,
                right: 2400,
                bottom: 700,
                width: 400,
                height: 400,
            });

            const result = await checkFramingLeg(scenes, { s1: 2.0 }, domSampler, width, height);
            assert.strictEqual(result.status, 'pass');
            assert.strictEqual(result.outOfBoundsSamples, 0);
        });

        it('hỗ trợ batchDomSampler khi kiểm tra framing', async () => {
            const scenes: scene[] = [
                { id: 's1', title: 'S1', duration: 2.0, subject: '#hero-img', voiceOverText: '', visualDescription: '', htmlCode: '', cssCode: '', jsCode: '', transition: 'none', backgroundColor: '#000' },
            ];
            let batchCalled = false;
            const batchDomSampler: BatchDOMSampler = async (_t, selectors) => {
                batchCalled = true;
                return {
                    [selectors[0]]: { left: 100, top: 100, right: 300, bottom: 300, width: 200, height: 200 },
                };
            };
            const domSampler: DOMSampler = async () => null;
            const result = await checkFramingLeg(scenes, { s1: 2.0 }, domSampler, width, height, batchDomSampler);
            assert.strictEqual(result.status, 'pass');
            assert.ok(batchCalled);
        });
    });

    // =========================================================================
    // SUITE 5: LEG 5 - AUDIO QUALITY & PACING
    // =========================================================================
    describe('Leg 5: Audio (Âm lượng đỉnh Peak dBFS & Nhịp thở nghỉ nói)', () => {
        it('phải thất bại (fail) khi peak volume >= -3 dBFS (nguy cơ clipping méo tiếng)', async () => {
            const mockAnalyzer = async () => ({ peakDbfs: -1.2, quietSec: 1.5 });
            const result = await checkAudioLeg('dummy.mp3', 10.0, mockAnalyzer);
            assert.strictEqual(result.status, 'fail');
            assert.ok(result.reason?.includes('clipping'));
        });

        it('phải cảnh báo (warn) khi video >= 3s nhưng không có khoảng lặng quietSec >= 1s', async () => {
            const mockAnalyzer = async () => ({ peakDbfs: -12.0, quietSec: 0.3 });
            const result = await checkAudioLeg('dummy.mp3', 10.0, mockAnalyzer);
            assert.strictEqual(result.status, 'warn');
            assert.ok(result.reason?.includes('khoảng lặng nghỉ nói'));
        });

        it('phải đạt chuẩn (pass) khi peak < -3 dBFS và có khoảng lặng quietSec >= 1s', async () => {
            const mockAnalyzer = async () => ({ peakDbfs: -9.5, quietSec: 1.8 });
            const result = await checkAudioLeg('dummy.mp3', 10.0, mockAnalyzer);
            assert.strictEqual(result.status, 'pass');
            assert.strictEqual(result.peakDbfs, -9.5);
            assert.strictEqual(result.quietSec, 1.8);
        });

        it('xử lý an toàn khi không có file audio hoặc môi trường test', async () => {
            const result = await checkAudioLeg(undefined, 0);
            assert.strictEqual(result.status, 'pass');
        });
    });

    // =========================================================================
    // SUITE 6: RUN ORACLE QA - ĐÁNH GIÁ TỔNG HỢP TOÀN DIỆN
    // =========================================================================
    describe('runOracleQa: Tổng hợp kết quả 5 legs vào QAReport', () => {
        const validScript: videoScript = {
            id: 'qa-script-01',
            title: 'Kịch bản kiểm thử chuẩn',
            description: 'Kịch bản hoàn hảo vượt qua cả 5 legs',
            globalStyles: 'body { margin: 0; }',
            globalSetupJs: 'console.log("ready");',
            scenes: [
                {
                    id: 's1',
                    title: 'Intro',
                    duration: 2.0,
                    subject: '#hero',
                    voiceOverText: 'Chào mừng bạn.',
                    visualDescription: '',
                    htmlCode: '<div id="s1"><div id="hero">Hero</div></div>',
                    cssCode: '',
                    jsCode: '',
                    transition: 'fade',
                    backgroundColor: '#000',
                },
                {
                    id: 's2',
                    title: 'Main',
                    duration: 8.0,
                    nearStill: { from: 2.0, to: 4.0 },
                    subject: '#hero',
                    voiceOverText: 'Nội dung chính với khoảng lặng cần thiết.',
                    visualDescription: '',
                    htmlCode: '<div id="s2"><div id="hero">Hero</div></div>',
                    cssCode: '',
                    jsCode: '',
                    transition: 'none',
                    backgroundColor: '#000',
                },
            ],
            boundaries: [
                {
                    id: 'b1',
                    fromScene: 's1',
                    toScene: 's2',
                    carry: { element: '#hero', mechanism: 'morph' },
                },
            ],
            colorPalette: { primary: '#000', secondary: '#111', accent: '#222', background: '#333', text: '#fff' },
            fontFamily: 'Inter',
        };

        it('comp chuẩn phải nhận qaStatus: pass và valid: true', async () => {
            const domSampler: DOMSampler = async () => ({
                left: 100,
                top: 100,
                right: 300,
                bottom: 300,
                width: 200,
                height: 200,
            });
            const audioAnalyzer = async () => ({ peakDbfs: -12, quietSec: 1.5 });

            const report = await runOracleQa({
                script: validScript,
                htmlPath: 'mock.html',
                width: 1920,
                height: 1080,
                fps: 30,
                domSampler,
                audioAnalyzer,
                audioResult: {
                    scencesDuration: { s1: 2.0, s2: 8.0 },
                    audioFiles: {},
                    totalDurationSec: 10.0,
                    mixAudioPath: 'mock.mp3',
                },
            });

            assert.strictEqual(report.qaStatus, 'pass');
            assert.strictEqual(report.valid, true);
            assert.strictEqual(report.carryScore, 1.0);
            assert.strictEqual(report.errors.length, 0);
            assert.strictEqual(report.legs.rhythm.status, 'pass');
            assert.strictEqual(report.legs.continuity.status, 'pass');
            assert.strictEqual(report.legs.curves.status, 'pass');
            assert.strictEqual(report.legs.framing.status, 'pass');
            assert.strictEqual(report.legs.audio.status, 'pass');
        });

        it('comp có lỗi nghiêm trọng (ví dụ rhythm CV < 0.3) phải nhận qaStatus: fail và valid: false', async () => {
            const uniformScript: videoScript = {
                ...validScript,
                scenes: [
                    { ...validScript.scenes[0], duration: 3.0 },
                    { ...validScript.scenes[1], duration: 3.0 },
                ],
            };

            const domSampler: DOMSampler = async () => ({
                left: 100,
                top: 100,
                right: 300,
                bottom: 300,
                width: 200,
                height: 200,
            });

            const report = await runOracleQa({
                script: uniformScript,
                htmlPath: 'mock.html',
                width: 1920,
                height: 1080,
                fps: 30,
                domSampler,
                audioResult: {
                    scencesDuration: { s1: 3.0, s2: 3.0 },
                    audioFiles: {},
                    totalDurationSec: 6.0,
                    mixAudioPath: 'mock.mp3',
                },
            });

            assert.strictEqual(report.qaStatus, 'fail');
            assert.strictEqual(report.valid, false);
            assert.ok(report.errors.length > 0);
            assert.ok(report.errors.some((e) => e.includes('RHYTHM')));
        });
    });

    // =========================================================================
    // SUITE 7: INTEGRATION - ORCHESTRATOR PIPELINE REROLL & RECOVERY
    // =========================================================================
    describe('Pipeline Integration: Cơ chế Reroll tự động và xử lý an toàn khi QA Thất bại', () => {
        let testTempDir: string;
        let mockTTS: TTSClient;

        class MockFailOnceThenPassLLM implements LLMClient {
            readonly provider = 'mock-retry-llm';
            public callCount = 0;
            public receivedPrompts: string[] = [];

            constructor(
                private badScript: videoScript,
                private goodScript: videoScript
            ) {}

            async generate(_sys: string, userPrompt: string): Promise<string> {
                this.callCount++;
                this.receivedPrompts.push(userPrompt);
                // Lần đầu trả về badScript (uniform cadence), lần 2 trả về goodScript (đạt chuẩn)
                if (this.callCount === 1) {
                    return JSON.stringify(this.badScript);
                }
                return JSON.stringify(this.goodScript);
            }
        }

        const badScript: videoScript = {
            id: 'bad-script',
            title: 'Kịch bản nhịp đều bị loại',
            description: '',
            globalStyles: 'body { margin: 0; }',
            globalSetupJs: 'console.log("ready");',
            scenes: [
                {
                    id: 's1',
                    title: 'Cảnh 1',
                    voiceOverText: 'Một câu ngắn.',
                    visualDescription: '',
                    htmlCode: '<div id="s1"><div class="box">Box</div></div>',
                    cssCode: '',
                    jsCode: 'tl.to("#s1", { duration: {{SCENE_DURATION}}, opacity: 1 });',
                    transition: 'fade',
                    backgroundColor: '#000',
                },
                {
                    id: 's2',
                    title: 'Cảnh 2',
                    voiceOverText: 'Hai câu ngắn.',
                    visualDescription: '',
                    htmlCode: '<div id="s2"><div class="box">Box</div></div>',
                    cssCode: '',
                    jsCode: 'tl.to("#s2", { duration: {{SCENE_DURATION}}, opacity: 1 });',
                    transition: 'none',
                    backgroundColor: '#000',
                },
            ],
            boundaries: [
                { id: 'b1', fromScene: 's1', toScene: 's2', carry: { element: '.box', mechanism: 'morph' } },
            ],
            colorPalette: { primary: '#000', secondary: '#111', accent: '#222', background: '#333', text: '#fff' },
            fontFamily: 'Inter',
        };

        const goodScript: videoScript = {
            id: 'good-script',
            title: 'Kịch bản đạt chuẩn',
            description: '',
            globalStyles: 'body { margin: 0; }',
            globalSetupJs: 'console.log("ready");',
            scenes: [
                {
                    id: 's1',
                    title: 'Cảnh 1',
                    duration: 2.0,
                    voiceOverText: 'Một câu thật ngắn.',
                    visualDescription: '',
                    htmlCode: '<div id="s1"><div class="box">Box</div></div>',
                    cssCode: '',
                    jsCode: 'tl.to("#s1", { duration: {{SCENE_DURATION}}, opacity: 1 });',
                    transition: 'fade',
                    backgroundColor: '#000',
                },
                {
                    id: 's2',
                    title: 'Cảnh 2',
                    duration: 10.0,
                    nearStill: { from: 2.0, to: 4.0 },
                    voiceOverText: 'Một đoạn hội thoại dài và chi tiết có điểm nhấn với khoảng dừng hợp lý.',
                    visualDescription: '',
                    htmlCode: '<div id="s2"><div class="box">Box</div></div>',
                    cssCode: '',
                    jsCode: 'tl.to("#s2", { duration: {{SCENE_DURATION}}, opacity: 1 });',
                    transition: 'none',
                    backgroundColor: '#000',
                },
            ],
            boundaries: [
                { id: 'b1', fromScene: 's1', toScene: 's2', carry: { element: '.box', mechanism: 'morph' } },
            ],
            colorPalette: { primary: '#000', secondary: '#111', accent: '#222', background: '#333', text: '#fff' },
            fontFamily: 'Inter',
        };

        class DynamicTTS implements TTSClient {
            readonly provider = 'dynamic-tts';
            async synthesize(text: string, outputPath: string): Promise<void> {
                // Nếu text ngắn thì 2s, nếu dài thì 10s (đảm bảo ratio >= 4.0 kể cả khi ffprobe có sai số nhẹ)
                const dur = text.includes('dài và chi tiết') ? 10.0 : 2.0;
                await generateSilence(outputPath, dur);
            }
        }

        beforeEach(() => {
            resetConfig();
            resetLLMClient();
            resetTTSClient();
            testTempDir = mkdtempSync(join(tmpdir(), 'spec-c-qa-test-'));
        });

        afterEach(() => {
            resetConfig();
            resetLLMClient();
            resetTTSClient();
            if (existsSync(testTempDir)) {
                rmSync(testTempDir, { recursive: true, force: true });
            }
        });

        it('phải tự động reroll và truyền feedback QA sang LLM khi lần 1 bị lỗi', async () => {
            const llm = new MockFailOnceThenPassLLM(badScript, goodScript);
            setLLMClient(llm);
            setTTSClient(new DynamicTTS());

            const request: videoRequest = {
                prompt: 'Thử nghiệm tính năng reroll kịch bản tự động của Oracle QA',
                aspectRatio: '16:9',
                targetDurationSec: 30,
                language: 'vi',
                style: 'modern',
            };

            const jobDir = join(testTempDir, 'job-qa-reroll');

            const mockSampler: DOMSampler = async () => ({
                left: 100,
                top: 100,
                right: 300,
                bottom: 300,
                width: 200,
                height: 200,
            });
            const mockAudioAnalyzer = async () => ({
                peakDbfs: -12,
                quietSec: 1.5,
            });

            const result = await runFullPipeline({
                request,
                outputDir: jobDir,
                skipPreview: true,
                skipRender: true, // Tiết kiệm thời gian render full video
                domSampler: mockSampler,
                audioAnalyzer: mockAudioAnalyzer,
            });

            // 1. LLM phải được gọi ít nhất 2 lần
            assert.strictEqual(llm.callCount, 2, 'LLM phải được gọi lại lần 2 sau khi QA fail lần 1');

            // 2. Lần gọi thứ 2 phải chứa phản hồi lỗi từ Oracle QA
            const secondPrompt = llm.receivedPrompts[1];
            assert.ok(
                secondPrompt.includes('LƯU Ý ĐẶC BIỆT TỪ ORACLE QA'),
                'Prompt gửi tới LLM lần 2 phải chứa thông tin phản hồi từ Oracle QA'
            );

            // 3. Kết quả cuối cùng đạt qaStatus: 'pass' hoặc 'warn'
            assert.ok(result.qaStatus === 'pass' || result.qaStatus === 'warn');
            assert.ok(result.qaReport !== undefined);

            // 4. File qa_report.json phải được ghi nhận trên đĩa
            assert.ok(existsSync(join(jobDir, 'qa_report.json')));
        });

        it('phải báo cáo qaStatus: fail và vẫn render bản suy giảm (degraded) khi hết số lần thử tối đa', async () => {
            class AlwaysFailLLM implements LLMClient {
                readonly provider = 'always-fail-llm';
                public callCount = 0;
                async generate(): Promise<string> {
                    this.callCount++;
                    return JSON.stringify(badScript);
                }
            }

            class FlatTTS implements TTSClient {
                readonly provider = 'flat-tts';
                async synthesize(_text: string, outputPath: string): Promise<void> {
                    await generateSilence(outputPath, 1.5);
                }
            }

            const failLLM = new AlwaysFailLLM();
            setLLMClient(failLLM);
            setTTSClient(new FlatTTS());

            const request: videoRequest = {
                prompt: 'Video kịch bản cố tình vi phạm liên tục',
                aspectRatio: '16:9',
                targetDurationSec: 30,
                language: 'vi',
                style: 'modern',
            };

            const jobDir = join(testTempDir, 'job-qa-exhausted');

            const mockSampler: DOMSampler = async () => ({
                left: 100,
                top: 100,
                right: 300,
                bottom: 300,
                width: 200,
                height: 200,
            });
            const mockAudioAnalyzer = async () => ({
                peakDbfs: -12,
                quietSec: 1.5,
            });

            const result = await runFullPipeline({
                request,
                outputDir: jobDir,
                skipPreview: true,
                skipRender: true, // Bỏ render thật cho nhanh; vẫn kiểm chứng pipeline KHÔNG abort
                maxQaAttempts: 2, // Thử tối đa 2 lần
                domSampler: mockSampler,
                audioAnalyzer: mockAudioAnalyzer,
            });

            assert.strictEqual(failLLM.callCount, 2);

            // 1. Kết luận QA phải trung thực: vẫn là 'fail' sau khi hết lượt thử.
            assert.strictEqual(result.qaStatus, 'fail');
            assert.strictEqual(result.qaReport?.valid, false);
            assert.ok((result.qaReport?.errors.length ?? 0) > 0, 'Phải giữ lại danh sách lỗi của QA');

            // 2. Pipeline KHÔNG abort: vẫn đi tiếp tới bước render (đường dẫn video được cấp)
            //    và đánh dấu rõ đây là bản render suy giảm chất lượng để admin duyệt lại.
            assert.strictEqual(result.qaReport?.degraded, true);
            assert.notStrictEqual(result.videoPath, '', 'Không abort: vẫn phải có đường dẫn video để render');

            // 3. qa_report.json phải khớp với kết luận cuối cùng (fail + degraded).
            const reportPath = join(jobDir, 'qa_report.json');
            assert.ok(existsSync(reportPath));
            const persisted = JSON.parse(readFileSync(reportPath, 'utf-8'));
            assert.strictEqual(persisted.qaStatus, 'fail');
            assert.strictEqual(persisted.valid, false);
            assert.strictEqual(persisted.degraded, true);
            assert.ok(persisted.errors.length > 0);
        });

        it('trả về qaStatus: skipped khi skipQa = true mà không chạy oracle QA', async () => {
            class GoodLLM implements LLMClient {
                readonly provider = 'good-llm';
                async generate(): Promise<string> {
                    return JSON.stringify(goodScript);
                }
            }
            class FlatTTS implements TTSClient {
                readonly provider = 'flat-tts';
                async synthesize(_text: string, outputPath: string): Promise<void> {
                    await generateSilence(outputPath, 2.0);
                }
            }
            setLLMClient(new GoodLLM());
            setTTSClient(new FlatTTS());

            const request: videoRequest = {
                prompt: 'Kiểm thử skipQa = true',
                aspectRatio: '16:9',
                targetDurationSec: 30,
                language: 'vi',
                style: 'modern',
            };
            const jobDir = join(testTempDir, 'job-qa-skipped');
            const result = await runFullPipeline({
                request,
                outputDir: jobDir,
                skipPreview: true,
                skipRender: true,
                skipQa: true,
            });

            assert.strictEqual(result.qaStatus, 'skipped');
            assert.strictEqual(result.qaReport, undefined);
        });

        it('tích hợp MemoryQueue cập nhật đúng status qa_failed và qaStatus/qaReport', async () => {
            const queue = new MemoryQueue();
            const jobId = 'test-job-qa-queue';

            const mockResult: any = {
                jobId,
                seed: 12345,
                workDir: '/tmp',
                // Render suy giảm: QA kết luận fail nhưng vẫn có video.
                videoPath: '/tmp/final_video.mp4',
                durationSec: 10,
                scences: [],
                resolution: '1920x1080',
                timing: {},
                audio: {},
                finalHtmlPath: '/tmp/index.html',
                qaStatus: 'fail',
                qaReport: {
                    jobId,
                    qaStatus: 'fail',
                    attempt: 3,
                    valid: false,
                    carryScore: 0.2,
                    warnings: ['[QA retry exhausted] Đã render tiếp dù QA thất bại sau 2 lần thử.'],
                    errors: ['[RHYTHM] Lỗi nhịp điệu'],
                    degraded: true,
                    legs: {} as any,
                    createdAt: new Date().toISOString(),
                },
            };

            queue.process(async () => mockResult);

            await queue.addJob(jobId, {
                jobId,
                request: {
                    prompt: 'Kiểm thử cập nhật trạng thái queue',
                    aspectRatio: '16:9',
                    targetDurationSec: 30,
                    language: 'vi',
                    style: 'modern',
                },
                outputDir: '/tmp',
            });

            // Chờ queue hoàn thành tác vụ
            await new Promise((resolve) => setTimeout(resolve, 50));

            const record = await queue.getJob(jobId);
            assert.ok(record !== null);
            assert.strictEqual(record?.status, 'qa_failed');
            assert.strictEqual(record?.qaStatus, 'fail');
            assert.strictEqual(record?.qaReport?.carryScore, 0.2);
            assert.strictEqual(record?.qaReport?.degraded, true);
            assert.notStrictEqual(record?.result?.videoPath, '', 'Job QA failed vẫn phải giữ video đã render');
        });
    });
});
