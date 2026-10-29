import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    getNominalCaptionBand,
    getCaptionBandFromRect,
    captionOverlapRatio,
    boxOverlapsCaptionBand,
} from '../../src/pipeline/karaoke.js';
import { checkCaptionBandLeg, type CaptionBandSampler } from '../../src/pipeline/oracleQa.js';
import type { scene } from '../../src/llm/schema.js';

function makeScene(id: string, duration: number): scene {
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
    };
}

describe('Caption band — vùng cấm caption (#110)', () => {
    describe('getNominalCaptionBand', () => {
        it('16:9 — đáy dải cách đáy khung đúng bottomOffsetPercent', () => {
            const band = getNominalCaptionBand(1920, 1080);
            assert.strictEqual(band.source, 'nominal');
            assert.strictEqual(band.bottom, 1080 - Math.round(0.12 * 1080));
            // 3 dòng × 32px × 1.35 + 24px padding = 154px (không còn hard-code 80px)
            assert.strictEqual(band.height, Math.round(32 * 1.35 * 3 + 24));
            assert.strictEqual(band.top, band.bottom - band.height);
        });

        it('9:16 — dải cao hơn tính theo px tuyệt đối, vẫn cách đáy 12%', () => {
            const band = getNominalCaptionBand(1080, 1920);
            assert.strictEqual(band.bottom, 1920 - Math.round(0.12 * 1920));
            assert.ok(band.height >= getNominalCaptionBand(1920, 1080).height);
            assert.ok(band.top > 0);
        });

        it('tôn trọng fontSize và bottomOffsetPercent tuỳ biến', () => {
            const band = getNominalCaptionBand(1080, 1920, {
                fontSize: '48px',
                bottomOffsetPercent: 18,
            });
            assert.strictEqual(band.height, Math.round(48 * 1.35 * 3 + 24));
            assert.strictEqual(band.bottom, 1920 - Math.round(0.18 * 1920));
        });
    });

    describe('getCaptionBandFromRect — đo bbox thật sau layout', () => {
        it('lấy đúng top/height/bottom của cue đang hiển thị', () => {
            const band = getCaptionBandFromRect({ left: 120, top: 700, width: 600, height: 140 });
            assert.strictEqual(band.source, 'measured');
            assert.deepStrictEqual(
                { left: band.left, top: band.top, width: band.width, height: band.height, bottom: band.bottom },
                { left: 120, top: 700, width: 600, height: 140, bottom: 840 }
            );
        });
    });

    describe('captionOverlapRatio / boxOverlapsCaptionBand', () => {
        const band = getCaptionBandFromRect({ left: 100, top: 800, width: 800, height: 120 });

        it('CTA bị che một nửa → vi phạm', () => {
            const cta = { left: 200, top: 860, width: 400, height: 120 };
            assert.ok(captionOverlapRatio(cta, band) > 0.4);
            assert.strictEqual(boxOverlapsCaptionBand(cta, band), true);
        });

        it('CTA nằm hoàn toàn trên dải → không vi phạm', () => {
            const cta = { left: 200, top: 500, width: 400, height: 100 };
            assert.strictEqual(captionOverlapRatio(cta, band), 0);
            assert.strictEqual(boxOverlapsCaptionBand(cta, band), false);
        });

        it('chạm nhẹ padding của caption (<10%) không tính là vi phạm', () => {
            // Chỉ 4px chồng lên dải trên phần tử cao 100px → 4%
            const el = { left: 200, top: 704, width: 400, height: 100 };
            assert.ok(captionOverlapRatio(el, band) < 0.1);
            assert.strictEqual(boxOverlapsCaptionBand(el, band), false);
        });

        it('nằm ngang hàng nhưng lệch trục X → không vi phạm', () => {
            const el = { left: 950, top: 820, width: 300, height: 80 };
            assert.strictEqual(captionOverlapRatio(el, band), 0);
        });
    });

    describe('checkCaptionBandLeg — QA dùng bbox thật', () => {
        const scenes = [makeScene('s1', 2.0)];
        const durations = { s1: 2.0 };
        const caption = { left: 100, top: 800, right: 900, bottom: 920, width: 800, height: 120 };

        it('fail khi phần tử nội dung bị caption che', async () => {
            const sampler: CaptionBandSampler = async () => ({
                caption,
                elements: [
                    {
                        label: 'button "ĐẶT BÀN NGAY"',
                        box: { left: 300, top: 860, right: 700, bottom: 960, width: 400, height: 100 },
                    },
                ],
            });

            const result = await checkCaptionBandLeg(scenes, durations, sampler);
            assert.strictEqual(result.status, 'fail');
            assert.ok((result.violations?.length ?? 0) > 0);
            assert.ok(result.reason?.includes('xâm phạm dải caption'));
            assert.ok((result.sampledFrames ?? 0) > 0);
        });

        it('pass khi mọi phần tử nằm trên dải caption', async () => {
            const sampler: CaptionBandSampler = async () => ({
                caption,
                elements: [
                    {
                        label: 'button "ĐẶT BÀN NGAY"',
                        box: { left: 300, top: 500, right: 700, bottom: 600, width: 400, height: 100 },
                    },
                ],
            });

            const result = await checkCaptionBandLeg(scenes, durations, sampler);
            assert.strictEqual(result.status, 'pass');
            assert.strictEqual(result.violations, undefined);
        });

        it('pass khi scene không có cue caption tại mốc đó', async () => {
            const sampler: CaptionBandSampler = async () => ({ caption: null, elements: [] });
            const result = await checkCaptionBandLeg(scenes, durations, sampler);
            assert.strictEqual(result.status, 'pass');
            assert.strictEqual(result.sampledFrames, 0);
        });

        it('pass an toàn khi sampler trả null (không có DOM)', async () => {
            const sampler: CaptionBandSampler = async () => null;
            const result = await checkCaptionBandLeg(scenes, durations, sampler);
            assert.strictEqual(result.status, 'pass');
        });
    });
});
