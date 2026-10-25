import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { launchPreviewBrowser, seekToTimestamp, setupBrowserDiagnostics, dumpDiagnosticSnapshot } from "./preview.js";
import { installNetworkGuard } from "./networkGuard.js";
import { withRetry, isAbortError } from "./retry.js";
import { WatermarkConfig } from "../llm/schema.js";
import { buildWatermarkFilter } from "./watermarkFilter.js";
import { resolveLogoPath } from "../security/uploadGuard.js";
import { decodePng } from "./pngDecoder.js";
import { LinearLightAccumulator } from "./linearLight.js";
import { calculateSubFrameTimestamps } from "./shutterRenderer.js";
import { detectMotion, type DOMBox } from "./motion.js";
import { createCdpCaptureSession, applyDeterminismGuards, type CdpCaptureSession } from "./cdpCapture.js";
import { getConfig } from "../config.js";

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
    /**
     * Số chunk song song tối đa (Issue #35). Mặc định lấy từ RENDER_MAX_CONCURRENCY.
     */
    concurrency?: number;
    /**
     * Signal để hủy render (Issue #35).
     */
    signal?: AbortSignal;
    /**
     * Bật static frame deduplication qua CDP BeginFrame (Issue #40, mặc định true).
     * Khi tắt, dùng hành vi cũ (luôn screenshot).
     */
    useCdpDedup?: boolean;
}

/**
 * Tính CRF phù hợp theo độ phân giải (Issue #30).
 * 4K cần CRF thấp hơn để giữ chất lượng vì có 4x pixel.
 */
