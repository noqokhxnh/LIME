import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { launchPreviewBrowser, seekToTimestamp, setupBrowserDiagnostics, dumpDiagnosticSnapshot } from "./preview.js";
import { withRetry, isAbortError } from "./retry.js";
import { WatermarkConfig } from "../llm/schema.js";
import { buildWatermarkFilter } from "./watermarkFilter.js";
import { resolveLogoPath } from "../security/uploadGuard.js";
import { decodePng } from "./pngDecoder.js";
import { LinearLightAccumulator } from "./linearLight.js";
import { calculateSubFrameTimestamps } from "./shutterRenderer.js";
import { detectMotion, type DOMBox } from "./motion.js";

export interface RenderVideoOptions {
    htmlPath: string;
    audioPath: string;
    outputPath: string;
    width: number;
    height: number;
    fps?: number;
    durationSec: number;
    onProgress?: (msg: string, percent?: number) => void;
    /**
     * Cấu hình logo / watermark cần đóng dấu lên video.
     * Nếu không truyền vào (undefined), video xuất ra sẽ không có logo.
     */
    watermark?: WatermarkConfig;
    /**
     * Số lượng mẫu sub-frame (K) cho hiệu ứng shutter motion blur (Spec D, mặc định 8)
     */
    shutterSamples?: number;
    /**
     * Tắt tính năng shutter motion blur nếu true (Spec D)
     */
    skipShutterBlur?: boolean;
    /**
     * Seed xác định cho pipeline (Spec B)
     */
    seed?: number;
}

/**
 * Render frames from GSAP animated HTML page using Playwright Chromium
 * and encode/mux into an MP4 video using ffmpeg image2pipe.
 */
