import { Config } from "@/config";
import { getLLMClient } from "@/llm/client";
import { videoRequest, videoScript, videoScriptSchema } from "@/llm/schema";
import { sleep } from "./retry.js";

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYSTEM_prompt_PATH = join(__dirname, '..', 'llm', 'system.txt');

const VIDEO_PRESETS: Record<string, string> = {
    '16:9': '1920x1080',
    '9:16': '1080x1920',
    '1:1': '1080x1080',
    '4:3': '1440x1080'
};

export function buildUserPrompt(request: videoRequest, preset: string): string {
    return `Create a high-quality video script with the following requirements:
Topic/Prompt: ${request.prompt}
Aspect Ratio: ${request.aspectRatio} (${preset})
Target Duration: ${request.targetDurationSec} seconds
Language: ${request.language}
Style: ${request.style}
${request.customStyle ? `Custom Style Instructions: ${request.customStyle}` : ''}

Remember to output ONLY valid JSON matching the schema, with GSAP animation code included.`;
}

export function stripMarkdownJson(responseText: string): string {
    let jsonText = responseText.trim();
    if (jsonText.startsWith('```json')) {
        jsonText = jsonText.replace(/^```json\n?/, '').replace(/\n?```$/, '');
    } else if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/^```\n?/, '').replace(/\n?```$/, '');
    }
    return jsonText.trim();
}

export async function generateScript(
    request: videoRequest,
    onProgress?: (msg: string) => void
): Promise<videoScript> {
    const llm = getLLMClient();
    const systemPrompt = readFileSync(SYSTEM_prompt_PATH, 'utf-8');

    const preset = VIDEO_PRESETS[request.aspectRatio];
    const userPrompt = buildUserPrompt(request, preset);
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= 3; attempt++) { // 3 = max retry
        onProgress?.(`[Script] Attempt ${attempt}/3 - generating with ${llm.provider}`);

        try {
            const promptToSend = attempt === 1
                ? userPrompt
                : `${userPrompt}\n\nLần trước bị lỗi, hãy sửa lỗi sau:\n${lastError?.message}`;

            const responseText = await llm.generate(systemPrompt, promptToSend);

            const jsonText = stripMarkdownJson(responseText);

            const parsedData = JSON.parse(jsonText);
            if (parsedData && typeof parsedData === "object") {
                if (!parsedData.id && typeof parsedData.title === "string") {
                    parsedData.id = `script-${Date.now()}`;
                }
                if (!parsedData.scenes && Array.isArray(parsedData.scene)) {
                    parsedData.scenes = parsedData.scene;
                }
                if (Array.isArray(parsedData.scenes)) {
                    for (const s of parsedData.scenes) {
                        if (s && typeof s === "object" && !s.voiceOverText && s.voiceoverText) {
                            s.voiceOverText = s.voiceoverText;
                        }
                    }
                }
            }
            const script = videoScriptSchema.parse(parsedData);

            onProgress?.(`[Script] Attempt ${attempt}/3 - success`);
            return script;
        } catch (error: any) {
            lastError = error;
            console.error(`[Script] Attempt ${attempt} failed:`, error.message);
            onProgress?.(`[Script] Attempt ${attempt} failed: ${error.message}`);
            if (attempt < 3) {
                const isTest = process.env.NODE_ENV === "test";
                const delay = (isTest ? 10 : 500) * Math.pow(2, attempt - 1);
                onProgress?.(`[Script] Retrying attempt ${attempt + 1}/3 in ${delay}ms...`);
                await sleep(delay);
            }
        }
    }

    throw new Error(`Failed to generate script after 3 attempts. Last error: ${lastError?.message}`);
}