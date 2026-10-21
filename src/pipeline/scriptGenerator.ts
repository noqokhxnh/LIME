import { Config } from "@/config";
import { getLLMClient, type LLMClient } from "@/llm/client";
import { videoRequest, videoScript, videoScriptSchema } from "@/llm/schema";
import { estimateDuration, wordsPerMinute } from "./estimateDuration";
import { validateScript } from "./scriptValidator.js";
import { formatStylePrompt } from "../constants/style.js";
import {
    formatBlocksToolkitPrompt,
    formatCatalogSummaryForPrompt,
    formatSelectedCatalogPrompt,
    formatStorySpinePrompt,
} from "../templates/prompt.js";
import { allocateBeats } from "../templates/storySpine.js";
import {
    formatStyleMenuForPrompt,
    formatStyleSpecForPrompt,
    isValidStyleSlug,
} from "../templates/styles/index.js";
import { sleep } from "./retry.js";

import type { ScriptVariantSpec } from "./scriptVariants.js";

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
 * Tốc độ đọc THỰC ĐO của từng engine TTS (từ/phút), dùng riêng cho NGÂN SÁCH TỪ
 * gửi cho LLM. Khác wordsPerMinute() trong estimateDuration.ts: con số ở đó là
 * tốc độ ước lượng chung (có tính thêm khoảng nghỉ dấu câu) để đoán độ dài audio,
 * còn đây là tốc độ đọc thuần đo trực tiếp trên audio thật:
 *   - vieneu (engine mặc định): tiếng Việt ~195 wpm ở speed=1.0.
 * Nếu xin LLM ít từ hơn tốc độ đọc thật thì lời thoại không lấp đủ thời lượng và
 * pipeline phải bù một đoạn lặng dài ở cuối video.
 */
const MEASURED_TTS_WPM: Record<string, number> = {
    vieneu: 195,
};

/**
 * Tốc độ đọc dùng để tính ngân sách từ: ưu tiên con số đo được của engine, nếu
 * không có (engine khác / ngôn ngữ khác) thì rơi về wordsPerMinute() chung.
 */
function narrationRate(language?: string, provider?: string): number {
    const lang = (language ?? 'vi').toLowerCase().split(/[-_]/)[0];
    const measured = MEASURED_TTS_WPM[(provider ?? 'vieneu').toLowerCase()];
    if (measured && lang === 'vi') return measured;
    return wordsPerMinute(language);
}

/**
 * Số từ lý thuyết cho `sec` giây ở tốc độ `wpm`, nhân hệ số `ratio`.
 * Làm tròn 6 chữ số trước khi floor/round để tránh sai số dấu phẩy động
 * (ví dụ 30s tiếng Anh: 0.72 * 30 * 150 / 60 = 53.99999999999999).
 */
function narrationWords(sec: number, wpm: number, ratio: number): number {
    return Number(((sec * ratio * wpm) / 60).toFixed(6));
}

/**
 * Số từ narration mục tiêu để TTS đọc gần đúng `targetDurationSec`.
 * Trước đây chỉ có một "trần" nhân 0.8 nên LLM luôn viết thiếu, khiến video
 * ngắn hơn nhiều so với mục tiêu (đặt 90s ra 35s).
 */
export function narrationWordTarget(targetDurationSec: number, language?: string, provider?: string): number {
    const wpm = narrationRate(language, provider);
    return Math.max(10, Math.round(narrationWords(targetDurationSec, wpm, 0.9)));
}

/**
 * Cận dưới khuyến nghị: dưới mức này kịch bản bị coi là thiếu lời thoại, pipeline
 * ghi cảnh báo và phải bù khoảng lặng (làm giảm chất lượng video).
 */
export function narrationWordFloor(targetDurationSec: number, language?: string, provider?: string): number {
    const wpm = narrationRate(language, provider);
    return Math.max(10, Math.floor(narrationWords(targetDurationSec, wpm, 0.72)));
}

/**
 * Trần an toàn (≈ tốc độ đọc thuần) để không đẩy tổng thời lượng vượt xa mục tiêu,
 * vẫn nằm dưới ngưỡng chặn "estimated <= 150% of target".
 */
export function narrationWordBudget(targetDurationSec: number, language?: string, provider?: string): number {
    const wpm = narrationRate(language, provider);
    return Math.max(10, Math.floor(narrationWords(targetDurationSec, wpm, 1.0)));
}

