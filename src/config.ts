import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
    PORT: z.coerce.number().default(3000),
    NODE_ENV: z.enum(['production', 'development']).default('development'),


    LLM_Provider: z.enum(['openai', 'deepseek', 'gemini', 'claude']).default('gemini'),

    OpenAI_APIKEY: z.string().optional(),
    OpenAI_Model: z.string().default('gpt-5.3-codex'),

    DeepSeek_APIKEY: z.string().optional(),
    DeepSeek_Model: z.string().default('deepseek-4-flash'),

    Gemini_APIKEY: z.string().optional(),
    Gemini_Model: z.string().default('gemini-3.5-flash'),

    Claude_APIKEY: z.string().optional(),
    Claude_Model: z.string().default("claude sonnet 4.5"),

    TTS_Provider: z.enum(['edge', 'elevenlabs', 'openai', 'google']).default('edge'),
    TTS_Voice: z.string().default('alloy'),

    Elevenlabs_API_KEY: z.string().optional(),
    Elevenlabs_Voice_ID: z.string().optional(),
    OpenAI_TTS_Model: z.string().optional(),
    Google_TTS_Model: z.string().optional(),

    Default_FPS: z.coerce.number().default(30),
    Default_Width: z.coerce.number().default(1920),
    Default_Height: z.coerce.number().default(1080),

});

export type Config = z.infer<typeof envSchema>;

let _config: Config | null = null;
export function getConfig(): Config {
    if (!_config) {
        const result = envSchema.safeParse(process.env);
        if (!result.success) {
            throw new Error(`Configuration error: ${result.error.message}`);
        }
        _config = result.data;
    }
    return _config;
}
