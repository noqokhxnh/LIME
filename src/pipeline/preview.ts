import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { videoScript, scene, durationMap } from "@/llm/schema";

export interface ScenePreview {
    sceneId: string;
    sceneIndex: number;
    title: string;
    timeSec: number;
    imagePath: string;
    fileName: string;
    dataUri?: string;
}

export interface PreviewResult {
    previews: ScenePreview[];
    previewDir: string;
    totalScenes: number;
    durationSec: number;
}

export interface PreviewOptions {
    htmlPath: string;
    script: videoScript;
    durations: durationMap;
    width: number;
    height: number;
    outputDir?: string;
    format?: "webp" | "png" | "jpeg";
    quality?: number;
    includeDataUri?: boolean;
    timeOffsetRatio?: number;
    timeoutMs?: number;
    onProgress?: (message: string, progress?: number) => void;
}

export interface SingleSceneCaptureOptions {
    htmlPath: string;
    timeSec: number;
    outputPath: string;
    width: number;
    height: number;
    format?: "webp" | "png" | "jpeg";
    quality?: number;
    timeoutMs?: number;
}

/**
 * Tính toán mốc thời gian (timeline timestamp) cho từng scene.
 * Mặc định lấy điểm giữa (midpoint: ratio = 0.5) của phân cảnh.
 */
export function calculateSceneTimestamps(
    scenes: scene[],
    durations: durationMap,
    timeOffsetRatio = 0.5
): Array<{ scene: scene; index: number; startTime: number; duration: number; targetTime: number }> {
    let accumulatedTime = 0;
    const ratio = Math.max(0.1, Math.min(0.9, timeOffsetRatio));

    return scenes.map((sceneItem, index) => {
        const sceneDuration = durations[sceneItem.id] ?? 3.0;
        const startTime = accumulatedTime;
        // Điểm chụp ảnh đại diện: startTime + ratio * sceneDuration
        // Đảm bảo không sát viền chuyển cảnh
        const targetTime = Math.min(
            startTime + sceneDuration * ratio,
            startTime + sceneDuration - 0.05
        );

        accumulatedTime += sceneDuration;

        return {
            scene: sceneItem,
            index,
            startTime,
            duration: sceneDuration,
            targetTime: Math.round(targetTime * 100) / 100,
        };
    });
}

/**
 * Khởi tạo trình duyệt Playwright Chromium tối ưu cho chụp ảnh preview
 */
async function launchPreviewBrowser(): Promise<Browser> {
    return await chromium.launch({
        headless: true,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--no-zygote",
            "--hide-scrollbars",
            "--disable-web-security",
            "--allow-file-access-from-files",
        ],
    });
}

/**
 * Điều hướng trang HTML đã đóng gói và chờ đến khi GSAP timeline sẵn sàng (__ready = true)
 */
async function loadAndPreparePage(
    page: Page,
    htmlPath: string,
    width: number,
    height: number,
    timeoutMs = 30000
): Promise<void> {
    const absoluteHtmlPath = resolve(htmlPath);
    if (!existsSync(absoluteHtmlPath)) {
        throw new Error(`HTML file not found at: ${absoluteHtmlPath}`);
    }

    const fileUrl = pathToFileURL(absoluteHtmlPath).href;

    await page.setViewportSize({ width, height });

    // Navigate tới file HTML local
    await page.goto(fileUrl, {
        waitUntil: "load",
        timeout: timeoutMs,
    });

    // Chờ tín hiệu window.__ready = true từ mã nguồn assembleHTML
    await page.waitForFunction(
        () => (window as unknown as { __ready?: boolean }).__ready === true,
        undefined,
        { timeout: timeoutMs }
    );

    // Chờ load xong web fonts nếu có
    await page.evaluate(async () => {
        if (document.fonts && document.fonts.ready) {
            await document.fonts.ready;
        }
    });

    // Đợi 1 frame ngắn để DOM và canvas/SVG ổn định layout
    await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    );
}

/**
 * Tua timeline đến mốc thời gian chỉ định và chờ render
 */
async function seekToTimestamp(page: Page, timeSec: number): Promise<void> {
    await page.evaluate((targetTime) => {
        const win = window as unknown as {
            __seekTo?: (t: number) => void;
            __masterTimeline?: { seek: (t: number, suppressEvents?: boolean) => void };
        };

        if (typeof win.__seekTo === "function") {
            win.__seekTo(targetTime);
        } else if (win.__masterTimeline && typeof win.__masterTimeline.seek === "function") {
            win.__masterTimeline.seek(targetTime, false);
        }
    }, timeSec);

    // Chờ 2 frames requestAnimationFrame để browser vẽ lại các phần tử animation
    await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    );
}

/**
 * Sinh danh sách thumbnail preview cho tất cả các scene trong videoScript
 */
