import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { launchPreviewBrowser, seekToTimestamp, setupBrowserDiagnostics, dumpDiagnosticSnapshot } from "./preview.js";
import { withRetry, isAbortError } from "./retry.js";
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
    } = options;

    if (signal?.aborted) {
        throw new DOMException("Operation aborted", "AbortError");
    }

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
                            "-f", "image2pipe",
                            "-vcodec", "mjpeg",
                            "-r", String(fps),
                            "-i", "-",
                        ];

                        if (hasAudio) {
                            ffmpegArgs.push("-i", audioPath);
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

                        const reportStep = Math.max(1, Math.floor(totalFrames / 10));
                        let lastBuf: Buffer | null = null;

                        for (let i = 0; i < totalFrames; i++) {
                            if (abortController.signal.aborted || signal?.aborted) {
                                ff.stdin.end();
                                throw new DOMException("Operation aborted", "AbortError");
                            }
                            if (ffError) throw ffError;
                            if (ffClosed) throw new Error(`ffmpeg closed unexpectedly: ${errorOutput.slice(-500)}`);

                            const t = i / fps;
                            try {
                                await seekToTimestamp(page, t);
                            } catch (err: any) {
                                const diagInfo = await dumpDiagnosticSnapshot(page, htmlPath, `Renderer/Seek (${t}s)`);
                                err.message = `${err.message}\n${diagInfo}`;
                                throw err;
                            }
                            let buf: Buffer;
                            try {
                                buf = await page.screenshot({
                                    type: "jpeg",
                                    quality: 90,
                                    animations: "disabled",
                                    timeout: 8000,
                                });
                                lastBuf = buf;
                            } catch (err) {
                                if (lastBuf) {
                                    buf = lastBuf;
                                } else {
                                    throw err;
                                }
                            }

                            if (!ff.stdin.write(buf)) {
                                await Promise.race([
                                    new Promise((r) => ff.stdin.once("drain", r)),
                                    new Promise((_, rej) => ff.once("close", () => rej(ffError || new Error(`ffmpeg closed before drain: ${errorOutput.slice(-500)}`)))),
                                    new Promise((_, rej) => ff.once("error", rej)),
                                ]);
                            }
                            if (i % reportStep === 0 || i === totalFrames - 1) {
                                const pct = Math.round(((i + 1) / totalFrames) * 100);
                                onProgress?.(`Rendering frames: ${i + 1}/${totalFrames} (${pct}%)`, pct);
                            }
                        }
                        ff.stdin.end();

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
                                "-f", "image2pipe",
                                "-vcodec", "mjpeg",
                                "-r", String(fps),
                                "-i", "-",
                                "-c:v", "libx264",
                                "-pix_fmt", "yuv420p",
                                "-preset", "veryfast",
                                "-crf", "22",
                                "-an",
                                chunk.chunkOutputPath,
                            ];

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

                            let lastBuf: Buffer | null = null;

                            for (let i = chunk.startFrame; i < chunk.endFrame; i++) {
                                if (abortController.signal.aborted || signal?.aborted) {
                                    ff.stdin.end();
                                    throw new DOMException("Operation aborted", "AbortError");
                                }
                                if (ffError) throw ffError;
                                if (ffClosed) throw new Error(`ffmpeg closed unexpectedly: ${errorOutput.slice(-500)}`);

                                const t = i / fps;
                                try {
                                    await seekToTimestamp(page, t);
                                } catch (err: any) {
                                    const diagInfo = await dumpDiagnosticSnapshot(page, htmlPath, `Renderer/Seek/Chunk-${chunk.index} (${t}s)`);
                                    err.message = `${err.message}\n${diagInfo}`;
                                    throw err;
                                }

                                let buf: Buffer;
                                try {
                                    buf = await page.screenshot({
                                        type: "jpeg",
                                        quality: 90,
                                        animations: "disabled",
                                        timeout: 8000,
                                    });
                                    lastBuf = buf;
                                } catch (err) {
                                    if (lastBuf) {
                                        buf = lastBuf;
                                    } else {
                                        throw err;
                                    }
                                }

                                if (!ff.stdin.write(buf)) {
                                    await Promise.race([
                                        new Promise((r) => ff.stdin.once("drain", r)),
                                        new Promise((_, rej) => ff.once("close", () => rej(ffError || new Error(`ffmpeg closed before drain: ${errorOutput.slice(-500)}`)))),
                                        new Promise((_, rej) => ff.once("error", rej)),
                                    ]);
                                }

                                completedFrames++;
                                if (completedFrames % reportStep === 0 || completedFrames === totalFrames) {
                                    const pct = Math.round((completedFrames / totalFrames) * 95);
                                    onProgress?.(`Rendering frames: ${completedFrames}/${totalFrames} (${pct}%)`, pct);
                                }
                            }

                            ff.stdin.end();

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

                    // Chạy song song tất cả các chunks với Fail-fast
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

                    // Ghép nối không re-encode (Fast Concat Demuxer)
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
