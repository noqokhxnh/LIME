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
    type Tempo,
    type TempoBudgetDeviation,
    type BeatAlignment,
    resolveTempoProfile,
    measureTempoBudget,
    measureBeatAlignment,
} from '../llm/tempo.js';
import {
    launchPreviewBrowser,
    loadAndPreparePage,
    seekToTimestamp,
} from './preview.js';
import { installNetworkGuard } from './networkGuard.js';
import { getCaptionBandFromRect, captionOverlapRatio } from './karaoke.js';
import { lintGsapCode } from './gsapLinter.js';
import type { ViolationType } from './compLinter.js';
import { dirname, resolve } from 'node:path';

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
    /** Tempo đã dùng để chấm (#117). */
    tempo?: Tempo;
    /** Ngưỡng thực tế áp dụng — để báo cáo tự giải thích được. */
    thresholds?: { minRatio: number; minCv: number };
    /**
     * Độ lệch so với dải độ dài scene đã khai của tempo. `null` khi tempo không
     * khai báo dải (auto). Metric dùng để hiệu chuẩn trên nhiều video thật.
     */
    budgetDeviation?: TempoBudgetDeviation | null;
    /** Số scene thật vs số beat dự kiến của story spine. */
    beatAlignment?: BeatAlignment | null;
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

/** Một phần tử nội dung của scene kèm nhãn để báo lỗi cho LLM/user. */
export interface CaptionContentElement {
    label: string;
    box: DOMBox;
    /**
     * Đường dẫn tương đối trong cây DOM của scene (vd `0/2/1`) — dùng để bỏ qua
     * cặp phần tử lồng nhau (cha/con) khi đo chồng lấn bố cục (#111).
     */
    path?: string;
    /** Loại phần tử: chữ (text) hay media/control (img, svg, video...). */
    kind?: 'text' | 'media';
}

/**
 * Ảnh chụp tại một thời điểm: bounding box thật của caption đang hiển thị
 * (null nếu scene không có cue) + các phần tử nội dung của scene đang active.
 */
export interface CaptionBandSample {
    caption: DOMBox | null;
    elements: CaptionContentElement[];
}

export type CaptionBandSampler = (timeSec: number, sceneId: string) => Promise<CaptionBandSample | null>;

export interface CaptionLegResult {
    status: 'pass' | 'warn' | 'fail';
    /** Số mẫu có caption thực sự hiển thị (bỏ qua mẫu không có cue). */
    sampledFrames?: number;
    violations?: string[];
    reason?: string;
}

export interface AudioLegResult {
    status: 'pass' | 'warn' | 'fail';
    peakDbfs?: number;
    quietSec?: number;
    reason?: string;
}

/** Một vi phạm linter GSAP, kèm scene + dòng để retry/LLM sửa đúng chỗ. */
export interface CodeLintViolation {
    sceneId?: string;
    rule: ViolationType;
    line: number;
    column?: number;
    message: string;
}

/**
 * Chân lint code GSAP (#41).
 * Mặc định **warn-only**: job vẫn pass, vi phạm được ghi vào QA report để hiệu
 * chuẩn. Bật `strict` (option `gsapLintStrict` hoặc env `LIME_GSAP_LINT_STRICT=1`)
 * thì vi phạm trở thành fail và kích hoạt retry.
 */
