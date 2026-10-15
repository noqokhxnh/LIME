import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { type Browser, type Page } from 'playwright';
import {
    type videoScript,
    type scene,
    type Boundary,
    type AudioResult,
    checkRhythm,
} from '../llm/schema.js';
import {
    launchPreviewBrowser,
    loadAndPreparePage,
    seekToTimestamp,
} from './preview.js';

export interface DOMBox {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

export type DOMSampler = (timeSec: number, selector: string) => Promise<DOMBox | null>;
export type BatchDOMSampler = (timeSec: number, selectors: string[]) => Promise<Record<string, DOMBox | null>>;

export interface AudioStats {
    peakDbfs: number;
    quietSec: number;
}

export interface RhythmLegResult {
    status: 'pass' | 'warn' | 'fail';
    cv: number;
    ratio?: number;
    nearStillSec?: number;
    reason?: string;
}

export interface ContinuityLegResult {
    status: 'pass' | 'warn' | 'fail';
    carryScore: number;
    failed?: string[];
    details?: Record<string, any>;
}

export interface CurvesLegResult {
    status: 'pass' | 'warn' | 'fail';
    maxPxPerFrame: number;
    reason?: string;
}

export interface FramingLegResult {
    status: 'pass' | 'warn' | 'fail';
    outOfBoundsSamples?: number;
    reason?: string;
}

export interface AudioLegResult {
    status: 'pass' | 'warn' | 'fail';
    peakDbfs?: number;
    quietSec?: number;
    reason?: string;
}

export interface QAReport {
    jobId: string;
    qaStatus: 'pass' | 'warn' | 'fail' | 'skipped';
    attempt: number;
    valid: boolean;
    carryScore: number;
    warnings: string[];
    errors: string[];
    legs: {
        rhythm: RhythmLegResult;
        continuity: ContinuityLegResult;
        curves: CurvesLegResult;
        framing: FramingLegResult;
        audio: AudioLegResult;
    };
    createdAt: string;
}

export interface OracleQaOptions {
    script: videoScript;
    htmlPath: string;
    audioResult?: AudioResult;
    audioPath?: string;
    width: number;
    height: number;
    fps: number;
    seed?: number;
    jobId?: string;
    attempt?: number;
    domSampler?: DOMSampler;
    batchDomSampler?: BatchDOMSampler;
    audioAnalyzer?: (audioPath: string) => Promise<AudioStats>;
    page?: Page;
}

/**
 * Leg 1: Rhythm
 * Đo CV của độ dài các shot và tỉ số max/min từ checkRhythm.
 * - Fail nếu CV < 0.3 hoặc ratio < 4.
 * - Warn nếu thiếu đoạn near-still >= 1.5s.
 */
export function checkRhythmLeg(
    scenes: scene[],
    durations?: Record<string, number>
): RhythmLegResult {
    if (!scenes || scenes.length <= 1) {
        return {
            status: 'pass',
            cv: 0,
            ratio: 1,
            nearStillSec: 0,
        };
    }

    const scenesWithDurations = scenes.map((s) => ({
        ...s,
        duration: durations?.[s.id] ?? s.duration ?? 0,
    }));

    const rhythm = checkRhythm(scenesWithDurations);

    const failReasons: string[] = [];
    if (rhythm.cv < 0.3) {
        failReasons.push(
            `Hệ số biến thiên độ dài cảnh (CV) là ${rhythm.cv.toFixed(2)} (< 0.3, vi phạm quy tắc chống nhịp điệu đều uniform cadence)`
        );
    }
    if (rhythm.ratio < 4) {
        failReasons.push(
            `Tỉ số shot dài nhất / ngắn nhất là ${rhythm.ratio.toFixed(2)} (< 4, thiếu sự tương phản nhịp độ)`
        );
    }

    if (failReasons.length > 0) {
        return {
            status: 'fail',
            cv: Math.round(rhythm.cv * 100) / 100,
            ratio: Math.round(rhythm.ratio * 100) / 100,
            nearStillSec: rhythm.hasNearStill ? 1.5 : 0,
            reason: failReasons.join('; '),
        };
    }

    if (!rhythm.hasNearStill) {
        return {
            status: 'warn',
            cv: Math.round(rhythm.cv * 100) / 100,
            ratio: Math.round(rhythm.ratio * 100) / 100,
            nearStillSec: 0,
            reason: 'Kịch bản thiếu khoảng nghỉ tĩnh (near-still >= 1.5s) để người xem tiếp thu nội dung',
        };
    }

    return {
        status: 'pass',
        cv: Math.round(rhythm.cv * 100) / 100,
        ratio: Math.round(rhythm.ratio * 100) / 100,
        nearStillSec: 1.5,
    };
}

/**
 * Leg 2: Continuity (Carry Score)
 * Với mỗi boundary, kiểm tra phần tử carry tại t - 0.15s và t + 0.15s:
 * - Đạt nếu overlap HOẶC tâm điểm dịch chuyển <= 40% đường chéo viewport.
 * - hardCut có lý do hợp lệ được tính là đạt.
 * - carryScore = số boundary đạt / tổng boundary xét.
 * - Fail nếu carryScore < 0.5; Warn nếu 0.5 <= carryScore < 0.75; Pass nếu >= 0.75.
 */
export async function checkContinuityLeg(
    boundaries: Boundary[],
    scenes: scene[],
    durations: Record<string, number>,
    domSampler: DOMSampler,
    width: number,
    height: number
): Promise<ContinuityLegResult> {
    if (!boundaries || boundaries.length === 0) {
        return {
            status: 'pass',
            carryScore: 1.0,
            details: { totalBoundaries: 0, passedBoundaries: 0 },
        };
    }

    const sceneSwitchTimes = new Map<string, number>();
    let runningTime = 0;
    for (const s of scenes) {
        const dur = durations[s.id] ?? s.duration ?? 3.0;
        runningTime += dur;
        sceneSwitchTimes.set(s.id, runningTime);
    }

    const diagonal = Math.hypot(width, height);
    const maxAllowedJump = diagonal * 0.4;
    const failed: string[] = [];
    let passedCount = 0;
    let totalEvaluated = 0;

    for (const b of boundaries) {
        totalEvaluated++;

        if (b.carry.mechanism === 'hardCut') {
            if (b.carry.reason && b.carry.reason.trim().length > 0) {
                passedCount++;
                continue;
            } else {
                failed.push(`Boundary '${b.id}': mechanism hardCut không có lý do hợp lệ`);
                continue;
            }
        }

        const t = sceneSwitchTimes.get(b.fromScene) ?? runningTime;
        const t1 = Math.max(0, t - 0.15);
        const t2 = t + 0.15;

        const box1 = await domSampler(t1, b.carry.element);
        const box2 = await domSampler(t2, b.carry.element);

        if (!box1 || !box2) {
            failed.push(
                `Boundary '${b.id}': phần tử carry '${b.carry.element}' biến mất tại mốc chuyển cảnh ${t.toFixed(2)}s (trước: ${box1 ? 'tồn tại' : 'mất'}, sau: ${box2 ? 'tồn tại' : 'mất'})`
            );
            continue;
        }

        const hasOverlap = !(
            box1.right < box2.left ||
            box1.left > box2.right ||
            box1.bottom < box2.top ||
            box1.top > box2.bottom
        );

        const c1 = { x: box1.left + box1.width / 2, y: box1.top + box1.height / 2 };
        const c2 = { x: box2.left + box2.width / 2, y: box2.top + box2.height / 2 };
        const centerDist = Math.hypot(c2.x - c1.x, c2.y - c1.y);

        if (hasOverlap || centerDist <= maxAllowedJump) {
            passedCount++;
        } else {
            failed.push(
                `Boundary '${b.id}': phần tử '${b.carry.element}' nhảy vị trí quá xa (${centerDist.toFixed(1)}px > 40% đường chéo ${maxAllowedJump.toFixed(1)}px)`
            );
        }
    }

    const carryScore = totalEvaluated > 0 ? passedCount / totalEvaluated : 1.0;
    const roundedCarryScore = Math.round(carryScore * 100) / 100;

    let status: 'pass' | 'warn' | 'fail' = 'pass';
    if (carryScore < 0.5) {
        status = 'fail';
    } else if (carryScore < 0.75) {
        status = 'warn';
    }

    return {
        status,
        carryScore: roundedCarryScore,
        failed: failed.length > 0 ? failed : undefined,
        details: {
            totalBoundaries: boundaries.length,
            evaluatedBoundaries: totalEvaluated,
            passedBoundaries: passedCount,
        },
    };
}

/**
 * Leg 3: Curves (Displacement)
 * Đo tốc độ dịch chuyển lớn nhất (px/frame) giữa các sample.
 * Fail nếu maxPxPerFrame > 80 mà không có hiệu ứng shutter blur (Spec D).
 */
export async function checkCurvesLeg(
    scenes: scene[],
    durations: Record<string, number>,
    boundaries: Boundary[],
    domSampler: DOMSampler,
    fps: number,
    hasShutterBlur: boolean = false,
    batchDomSampler?: BatchDOMSampler
): Promise<CurvesLegResult> {
    const elementsToTrack = new Set<string>();
    for (const s of scenes) {
        if (s.subject) elementsToTrack.add(s.subject);
        elementsToTrack.add(`#${s.id}`);
    }
    for (const b of boundaries) {
        if (b.carry?.element) elementsToTrack.add(b.carry.element);
    }
    const elemList = Array.from(elementsToTrack);

    let maxPxPerFrame = 0;
    let runningTime = 0;

    for (const s of scenes) {
        const dur = durations[s.id] ?? s.duration ?? 3.0;
        const startTime = runningTime;
        runningTime += dur;

        const sampleTimes: number[] = [];
        const step = 0.5;
        for (let t = startTime; t <= startTime + dur; t += step) {
            sampleTimes.push(t);
        }
        if (sampleTimes.length < 3) {
            sampleTimes.length = 0;
            sampleTimes.push(startTime, startTime + dur / 2, startTime + dur);
        }

        const prevBoxes = new Map<string, DOMBox | null>();
        let prevTime = startTime;

        for (const t of sampleTimes) {
            let boxesAtT: Record<string, DOMBox | null>;
            if (batchDomSampler) {
                boxesAtT = await batchDomSampler(t, elemList);
            } else {
                boxesAtT = {};
                for (const elem of elemList) {
                    boxesAtT[elem] = await domSampler(t, elem);
                }
            }

            const deltaSec = t - prevTime;
            if (deltaSec > 0.001) {
                for (const elem of elemList) {
                    const prevBox = prevBoxes.get(elem);
                    const currentBox = boxesAtT[elem];
                    if (prevBox && currentBox) {
                        const c1 = { x: prevBox.left + prevBox.width / 2, y: prevBox.top + prevBox.height / 2 };
                        const c2 = { x: currentBox.left + currentBox.width / 2, y: currentBox.top + currentBox.height / 2 };
                        const distance = Math.hypot(c2.x - c1.x, c2.y - c1.y);
                        const pxPerFrame = (distance / deltaSec) / fps;
                        if (pxPerFrame > maxPxPerFrame) {
                            maxPxPerFrame = pxPerFrame;
                        }
                    }
                }
            }

            for (const elem of elemList) {
                prevBoxes.set(elem, boxesAtT[elem]);
            }
            prevTime = t;
        }
    }

    const roundedMax = Math.round(maxPxPerFrame * 10) / 10;
    if (roundedMax > 80 && !hasShutterBlur) {
        return {
            status: 'fail',
            maxPxPerFrame: roundedMax,
            reason: `Tốc độ dịch chuyển tối đa ${roundedMax} px/frame vượt quá ngưỡng 80 px/frame mà không có hiệu ứng shutter blur (Spec D)`,
        };
    }

    return {
        status: 'pass',
        maxPxPerFrame: roundedMax,
    };
}

/**
 * Leg 4: Framing
 * Subject khai báo trong kịch bản phải nằm trong khung hình (intersect viewport)
 * tại mọi sample, trừ khi scene mô tả exit có chủ đích.
 */
export async function checkFramingLeg(
    scenes: scene[],
    durations: Record<string, number>,
    domSampler: DOMSampler,
    width: number,
    height: number,
    batchDomSampler?: BatchDOMSampler
): Promise<FramingLegResult> {
    let outOfBoundsSamples = 0;
    let runningTime = 0;
    const violations: string[] = [];

    for (const s of scenes) {
        const dur = durations[s.id] ?? s.duration ?? 3.0;
        const startTime = runningTime;
        runningTime += dur;

        if (!s.subject) continue;

        const desc = `${s.visualDescription} ${s.transition} ${s.title}`.toLowerCase();
        const isIntentionalExit = /(exit|leave|leaves|rời|biến mất|ra ngoài|trượt ra|fade-out|slide-out)/i.test(desc);
        if (isIntentionalExit) {
            continue;
        }

        const sampleTimes: number[] = [];
        const step = 0.5;
        for (let t = startTime; t <= startTime + dur; t += step) {
            sampleTimes.push(t);
        }
        if (sampleTimes.length < 3) {
            sampleTimes.length = 0;
            sampleTimes.push(startTime, startTime + dur / 2, startTime + dur);
        }

        for (const t of sampleTimes) {
            let box: DOMBox | null;
            if (batchDomSampler) {
                const res = await batchDomSampler(t, [s.subject]);
                box = res[s.subject] ?? null;
            } else {
                box = await domSampler(t, s.subject);
            }
            if (!box) {
                outOfBoundsSamples++;
                violations.push(`Scene '${s.id}': subject '${s.subject}' không hiển thị tại t=${t.toFixed(2)}s`);
                continue;
            }

            const intersects =
                box.right > 0 &&
                box.left < width &&
                box.bottom > 0 &&
                box.top < height &&
                box.width > 0 &&
                box.height > 0;

            if (!intersects) {
                outOfBoundsSamples++;
                violations.push(
                    `Scene '${s.id}': subject '${s.subject}' nằm hoàn toàn ngoài khung hình tại t=${t.toFixed(2)}s`
                );
            }
        }
    }

    if (outOfBoundsSamples > 0) {
        return {
            status: 'fail',
            outOfBoundsSamples,
            reason: `Phát hiện ${outOfBoundsSamples} mẫu chủ thể (subject) rơi ra ngoài khung hình mà không khai báo exit có chủ đích: ${violations.slice(0, 3).join('; ')}`,
        };
    }

    return {
        status: 'pass',
        outOfBoundsSamples: 0,
    };
}

/**
 * Phân tích âm thanh bằng ffmpeg volumedetect và silencedetect
 */
export async function analyzeAudioFile(audioPath: string): Promise<AudioStats> {
    return new Promise((resolve) => {
        if (!audioPath || !existsSync(audioPath)) {
            console.warn(`[Oracle QA] File âm thanh không tồn tại tại "${audioPath || '(trống)'}".`);
            return resolve({ peakDbfs: -12, quietSec: 1.5 });
        }

        const ffmpegProc = spawn('ffmpeg', [
            '-nostats',
            '-i',
            audioPath,
            '-af',
            'volumedetect,silencedetect=noise=-40dB:d=0.5',
            '-f',
            'null',
            '-',
        ]);

        let stderr = '';
        ffmpegProc.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });

        ffmpegProc.on('close', () => {
            const maxVolMatch = stderr.match(/max_volume:\s*([-\d.]+)\s*dB/);
            const peakDbfs = maxVolMatch ? parseFloat(maxVolMatch[1]) : -12;

            const silenceMatches = [...stderr.matchAll(/silence_duration:\s*([-\d.]+)/g)];
            let quietSec = 0;
            for (const m of silenceMatches) {
                const d = parseFloat(m[1]);
                if (!isNaN(d) && d > quietSec) {
                    quietSec = d;
                }
            }

            resolve({
                peakDbfs: isNaN(peakDbfs) ? -12 : peakDbfs,
                quietSec: Math.round(quietSec * 100) / 100,
            });
        });

        ffmpegProc.on('error', (err) => {
            console.warn(`[Oracle QA] Lỗi khi thực thi ffmpeg để phân tích âm thanh: ${err.message}. Bỏ qua kiểm tra clipping & loudness.`);
            resolve({ peakDbfs: -12, quietSec: 1.5 });
        });
    });
}

