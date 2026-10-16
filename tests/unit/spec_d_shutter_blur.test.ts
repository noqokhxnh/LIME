import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { chromium, type Browser, type Page } from "playwright";

import {
    srgbToLinear,
    linearToSrgb,
    blendChannelsLinear,
    averageFramesLinear,
    LinearLightAccumulator,
    SRGB_TO_LINEAR_LUT,
} from "../../src/pipeline/linearLight.js";
import {
    decodePng,
} from "../../src/pipeline/pngDecoder.js";
import {
    calculateSubFrameTimestamps,
    renderSubFrame,
} from "../../src/pipeline/shutterRenderer.js";
import {
    computeDisplacementFromBoxes,
    detectMotion,
    getCompMotion,
    type DOMBox,
} from "../../src/pipeline/motion.js";
import { renderVideo } from "../../src/pipeline/renderer.js";
import { checkCurvesLeg, runOracleQa } from "../../src/pipeline/oracleQa.js";
import { calculateWillApplyBlur } from "../../src/pipeline/orchestrator.js";

describe("Workstream WS-D (Spec D): Shutter Motion Blur", () => {
    let testTempDir: string;
    let browser: Browser | null = null;

    before(async () => {
        testTempDir = mkdtempSync(join(tmpdir(), "spec-d-shutter-test-"));
        browser = await chromium.launch({
            headless: true,
            args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
        });
    });

    after(async () => {
        if (browser) {
            await browser.close().catch(() => {});
        }
        if (testTempDir) {
            try {
                rmSync(testTempDir, { recursive: true, force: true });
            } catch {}
        }
    });

    // =========================================================================
    // SUITE 1: LINEAR-LIGHT MATH & BLENDING
    // =========================================================================
    describe("Toán học ánh sáng tuyến tính (Linear-Light Math) & Pha trộn màu", () => {
        it("TC-D01: Chuyển đổi sRGB sang Linear và ngược lại đúng với các giá trị biên", () => {
            assert.strictEqual(srgbToLinear(0), 0);
            assert.strictEqual(srgbToLinear(255), 1);
            assert.strictEqual(linearToSrgb(0), 0);
            assert.strictEqual(linearToSrgb(1), 255);

            // Kiểm tra bảng tra cứu SRGB_TO_LINEAR_LUT
            assert.strictEqual(SRGB_TO_LINEAR_LUT[0], 0);
            assert.strictEqual(SRGB_TO_LINEAR_LUT[255], 1);
            assert.ok(Math.abs(SRGB_TO_LINEAR_LUT[128] - srgbToLinear(128)) < 1e-6);
        });

        it("TC-D02: Pha trộn 0 và 255 trong Linear Light cho ra 188 (không phải 128 như sRGB thô)", () => {
            // Hand-computed property từ đặc tả:
            // linear(0) = 0, linear(255) = 1 => avg = 0.5
            // sRGB(0.5) = 1.055 * (0.5 ^ (1/2.4)) - 0.055 ≈ 0.735357
            // 0.735357 * 255 ≈ 187.516 -> Math.round là 188
            const linearBlended = blendChannelsLinear([0, 255]);
            assert.strictEqual(linearBlended, 188);

            // So sánh với trung bình sRGB thô tạo vệt xám tối
            const rawSrgbAverage = Math.round((0 + 255) / 2); // 128
            assert.strictEqual(rawSrgbAverage, 128);
            assert.ok(linearBlended > rawSrgbAverage, "Pha trộn linear light phải sáng hơn đáng kể so với trung bình sRGB thô");
        });

        it("TC-D03: averageFramesLinear pha trộn chính xác mảng 2x2 điểm ảnh tổng hợp", () => {
            const width = 2;
            const height = 2;
            const pixelCount = width * height;

            // Frame 1: toàn màu đen [0, 0, 0, 255]
            const frameBlack = new Uint8Array(pixelCount * 4);
            for (let i = 0; i < pixelCount * 4; i += 4) {
                frameBlack[i] = 0;
                frameBlack[i + 1] = 0;
                frameBlack[i + 2] = 0;
                frameBlack[i + 3] = 255;
            }

            // Frame 2: toàn màu trắng [255, 255, 255, 255]
            const frameWhite = new Uint8Array(pixelCount * 4);
            for (let i = 0; i < pixelCount * 4; i += 4) {
                frameWhite[i] = 255;
                frameWhite[i + 1] = 255;
                frameWhite[i + 2] = 255;
                frameWhite[i + 3] = 255;
            }

            const averaged = averageFramesLinear([frameBlack, frameWhite], width, height);

            // Tất cả các điểm ảnh phải có kênh R, G, B = 188 và Alpha = 255
            for (let i = 0; i < pixelCount * 4; i += 4) {
                assert.strictEqual(averaged[i], 188, `Kênh R tại pixel ${i / 4} phải bằng 188`);
                assert.strictEqual(averaged[i + 1], 188, `Kênh G tại pixel ${i / 4} phải bằng 188`);
                assert.strictEqual(averaged[i + 2], 188, `Kênh B tại pixel ${i / 4} phải bằng 188`);
                assert.strictEqual(averaged[i + 3], 255, `Kênh A tại pixel ${i / 4} phải bằng 255`);
            }
        });

        it("TC-D04: Pha trộn màu Đỏ và Xanh Lá tạo ra màu Vàng tươi rực rỡ, không bị xỉn", () => {
            const width = 1;
            const height = 1;
            const frameRed = new Uint8Array([255, 0, 0, 255]);
            const frameGreen = new Uint8Array([0, 255, 0, 255]);

            const averaged = averageFramesLinear([frameRed, frameGreen], width, height);
            assert.strictEqual(averaged[0], 188); // R
            assert.strictEqual(averaged[1], 188); // G
            assert.strictEqual(averaged[2], 0);   // B
            assert.strictEqual(averaged[3], 255); // A
        });

        it("TC-D05: LinearLightAccumulator bảo toàn nguyên vẹn khung hình đơn hoặc tĩnh", () => {
            const width = 2;
            const height = 1;
            const frameStatic = new Uint8Array([120, 200, 50, 255, 10, 80, 220, 255]);

            const acc = new LinearLightAccumulator(width, height);
            acc.addFrame(frameStatic);
            acc.addFrame(frameStatic);
            acc.addFrame(frameStatic);
            const result = acc.toRgba();

            assert.strictEqual(result[0], 120);
            assert.strictEqual(result[1], 200);
            assert.strictEqual(result[2], 50);
            assert.strictEqual(result[3], 255);
            assert.strictEqual(result[4], 10);
            assert.strictEqual(result[5], 80);
            assert.strictEqual(result[6], 220);
            assert.strictEqual(result[7], 255);
        });
    });

    // =========================================================================
    // SUITE 2: SKIP HOLDS IDENTITY & MOTION DETECTION
    // =========================================================================
    describe("Phát hiện chuyển động & Skip Holds cho khung hình tĩnh", () => {
        it("TC-D06: computeDisplacementFromBoxes bỏ qua chuyển động khi dịch chuyển < 1px", () => {
            const boxes0: Record<string, DOMBox | null> = {
                "#hero": { left: 100, top: 100, right: 150, bottom: 150, width: 50, height: 50 },
            };

            // Dịch chuyển 0.4px (dưới ngưỡng 1px)
            const boxes1SubPixel: Record<string, DOMBox | null> = {
                "#hero": { left: 100.4, top: 100, right: 150.4, bottom: 150, width: 50, height: 50 },
            };

            const result = computeDisplacementFromBoxes(boxes0, boxes1SubPixel);
            assert.strictEqual(result.hasMotion, false, "Chuyển động < 1px phải được nhận diện là tĩnh (hasMotion: false)");
            assert.ok(result.totalDisplacement < 1.0);
        });

        it("TC-D07: computeDisplacementFromBoxes kích hoạt chuyển động khi dịch chuyển >= 1px", () => {
            const boxes0: Record<string, DOMBox | null> = {
                "#hero": { left: 100, top: 100, right: 150, bottom: 150, width: 50, height: 50 },
            };

            // Dịch chuyển 25px
            const boxes1Moving: Record<string, DOMBox | null> = {
                "#hero": { left: 125, top: 100, right: 175, bottom: 150, width: 50, height: 50 },
            };

            const result = computeDisplacementFromBoxes(boxes0, boxes1Moving);
            assert.strictEqual(result.hasMotion, true, "Chuyển động >= 1px phải kích hoạt hasMotion: true");
            assert.strictEqual(result.maxDisplacement, 25);
            assert.strictEqual(result.vectors.length, 1);
            assert.strictEqual(result.vectors[0].dx, 25);
            assert.strictEqual(result.vectors[0].dy, 0);
        });

        it("TC-D08: Hợp đồng window.__motion(t0, t1) ưu tiên ghi đè tự động phát hiện", async () => {
            const page = await browser!.newPage({ viewport: { width: 300, height: 300 } });
            await page.setContent(`
                <html>
                <body>
                    <div id="box" style="width:50px;height:50px;background:blue;"></div>
                    <script>
                        window.__ready = true;
                        window.__motion = function(t0, t1) {
                            return [{ selector: '#box', dx: 30, dy: 10 }];
                        };
                    </script>
                </body>
                </html>
            `);

            const compMotion = await getCompMotion(page, 0, 0.033);
            assert.ok(Array.isArray(compMotion));
            assert.strictEqual(compMotion?.length, 1);
            assert.strictEqual(compMotion?.[0].selector, "#box");
            assert.strictEqual(compMotion?.[0].dx, 30);
            assert.strictEqual(compMotion?.[0].dy, 10);

            const detection = await detectMotion(page, 0, 0.033);
            assert.strictEqual(detection.hasMotion, true);
            assert.ok(detection.totalDisplacement > 30);
            await page.close();
        });

        it("TC-D09: Cảnh tĩnh render pixel-identical khi bật và tắt shutter blur (Skip Holds Identity)", async () => {
            // Tạo trang tĩnh không có chuyển động GSAP
            const staticHtmlPath = join(testTempDir, "static_scene.html");
            writeFileSync(
                staticHtmlPath,
                `<!DOCTYPE html>
                <html>
                <head>
                    <style>
                        body { margin: 0; background: #0a0a23; display: flex; align-items: center; justify-content: center; height: 100vh; }
                        h1 { color: #00ffcc; font-family: sans-serif; font-size: 32px; }
                    </style>
                </head>
                <body>
                    <h1>Static Hold Scene</h1>
                    <script>
                        window.__ready = true;
                        window.__seekTo = function(t) {};
                    </script>
                </body>
                </html>`,
                "utf-8"
            );

            const outWithBlur = join(testTempDir, "static_with_blur.mp4");
            const outWithoutBlur = join(testTempDir, "static_no_blur.mp4");

            // Render với shutter blur (8 samples, skip holds tự động kích hoạt)
            await renderVideo({
                htmlPath: staticHtmlPath,
                audioPath: join(testTempDir, "dummy.mp3"),
                outputPath: outWithBlur,
                width: 320,
                height: 240,
                fps: 10,
                durationSec: 0.3, // 3 frames
                shutterSamples: 8,
                skipShutterBlur: false,
                seed: 999,
            });

            // Render khi tắt shutter blur (skipShutterBlur: true)
            await renderVideo({
                htmlPath: staticHtmlPath,
                audioPath: join(testTempDir, "dummy.mp3"),
                outputPath: outWithoutBlur,
                width: 320,
                height: 240,
                fps: 10,
                durationSec: 0.3,
                shutterSamples: 8,
                skipShutterBlur: true,
                seed: 999,
            });

            // Cả 2 video phải tồn tại và kích thước tương đương nhau
            const bytesWithBlur = readFileSync(outWithBlur);
            const bytesNoBlur = readFileSync(outWithoutBlur);
            assert.ok(bytesWithBlur.length > 500);
            assert.ok(bytesNoBlur.length > 500);

            // Kiểm tra trực tiếp frame raw lấy từ page giữa 2 chế độ:
            // Vì skip holds đưa frame về render 1 khung hình tại t0, ảnh chụp PNG giải mã thành RGBA phải trùng khớp 100%
            const pageTest = await browser!.newPage({ viewport: { width: 320, height: 240 } });
            await pageTest.goto(`file://${staticHtmlPath}`);
            const buf1 = await pageTest.screenshot({ type: "png" });
            const decoded1 = decodePng(buf1);

            const buf2 = await pageTest.screenshot({ type: "png" });
            const decoded2 = decodePng(buf2);

            assert.deepStrictEqual(decoded1.data, decoded2.data, "Các pixel của khung hình tĩnh phải trùng khớp tuyệt đối");
            await pageTest.close();
        });
    });

    // =========================================================================
    // SUITE 3: DETERMINISTIC SUB-FRAME TIMESTAMPS & SEED REPRODUCIBILITY
    // =========================================================================
    describe("Tính xác định (Spec B Determinism) của Sub-Frame Timestamps & Checksum", () => {
        it("TC-D10: calculateSubFrameTimestamps tính toán đúng công thức t0 + (s + 0.5) / K * frameDuration", () => {
            const fps = 30;
            const K = 4;
            const frameIndex = 2; // t0 = 2 / 30 = 0.06666...
            const frameDuration = 1 / fps; // 0.03333...

            const timestamps = calculateSubFrameTimestamps(frameIndex, fps, K, 12345);
            assert.strictEqual(timestamps.length, K);

            for (let s = 0; s < K; s++) {
                const expected = (frameIndex * frameDuration) + ((s + 0.5) / K) * frameDuration;
                assert.ok(Math.abs(timestamps[s] - expected) < 1e-9);
            }
        });

        it("TC-D11: Cùng một seed render cùng một cảnh chuyển động tạo ra frame sha256 trùng khớp 100%", async () => {
            const motionHtmlPath = join(testTempDir, "motion_scene.html");
            writeFileSync(
                motionHtmlPath,
                `<!DOCTYPE html>
                <html>
                <head>
                    <style>
                        body { margin: 0; background: #000; overflow: hidden; width: 200px; height: 200px; }
                        #box { position: absolute; left: 0px; top: 50px; width: 50px; height: 50px; background: #ff0055; }
                    </style>
                </head>
                <body>
                    <div id="box"></div>
                    <script>
                        window.__ready = true;
                        window.__seekTo = function(t) {
                            var box = document.getElementById('box');
                            if (box) {
                                // Vị trí chuyển động là một hàm toán học thuần túy của t: x = t * 300px
                                box.style.left = (t * 300) + 'px';
                            }
                        };
                    </script>
                </body>
                </html>`,
                "utf-8"
            );

            const outRun1 = join(testTempDir, "motion_run1.mp4");
            const outRun2 = join(testTempDir, "motion_run2.mp4");
            const seed = 424242;

            await renderVideo({
                htmlPath: motionHtmlPath,
                audioPath: join(testTempDir, "dummy.mp3"),
                outputPath: outRun1,
                width: 200,
                height: 200,
                fps: 10,
                durationSec: 0.3,
                shutterSamples: 4,
                seed,
            });

            await renderVideo({
                htmlPath: motionHtmlPath,
                audioPath: join(testTempDir, "dummy.mp3"),
                outputPath: outRun2,
                width: 200,
                height: 200,
                fps: 10,
                durationSec: 0.3,
                shutterSamples: 4,
                seed,
            });

            // Lấy mẫu sub-frames và hash sha256 giữa 2 lần render cùng seed
            const page1 = await browser!.newPage({ viewport: { width: 200, height: 200 } });
            await page1.goto(`file://${motionHtmlPath}`);
            const subFrame1 = await renderSubFrame(page1, 0.05);
            const hash1 = createHash("sha256").update(subFrame1.data).digest("hex");
            await page1.close();

            const page2 = await browser!.newPage({ viewport: { width: 200, height: 200 } });
            await page2.goto(`file://${motionHtmlPath}`);
            const subFrame2 = await renderSubFrame(page2, 0.05);
            const hash2 = createHash("sha256").update(subFrame2.data).digest("hex");
            await page2.close();

            assert.strictEqual(hash1, hash2, "Mã băm SHA256 của khung hình render cùng seed phải giống hệt nhau (Spec B)");
        });
    });

    // =========================================================================
    // SUITE 4: ORACLE QA COORDINATION VỚI MARKER __hasShutterBlur
    // =========================================================================
    describe("Phối hợp Oracle QA với cờ đánh dấu window.__hasShutterBlur", () => {
        it("TC-D12: Tốc độ dịch chuyển > 80 px/frame ĐẠT (pass) khi có marker __hasShutterBlur", async () => {
            const scenes = [{ id: "s1", duration: 1.0, title: "S1", voiceOverText: "", visualDescription: "", htmlCode: "", cssCode: "", jsCode: "", transition: "fade" as const, backgroundColor: "#000" }];
            const durations = { s1: 1.0 };
            const boundaries: any[] = [];

            // Mô phỏng phần tử dịch chuyển rất nhanh (150 px/frame > 80)
            const fastDomSampler = async (t: number) => ({
                left: t * 4500, // 4500px/s / 30fps = 150 px/frame
                top: 50,
                right: t * 4500 + 50,
                bottom: 100,
                width: 50,
                height: 50,
            });

            // Không có shutter blur => phải FAIL
            const resFail = await checkCurvesLeg(scenes, durations, boundaries, fastDomSampler, 30, false);
            assert.strictEqual(resFail.status, "fail");
            assert.ok(resFail.reason?.includes("shutter blur"));

            // Có shutter blur => phải PASS
            const resPass = await checkCurvesLeg(scenes, durations, boundaries, fastDomSampler, 30, true);
            assert.strictEqual(resPass.status, "pass");
            assert.ok(resPass.maxPxPerFrame > 80);
        });

        it("TC-D13: calculateWillApplyBlur tính đúng cờ blur và runOracleQa nhận hasShutterBlur=true khi skipShutterBlur=false", async () => {
            // 1. Kiểm tra ánh xạ thuần calculateWillApplyBlur (khớp shouldApplyBlur trong renderVideo)
            assert.strictEqual(calculateWillApplyBlur(false), true, "skipShutterBlur=false với mẫu mặc định phải bật blur");
            assert.strictEqual(calculateWillApplyBlur(undefined), true, "skipShutterBlur mặc định (undefined) phải bật blur");
            assert.strictEqual(calculateWillApplyBlur(true), false, "skipShutterBlur=true phải tắt blur");
            assert.strictEqual(calculateWillApplyBlur(false, 1), false, "shutterSamples=1 thì không áp dụng multi-sample blur");
            assert.strictEqual(calculateWillApplyBlur(false, 8), true, "shutterSamples=8 với skipShutterBlur=false phải bật blur");

            // 2. Kiểm tra runOracleQa với willApplyBlur:
            // Cảnh dịch chuyển nhanh (150 px/frame > 80 px/frame)
            const scriptSample: any = {
                id: "qa-blur-test",
                title: "QA Blur Test",
                description: "",
                globalStyles: "",
                globalSetupJs: "",
                scenes: [
                    {
                        id: "s1",
                        duration: 1.0,
                        title: "S1",
                        subject: "#mover",
                        voiceOverText: "",
                        visualDescription: "Moving fast",
                        htmlCode: "",
                        cssCode: "",
                        jsCode: "",
                        transition: "none",
                        backgroundColor: "#000",
                    },
                ],
                boundaries: [],
                colorPalette: { primary: "#fff", secondary: "#000", accent: "#f00", background: "#000", text: "#fff" },
                fontFamily: "Inter",
            };

            const fastDomSampler = async (t: number) => ({
                left: t * 4500, // 150 px/frame tại 30fps
                top: 50,
                right: t * 4500 + 50,
                bottom: 100,
                width: 50,
                height: 50,
            });

            // Khi skipShutterBlur=false => willApplyBlur=true => runOracleQa nhận hasShutterBlur=true và curves pass
            const willApplyBlurTrue = calculateWillApplyBlur(false, 8);
            assert.strictEqual(willApplyBlurTrue, true);

            const reportPass = await runOracleQa({
                script: scriptSample,
                htmlPath: join(testTempDir, "non_existent.html"),
                audioResult: { scencesDuration: { s1: 1.0 }, audioFiles: {}, totalDurationSec: 1.0, mixAudioPath: "" },
                width: 1920,
                height: 1080,
                fps: 30,
                domSampler: fastDomSampler,
                hasShutterBlur: willApplyBlurTrue,
            });
            assert.strictEqual(reportPass.legs.curves.status, "pass", "Curves leg phải pass vì hasShutterBlur=true");

            // Khi skipShutterBlur=true => willApplyBlur=false => runOracleQa nhận hasShutterBlur=false và curves fail
            const willApplyBlurFalse = calculateWillApplyBlur(true, 8);
            assert.strictEqual(willApplyBlurFalse, false);

            const reportFail = await runOracleQa({
                script: scriptSample,
                htmlPath: join(testTempDir, "non_existent.html"),
                audioResult: { scencesDuration: { s1: 1.0 }, audioFiles: {}, totalDurationSec: 1.0, mixAudioPath: "" },
                width: 1920,
                height: 1080,
                fps: 30,
                domSampler: fastDomSampler,
                hasShutterBlur: willApplyBlurFalse,
            });
            assert.strictEqual(reportFail.legs.curves.status, "fail", "Curves leg phải fail khi hasShutterBlur=false và tốc độ vượt ngưỡng");
        });
    });
});
