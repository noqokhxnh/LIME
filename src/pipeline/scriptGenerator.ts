import { Config } from "@/config";
import { getLLMClient } from "@/llm/client";
import { videoRequest, videoScript, videoScriptSchema } from "@/llm/schema";
import { estimateDuration, wordsPerMinute } from "./estimateDuration";
import { formatStylePrompt } from "../constants/style.js";
import {
    formatBlocksToolkitPrompt,
    formatCatalogSummaryForPrompt,
    formatSelectedCatalogPrompt,
    formatStorySpinePrompt,
} from "../templates/prompt.js";
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

/**
 * Maximum total narration words (summed over every scene's voiceOverText)
 * that fit inside `targetDurationSec` at the estimator's speaking rate.
 * Keeps ~20% headroom for punctuation pauses, per-scene padding and TTS variance
 * so the script passes the orchestrator's "estimated <= 150% of target" guard.
 * Uses the shared wordsPerMinute() from estimateDuration.ts — single source of truth.
 */
export function narrationWordBudget(targetDurationSec: number, language?: string): number {
    const wpm = wordsPerMinute(language);
    return Math.max(10, Math.floor((targetDurationSec * 0.8 * wpm) / 60));
}

export function buildUserPrompt(request: videoRequest, preset: string): string {
    const styleDetails = formatStylePrompt(request.style, request.customStyle);
    const storySpine = formatStorySpinePrompt(request.targetDurationSec);
    const toolkit = formatBlocksToolkitPrompt(request.style);
    const selected = formatSelectedCatalogPrompt({
        blueprintId: request.blueprintId,
        motionBlockIds: request.motionBlockIds,
        style: request.style,
    });
    const catalogSummary = formatCatalogSummaryForPrompt(request.style);
    const wordBudget = narrationWordBudget(request.targetDurationSec, request.language);

    return `Create a high-quality video script with the following requirements:
Topic/Prompt: ${request.prompt}
Aspect Ratio: ${request.aspectRatio} (${preset})
Target Duration: ${request.targetDurationSec} seconds
Language: ${request.language}
Style: ${request.style}
${request.customStyle ? `Custom Style Instructions: ${request.customStyle}` : ''}
${request.blueprintId ? `Blueprint: ${request.blueprintId}` : ''}
${request.motionBlockIds?.length ? `Motion Blocks: ${request.motionBlockIds.join(', ')}` : ''}

--- STYLE & ART DIRECTION SPECIFICATIONS ---
${styleDetails}

${storySpine}

${toolkit}

${selected ? `${selected}\n` : ''}--- CATALOG ---
${catalogSummary}

--- CRITICAL PRODUCTION RULES ---
1. "Screen for orientation, Voice for speech":
   - NEVER repeat narration speech as on-screen body text.
   - Screen must ONLY display: Punchy Title (≤ 5 words) + 1-3 Focus Anchors (Metric, Diagram, Icon card, Key concept).
   - Full explanation belongs strictly in voiceOverText.
2. Visual Anchors Continuity:
   - Preserve at least 1 persistent visual anchor (color token, icon badge, or layout axis) across scene transitions.
3. Negative Space & Anti-Card Slop:
   - Ensure 35%-45% negative space. Do NOT default to wrapping everything in rounded glass cards.
4. Motion Blocks:
   - For complex UI (IDE, charts, device mockups, chat), prefer window.__block(...) instead of hand-rolled DOM.
   - Always leave a .block-mount node in htmlCode when using __block.
5. Narration Word Budget (HARD LIMIT — the pipeline rejects oversized scripts):
   - The TOTAL narration across ALL scenes (sum of every scene's voiceOverText) must be ≤ ${wordBudget} words.
   - At the target speaking rate this fits the ${request.targetDurationSec}s target with headroom for pauses and per-scene padding.
   - Prefer fewer, punchier sentences over long explanations. If the topic needs more words, shorten — never exceed the budget.

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

            // Guard ngay trong vòng retry: kịch bản vượt quá 150% target thì coi như
            // attempt thất bại để LLM tự rút gọn narration ở lần thử sau,
            // thay vì để orchestrator ném lỗi và crash cả job.
            const estimated = estimateDuration(script, { language: request.language });
            if (estimated.totalDurationSec > request.targetDurationSec * 1.5) {
                throw new Error(
                    `Estimated duration (${estimated.totalDurationSec}s) exceeds target (${request.targetDurationSec}s) by more than 50%. Narration word count was too high — condense voiceOverText to fit the target duration.`
                );
            }

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