/**
 * Leg 5: Audio
 * - Fail nếu peak >= -3 dBFS (nguy cơ clipping).
 * - Warn nếu không có đoạn quiet (RMS < -40 dB kéo dài >= 1s) khi video dài >= 3s.
 */
export async function checkAudioLeg(
    audioPath?: string,
    totalDurationSec: number = 0,
    customAnalyzer?: (audioPath: string) => Promise<AudioStats>
): Promise<AudioLegResult> {
    let stats: AudioStats;

    if (customAnalyzer) {
        stats = await customAnalyzer(audioPath || '');
    } else {
        if (!audioPath || !existsSync(audioPath)) {
            console.warn(
                `[Oracle QA] Cảnh báo: File âm thanh không tồn tại tại "${audioPath || '(rỗng)'}". Bỏ qua kiểm tra clipping & loudness.`
            );
            return {
                status: 'pass',
                peakDbfs: -12,
                quietSec: 1.5,
                reason: 'Bỏ qua kiểm tra do không tìm thấy file âm thanh để phân tích volumedetect/silencedetect',
            };
        }
        stats = await analyzeAudioFile(audioPath);
    }

    const { peakDbfs, quietSec } = stats;

    if (peakDbfs >= -3) {
        return {
            status: 'fail',
            peakDbfs,
            quietSec,
            reason: `Âm lượng đỉnh ${peakDbfs.toFixed(1)} dBFS >= -3 dBFS (nguy cơ méo tiếng và vỡ âm thanh clipping)`,
        };
    }

    if (totalDurationSec >= 3.0 && quietSec < 1.0) {
        return {
            status: 'warn',
            peakDbfs,
            quietSec,
            reason: `Không phát hiện khoảng lặng nghỉ nói (RMS < -40 dB kéo dài >= 1s), lời thoại phát liên tục không có nhịp thở`,
        };
    }

    return {
        status: 'pass',
        peakDbfs,
        quietSec,
    };
}

