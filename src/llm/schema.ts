import { z } from 'zod';

export const SceneSchema = z.object({
    id: z.string(),
    title: z.string(),
    voiceOverText: z.string(),
    visualDescription: z.string(),
    htmlCode: z.string(),
    cssCode: z.string(),
    jsCode: z.string(),
    transition: z.enum['fade', 'slide-left', 'slide-right', 'slide-up', 'zoom-in', 'zoom-out', 'none']
    backgroundColor: z.string.default('#000000')
})

export type Scene = z.infer<typeof SceneSchema>;


export const videoScriptSchema = z.object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    globalStyles: z.string(),
    globalSetupJs: z.string(),
    scenes: z.array(SceneSchema),
    colorPalette: z.object({
        primary: z.string(),
        secondary: z.string(),
        accent: z.string(),
        background: z.string(),
        text: z.string()
    }),
    fontFamily: z.string().default('Inter')
})

export type VideoScript = z.infer<typeof videoScriptSchema>;

export const DurationMapSchema = z.record(z.string(), z.number());
export type DurationMap = z.infer<typeof DurationMapSchema>;