export async function generatePreviews(options: PreviewOptions): Promise<PreviewResult> {
    const {
        htmlPath,
        script,
        durations,
        width,
        height,
        outputDir,
        format = "webp",
        quality = 85,
        includeDataUri = false,
        timeOffsetRatio = 0.5,
        timeoutMs = 30000,
        onProgress,
    } = options;

    const previewOutputDir = outputDir ?? join(dirname(resolve(htmlPath)), "previews");
    if (!existsSync(previewOutputDir)) {
        mkdirSync(previewOutputDir, { recursive: true });
    }

    const sceneTimelineInfos = calculateSceneTimestamps(
        script.scenes,
        durations,
        timeOffsetRatio
    );

    const totalDurationSec = sceneTimelineInfos.reduce((acc, curr) => acc + curr.duration, 0);
    const results: ScenePreview[] = [];

    onProgress?.(`Bắt đầu khởi tạo Chromium để tạo thumbnail cho ${script.scenes.length} phân cảnh`, 0);

    let browser: Browser | null = null;
    let context: BrowserContext | null = null;
    let page: Page | null = null;

    try {
        browser = await launchPreviewBrowser();
        context = await browser.newContext({
            viewport: { width, height },
            deviceScaleFactor: 1,
        });

        page = await context.newPage();

        onProgress?.("Đang nạp file HTML và kiểm tra Master Timeline...", 10);
        await loadAndPreparePage(page, htmlPath, width, height, timeoutMs);

        const totalScenes = sceneTimelineInfos.length;

        for (let i = 0; i < totalScenes; i++) {
            const item = sceneTimelineInfos[i];
            const { scene: sceneItem, index, targetTime } = item;

            const progressPct = Math.round(15 + ((i + 1) / totalScenes) * 80);
            onProgress?.(
                `Đang chụp preview cho scene ${index + 1}/${totalScenes}: "${sceneItem.title}" tại ${targetTime}s`,
                progressPct
            );

            // Tua timeline đến điểm giữa phân cảnh
            await seekToTimestamp(page, targetTime);

            const fileName = `${sceneItem.id}.${format}`;
            const imagePath = join(previewOutputDir, fileName);

            await page.screenshot({
                path: imagePath,
                type: format,
                quality: format === "png" ? undefined : quality,
            });

            let dataUri: string | undefined;
            if (includeDataUri && existsSync(imagePath)) {
                const imgBuffer = readFileSync(imagePath);
                dataUri = `data:image/${format};base64,${imgBuffer.toString("base64")}`;
            }

            results.push({
                sceneId: sceneItem.id,
                sceneIndex: index,
                title: sceneItem.title,
                timeSec: targetTime,
                imagePath,
                fileName,
                dataUri,
            });
        }

        onProgress?.(`Hoàn thành tạo ${results.length} thumbnails preview`, 100);

        return {
            previews: results,
            previewDir: previewOutputDir,
            totalScenes: results.length,
            durationSec: Math.round(totalDurationSec * 100) / 100,
        };
    } catch (err: any) {
        onProgress?.(`Lỗi khi tạo preview: ${err.message}`);
        throw new Error(`Preview generation failed: ${err.message}`);
    } finally {
        if (page) await page.close().catch(() => {});
        if (context) await context.close().catch(() => {});
        if (browser) await browser.close().catch(() => {});
    }
}

/**
 * Chụp 1 ảnh xem trước tại một timestamp cụ thể
 */
export async function captureScenePreview(
    options: SingleSceneCaptureOptions
): Promise<{ imagePath: string; timeSec: number }> {
    const {
        htmlPath,
        timeSec,
        outputPath,
        width,
        height,
        format = "webp",
        quality = 85,
        timeoutMs = 30000,
    } = options;

    const outDir = dirname(resolve(outputPath));
    if (!existsSync(outDir)) {
        mkdirSync(outDir, { recursive: true });
    }

    let browser: Browser | null = null;
    let context: BrowserContext | null = null;
    let page: Page | null = null;

    try {
        browser = await launchPreviewBrowser();
        context = await browser.newContext({
            viewport: { width, height },
            deviceScaleFactor: 1,
        });

        page = await context.newPage();
        await loadAndPreparePage(page, htmlPath, width, height, timeoutMs);
        await seekToTimestamp(page, timeSec);

        await page.screenshot({
            path: outputPath,
            type: format,
            quality: format === "png" ? undefined : quality,
        });

        return {
            imagePath: outputPath,
            timeSec,
        };
    } finally {
        if (page) await page.close().catch(() => {});
        if (context) await context.close().catch(() => {});
        if (browser) await browser.close().catch(() => {});
    }
}

export const previewScenes = generatePreviews;
export const generateScenePreviews = generatePreviews;