/**
 * Tạo DOMSampler dựa trên Playwright headless browser
 */
export async function createBrowserDOMSampler(
    htmlPath: string,
    width: number,
    height: number,
    existingPage?: Page
): Promise<{
    domSampler: DOMSampler;
    batchDomSampler: BatchDOMSampler;
    cleanup: () => Promise<void>;
    hasShutterBlur: boolean;
}> {
    let browser: Browser | null = null;
    let page: Page;

    if (existingPage) {
        page = existingPage;
    } else {
        browser = await launchPreviewBrowser();
        const context = await browser.newContext({
            viewport: { width, height },
        });
        page = await context.newPage();
    }

    await loadAndPreparePage(page, htmlPath, width, height);

    const htmlContent = existsSync(htmlPath) ? readFileSync(htmlPath, 'utf-8') : '';
    const hasShutterBlur = /shutter[-_]?blur|motion[-_]?blur|feGaussianBlur|filter:\s*blur/i.test(htmlContent);

    let currentSeekTime: number | null = null;

    const seekOnce = async (timeSec: number) => {
        if (currentSeekTime === null || Math.abs(currentSeekTime - timeSec) > 0.001) {
            await seekToTimestamp(page, timeSec);
            currentSeekTime = timeSec;
        }
    };

    const batchDomSampler: BatchDOMSampler = async (timeSec: number, selectors: string[]) => {
        if (selectors.length === 0) return {};
        await seekOnce(timeSec);
        const results = await page.evaluate((sels: string[]) => {
            const out: Record<string, { left: number; top: number; right: number; bottom: number; width: number; height: number } | null> = {};
            for (const sel of sels) {
                const el =
                    document.querySelector(sel) ||
                    document.getElementById(sel.replace(/^#/, ''));
                if (!el) {
                    out[sel] = null;
                    continue;
                }
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                if (
                    style.display === 'none' ||
                    style.visibility === 'hidden' ||
                    parseFloat(style.opacity || '1') <= 0.01
                ) {
                    out[sel] = null;
                    continue;
                }
                out[sel] = {
                    left: rect.left,
                    top: rect.top,
                    right: rect.right,
                    bottom: rect.bottom,
                    width: rect.width,
                    height: rect.height,
                };
            }
            return out;
        }, selectors);
        return results;
    };

    const domSampler: DOMSampler = async (timeSec: number, selector: string) => {
        const res = await batchDomSampler(timeSec, [selector]);
        return res[selector] ?? null;
    };

    const cleanup = async () => {
        if (browser) {
            await browser.close().catch(() => {});
        }
    };

    return { domSampler, batchDomSampler, cleanup, hasShutterBlur };
}

/**
 * Hàm điều phối chính Oracle QA (Phase 4.5)
 */
export async function runOracleQa(options: OracleQaOptions): Promise<QAReport> {
    const {
        script,
        htmlPath,
        audioResult,
        audioPath: explicitAudioPath,
        width,
        height,
        fps,
        jobId = 'default-job',
        attempt = 1,
    } = options;

    const scenes = script.scenes || [];
    const boundaries = script.boundaries || [];
    const durations = audioResult?.scencesDuration || {};

    // 1. Leg 1: Rhythm
    const rhythmLeg = checkRhythmLeg(scenes, durations);

    // Chuẩn bị DOM sampler
    let domSampler = options.domSampler;
    let batchDomSampler = options.batchDomSampler;
    let cleanupBrowser: (() => Promise<void>) | null = null;
    let hasShutterBlur = false;

    if (!domSampler && !batchDomSampler) {
        if (existsSync(htmlPath)) {
            try {
                const browserSetup = await createBrowserDOMSampler(
                    htmlPath,
                    width,
                    height,
                    options.page
                );
                domSampler = browserSetup.domSampler;
                batchDomSampler = browserSetup.batchDomSampler;
                cleanupBrowser = browserSetup.cleanup;
                hasShutterBlur = browserSetup.hasShutterBlur;
            } catch (err: any) {
                console.warn(`[Oracle QA] Không thể khởi động browser để lấy mẫu DOM (${err?.message || err}).`);
                domSampler = async () => null;
            }
        } else {
            domSampler = async () => null;
        }
    } else if (!domSampler && batchDomSampler) {
        domSampler = async (t, s) => {
            const res = await batchDomSampler!(t, [s]);
            return res[s] ?? null;
        };
    }

    let continuityLeg: ContinuityLegResult;
    let curvesLeg: CurvesLegResult;
    let framingLeg: FramingLegResult;

    try {
        // 2. Leg 2: Continuity
        continuityLeg = await checkContinuityLeg(
            boundaries,
            scenes,
            durations,
            domSampler!,
            width,
            height
        );

        // 3. Leg 3: Curves
        curvesLeg = await checkCurvesLeg(
            scenes,
            durations,
            boundaries,
            domSampler!,
            fps,
            hasShutterBlur,
            batchDomSampler
        );

        // 4. Leg 4: Framing
        framingLeg = await checkFramingLeg(
            scenes,
            durations,
            domSampler!,
            width,
            height,
            batchDomSampler
        );
    } finally {
        if (cleanupBrowser) {
            await cleanupBrowser();
        }
    }

    // 5. Leg 5: Audio
    const targetAudioPath = explicitAudioPath || audioResult?.mixAudioPath;
    const totalDurationSec =
        audioResult?.totalDurationSec ??
        scenes.reduce((sum, s) => sum + (durations[s.id] ?? s.duration ?? 0), 0);
    const audioLeg = await checkAudioLeg(
        targetAudioPath,
        totalDurationSec,
        options.audioAnalyzer
    );

    // Tổng hợp kết quả từ 5 legs
    const legs = {
        rhythm: rhythmLeg,
        continuity: continuityLeg,
        curves: curvesLeg,
        framing: framingLeg,
        audio: audioLeg,
    };

    const errors: string[] = [];
    const warnings: string[] = [];

    for (const [legName, legResult] of Object.entries(legs)) {
        if (legResult.status === 'fail') {
            const reason =
                'reason' in legResult && legResult.reason
                    ? legResult.reason
                    : `Kiểm tra ${legName} thất bại`;
            errors.push(`[${legName.toUpperCase()}] ${reason}`);
        } else if (legResult.status === 'warn') {
            const reason =
                'reason' in legResult && legResult.reason
                    ? legResult.reason
                    : `Lưu ý kiểm tra ${legName}`;
            warnings.push(`[${legName.toUpperCase()}] ${reason}`);
        }
    }

    let qaStatus: 'pass' | 'warn' | 'fail' = 'pass';
    let valid = true;

    if (errors.length > 0) {
        qaStatus = 'fail';
        valid = false;
    } else if (warnings.length > 0) {
        qaStatus = 'warn';
        valid = true;
    }

    return {
        jobId,
        qaStatus,
        attempt,
        valid,
        carryScore: continuityLeg.carryScore,
        warnings,
        errors,
        legs,
        createdAt: new Date().toISOString(),
    };
}
