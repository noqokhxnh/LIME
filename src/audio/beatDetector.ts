/**
 * Beat & BPM Detection (Issue #32)
 *
 * Phát hiện nhịp (beat) và BPM từ file audio BGM để đồng bộ
 * chuyển cảnh theo nhịp nhạc.
 *
 * Phương pháp:
 * 1. Dùng FFmpeg trích xuất energy envelope (mức năng lượng theo thời gian)
 * 2. Tính spectral flux (đạo hàm năng lượng) để phát hiện onsets
 * 3. Autocorrelation để tìm BPM trong khoảng 70-180
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface BeatDetectionResult {
    bpm: number;
    beats: number[]; // timestamps (giây) của các beats
    confidence: number; // 0-1
}

/**
 * Phát hiện BPM và beats từ file audio.
 */
export async function detectBeats(
    audioPath: string,
    minBpm: number = 70,
    maxBpm: number = 180
): Promise<BeatDetectionResult> {
    // Bước 1: Trích xuất energy envelope bằng FFmpeg
    // Dùng astats để lấy RMS level theo từng frame
    const { stdout } = await execFileAsync("ffmpeg", [
        "-i", audioPath,
        "-af", "astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-",
        "-f", "null",
        "-",
    ]);

    // Parse RMS levels
    const rmsLevels: number[] = [];
    for (const line of stdout.split("\n")) {
        const match = line.match(/RMS_level=(-?\d+\.?\d*)/);
        if (match) {
            const db = parseFloat(match[1]);
            // Chuyển từ dB sang linear (0-1)
            const linear = db === -Infinity ? 0 : Math.pow(10, db / 20);
            rmsLevels.push(linear);
        }
    }

    if (rmsLevels.length < 10) {
        return { bpm: 120, beats: [], confidence: 0 };
    }

    // Bước 2: Tính spectral flux (onset detection đơn giản)
    const flux: number[] = [];
    for (let i = 1; i < rmsLevels.length; i++) {
        const diff = rmsLevels[i] - rmsLevels[i - 1];
        flux.push(Math.max(0, diff)); // Chỉ lấy tăng (onset)
    }

    // Bước 3: Autocorrelation để tìm BPM
    // Giả định: mỗi sample = 1/30 giây (FFmpeg astats reset=1 mặc định)
    const sampleRate = 30; // samples per second
    const bpm = findBpmByAutocorrelation(flux, sampleRate, minBpm, maxBpm);

    // Bước 4: Tìm beat positions bằng peak picking
    const beats = findBeatPositions(flux, sampleRate, bpm);

    return {
        bpm: Math.round(bpm),
        beats,
        confidence: 0.7, // TODO: tính confidence thực tế
    };
}

function findBpmByAutocorrelation(
    flux: number[],
    sampleRate: number,
    minBpm: number,
    maxBpm: number
): number {
    const minLag = Math.floor((60 / maxBpm) * sampleRate);
    const maxLag = Math.ceil((60 / minBpm) * sampleRate);

    let bestLag = minLag;
    let bestCorr = -Infinity;

    for (let lag = minLag; lag <= maxLag; lag++) {
        let corr = 0;
        let norm = 0;
        for (let i = 0; i < flux.length - lag; i++) {
            corr += flux[i] * flux[i + lag];
            norm += flux[i] * flux[i];
        }
        if (norm > 0) corr /= norm;
        if (corr > bestCorr) {
            bestCorr = corr;
            bestLag = lag;
        }
    }

    return (60 * sampleRate) / bestLag;
}

function findBeatPositions(
    flux: number[],
    sampleRate: number,
    bpm: number
): number[] {
    const beats: number[] = [];
    const beatInterval = (60 / bpm) * sampleRate; // samples per beat

    // Peak picking đơn giản: tìm local maxima
    const threshold = calculateThreshold(flux);

    for (let i = 1; i < flux.length - 1; i++) {
        if (
            flux[i] > threshold &&
            flux[i] > flux[i - 1] &&
            flux[i] > flux[i + 1]
        ) {
            const timeSec = i / sampleRate;
            // Chỉ thêm nếu cách beat trước đủ xa (tránh trùng)
            if (
                beats.length === 0 ||
                timeSec - beats[beats.length - 1] > beatInterval * 0.5
            ) {
                beats.push(timeSec);
            }
        }
    }

    return beats;
}

function calculateThreshold(flux: number[]): number {
    const mean = flux.reduce((a, b) => a + b, 0) / flux.length;
    const variance =
        flux.reduce((a, b) => a + (b - mean) ** 2, 0) / flux.length;
    const std = Math.sqrt(variance);
    return mean + std * 0.5;
}

/**
 * Snap một timestamp về beat gần nhất.
 */
export function snapToBeat(
    timeSec: number,
    beats: number[],
    maxSnapSec: number = 0.3
): number {
    if (beats.length === 0) return timeSec;

    let closest = beats[0];
    let minDiff = Math.abs(timeSec - closest);

    for (const beat of beats) {
        const diff = Math.abs(timeSec - beat);
        if (diff < minDiff) {
            minDiff = diff;
            closest = beat;
        }
    }

    return minDiff <= maxSnapSec ? closest : timeSec;
}
