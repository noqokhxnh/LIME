import { z } from 'zod';
import type { WordTiming } from '../pipeline/wordTiming.js';
export type { WordTiming };

export const mechanismSchema = z.enum([
    'morph',
    'zoomThrough',
    'iris',
    'gather',
    'handoff',
    'hardCut',
]);
export type Mechanism = z.infer<typeof mechanismSchema>;

export const boundarySchema = z
    .object({
        id: z.string().min(1, 'Boundary id không được để trống'), // vd "b1"
        fromScene: z.string().min(1, 'fromScene không được để trống'), // sceneId
        toScene: z.string().min(1, 'toScene không được để trống'), // sceneId
        carry: z.object({
            element: z.string().min(1, 'carry.element không được để trống'), // id của phần tử trong comp
            mechanism: mechanismSchema,
            reason: z.string().optional(), // bắt buộc nếu mechanism === 'hardCut'
        }),
    })
    .refine(
        (b) =>
            b.carry.mechanism !== 'hardCut' ||
            (!!b.carry.reason && b.carry.reason.trim().length > 0),
        {
            message: "mechanism hardCut bắt buộc phải có reason",
            path: ['carry', 'reason'],
        }
    );
export type Boundary = z.infer<typeof boundarySchema>;

export const characterActionItemSchema = z.object({
    characterId: z.string(),
    action: z.enum(['enter', 'walk', 'run', 'idle', 'emote', 'exit']),
    tStart: z.number().min(0),
    tEnd: z.number().min(0),
    emote: z.enum(['happy', 'sad', 'surprised', 'angry', 'thinking']).optional(),
    position: z.object({ x: z.number(), y: z.number() }).optional(),
    scale: z.number().optional(),
    direction: z.enum(['left', 'right']).optional(),
});
export type CharacterActionItem = z.infer<typeof characterActionItemSchema>;

export const sceneSchema = z.object({
    id: z.string(),
    title: z.string(),
    voiceOverText: z.string(),
    visualDescription: z.string(),
    htmlCode: z.string(),
    cssCode: z.string(),
    jsCode: z.string(),
    transition: z.enum(['fade', 'slide-left', 'slide-right', 'slide-up', 'zoom-in', 'zoom-out', 'none']),
    backgroundColor: z.string().default('#000000'),
    duration: z.number().optional(),
    nearStill: z
        .object({
            from: z.number(),
            to: z.number(),
        })
        .optional(),
    subject: z.string().optional(),
    characterActions: z.array(characterActionItemSchema).optional(),
});

export type scene = z.infer<typeof sceneSchema>;

// ============================================================================
// SPEC E: SOUND FROM TIMELINE EVENTS CONTRACT
// ============================================================================

export const timelineMaterialSchema = z.enum([
    'air',
    'wood',
    'glass',
    'sub',
    'bubble',
]);
export type TimelineMaterial = z.infer<typeof timelineMaterialSchema>;

export const timelineEventSchema = z.object({
    t: z.number().min(0, 'Thời điểm t (giây) phải >= 0'),
    material: timelineMaterialSchema,
    intensity: z.number().min(0).max(1),
    pan: z.number().min(-1).max(1).optional(),
});
export type TimelineEvent = z.infer<typeof timelineEventSchema>;

export interface RhythmResult {
    valid: boolean;
    errors: string[];
    min: number;
    max: number;
    ratio: number;
    mean: number;
    stdDev: number;
    cv: number;
    hasNearStill: boolean;
}

/**
 * Kiểm tra các ràng buộc nhịp điệu (rhythm) trên danh sách scenes:
 * 1. Tỉ số shot dài nhất / ngắn nhất >= 4 (max/min >= 4 khi scenes >= 2)
 * 2. Ít nhất 1 đoạn near-still >= 1.5s
 * 3. Cấm uniform cadence: Hệ số biến thiên độ dài cảnh CV = stdDev / mean >= 0.3
 */