export interface CodeLintLegResult {
    status: 'pass' | 'warn' | 'fail';
    strict: boolean;
    /** Tổng số scene/jsCode đã lint (kể cả globalSetupJs). */
    lintedUnits: number;
    violations: CodeLintViolation[];
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
    /**
     * `true` khi pipeline chọn render tiếp dù QA đã kết luận `fail` sau khi hết
     * lượt thử (graceful degradation). Báo cáo vẫn giữ nguyên `qaStatus: 'fail'`
     * và `valid: false` để phản ánh đúng chất lượng kịch bản.
     */
    degraded?: boolean;
    legs: {
        rhythm: RhythmLegResult;
        continuity: ContinuityLegResult;
        curves: CurvesLegResult;
        framing: FramingLegResult;
        caption: CaptionLegResult;
        composition: CompositionLegResult;
        audio: AudioLegResult;
        code: CodeLintLegResult;
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
    /** Lấy bbox thật của caption + phần tử nội dung tại thời điểm t (issue #110). */
    captionSampler?: CaptionBandSampler;
    /**
     * Lấy phần tử nội dung của scene để đo bố cục (#111). Mặc định dùng chung
     * `captionSampler` — sampler này trả phần tử cả khi scene không có phụ đề.
     */
    contentSampler?: CaptionBandSampler;
    audioAnalyzer?: (audioPath: string) => Promise<AudioStats>;
    page?: Page;
    hasShutterBlur?: boolean;
    /** Tempo đã chọn cho video (#117) — mặc định lấy từ script, rồi 'auto'. */
    tempo?: Tempo;
    /** Thời lượng mục tiêu — dùng cho metric beat alignment. */
    targetDurationSec?: number;
    /**
     * Bật lint GSAP thành fail (#41). Mặc định warn-only trong giai đoạn hiệu
     * chuẩn; env `LIME_GSAP_LINT_STRICT=1` cũng bật.
     */
    gsapLintStrict?: boolean;
    /** Biến vi phạm bố cục (#111) thành fail thay vì warn-only. */
    compositionStrict?: boolean;
}

/**
 * Leg 1: Rhythm (#117)
 *
 * Ngưỡng lấy từ profile của `tempo` đã chọn — cùng nguồn với prompt sinh kịch
 * bản và validate schema. `auto` giữ nguyên 4 / 0.3 nên không regression.
 *
 * Ngoài fail cứng theo CV/ratio, leg còn trả hai metric chẩn đoán:
 *  - `budgetDeviation`: độ lệch so với dải độ dài scene mà tempo đã khai;
 *  - `beatAlignment`: số scene thật vs số beat story spine dự kiến.
 * Hai metric này chỉ gây `warn` với tempo khai báo rõ (không phải auto) để
 * tránh đổi hành vi mặc định khi chưa có baseline ~10 video thật.
 */
export function checkRhythmLeg(
    scenes: scene[],
    durations?: Record<string, number>,
    options?: { tempo?: Tempo; targetDurationSec?: number }
): RhythmLegResult {
    const tempo: Tempo = options?.tempo ?? 'auto';
    const profile = resolveTempoProfile(tempo);
    const thresholds = { minRatio: profile.minRatio, minCv: profile.minCv };

    if (!scenes || scenes.length <= 1) {
        return {
            status: 'pass',
            cv: 0,
            ratio: 1,
            nearStillSec: 0,
            tempo,
            thresholds,
        };
    }

    const scenesWithDurations = scenes.map((s) => ({
        ...s,
        duration: durations?.[s.id] ?? s.duration ?? 0,
    }));

    const rhythm = checkRhythm(scenesWithDurations, thresholds);
    const measuredDurations = scenesWithDurations
        .map((s) => s.duration)
        .filter((d) => Number.isFinite(d) && d > 0);
    const budgetDeviation = measureTempoBudget(measuredDurations, tempo);
    const totalDuration =
        options?.targetDurationSec ??
        measuredDurations.reduce((sum, d) => sum + d, 0);
    const beatAlignment =
        totalDuration > 0
            ? measureBeatAlignment(scenes.length, totalDuration, tempo)
            : null;

    const roundedCv = Math.round(rhythm.cv * 100) / 100;
    const roundedRatio = Math.round(rhythm.ratio * 100) / 100;
    const base = {
        cv: roundedCv,
        ratio: roundedRatio,
        tempo,
        thresholds,
        budgetDeviation,
        beatAlignment,
    };

    const failReasons: string[] = [];
    if (rhythm.cv < profile.minCv) {
        failReasons.push(
            `Hệ số biến thiên độ dài cảnh (CV) là ${rhythm.cv.toFixed(2)} (< ${profile.minCv} cho tempo '${tempo}', vi phạm quy tắc chống nhịp điệu đều uniform cadence)`
        );
    }
    if (rhythm.ratio < profile.minRatio) {
        failReasons.push(
            `Tỉ số shot dài nhất / ngắn nhất là ${rhythm.ratio.toFixed(2)} (< ${profile.minRatio} cho tempo '${tempo}', thiếu sự tương phản nhịp độ)`
        );
    }

    if (failReasons.length > 0) {
        return {
            ...base,
            status: 'fail',
            nearStillSec: rhythm.hasNearStill ? 1.5 : 0,
            reason: failReasons.join('; '),
        };
    }

    const warnReasons: string[] = [];
    if (!rhythm.hasNearStill) {
        warnReasons.push(
            'Kịch bản thiếu khoảng nghỉ tĩnh (near-still >= 1.5s) để người xem tiếp thu nội dung'
        );
    }

    // Chỉ cảnh báo ngân sách/beat khi người dùng khai báo tempo rõ ràng — với
    // `auto` đây mới là metric thu thập baseline, chưa đủ dữ liệu để chấm.
    if (profile.id !== 'auto') {
        if (budgetDeviation && budgetDeviation.outOfRangeRatio > 0.5) {
            warnReasons.push(
                `Quá nửa số cảnh (${budgetDeviation.outOfRangeScenes}/${measuredDurations.length}) nằm ngoài dải ${budgetDeviation.range.min}–${budgetDeviation.range.max}s của tempo '${tempo}' (lệch trung bình ${budgetDeviation.meanAbsSec}s/cảnh)`
            );
        }
        if (beatAlignment && beatAlignment.score < 0.5) {
            warnReasons.push(
                `Số cảnh (${beatAlignment.actualScenes}) lệch xa story spine dự kiến (${beatAlignment.plannedScenes} beat) cho tempo '${tempo}'`
            );
        }
    }

    if (warnReasons.length > 0) {
        return {
            ...base,
            status: 'warn',
            nearStillSec: rhythm.hasNearStill ? 1.5 : 0,
            reason: warnReasons.join('; '),
        };
    }

    return {
        ...base,
        status: 'pass',
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
 * Leg 4b: Caption band (vùng cấm caption — issue #110)
 *
 * Không hard-code 12%: mỗi mẫu lấy bounding box THẬT của `.karaoke-cue.is-active`
 * sau layout (1/2/3 dòng, font-size, 16:9 hay 9:16 đều khác nhau) rồi so với
 * bounding box của các phần tử nội dung trong scene đang active.
 *
 * Fail khi phần tử nội dung (CTA, tiêu đề, ảnh, chữ) bị caption che >= 10% diện
 * tích. Phần tử trang trí nền được sampler bỏ qua nếu khai báo `data-caption-exempt`
 * hoặc phủ gần kín khung (background full-bleed).
 */
export async function checkCaptionBandLeg(
    scenes: scene[],
    durations: Record<string, number>,
    captionSampler: CaptionBandSampler,
    options?: { stepSec?: number; minOverlapRatio?: number }
): Promise<CaptionLegResult> {
    const step = options?.stepSec ?? 0.5;
    const minOverlapRatio = options?.minOverlapRatio ?? 0.1;
    let runningTime = 0;
    let sampledFrames = 0;

    // Gộp theo scene + phần tử, giữ mức che lớn nhất để báo cáo không bị nhiễu
    // bởi cùng một CTA xuất hiện ở nhiều mốc thời gian.
    const worst = new Map<string, { sceneId: string; label: string; ratio: number; timeSec: number }>();

    for (const s of scenes) {
        const dur = durations[s.id] ?? s.duration ?? 3.0;
        const startTime = runningTime;
        runningTime += dur;

        const sampleTimes: number[] = [];
        for (let t = startTime; t <= startTime + dur; t += step) {
            sampleTimes.push(t);
        }
        if (sampleTimes.length < 3) {
            sampleTimes.length = 0;
            sampleTimes.push(startTime, startTime + dur / 2, startTime + dur);
        }

        for (const t of sampleTimes) {
            const sample = await captionSampler(t, s.id);
            if (!sample || !sample.caption) continue;
            sampledFrames++;

            const band = getCaptionBandFromRect(sample.caption);
            for (const el of sample.elements) {
                const ratio = captionOverlapRatio(el.box, band);
                if (ratio < minOverlapRatio) continue;

                const key = `${s.id}::${el.label}`;
                const prev = worst.get(key);
                if (!prev || ratio > prev.ratio) {
                    worst.set(key, { sceneId: s.id, label: el.label, ratio, timeSec: t });
                }
            }
        }
    }

    if (worst.size > 0) {
        const violations = Array.from(worst.values())
            .sort((a, b) => b.ratio - a.ratio)
            .map(
                (v) =>
                    `Scene '${v.sceneId}': '${v.label}' bị caption che ${(v.ratio * 100).toFixed(0)}% diện tích tại t=${v.timeSec.toFixed(2)}s`
            );

        return {
            status: 'fail',
            sampledFrames,
            violations,
            reason: `Phát hiện ${violations.length} phần tử nội dung xâm phạm dải caption: ${violations.slice(0, 3).join('; ')}`,
        };
    }

    return { status: 'pass', sampledFrames };
}

/**
 * Một cặp phần tử chồng lấn (chỉ tính chữ–chữ, đã loại cha/con).
 */
export interface CompositionOverlap {
    a: string;
    b: string;
    /** Diện tích giao / diện tích phần tử nhỏ hơn. */
    ratio: number;
    timeSec: number;
}

/**
 * Điểm bố cục của một scene (#111). Ghi vào QA report để hiệu chuẩn ngưỡng
 * trước khi bật fail cứng.
 */
export interface CompositionSceneScore {
    sceneId: string;
    /** Thời điểm lấy mẫu đại diện (giây, toàn video). */
    sampledAt: number;
    elementCount: number;
    /** Diện tích union bbox của nội dung / diện tích khung. */
    contentCoverage: number;
    /** Tỉ lệ diện tích nội dung theo 1/3 dọc của khung (0..1). */
    verticalDistribution: { top: number; middle: number; bottom: number };
    /** Trọng tâm nội dung, chuẩn hoá 0..1 theo khung. */
    centroid: { x: number; y: number };
    maxTextOverlap: number;
    overlaps: CompositionOverlap[];
    violations: string[];
    status: 'pass' | 'warn' | 'fail';
}

export interface CompositionLegResult {
    status: 'pass' | 'warn' | 'fail';
    strict: boolean;
    thresholds: {
        minOverlapRatio: number;
        bottomHeavyRatio: number;
        minElements: number;
        minContentCoverage: number;
    };
    scenes: CompositionSceneScore[];
    violations: string[];
    reason?: string;
}

export interface CompositionOptions {
    /** Tỉ lệ giao / diện tích phần tử nhỏ hơn để coi là chồng lấn. Mặc định 0.25. */
    minOverlapRatio?: number;
    /** Tỉ lệ diện tích dồn vào 1/3 dưới để coi là dồn đáy. Mặc định 0.6. */
    bottomHeavyRatio?: number;
    /** Số phần tử tối thiểu mới chấm dồn đáy. Mặc định 3. */
    minElements?: number;
    /** Độ phủ nội dung tối thiểu để chấm dồn đáy (tránh 3 icon tí xíu). Mặc định 0.02. */
    minContentCoverage?: number;
    strict?: boolean;
}

const COMPOSITION_DEFAULTS = {
    minOverlapRatio: 0.25,
    bottomHeavyRatio: 0.6,
    minElements: 3,
    minContentCoverage: 0.02,
};

function clipBox(box: DOMBox, width: number, height: number) {
    const left = Math.max(0, box.left);
    const top = Math.max(0, box.top);
    const right = Math.min(width, box.right);
    const bottom = Math.min(height, box.bottom);
    return {
        left,
        top,
        right,
        bottom,
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top),
    };
}

function isAncestorPath(a?: string, b?: string): boolean {
    if (!a || !b || a === b) return false;
    return b.startsWith(`${a}/`) || a.startsWith(`${b}/`);
}

/**
 * Đo bố cục của một scene từ danh sách phần tử nội dung (đã có bbox thật).
 *
 * v1 chỉ chấm hai lỗi có thể bảo vệ được bằng số liệu:
 *  1. Chồng lấn chữ–chữ (bỏ qua cha/con và media, vì text đè lên ảnh/svg là
 *     chủ ý thiết kế).
 *  2. Dồn đáy: >= 3 phần tử và >= 60% diện tích nội dung nằm ở 1/3 dưới khung
 *     (2/3 trên trống) — đúng lỗi của scene 3 video mẫu "Mộc Ca-phê".
 *
 * Phân bố dọc và trọng tâm vẫn được trả về để hiệu chuẩn; chưa dùng để chấm vì
 * các job thật cho thấy bố cục dồn 1/3 trên là chủ ý (poster/9:16).
 */
export function measureComposition(
    sceneId: string,
    elements: CaptionContentElement[],
    width: number,
    height: number,
    options?: CompositionOptions,
    timeSec = 0
): CompositionSceneScore {
    const cfg = { ...COMPOSITION_DEFAULTS, ...options };
    const frameArea = Math.max(1, width * height);

    const visible = elements
        .map((el) => ({ ...el, box: clipBox(el.box, width, height) }))
        .filter((el) => el.box.width > 0 && el.box.height > 0);

    const violations: string[] = [];
    const overlaps: CompositionOverlap[] = [];
    let maxTextOverlap = 0;

    for (let i = 0; i < visible.length; i++) {
        for (let j = i + 1; j < visible.length; j++) {
            const a = visible[i];
            const b = visible[j];
            if (a.kind === 'media' || b.kind === 'media') continue;
            if (isAncestorPath(a.path, b.path)) continue;

            const interW = Math.max(0, Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left));
            const interH = Math.max(0, Math.min(a.box.bottom, b.box.bottom) - Math.max(a.box.top, b.box.top));
            const inter = interW * interH;
            if (inter <= 0) continue;

            const areaA = a.box.width * a.box.height;
            const areaB = b.box.width * b.box.height;
            const smaller = Math.min(areaA, areaB);
            if (smaller < frameArea * 0.002) continue;

            const ratio = inter / smaller;
            if (ratio < cfg.minOverlapRatio) continue;
            maxTextOverlap = Math.max(maxTextOverlap, ratio);
            overlaps.push({ a: a.label, b: b.label, ratio, timeSec });
            violations.push(
                `Scene '${sceneId}': '${a.label}' và '${b.label}' chồng lấn ${(ratio * 100).toFixed(0)}% diện tích tại t=${timeSec.toFixed(2)}s`
            );
        }
    }

    // Phân bố dọc + trọng tâm, tính theo diện tích nhìn thấy.
    const thirds = { top: 0, middle: 0, bottom: 0 };
    let totalArea = 0;
    let cx = 0;
    let cy = 0;
    let unionLeft = Infinity;
    let unionTop = Infinity;
    let unionRight = -Infinity;
    let unionBottom = -Infinity;

    for (const el of visible) {
        const area = el.box.width * el.box.height;
        if (area <= 0) continue;
        const centerY = (el.box.top + el.box.bottom) / 2 / height;
        const idx = centerY < 1 / 3 ? 'top' : centerY < 2 / 3 ? 'middle' : 'bottom';
        thirds[idx] += area;
        totalArea += area;
        cx += ((el.box.left + el.box.right) / 2) * area;
        cy += ((el.box.top + el.box.bottom) / 2) * area;
        unionLeft = Math.min(unionLeft, el.box.left);
        unionTop = Math.min(unionTop, el.box.top);
        unionRight = Math.max(unionRight, el.box.right);
        unionBottom = Math.max(unionBottom, el.box.bottom);
    }

    const distribution =
        totalArea > 0
            ? {
                  top: thirds.top / totalArea,
                  middle: thirds.middle / totalArea,
                  bottom: thirds.bottom / totalArea,
              }
            : { top: 0, middle: 0, bottom: 0 };

    const contentCoverage =
        totalArea > 0
            ? ((unionRight - unionLeft) * (unionBottom - unionTop)) / frameArea
            : 0;

    if (
        visible.length >= cfg.minElements &&
        contentCoverage >= cfg.minContentCoverage &&
        distribution.bottom >= cfg.bottomHeavyRatio &&
        distribution.top + distribution.middle < 1 - cfg.bottomHeavyRatio + 1e-6
    ) {
        violations.push(
            `Scene '${sceneId}': ${(distribution.bottom * 100).toFixed(0)}% nội dung dồn vào 1/3 dưới khung (2/3 trên trống) — phân bố top/middle/bottom = ${(
                distribution.top * 100
            ).toFixed(0)}/${(distribution.middle * 100).toFixed(0)}/${(distribution.bottom * 100).toFixed(0)}%`
        );
    }

    return {
        sceneId,
        sampledAt: timeSec,
        elementCount: visible.length,
        contentCoverage: Math.round(contentCoverage * 1000) / 1000,
        verticalDistribution: {
            top: Math.round(distribution.top * 1000) / 1000,
            middle: Math.round(distribution.middle * 1000) / 1000,
            bottom: Math.round(distribution.bottom * 1000) / 1000,
        },
        centroid: {
            x: totalArea > 0 ? Math.round((cx / totalArea / width) * 1000) / 1000 : 0.5,
            y: totalArea > 0 ? Math.round((cy / totalArea / height) * 1000) / 1000 : 0.5,
        },
        maxTextOverlap: Math.round(maxTextOverlap * 1000) / 1000,
        overlaps,
        violations,
        status: violations.length === 0 ? 'pass' : cfg.strict ? 'fail' : 'warn',
    };
}

/**
 * Leg 6: Composition (#111) — đo bố cục thật từ bbox phần tử sau layout.
 *
 * Lấy mẫu ở 60% và 85% thời lượng scene (sau animation vào) và chọn mẫu có
 * nhiều phần tử nhất. Mặc định warn-only; `strict` biến vi phạm thành fail.
 */
export async function checkCompositionLeg(
    scenes: scene[],
    durations: Record<string, number>,
    contentSampler: CaptionBandSampler,
    width: number,
    height: number,
    options?: CompositionOptions
): Promise<CompositionLegResult> {
    const strict = options?.strict === true;
    const thresholds = {
        minOverlapRatio: options?.minOverlapRatio ?? COMPOSITION_DEFAULTS.minOverlapRatio,
        bottomHeavyRatio: options?.bottomHeavyRatio ?? COMPOSITION_DEFAULTS.bottomHeavyRatio,
        minElements: options?.minElements ?? COMPOSITION_DEFAULTS.minElements,
        minContentCoverage:
            options?.minContentCoverage ?? COMPOSITION_DEFAULTS.minContentCoverage,
    };

    const scores: CompositionSceneScore[] = [];
    const violations: string[] = [];
    let runningTime = 0;

    for (const s of scenes) {
        const dur = durations[s.id] ?? s.duration ?? 3.0;
        const startTime = runningTime;
        runningTime += dur;

        const sampleTimes = [startTime + dur * 0.6, startTime + dur * 0.85];
        let best: { elements: CaptionContentElement[]; timeSec: number } | null = null;

        for (const t of sampleTimes) {
            let sample: CaptionBandSample | null = null;
            try {
                sample = await contentSampler(t, s.id);
            } catch {
                sample = null;
            }
            const elements = sample?.elements ?? [];
            if (!best || elements.length >= best.elements.length) {
                best = { elements, timeSec: t };
            }
        }

        if (!best || best.elements.length === 0) {
            scores.push({
                sceneId: s.id,
                sampledAt: best?.timeSec ?? startTime,
                elementCount: 0,
                contentCoverage: 0,
                verticalDistribution: { top: 0, middle: 0, bottom: 0 },
                centroid: { x: 0.5, y: 0.5 },
                maxTextOverlap: 0,
                overlaps: [],
                violations: [],
                status: 'pass',
            });
            continue;
        }

        const score = measureComposition(
            s.id,
            best.elements,
            width,
            height,
            { ...options, strict },
            best.timeSec
        );
        scores.push(score);
        violations.push(...score.violations);
    }

    if (violations.length === 0) {
        return { status: 'pass', strict, thresholds, scenes: scores, violations: [] };
    }

    const summary = `Phát hiện ${violations.length} lỗi bố cục: ${violations.slice(0, 3).join('; ')}`;
    return {
        status: strict ? 'fail' : 'warn',
        strict,
        thresholds,
        scenes: scores,
        violations,
        reason: strict ? summary : `${summary} (warn-only; bật compositionStrict để chặn render)`,
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
 * Tách các block `<script>` inline trong htmlCode của scene.
 *
 * Bỏ qua `<script src=...>` (không có code để lint) và các block không phải
 * JavaScript (`application/json`, `application/ld+json`...). Trả kèm số dòng
 * bắt đầu để báo lỗi vẫn trỏ đúng vị trí trong htmlCode gốc.
 */
export function extractInlineScripts(htmlCode: string): Array<{ code: string; startLine: number }> {
    const blocks: Array<{ code: string; startLine: number }> = [];
    const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
    let match: RegExpExecArray | null;
    while ((match = re.exec(htmlCode)) !== null) {
        const attrs = match[1] || '';
        const body = match[2] || '';
        if (/\bsrc\s*=/i.test(attrs)) continue;
        const typeMatch = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs);
        const type = typeMatch?.[1]?.toLowerCase();
        if (type && !/^(text\/javascript|application\/javascript|module|text\/ecmascript)$/.test(type)) {
            continue;
        }
        if (!body.trim()) continue;
        const startLine = htmlCode.slice(0, match.index).split('\n').length;
        blocks.push({ code: body, startLine });
    }
    return blocks;
}

/**
 * Chân lint code GSAP (#41).
 *
 * Lint `globalSetupJs`, `jsCode` từng scene và các block `<script>` inline trong
 * `htmlCode`. Ở giai đoạn hiệu chuẩn leg này **warn-only** — job vẫn pass và
 * vi phạm được ghi vào QA report. Bật `strict` thì vi phạm thành `fail` để
 * kích hoạt retry sinh kịch bản.
 */
export function checkGsapLintLeg(
    script: videoScript,
    options?: { strict?: boolean }
): CodeLintLegResult {
    const strict = options?.strict === true;
    const violations: CodeLintViolation[] = [];
    let lintedUnits = 0;

    const lintUnit = (code: string, sceneId?: string) => {
        if (!code || !code.trim()) return;
        lintedUnits += 1;
        const result = lintGsapCode(code, sceneId);
        for (const v of result.violations) {
            violations.push({
                sceneId,
                rule: v.type,
                line: v.line,
                column: v.column,
                message: v.message,
            });
        }
    };

    lintUnit(script.globalSetupJs, undefined);
    for (const scene of script.scenes || []) {
        lintUnit(scene.jsCode, scene.id);
        for (const block of extractInlineScripts(scene.htmlCode || '')) {
            lintedUnits += 1;
            const result = lintGsapCode(block.code, scene.id);
            for (const v of result.violations) {
                violations.push({
                    sceneId: scene.id,
                    rule: v.type,
                    line: (v.line || 0) + block.startLine - 1,
                    column: v.column,
                    message: v.message,
                });
            }
        }
    }

    if (violations.length === 0) {
        return { status: 'pass', strict, lintedUnits, violations: [] };
    }

    const preview = violations
        .slice(0, 3)
        .map((v) => `${v.sceneId ?? 'global'}: ${v.rule} (dòng ${v.line})`)
        .join('; ');
    const suffix = violations.length > 3 ? `; +${violations.length - 3} vi phạm khác` : '';
    const summary = `${violations.length} vi phạm GSAP — ${preview}${suffix}`;

    return {
        status: strict ? 'fail' : 'warn',
        strict,
        lintedUnits,
        violations,
        reason: strict
            ? summary
            : `${summary} (warn-only; bật gsapLintStrict để chặn render)`,
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
    captionSampler: CaptionBandSampler;
    /** Cùng nguồn đo với captionSampler, dùng cho leg composition (#111). */
    contentSampler: CaptionBandSampler;
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
        await installNetworkGuard(context, { fileRoots: [dirname(resolve(htmlPath))] });
        page = await context.newPage();
    }

    await loadAndPreparePage(page, htmlPath, width, height);

    // Kiểm tra marker window.__hasShutterBlur trước khi fallback sang regex HTML (Spec D)
    const markerBlur = await page.evaluate(() => !!(window as any).__hasShutterBlur).catch(() => false);
    const htmlContent = existsSync(htmlPath) ? readFileSync(htmlPath, 'utf-8') : '';
    const regexBlur = /shutter[-_]?blur|motion[-_]?blur|feGaussianBlur|filter:\s*blur/i.test(htmlContent);
    const hasShutterBlur = markerBlur || regexBlur;

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

    /**
     * Đo bbox thật của caption đang hiển thị + các phần tử nội dung của scene.
     * Chạy trong page để tránh N lần round-trip mỗi mẫu.
     */
    const captionSampler: CaptionBandSampler = async (timeSec: number, sceneId: string) => {
        await seekOnce(timeSec);
        // Lưu ý: KHÔNG khai báo helper function bên trong page.evaluate — tsx/esbuild
        // chèn `__name()` vào closure và gây ReferenceError trong browser context.
        return page.evaluate((sid: string) => {
            const activeCue = document.querySelector('#lime-karaoke .karaoke-cue.is-active');
            const caption = activeCue
                ? (() => {
                      const cr = activeCue.getBoundingClientRect();
                      return {
                          left: cr.left,
                          top: cr.top,
                          right: cr.right,
                          bottom: cr.bottom,
                          width: cr.width,
                          height: cr.height,
                      };
                  })()
                : null;

            const root =
                document.getElementById(sid) ||
                (document.querySelector(`[data-scene="${sid}"]`) as HTMLElement | null);
            // Không có cue vẫn phải trả phần tử nội dung: leg composition (#111)
            // đo bố cục cả ở scene không có phụ đề.
            if (!root) return { caption, elements: [] as any[] };

            const frameArea = window.innerWidth * window.innerHeight;
            // Không dùng whitelist theo tag: LLM hay đặt CTA/nhãn trong <div>/<span>
            // (ví dụ `.brand-title`) nên whitelist cũ bỏ sót và QA cho pass oan.
            // Thay vào đó lấy mọi phần tử "mang nội dung":
            //  - có text node trực tiếp (không phải wrapper bao quanh), hoặc
            //  - là media/control (img, svg, video, canvas, button, a, input...).
            const MEDIA_TAGS = ['IMG', 'SVG', 'VIDEO', 'CANVAS', 'BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA'];
            const elements: Array<{
                label: string;
                path: string;
                kind: 'text' | 'media';
                box: { left: number; top: number; right: number; bottom: number; width: number; height: number };
            }> = [];

            for (const el of Array.from(root.querySelectorAll('*'))) {
                // Trang trí nền khai báo miễn trừ, hoặc nằm trong vùng miễn trừ.
                if (el.closest('[data-caption-exempt]')) continue;
                if (el.closest('#lime-karaoke')) continue;
                if (el.getAttribute('aria-hidden') === 'true') continue;

                const isMedia = MEDIA_TAGS.includes(el.tagName.toUpperCase());
                let hasDirectText = false;
                for (const node of Array.from(el.childNodes)) {
                    if (node.nodeType === 3 && (node.textContent || '').trim().length > 0) {
                        hasDirectText = true;
                        break;
                    }
                }
                // Bỏ wrapper: chỉ có element con, không có text trực tiếp.
                if (!hasDirectText && !isMedia) continue;

                const cs = window.getComputedStyle(el);
                if (
                    cs.display === 'none' ||
                    cs.visibility === 'hidden' ||
                    parseFloat(cs.opacity || '1') <= 0.01
                ) {
                    continue;
                }

                const r = el.getBoundingClientRect();
                if (r.width <= 0 || r.height <= 0) continue;

                // Ảnh/video phủ gần kín khung là background full-bleed, không phải nội dung.
                const isFullBleed = (r.width * r.height) / frameArea >= 0.8;
                const isExplicitCheck = el.hasAttribute('data-caption-check');
                if (isFullBleed && !isExplicitCheck) continue;

                const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 32);
                const label = el.id
                    ? `#${el.id}`
                    : `${el.tagName.toLowerCase()}${text ? ` "${text}"` : ''}`;

                // Đường dẫn DOM để phân biệt cha/con khi đo chồng lấn.
                const pathParts: number[] = [];
                let cursor: Element | null = el;
                while (cursor && cursor !== root) {
                    const parent: Element | null = cursor.parentElement;
                    if (!parent) break;
                    pathParts.unshift(Array.prototype.indexOf.call(parent.children, cursor));
                    cursor = parent;
                }

                elements.push({
                    label,
                    path: pathParts.join('/'),
                    kind: isMedia ? 'media' : 'text',
                    box: {
                        left: r.left,
                        top: r.top,
                        right: r.right,
                        bottom: r.bottom,
                        width: r.width,
                        height: r.height,
                    },
                });
            }

            return { caption, elements };
        }, sceneId);
    };

    const cleanup = async () => {
        if (browser) {
            await browser.close().catch(() => {});
        }
    };

    return {
        domSampler,
        batchDomSampler,
        captionSampler,
        contentSampler: captionSampler,
        cleanup,
        hasShutterBlur,
    };
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

    // 1. Leg 1: Rhythm — ngưỡng theo tempo của video (#117)
    const tempo: Tempo = options.tempo ?? script.tempo ?? 'auto';
    const rhythmLeg = checkRhythmLeg(scenes, durations, {
        tempo,
        targetDurationSec: options.targetDurationSec,
    });

    // Chuẩn bị DOM sampler
    let domSampler = options.domSampler;
    let batchDomSampler = options.batchDomSampler;
    let captionSampler = options.captionSampler;
    let contentSampler = options.contentSampler;
    let cleanupBrowser: (() => Promise<void>) | null = null;
    let hasShutterBlur = options.hasShutterBlur ?? false;

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
                captionSampler = captionSampler ?? browserSetup.captionSampler;
                contentSampler = contentSampler ?? browserSetup.contentSampler;
                cleanupBrowser = browserSetup.cleanup;
                if (options.hasShutterBlur === undefined) {
                    hasShutterBlur = browserSetup.hasShutterBlur;
                }
            } catch (err: any) {
                console.warn(`[Oracle QA] Không thể khởi động browser để lấy mẫu DOM (${err?.message || err}).`);
                domSampler = async () => null;
            }
        } else {
            domSampler = async () => null;
        }
    } else {
        if (options.hasShutterBlur === undefined) {
            if (options.page) {
                const markerBlur = await options.page.evaluate(() => !!(window as any).__hasShutterBlur).catch(() => false);
                hasShutterBlur = markerBlur;
            }
            if (!hasShutterBlur && existsSync(htmlPath)) {
                const htmlContent = readFileSync(htmlPath, 'utf-8');
                hasShutterBlur = /shutter[-_]?blur|motion[-_]?blur|feGaussianBlur|filter:\s*blur/i.test(htmlContent);
            }
        }
        if (!domSampler && batchDomSampler) {
            domSampler = async (t, s) => {
                const res = await batchDomSampler!(t, [s]);
                return res[s] ?? null;
            };
        }
    }

    let continuityLeg: ContinuityLegResult;
    let curvesLeg: CurvesLegResult;
    let framingLeg: FramingLegResult;
    let captionLeg: CaptionLegResult;
    let compositionLeg: CompositionLegResult;

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

        // 4b. Leg 4b: Caption band — đo bbox thật sau layout (#110)
        if (captionSampler) {
            try {
                captionLeg = await checkCaptionBandLeg(scenes, durations, captionSampler);
            } catch (captionErr: any) {
                // Lỗi đo đạc không được biến thành fail job: hạ xuống warn để vẫn render.
                captionLeg = {
                    status: 'warn',
                    reason: `Không đo được dải caption: ${captionErr?.message || captionErr}`,
                };
            }
        } else {
            captionLeg = { status: 'pass', sampledFrames: 0 };
        }

        // 4c. Leg 4c: Composition — đo bố cục từ bbox thật (#111)
        const layoutSampler = contentSampler ?? captionSampler;
        if (layoutSampler) {
            try {
                compositionLeg = await checkCompositionLeg(
                    scenes,
                    durations,
                    layoutSampler,
                    width,
                    height,
                    {
                        strict:
                            options.compositionStrict ??
                            process.env.LIME_COMPOSITION_STRICT === '1',
                    }
                );
            } catch (compErr: any) {
                compositionLeg = {
                    status: 'warn',
                    strict: false,
                    thresholds: {
                        minOverlapRatio: 0.25,
                        bottomHeavyRatio: 0.6,
                        minElements: 3,
                        minContentCoverage: 0.02,
                    },
                    scenes: [],
                    violations: [],
                    reason: `Không đo được bố cục: ${compErr?.message || compErr}`,
                };
            }
        } else {
            compositionLeg = {
                status: 'pass',
                strict: false,
                thresholds: {
                    minOverlapRatio: 0.25,
                    bottomHeavyRatio: 0.6,
                    minElements: 3,
                    minContentCoverage: 0.02,
                },
                scenes: [],
                violations: [],
            };
        }
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

    // 6. Leg 6: Lint code GSAP (#41) — warn-only trừ khi bật strict
    const codeLeg = checkGsapLintLeg(script, {
        strict: options.gsapLintStrict ?? process.env.LIME_GSAP_LINT_STRICT === '1',
    });

    // Tổng hợp kết quả từ các legs
    const legs = {
        rhythm: rhythmLeg,
        continuity: continuityLeg,
        curves: curvesLeg,
        framing: framingLeg,
        caption: captionLeg,
        composition: compositionLeg,
        audio: audioLeg,
        code: codeLeg,
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
