import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import type { Page } from "playwright";
import { launchPreviewBrowser, seekToTimestamp, setupBrowserDiagnostics, dumpDiagnosticSnapshot } from "./preview.js";
import { withRetry, isAbortError } from "./retry.js";
import { WatermarkConfig } from "../llm/schema.js";
import { buildWatermarkFilter } from "./watermarkFilter.js";
import { resolveLogoPath } from "../security/uploadGuard.js";
import { decodePng } from "./pngDecoder.js";
import { LinearLightAccumulator } from "./linearLight.js";
import { calculateSubFrameTimestamps } from "./shutterRenderer.js";
import { detectMotion, type DOMBox } from "./motion.js";
import { getConfig } from "../config.js";

export interface RenderVideoOptions {
    htmlPath: string;
    audioPath: string;
    outputPath: string;
    width: number;
    height: number;
    fps?: number;
    durationSec: number;
    concurrency?: number;
    signal?: AbortSignal;
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

export interface RenderChunk {
    index: number;
    startFrame: number;
    endFrame: number; // exclusive
    frameCount: number;
    startTimeSec: number;
    endTimeSec: number;
    chunkOutputPath: string;
}

/**
 * Chia timeline video thành các chunk song song độc lập.
 *
 * @param totalFrames Tổng số frame của video (>= 1)
 * @param fps Tốc độ khung hình (frame rate)
 * @param maxConcurrency Số lượng chunk song song tối đa
 * @param tempDir Thư mục chứa các file video chunk tạm
 * @param minFramesPerChunk Số frame tối thiểu trong 1 chunk để tránh phân mảnh quá mức (mặc định: 15)
 */
export function calculateRenderChunks(
    totalFrames: number,
    fps: number,
    maxConcurrency: number,
    tempDir: string,
    minFramesPerChunk = 15
): RenderChunk[] {
    const safeTotalFrames = Math.max(1, Math.floor(totalFrames));
    const safeFps = Math.max(1, fps);
    const safeMaxConcurrency = Math.max(1, Math.floor(maxConcurrency));

    // Tự động giới hạn số chunk dựa trên số frame tối thiểu mỗi chunk
    const concurrency = Math.max(
        1,
        Math.min(safeMaxConcurrency, Math.ceil(safeTotalFrames / Math.max(1, minFramesPerChunk)))
    );

    const baseFrames = Math.floor(safeTotalFrames / concurrency);
    const remainder = safeTotalFrames % concurrency;

    const chunks: RenderChunk[] = [];
    let currentStart = 0;

    for (let i = 0; i < concurrency; i++) {
        const count = baseFrames + (i < remainder ? 1 : 0);
        const end = currentStart + count;
        chunks.push({
            index: i,
            startFrame: currentStart,
            endFrame: end,
            frameCount: count,
            startTimeSec: currentStart / safeFps,
            endTimeSec: end / safeFps,
            chunkOutputPath: resolve(tempDir, `chunk_${i}.mp4`),
        });
        currentStart = end;
    }

    return chunks;
}

interface FrameRenderContext {
    cachedBoxes0?: Record<string, DOMBox | null>;
    lastFrame: Uint8Array | null;
}

async function renderFrameData(
    page: Page,
    i: number,
    fps: number,
    shutterSamples: number,
    shouldApplyBlur: boolean,
    seed: number,
    accumulator: LinearLightAccumulator | null,
    frameCtx: FrameRenderContext,
    htmlPath: string,
    diagnosticLabel: string
): Promise<Uint8Array> {
    const t0 = i / fps;
    const t1 = (i + 1) / fps;

    let frameToPipe: Uint8Array;

    if (!shouldApplyBlur) {
        try {
            await seekToTimestamp(page, t0);
            const buf = await page.screenshot({
                type: "png",
                animations: "disabled",
                timeout: 8000,
            });
            const decoded = decodePng(buf);
            frameToPipe = decoded.data;
            frameCtx.lastFrame = frameToPipe;
        } catch (err: any) {
            if (frameCtx.lastFrame) {
                frameToPipe = frameCtx.lastFrame;
            } else {
                const diagInfo = await dumpDiagnosticSnapshot(page, htmlPath, `Renderer/Seek${diagnosticLabel} (${t0}s)`);
                err.message = `${err.message}\n${diagInfo}`;
                throw err;
            }
        }
    } else {
        let motion;
        try {
            motion = await detectMotion(page, t0, t1, { cachedBoxes0: frameCtx.cachedBoxes0 });
            frameCtx.cachedBoxes0 = motion.boxes1;
        } catch {
            motion = { hasMotion: true, maxDisplacement: 999, totalDisplacement: 999, vectors: [] };
        }

        if (!motion.hasMotion) {
            try {
                await seekToTimestamp(page, t0);
                const buf = await page.screenshot({
                    type: "png",
                    animations: "disabled",
                    timeout: 8000,
                });
                const decoded = decodePng(buf);
                frameToPipe = decoded.data;
                frameCtx.lastFrame = frameToPipe;
            } catch (err: any) {
                if (frameCtx.lastFrame) {
                    frameToPipe = frameCtx.lastFrame;
                } else {
                    const diagInfo = await dumpDiagnosticSnapshot(page, htmlPath, `Renderer/Seek${diagnosticLabel} (${t0}s)`);
                    err.message = `${err.message}\n${diagInfo}`;
                    throw err;
                }
            }
        } else {
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
                    frameCtx.lastFrame = subFrameData;
                } catch (err: any) {
                    if (frameCtx.lastFrame) {
                        subFrameData = frameCtx.lastFrame;
                    } else {
                        const diagInfo = await dumpDiagnosticSnapshot(page, htmlPath, `Renderer/SubFrame${diagnosticLabel} (${subT}s)`);
                        err.message = `${err.message}\n${diagInfo}`;
                        throw err;
                    }
                }
                accumulator!.addFrame(subFrameData);
            }

            frameToPipe = accumulator!.toRgba();
        }
    }

    return frameToPipe;
}