export async function renderVideo(options: RenderVideoOptions): Promise<string> {
    const {
        htmlPath,
        audioPath,
        outputPath,
        width,
        height,
        fps = 30,
        durationSec,
        onProgress,
        watermark,
        shutterSamples: rawShutterSamples,
        skipShutterBlur = false,
        seed = 0,
    } = options;

    const shutterSamples = Math.max(1, Math.floor(rawShutterSamples ?? 8));
    const shouldApplyBlur = !skipShutterBlur && shutterSamples > 1;
    const totalFrames = Math.max(1, Math.floor(durationSec * fps));
    onProgress?.(`Starting video render (${totalFrames} frames @ ${fps}fps)...`, 0);

    return await withRetry(
        async (attempt) => {
            if (existsSync(outputPath)) {
                rmSync(outputPath, { force: true });
            }

            const browser = await launchPreviewBrowser();
            try {
                const context = await browser.newContext({
                    viewport: { width, height },
                    deviceScaleFactor: 1,
                });
                const page = await context.newPage();

                setupBrowserDiagnostics(page, "Renderer");

                const fileUrl = pathToFileURL(resolve(htmlPath)).href;
                process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = "1";
                try {
                    await page.goto(fileUrl, { waitUntil: "domcontentloaded" });
                    await page.waitForFunction(
                        () => (window as unknown as { __ready?: boolean }).__ready === true,
                        undefined,
                        { timeout: 15000 }
                    );
                } catch (err: any) {
                    const diagInfo = await dumpDiagnosticSnapshot(page, htmlPath, "Renderer/Load");
                    err.message = `${err.message}\n${diagInfo}`;
                    throw err;
                }

                // Pre-wait web fonts once with a safe fallback
                await page.evaluate(async () => {
                    if (document.fonts && document.fonts.ready) {
                        try {
                            await Promise.race([
                                document.fonts.ready,
                                new Promise((r) => setTimeout(r, 4000)),
                            ]);
                        } catch (e) { }
                    }
                });

                const hasAudio = existsSync(audioPath);

                // Chuẩn hoá đường dẫn logo: chỉ chấp nhận file nằm trong
                // thư mục tmp/uploads/logos/ (chống LFI/Path Traversal —
                // chặn đọc file tùy ý trên server và thiết bị đặc biệt
                // như /dev/zero có thể treo worker render).
                let logoPath: string | null = null;
                if (watermark?.logoPath) {
                    logoPath = resolveLogoPath(watermark.logoPath);
                    if (!logoPath) {
                        console.warn(
                            `[Renderer] Watermark logo không tìm thấy hoặc nằm ngoài thư mục cho phép: "${watermark.logoPath}". Bỏ qua gắn watermark.`
                        );
                    }
                }
                const hasWatermark = !!logoPath;

                // ── Bước 1: Các input đầu vào ───────────────────────────────
                // Input 0: luồng raw video RGBA từ Playwright / Linear Light accumulator (pipe stdin)
                const ffmpegArgs = [
                    "-y",
                    "-f", "rawvideo",
                    "-pix_fmt", "rgba",
                    "-s", `${width}x${height}`,
                    "-r", String(fps),
                    "-i", "-",
                ];

                // Input 1 (tùy chọn): file audio nếu có
                if (hasAudio) {
                    ffmpegArgs.push("-i", audioPath);
                }

                // Input 2 (tùy chọn): file ảnh logo nếu có watermark
                // Thứ tự thêm audio trước logo để nhãn luồng nhất quán:
                //   0:v = video, 1:v = audio (nếu có), 2:v = logo (nếu có)
                if (hasWatermark) {
                    ffmpegArgs.push("-i", logoPath!);
                }

                // ── Bước 2: Bộ lọc ghép logo (-filter_complex) ──────────────
                if (hasWatermark) {
                    // Tính nhãn luồng video nền:
                    //   - Nếu có audio: video ở input 0 → nhãn "0:v"
                    //   - Logo luôn là input cuối cùng:
                    //     Nếu có audio → logo ở input 2 → nhãn "2:v"
                    //     Nếu không audio → logo ở input 1 → nhãn "1:v"
                    const logoLabel = hasAudio ? "2:v" : "1:v";

                    // Gọi hàm buildWatermarkFilter từ Bước 2 để tạo chuỗi filter
                    const { filterComplex, outputLabel } = buildWatermarkFilter(
                        watermark!,
                        width,
                        height,
                        "0:v",      // nhãn luồng video nền (luôn là input đầu tiên)
                        logoLabel,  // nhãn luồng logo (input cuối)
                    );

                    // Chèn bộ lọc ghép hình vào danh sách tham số FFmpeg
                    ffmpegArgs.push("-filter_complex", filterComplex);

                    // Chỉ định luồng hình ảnh đầu ra sau khi đã dán logo là [outv]
                    ffmpegArgs.push("-map", outputLabel);

                    // Nếu có audio thì map thêm luồng âm thanh
                    if (hasAudio) {
                        ffmpegArgs.push("-map", "1:a");
                    }
                }

                // ── Bước 3: Codec & chất lượng đầu ra ──────────────────────
                ffmpegArgs.push(
                    "-c:v", "libx264",
                    "-pix_fmt", "yuv420p",
                    "-preset", "veryfast",
                    "-crf", "22"
                );

                if (hasAudio) {
                    ffmpegArgs.push("-c:a", "aac", "-b:a", "192k", "-shortest");
                }

                ffmpegArgs.push(
                    "-t", String(durationSec),
                    "-movflags", "+faststart",
                    outputPath
                );

                const ff = spawn("ffmpeg", ffmpegArgs);
                let errorOutput = "";
                ff.stderr.on("data", (data) => {
                    errorOutput += data.toString();
                });

                // Xử lý lỗi EPIPE trên stdin khi FFmpeg thoát sớm để chống crash tiến trình Node
                let stdinError: any = null;
                ff.stdin.on("error", (err: any) => {
                    stdinError = err;
                    if (err.code !== 'EPIPE' && err.code !== 'ERR_STREAM_DESTROYED') {
                        console.warn("[Renderer] ff.stdin error:", err);
                    }
                });

                // Đánh dấu marker __hasShutterBlur trên page cho Oracle QA
                if (shouldApplyBlur) {
                    await page.evaluate(() => {
                        (window as any).__hasShutterBlur = true;
                    });
                }

                const accumulator = shouldApplyBlur ? new LinearLightAccumulator(width, height) : null;
                const reportStep = Math.max(1, Math.floor(totalFrames / 10));
                let lastFrame: Uint8Array | null = null;
                let cachedBoxes0: Record<string, DOMBox | null> | undefined = undefined;

                for (let i = 0; i < totalFrames; i++) {
                    const t0 = i / fps;
                    const t1 = (i + 1) / fps;

                    let frameToPipe: Uint8Array;

                    if (!shouldApplyBlur) {
                        // Khi tắt shutter blur: render 1 khung hình tại t0
                        try {
                            await seekToTimestamp(page, t0);
                            const buf = await page.screenshot({
                                type: "png",
                                animations: "disabled",
                                timeout: 8000,
                            });
                            const decoded = decodePng(buf);
                            frameToPipe = decoded.data;
                            lastFrame = frameToPipe;
                        } catch (err: any) {
                            if (lastFrame) {
                                frameToPipe = lastFrame;
                            } else {
                                const diagInfo = await dumpDiagnosticSnapshot(page, htmlPath, `Renderer/Seek (${t0}s)`);
                                err.message = `${err.message}\n${diagInfo}`;
                                throw err;
                            }
                        }
                    } else {
                        // Khi bật shutter blur: phát hiện chuyển động trong [t0, t1]
                        let motion;
                        try {
                            motion = await detectMotion(page, t0, t1, { cachedBoxes0 });
                            cachedBoxes0 = motion.boxes1;
                        } catch {
                            motion = { hasMotion: true, maxDisplacement: 999, totalDisplacement: 999, vectors: [] };
                        }

                        if (!motion.hasMotion) {
                            // Skip holds: tổng độ dịch chuyển < 1px -> render 1 frame tĩnh tiết kiệm compute
                            try {
                                await seekToTimestamp(page, t0);
                                const buf = await page.screenshot({
                                    type: "png",
                                    animations: "disabled",
                                    timeout: 8000,
                                });
                                const decoded = decodePng(buf);
                                frameToPipe = decoded.data;
                                lastFrame = frameToPipe;
                            } catch (err: any) {
                                if (lastFrame) {
                                    frameToPipe = lastFrame;
                                } else {
                                    const diagInfo = await dumpDiagnosticSnapshot(page, htmlPath, `Renderer/Seek (${t0}s)`);
                                    err.message = `${err.message}\n${diagInfo}`;
                                    throw err;
                                }
                            }
                        } else {
                            // Có chuyển động: lấy mẫu K sub-frames và pha trộn trong Linear Light
                            accumulator!.reset();
                            const subTimes = calculateSubFrameTimestamps(i, fps, shutterSamples, seed);

                            for (const subT of subTimes) {
                                let subFrameData: Uint8Array;
                                try {
                                    await seekToTimestamp(page, subT);
                                    const buf = await page.screenshot({
                                        type: "png",
                                        animations: "disabled",
                                        timeout: 8000,
                                    });
                                    const decoded = decodePng(buf);
                                    subFrameData = decoded.data;
                                    lastFrame = subFrameData;
                                } catch (err: any) {
                                    if (lastFrame) {
                                        subFrameData = lastFrame;
                                    } else {
                                        const diagInfo = await dumpDiagnosticSnapshot(page, htmlPath, `Renderer/SubFrame (${subT}s)`);
                                        err.message = `${err.message}\n${diagInfo}`;
                                        throw err;
                                    }
                                }
                                accumulator!.addFrame(subFrameData);
                            }

                            frameToPipe = accumulator!.toRgba();
                        }
                    }

                    if (ff.stdin.writable && !ff.stdin.destroyed) {
                        const canWrite = ff.stdin.write(
                            Buffer.from(frameToPipe.buffer, frameToPipe.byteOffset, frameToPipe.byteLength)
                        );
                        if (!canWrite) {
                            await new Promise((r) => ff.stdin.once("drain", r));
                        }
                    } else {
                        // FFmpeg đã đóng stdin hoặc thoát sớm, ngừng ghi khung hình và chờ sự kiện close
                        break;
                    }

                    if (i % reportStep === 0 || i === totalFrames - 1) {
                        const pct = Math.round(((i + 1) / totalFrames) * 100);
                        onProgress?.(`Rendering frames: ${i + 1}/${totalFrames} (${pct}%)`, pct);
                    }
                }
                if (ff.stdin.writable && !ff.stdin.destroyed) {
                    ff.stdin.end();
                }

                await new Promise<void>((res, rej) => {
                    ff.on("close", (code) => {
                        if (code === 0) {
                            res();
                        } else {
                            console.error("[Renderer] FFMPEG FULL ERROR OUTPUT:\n", errorOutput);
                            rej(new Error(`ffmpeg render failed with code ${code}: ${errorOutput.slice(-500)}`));
                        }
                    });
                    ff.on("error", rej);
                });

                onProgress?.("Video rendering and muxing completed", 100);
                return outputPath;
            } finally {
                await browser.close().catch(() => { });
            }
        },
        {
            maxAttempts: 2,
            shouldRetry: (err) => !isAbortError(err),
            onRetry: (err, attempt, delayMs) => {
                onProgress?.(`[Render] Video render lỗi (${err.message}). Đang thử lại lần ${attempt + 1}/2 sau ${delayMs}ms...`);
            },
        }
    );
}
