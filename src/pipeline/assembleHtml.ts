import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { videoScript, scene, durationMap, CharacterActionItem, SceneCamera } from "../llm/schema.js";
import { resolveCamera, type ResolvedCamera } from "./camera.js";
import { BLOCK_HELPERS_JS } from "../templates/runtime/blockHelpers.js";
import { DETERMINISTIC_RUNTIME_JS, hashString32, RNG, getSceneSeed } from "./rng.js";
import { assertDeterministicScript } from "./compLinter.js";
import { assertSceneCodePolicy } from "./codePolicy.js";
import { subsetFontsForHtml } from "./fontSubset.js";
import { CHARACTER_RUNTIME_JS } from "./character/runtime.js";
import { KINETIC_TYPOGRAPHY_JS } from "./kineticTypography.js";
import {
    KaraokeConfig,
    buildKaraokeTimeline,
    renderKaraokeHtml,
    renderKaraokeCss,
    renderKaraokeJs,
    getSafeAreaBounds,
    isBoxWithinSafeArea,
    getKaraokeLayerBounds,
    getNominalCaptionBand,
} from "./karaoke.js";
import { WordTiming } from "./wordTiming.js";

export {
    BLOCK_HELPERS_JS,
    CHARACTER_RUNTIME_JS,
    getSafeAreaBounds,
    isBoxWithinSafeArea,
    getKaraokeLayerBounds,
};