export function checkRhythm(
    scenes: Array<
        | {
              duration?: number;
              nearStill?: { from: number; to: number };
              visualDescription?: string;
              moves?: Array<{ nearStill?: boolean; duration?: number }>;
          }
        | number
    >
): RhythmResult {
    if (!Array.isArray(scenes) || scenes.length <= 1) {
        const singleDur =
            scenes && scenes.length === 1
                ? typeof scenes[0] === 'number'
                    ? scenes[0]
                    : (scenes[0]?.duration ?? 0)
                : 0;
        return {
            valid: true,
            errors: [],
            min: singleDur,
            max: singleDur,
            ratio: 1,
            mean: singleDur,
            stdDev: 0,
            cv: 0,
            hasNearStill: false,
        };
    }

    const errors: string[] = [];
    const durations: number[] = [];
    let hasNearStill = false;

    for (const item of scenes) {
        if (typeof item === 'number') {
            durations.push(item);
        } else if (item && typeof item === 'object') {
            if (typeof item.duration === 'number') {
                durations.push(item.duration);
            }
            if (
                item.nearStill &&
                typeof item.nearStill.from === 'number' &&
                typeof item.nearStill.to === 'number'
            ) {
                if (item.nearStill.to - item.nearStill.from >= 1.5) {
                    hasNearStill = true;
                }
            } else if (typeof item.visualDescription === 'string') {
                const text = item.visualDescription.toLowerCase();
                const match = text.match(/near[-_]?still[^\d]*(\d+(?:\.\d+)?)/);
                if (match) {
                    if (parseFloat(match[1]) >= 1.5) {
                        hasNearStill = true;
                    }
                    // Nếu ghi rõ số lượng giây nhưng < 1.5s thì không đạt điều kiện
                } else if (
                    text.includes('nearstill') ||
                    text.includes('near-still') ||
                    text.includes('near still')
                ) {
                    // Không có số giây cụ thể: chỉ chấp nhận khi scene có duration >= 1.5s (hoặc chưa đo duration)
                    const dur = typeof item.duration === 'number' ? item.duration : undefined;
                    if (dur === undefined || dur >= 1.5) {
                        hasNearStill = true;
                    }
                }
            } else if (Array.isArray(item.moves)) {
                for (const m of item.moves) {
                    if (m && (m.nearStill || (typeof m.duration === 'number' && m.duration >= 1.5))) {
                        hasNearStill = true;
                    }
                }
            }
        }
    }

    if (durations.length === 0) {
        return {
            valid: true,
            errors: [],
            min: 0,
            max: 0,
            ratio: 0,
            mean: 0,
            stdDev: 0,
            cv: 0,
            hasNearStill,
        };
    }

    const min = Math.min(...durations);
    const max = Math.max(...durations);
    const ratio = min > 0 ? max / min : (max > 0 ? Infinity : 0);

    const n = durations.length;
    const mean = durations.reduce((sum, d) => sum + d, 0) / n;
    const variance = durations.reduce((sum, d) => sum + Math.pow(d - mean, 2), 0) / n;
    const stdDev = Math.sqrt(variance);
    const cv = mean > 0 ? stdDev / mean : 0;

    // Constraint 1: ratio >= 4
    if (ratio < 4) {
        errors.push(`Tỉ số shot dài nhất / ngắn nhất phải >= 4 (hiện tại: ${ratio.toFixed(2)})`);
    }

    // Constraint 2: nearStill >= 1.5s
    if (!hasNearStill) {
        errors.push('Kịch bản phải có ít nhất 1 đoạn near-still >= 1.5s');
    }

    // Constraint 3: cv >= 0.3
    if (cv < 0.3) {
        errors.push(
            `Hệ số biến thiên độ dài cảnh (CV) phải >= 0.3 để tránh uniform cadence (hiện tại: ${cv.toFixed(2)})`
        );
    }

    return {
        valid: errors.length === 0,
        errors,
        min,
        max,
        ratio,
        mean,
        stdDev,
        cv,
        hasNearStill,
    };
}