async function waitForDrain(ff: ChildProcess, errorOutput: string, getError: () => Error | null): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        const onDrain = () => {
            cleanup();
            resolve();
        };
        const onClose = () => {
            cleanup();
            reject(getError() || new Error(`ffmpeg closed before drain: ${errorOutput.slice(-500)}`));
        };
        const onError = (err: Error) => {
            cleanup();
            reject(err);
        };
        const cleanup = () => {
            ff.stdin?.off("drain", onDrain);
            ff.off("close", onClose);
            ff.off("error", onError);
        };
        ff.stdin?.once("drain", onDrain);
        ff.once("close", onClose);
        ff.once("error", onError);
    });
}

/**
 * Render frames from GSAP animated HTML page using Playwright Chromium
 * and encode/mux into an MP4 video using ffmpeg image2pipe with parallel chunking.
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
        concurrency: inputConcurrency,
        signal,
        onProgress,
        watermark,
        shutterSamples: rawShutterSamples,
        skipShutterBlur = false,
        seed = 0,
    } = options;

    if (signal?.aborted) {
        throw new DOMException("Operation aborted", "AbortError");
    }

    const shutterSamples = Math.max(1, Math.floor(rawShutterSamples ?? 8));
    const shouldApplyBlur = !skipShutterBlur && shutterSamples > 1;
    const totalFrames = Math.max(1, Math.floor(durationSec * fps));
    const targetConcurrency = inputConcurrency ?? getConfig().RENDER_MAX_CONCURRENCY ?? 4;
    const tempDir = dirname(resolve(outputPath));
    const chunks = calculateRenderChunks(totalFrames, fps, targetConcurrency, tempDir);

    onProgress?.(
        `Starting video render (${totalFrames} frames @ ${fps}fps, ${chunks.length} ${chunks.length > 1 ? "parallel chunks" : "worker"})...`,
        0
    );

    return await withRetry(
        async (attempt) => {
            if (signal?.aborted) {
                throw new DOMException("Operation aborted", "AbortError");
            }

            if (existsSync(outputPath)) {
                rmSync(outputPath, { force: true });
            }

            const activeProcesses = new Set<ChildProcess>();
            const abortController = new AbortController();

            const onSignalAbort = () => {
                abortController.abort();
                for (const p of activeProcesses) {
                    try {
                        p.kill("SIGKILL");
                    } catch {}
                }
            };

            if (signal) {
                signal.addEventListener("abort", onSignalAbort, { once: true });
            }

            const chunkFilesToCleanup: string[] = [];
            const concatListPath = resolve(tempDir, `concat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.txt`);

            const browser = await launchPreviewBrowser();
            const fileUrl = pathToFileURL(resolve(htmlPath)).href;
            process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = "1";

            try {
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

                if (chunks.length === 1) {
                    // Single chunk path
                    const context = await browser.newContext({
                        viewport: { width, height },
                        deviceScaleFactor: 1,
                    });

                    try {
                        const page = await context.newPage();
                        setupBrowserDiagnostics(page, "Renderer");

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
                                } catch (e) {}
                            }
                        });

                        if (abortController.signal.aborted || signal?.aborted) {
                            throw new DOMException("Operation aborted", "AbortError");
                        }

                        const hasAudio = existsSync(audioPath);
                        const ffmpegArgs = [
                            "-y",
                            "-f", "rawvideo",
                            "-pix_fmt", "rgba",
                            "-s", `${width}x${height}`,
                            "-r", String(fps),
                            "-i", "-",
                        ];

                        if (hasAudio) {
                            ffmpegArgs.push("-i", audioPath);
                        }

                        if (hasWatermark) {
                            ffmpegArgs.push("-i", logoPath!);
                        }

                        if (hasWatermark) {
                            const logoLabel = hasAudio ? "2:v" : "1:v";
                            const { filterComplex, outputLabel } = buildWatermarkFilter(
                                watermark!,
                                width,
                                height,
                                "0:v",
                                logoLabel
                            );
                            ffmpegArgs.push("-filter_complex", filterComplex, "-map", outputLabel);
                            if (hasAudio) {
                                ffmpegArgs.push("-map", "1:a");
                            }
                        }

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
                        activeProcesses.add(ff);
                        let errorOutput = "";
                        let ffError: Error | null = null;
                        let ffClosed = false;

                        ff.stderr.on("data", (data) => {
                            errorOutput += data.toString();
                        });
                        ff.on("error", (err) => {
                            ffError = err;
                        });
                        ff.on("close", (code) => {
                            ffClosed = true;
                            if (code !== 0 && !ffError) {
                                ffError = new Error(`ffmpeg render failed with code ${code}: ${errorOutput.slice(-500)}`);
                            }
                        });

                        ff.stdin.on("error", (err: any) => {
                            if (err.code !== "EPIPE" && err.code !== "ERR_STREAM_DESTROYED") {
                                console.warn("[Renderer] ff.stdin error:", err);
                            }
                        });

                        if (shouldApplyBlur) {
                            await page.evaluate(() => {
                                (window as any).__hasShutterBlur = true;
                            });
                        }

                        const accumulator = shouldApplyBlur ? new LinearLightAccumulator(width, height) : null;
                        const reportStep = Math.max(1, Math.floor(totalFrames / 10));
                        const frameCtx: FrameRenderContext = { cachedBoxes0: undefined, lastFrame: null };

                        for (let i = 0; i < totalFrames; i++) {
                            if (abortController.signal.aborted || signal?.aborted) {
                                if (ff.stdin.writable && !ff.stdin.destroyed) ff.stdin.end();
                                throw new DOMException("Operation aborted", "AbortError");
                            }
                            if (ffError) throw ffError;
                            if (ffClosed) throw new Error(`ffmpeg closed unexpectedly: ${errorOutput.slice(-500)}`);

                            const frameToPipe = await renderFrameData(
                                page,
                                i,
                                fps,
                                shutterSamples,
                                shouldApplyBlur,
                                seed,
                                accumulator,
                                frameCtx,
                                htmlPath,
                                ""
                            );

                            if (ff.stdin.writable && !ff.stdin.destroyed) {
                                const canWrite = ff.stdin.write(
                                    Buffer.from(frameToPipe.buffer, frameToPipe.byteOffset, frameToPipe.byteLength)
                                );
                                if (!canWrite) {
                                    await waitForDrain(ff, errorOutput, () => ffError);
                                }
                            } else {
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
                                activeProcesses.delete(ff);
                                if (code === 0) {
                                    res();
                                } else {
                                    rej(new Error(`ffmpeg render failed with code ${code}: ${errorOutput.slice(-500)}`));
                                }
                            });
                            ff.on("error", (err) => {
                                activeProcesses.delete(ff);
                                rej(err);
                            });
                        });
                    } finally {
                        await context.close().catch(() => {});
                    }
                } else {
                    // Multi-chunk parallel rendering path
                    let completedFrames = 0;
                    const reportStep = Math.max(1, Math.floor(totalFrames / 20));

                    const renderChunkWorker = async (chunk: RenderChunk) => {
                        if (abortController.signal.aborted || signal?.aborted) {
                            throw new DOMException("Operation aborted", "AbortError");
                        }

                        chunkFilesToCleanup.push(chunk.chunkOutputPath);
                        if (existsSync(chunk.chunkOutputPath)) {
                            rmSync(chunk.chunkOutputPath, { force: true });
                        }

                        const context = await browser.newContext({
                            viewport: { width, height },
                            deviceScaleFactor: 1,
                        });

                        try {
                            const page = await context.newPage();
                            setupBrowserDiagnostics(page, `Renderer-Chunk-${chunk.index}`);

                            try {
                                await page.goto(fileUrl, { waitUntil: "domcontentloaded" });
                                await page.waitForFunction(
                                    () => (window as unknown as { __ready?: boolean }).__ready === true,
                                    undefined,
                                    { timeout: 15000 }
                                );
                            } catch (err: any) {
                                const diagInfo = await dumpDiagnosticSnapshot(page, htmlPath, `Renderer/Load/Chunk-${chunk.index}`);
                                err.message = `${err.message}\n${diagInfo}`;
                                throw err;
                            }

                            // Wait web fonts
                            await page.evaluate(async () => {
                                if (document.fonts && document.fonts.ready) {
                                    try {
                                        await Promise.race([
                                            document.fonts.ready,
                                            new Promise((r) => setTimeout(r, 4000)),
                                        ]);
                                    } catch (e) {}
                                }
                            });

                            if (abortController.signal.aborted || signal?.aborted) {
                                throw new DOMException("Operation aborted", "AbortError");
                            }

                            const ffmpegArgs = [
                                "-y",
                                "-f", "rawvideo",
                                "-pix_fmt", "rgba",
                                "-s", `${width}x${height}`,
                                "-r", String(fps),
                                "-i", "-",
                            ];

                            if (hasWatermark) {
                                ffmpegArgs.push("-i", logoPath!);
                                const { filterComplex, outputLabel } = buildWatermarkFilter(
                                    watermark!,
                                    width,
                                    height,
                                    "0:v",
                                    "1:v"
                                );
                                ffmpegArgs.push("-filter_complex", filterComplex, "-map", outputLabel);
                            }

                            ffmpegArgs.push(
                                "-c:v", "libx264",
                                "-pix_fmt", "yuv420p",
                                "-preset", "veryfast",
                                "-crf", "22",
                                "-an",
                                chunk.chunkOutputPath
                            );

                            const ff = spawn("ffmpeg", ffmpegArgs);
                            activeProcesses.add(ff);
                            let errorOutput = "";
                            let ffError: Error | null = null;
                            let ffClosed = false;

                            ff.stderr.on("data", (data) => {
                                errorOutput += data.toString();
                            });
                            ff.on("error", (err) => {
                                ffError = err;
                            });
                            ff.on("close", (code) => {
                                ffClosed = true;
                                if (code !== 0 && !ffError) {
                                    ffError = new Error(`ffmpeg chunk_${chunk.index} failed with code ${code}: ${errorOutput.slice(-500)}`);
                                }
                            });

                            ff.stdin.on("error", (err: any) => {
                                if (err.code !== "EPIPE" && err.code !== "ERR_STREAM_DESTROYED") {
                                    console.warn(`[Renderer] ff chunk_${chunk.index} stdin error:`, err);
                                }
                            });

                            if (shouldApplyBlur) {
                                await page.evaluate(() => {
                                    (window as any).__hasShutterBlur = true;
                                });
                            }

                            const accumulator = shouldApplyBlur ? new LinearLightAccumulator(width, height) : null;
                            const frameCtx: FrameRenderContext = { cachedBoxes0: undefined, lastFrame: null };

                            for (let i = chunk.startFrame; i < chunk.endFrame; i++) {
                                if (abortController.signal.aborted || signal?.aborted) {
                                    if (ff.stdin.writable && !ff.stdin.destroyed) ff.stdin.end();
                                    throw new DOMException("Operation aborted", "AbortError");
                                }
                                if (ffError) throw ffError;
                                if (ffClosed) throw new Error(`ffmpeg closed unexpectedly: ${errorOutput.slice(-500)}`);

                                const frameToPipe = await renderFrameData(
                                    page,
                                    i,
                                    fps,
                                    shutterSamples,
                                    shouldApplyBlur,
                                    seed,
                                    accumulator,
                                    frameCtx,
                                    htmlPath,
                                    `/Chunk-${chunk.index}`
                                );

                                if (ff.stdin.writable && !ff.stdin.destroyed) {
                                    const canWrite = ff.stdin.write(
                                        Buffer.from(frameToPipe.buffer, frameToPipe.byteOffset, frameToPipe.byteLength)
                                    );
                                    if (!canWrite) {
                                        await waitForDrain(ff, errorOutput, () => ffError);
                                    }
                                } else {
                                    break;
                                }

                                completedFrames++;
                                if (completedFrames % reportStep === 0 || completedFrames === totalFrames) {
                                    const pct = Math.round((completedFrames / totalFrames) * 95);
                                    onProgress?.(`Rendering frames: ${completedFrames}/${totalFrames} (${pct}%)`, pct);
                                }
                            }

                            if (ff.stdin.writable && !ff.stdin.destroyed) {
                                ff.stdin.end();
                            }

                            await new Promise<void>((res, rej) => {
                                ff.on("close", (code) => {
                                    activeProcesses.delete(ff);
                                    if (code === 0) {
                                        res();
                                    } else {
                                        rej(new Error(`ffmpeg chunk_${chunk.index} failed with code ${code}: ${errorOutput.slice(-500)}`));
                                    }
                                });
                                ff.on("error", (err) => {
                                    activeProcesses.delete(ff);
                                    rej(err);
                                });
                            });
                        } finally {
                            await context.close().catch(() => {});
                        }
                    };

                    await Promise.all(
                        chunks.map((chunk) =>
                            renderChunkWorker(chunk).catch((err) => {
                                abortController.abort();
                                for (const p of activeProcesses) {
                                    try {
                                        p.kill("SIGKILL");
                                    } catch {}
                                }
                                throw err;
                            })
                        )
                    );

                    if (abortController.signal.aborted || signal?.aborted) {
                        throw new DOMException("Operation aborted", "AbortError");
                    }

                    // Fast Concat Demuxer
                    onProgress?.("Fast concatenating video chunks...", 96);

                    const lines = chunks
                        .map((c) => `file '${resolve(c.chunkOutputPath).replace(/'/g, "'\\''")}'`)
                        .join("\n");
                    writeFileSync(concatListPath, lines, "utf-8");

                    const hasAudio = existsSync(audioPath);
                    const concatArgs = [
                        "-y",
                        "-f", "concat",
                        "-safe", "0",
                        "-i", concatListPath,
                    ];

                    if (hasAudio) {
                        concatArgs.push("-i", audioPath);
                    }

                    concatArgs.push("-c:v", "copy");

                    if (hasAudio) {
                        concatArgs.push("-c:a", "aac", "-b:a", "192k", "-shortest");
                    }

                    concatArgs.push(
                        "-movflags", "+faststart",
                        outputPath
                    );

                    const ffConcat = spawn("ffmpeg", concatArgs);
                    activeProcesses.add(ffConcat);
                    let concatError = "";
                    ffConcat.stderr.on("data", (data) => {
                        concatError += data.toString();
                    });

                    await new Promise<void>((res, rej) => {
                        ffConcat.on("close", (code) => {
                            activeProcesses.delete(ffConcat);
                            if (code === 0) {
                                res();
                            } else {
                                rej(new Error(`ffmpeg fast concat failed with code ${code}: ${concatError.slice(-500)}`));
                            }
                        });
                        ffConcat.on("error", (err) => {
                            activeProcesses.delete(ffConcat);
                            rej(err);
                        });
                    });
                }

                onProgress?.("Video rendering and muxing completed", 100);
                return outputPath;
            } finally {
                if (signal) {
                    signal.removeEventListener("abort", onSignalAbort);
                }
                for (const p of activeProcesses) {
                    try {
                        p.kill("SIGKILL");
                    } catch {}
                }
                await browser.close().catch(() => {});

                if (existsSync(concatListPath)) {
                    rmSync(concatListPath, { force: true });
                }
                for (const f of chunkFilesToCleanup) {
                    if (existsSync(f)) {
                        rmSync(f, { force: true });
                    }
                }
            }
        },
        {
            maxAttempts: 2,
            signal,
            shouldRetry: (err) => !isAbortError(err),
            onRetry: (err, attempt, delayMs) => {
                onProgress?.(`[Render] Video render lỗi (${err.message}). Đang thử lại lần ${attempt + 1}/2 sau ${delayMs}ms...`);
            },
        }
    );
}

