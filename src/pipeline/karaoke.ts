/**
 * Module hiển thị phụ đề Karaoke Highlight (Spec G)
 * - Tự động đồng bộ với window.__seekTo(t) theo hàm thuần (pure function of t)
 * - Hỗ trợ highlight từ hiện tại, làm mờ từ sắp tới, giữ nguyên từ đã đọc
 * - Kiểu dáng highlight tùy biến: glow, scale, pill, color
 * - Đặt trong safe-area (padding 10% chiều dọc & ngang)
 */

import { videoScript, durationMap } from "../llm/schema.js";
import { WordTiming, computeFallbackWordTimings } from "./wordTiming.js";

export type KaraokeHighlightStyle = "glow" | "scale" | "pill" | "color";

export interface SafeAreaBounds {
    x: number;
    y: number;
    width: number;
    height: number;
    paddingX: number;
    paddingY: number;
}

/**
 * Tính toán vùng an toàn (Safe Area) chiếm 80% trung tâm khung hình:
 * 10% lề trên, 10% lề dưới, 10% lề trái, 10% lề phải.
 */
export function getSafeAreaBounds(frameWidth: number, frameHeight: number): SafeAreaBounds {
    const paddingX = Math.round(frameWidth * 0.1);
    const paddingY = Math.round(frameHeight * 0.1);
    return {
        x: paddingX,
        y: paddingY,
        width: frameWidth - paddingX * 2,
        height: frameHeight - paddingY * 2,
        paddingX,
        paddingY,
    };
}

/**
 * Kiểm tra một bounding box có nằm trọn vẹn trong vùng an toàn (Safe Area) hay không.
 */
export function isBoxWithinSafeArea(
    box: { left: number; top: number; width: number; height: number },
    frameWidth: number,
    frameHeight: number
): boolean {
    const safe = getSafeAreaBounds(frameWidth, frameHeight);
    const boxRight = box.left + box.width;
    const boxBottom = box.top + box.height;
    const safeRight = safe.x + safe.width;
    const safeBottom = safe.y + safe.height;

    return (
        box.left >= safe.x &&
        boxRight <= safeRight &&
        box.top >= safe.y &&
        boxBottom <= safeBottom
    );
}

/**
 * Lấy bounding box danh nghĩa của layer Karaoke theo cấu hình khung hình
 */
export function getKaraokeLayerBounds(
    frameWidth: number,
    frameHeight: number,
    bottomOffsetPercent = 12,
    layerHeight = 80
): { left: number; top: number; width: number; height: number } {
    const left = Math.round(frameWidth * 0.1);
    const width = Math.round(frameWidth * 0.8);
    const bottom = Math.round((bottomOffsetPercent / 100) * frameHeight);
    const top = frameHeight - bottom - layerHeight;

    return {
        left,
        top,
        width,
        height: layerHeight,
    };
}

export interface KaraokeConfig {
    enabled?: boolean;
    activeColor?: string;
    inactiveColor?: string;
    dimmedOpacity?: number;
    highlightStyle?: KaraokeHighlightStyle;
    pillBgColor?: string;
    glowEffect?: string;
    scaleFactor?: number;
    fontSize?: string | number;
    bottomOffsetPercent?: number;
}

export interface KaraokeWordData {
    word: string;
    absStartSec: number;
    absEndSec: number;
}

export interface KaraokeCueData {
    sceneId: string;
    startSec: number;
    endSec: number;
    words: KaraokeWordData[];
}

export const DEFAULT_KARAOKE_CONFIG: Required<KaraokeConfig> = {
    enabled: true,
    activeColor: "#ffd700",
    inactiveColor: "#ffffff",
    dimmedOpacity: 0.45,
    highlightStyle: "glow",
    pillBgColor: "rgba(255, 215, 0, 0.25)",
    glowEffect: "0 0 16px rgba(255, 215, 0, 0.85)",
    scaleFactor: 1.15,
    fontSize: "32px",
    bottomOffsetPercent: 12,
};

/**
 * Xây dựng timeline dữ liệu karaoke cho toàn bộ kịch bản
 */
export function buildKaraokeTimeline(
    script: videoScript,
    durations: durationMap,
    wordTimings?: Record<string, WordTiming[]>
): KaraokeCueData[] {
    const cues: KaraokeCueData[] = [];
    let currentTimeSec = 0;

    for (const scene of script.scenes) {
        const sceneDur = durations[scene.id] ?? scene.duration ?? 3.0;
        const sceneStart = currentTimeSec;
        const sceneEnd = sceneStart + sceneDur;

        let words = wordTimings?.[scene.id];
        if (!words || words.length === 0) {
            words = computeFallbackWordTimings(scene.voiceOverText || "", sceneDur);
        }

        const cueWords: KaraokeWordData[] = words.map((w) => ({
            word: w.word,
            absStartSec: Math.round((sceneStart + w.startMs / 1000) * 1000) / 1000,
            absEndSec: Math.round((sceneStart + w.endMs / 1000) * 1000) / 1000,
        }));

        cues.push({
            sceneId: scene.id,
            startSec: Math.round(sceneStart * 1000) / 1000,
            endSec: Math.round(sceneEnd * 1000) / 1000,
            words: cueWords,
        });

        currentTimeSec = sceneEnd;
    }

    return cues;
}

