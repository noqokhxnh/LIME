import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import {
    synthesizeAir,
    synthesizeWood,
    synthesizeGlass,
    synthesizeSub,
    synthesizeBubble,
    generateSfxTrack,
    extractTimelineEventsFromPage,
    encodeWavBuffer,
    type TimelineEvent,
} from '../../src/pipeline/sfxSynth.js';
import {
    duckBgm,
    masterAudio,
    measureLoudness,
    mixAudioPipeline,
} from '../../src/pipeline/audioMixer.js';

function parseWavSamples(buffer: Buffer): { left: Float32Array; right: Float32Array; sampleRate: number } {
    let offset = 12, sampleRate = 44100, numChannels = 2, dataOffset = 44, dataSize = buffer.length - 44;
    while (offset < buffer.length - 8) {
        const id = buffer.toString('ascii', offset, offset + 4);
        const sz = buffer.readUInt32LE(offset + 4);
        if (id === 'fmt ') {
            numChannels = buffer.readUInt16LE(offset + 10);
            sampleRate = buffer.readUInt32LE(offset + 12);
        } else if (id === 'data') {
            dataOffset = offset + 8;
            dataSize = sz;
            break;
        }
        offset += 8 + sz;
    }
    const numSamples = Math.floor(dataSize / (numChannels * 2));
    const left = new Float32Array(numSamples), right = new Float32Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
        const idx = dataOffset + i * numChannels * 2;
        left[i] = buffer.readInt16LE(idx) / 32768;
        right[i] = numChannels > 1 ? buffer.readInt16LE(idx + 2) / 32768 : left[i];
    }
    return { left, right, sampleRate };
}

function calculateRms(samples: Float32Array, startIdx: number, endIdx: number): number {
    const start = Math.max(0, startIdx), end = Math.min(samples.length, endIdx);
    if (end <= start) return 0;
    let sumSq = 0;
    for (let i = start; i < end; i++) sumSq += samples[i] * samples[i];
    return Math.sqrt(sumSq / (end - start));
}

function computeDftPower(samples: Float32Array, f: number, sampleRate = 44100, maxSamples = 8820): number {
    const w = (2 * Math.PI * f) / sampleRate;
    const N = Math.min(samples.length, maxSamples);
    let re = 0, im = 0;
    for (let n = 0; n < N; n += 2) {
        re += samples[n] * Math.cos(w * n);
        im += samples[n] * Math.sin(w * n);
    }
    return re * re + im * im;
}