export function getCrfForResolution(width: number, height: number): string {
    const pixels = width * height;
    // 4K UHD: 3840x2160 = 8.3M pixels
    if (pixels >= 3840 * 2160) {
        return "20";
    }
    // 1440p: 2560x1440 = 3.7M pixels
    if (pixels >= 2560 * 1440) {
        return "21";
    }
    // 1080p trở xuống
    return "22";
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
 * Chia timeline video thành các chunk song song độc lập (Issue #35).
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

    const concurrency = Math.max(
        1,
        Math.min(safeMaxConcurrency, Math.floor(safeTotalFrames / Math.max(1, minFramesPerChunk)))
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

interface ChunkRenderContext {
    fps: number;
    totalFrames: number;
    shouldApplyBlur: boolean;
    shutterSamples: number;
    seed: number;
    width: number;
    height: number;
    htmlPath: string;
    fileUrl: string;
    onProgress?: (msg: string, percent?: number) => void;
    signal?: AbortSignal;
}

/**
 * Render một chunk (dải frame) ra file MP4 tạm (video-only, Issue #35).
 * Mỗi chunk dùng browser context + page riêng, độc lập hoàn toàn.
 */
async function renderSingleChunk(
    chunk: RenderChunk,
    browser: Awaited<ReturnType<typeof launchPreviewBrowser>>,
    ctx: ChunkRenderContext,
): Promise<void> {
    const { fps, shouldApplyBlur, shutterSamples, seed, width, height, htmlPath, fileUrl, onProgress, signal } = ctx;

    if (signal?.aborted) {
        throw new DOMException("Operation aborted", "AbortError");
    }

    if (existsSync(chunk.chunkOutputPath)) {
        rmSync(chunk.chunkOutputPath, { force: true });
    }

    const context = await browser.newContext({
        viewport: { width, height },
        deviceScaleFactor: 1,
    });
    await installNetworkGuard(context, { fileRoots: [dirname(resolve(htmlPath))] });

    try {
        const page = await context.newPage();
        setupBrowserDiagnostics(page, `Renderer-Chunk-${chunk.index}`);

        process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = "1";
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

        if (shouldApplyBlur) {
            await page.evaluate(() => {
                (window as any).__hasShutterBlur = true;
            });
        }

        // Video-only: không audio, không watermark ở bước chunk
        const ffmpegArgs = [
            "-y",
            "-f", "rawvideo",
            "-pix_fmt", "rgba",
            "-s", `${width}x${height}`,
            "-r", String(fps),
            "-i", "-",
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            "-preset", "veryfast",
            "-crf", getCrfForResolution(width, height),
            chunk.chunkOutputPath,
        ];

        const ff = spawn("ffmpeg", ffmpegArgs);
        let errorOutput = "";
        ff.stderr.on("data", (data) => {
            errorOutput += data.toString();
        });

        let stdinError: any = null;
        ff.stdin.on("error", (err: any) => {
            stdinError = err;
            if (err.code !== 'EPIPE' && err.code !== 'ERR_STREAM_DESTROYED') {
                console.warn(`[Renderer-Chunk-${chunk.index}] ff.stdin error:`, err);
            }
        });

        const accumulator = shouldApplyBlur ? new LinearLightAccumulator(width, height) : null;
        let lastFrame: Uint8Array | null = null;
        let cachedBoxes0: Record<string, DOMBox | null> | undefined = undefined;

        for (let i = chunk.startFrame; i < chunk.endFrame; i++) {
            if (signal?.aborted) {
                throw new DOMException("Operation aborted", "AbortError");
            }

            const t0 = i / fps;
            const t1 = (i + 1) / fps;

            let frameToPipe: Uint8Array;

            if (!shouldApplyBlur) {
                try {
                    await seekToTimestamp(page, t0);
                    const buf = await page.screenshot({ type: "png", animations: "disabled", timeout: 8000 });
                    const decoded = decodePng(buf);
                    frameToPipe = decoded.data;
                    lastFrame = frameToPipe;
                } catch (err: any) {
                    if (lastFrame) {
                        frameToPipe = lastFrame;
                    } else {
                        const diagInfo = await dumpDiagnosticSnapshot(page, htmlPath, `Renderer-Chunk-${chunk.index}/Seek (${t0}s)`);
                        err.message = `${err.message}\n${diagInfo}`;
                        throw err;
                    }
                }
            } else {
                let motion;
                try {
                    motion = await detectMotion(page, t0, t1, { cachedBoxes0 });
                    cachedBoxes0 = motion.boxes1;
                } catch {
                    motion = { hasMotion: true, maxDisplacement: 999, totalDisplacement: 999, vectors: [] };
                }

                if (!motion.hasMotion) {
                    try {
                        await seekToTimestamp(page, t0);
                        const buf = await page.screenshot({ type: "png", animations: "disabled", timeout: 8000 });
                        const decoded = decodePng(buf);
                        frameToPipe = decoded.data;
                        lastFrame = frameToPipe;
                    } catch (err: any) {
                        if (lastFrame) {
                            frameToPipe = lastFrame;
                        } else {
                            const diagInfo = await dumpDiagnosticSnapshot(page, htmlPath, `Renderer-Chunk-${chunk.index}/Seek (${t0}s)`);
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
                            const buf = await page.screenshot({ type: "png", animations: "disabled", timeout: 8000 });
                            const decoded = decodePng(buf);
                            subFrameData = decoded.data;
                            lastFrame = subFrameData;
                        } catch (err: any) {
                            if (lastFrame) {
                                subFrameData = lastFrame;
                            } else {
                                const diagInfo = await dumpDiagnosticSnapshot(page, htmlPath, `Renderer-Chunk-${chunk.index}/SubFrame (${subT}s)`);
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
                break;
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
                    rej(new Error(`ffmpeg chunk ${chunk.index} failed with code ${code}: ${errorOutput.slice(-500)}`));
                }
            });
            ff.on("error", rej);
        });

        onProgress?.(`Chunk ${chunk.index + 1} done`, undefined);
    } finally {
        await context.close().catch(() => { });
    }
}

/**
 * Render các chunk song song rồi concat + mux audio/watermark (Issue #35).
 */
async function renderChunksParallel(
    chunks: RenderChunk[],
    opts: RenderVideoOptions & ChunkRenderContext & {
        browser: Awaited<ReturnType<typeof launchPreviewBrowser>>;
        logoPath: string | null;
        hasAudio: boolean;
        hasWatermark: boolean;
    },
): Promise<void> {
    const { browser, signal, onProgress } = opts;

    // Render song song, fail fast: chunk nào lỗi thì hủy các chunk còn lại
    const abortController = new AbortController();
    const onAbort = () => abortController.abort();
    signal?.addEventListener("abort", onAbort);

    try {
        await Promise.all(
            chunks.map((chunk) =>
                renderSingleChunk(chunk, browser, {
                    fps: opts.fps!, totalFrames: opts.totalFrames,
                    shouldApplyBlur: opts.shouldApplyBlur, shutterSamples: opts.shutterSamples,
                    seed: opts.seed, width: opts.width, height: opts.height,
                    htmlPath: opts.htmlPath, fileUrl: opts.fileUrl,
                    onProgress, signal: signal ?? abortController.signal,
                }).catch((err) => {
                    abortController.abort();
                    throw err;
                })
            )
        );
    } finally {
        signal?.removeEventListener("abort", onAbort);
    }

    // Concat các chunk video (fast, -c copy)
    onProgress?.("Fast concatenating video chunks...", 96);
    const concatListPath = resolve(dirname(opts.outputPath), `concat_${Date.now()}.txt`);
    const lines = chunks.map((c) => `file '${c.chunkOutputPath.replace(/'/g, "'\\''")}'`).join("\n");
    writeFileSync(concatListPath, lines, "utf-8");

    const concatArgs = [
        "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", concatListPath,
        "-c", "copy",
        resolve(dirname(opts.outputPath), "concat_video.mp4"),
    ];

    await new Promise<void>((res, rej) => {
        const proc = spawn("ffmpeg", concatArgs);
        let err = "";
        proc.stderr.on("data", (d) => { err += d.toString(); });
        proc.on("close", (code) => code === 0 ? res() : rej(new Error(`concat failed: ${err.slice(-300)}`)));
        proc.on("error", rej);
    });

    // Mux audio + watermark vào video đã concat
    const concatVideo = resolve(dirname(opts.outputPath), "concat_video.mp4");
    const finalArgs = ["-y", "-i", concatVideo];
    if (opts.hasAudio) {
        finalArgs.push("-i", opts.audioPath);
    }
    if (opts.hasWatermark && opts.logoPath) {
        finalArgs.push("-i", opts.logoPath);
    }

    if (opts.hasWatermark && opts.watermark) {
        const logoLabel = opts.hasAudio ? "2:v" : "1:v";
        const { filterComplex, outputLabel } = buildWatermarkFilter(
            opts.watermark, opts.width, opts.height, "0:v", logoLabel
        );
        finalArgs.push("-filter_complex", filterComplex, "-map", outputLabel);
        if (opts.hasAudio) {
            finalArgs.push("-map", "1:a");
        }
    } else if (opts.hasAudio) {
        finalArgs.push("-map", "0:v", "-map", "1:a");
    }

    finalArgs.push(
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", getCrfForResolution(opts.width, opts.height)
    );
    if (opts.hasAudio) {
        finalArgs.push("-c:a", "aac", "-b:a", "192k", "-shortest");
    }
    finalArgs.push(
        "-t", String(opts.durationSec),
        "-movflags", "+faststart",
        opts.outputPath
    );

    await new Promise<void>((res, rej) => {
        const proc = spawn("ffmpeg", finalArgs);
        let err = "";
        proc.stderr.on("data", (d) => { err += d.toString(); });
        proc.on("close", (code) => code === 0 ? res() : rej(new Error(`mux failed: ${err.slice(-300)}`)));
        proc.on("error", rej);
    });

    // Dọn file tạm
    for (const c of chunks) {
        if (existsSync(c.chunkOutputPath)) rmSync(c.chunkOutputPath, { force: true });
    }
    if (existsSync(concatListPath)) rmSync(concatListPath, { force: true });
    if (existsSync(concatVideo)) rmSync(concatVideo, { force: true });
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
        useCdpDedup = true,
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
                await installNetworkGuard(context, { fileRoots: [dirname(resolve(htmlPath))] });
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

                // Issue #38: Determinism guards — freeze CSS animations, chờ fonts/images
                await applyDeterminismGuards(page);

                // Issue #40: CDP BeginFrame session cho static frame deduplication
                let cdpSession: CdpCaptureSession | null = null;
                if (useCdpDedup) {
                    try {
                        cdpSession = await createCdpCaptureSession(page);
                    } catch (err) {
                        console.warn("[Renderer] Không tạo được CDP session, tắt dedup:", (err as Error).message);
                    }
                }

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

                // Issue #35: Chunked parallel rendering
                const maxConcurrency = options.concurrency ?? getConfig().RENDER_MAX_CONCURRENCY ?? 1;
                const tempDir = dirname(outputPath);
                const chunks = maxConcurrency > 1
                    ? calculateRenderChunks(totalFrames, fps, maxConcurrency, tempDir)
                    : [];

                if (chunks.length > 1) {
                    // Multi-chunk: render song song rồi concat
                    onProgress?.(`Starting video render (${totalFrames} frames @ ${fps}fps, ${chunks.length} parallel chunks)...`, 0);
                    await renderChunksParallel(chunks, {
                        ...options, fps, totalFrames, shouldApplyBlur, shutterSamples, seed,
                        browser, fileUrl: pathToFileURL(resolve(htmlPath)).href,
                        logoPath, hasAudio, hasWatermark, watermark,
                    });
                    onProgress?.("Video rendering and muxing completed", 100);
                    return outputPath;
                }

                // ── Single chunk: đường cũ (giữ nguyên hành vi) ─────────────
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
                    "-crf", getCrfForResolution(width, height)
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
                            // Issue #40: Static frame dedup — nếu không có thay đổi
                            // thị giác, tái sử dụng frame cũ, bỏ qua screenshot
                            if (cdpSession && lastFrame) {
                                const hasDamage = await cdpSession.checkDamage();
                                if (!hasDamage) {
                                    frameToPipe = lastFrame;
                                } else {
                                    const buf = await page.screenshot({
                                        type: "png",
                                        animations: "disabled",
                                        timeout: 8000,
                                    });
                                    const decoded = decodePng(buf);
                                    frameToPipe = decoded.data;
                                    lastFrame = frameToPipe;
                                }
                            } else {
                                const buf = await page.screenshot({
                                    type: "png",
                                    animations: "disabled",
                                    timeout: 8000,
                                });
                                const decoded = decodePng(buf);
                                frameToPipe = decoded.data;
                                lastFrame = frameToPipe;
                            }
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
                            // Issue #40: Kết hợp với CDP hasDamage để bỏ qua screenshot nếu thực sự tĩnh
                            try {
                                await seekToTimestamp(page, t0);
                                if (cdpSession && lastFrame) {
                                    const hasDamage = await cdpSession.checkDamage();
                                    if (!hasDamage) {
                                        frameToPipe = lastFrame;
                                    } else {
                                        const buf = await page.screenshot({
                                            type: "png",
                                            animations: "disabled",
                                            timeout: 8000,
                                        });
                                        const decoded = decodePng(buf);
                                        frameToPipe = decoded.data;
                                        lastFrame = frameToPipe;
                                    }
                                } else {
                                    const buf = await page.screenshot({
                                        type: "png",
                                        animations: "disabled",
                                        timeout: 8000,
                                    });
                                    const decoded = decodePng(buf);
                                    frameToPipe = decoded.data;
                                    lastFrame = frameToPipe;
                                }
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
                // Issue #40: Đóng CDP session trước khi đóng browser
                if (cdpSession) {
                    await cdpSession.close().catch(() => { });
                }
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
