import { z } from 'zod';
import { allocateBeats } from '../templates/storySpine.js';

/**
 * Tempo (nấc nhịp cắt cảnh) theo từng video — issue #117.
 *
 * Đây là NGUỒN SỰ THẬT DUY NHẤT cho nhịp điệu. Cả hai đầu đều đọc từ đây:
 *   - đầu viết: `formatTempoPrompt()` nhét hướng dẫn vào prompt sinh kịch bản;
 *   - đầu chấm: `videoScriptSchema` (validate lúc parse) và `checkRhythmLeg`
 *     (Oracle QA) lấy `minRatio` / `minCv` từ cùng một profile.
 *
 * Nguyên tắc chống overfitting: `auto` giữ nguyên ngưỡng cũ (ratio >= 4,
 * CV >= 0.3) nên không regression. Các nấc còn lại chỉ nới/siết theo ý đồ đã
 * khai báo, kèm metric `budgetDeviation` + `beatAlignment` để đo độ lệch so với
 * ngân sách độ dài scene đã khai — dữ liệu dùng để hiệu chuẩn trên ~10 video
 * thật trước khi đổi ngưỡng mặc định.
 */
export const TEMPO_IDS = ['auto', 'fast', 'balanced', 'slow'] as const;

export const tempoSchema = z.enum(TEMPO_IDS);
export type Tempo = z.infer<typeof tempoSchema>;

export interface SceneDurationRange {
    /** Độ dài scene ngắn nhất nên có (giây). */
    min: number;
    /** Độ dài scene dài nhất nên có (giây). */
    max: number;
}

export interface TempoProfile {
    id: Tempo;
    /** Nhãn hiển thị cho UI. */
    label: string;
    /** Mô tả ngắn gọn cho UI + prompt. */
    description: string;
    /** Tỉ số cảnh dài nhất / ngắn nhất tối thiểu mà QA chấp nhận. */
    minRatio: number;
    /** Hệ số biến thiên độ dài cảnh tối thiểu (chống uniform cadence). */
    minCv: number;
    /**
     * Dải độ dài scene mục tiêu. `null` = không khai báo (auto) → không có
     * ngân sách để đo độ lệch, QA giữ ngưỡng cũ.
     */
    sceneDurationSec: SceneDurationRange | null;
    /** Trần số scene gợi ý cho video dài. */
    maxScenes: number;
}

export const TEMPO_PROFILES: Record<Tempo, TempoProfile> = {
    auto: {
        id: 'auto',
        label: 'Tự động',
        description: 'AI tự chọn nhịp theo nội dung. Giữ nguyên ngưỡng QA hiện tại.',
        minRatio: 4,
        minCv: 0.3,
        sceneDurationSec: null,
        maxScenes: 8,
    },
    fast: {
        id: 'fast',
        label: 'Dồn dập',
        description: 'Quảng cáo, hook ngắn: cắt nhanh, nhiều cảnh ngắn, tương phản mạnh.',
        // Siết hơn auto để "dồn dập" thực sự khác "tự động" (issue #117 comment).
        minRatio: 5,
        minCv: 0.4,
        sceneDurationSec: { min: 1.0, max: 2.5 },
        maxScenes: 12,
    },
    balanced: {
        id: 'balanced',
        label: 'Cân bằng',
        description: 'Nhịp vừa, có điểm nhấn. Phù hợp phần lớn video giới thiệu.',
        minRatio: 3,
        minCv: 0.25,
        sceneDurationSec: { min: 2.0, max: 4.5 },
        maxScenes: 10,
    },
    slow: {
        id: 'slow',
        label: 'Thư thả',
        description: 'Giải thích, kể chuyện: cảnh dài, ít cắt, ưu tiên người xem kịp tiếp thu.',
        minRatio: 1.8,
        minCv: 0.15,
        sceneDurationSec: { min: 3.5, max: 7.0 },
        maxScenes: 8,
    },
};

/** Tra profile theo tempo, luôn trả về một profile hợp lệ. */
export function resolveTempoProfile(tempo?: string | null): TempoProfile {
    if (tempo && (TEMPO_IDS as readonly string[]).includes(tempo)) {
        return TEMPO_PROFILES[tempo as Tempo];
    }
    return TEMPO_PROFILES.auto;
}

/**
 * Số scene gợi ý cho `targetDurationSec`.
 * `auto` giữ đúng hành vi cũ (`allocateBeats`) để không regression.
 */