export function buildUserPrompt(request: videoRequest, preset: string): string {
    const styleDetails = formatStylePrompt(request.style, request.customStyle);
    // Opuscar style layer (issue #105): nếu có styleSlug (user ghim hoặc AI đã pick),
    // inject nguyên văn STYLE.md tương ứng làm lớp veneer thống trị!
    const opuscarLayer = request.styleSlug ? formatStyleSpecForPrompt(request.styleSlug) : '';
    const storySpine = formatStorySpinePrompt(request.targetDurationSec);
    const toolkit = formatBlocksToolkitPrompt(request.style);
    const selected = formatSelectedCatalogPrompt({
        blueprintId: request.blueprintId,
        motionBlockIds: request.motionBlockIds,
        style: request.style,
    });
    const catalogSummary = formatCatalogSummaryForPrompt(request.style);
    const wordBudget = narrationWordBudget(request.targetDurationSec, request.language, request.ttsProvider);
    const wordTarget = narrationWordTarget(request.targetDurationSec, request.language, request.ttsProvider);
    const wordFloor = narrationWordFloor(request.targetDurationSec, request.language, request.ttsProvider);
    const sceneCount = Math.max(1, allocateBeats(request.targetDurationSec).length);
    const perSceneWords = Math.max(8, Math.round(wordTarget / sceneCount));

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
${opuscarLayer ? `\n${opuscarLayer}\n` : ''}
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
5. Narration Word Budget (BOTH a floor and a ceiling):
   - The TOTAL narration across ALL scenes (sum of every scene's voiceOverText) MUST be between ${wordFloor} and ${wordBudget} words.
   - Aim for about ${wordTarget} words total (≈ ${perSceneWords} words per scene across ~${sceneCount} scenes) so the spoken audio actually fills the ${request.targetDurationSec}s target.
   - Falling below ${wordFloor} words is under-delivery: the video then gets padded with silence, which looks and sounds worse. Expand the explanation instead of shortening it.
   - Prefer fewer, punchier sentences, but never drop below the floor.

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

/**
 * System prompt cho lượt gọi LLM rẻ tiền (output ~ vài token) nhằm để AI TỰ CHỌN
 * slug style preset opuscar phù hợp với brief — triết lý giống narrationMode/voice
 * casting: AI tự quyết dựa trên menu metadata, user vẫn có thể ghim sẵn ở schema.
 */
const STYLE_PICK_SYSTEM_PROMPT = [
    'You are the visual style director of a video generation pipeline.',
    'Read the video brief and pick the ONE preset from the menu whose look, mood and use-case fit the topic best.',
    'Reply with ONLY the slug (lowercase, no quotes, no explanation).',
].join(' ');

/**
 * Timeout cho từng lượt gọi LLM (ms). Provider 9router có lúc upstream treo hoặc
 * sinh cực chậm (6KB output đã mất ~31 giây) — nếu không có AbortSignal thì 1 lượt
 * kẹt giữ UI treo vĩnh viễn ở "Đang viết 3 phương án…". Giorns dư sức cho output
 * lớn (kịch bản 8-10 scene ~ 100KB output) nhưng vẫn cắt được kết nối chết.
 */
export const STYLE_PICK_TIMEOUT_MS = 45_000;
export const SCRIPT_GENERATE_TIMEOUT_MS = 420_000;

export class LLMTimedOutError extends Error {
    constructor(ms: number) {
        super(`LLM call timed out after ${ms}ms`);
        this.name = 'LLMTimedOutError';
    }
}

/**
 * Bọc lượt gọi LLM với AbortSignal.timeout(ms): fetch thật sẽ tự hủy kết nối
 * (không giữ socket treo), lỗi TimeoutError/AbortError được quy về LLMTimedOutError
 * để caller phân biệt với lỗi mạng thường.
 */
async function llmGenerateWithTimeout(
    llm: LLMClient,
    systemPrompt: string,
    userPrompt: string,
    ms: number
): Promise<string> {
    try {
        return await llm.generate(systemPrompt, userPrompt, AbortSignal.timeout(ms));
    } catch (err: any) {
        if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
            throw new LLMTimedOutError(ms);
        }
        throw err;
    }
}

/**
 * Gọi LLM chọn 1 slug style preset cho brief. Trả về null khi LLM không trả lời được
 * slug hợp lệ — caller phải tiếp tục pipeline WITHOUT style layer, tuyệt đối không throw.
 */
export async function pickStyleSlug(
    brief: string,
    llm: LLMClient,
    onProgress?: (msg: string) => void,
    timeoutMs: number = STYLE_PICK_TIMEOUT_MS
): Promise<string | null> {
    try {
        const prompt = [
            `Video brief:`,
            `"""`,
            brief,
            `"""`,
            ``,
            `Style preset menu (slug — name (category) — uses):`,
            formatStyleMenuForPrompt(),
            ``,
            `Reply with ONLY the single best-fitting slug.`,
        ].join('\n');

        const raw = (await llmGenerateWithTimeout(llm, STYLE_PICK_SYSTEM_PROMPT, prompt, timeoutMs)) || '';
        const text = raw.toLowerCase();
        // Lấy mọi token dạng từ/slug khả dĩ rồi đối chiếu với index.json — chịu được
        // các biến thể trả lời kiểu: `"dark-keynote"`, `slug: dark-keynote.`, câu đầy đủ.
        const tokens = text.match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) || [];
        for (const token of tokens) {
            if (isValidStyleSlug(token)) {
                onProgress?.(`[Script] AI chọn style preset: ${token}`);
                return token;
            }
        }
        onProgress?.('[Script] LLM không trả về slug hợp lệ — bỏ qua opuscar style layer.');
        return null;
    } catch (err: any) {
        console.warn(`[Script] Pick styleSlug thất bại (${err.message}) — bỏ qua opuscar style layer.`);
        return null;
    }
}

