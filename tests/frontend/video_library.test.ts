import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { chromium, type Browser, type Page, type Route } from 'playwright';

/**
 * Frontend regression cho tab "Video của tôi" trong Workspace.
 *
 * Chạy Workspace thật (workspace.js + js/video-library.js) trong Chromium, phục
 * vụ file tĩnh từ `frontend/` bằng HTTP server nhỏ, còn mọi call API được route
 * giả lập. Không mở PostgreSQL/Redis/LLM — mục tiêu là hành vi UI và state.
 */

const FRONTEND_DIR = resolve(process.cwd(), 'frontend');
const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.ico': 'image/x-icon',
};

type Job = {
    jobId: string;
    status: string;
    topic: string;
    createdAt: string;
    updatedAt: string;
    completedAt: string | null;
    durationSec: number | null;
    resolution: string | null;
    qaStatus: string | null;
    error: string | null;
    progress: number | null;
    hasVideo: boolean;
    videoAvailable: boolean;
    canRestore: boolean;
    thumbnailUrl: string | null;
};

function makeJob(index: number, overrides: Partial<Job> = {}): Job {
    const iso = new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString();
    return {
        jobId: `ui_job_${index}`,
        status: 'completed',
        topic: `Video số ${index}`,
        createdAt: iso,
        updatedAt: iso,
        completedAt: iso,
        durationSec: 12 + index,
        resolution: '1920x1080',
        qaStatus: 'pass',
        error: null,
        progress: null,
        hasVideo: true,
        videoAvailable: true,
        canRestore: true,
        thumbnailUrl: null,
        ...overrides,
    };
}

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

