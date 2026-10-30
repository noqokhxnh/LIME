import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { chromium, type Browser } from "playwright";

import {
    computeFallbackWordTimings,
    parseEdgeWordBoundaries,
    checkWordOnsetTolerance,
    type WordTiming,
} from "../../src/pipeline/wordTiming.js";
import {
    buildKaraokeTimeline,
    renderKaraokeJs,
    getSafeAreaBounds,
    isBoxWithinSafeArea,
    getKaraokeLayerBounds,
} from "../../src/pipeline/karaoke.js";
import { assembleHTML } from "../../src/pipeline/assembleHtml.js";
import { createBrowserDOMSampler, checkCaptionBandLeg } from "../../src/pipeline/oracleQa.js";
import { videoPreset, resolveResolution } from "../../src/config.js";
import {
    DEFAULT_VIETNAMESE_UNICODES,
    isCoveredByDefaultRanges,
    extractGlyphsFromHtml,
} from "../../src/pipeline/fontSubset.js";
import { videoRequestSchema, type videoScript, type durationMap } from "../../src/llm/schema.js";

describe("Workstream WS-G (Spec G): Phụ đề Karaoke & Định dạng Dọc 9:16", () => {
    let testTempDir: string;
    let browser: Browser | null = null;

    before(async () => {
        testTempDir = mkdtempSync(join(tmpdir(), "spec-g-test-"));
        try {
            browser = await chromium.launch({
                headless: true,
                args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
            });
        } catch {
            browser = null;
        }
    });

    after(async () => {
        if (browser) await browser.close().catch(() => {});
        if (testTempDir && existsSync(testTempDir)) {
            try { rmSync(testTempDir, { recursive: true, force: true }); } catch {}
        }
    });

    const sampleScript: videoScript = {
        title: "Video TikTok Dọc 9:16",
        description: "Demo tính năng karaoke và video dọc chuẩn Spec G",
        totalDuration: 5.0,
        aspectRatio: "9:16",
        fontFamily: "Inter",
        scenes: [
            {
                id: "scene-1",
                title: "Mở đầu",
                voiceOverText: "Chào mừng bạn đến với LIME",
                visualDescription: "Hiệu ứng chữ mở đầu",
                htmlCode: '<div class="intro"><h1>LIME VIDEO</h1></div>',
                cssCode: ".intro { display:flex; justify-content:center; align-items:center; height:100%; color:#fff; }",
                jsCode: "const tl = gsap.timeline(); tl.to('.intro', { opacity: 1, duration: {{SCENE_DURATION}} });",
                transition: "fade",
                backgroundColor: "#111111",
                duration: 2.5,
            },
            {
                id: "scene-2",
                title: "Tính năng",
                voiceOverText: "Công nghệ AI sinh video tự động",
                visualDescription: "Mô phỏng quy trình render",
                htmlCode: '<div class="feature"><h2>AI Generator</h2></div>',
                cssCode: ".feature { display:flex; justify-content:center; align-items:center; height:100%; color:#ffd700; }",
                jsCode: "const tl = gsap.timeline(); tl.to('.feature', { scale: 1.1, duration: {{SCENE_DURATION}} });",
                transition: "slide-left",
                backgroundColor: "#000000",
                duration: 2.5,
            },
        ],
    };
    const sampleDurations: durationMap = { "scene-1": 2.5, "scene-2": 2.5 };

    describe("(a) Word onset timing và dung sai ±120ms từ TTS sample", () => {
        it("phải phân bổ word timestamps fallback theo trọng số ký tự liên tục", () => {
            const timings = computeFallbackWordTimings("Chào mừng bạn đến với LIME", 2.4);
            assert.strictEqual(timings.length, 6);
            assert.strictEqual(timings[0].startMs, 0);
            assert.strictEqual(timings[5].endMs, 2400);
            for (let i = 1; i < timings.length; i++) {
                assert.strictEqual(timings[i].startMs, timings[i - 1].endMs);
            }
        });

        it("phải trích xuất WordBoundary từ metadata WebSocket Edge TTS", () => {
            const sampleJson = JSON.stringify({
                Metadata: [
                    { Type: "WordBoundary", Data: { Offset: 1200000, Duration: 3500000, text: { Text: "Chào" } } },
                    { Type: "WordBoundary", Data: { Offset: 4800000, Duration: 4000000, text: { Text: "mừng" } } },
                ],
            });
            const parsed = parseEdgeWordBoundaries(sampleJson);
            assert.deepStrictEqual(parsed, [
                { word: "Chào", startMs: 120, endMs: 470 },
                { word: "mừng", startMs: 480, endMs: 880 },
            ]);
        });

        it("phải đạt dung sai onset trong khoảng ±120ms so với mẫu âm thanh chuẩn", () => {
            const groundTruth: WordTiming[] = [
                { word: "Chào", startMs: 0, endMs: 420 },
                { word: "mừng", startMs: 430, endMs: 860 },
                { word: "bạn", startMs: 870, endMs: 1200 },
                { word: "đến", startMs: 1210, endMs: 1580 },
                { word: "với", startMs: 1590, endMs: 1950 },
                { word: "LIME", startMs: 1960, endMs: 2400 },
            ];
            const est = computeFallbackWordTimings("Chào mừng bạn đến với LIME", 2.4);
            const check = checkWordOnsetTolerance(est, groundTruth, 120);
            assert.strictEqual(check.valid, true);
            assert.ok(check.maxDiffMs <= 120);
        });

        it("phải báo lỗi khi độ lệch vượt quá dung sai 120ms", () => {
            const check = checkWordOnsetTolerance(
                [{ word: "A", startMs: 0, endMs: 500 }],
                [{ word: "A", startMs: 150, endMs: 650 }],
                120
            );
            assert.strictEqual(check.valid, false);
            assert.strictEqual(check.maxDiffMs, 150);
        });
    });

    describe("(b) Seek purity: seek đến t bất kỳ hiển thị đúng từ highlight và bất biến", () => {
        it("phải highlight đúng từ tại t và bất biến khi seek qua lại (seek purity)", async () => {
            if (!browser) {
                assert.ok(renderKaraokeJs().includes("window.__updateKaraoke = function(t)"));
                return;
            }
            const wordTimings = {
                "scene-1": [
                    { word: "Chào", startMs: 0, endMs: 600 },
                    { word: "mừng", startMs: 600, endMs: 1200 },
                    { word: "bạn", startMs: 1200, endMs: 1800 },
                    { word: "LIME", startMs: 1800, endMs: 2500 },
                ],
                "scene-2": [
                    { word: "Công", startMs: 0, endMs: 800 },
                    { word: "nghệ", startMs: 800, endMs: 1600 },
                    { word: "AI", startMs: 1600, endMs: 2500 },
                ],
            };
            const assembly = await assembleHTML(sampleScript, sampleDurations, 720, 1280, testTempDir, undefined, {
                wordTimings,
                karaoke: { highlightStyle: "glow", activeColor: "#00f2fe" },
            });
            const page = await browser.newPage();
            try {
                await page.goto(`file://${assembly.htmlPath}`);
                await page.waitForFunction(() => (window as any).__ready === true);

                await page.evaluate(() => (window as any).__seekTo(0.3));
                const wordAt03 = await page.evaluate(
                    () => document.querySelector("#karaoke-cue-scene-1 .karaoke-word.is-active")?.textContent?.trim()
                );
                assert.strictEqual(wordAt03, "Chào");

                await page.evaluate(() => (window as any).__seekTo(0.9));
                const wordAt09 = await page.evaluate(
                    () => document.querySelector("#karaoke-cue-scene-1 .karaoke-word.is-active")?.textContent?.trim()
                );
                assert.strictEqual(wordAt09, "mừng");

                await page.evaluate(() => (window as any).__seekTo(3.5));
                const wordAt35 = await page.evaluate(
                    () => document.querySelector("#karaoke-cue-scene-2 .karaoke-word.is-active")?.textContent?.trim()
                );
                assert.strictEqual(wordAt35, "nghệ");

                // Seek ngược lại t = 0.3s -> Phải giống hệt lần đầu (seek purity)
                await page.evaluate(() => (window as any).__seekTo(0.3));
                const wordAt03Again = await page.evaluate(
                    () => document.querySelector("#karaoke-cue-scene-1 .karaoke-word.is-active")?.textContent?.trim()
                );
                assert.strictEqual(wordAt03Again, "Chào");
            } finally {
                await page.close();
            }
        });
    });

    describe("(c) Font subsetting bao phủ toàn bộ dải ký tự tiếng Việt (U+1EA0–U+1EF9)", () => {
        it("phải chứa dải U+1EA0-1EF9 và các dải Latin cơ bản trong DEFAULT_VIETNAMESE_UNICODES", () => {
            assert.ok(DEFAULT_VIETNAMESE_UNICODES.includes("U+1EA0-1EF9"));
            assert.ok(DEFAULT_VIETNAMESE_UNICODES.includes("U+0020-007E"));
            assert.ok(DEFAULT_VIETNAMESE_UNICODES.includes("U+00A0-00FF"));
            assert.ok(DEFAULT_VIETNAMESE_UNICODES.includes("U+20AB"));
        });

        it("hàm isCoveredByDefaultRanges phải bao phủ 100% các ký tự tiếng Việt có dấu", () => {
            for (let cp = 0x1ea0; cp <= 0x1ef9; cp++) {
                assert.strictEqual(isCoveredByDefaultRanges(cp), true);
            }
            const viText = "áàảãạăắằẳẵặâấầẩẫậéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵđ";
            for (const char of viText) {
                assert.strictEqual(isCoveredByDefaultRanges(char.codePointAt(0)!), true);
            }
        });

        it("extractGlyphsFromHtml phải gộp dải U+1EA0-1EF9 cho phụ đề karaoke", () => {
            const { unicodesArg } = extractGlyphsFromHtml('<div><span class="karaoke-word">LIME AI</span></div>');
            assert.ok(unicodesArg.includes("U+1EA0-1EF9"));
        });
    });

    describe("(d) Render target dọc 9:16 có kích thước chuẩn xác 720x1280", () => {
        it("videoPreset và resolveResolution phải phân giải format: 'vertical' sang 720x1280", () => {
            assert.strictEqual(videoPreset["vertical"].width, 720);
            assert.strictEqual(videoPreset["vertical"].height, 1280);
            const res = resolveResolution("9:16", "vertical");
            assert.strictEqual(res.width, 720);
            assert.strictEqual(res.height, 1280);
        });

        it("HTML assembly 720x1280 phải định nghĩa đúng kích thước viewport", async () => {
            const result = await assembleHTML(sampleScript, sampleDurations, 720, 1280, testTempDir, undefined, {
                skipFontSubset: true,
                format: "vertical",
            });
            assert.ok(result.htmlContent.includes("width: 720px;"));
            assert.ok(result.htmlContent.includes("height: 1280px;"));
        });
    });

    describe("(e) Kiểm tra vùng an toàn (Safe Area 80%) cho Karaoke Layer", () => {
        it("getSafeAreaBounds phải tính đúng lề 10% và kích thước 80% cho 720x1280", () => {
            const safe = getSafeAreaBounds(720, 1280);
            assert.deepStrictEqual(safe, { x: 72, y: 128, width: 576, height: 1024, paddingX: 72, paddingY: 128 });
        });

        it("isBoxWithinSafeArea phải xác nhận Karaoke Layer nằm trọn trong vùng an toàn", () => {
            const boundsV = getKaraokeLayerBounds(720, 1280, 12, 80);
            assert.strictEqual(isBoxWithinSafeArea(boundsV, 720, 1280), true);
            // Bounding box chạm sát mép viền (lấn vào 10% padding)
            assert.strictEqual(isBoxWithinSafeArea({ left: 20, top: 100, width: 400, height: 50 }, 720, 1280), false);
        });

        it("phải chèn khung viền debug Safe Area khi bật safeArea: true", async () => {
            const res = await assembleHTML(sampleScript, sampleDurations, 720, 1280, testTempDir, undefined, {
                skipFontSubset: true,
                safeArea: true,
            });
            assert.ok(res.htmlContent.includes('id="lime-safe-area-guide"'));
            assert.ok(res.htmlContent.includes("SAFE AREA 80%"));
        });
    });

    describe("(f) Kết nối tùy chọn format từ schema request đến orchestrator và HTML assembly", () => {
        it("videoRequestSchema phải parse format: 'vertical' và 'horizontal'", () => {
            const v = videoRequestSchema.parse({ prompt: "Demo TikTok Video", format: "vertical", targetDurationSec: 30, style: "modern" });
            assert.strictEqual(v.format, "vertical");
            assert.strictEqual(v.aspectRatio, "9:16");

            const h = videoRequestSchema.parse({ prompt: "Demo YouTube Video", format: "horizontal", targetDurationSec: 60, style: "classic" });
            assert.strictEqual(h.format, "horizontal");
            assert.strictEqual(h.aspectRatio, "16:9");
        });

        it("videoRequestSchema phải chấp nhận safeArea và karaoke", () => {
            const req = videoRequestSchema.parse({
                prompt: "Demo Karaoke Video",
                format: "vertical",
                safeArea: true,
                karaoke: true,
                targetDurationSec: 15,
                style: "minimal",
            });
            assert.strictEqual(req.safeArea, true);
            assert.strictEqual(req.karaoke, true);
        });

        it("assembleHTML phải hỗ trợ cấu hình karaoke tùy biến (glow, scale, pill)", async () => {
            const res = await assembleHTML(sampleScript, sampleDurations, 720, 1280, testTempDir, undefined, {
                skipFontSubset: true,
                karaoke: { highlightStyle: "pill", activeColor: "#ff4757", pillBgColor: "rgba(255, 71, 87, 0.3)" },
            });
            assert.ok(res.htmlContent.includes('class="lime-karaoke-layer"'));
            assert.ok(res.htmlContent.includes("#ff4757"));
            assert.ok(res.htmlContent.includes("rgba(255, 71, 87, 0.3)"));
        });
    });

    describe("(g) Caption band QA (#110) — đo bbox thật, không dựa vào whitelist tag", () => {
        /**
         * Dựng kịch bản có CTA ở trên (an toàn) và brand footer neo đáy khung
         * (nằm trong dải caption). Footer cố tình dùng <div> — đúng kiểu LLM hay
         * sinh ra, và là ca mà whitelist tag cũ bỏ sót → QA pass oan.
         */
        const makeBandScript = (footerAttrs = ""): { script: videoScript; durations: durationMap } => ({
            script: {
                title: "Caption band regression",
                description: "Footer dạng div nằm trong dải caption",
                totalDuration: 2.5,
                aspectRatio: "9:16",
                fontFamily: "Inter",
                scenes: [
                    {
                        id: "scene-band",
                        title: "CTA",
                        voiceOverText: "Đặt bàn ngay hôm nay để nhận ưu đãi",
                        visualDescription: "Thẻ CTA ở giữa khung",
                        htmlCode:
                            '<div class="cta">ĐẶT BÀN NGAY</div>' +
                            `<div class="brand-title" ${footerAttrs}>CÀ PHÊ MỘC</div>`,
                        // bottom:200px đặt footer đúng vào dải cue thật (720x1280 →
                        // cue nằm ~y=1008..1126); bottom:24px sẽ rơi xuống dưới cue
                        // và không còn là ca xâm phạm cần chặn.
                        cssCode:
                            ".cta { position:absolute; top:38%; left:0; right:0; text-align:center; font-size:44px; color:#fff; }" +
                            ".brand-title { position:absolute; bottom:200px; left:0; right:0; text-align:center; font-size:34px; color:#fff; }",
                        jsCode: "",
                        transition: "fade",
                        backgroundColor: "#111111",
                        duration: 2.5,
                    },
                ],
            },
            durations: { "scene-band": 2.5 },
        });

        const measure = async (footerAttrs: string) => {
            const { script, durations } = makeBandScript(footerAttrs);
            const assembly = await assembleHTML(script, durations, 720, 1280, testTempDir, undefined, {
                skipFontSubset: true,
                karaoke: true,
            });
            const setup = await createBrowserDOMSampler(assembly.htmlPath, 720, 1280);
            try {
                return await checkCaptionBandLeg(script.scenes, durations, setup.captionSampler);
            } finally {
                await setup.cleanup();
            }
        };

        it("phải fail khi brand footer dạng <div> nằm trong dải caption", async () => {
            if (!browser) {
                // Không có Chromium: chỉ khẳng định leg tồn tại và là hàm async.
                assert.strictEqual(typeof checkCaptionBandLeg, "function");
                return;
            }
            const leg = await measure("");
            assert.strictEqual(leg.status, "fail");
            assert.ok(leg.sampledFrames > 0, "phải lấy được mẫu caption thật");
            assert.ok(
                leg.violations?.some((v) => v.includes("CÀ PHÊ MỘC")),
                `phải chỉ đích danh footer bị che, nhận được: ${leg.violations?.join(" | ")}`
            );
            // CTA ở 38% khung không được báo oan.
            assert.ok(!leg.violations?.some((v) => v.includes("ĐẶT BÀN NGAY")));
        });

        it("phải tôn trọng data-caption-exempt cho phần tử trang trí chủ ý nằm trong dải", async () => {
            if (!browser) {
                assert.strictEqual(typeof checkCaptionBandLeg, "function");
                return;
            }
            const leg = await measure("data-caption-exempt");
            assert.strictEqual(leg.status, "pass");
            assert.strictEqual(leg.violations, undefined);
        });
    });
});