export async function generateScript(
    request: videoRequest,
    onProgress?: (msg: string) => void,
    qaFeedback?: string,
    variant?: ScriptVariantSpec,
    directives?: string,
    opts?: { scriptTimeoutMs?: number; pickTimeoutMs?: number }
): Promise<videoScript> {
    const llm = getLLMClient();
    const systemPrompt = readFileSync(SYSTEM_prompt_PATH, 'utf-8');

    // === Resolve opuscar styleSlug (issue #105) ==================================
    // Ưu tiên 1: user ghim sẵn request.styleSlug (HITL draft review có thể đổi).
    // Ưu tiên 2: một lượt gọi LLM RẺ TIỀN tự chọn slug theo brief từ menu metadata.
    // Slug lỗi/không pick được ⇒ null, pipeline vẫn chạy bình thường mà không có
    // lớp style, tuyệt đối không throw làm hỏng job.
    // LƯU Ý: KHÔNG mutate request đầu vào — luôn build effectiveRequest mới để
    // tránh dính side-effect giữa các lần gọi (QA reroll / variant / test).
    let resolvedStyleSlug: string | null = null;
    if (request.styleSlug && isValidStyleSlug(request.styleSlug)) {
        resolvedStyleSlug = request.styleSlug;
        onProgress?.(`[Script] Dùng style preset ghim sẵn: ${resolvedStyleSlug}`);
    } else {
        onProgress?.('[Script] Đang nhờ AI chọn style preset (opuscar)...');
        resolvedStyleSlug = await pickStyleSlug(request.prompt, llm, onProgress, opts?.pickTimeoutMs);
    }
    // ==============================================================================

    // Mỗi phương án có style + blueprint riêng. Ép ở đây thay vì để LLM tự chọn
    // để ba phương án không hội tụ về cùng một phong cách.
    const effectiveRequest: videoRequest = {
        ...request,
        ...(variant ? { style: variant.style, blueprintId: variant.blueprintId } : {}),
        ...(resolvedStyleSlug ? { styleSlug: resolvedStyleSlug } : {}),
    };

    const preset = VIDEO_PRESETS[effectiveRequest.aspectRatio];
    let basePrompt = buildUserPrompt(effectiveRequest, preset);
    if (directives) {
        basePrompt += `\n\n${directives}\n`;
    }
    if (variant) {
        basePrompt += `\n\n${variant.brief}\n`;
    }
    if (qaFeedback) {
        basePrompt += `\n\n--- LƯU Ý ĐẶC BIỆT TỪ ORACLE QA (Lần thử trước bị từ chối, hãy sửa triệt để các lỗi sau) ---\n${qaFeedback}\n`;
    }
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= 3; attempt++) { // 3 = max retry
        onProgress?.(`[Script] Attempt ${attempt}/3 - generating with ${llm.provider}`);

        try {
            const promptToSend = attempt === 1
                ? basePrompt
                : `${basePrompt}\n\nLần trước bị lỗi, hãy sửa lỗi sau:\n${lastError?.message}`;

            const responseText = await llmGenerateWithTimeout(
                llm,
                systemPrompt,
                promptToSend,
                opts?.scriptTimeoutMs ?? SCRIPT_GENERATE_TIMEOUT_MS
            );

            const jsonText = stripMarkdownJson(responseText);

            const parsedData = JSON.parse(jsonText);
            if (parsedData && typeof parsedData === "object") {
                if (!parsedData.id && typeof parsedData.title === "string") {
                    parsedData.id = `script-${Date.now()}`;
                }
                if (!parsedData.scenes && Array.isArray(parsedData.scene)) {
                    parsedData.scenes = parsedData.scene;
                }
                if (!parsedData.boundaries && Array.isArray(parsedData.boundary)) {
                    parsedData.boundaries = parsedData.boundary;
                }
                if (Array.isArray(parsedData.scenes)) {
                    for (const s of parsedData.scenes) {
                        if (s && typeof s === "object" && !s.voiceOverText && s.voiceoverText) {
                            s.voiceOverText = s.voiceoverText;
                        }
                    }
                    if (!parsedData.boundaries && parsedData.scenes.length <= 1) {
                        parsedData.boundaries = [];
                    }
                }
            }
            const validation = validateScript(parsedData);
            if (!validation.valid || !validation.data) {
                throw new Error(validation.formattedErrorMessage || validation.errors.join('\n'));
            }
            const script = validation.data;

            // Đóng dấu trace: kịch bản được sinh bằng style preset nào (AI pick hoặc user ghim).
            if (resolvedStyleSlug && !script.styleSlug) {
                script.styleSlug = resolvedStyleSlug;
            }

            // Guard ngay trong vòng retry: kịch bản vượt quá 150% target thì coi như
            // attempt thất bại để LLM tự rút gọn narration ở lần thử sau,
            // thay vì để orchestrator ném lỗi và crash cả job.
            const estimated = estimateDuration(script, { language: request.language });
            if (estimated.totalDurationSec > request.targetDurationSec * 1.5) {
                throw new Error(
                    `Estimated duration (${estimated.totalDurationSec}s) exceeds target (${request.targetDurationSec}s) by more than 50%. Narration word count was too high — condense voiceOverText to fit the target duration.`
                );
            }
            // Guard cận dưới: trước đây chỉ chặn vượt trần nên kịch bản thiếu lời thoại
            // vẫn "đạt" và video ra ngắn hơn mục tiêu. Không ném lỗi ở đây (sẽ loại bỏ
            // cả kịch bản ngắn nhưng hợp lệ và phá luồng QA reroll); thay vào đó cảnh báo
            // rõ ràng — bước bù khoảng lặng ở synthesizeAudio lo phần đảm bảo độ dài.
            if (estimated.totalDurationSec < request.targetDurationSec * 0.7) {
                const floorWords = narrationWordFloor(request.targetDurationSec, request.language, request.ttsProvider);
                const targetWords = narrationWordTarget(request.targetDurationSec, request.language, request.ttsProvider);
                const warning =
                    `Kịch bản ước lượng ${estimated.totalDurationSec.toFixed(1)}s, thấp hơn nhiều so với mục tiêu ` +
                    `${request.targetDurationSec}s (cần ~${targetWords} từ, tối thiểu ~${floorWords} từ).`;
                console.warn(`[Script] Cảnh báo cận dưới: ${warning}`);
                onProgress?.(`[Script] Cảnh báo cận dưới: ${warning} Pipeline sẽ bù khoảng lặng nếu còn trong ngưỡng an toàn.`);
            }

            onProgress?.(`[Script] Attempt ${attempt}/3 - success`);
            return script;
        } catch (error: any) {
            lastError = error;
            console.error(`[Script] Attempt ${attempt} failed:`, error.message);
            onProgress?.(`[Script] Attempt ${attempt} failed: ${error.message}`);
            // Timeout nhà cung cấp gần như không tự hết trong một lượt retry ngắn
            // (upstream vẫn đang chậm/treo) — retry 3 lần chỉ kéo màn hình spin thêm
            // ~20 phút. Ném ngay để caller quyết định (route draft báo lỗi,
            // orchestrator đánh job failed) thay vì đốt thời gian.
            if (error?.name === 'LLMTimedOutError') {
                throw error;
            }
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