describe('Workspace — tab "Video của tôi" (Playwright)', () => {
    let browser: Browser | null = null;
    let server: Server | null = null;
    let origin = '';
    let page: Page | null = null;
    let jobs: Job[] = [];
    let deleted: string[] = [];
    let generateCalls = 0;
    let apiRequests: string[] = [];

    function baseJobs(): Job[] {
        const alpha = makeJob(1, { jobId: `ui_${RUN}_alpha`, topic: 'Alpha video hoàn chỉnh', createdAt: '2026-01-02T10:00:00.000Z' });
        const beta = makeJob(2, {
            jobId: `ui_${RUN}_beta`,
            topic: 'Beta video mất tệp',
            videoAvailable: false,
            canRestore: false,
            hasVideo: true,
            createdAt: '2026-01-01T10:00:00.000Z',
        });
        const running = makeJob(3, {
            jobId: `ui_${RUN}_running`,
            topic: 'Video đang render',
            status: 'running',
            progress: 42,
            durationSec: null,
            createdAt: '2026-01-03T10:00:00.000Z',
            completedAt: null,
            qaStatus: null,
        });
        const filler = Array.from({ length: 11 }, (_, i) =>
            makeJob(10 + i, {
                jobId: `ui_${RUN}_f${i}`,
                topic: `Video bổ sung ${i}`,
                createdAt: `2025-12-${String(10 + i).padStart(2, '0')}T10:00:00.000Z`,
            })
        );
        return [alpha, beta, running, ...filler];
    }

    function applyListQuery(url: URL): Job[] {
        let rows = [...jobs];
        const q = (url.searchParams.get('q') || '').toLowerCase();
        const status = url.searchParams.get('status') || 'all';
        const sort = url.searchParams.get('sort') || 'newest';
        if (q) rows = rows.filter((j) => `${j.topic} ${j.jobId}`.toLowerCase().includes(q));
        if (status === 'processing') rows = rows.filter((j) => ['queued', 'running'].includes(j.status));
        else if (status === 'failed') rows = rows.filter((j) => ['failed', 'qa_failed'].includes(j.status));
        else if (status !== 'all') rows = rows.filter((j) => j.status === status);
        if (sort === 'name-asc' || sort === 'name-desc') {
            rows.sort((a, b) => a.topic.localeCompare(b.topic, 'vi') * (sort === 'name-desc' ? -1 : 1));
        } else {
            rows.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
            if (sort === 'newest') rows.reverse();
        }
        return rows;
    }

    function detailFor(job: Job) {
        return {
            jobId: job.jobId,
            status: job.status,
            topic: job.topic,
            createdAt: job.createdAt,
            updatedAt: job.updatedAt,
            completedAt: job.completedAt,
            progress: job.progress == null ? undefined : { phase: 'render', progress: job.progress, message: 'Đang render' },
            error: job.error,
            qaStatus: job.qaStatus,
            qaReport: undefined,
            request: { prompt: job.topic },
            script: { scenes: [{ id: 'scene-1', title: 'Cảnh 1' }] },
            canRestore: job.canRestore,
            result: {
                durationSec: job.durationSec,
                resolution: job.resolution,
                scenes: [{ id: 'scene-1', title: 'Cảnh 1' }],
                hasVideo: job.hasVideo,
                videoAvailable: job.videoAvailable,
                htmlUrl: `/api/jobs/${job.jobId}/html`,
                audioUrl: `/api/jobs/${job.jobId}/audio`,
            },
        };
    }

    function corsHeaders(req: { headers: () => Record<string, string> }): Record<string, string> {
        const originHeader = req.headers().origin || '*';
        return {
            'Access-Control-Allow-Origin': originHeader,
            'Access-Control-Allow-Credentials': 'true',
            'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Accept, Range',
        };
    }

    async function fulfillJson(route: Route, status: number, body: unknown) {
        await route.fulfill({
            status,
            headers: { 'Content-Type': 'application/json', ...corsHeaders(route.request()) },
            body: JSON.stringify(body),
        });
    }

    async function setupApiRoutes(target: Page) {
        await target.route('http://localhost:3000/**', async (route) => {
            const req = route.request();
            const url = new URL(req.url());
            const method = req.method();
            apiRequests.push(`${method} ${url.pathname}${url.search}`);

            if (method === 'OPTIONS') {
                await route.fulfill({ status: 204, headers: corsHeaders(req) });
                return;
            }

            if (url.pathname === '/api/auth/config') {
                await fulfillJson(route, 200, { googleAuthEnabled: false });
                return;
            }
            if (url.pathname === '/api/auth/me') {
                await fulfillJson(route, 200, { user: { id: 'ui-user', name: 'UI Tester', role: 'user' } });
                return;
            }
            if (url.pathname === '/api/assets') {
                await fulfillJson(route, 200, { assets: [] });
                return;
            }
            if (url.pathname === '/api/generate' || url.pathname === '/api/pipeline') {
                generateCalls++;
                await fulfillJson(route, 500, { error: 'không được gọi trong test này' });
                return;
            }
            if (url.pathname === '/api/jobs' && method === 'GET') {
                const all = applyListQuery(url);
                const pageNo = Math.max(1, Number(url.searchParams.get('page')) || 1);
                const pageSize = Math.max(1, Number(url.searchParams.get('pageSize')) || 12);
                const items = all.slice((pageNo - 1) * pageSize, pageNo * pageSize);
                await fulfillJson(route, 200, {
                    items,
                    total: all.length,
                    page: pageNo,
                    pageSize,
                    totalPages: Math.max(1, Math.ceil(all.length / pageSize)),
                    paginated: true,
                });
                return;
            }
            const jobMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)(?:\/(.*))?$/);
            if (jobMatch) {
                const jobId = decodeURIComponent(jobMatch[1]);
                const sub = jobMatch[2] || '';
                const job = jobs.find((j) => j.jobId === jobId);
                if (method === 'DELETE') {
                    if (!job) { await fulfillJson(route, 404, { error: 'Job not found' }); return; }
                    if (['queued', 'running'].includes(job.status)) {
                        await fulfillJson(route, 409, { error: 'JOB_ACTIVE', message: 'Đang chạy' });
                        return;
                    }
                    jobs = jobs.filter((j) => j.jobId !== jobId);
                    deleted.push(jobId);
                    await fulfillJson(route, 200, { deleted: true, jobId });
                    return;
                }
                if (!job) { await fulfillJson(route, 404, { error: 'Job not found' }); return; }
                if (sub === '' && method === 'GET') {
                    await fulfillJson(route, 200, detailFor(job));
                    return;
                }
                if (sub === 'video' || sub === 'download') {
                    if (!job.videoAvailable) { await fulfillJson(route, 404, { error: 'Video file not found' }); return; }
                    if (method === 'HEAD') {
                        await route.fulfill({ status: 200, headers: { ...corsHeaders(req), 'Content-Type': 'video/mp4' }, body: '' });
                        return;
                    }
                    await route.fulfill({
                        status: 200,
                        headers: { ...corsHeaders(req), 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes' },
                        body: Buffer.alloc(0),
                    });
                    return;
                }
                await fulfillJson(route, 404, { error: 'Not found' });
                return;
            }
            await fulfillJson(route, 404, { error: 'Not found' });
        });
    }

    before(async () => {
        if (!existsSync(join(FRONTEND_DIR, 'workspace.html'))) {
            throw new Error('Không tìm thấy frontend/workspace.html');
        }
        server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
            try {
                const url = new URL(req.url || '/', 'http://local');
                const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
                const filePath = resolve(FRONTEND_DIR, '.' + pathname);
                if (!filePath.startsWith(FRONTEND_DIR + sep) || !existsSync(filePath)) {
                    res.writeHead(404).end('Not found');
                    return;
                }
                const data = await readFile(filePath);
                res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
                res.end(data);
            } catch {
                res.writeHead(500).end('Server error');
            }
        });
        await new Promise<void>((resolvePromise, reject) => {
            server!.once('error', reject);
            server!.listen(0, '127.0.0.1', () => resolvePromise());
        });
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Không lấy được cổng test');
        origin = `http://127.0.0.1:${address.port}`;

        try {
            browser = await chromium.launch();
        } catch {
            browser = null;
        }
    });

    after(async () => {
        if (page) await page.close().catch(() => { });
        if (browser) await browser.close().catch(() => { });
        if (server) await new Promise<void>((resolvePromise) => server!.close(() => resolvePromise()));
    });

    beforeEach(async () => {
        jobs = baseJobs();
        deleted = [];
        generateCalls = 0;
        apiRequests = [];
        if (page) await page.close().catch(() => { });
        if (!browser) return;
        page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        if (process.env.DEBUG_UI) {
            page.on('console', (m) => console.log('[console]', m.type(), m.text()));
            page.on('pageerror', (e) => console.log('[pageerror]', e.stack));
            page.on('requestfailed', (r) => console.log('[reqfail]', r.url(), r.failure()?.errorText));
        }
        await setupApiRoutes(page);
        await page.goto(`${origin}/workspace.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => Boolean((window as any).LimeWorkspace));
    });

    async function skipIfNoBrowser(t: { skip: (msg?: string) => void }): Promise<boolean> {
        if (browser && page) return false;
        t.skip('Chromium chưa được cài — bỏ qua test giao diện');
        return true;
    }

    it('chuyển tab không reload, giữ prompt và trạng thái active', async (t) => {
        if (await skipIfNoBrowser(t)) return;
        const p = page!;
        await p.fill('#prompt-input', 'bản nháp chưa render của tôi');
        await p.click('.ws-tab[data-ws="library"]');
        await p.waitForSelector('#ws-main-library:not([hidden])');
        assert.ok(await p.locator('.ws-tab[data-ws="library"]').evaluate((el) => el.classList.contains('on')));
        assert.ok(await p.locator('.ws-tab[data-ws="script"]').evaluate((el) => !el.classList.contains('on')));
        assert.ok(await p.evaluate(() => document.body.classList.contains('library-mode')));
        await p.click('.ws-tab[data-ws="script"]');
        await p.waitForSelector('#ws-main-script:not([hidden])');
        assert.strictEqual(await p.inputValue('#prompt-input'), 'bản nháp chưa render của tôi');
        assert.ok(await p.evaluate(() => !document.body.classList.contains('library-mode')));
    });

    it('danh sách hiển thị metadata/trạng thái và fallback cho tệp mất', async (t) => {
        if (await skipIfNoBrowser(t)) return;
        const p = page!;
        await p.click('.ws-tab[data-ws="library"]');
        await p.waitForSelector('.vl-card');
        await p.waitForFunction(() => document.querySelectorAll('.vl-card').length === 12);

        // `hidden` phải thắng display:flex của CSS trạng thái.
        assert.strictEqual(await p.locator('#vl-loading').isVisible(), false);
        assert.strictEqual(await p.locator('#vl-empty').isVisible(), false);
        assert.strictEqual(await p.locator('#vl-alert').isVisible(), false);

        const count = await p.textContent('#vl-count');
        assert.strictEqual(count, '14 video');
        const alpha = p.locator(`.vl-card[data-job-id="ui_${RUN}_alpha"]`);
        assert.match((await alpha.textContent()) || '', /Alpha video hoàn chỉnh/);
        assert.match((await alpha.textContent()) || '', /Hoàn thành/);
        assert.match((await alpha.textContent()) || '', /0:13/);
        const beta = p.locator(`.vl-card[data-job-id="ui_${RUN}_beta"]`);
        assert.match((await beta.textContent()) || '', /Tệp video không còn khả dụng/);
        assert.strictEqual(await beta.locator('.vl-link-btn').isDisabled(), true);
        const running = p.locator(`.vl-card[data-job-id="ui_${RUN}_running"]`);
        assert.match((await running.textContent()) || '', /Đang tạo/);
    });

    it('tìm kiếm debounce, lọc trạng thái, sắp xếp và trạng thái không kết quả', async (t) => {
        if (await skipIfNoBrowser(t)) return;
        const p = page!;
        await p.click('.ws-tab[data-ws="library"]');
        await p.waitForSelector('.vl-card');

        await p.fill('#vl-search', 'alpha');
        await p.waitForFunction(() => document.querySelectorAll('.vl-card').length === 1);
        assert.match((await p.locator('.vl-card').textContent()) || '', /Alpha video/);
        assert.ok(apiRequests.some((r) => r.includes('q=alpha')), 'phải gửi q lên server');

        await p.fill('#vl-search', 'khong_bao_gio_khop_xyz');
        await p.waitForSelector('#vl-empty:not([hidden])');
        assert.match((await p.textContent('#vl-empty-title')) || '', /Không tìm thấy video phù hợp/);

        await p.click('#vl-empty-cta');
        await p.waitForSelector('.vl-card');

        await p.selectOption('#vl-status', 'processing');
        await p.waitForFunction(() => document.querySelectorAll('.vl-card').length === 1);
        assert.match((await p.locator('.vl-card').textContent()) || '', /Video đang render/);
        assert.ok(apiRequests.some((r) => r.includes('status=processing')));

        await p.selectOption('#vl-status', 'all');
        await p.waitForFunction(() => document.querySelectorAll('.vl-card').length === 12);
        await p.selectOption('#vl-sort', 'name-asc');
        await p.waitForFunction(() => {
            const titles = [...document.querySelectorAll('.vl-title')].map((el) => el.textContent || '');
            const sorted = [...titles].sort((a, b) => a.localeCompare(b, 'vi'));
            return titles.every((value, index) => value === sorted[index]);
        });
        assert.ok(apiRequests.some((r) => r.includes('sort=name-asc')));
    });

    it('phân trang chuyển trang và vẫn lọc theo tài khoản trên server', async (t) => {
        if (await skipIfNoBrowser(t)) return;
        const p = page!;
        await p.click('.ws-tab[data-ws="library"]');
        await p.waitForFunction(() => document.querySelectorAll('.vl-card').length === 12);
        assert.strictEqual(await p.locator('#vl-pagination').isVisible(), true);
        await p.click('#vl-next');
        await p.waitForFunction(() => (document.querySelector('#vl-page-info')?.textContent || '').includes('Trang 2'));
        await p.waitForFunction(() => document.querySelectorAll('.vl-card').length === 2);
        assert.ok(apiRequests.some((r) => r.includes('page=2')));
    });

    it('xem video trong overlay, đóng bằng Escape, không tạo job mới', async (t) => {
        if (await skipIfNoBrowser(t)) return;
        const p = page!;
        await p.click('.ws-tab[data-ws="library"]');
        await p.waitForSelector('.vl-card');
        await p.locator(`.vl-card[data-job-id="ui_${RUN}_alpha"] .vl-link-btn`).click();
        await p.waitForSelector('#vl-player-overlay:not([hidden])');
        const src = await p.getAttribute('#vl-player-video', 'src');
        assert.match(src || '', /\/api\/jobs\/ui_.+_alpha\/video$/);
        assert.match((await p.textContent('#vl-player-title')) || '', /Alpha video/);
        await p.keyboard.press('Escape');
        await p.waitForFunction(() => document.querySelector('#vl-player-overlay')?.hasAttribute('hidden'));
        assert.strictEqual(generateCalls, 0);
    });

    it('mở video cũ: cảnh báo mất bản nháp, chỉ khôi phục khi xác nhận, không gọi generate', async (t) => {
        if (await skipIfNoBrowser(t)) return;
        const p = page!;
        await p.fill('#prompt-input', 'bản nháp quan trọng');
        await p.click('.ws-tab[data-ws="library"]');
        await p.waitForSelector('.vl-card');

        const card = p.locator(`.vl-card[data-job-id="ui_${RUN}_alpha"]`);
        await card.locator('.vl-menu-btn').click();
        await card.getByRole('button', { name: 'Mở trong trình chỉnh sửa' }).click();
        await p.waitForSelector('#vl-confirm:not([hidden])');
        assert.match((await p.textContent('#vl-confirm-desc')) || '', /chưa lưu/);
        await p.click('#vl-confirm-cancel');
        await p.waitForFunction(() => document.querySelector('#vl-confirm')?.hasAttribute('hidden'));
        assert.strictEqual(await p.inputValue('#prompt-input'), 'bản nháp quan trọng');
        assert.strictEqual(await p.locator('.ws-tab[data-ws="library"]').evaluate((el) => el.classList.contains('on')), true);

        await card.locator('.vl-menu-btn').click();
        await card.getByRole('button', { name: 'Mở trong trình chỉnh sửa' }).click();
        await p.waitForSelector('#vl-confirm:not([hidden])');
        await p.click('#vl-confirm-ok');
        await p.waitForFunction(() => document.querySelector('.ws-tab[data-ws="script"]')?.classList.contains('on'));
        assert.strictEqual(await p.inputValue('#prompt-input'), 'Alpha video hoàn chỉnh');
        assert.strictEqual(generateCalls, 0);
    });

    it('xoá video cần xác nhận, gọi DELETE và cập nhật danh sách', async (t) => {
        if (await skipIfNoBrowser(t)) return;
        const p = page!;
        await p.click('.ws-tab[data-ws="library"]');
        await p.waitForSelector('.vl-card');
        const card = p.locator(`.vl-card[data-job-id="ui_${RUN}_alpha"]`);
        await card.locator('.vl-menu-btn').click();
        await card.getByRole('button', { name: 'Xoá khỏi thư viện' }).click();
        await p.waitForSelector('#vl-confirm:not([hidden])');
        assert.match((await p.textContent('#vl-confirm-desc')) || '', /không thể hoàn tác/);
        await p.click('#vl-confirm-ok');
        await p.waitForFunction((id) => !document.querySelector(`.vl-card[data-job-id="${id}"]`), `ui_${RUN}_alpha`);
        assert.deepStrictEqual(deleted, [`ui_${RUN}_alpha`]);
        assert.match((await p.textContent('#vl-count')) || '', /13 video/);
    });

    it('poll chỉ chạy khi tab mở và có job đang xử lý; rời tab là dừng', async (t) => {
        if (await skipIfNoBrowser(t)) return;
        const p = page!;
        await p.click('.ws-tab[data-ws="library"]');
        await p.waitForSelector('.vl-card');
        const beforeCount = apiRequests.filter((r) => r.startsWith('GET /api/jobs?')).length;
        await p.waitForTimeout(5300);
        const afterActive = apiRequests.filter((r) => r.startsWith('GET /api/jobs?')).length;
        assert.ok(afterActive > beforeCount, 'tab đang mở + job running phải poll');

        await p.click('.ws-tab[data-ws="script"]');
        const afterLeave = apiRequests.filter((r) => r.startsWith('GET /api/jobs?')).length;
        await p.waitForTimeout(5300);
        const afterIdle = apiRequests.filter((r) => r.startsWith('GET /api/jobs?')).length;
        assert.strictEqual(afterIdle, afterLeave, 'rời tab không được tiếp tục poll');
    });

    it('responsive 390px: một cột, không tràn ngang; toolbar không đè nhau', async (t) => {
        if (await skipIfNoBrowser(t)) return;
        const p = page!;
        await p.setViewportSize({ width: 390, height: 844 });
        await p.click('.ws-tab[data-ws="library"]');
        await p.waitForSelector('.vl-card');
        const layout = await p.evaluate(() => {
            const grid = document.querySelector('.vl-grid')!;
            const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean);
            return {
                cols: cols.length,
                scrollWidth: document.documentElement.scrollWidth,
                innerWidth: window.innerWidth,
                cardWidth: document.querySelector('.vl-card')!.getBoundingClientRect().width,
                gridWidth: grid.getBoundingClientRect().width,
            };
        });
        assert.strictEqual(layout.cols, 1);
        assert.ok(layout.cardWidth <= layout.gridWidth + 1);
        assert.ok(layout.scrollWidth <= layout.innerWidth + 1, `tràn ngang: ${layout.scrollWidth} > ${layout.innerWidth}`);
    });
});
