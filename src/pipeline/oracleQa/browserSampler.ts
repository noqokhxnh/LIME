import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { type Browser, type Page } from 'playwright';
import {
    launchPreviewBrowser,
    loadAndPreparePage,
    seekToTimestamp,
} from '../preview.js';
import { installNetworkGuard } from '../networkGuard.js';
import type {
    DOMSampler,
    BatchDOMSampler,
    CaptionBandSampler,
    MotionSampler,
} from './types.js';

export async function createBrowserDOMSampler(
    htmlPath: string,
    width: number,
    height: number,
    existingPage?: Page
): Promise<{
    domSampler: DOMSampler;
    batchDomSampler: BatchDOMSampler;
    captionSampler: CaptionBandSampler;
    contentSampler: CaptionBandSampler;
    motionSampler: MotionSampler;
    cleanup: () => Promise<void>;
    hasShutterBlur: boolean;
}> {
    let browser: Browser | null = null;
    let page: Page;

    if (existingPage) {
        page = existingPage;
    } else {
        browser = await launchPreviewBrowser();
        const context = await browser.newContext({
            viewport: { width, height },
        });
        await installNetworkGuard(context, { fileRoots: [dirname(resolve(htmlPath))] });
        page = await context.newPage();
    }

    await loadAndPreparePage(page, htmlPath, width, height);

    const markerBlur = await page.evaluate(() => !!(window as any).__hasShutterBlur).catch(() => false);
    const htmlContent = existsSync(htmlPath) ? readFileSync(htmlPath, 'utf-8') : '';
    const regexBlur = /shutter[-_]?blur|motion[-_]?blur|feGaussianBlur|filter:\s*blur/i.test(htmlContent);
    const hasShutterBlur = markerBlur || regexBlur;

    let currentSeekTime: number | null = null;

    const seekOnce = async (timeSec: number) => {
        if (currentSeekTime === null || Math.abs(currentSeekTime - timeSec) > 0.001) {
            await seekToTimestamp(page, timeSec);
            currentSeekTime = timeSec;
        }
    };

    const batchDomSampler: BatchDOMSampler = async (timeSec: number, selectors: string[]) => {
        if (selectors.length === 0) return {};
        await seekOnce(timeSec);
        const results = await page.evaluate((sels: string[]) => {
            const out: Record<string, { left: number; top: number; right: number; bottom: number; width: number; height: number } | null> = {};
            for (const sel of sels) {
                const el =
                    document.querySelector(sel) ||
                    document.getElementById(sel.replace(/^#/, ''));
                if (!el) {
                    out[sel] = null;
                    continue;
                }
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                if (
                    style.display === 'none' ||
                    style.visibility === 'hidden' ||
                    parseFloat(style.opacity || '1') <= 0.01
                ) {
                    out[sel] = null;
                    continue;
                }
                out[sel] = {
                    left: rect.left,
                    top: rect.top,
                    right: rect.right,
                    bottom: rect.bottom,
                    width: rect.width,
                    height: rect.height,
                };
            }
            return out;
        }, selectors);
        return results;
    };

    const domSampler: DOMSampler = async (timeSec: number, selector: string) => {
        const res = await batchDomSampler(timeSec, [selector]);
        return res[selector] ?? null;
    };

    const captionSampler: CaptionBandSampler = async (timeSec: number, sceneId: string) => {
        await seekOnce(timeSec);
        return page.evaluate((sid: string) => {
            const activeCue = document.querySelector('#lime-karaoke .karaoke-cue.is-active');
            const caption = activeCue
                ? (() => {
                      const cr = activeCue.getBoundingClientRect();
                      return {
                          left: cr.left,
                          top: cr.top,
                          right: cr.right,
                          bottom: cr.bottom,
                          width: cr.width,
                          height: cr.height,
                      };
                  })()
                : null;

            const root =
                document.getElementById(sid) ||
                (document.querySelector(`[data-scene="${sid}"]`) as HTMLElement | null);
            if (!root) return { caption, elements: [] as any[] };

            const frameArea = window.innerWidth * window.innerHeight;
            const MEDIA_TAGS = ['IMG', 'SVG', 'VIDEO', 'CANVAS', 'BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA'];
            const elements: Array<{
                label: string;
                path: string;
                kind: 'text' | 'media';
                box: { left: number; top: number; right: number; bottom: number; width: number; height: number };
            }> = [];

            for (const el of Array.from(root.querySelectorAll('*'))) {
                if (el.closest('[data-caption-exempt]')) continue;
                if (el.closest('#lime-karaoke')) continue;
                if (el.getAttribute('aria-hidden') === 'true') continue;

                const isMedia = MEDIA_TAGS.includes(el.tagName.toUpperCase());
                let hasDirectText = false;
                for (const node of Array.from(el.childNodes)) {
                    if (node.nodeType === 3 && (node.textContent || '').trim().length > 0) {
                        hasDirectText = true;
                        break;
                    }
                }
                if (!hasDirectText && !isMedia) continue;

                const cs = window.getComputedStyle(el);
                if (
                    cs.display === 'none' ||
                    cs.visibility === 'hidden' ||
                    parseFloat(cs.opacity || '1') <= 0.01
                ) {
                    continue;
                }

                const r = el.getBoundingClientRect();
                if (r.width <= 0 || r.height <= 0) continue;

                const isFullBleed = (r.width * r.height) / frameArea >= 0.8;
                const isExplicitCheck = el.hasAttribute('data-caption-check');
                if (isFullBleed && !isExplicitCheck) continue;

                const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 32);
                const label = el.id
                    ? `#${el.id}`
                    : `${el.tagName.toLowerCase()}${text ? ` "${text}"` : ''}`;

                const pathParts: number[] = [];
                let cursor: Element | null = el;
                while (cursor && cursor !== root) {
                    const parent: Element | null = cursor.parentElement;
                    if (!parent) break;
                    pathParts.unshift(Array.prototype.indexOf.call(parent.children, cursor));
                    cursor = parent;
                }

                elements.push({
                    label,
                    path: pathParts.join('/'),
                    kind: isMedia ? 'media' : 'text',
                    box: {
                        left: r.left,
                        top: r.top,
                        right: r.right,
                        bottom: r.bottom,
                        width: r.width,
                        height: r.height,
                    },
                });
            }

            return { caption, elements };
        }, sceneId);
    };

    const cleanup = async () => {
        if (browser) {
            await browser.close().catch(() => {});
        }
    };

    const motionSampler: MotionSampler = async (timeSec: number, sceneId: string) => {
        await seekOnce(timeSec);
        return page.evaluate((sid: string) => {
            const root =
                document.getElementById(sid) ||
                (document.querySelector(`[data-scene="${sid}"]`) as HTMLElement | null);
            if (!root) return null;

            const elements: Array<{ path: string; transform: string; opacity: string }> = [];
            let index = 0;
            for (const el of Array.from(root.querySelectorAll('*'))) {
                if (el.closest('#lime-karaoke')) continue;
                const cs = window.getComputedStyle(el);
                elements.push({
                    path: String(index),
                    transform: cs.transform,
                    opacity: cs.opacity,
                });
                index += 1;
            }
            return { elements };
        }, sceneId);
    };

    return {
        domSampler,
        batchDomSampler,
        captionSampler,
        contentSampler: captionSampler,
        motionSampler,
        cleanup,
        hasShutterBlur,
    };
}