/**
 * Tạo khối HTML chứa các scene cue và từng từ gắn timestamp
 */
export function renderKaraokeHtml(cues: KaraokeCueData[], options?: KaraokeConfig): string {
    const config = { ...DEFAULT_KARAOKE_CONFIG, ...options };
    if (!config.enabled) return "";

    const cuesHtml = cues
        .map((cue) => {
            if (cue.words.length === 0) return "";
            const wordsHtml = cue.words
                .map(
                    (w) =>
                        `<span class="karaoke-word is-upcoming" data-abs-start="${w.absStartSec}" data-abs-end="${w.absEndSec}">${escapeHtml(w.word)}</span>`
                )
                .join(" ");

            return `    <div class="karaoke-cue" id="karaoke-cue-${cue.sceneId}" data-scene="${cue.sceneId}" data-start="${cue.startSec}" data-end="${cue.endSec}">\n      ${wordsHtml}\n    </div>`;
        })
        .filter(Boolean)
        .join("\n");

    return `<div id="lime-karaoke" class="lime-karaoke-layer">\n${cuesHtml}\n</div>`;
}

/**
 * CSS thuần cho karaoke layer, bảo đảm không dùng CSS animation/transition
 * để hoạt động chính xác tuyệt đối với seek-based rendering.
 */
export function renderKaraokeCss(options?: KaraokeConfig): string {
    const config = { ...DEFAULT_KARAOKE_CONFIG, ...options };
    if (!config.enabled) return "";

    const fontSize = typeof config.fontSize === "number" ? `${config.fontSize}px` : config.fontSize;

    let activeStyleRules = `color: ${config.activeColor};`;
    if (config.highlightStyle === "scale" || config.highlightStyle === "glow") {
        activeStyleRules += ` transform: scale(${config.scaleFactor});`;
    }
    if (config.highlightStyle === "glow") {
        activeStyleRules += ` text-shadow: ${config.glowEffect};`;
    }
    if (config.highlightStyle === "pill") {
        activeStyleRules += ` background: ${config.pillBgColor}; border-radius: 6px; padding: 2px 8px;`;
    }

    return `
/* Karaoke Layer Styles (Spec G) */
.lime-karaoke-layer {
    position: absolute;
    left: 10%;
    right: 10%;
    bottom: ${config.bottomOffsetPercent}%;
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 9999;
    pointer-events: none;
    text-align: center;
    box-sizing: border-box;
}

.karaoke-cue {
    display: none;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    gap: 8px 12px;
    font-size: ${fontSize};
    font-weight: 800;
    line-height: 1.35;
    padding: 12px 24px;
    border-radius: 14px;
    background: rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(6px);
    max-width: 100%;
}

.karaoke-cue.is-active {
    display: flex;
}

.karaoke-word {
    display: inline-block;
    transition: none !important;
    transform-origin: center center;
    color: ${config.inactiveColor};
}

.karaoke-word.is-past {
    opacity: 0.9;
    color: ${config.inactiveColor};
}

.karaoke-word.is-upcoming {
    opacity: ${config.dimmedOpacity};
    color: ${config.inactiveColor};
}

.karaoke-word.is-active {
    opacity: 1;
    font-weight: 900;
    ${activeStyleRules}
}
`;
}

/**
 * JS Runtime cho Karaoke: Pure function cập nhật trạng thái theo timeInSec
 */
export function renderKaraokeJs(): string {
    return `
// Karaoke Runtime (Pure function of time t)
window.__updateKaraoke = function(t) {
    var layer = document.getElementById('lime-karaoke');
    if (!layer) return;

    var cues = layer.querySelectorAll('.karaoke-cue');
    for (var i = 0; i < cues.length; i++) {
        var cue = cues[i];
        var start = parseFloat(cue.getAttribute('data-start') || '0');
        var end = parseFloat(cue.getAttribute('data-end') || '0');

        if (t >= start && t <= end) {
            cue.classList.add('is-active');
            var words = cue.querySelectorAll('.karaoke-word');
            for (var j = 0; j < words.length; j++) {
                var w = words[j];
                var wStart = parseFloat(w.getAttribute('data-abs-start') || '0');
                var wEnd = parseFloat(w.getAttribute('data-abs-end') || '0');

                if (t < wStart) {
                    w.className = 'karaoke-word is-upcoming';
                } else if (t >= wStart && t <= wEnd) {
                    w.className = 'karaoke-word is-active';
                } else {
                    w.className = 'karaoke-word is-past';
                }
            }
        } else {
            cue.classList.remove('is-active');
        }
    }
};
`;
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
