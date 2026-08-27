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