export const videoScriptSchema = z
    .object({
        id: z.string(),
        title: z.string(),
        description: z.string(),
        globalStyles: z.string(),
        globalSetupJs: z.string(),
        scenes: z.array(sceneSchema),
        boundaries: z.array(boundarySchema).default([]),
        colorPalette: z.object({
            primary: z.string(),
            secondary: z.string(),
            accent: z.string(),
            background: z.string(),
            text: z.string(),
        }),
        fontFamily: z.string().default('Inter'),
    })
    .superRefine((data, ctx) => {
        const scenes = data.scenes || [];
        const boundaries = data.boundaries || [];

        // 1. Boundary count & continuity checks
        if (scenes.length >= 1) {
            const expectedBoundaryCount = scenes.length - 1;
            if (boundaries.length !== expectedBoundaryCount) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['boundaries'],
                    message: `Số lượng boundaries (${boundaries.length}) phải bằng scenes.length - 1 (${expectedBoundaryCount})`,
                });
            } else {
                for (let i = 0; i < boundaries.length; i++) {
                    const b = boundaries[i];
                    const fromExpected = scenes[i].id;
                    const toExpected = scenes[i + 1].id;
                    if (b.fromScene !== fromExpected || b.toScene !== toExpected) {
                        ctx.addIssue({
                            code: z.ZodIssueCode.custom,
                            path: ['boundaries', i],
                            message: `Boundary ${b.id || i} không liên tục: phải nối từ scene '${fromExpected}' sang '${toExpected}', nhưng nhận được '${b.fromScene}' -> '${b.toScene}'`,
                        });
                    }
                }
            }
        }

        // 2. HardCut reason check
        for (let i = 0; i < boundaries.length; i++) {
            const b = boundaries[i];
            if (b.carry?.mechanism === 'hardCut') {
                if (!b.carry.reason || b.carry.reason.trim().length === 0) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        path: ['boundaries', i, 'carry', 'reason'],
                        message: `Boundary ${b.id || i}: mechanism 'hardCut' bắt buộc phải có reason giải thích`,
                    });
                }
            }
        }

        // 3. Rhythm checks (when scenes >= 2 and durations/nearStill are provided)
        if (scenes.length >= 2) {
            const hasDurations = scenes.some(
                (s) => typeof s.duration === 'number' || s.nearStill !== undefined
            );
            if (hasDurations) {
                const rhythm = checkRhythm(scenes);
                if (!rhythm.valid) {
                    for (const err of rhythm.errors) {
                        ctx.addIssue({
                            code: z.ZodIssueCode.custom,
                            path: ['scenes'],
                            message: err,
                        });
                    }
                }
            }
        }
    });

export type videoScript = z.infer<typeof videoScriptSchema>;

export const durationMapSchema = z.record(z.string(), z.number());
export type durationMap = z.infer<typeof durationMapSchema>;

// ============================================================================
// CẤU HÌNH ĐÓNG DẤU LOGO & THƯƠNG HIỆU (BRAND KIT & WATERMARK OVERLAY)
// ============================================================================

/**
 * Danh sách các vị trí cố định trên video hoặc chế độ tự do:
 * - 'top-left': Góc trên bên trái màn hình
 * - 'top-right': Góc trên bên phải màn hình (vị trí phổ biến nhất của logo)
 * - 'bottom-left': Góc dưới bên trái màn hình
 * - 'bottom-right': Góc dưới bên phải màn hình
 * - 'custom': Tùy chỉnh tự do vị trí theo tọa độ phần trăm (xPercent, yPercent)
 */
export const watermarkPositionSchema = z.enum([
    'top-left',
    'top-right',
    'bottom-left',
    'bottom-right',
    'custom',
]);
export type WatermarkPosition = z.infer<typeof watermarkPositionSchema>;

/**
 * Khuôn mẫu quy định và kiểm tra tính hợp lệ của cấu hình Logo/Watermark:
 * - logoPath: Đường dẫn tới tệp logo trên máy chủ (ví dụ: 'uploads/logos/brand.png')
 * - position: Vị trí hiển thị (mặc định 'top-right')
 * - xPercent: Tọa độ ngang X từ 0% (sát mép trái) đến 100% (sát mép phải), chỉ dùng khi position = 'custom'
 * - yPercent: Tọa độ dọc Y từ 0% (sát mép trên) đến 100% (sát mép dưới), chỉ dùng khi position = 'custom'
 * - scalePercent: Kích thước logo tính theo % chiều rộng video (từ 5% đến 50%, mặc định 15%)
 * - opacity: Độ mờ đục / độ rõ nét của logo (từ 0.1: mờ 10% đến 1.0: rõ đặc 100%, mặc định 0.8)
 */
