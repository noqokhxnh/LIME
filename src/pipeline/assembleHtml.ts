import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { videoScript, scene, durationMap } from "@/llm/schema";

export interface assembleOptions {
    imageMap?: Record<string, string[]>;
    customCdn?: {
        gsap?: string;
        textPlugin?: string;
        motionPathPlugin?: string;
    };
}

export interface assembleResult {
    htmlPath: string;
    htmlContent: string;
}

export const DEFAULT_TRANSPARENT_GIF = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

export const GSAP_CDN = "https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js";
export const GSAP_TEXT_PLUGIN_CDN = "https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/TextPlugin.min.js";
export const GSAP_MOTION_PATH_PLUGIN_CDN = "https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/MotionPathPlugin.min.js";

/**
 * Stickman va FX helpers ho tro ve nhan vat va hieu ung comic
 */
export const STICKMAN_HELPERS_JS = `
window.__sm = function(opts) {
    opts = opts || {};
    var scale = opts.scale || 1;
    var ink = opts.ink || '#ffffff';
    var accent = opts.accent || '#ff4757';
    var mouth = opts.mouth || 'smile';
    
    var mouthD = 'M 90 85 Q 100 95 110 85';
    if (mouth === 'frown') mouthD = 'M 90 90 Q 100 80 110 90';
    if (mouth === 'flat') mouthD = 'M 90 85 L 110 85';
    if (mouth === 'o') mouthD = 'M 95 85 A 5 5 0 1 0 105 85 A 5 5 0 1 0 95 85';
    if (mouth === 'grin') mouthD = 'M 88 82 Q 100 98 112 82 Z';

    return '<svg class="stickman-svg" viewBox="0 0 200 260" style="width:' + (120 * scale) + 'px; height:' + (156 * scale) + 'px; overflow:visible;">' +
        '<g stroke="' + ink + '" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none">' +
            '<!-- Head -->' +
            '<circle class="sm-head" cx="100" cy="70" r="25" fill="#111" />' +
            '<!-- Eyes -->' +
            '<circle cx="92" cy="65" r="3" fill="' + ink + '" stroke="none" />' +
            '<circle cx="108" cy="65" r="3" fill="' + ink + '" stroke="none" />' +
            '<!-- Mouth -->' +
            '<path class="sm-mouth" d="' + mouthD + '" fill="' + (mouth === 'grin' ? accent : 'none') + '" />' +
            '<!-- Body/Spine -->' +
            '<line class="sm-spine" x1="100" y1="95" x2="100" y2="165" />' +
            '<!-- Arms -->' +
            '<g class="sm-arm-l" style="transform-origin: 100px 105px;"><line x1="100" y1="105" x2="70" y2="135" /></g>' +
            '<g class="sm-arm-r" style="transform-origin: 100px 105px;"><line x1="100" y1="105" x2="130" y2="135" /></g>' +
            '<!-- Legs -->' +
            '<g class="sm-leg-l" style="transform-origin: 100px 165px;"><line x1="100" y1="165" x2="75" y2="225" /></g>' +
            '<g class="sm-leg-r" style="transform-origin: 100px 165px;"><line x1="100" y1="165" x2="125" y2="225" /></g>' +
        '</g>' +
    '</svg>';
};

window.__fx = function(type, opts) {
    opts = opts || {};
    var x = opts.x || 0;
    var y = opts.y || 0;
    var el = document.createElement('div');
    el.className = 'fx-' + type;
    el.style.position = 'absolute';
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.pointerEvents = 'none';
    el.style.zIndex = '999';

    if (type === 'sweat') {
        el.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M12 2 C12 2 4 12 4 16 A8 8 0 0 0 20 16 C20 12 12 2 12 2 Z" fill="#70a1ff"/></svg>';
    } else if (type === 'shock') {
        el.innerHTML = '<svg width="40" height="40" viewBox="0 0 40 40"><path d="M20 2 L23 14 L35 10 L26 20 L38 25 L24 28 L28 40 L18 30 L10 38 L14 25 L2 22 L14 17 L8 4 Z" fill="#ffa502"/></svg>';
    } else if (type === 'question') {
        el.innerHTML = '<span style="font-size:32px; font-weight:900; color:#eccc68;">?</span>';
    } else {
        el.innerHTML = '<div style="width:10px; height:10px; background:#fff; border-radius:50%;"></div>';
    }
    return el;
};
`;

/**
 * Replace placeholders {{SCENE_DURATION}}, {{SCENE_IMAGE}} trong tung scene
 */
