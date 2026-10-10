import { videoScript, scene, durationMap } from "@/llm/schema";

export interface EstimateDurationOptions {
    language?: string;
    wpm?: number;
    minSceneDurationSec?: number;
    scenePaddingSec?: number;
}

export interface SceneDurationInfo {
    sceneId: string;
    title: string;
    wordCount: number;
    durationSec: number;
}

export interface EstimatedDurationResult {
    sceneDurations: durationMap;
    totalDurationSec: number;
    breakdown: SceneDurationInfo[];
}


export const DEFAULT_WPM_BY_LANGUAGE: Record<string, number> = {
    vi: 165, // Vietnamese: ~160-175 syllables/words per minute
    en: 150, // English: ~140-160 words per minute
};

/**
 * Speaking rate for a BCP-47-ish language tag ('vi-VN' -> 'vi').
 * Single source of truth shared by the estimator and the script prompt builder.
 */
export function wordsPerMinute(language?: string): number {
    const lang = (language ?? 'vi').toLowerCase().split(/[-_]/)[0];
    return DEFAULT_WPM_BY_LANGUAGE[lang] ?? 150;
}

const DEFAULT_MIN_SCENE_DURATION_SEC = 2.5;
const DEFAULT_SCENE_PADDING_SEC = 0.6;


export function countEffectiveWords(text: string, language: string): number {
    const trimmed = text.trim();
    if (!trimmed) return 0;


    if (['ja', 'zh', 'ko'].includes(language.toLowerCase())) {
        return trimmed.replace(/\s+/g, '').length;
    }

    const tokens = trimmed.split(/\s+/);
    let wordCount = 0;

    for (const token of tokens) {

        const cleaned = token.replace(/^[^\w\d\p{L}]+|[^\w\d\p{L}]+$/gu, '');
        if (!cleaned) continue;


        if (/\d+/.test(cleaned)) {
            const digitLen = cleaned.replace(/\D/g, '').length;

            wordCount += Math.max(1, Math.ceil(digitLen * 1.2));
        } else {
            wordCount += 1;
        }
    }

    return wordCount;
}

export function calculatePunctuationPauseSec(text: string): number {
    let pauseSec = 0;


    const majorPunctuationMatches = text.match(/[\.\!\?\:\;]+/g);
    if (majorPunctuationMatches) {
        pauseSec += majorPunctuationMatches.length * 0.35;
    }


    const minorPunctuationMatches = text.match(/[\,\—\–\…]+|\.{3,}/g);
    if (minorPunctuationMatches) {
        pauseSec += minorPunctuationMatches.length * 0.2;
    }

    return pauseSec;
}


export function estimateTextDuration(text: string, options: EstimateDurationOptions = {}): number {
    const language = options.language ?? 'vi';
    const wpm = options.wpm ?? wordsPerMinute(language);
    const minDuration = options.minSceneDurationSec ?? DEFAULT_MIN_SCENE_DURATION_SEC;
    const padding = options.scenePaddingSec ?? DEFAULT_SCENE_PADDING_SEC;

    const trimmed = text.trim();
    if (!trimmed) {
        return minDuration;
    }

    const wordCount = countEffectiveWords(trimmed, language);
    const speechSec = (wordCount / wpm) * 60;
    const pauseSec = calculatePunctuationPauseSec(trimmed);

    const rawDuration = speechSec + pauseSec + padding;
    const finalDuration = Math.max(minDuration, Math.round(rawDuration * 10) / 10);

    return finalDuration;
}

export function estimateSceneDuration(scene: scene, options: EstimateDurationOptions = {}): number {
    return estimateTextDuration(scene.voiceOverText, options);
}


export function estimateSceneDurations(scenes: scene[], options: EstimateDurationOptions = {}): durationMap {
    const result: durationMap = {};
    for (const scene of scenes) {
        result[scene.id] = estimateSceneDuration(scene, options);
    }
    return result;
}


export function estimateDuration(
    script: videoScript,
    options: EstimateDurationOptions = {}
): EstimatedDurationResult {
    const sceneDurations: durationMap = {};
    const breakdown: SceneDurationInfo[] = [];
    let totalDurationSec = 0;

    const language = options.language ?? 'vi';

    for (const scene of script.scenes) {
        const wordCount = countEffectiveWords(scene.voiceOverText, language);
        const durationSec = estimateSceneDuration(scene, options);

        sceneDurations[scene.id] = durationSec;
        totalDurationSec += durationSec;

        breakdown.push({
            sceneId: scene.id,
            title: scene.title,
            wordCount,
            durationSec,
        });
    }


    totalDurationSec = Math.round(totalDurationSec * 10) / 10;

    return {
        sceneDurations,
        totalDurationSec,
        breakdown,
    };
}


export const estimateScriptDuration = estimateDuration;