export const watermarkConfigSchema = z.preprocess((val: any) => {
    if (val && typeof val === 'object') {
        const logo = val.logoPath ?? val.logoUrl ?? val.logo_url;
        const scale = val.scalePercent ?? val.scalePct ?? val.scale_pct;
        const x = val.xPercent ?? val.xPct ?? val.x_pct;
        const y = val.yPercent ?? val.yPct ?? val.y_pct;
        return {
            ...val,
            logoPath: logo,
            scalePercent: scale !== undefined ? Number(scale) : undefined,
            xPercent: x !== undefined && x !== null ? Number(x) : undefined,
            yPercent: y !== undefined && y !== null ? Number(y) : undefined,
            opacity: val.opacity !== undefined ? Number(val.opacity) : undefined,
        };
    }
    return val;
}, z.object({
    logoPath: z.string().min(1, 'Đường dẫn tệp logo không được để trống'),
    position: watermarkPositionSchema.default('top-right'),
    xPercent: z.number().min(0, 'Tọa độ X không được nhỏ hơn 0%').max(100, 'Tọa độ X không được vượt quá 100%').optional(),
    yPercent: z.number().min(0, 'Tọa độ Y không được nhỏ hơn 0%').max(100, 'Tọa độ Y không được vượt quá 100%').optional(),
    scalePercent: z.number().min(5, 'Kích thước logo tối thiểu là 5% chiều ngang video').max(50, 'Kích thước logo tối đa là 50% chiều ngang video').default(15),
    opacity: z.number().min(0.1, 'Độ mờ đục tối thiểu là 0.1 (10%)').max(1.0, 'Độ mờ đục tối đa là 1.0 (100%)').default(0.8),
}));
export type WatermarkConfig = z.infer<typeof watermarkConfigSchema>;

export const videoRequestSchema = z.object({
    prompt: z.string().min(10).max(5000),
    aspectRatio: z.enum(['16:9', '9:16', '1:1', '4:3']).optional().default('16:9'),
    /** Format khung hình chuẩn: vertical (9:16, 720x1280) hoặc horizontal (16:9, 1920x1080) */
    format: z.enum(['vertical', 'horizontal']).optional(),
    targetDurationSec: z.coerce.number().min(10).max(300),
    language: z.string().default('vi'),
    style: z.enum(['modern', 'classic', 'stickman', 'minimal']),  // string hoac enum
    customStyle: z.string().max(5000).optional(),
    voice: z.string().optional(),
    ttsProvider: z.enum(['edge', 'elevenlabs', 'openai', 'google', 'vieneu']).optional(),
    /** Cinematic blueprint id from /api/catalog/blueprints */
    blueprintId: z.string().max(120).optional(),
    /** Selected motion block ids from catalog (max 8) */
    motionBlockIds: z.array(z.string().max(120)).max(8).optional(),
    /** Cấu hình đóng dấu logo / hình mờ (Watermark) */
    watermark: watermarkConfigSchema.optional(),
    /** Deterministic seed for PRNG and reproducible rendering (Spec B) */
    seed: z.number().int().optional(),
    /** Hiển thị khung viền Safe Area (80% frame) phục vụ QA */
    safeArea: z.boolean().optional(),
    /** Cấu hình phụ đề karaoke highlight */
    karaoke: z.union([z.boolean(), z.record(z.string(), z.any())]).optional(),
}).transform((data) => {
    if (data.format === 'vertical' && (!data.aspectRatio || data.aspectRatio === '16:9')) {
        return { ...data, aspectRatio: '9:16' as const };
    }
    return data;
});
export type videoRequest = z.infer<typeof videoRequestSchema>


export const pipelineResultSchema = z.object({
    videoPath: z.string(),
    durationSec: z.number(),
    scences: z.array(sceneSchema),
    resolution: z.string(),
});

export type pipelineResult = z.infer<typeof pipelineResultSchema>;

export interface AudioResult {
    scencesDuration: durationMap,
    audioFiles: Record<string, string>,
    totalDurationSec: number,
    mixAudioPath: string,
    wordTimings?: Record<string, WordTiming[]>,
    sfxPath?: string,
    hasSfx?: boolean,
    loudness?: {
        integratedLufs: number;
        truePeakDbtp: number;
        lra: number;
    },
}

export interface renderOptions {
    htmlPath: string,
    outputPath: string,
    width: number,
    height: number,
    fps: number,
    totalDurationSec: number,
    watermark?: WatermarkConfig,
}

export type pipelinePhase =
    | 'script_generation'
    | 'estimate_duration'
    | 'audio_synthesis'
    | 'code_assembly'
    | 'html_assembly'
    | 'preview'
    | 'oracle_qa'
    | 'render'
    | 'mux';

export interface pipelineProgess {
    phase: pipelinePhase,
    progress: number, // 0 - 100
    message: string,
}

export type progressCallback = (progress: pipelineProgess) => void;