import { z } from 'zod';

export const sceneSchema = z.object({
    id: z.string(),
    title: z.string(),
    voiceOverText: z.string(),
    visualDescription: z.string(),
    htmlCode: z.string(),
    cssCode: z.string(),
    jsCode: z.string(),
    transition: z.enum(['fade', 'slide-left', 'slide-right', 'slide-up', 'zoom-in', 'zoom-out', 'none']),
    backgroundColor: z.string().default('#000000')
})

export type scene = z.infer<typeof sceneSchema>;


export const videoScriptSchema = z.object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    globalStyles: z.string(),
    globalSetupJs: z.string(),
    scenes: z.array(sceneSchema),
    colorPalette: z.object({
        primary: z.string(),
        secondary: z.string(),
        accent: z.string(),
        background: z.string(),
        text: z.string()
    }),
    fontFamily: z.string().default('Inter')
})

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
    aspectRatio: z.enum(['16:9', '9:16', '1:1', '4:3']),
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
})
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
    | 'render'
    | 'mux';

export interface pipelineProgess {
    phase: pipelinePhase,
    progress: number, // 0 - 100
    message: string,
}

export type progressCallback = (progress: pipelineProgess) => void;