export function plannedSceneCount(targetDurationSec: number, tempo: Tempo = 'auto'): number {
    const profile = resolveTempoProfile(tempo);
    if (profile.id === 'auto' || !profile.sceneDurationSec) {
        return Math.max(1, allocateBeats(targetDurationSec).length);
    }

    const midpoint = (profile.sceneDurationSec.min + profile.sceneDurationSec.max) / 2;
    const raw = Math.round(targetDurationSec / midpoint);
    return Math.max(1, Math.min(profile.maxScenes, Number.isFinite(raw) ? raw : 1));
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const round3 = (v: number) => Math.round(v * 1000) / 1000;

export interface TempoBudgetDeviation {
    /** Trung bình số giây vượt ra ngoài dải khai báo (0 = mọi cảnh đúng dải). */
    meanAbsSec: number;
    /** `meanAbsSec` chia trung điểm dải — chuẩn hoá để so giữa các tempo. */
    meanAbsRatio: number;
    /** Số cảnh nằm ngoài dải khai báo. */
    outOfRangeScenes: number;
    /** Tỉ lệ cảnh nằm ngoài dải (0..1). */
    outOfRangeRatio: number;
    /** Dải đã khai báo, để báo cáo giải thích được con số. */
    range: SceneDurationRange;
}

/**
 * Đo độ lệch của độ dài scene thật so với ngân sách tempo đã khai.
 * Trả `null` khi tempo không khai báo dải (`auto`) hoặc không có scene.
 */
export function measureTempoBudget(
    durations: number[],
    tempo: Tempo = 'auto'
): TempoBudgetDeviation | null {
    const profile = resolveTempoProfile(tempo);
    const range = profile.sceneDurationSec;
    const valid = durations.filter((d) => Number.isFinite(d) && d > 0);
    if (!range || valid.length === 0) return null;

    const midpoint = (range.min + range.max) / 2;
    let outOfRangeScenes = 0;
    let totalDeviation = 0;

    for (const d of valid) {
        if (d < range.min) {
            totalDeviation += range.min - d;
            outOfRangeScenes++;
        } else if (d > range.max) {
            totalDeviation += d - range.max;
            outOfRangeScenes++;
        }
    }

    const meanAbsSec = totalDeviation / valid.length;
    return {
        meanAbsSec: round2(meanAbsSec),
        meanAbsRatio: round3(meanAbsSec / midpoint),
        outOfRangeScenes,
        outOfRangeRatio: round3(outOfRangeScenes / valid.length),
        range,
    };
}

export interface BeatAlignment {
    plannedScenes: number;
    actualScenes: number;
    /** 1 = khớp đúng số beat, 0 = lệch >= 100%. */
    score: number;
}

/** So số scene thật với số beat mà story spine dự kiến cho tempo + thời lượng. */
export function measureBeatAlignment(
    actualSceneCount: number,
    targetDurationSec: number,
    tempo: Tempo = 'auto'
): BeatAlignment {
    const plannedScenes = plannedSceneCount(targetDurationSec, tempo);
    const score =
        plannedScenes > 0
            ? Math.max(0, 1 - Math.abs(actualSceneCount - plannedScenes) / plannedScenes)
            : 0;

    return {
        plannedScenes,
        actualScenes: actualSceneCount,
        score: round3(score),
    };
}

/**
 * Hướng dẫn nhịp điệu nhét vào prompt sinh kịch bản — cùng nguồn với ngưỡng QA.
 */
export function formatTempoPrompt(tempo: Tempo = 'auto', targetDurationSec = 15): string {
    const profile = resolveTempoProfile(tempo);
    const planned = plannedSceneCount(targetDurationSec, profile.id);
    const lines: string[] = [
        '## TEMPO / CẮT CẢNH (bắt buộc)',
        `Nhịp người dùng chọn: **${profile.label}** (${profile.id}). ${profile.description}`,
        `- Số cảnh gợi ý cho ~${targetDurationSec}s: khoảng ${planned} cảnh.`,
        `- Tương phản độ dài: cảnh dài nhất ≥ ${profile.minRatio}× cảnh ngắn nhất; CV (độ lệch chuẩn / trung bình) ≥ ${profile.minCv}.`,
    ];

    if (profile.sceneDurationSec) {
        lines.push(
            `- Độ dài mỗi cảnh nên nằm trong ${profile.sceneDurationSec.min}–${profile.sceneDurationSec.max}s. QA đo độ lệch so với dải này và cảnh báo khi quá nửa số cảnh rơi ra ngoài.`
        );
    } else {
        lines.push(
            '- Không ép số cảnh: ưu tiên nhịp tự nhiên của nội dung, nhưng vẫn phải tạo tương phản (một cảnh ngắn dồn dập + một cảnh dài lắng lại).'
        );
    }

    lines.push(
        '- Đừng kéo dài cảnh chỉ để lấp thời lượng: độ dài cảnh do lời đọc quyết định, không bù khoảng lặng.'
    );

    return lines.join('\n');
}