export function processSceneCode(
    scene: scene,
    duration: number,
    imageUrls: string[] = []
): { html: string; css: string; js: string } {
    let html = scene.htmlCode || "";
    let css = scene.cssCode || "";
    let js = scene.jsCode || "";

    // Thay the {{SCENE_DURATION}} va {{SCENE_<id>_DURATION}}
    const durStr = duration.toFixed(2);
    js = js.replace(/\{\{SCENE_DURATION\}\}/g, durStr);
    js = js.replace(new RegExp(`\\{\\{SCENE_${scene.id}_DURATION\\}\\}`, "g"), durStr);

    // Thay the cac token hinh anh
    const img1 = imageUrls[0] || DEFAULT_TRANSPARENT_GIF;
    const img2 = imageUrls[1] || DEFAULT_TRANSPARENT_GIF;
    const img3 = imageUrls[2] || DEFAULT_TRANSPARENT_GIF;

    html = html
        .replace(/\{\{SCENE_IMAGE\}\}/g, img1)
        .replace(/\{\{SCENE_IMAGE_1\}\}/g, img1)
        .replace(/\{\{SCENE_IMAGE_2\}\}/g, img2)
        .replace(/\{\{SCENE_IMAGE_3\}\}/g, img3);

    css = css
        .replace(/\{\{SCENE_IMAGE\}\}/g, img1)
        .replace(/\{\{SCENE_IMAGE_1\}\}/g, img1)
        .replace(/\{\{SCENE_IMAGE_2\}\}/g, img2)
        .replace(/\{\{SCENE_IMAGE_3\}\}/g, img3);

    // Dam bao container scene co du id va class scene
    if (!html.includes(`id="${scene.id}"`) && !html.includes(`id='${scene.id}'`)) {
        html = `<div class="scene" id="${scene.id}" style="background-color: ${scene.backgroundColor || '#000000'};">\n${html}\n</div>`;
    }

    return { html, css, js };
}

/**
 * Assemble toan bo script thanh 1 file HTML doc lap co chua GSAP va Master Timeline
 */
