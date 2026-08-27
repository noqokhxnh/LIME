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

export const videoRequestSchema = z.object({
    promt: z.string().min(10).max(5000),
    aspectRatio: z.enum(['16:9', '9:16', '1:1', '4:3']),
    targetDurationSec: z.coerce.number().min(10).max(300),
    language: z.string().default('vi'),
    style: z.enum(['modern', 'classic', 'stickman']),  // string hoac enum  
    customStyle: z.string().max(5000).optional()
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
}

export type pipelinePhase =
    | 'script_generation'
    | 'audio_synthesis'
    | 'code_assembly'
    | 'preview'
    | 'render'
    | 'mux';

export interface pipelineProgess {
    phase: pipelinePhase,
    progress: number, // 0 - 100
    message: string,
}

export type progressCallback = (progress: pipelineProgess) => void;