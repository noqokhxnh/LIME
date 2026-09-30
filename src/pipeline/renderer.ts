import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { launchPreviewBrowser, seekToTimestamp, setupBrowserDiagnostics, dumpDiagnosticSnapshot } from "./preview.js";
import { withRetry, isAbortError } from "./retry.js";

export interface RenderVideoOptions {
    htmlPath: string;
    audioPath: string;
    outputPath: string;
    width: number;
    height: number;
    fps?: number;
    durationSec: number;
    onProgress?: (msg: string, percent?: number) => void;
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
    } = options;

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
                        } catch (e) {}
                    }
                });

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
                let errorOutput = "";
                ff.stderr.on("data", (data) => {
                    errorOutput += data.toString();
                });

                const reportStep = Math.max(1, Math.floor(totalFrames / 10));
                let lastBuf: Buffer | null = null;

                for (let i = 0; i < totalFrames; i++) {
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
                        await new Promise((r) => ff.stdin.once("drain", r));
                    }
                    if (i % reportStep === 0 || i === totalFrames - 1) {
                        const pct = Math.round(((i + 1) / totalFrames) * 100);
                        onProgress?.(`Rendering frames: ${i + 1}/${totalFrames} (${pct}%)`, pct);
                    }
                }
                ff.stdin.end();

                await new Promise<void>((res, rej) => {
                    ff.on("close", (code) => {
                        if (code === 0) {
                            res();
                        } else {
                            rej(new Error(`ffmpeg render failed with code ${code}: ${errorOutput.slice(-500)}`));
                        }
                    });
                    ff.on("error", rej);
                });

                onProgress?.("Video rendering and muxing completed", 100);
                return outputPath;
            } finally {
                await browser.close().catch(() => {});
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