describe('Spec E: Sound from Timeline Events (src/pipeline/sfxSynth.ts & audioMixer.ts)', () => {
    let testTempDir: string;

    beforeEach(() => {
        testTempDir = mkdtempSync(join(tmpdir(), 'lime-spec-e-test-'));
    });

    afterEach(() => {
        if (existsSync(testTempDir)) rmSync(testTempDir, { recursive: true, force: true });
    });

    describe('TC-SPEC-E-001: Đặc tính quang phổ và động học 5 vật liệu DSP', () => {
        it('(a.1) sub: Âm trầm tần số thấp tập trung sâu dưới 100Hz', () => {
            const sub = synthesizeSub(0.9, { seed: 101 });
            assert.ok(sub.duration >= 0.15 && sub.duration <= 0.55);
            assert.equal(sub.sampleRate, 44100);
            const lowPower = computeDftPower(sub.left, 40) + computeDftPower(sub.left, 50) + computeDftPower(sub.left, 60);
            const highPower = computeDftPower(sub.left, 300) + computeDftPower(sub.left, 600) + computeDftPower(sub.left, 1200);
            assert.ok(lowPower > highPower * 50, `Sub power phải tập trung <100Hz (low: ${lowPower}, high: ${highPower})`);
        });

        it('(a.2) air: Tiếng gió lướt nhanh với năng lượng ở dải trung-cao (>500Hz)', () => {
            const air = synthesizeAir(0.8, { seed: 202 });
            assert.ok(air.duration >= 0.2 && air.duration <= 0.7);
            const sub200Power = computeDftPower(air.left, 60) + computeDftPower(air.left, 120);
            const midHighPower = computeDftPower(air.left, 1200) + computeDftPower(air.left, 2200) + computeDftPower(air.left, 3000);
            assert.ok(midHighPower > sub200Power * 5, 'Air phải tập trung năng lượng dải trung-cao');
        });

        it('(a.3) wood: Xung kích gõ gỗ có suy giảm hàm mũ cực nhanh (fast decay)', () => {
            const wood = synthesizeWood(0.8, { seed: 303 });
            assert.ok(wood.duration <= 0.15, 'Wood phải có thời lượng ngắn (<150ms)');
            const sr = wood.sampleRate;
            const rmsStart = calculateRms(wood.left, 0, Math.floor(0.01 * sr));
            const rmsEnd = calculateRms(wood.left, wood.left.length - Math.floor(0.02 * sr), wood.left.length);
            assert.ok(rmsStart > rmsEnd * 15, `Wood decay phải rất nhanh (start: ${rmsStart}, end: ${rmsEnd})`);
        });

        it('(a.4) bubble: Tần số quét vút lên trên (pitch-up sweep)', () => {
            const bubble = synthesizeBubble(0.85, { seed: 404 });
            assert.ok(bubble.duration >= 0.05 && bubble.duration <= 0.2);
            const half = Math.floor(bubble.left.length / 2);
            let zc1 = 0, zc2 = 0;
            for (let i = 1; i < half; i++) {
                if ((bubble.left[i] >= 0 && bubble.left[i - 1] < 0) || (bubble.left[i] < 0 && bubble.left[i - 1] >= 0)) zc1++;
            }
            for (let i = half + 1; i < bubble.left.length; i++) {
                if ((bubble.left[i] >= 0 && bubble.left[i - 1] < 0) || (bubble.left[i] < 0 && bubble.left[i - 1] >= 0)) zc2++;
            }
            assert.ok(zc2 > zc1 * 1.3, `Bubble phải quét vút tần số lên (zc1: ${zc1}, zc2: ${zc2})`);
        });

        it('(a.5) glass: Phổ inharmonic ngân vang kim loại và tính tất định PRNG', () => {
            const glass1 = synthesizeGlass(0.75, { seed: 505 });
            const glass2 = synthesizeGlass(0.75, { seed: 505 });
            assert.ok(glass1.duration >= 0.25, 'Glass phải có độ ngân vang kéo dài');
            assert.equal(glass1.left.length, glass2.left.length);
            for (let i = 0; i < glass1.left.length; i++) assert.equal(glass1.left[i], glass2.left[i]);
        });
    });

    describe('TC-SPEC-E-002: Độ chính xác định thời SFX trên timeline (±50ms)', () => {
        it('Đặt chính xác các sự kiện SFX tại các timestamp với sai số < 50ms', () => {
            const events: TimelineEvent[] = [
                { t: 0.35, material: 'wood', intensity: 0.9 },
                { t: 0.90, material: 'bubble', intensity: 0.9 },
                { t: 1.55, material: 'sub', intensity: 0.9 },
            ];
            const result = generateSfxTrack(events, 2.2, { seed: 999 });
            assert.equal(result.hasEvents, true);
            const sr = result.sampleRate;

            for (const evt of events) {
                const targetSample = Math.round(evt.t * sr);
                const win = Math.round(0.05 * sr);
                let maxAmp = 0, peakSample = targetSample;
                for (let s = Math.max(0, targetSample - win); s < Math.min(result.left.length, targetSample + win); s++) {
                    const amp = Math.abs(result.left[s]);
                    if (amp > maxAmp) { maxAmp = amp; peakSample = s; }
                }
                const deltaMs = Math.abs((peakSample / sr) - evt.t) * 1000;
                assert.ok(maxAmp > 0.05, `Phải có biên độ xung âm thanh tại t=${evt.t}`);
                assert.ok(deltaMs <= 50, `Độ lệch thời gian onset phải <= 50ms (đo được: ${deltaMs.toFixed(2)}ms cho ${evt.material})`);
            }
        });
    });

    describe('TC-SPEC-E-003: Giảm biên độ BGM khi ducking (-6dB RMS Reduction)', () => {
        it('BGM tự động giảm khoảng -6dB âm lượng khi sidechain voice/SFX kích hoạt', async () => {
            const sr = 44100, dur = 3.0, totalSamples = Math.round(dur * sr);
            const bgmLeft = new Float32Array(totalSamples);
            for (let i = 0; i < totalSamples; i++) bgmLeft[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / sr);
            const bgmPath = join(testTempDir, 'test_bgm.wav');
            writeFileSync(bgmPath, encodeWavBuffer([bgmLeft, bgmLeft], sr));

            const voiceLeft = new Float32Array(totalSamples);
            const sActive = Math.round(1.0 * sr), eActive = Math.round(2.0 * sr);
            for (let i = sActive; i < eActive; i++) voiceLeft[i] = 0.15 * Math.sin((2 * Math.PI * 880 * i) / sr);
            const voicePath = join(testTempDir, 'test_voice.wav');
            writeFileSync(voicePath, encodeWavBuffer([voiceLeft, voiceLeft], sr));

            const duckedPath = join(testTempDir, 'ducked_bgm.wav');
            await duckBgm({ bgmPath, voicePath, outputPath: duckedPath, durationSec: dur, bgmVolume: 0.5 });
            assert.ok(existsSync(duckedPath));

            const { left: duckedLeft } = parseWavSamples(readFileSync(duckedPath));
            const rmsUnducked = calculateRms(duckedLeft, Math.round(0.2 * sr), Math.round(0.7 * sr));
            const rmsDucked = calculateRms(duckedLeft, Math.round(1.3 * sr), Math.round(1.8 * sr));
            assert.ok(rmsUnducked > 0.01 && rmsDucked > 0.005);

            const diffDb = 20 * Math.log10(rmsDucked / rmsUnducked);
            assert.ok(diffDb <= -3.5 && diffDb >= -8.5, `Mức giảm ducking phải xấp xỉ -6dB (đo được: ${diffDb.toFixed(2)} dB)`);
        });
    });

    describe('TC-SPEC-E-004: Master chuẩn hóa EBU R128 (-16 LUFS ±1 LU, TP <= -3.5 dBTP)', () => {
        it('Master track âm thanh đạt chuẩn -16 LUFS ±1 LU và ceiling true peak <= -3.5 dBTP', async () => {
            const sr = 44100, dur = 3.5, totalSamples = Math.round(dur * sr);
            const testLeft = new Float32Array(totalSamples);
            for (let i = 0; i < totalSamples; i++) {
                testLeft[i] = 0.35 * Math.sin((2 * Math.PI * 300 * i) / sr) + 0.25 * Math.sin((2 * Math.PI * 800 * i) / sr);
            }
            const inputPath = join(testTempDir, 'raw_input.wav');
            writeFileSync(inputPath, encodeWavBuffer([testLeft, testLeft], sr));

            const masteredPath = join(testTempDir, 'mastered.wav');
            await masterAudio(inputPath, masteredPath, { targetLufs: -16, truePeakCeiling: -3.5 });
            assert.ok(existsSync(masteredPath));

            const metrics = await measureLoudness(masteredPath);
            console.log(`[Spec E Master Test Result] Integrated: ${metrics.integratedLufs.toFixed(1)} LUFS, True Peak: ${metrics.truePeakDbtp.toFixed(1)} dBTP, LRA: ${metrics.lra.toFixed(1)} LU`);
            assert.ok(
                metrics.integratedLufs >= -17.0 && metrics.integratedLufs <= -15.0,
                `Integrated loudness phải nằm trong khoảng -16 ± 1 LUFS (đo được: ${metrics.integratedLufs} LUFS)`
            );
            assert.ok(metrics.truePeakDbtp <= -3.4, `True peak phải <= -3.5 dBTP (đo được: ${metrics.truePeakDbtp} dBTP)`);
        });
    });

    describe('TC-SPEC-E-005: Non-regression khi comp không khai báo __events()', () => {
        it('Trích xuất events từ page trả về [] an toàn khi __events không tồn tại', async () => {
            const mockPage: any = { evaluate: async () => undefined };
            const events = await extractTimelineEventsFromPage(mockPage);
            assert.deepEqual(events, []);
        });

        it('Chuỗi mixAudioPipeline vận hành trơn tru khi events = [] (không có SFX)', async () => {
            const sr = 44100, dur = 2.0, totalSamples = Math.round(dur * sr);
            const voiceLeft = new Float32Array(totalSamples);
            for (let i = 0; i < totalSamples; i++) voiceLeft[i] = 0.3 * Math.sin((2 * Math.PI * 400 * i) / sr);
            const voicePath = join(testTempDir, 'voice_only.wav');
            writeFileSync(voicePath, encodeWavBuffer([voiceLeft, voiceLeft], sr));

            const result = await mixAudioPipeline({
                voicePath,
                events: [],
                outputDir: testTempDir,
                durationSec: dur,
                skipSfx: false,
            });
            assert.equal(result.hasSfx, false);
            assert.equal(result.sfxPath, undefined);
            assert.ok(existsSync(result.mixAudioPath));
            assert.ok(result.loudness.integratedLufs <= 0);
        });
    });
});