export interface assembleOptions {
    imageMap?: Record<string, string[]>;
    wordTimings?: Record<string, WordTiming[]>;
    karaoke?: boolean | KaraokeConfig;
    safeArea?: boolean;
    format?: 'vertical' | 'horizontal';
    customCdn?: {
        gsap?: string;
        textPlugin?: string;
        motionPathPlugin?: string;
    };
    seed?: number;
    jobId?: string;
    skipLint?: boolean;
    skipFontSubset?: boolean;
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
 * SVG attribute setter shim (#109): LLM hay viết tween GSAP set TRỰC TIẾP thuộc tính
 * hình học trên phần tử SVG (line.y2, circle.cx, path.d…) nhưng Chromium expose
 * chỉ-getter ⇒ `Cannot set property y2 of SVGLineElement which has only a getter`
 * làm CRASH cả timeline render (job "đại hồng thủy" 524ed0e1). Shim biến setter thành
 * setAttribute — animation chạy đúng thay vì phá vỡ toàn bộ video. Phải chạy TRƯỚC
 * mọi jsCode của scene (đặt ngay sau phần đăng ký plugin GSAP).
 */
export const SVG_ATTR_SHIM_JS = `
;(function svgAttrShim() {
    var targets = {
        SVGLineElement:    ['x1','y1','x2','y2'],
        SVGRectElement:    ['x','y','width','height','rx','ry'],
        SVGCircleElement:  ['cx','cy','r'],
        SVGEllipseElement: ['cx','cy','rx','ry'],
        SVGPolylineElement:['points'],
        SVGPolygonElement: ['points'],
        SVGPathElement:    ['d'],
        SVGRadialGradientElement: ['cx','cy','r','fx','fy'],
        SVGLinearGradientElement: ['x1','y1','x2','y2'],
    };
    var proto, attrs, i, desc;
    function shimAttr(proto, attr) {
        try {
            desc = Object.getOwnPropertyDescriptor(proto, attr);
            if (desc && desc.set) return; // đã có setter (SVG2 reflection đầy đủ) thì thôi
            Object.defineProperty(proto, attr, {
                get: (desc && desc.get)
                    ? desc.get
                    : function () { return this.getAttribute(attr); },
                set: function (v) { this.setAttribute(attr, v == null ? '' : String(v)); },
                configurable: true,
            });
        } catch (e) { /* tuyệt đối không để shim làm hỏng render */ }
    }
    for (var name in targets) {
        if (!Object.prototype.hasOwnProperty.call(targets, name)) continue;
        proto = window[name] && window[name].prototype;
        if (!proto) continue;
        attrs = targets[name];
        for (i = 0; i < attrs.length; i++) shimAttr(proto, attrs[i]); // shimAttr nhận attr theo giá trị — không dính closure loop
    }
})();
`;

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

    if (!options?.skipLint) {
        assertDeterministicScript(script);
        // Cổng bảo mật riêng (không phải lint tất định): mã scene là dữ liệu
        // không đáng tin chạy trong Chromium phía server — chặn nguyên thuỷ
        // mạng và nạp mã động ngay ở biên assemble. Lớp thứ hai là
        // networkGuard ở tầng Playwright.
        assertSceneCodePolicy(script);
    }

    const seed = options?.seed !== undefined
        ? (options.seed >>> 0)
        : (options?.jobId ? hashString32(options.jobId) : (hashString32(script.id || script.title || "vidtml-seed") >>> 0));

    const imageMap = options?.imageMap || {};
    const processedScenes: { id: string; html: string; css: string; js: string; duration: number; characterActions?: CharacterActionItem[]; camera: ResolvedCamera }[] = [];

    for (const scene of script.scenes) {
        const sceneDur = durations[scene.id] ?? 3.0;
        const images = imageMap[scene.id] || [];
        const processed = processSceneCode(scene, sceneDur, images);

        let sceneHtml = processed.html;
        const safeId = scene.id.replace(/[^a-zA-Z0-9_]/g, "_");
        if (scene.characterActions && scene.characterActions.length > 0) {
            const canvasTag = `<canvas class="character-canvas" id="char_canvas_${safeId}" width="${width}" height="${height}" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:15;"></canvas>`;
            if (sceneHtml.includes(`id="${scene.id}"`) || sceneHtml.includes(`id='${scene.id}'`)) {
                sceneHtml = sceneHtml.replace(/(<\/div>\s*)$/, `${canvasTag}\n$1`);
            } else {
                sceneHtml += `\n${canvasTag}`;
            }
        }

        processedScenes.push({
            id: scene.id,
            html: sceneHtml,
            css: processed.css,
            js: processed.js,
            duration: sceneDur,
            characterActions: scene.characterActions,
            camera: resolveCamera(scene.camera as SceneCamera | undefined),
        });
    }

    const allScenesHtml = processedScenes.map((s) => s.html).join("\n\n");
    const allScenesCss = processedScenes.map((s) => s.css).join("\n\n");

    const karaokeEnabled = options?.karaoke !== false;
    const karaokeConfig = typeof options?.karaoke === "object" ? options.karaoke : { enabled: karaokeEnabled };
    const karaokeCues = karaokeEnabled ? buildKaraokeTimeline(script, durations, options?.wordTimings) : [];
    const karaokeHtml = karaokeEnabled ? renderKaraokeHtml(karaokeCues, karaokeConfig) : "";
    const karaokeCss = karaokeEnabled ? renderKaraokeCss(karaokeConfig) : "";
    const karaokeJs = karaokeEnabled ? renderKaraokeJs() : "";

    // Dải caption danh nghĩa (#110) — công bố cho template/LLM biết vùng cấm đáy.
    const captionBand = karaokeEnabled ? getNominalCaptionBand(width, height, karaokeConfig) : null;
    const captionBandPct = captionBand
        ? Math.round((captionBand.height / height) * 1000) / 10
        : 0;

    const safeAreaGuideHtml = options?.safeArea
        ? `\n    <!-- Safe Area Debug Overlay (QA Guide) -->\n    <div id="lime-safe-area-guide" class="lime-safe-area-guide" aria-hidden="true">\n        <div class="safe-area-label">SAFE AREA 80% (10% V / 10% H)</div>\n    </div>${
              captionBand
                  ? `\n    <!-- Caption Band Debug Overlay (#110) -->\n    <div id="lime-caption-band-guide" class="lime-caption-band-guide" aria-hidden="true">\n        <span>CAPTION BAND — KHÔNG ĐẶT CTA/NỘI DUNG</span>\n    </div>`
                  : ""
          }`
        : "";

    const safeAreaGuideCss = options?.safeArea
        ? `
/* Safe Area Debug Overlay (QA Guide) */
.lime-safe-area-guide {
    position: absolute;
    top: 10%;
    left: 10%;
    width: 80%;
    height: 80%;
    border: 2px dashed rgba(255, 69, 58, 0.75);
    box-sizing: border-box;
    pointer-events: none;
    z-index: 99999;
}
.lime-safe-area-guide .safe-area-label {
    position: absolute;
    top: 6px;
    left: 8px;
    font-size: 12px;
    font-family: monospace;
    font-weight: 700;
    color: rgba(255, 69, 58, 0.9);
    letter-spacing: 0.5px;
    text-transform: uppercase;
}
${captionBand ? `/* Caption Band Debug Overlay (#110) — dải đáy dành riêng cho phụ đề */
.lime-caption-band-guide {
    position: absolute;
    left: 0;
    right: 0;
    top: ${captionBand.top}px;
    height: ${captionBand.height}px;
    background: repeating-linear-gradient(
        45deg,
        rgba(255, 214, 10, 0.18),
        rgba(255, 214, 10, 0.18) 10px,
        rgba(255, 214, 10, 0.08) 10px,
        rgba(255, 214, 10, 0.08) 20px
    );
    border-top: 2px dashed rgba(255, 214, 10, 0.85);
    box-sizing: border-box;
    pointer-events: none;
    z-index: 99998;
}
.lime-caption-band-guide span {
    position: absolute;
    top: 4px;
    left: 8px;
    font-size: 11px;
    font-family: monospace;
    font-weight: 700;
    color: rgba(255, 214, 10, 0.95);
    letter-spacing: 0.5px;
    text-transform: uppercase;
}
` : ""}
`
        : "";

    const allScenesJs = processedScenes
        .map(
            (s) => {
                const safeId = s.id.replace(/[^a-zA-Z0-9_]/g, "_");
                const sceneSeed = getSceneSeed(options?.jobId || String(seed), s.id);
                const sceneIdLiteral = JSON.stringify(s.id);
                const characterActionsLiteral = JSON.stringify(s.characterActions || []);
                return `
// --- Scene: ${s.id} (Duration: ${s.duration}s, Seed: ${sceneSeed}) ---
try {
    window.__sceneSeeds[${sceneIdLiteral}] = ${sceneSeed};
    window.__sceneCharacterActions[${sceneIdLiteral}] = ${characterActionsLiteral};
    window.__sceneCameras[${sceneIdLiteral}] = ${JSON.stringify(s.camera)};
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
    if (!window.__sceneTimelines[${sceneIdLiteral}]) {
        if (__capturedSceneTl_${safeId}) {
            window.__registerScene(${sceneIdLiteral}, __capturedSceneTl_${safeId}, ${s.duration});
        } else {
            const fallbackTl = gsap.timeline();
            fallbackTl.to(document.getElementById(${sceneIdLiteral}) || '#${safeId}', { opacity: 1, duration: 0.4 }, 0);
            window.__registerScene(${sceneIdLiteral}, fallbackTl, ${s.duration});
        }
    }
} catch (err) {
    console.error("[Scene Error] " + ${sceneIdLiteral} + ":", err);
    if (!window.__sceneTimelines[${sceneIdLiteral}]) {
        const fallbackTl = gsap.timeline();
        fallbackTl.to(document.getElementById(${sceneIdLiteral}) || '#${safeId}', { opacity: 1, duration: 0.4 }, 0);
        window.__registerScene(${sceneIdLiteral}, fallbackTl, ${s.duration});
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
            /* Dải caption (#110): nội dung chính neo phía trên mốc này. */
            --lime-caption-band-px: ${captionBand?.height ?? 0}px;
            --lime-caption-band-top-px: ${captionBand?.top ?? height}px;
            --lime-caption-band-pct: ${captionBandPct}%;
            /* Khoảng cách từ đáy khung lên mép trên dải caption — dùng cho bottom: calc(...) */
            --lime-caption-clearance-px: ${captionBand ? height - captionBand.top : 0}px;
        }

        /* Isolated blending stack for scenes */
        .scene {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            opacity: 0;
            overflow: hidden;
            isolation: isolate;
        }

        /* Neutral crossfade keeping native RGB values without darkening */
        .scene.crossfade {
            isolation: isolate;
        }

        /* Specialized multiply blend mode for intentional stencil/multiply crossfades */
        .scene-crossfade-multiply,
        .crossfade-multiply,
        .blend-multiply {
            mix-blend-mode: multiply;
        }

        /* Global Styles from LLM Script */
        ${script.globalStyles || ""}

        /* Per-Scene Styles */
        ${allScenesCss}

        /* Karaoke Subtitles Styles */
        ${karaokeCss}

        ${safeAreaGuideCss}
    </style>
</head>
<body>
    <div id="viewport">
${allScenesHtml}
${karaokeHtml}
${safeAreaGuideHtml}
    </div>

    <script>
        // GSAP Plugins Registration
        if (typeof gsap !== 'undefined') {
            if (typeof TextPlugin !== 'undefined') gsap.registerPlugin(TextPlugin);
            if (typeof MotionPathPlugin !== 'undefined') gsap.registerPlugin(MotionPathPlugin);
        }

        // SVG attribute setter shim (#109) — phải TRƯỚC mọi jsCode của scene
        ${SVG_ATTR_SHIM_JS}

        // Spec B Deterministic PRNG & Hash Runtime
        ${DETERMINISTIC_RUNTIME_JS}

        // Master Timeline & Renderer Contract Plumbing
        window.__ready = false;
        window.__masterTimeline = gsap.timeline({ paused: true });
        window.__sceneTimelines = {};
        window.__sceneDurations = {};
        window.__sceneSeeds = {};
        window.__sceneCharacterActions = {};
        window.__sceneCameras = {};
        window.__totalDuration = 0;

        if (window.__masterTimeline) {
            window.__masterTimeline.eventCallback('onUpdate', function() {
                if (typeof window.__renderCharacters === 'function') {
                    window.__renderCharacters(window.__masterTimeline.time());
                }
            });
        }

        // Deterministic Seed & PRNG Contract (Spec B)
        window.__renderSeed = ${seed};
        window.__rng = RNG(window.__renderSeed);
        window.__rand = function(min, max) {
            var val = window.__rng();
            if (min === undefined && max === undefined) return val;
            if (max === undefined) return val * min;
            return min + val * (max - min);
        };

        // Spec D: Comp Motion API contract
        if (typeof window.__motion === 'undefined') {
            window.__motion = null;
        }
        if (typeof window.__hasShutterBlur === 'undefined') {
            window.__hasShutterBlur = false;
        }

        window.__registerScene = function(sceneId, tl, duration) {
            if (!tl) return;
            if (window.__sceneTimelines[sceneId]) return;
            window.__sceneTimelines[sceneId] = tl;
            window.__sceneDurations[sceneId] = duration;

            const startTime = window.__totalDuration;
            const endTime = startTime + duration;

            window.__masterTimeline.set('#' + sceneId, { zIndex: 10 }, startTime);
            window.__masterTimeline.add(tl, startTime);

            // Camera layer (#122): pipeline-owned tween, seek-safe, ease 'none'.
            // Không dùng tween của LLM nên tua tới đâu cũng ra đúng một khung hình.
            var cam = window.__sceneCameras[sceneId];
            if (cam && cam.move !== 'locked') {
                window.__masterTimeline.fromTo(
                    '#' + sceneId,
                    {
                        scale: cam.from.scale,
                        xPercent: cam.from.xPercent,
                        yPercent: cam.from.yPercent
                    },
                    {
                        scale: cam.to.scale,
                        xPercent: cam.to.xPercent,
                        yPercent: cam.to.yPercent,
                        duration: duration,
                        ease: 'none'
                    },
                    startTime
                );
            }

            window.__masterTimeline.set('#' + sceneId, { opacity: 0, zIndex: 1 }, endTime);

            window.__totalDuration += duration;
        };

        window.__seekTo = function(timeInSec) {
            if (window.__masterTimeline) {
                window.__masterTimeline.seek(timeInSec, false);
            }
            if (typeof window.__renderCharacters === 'function') {
                window.__renderCharacters(timeInSec);
            }
            if (typeof window.__updateKaraoke === 'function') {
                window.__updateKaraoke(timeInSec);
            }
        };

        window.__getTotalDuration = function() {
            return window.__totalDuration || window.__masterTimeline.duration();
        };

        // Spec E: Sound from Timeline Events API Contract
        window.__timelineEvents = [];
        window.__events = function() {
            return window.__timelineEvents;
        };
        window.__addEvent = function(evt) {
            if (!window.__timelineEvents) window.__timelineEvents = [];
            if (evt && typeof evt.t === 'number' && evt.material) {
                window.__timelineEvents.push(evt);
            }
        };

        // Cross-fade helper between scenes with customizable blend mode
        window.__crossFade = function(sceneAId, sceneBId, duration, opts) {
            opts = opts || {};
            var mode = opts.blendMode || 'normal';
            var elA = document.getElementById(sceneAId);
            var elB = document.getElementById(sceneBId);
            if (elA && opts.blendMode) elA.style.mixBlendMode = mode;
            if (elB && opts.blendMode) elB.style.mixBlendMode = mode;
            var tl = gsap.timeline();
            tl.to(elA || '#' + sceneAId, { opacity: 0, duration: duration, ease: 'none' }, 0);
            tl.to(elB || '#' + sceneBId, { opacity: 1, duration: duration, ease: 'none' }, 0);
            return tl;
        };

        window.__applyMultiplyBlend = function(selectorOrElement) {
            var elements = typeof selectorOrElement === 'string'
                ? document.querySelectorAll(selectorOrElement)
                : [selectorOrElement];
            elements.forEach(function(el) {
                if (el && el.style) {
                    el.style.mixBlendMode = 'multiply';
                }
            });
        };

        // Prevent accidental overwrite by script.globalSetupJs
        try {
            Object.defineProperty(window, '__registerScene', { writable: false, configurable: false });
            Object.defineProperty(window, '__masterTimeline', { writable: false, configurable: false });
            Object.defineProperty(window, '__seekTo', { writable: false, configurable: false });
            Object.defineProperty(window, '__getTotalDuration', { writable: false, configurable: false });
            Object.defineProperty(window, '__renderSeed', { writable: false, configurable: false });
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

        // Stickman & FX Helpers Injection
        ${STICKMAN_HELPERS_JS}

        // Studio Motion Blocks (window.__block)
        ${BLOCK_HELPERS_JS}

        // Global Setup JS from LLM Script (sanitized)
        ${(script.globalSetupJs || "")
            .replace(/window\.__registerScene\s*=[^;]+;/g, "/* sanitized __registerScene */")
            .replace(/window\.__masterTimeline\s*=[^;]+;/g, "/* sanitized __masterTimeline */")}

        // Procedural Character Runtime (Spec F)
        ${CHARACTER_RUNTIME_JS}

        // Kinetic Typography Presets (Issue #31)
        ${KINETIC_TYPOGRAPHY_JS}

        // Scene Timeline Executions
        ${allScenesJs}

        // Karaoke Subtitles Runtime
        ${karaokeJs}
        if (typeof window.__renderCharacters === 'function') {
            window.__renderCharacters(0);
        }
        if (typeof window.__updateKaraoke === 'function') {
            window.__updateKaraoke(0);
        }

        // Page Ready Signal for Headless Browser Renderer
        window.__ready = true;
    </script>
</body>
</html>`;

    let finalHtml = fullHtml;
    if (!options?.skipFontSubset) {
        try {
            const subsetResult = await subsetFontsForHtml(fullHtml, {
                fontFamily,
            });
            finalHtml = subsetResult.html;
            if (!subsetResult.subsetStats.skipped) {
                onProgress?.(`Đã nhúng font subset nội bộ (${subsetResult.subsetStats.fontFamily}, ${Math.round((subsetResult.subsetStats.subsetSize || 0) / 1024)}KB)`);
            }
        } catch (err: any) {
            console.warn("[FontSubset] Lỗi khi cắt font, giữ nguyên HTML gốc:", err?.message || err);
        }
    }

    if (!existsSync(workDir)) {
        mkdirSync(workDir, { recursive: true });
    }

    const htmlPath = join(workDir, "index.html");
    writeFileSync(htmlPath, finalHtml, "utf-8");

    onProgress?.(`Đã tạo file HTML tại: ${htmlPath}`);

    return {
        htmlPath,
        htmlContent: finalHtml,
    };
}

export const assembleHtml = assembleHTML;
export const assembleCode = assembleHTML;