export async function assembleHTML(
    script: videoScript,
    durations: durationMap,
    width: number,
    height: number,
    workDir: string,
    onProgress?: (msg: string) => void,
    options?: assembleOptions
): Promise<assembleResult> {
    onProgress?.("Bắt đầu đóng gói mã nguồn HTML/GSAP");

    const imageMap = options?.imageMap || {};
    const processedScenes: { id: string; html: string; css: string; js: string; duration: number }[] = [];

    for (const scene of script.scenes) {
        const sceneDur = durations[scene.id] ?? 3.0;
        const images = imageMap[scene.id] || [];
        const processed = processSceneCode(scene, sceneDur, images);

        processedScenes.push({
            id: scene.id,
            html: processed.html,
            css: processed.css,
            js: processed.js,
            duration: sceneDur,
        });
    }

    const allScenesHtml = processedScenes.map((s) => s.html).join("\n\n");
    const allScenesCss = processedScenes.map((s) => s.css).join("\n\n");

    const allScenesJs = processedScenes
        .map(
            (s) => {
                const safeId = s.id.replace(/[^a-zA-Z0-9_]/g, "_");
                return `
// --- Scene: ${s.id} (Duration: ${s.duration}s) ---
try {
    let __capturedSceneTl_${safeId} = null;
    const __origTimeline_${safeId} = gsap.timeline;
    gsap.timeline = function(...args) {
        const tl = __origTimeline_${safeId}.apply(this, args);
        if (!__capturedSceneTl_${safeId}) {
            __capturedSceneTl_${safeId} = tl;
        }
        return tl;
    };

${s.js}

    gsap.timeline = __origTimeline_${safeId};
    if (!window.__sceneTimelines['${s.id}']) {
        if (__capturedSceneTl_${safeId}) {
            window.__registerScene('${s.id}', __capturedSceneTl_${safeId}, ${s.duration});
        } else {
            const fallbackTl = gsap.timeline();
            fallbackTl.to('#${s.id}', { opacity: 1, duration: 0.4 }, 0);
            window.__registerScene('${s.id}', fallbackTl, ${s.duration});
        }
    }
} catch (err) {
    console.error("[Scene Error] ${s.id}:", err);
    if (!window.__sceneTimelines['${s.id}']) {
        const fallbackTl = gsap.timeline();
        fallbackTl.to('#${s.id}', { opacity: 1, duration: 0.4 }, 0);
        window.__registerScene('${s.id}', fallbackTl, ${s.duration});
    }
}
`;
            }
        )
        .join("\n");

    const fontFamily = script.fontFamily || "Inter";
    const bg = script.colorPalette?.background || "#000000";
    const text = script.colorPalette?.text || "#ffffff";

    const fullHtml = `<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${script.title || "VidTML Animation"}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(fontFamily)}:wght@300;400;600;700;800;900&display=swap" rel="stylesheet">
    
    <!-- GSAP & Plugins -->
    <script src="${options?.customCdn?.gsap || GSAP_CDN}"></script>
    <script src="${options?.customCdn?.textPlugin || GSAP_TEXT_PLUGIN_CDN}"></script>
    <script src="${options?.customCdn?.motionPathPlugin || GSAP_MOTION_PATH_PLUGIN_CDN}"></script>

    <style>
        /* Base Reset & Viewport Constraints */
        *, *::before, *::after {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        html, body {
            width: ${width}px;
            height: ${height}px;
            overflow: hidden;
            background-color: ${bg};
            color: ${text};
            font-family: '${fontFamily}', sans-serif;
            position: relative;
            user-select: none;
        }

        #viewport {
            position: relative;
            width: 100%;
            height: 100%;
            overflow: hidden;
        }

        .scene {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            opacity: 0;
            overflow: hidden;
        }

        /* Global Styles from LLM Script */
        ${script.globalStyles || ""}

        /* Per-Scene Styles */
        ${allScenesCss}
    </style>
</head>
<body>
    <div id="viewport">
${allScenesHtml}
    </div>

    <script>
        // GSAP Plugins Registration
        if (typeof gsap !== 'undefined') {
            if (typeof TextPlugin !== 'undefined') gsap.registerPlugin(TextPlugin);
            if (typeof MotionPathPlugin !== 'undefined') gsap.registerPlugin(MotionPathPlugin);
        }

        // Master Timeline & Renderer Contract Plumbing
        window.__ready = false;
        window.__masterTimeline = gsap.timeline({ paused: true });
        window.__sceneTimelines = {};
        window.__sceneDurations = {};
        window.__totalDuration = 0;

        window.__registerScene = function(sceneId, tl, duration) {
            if (!tl) return;
            if (window.__sceneTimelines[sceneId]) return;
            window.__sceneTimelines[sceneId] = tl;
            window.__sceneDurations[sceneId] = duration;

            const startTime = window.__totalDuration;
            const endTime = startTime + duration;

            window.__masterTimeline.set('#' + sceneId, { zIndex: 10 }, startTime);
            window.__masterTimeline.add(tl, startTime);
            window.__masterTimeline.set('#' + sceneId, { opacity: 0, zIndex: 1 }, endTime);

            window.__totalDuration += duration;
        };

        window.__seekTo = function(timeInSec) {
            if (window.__masterTimeline) {
                window.__masterTimeline.seek(timeInSec, false);
            }
        };

        window.__getTotalDuration = function() {
            return window.__totalDuration || window.__masterTimeline.duration();
        };

        // Prevent accidental overwrite by script.globalSetupJs
        try {
            Object.defineProperty(window, '__registerScene', { writable: false, configurable: false });
            Object.defineProperty(window, '__masterTimeline', { writable: false, configurable: false });
            Object.defineProperty(window, '__seekTo', { writable: false, configurable: false });
            Object.defineProperty(window, '__getTotalDuration', { writable: false, configurable: false });
        } catch (e) {}

        // Kinetic text and utility helpers
        window.__splitTextChars = function(selector) {
            var els = document.querySelectorAll(selector);
            els.forEach(function(el) {
                var text = el.textContent || "";
                el.innerHTML = text.split("").map(function(c) {
                    return '<span class="char" style="display:inline-block;">' + (c === ' ' ? '&nbsp;' : c) + '</span>';
                }).join("");
            });
        };

        window.__splitTextWords = function(selector) {
            var els = document.querySelectorAll(selector);
            els.forEach(function(el) {
                var text = el.textContent || "";
                el.innerHTML = text.split(/\\s+/).map(function(w) {
                    return '<span class="word" style="display:inline-block; margin-right:0.25em;">' + w + '</span>';
                }).join("");
            });
        };

        window.__rand = function(min, max) {
            return Math.random() * (max - min) + min;
        };

        // Stickman & FX Helpers Injection
        ${STICKMAN_HELPERS_JS}

        // Global Setup JS from LLM Script (sanitized)
        ${(script.globalSetupJs || "")
            .replace(/window\.__registerScene\s*=[^;]+;/g, "/* sanitized __registerScene */")
            .replace(/window\.__masterTimeline\s*=[^;]+;/g, "/* sanitized __masterTimeline */")}

        // Scene Timeline Executions
        ${allScenesJs}

        // Page Ready Signal for Headless Browser Renderer
        window.__ready = true;
    </script>
</body>
</html>`;

    if (!existsSync(workDir)) {
        mkdirSync(workDir, { recursive: true });
    }

    const htmlPath = join(workDir, "index.html");
    writeFileSync(htmlPath, fullHtml, "utf-8");

    onProgress?.(`Đã tạo file HTML tại: ${htmlPath}`);

    return {
        htmlPath,
        htmlContent: fullHtml,
    };
}

export const assembleHtml = assembleHTML;
export const assembleCode = assembleHTML;
