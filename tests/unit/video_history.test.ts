import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { type FastifyInstance } from 'fastify';
import { buildApp } from '../../src/index.js';
import { createTestSession } from '../../src/auth/session.js';
import { userStore } from '../../src/admin/userStore.js';
import { resetConfig } from '../../src/config.js';
import { MemoryQueue } from '../../src/queue/memoryQueue.js';
import { jobWorkDirs, safeJobDir } from '../../src/queue/jobPaths.js';
import {
    recordVideoCancelled,
    recordVideoCompleted,
    recordVideoFailed,
    recordVideoQueued,
    recordVideoStarted,
    __resetVideoHistoryForTests,
} from '../../src/history/store.js';

/**
 * Hồi quy cho "Video của tôi":
 *  - cách ly chủ sở hữu (A/B/admin/ẩn danh), kể cả job legacy thiếu userId;
 *  - danh sách: lọc trạng thái, tìm kiếm, sắp xếp, phân trang;
 *  - artifact: stream/download/preview chỉ chủ sở hữu;
 *  - độ khả dụng của MP4 và metadata `videoAvailable`;
 *  - xoá an toàn, chặn xoá job đang chạy, xoá đồng thời;
 *  - không rò đường dẫn filesystem trong response chi tiết;
 *  - job chỉ còn trong queue vẫn đọc được, job chỉ còn trong lịch sử vẫn đọc được.
 *
 * Test dùng MemoryQueue + lớp lịch sử in-memory (không cần PostgreSQL/Redis).
 */

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
const A_ID = randomUUID();
const B_ID = randomUUID();
const ADMIN_ID = randomUUID();
const WORK_DIRS: string[] = [];

function putFile(jobId: string, relative = 'final_video.mp4', bytes = [0x00, 0x00, 0x00, 0x18]): string {
    const dir = safeJobDir(jobId);
    if (!dir) throw new Error(`bad jobId ${jobId}`);
    const path = join(dir, relative);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, Buffer.from(bytes));
    WORK_DIRS.push(dir);
    return path;
}

function payload(prompt: string) {
    return {
        prompt,
        targetDurationSec: 15,
        aspectRatio: '16:9',
        language: 'vi',
        style: 'modern',
    } as any;
}

const SCRIPT = {
    id: 'hist-script',
    title: 'Kịch bản lịch sử',
    description: '',
    globalStyles: '',
    globalSetupJs: '',
    scenes: [{
        id: 'scene-1',
        title: 'Cảnh 1',
        voiceOverText: 'Xin chào',
        visualDescription: '',
        htmlCode: '<div id="scene-1"></div>',
        cssCode: '',
        jsCode: 'tl.to("#scene-1", { duration: {{SCENE_DURATION}}, opacity: 1 });',
        transition: 'fade',
        backgroundColor: '#000000',
    }],
    boundaries: [],
    colorPalette: {
        primary: '#3b82f6', secondary: '#1d4ed8', accent: '#f59e0b',
        background: '#0f172a', text: '#ffffff',
    },
    fontFamily: 'Inter',
    totalDurationSec: 15,
} as any;

async function seedCompleted(jobId: string, userId: string | undefined, topic: string, opts: {
    file?: boolean;
    qaStatus?: string;
    script?: boolean;
} = {}) {
    await recordVideoQueued({ jobId, userId, topic, request: payload(topic) });
    const videoPath = opts.file === false ? join(safeJobDir(jobId)!, 'missing.mp4') : putFile(jobId);
    if (opts.qaStatus === 'fail') {
        await recordVideoCompleted(jobId, {
            durationSec: 12, resolution: '1920x1080', qaStatus: 'fail', videoPath,
        }, opts.script ? SCRIPT : undefined);
    } else {
        await recordVideoCompleted(jobId, {
            durationSec: 12, resolution: '1920x1080', qaStatus: 'pass', videoPath,
            scences: [{ id: 'scene-1' }],
        }, opts.script ? SCRIPT : undefined);
    }
    return videoPath;
}

describe('Video History (thư viện "Video của tôi")', () => {
    let app: FastifyInstance;
    let queue: MemoryQueue;
    let tokenA: string;
    let tokenB: string;
    let tokenAdmin: string;
    const blockers = new Map<string, () => void>();

    function waitForStatus(jobId: string, statuses: string[], attempts = 120): Promise<any> {
        return new Promise((resolve, reject) => {
            let count = 0;
            const tick = async () => {
                const job = await queue.getJob(jobId);
                if (job && statuses.includes(job.status)) return resolve(job);
                if (++count > attempts) return reject(new Error(`job ${jobId} không đạt ${statuses.join('/')}`));
                setTimeout(tick, 20);
            };
            void tick();
        });
    }

    async function enqueueLive(jobId: string, userId: string | undefined, prompt: string) {
        if (!prompt.includes('__missingvideo__') && !prompt.includes('__block__')) putFile(jobId);
        await queue.addJob(jobId, {
            jobId,
            userId,
            request: payload(prompt),
            outputDir: join(process.cwd(), 'tmp', `job-${jobId}`),
            seed: 1,
        } as any);
    }

    before(async () => {
        // Unit test phải chạy không cần PostgreSQL; lịch sử dùng Map trong bộ nhớ.
        delete process.env.DATABASE_URL;
        resetConfig();
        __resetVideoHistoryForTests();

        await userStore.upsertUser({ id: A_ID, username: `a_${RUN}`, email: `a_${RUN}@example.com`, role: 'user' });
        await userStore.upsertUser({ id: B_ID, username: `b_${RUN}`, email: `b_${RUN}@example.com`, role: 'user' });
        await userStore.upsertUser({ id: ADMIN_ID, username: `admin_${RUN}`, email: `admin_${RUN}@example.com`, role: 'admin' });
        tokenA = createTestSession(A_ID);
        tokenB = createTestSession(B_ID);
        tokenAdmin = createTestSession(ADMIN_ID);

        queue = new MemoryQueue();
        app = await buildApp({ queue, logger: false });
        queue.process(async (data) => {
            if (String(data.request?.prompt || '').includes('__block__')) {
                await new Promise<void>((resolve) => blockers.set(data.jobId, resolve));
            }
            const missing = String(data.request?.prompt || '').includes('__missingvideo__');
            return {
                jobId: data.jobId,
                durationSec: 9,
                resolution: '1920x1080',
                videoPath: missing ? join(safeJobDir(data.jobId)!, 'gone.mp4') : join(safeJobDir(data.jobId)!, 'final_video.mp4'),
                scences: [{ id: 'scene-1' }],
                qaStatus: 'pass',
            } as any;
        });
        await app.ready();
    });

    after(async () => {
        for (const resolve of blockers.values()) resolve();
        blockers.clear();
        await app.close();
        for (const dir of WORK_DIRS) {
            try { rmSync(dir, { recursive: true, force: true }); } catch { /* bỏ qua */ }
        }
        // tmp/<jobId> tương thích cũ cũng có thể được tạo.
        __resetVideoHistoryForTests();
        resetConfig();
    });

    it('danh sách chỉ trả job của chính người dùng; admin thấy tất cả', async () => {
        const own = `hist_${RUN}_own`;
        const other = `hist_${RUN}_other`;
        const legacy = `hist_${RUN}_legacy`;
        await seedCompleted(own, A_ID, 'Video của A');
        await seedCompleted(other, B_ID, 'Video của B');
        await seedCompleted(legacy, undefined, 'Video legacy không chủ');

        const aList = await app.inject({ method: 'GET', url: '/api/jobs', cookies: { vidtml_session: tokenA } });
        assert.strictEqual(aList.statusCode, 200);
        const aJobs = aList.json();
        assert.ok(Array.isArray(aJobs), 'API không query phải giữ mảng để tương thích');
        assert.ok(aJobs.some((j: any) => j.jobId === own));
        assert.ok(!aJobs.some((j: any) => j.jobId === other));
        assert.ok(!aJobs.some((j: any) => j.jobId === legacy), 'job legacy không được lộ cho user thường');

        const bList = await app.inject({ method: 'GET', url: '/api/jobs', cookies: { vidtml_session: tokenB } });
        const bJobs = bList.json();
        assert.ok(!bJobs.some((j: any) => j.jobId === own));

        const adminList = await app.inject({
            method: 'GET',
            url: '/api/jobs?page=1&pageSize=50&format=page',
            cookies: { vidtml_session: tokenAdmin },
        });
        assert.strictEqual(adminList.statusCode, 200);
        const adminIds = adminList.json().items.map((j: any) => j.jobId);
        assert.ok(adminIds.includes(own));
        assert.ok(adminIds.includes(other));
        assert.ok(adminIds.includes(legacy));
    });

    it('chi tiết/stream/download/preview: B không đọc được job của A; ẩn danh 401', async () => {
        const jobId = `hist_${RUN}_artifact`;
        await seedCompleted(jobId, A_ID, 'Video có artifact');
        putFile(jobId, join('previews', 'scene-1.webp'), [1, 2, 3]);

        const detailA = await app.inject({
            method: 'GET', url: `/api/jobs/${jobId}`, cookies: { vidtml_session: tokenA },
        });
        assert.strictEqual(detailA.statusCode, 200);
        assert.strictEqual(detailA.json().result.videoAvailable, true);

        const detailB = await app.inject({
            method: 'GET', url: `/api/jobs/${jobId}`, cookies: { vidtml_session: tokenB },
        });
        assert.strictEqual(detailB.statusCode, 404, 'không được lộ sự tồn tại của job người khác');

        const videoA = await app.inject({
            method: 'GET', url: `/api/jobs/${jobId}/video`, cookies: { vidtml_session: tokenA },
        });
        assert.strictEqual(videoA.statusCode, 200);
        const videoB = await app.inject({
            method: 'GET', url: `/api/jobs/${jobId}/video`, cookies: { vidtml_session: tokenB },
        });
        assert.strictEqual(videoB.statusCode, 404);

        const downloadA = await app.inject({
            method: 'GET', url: `/api/jobs/${jobId}/download`, cookies: { vidtml_session: tokenA },
        });
        assert.strictEqual(downloadA.statusCode, 200);
        assert.match(String(downloadA.headers['content-disposition']), /attachment/);
        const downloadB = await app.inject({
            method: 'GET', url: `/api/jobs/${jobId}/download`, cookies: { vidtml_session: tokenB },
        });
        assert.strictEqual(downloadB.statusCode, 404);

        const previewA = await app.inject({
            method: 'GET', url: `/api/jobs/${jobId}/preview/scene-1`, cookies: { vidtml_session: tokenA },
        });
        assert.strictEqual(previewA.statusCode, 200);
        const previewB = await app.inject({
            method: 'GET', url: `/api/jobs/${jobId}/preview/scene-1`, cookies: { vidtml_session: tokenB },
        });
        assert.strictEqual(previewB.statusCode, 404);

        const anon = await app.inject({ method: 'GET', url: `/api/jobs/${jobId}` });
        assert.strictEqual(anon.statusCode, 401);
    });

    it('không trả đường dẫn filesystem; có canRestore và prompt/kịch bản đã lưu', async () => {
        const jobId = `hist_${RUN}_restore`;
        await seedCompleted(jobId, A_ID, 'Video khôi phục được', { script: true });
        const res = await app.inject({
            method: 'GET', url: `/api/jobs/${jobId}`, cookies: { vidtml_session: tokenA },
        });
        assert.strictEqual(res.statusCode, 200);
        const body = res.json();
        assert.strictEqual(body.canRestore, true);
        assert.strictEqual(body.request.prompt, 'Video khôi phục được');
        assert.strictEqual(body.script.scenes[0].id, 'scene-1');
        const raw = res.body;
        assert.ok(!raw.includes(process.cwd()), 'response không được chứa đường dẫn tuyệt đối');
        assert.ok(!raw.includes('workDir'));
        assert.ok(!raw.includes('imagePath'));
    });

    it('không trả watermark.logoPath (đường dẫn logo phía máy chủ)', async () => {
        const jobId = `hist_${RUN}_wm`;
        const request = {
            ...payload('Video có watermark'),
            watermark: { logoPath: '/srv/lime/private/brand/logo.png', position: 'top-right' },
        } as any;
        await recordVideoQueued({ jobId, userId: A_ID, topic: 'Video có watermark', request });
        await recordVideoCompleted(jobId, {
            durationSec: 12, resolution: '1920x1080', qaStatus: 'pass', videoPath: putFile(jobId),
        });
        const res = await app.inject({
            method: 'GET', url: `/api/jobs/${jobId}`, cookies: { vidtml_session: tokenA },
        });
        assert.strictEqual(res.statusCode, 200);
        const body = res.json();
        assert.strictEqual(body.request.watermark.logoPath, undefined);
        assert.strictEqual(body.request.watermark.position, 'top-right');
        assert.ok(!res.body.includes('/srv/lime/private'));
    });

    it('metadata completed nhưng tệp đã mất: videoAvailable=false và route video 404', async () => {
        const jobId = `hist_${RUN}_gone`;
        await seedCompleted(jobId, A_ID, 'Video mất tệp', { file: false });
        const detail = await app.inject({
            method: 'GET', url: `/api/jobs/${jobId}`, cookies: { vidtml_session: tokenA },
        });
        assert.strictEqual(detail.statusCode, 200);
        assert.strictEqual(detail.json().result.hasVideo, true);
        assert.strictEqual(detail.json().result.videoAvailable, false);

        const list = await app.inject({
            method: 'GET', url: '/api/jobs?page=1&pageSize=50&format=page', cookies: { vidtml_session: tokenA },
        });
        const row = list.json().items.find((j: any) => j.jobId === jobId);
        assert.strictEqual(row.videoAvailable, false);

        const video = await app.inject({
            method: 'GET', url: `/api/jobs/${jobId}/video`, cookies: { vidtml_session: tokenA },
        });
        assert.strictEqual(video.statusCode, 404);
    });

    it('lọc trạng thái: processing gộp queued+running, failed gộp failed+qa_failed', async () => {
        const queuedId = `hist_${RUN}_queued`;
        const runningId = `hist_${RUN}_running`;
        const failedId = `hist_${RUN}_failed`;
        const qaId = `hist_${RUN}_qa`;
        const cancelledId = `hist_${RUN}_cancelled`;
        await recordVideoQueued({ jobId: queuedId, userId: A_ID, topic: 'Đang chờ', request: payload('Đang chờ') });
        await recordVideoQueued({ jobId: runningId, userId: A_ID, topic: 'Đang chạy', request: payload('Đang chạy') });
        await recordVideoStarted(runningId);
        await recordVideoQueued({ jobId: failedId, userId: A_ID, topic: 'Thất bại', request: payload('Thất bại') });
        await recordVideoFailed(failedId, 'lỗi thử');
        await seedCompleted(qaId, A_ID, 'QA không đạt', { qaStatus: 'fail' });
        await recordVideoQueued({ jobId: cancelledId, userId: A_ID, topic: 'Đã hủy', request: payload('Đã hủy') });
        await recordVideoCancelled(cancelledId, 'người dùng hủy');

        async function ids(status: string): Promise<string[]> {
            const res = await app.inject({
                method: 'GET', url: `/api/jobs?page=1&pageSize=50&format=page&status=${status}`,
                cookies: { vidtml_session: tokenA },
            });
            assert.strictEqual(res.statusCode, 200);
            return res.json().items.map((j: any) => j.jobId);
        }

        const processing = await ids('processing');
        assert.ok(processing.includes(queuedId));
        assert.ok(processing.includes(runningId));
        assert.ok(!processing.includes(failedId));

        const failed = await ids('failed');
        assert.ok(failed.includes(failedId));
        assert.ok(failed.includes(qaId));

        const cancelled = await ids('cancelled');
        assert.ok(cancelled.includes(cancelledId));
        assert.ok(!cancelled.includes(failedId));

        const completed = await ids('completed');
        assert.ok(!completed.includes(qaId), 'qa_failed không được coi là completed');

        const bad = await app.inject({
            method: 'GET', url: '/api/jobs?status=khong-hop-le', cookies: { vidtml_session: tokenA },
        });
        assert.strictEqual(bad.statusCode, 400);
    });

    it('tìm kiếm, sắp xếp, phân trang', async () => {
        const prefix = `hist_${RUN}_pg`;
        for (let i = 0; i < 5; i++) {
            await seedCompleted(`${prefix}_${i}`, A_ID, i % 2 === 0 ? `Zeta video ${i}` : `Alpha video ${i}`);
            await new Promise((r) => setTimeout(r, 3));
        }

        const search = await app.inject({
            method: 'GET', url: `/api/jobs?page=1&pageSize=50&format=page&q=zeta`,
            cookies: { vidtml_session: tokenA },
        });
        assert.strictEqual(search.statusCode, 200);
        const searchItems = search.json().items;
        assert.ok(searchItems.length >= 3);
        assert.ok(searchItems.every((j: any) => j.topic.toLowerCase().includes('zeta')));

        const byId = await app.inject({
            method: 'GET', url: `/api/jobs?page=1&pageSize=50&format=page&q=${prefix}_3`,
            cookies: { vidtml_session: tokenA },
        });
        assert.ok(byId.json().items.some((j: any) => j.jobId === `${prefix}_3`));

        const none = await app.inject({
            method: 'GET', url: '/api/jobs?page=1&pageSize=50&format=page&q=khong_bao_gio_khop_xyz',
            cookies: { vidtml_session: tokenA },
        });
        assert.strictEqual(none.json().total, 0);

        const page1 = await app.inject({
            method: 'GET', url: '/api/jobs?page=1&pageSize=2&format=page&sort=newest',
            cookies: { vidtml_session: tokenA },
        });
        const page2 = await app.inject({
            method: 'GET', url: '/api/jobs?page=2&pageSize=2&format=page&sort=newest',
            cookies: { vidtml_session: tokenA },
        });
        assert.strictEqual(page1.json().items.length, 2);
        assert.strictEqual(page2.json().items.length, 2);
        assert.notStrictEqual(page1.json().items[0].jobId, page2.json().items[0].jobId);
        assert.ok(page1.json().totalPages >= 2);

        const alpha = await app.inject({
            method: 'GET', url: '/api/jobs?page=1&pageSize=50&format=page&sort=name-asc',
            cookies: { vidtml_session: tokenA },
        });
        const topics = alpha.json().items.map((j: any) => j.topic);
        const sorted = [...topics].sort((a, b) => a.localeCompare(b, 'vi'));
        assert.deepStrictEqual(topics, sorted);
    });

    it('xoá: chủ sở hữu được xoá; người khác 404; job đang chạy 409; xoá đồng thời không 500', async () => {
        const own = `hist_${RUN}_del_own`;
        const others = `hist_${RUN}_del_other`;
        const running = `hist_${RUN}_del_running`;
        const concurrent = `hist_${RUN}_del_concurrent`;
        await seedCompleted(own, A_ID, 'Xoá được');
        await seedCompleted(others, A_ID, 'Không cho B xoá');
        await recordVideoQueued({ jobId: running, userId: A_ID, topic: 'Đang chạy', request: payload('Đang chạy') });
        await recordVideoStarted(running);
        await seedCompleted(concurrent, A_ID, 'Xoá đồng thời');

        const dirOwn = safeJobDir(own)!;
        const dirOthers = safeJobDir(others)!;

        const blockB = await app.inject({
            method: 'DELETE', url: `/api/jobs/${others}`, cookies: { vidtml_session: tokenB },
        });
        assert.strictEqual(blockB.statusCode, 404);
        assert.ok(existsSync(dirOthers), 'B không được xoá artifact của A');

        const active = await app.inject({
            method: 'DELETE', url: `/api/jobs/${running}`, cookies: { vidtml_session: tokenA },
        });
        assert.strictEqual(active.statusCode, 409);

        const delOwn = await app.inject({
            method: 'DELETE', url: `/api/jobs/${own}`, cookies: { vidtml_session: tokenA },
        });
        assert.strictEqual(delOwn.statusCode, 200, delOwn.body);
        assert.strictEqual(existsSync(dirOwn), false);
        const gone = await app.inject({
            method: 'GET', url: `/api/jobs/${own}`, cookies: { vidtml_session: tokenA },
        });
        assert.strictEqual(gone.statusCode, 404);

        const [c1, c2] = await Promise.all([
            app.inject({ method: 'DELETE', url: `/api/jobs/${concurrent}`, cookies: { vidtml_session: tokenA } }),
            app.inject({ method: 'DELETE', url: `/api/jobs/${concurrent}`, cookies: { vidtml_session: tokenA } }),
        ]);
        assert.ok([c1.statusCode, c2.statusCode].includes(200));
        assert.ok([c1.statusCode, c2.statusCode].every((code) => [200, 404].includes(code)));

        const anon = await app.inject({ method: 'DELETE', url: `/api/jobs/${others}` });
        assert.strictEqual(anon.statusCode, 401);
    });

    it('job chỉ còn trong queue: chủ sở hữu đọc được, legacy bị ẩn với user thường', async () => {
        const liveId = `hist_${RUN}_live`;
        const legacyLive = `hist_${RUN}_live_legacy`;
        const blockedId = `hist_${RUN}_live_block`;

        await enqueueLive(liveId, A_ID, 'job chỉ trong queue');
        await waitForStatus(liveId, ['completed']);
        await enqueueLive(legacyLive, undefined, 'job legacy chỉ trong queue');
        await waitForStatus(legacyLive, ['completed']);

        const live = await app.inject({
            method: 'GET', url: `/api/jobs/${liveId}`, cookies: { vidtml_session: tokenA },
        });
        assert.strictEqual(live.statusCode, 200);
        assert.strictEqual(live.json().result.videoAvailable, true);
        const liveVideo = await app.inject({
            method: 'GET', url: `/api/jobs/${liveId}/video`, cookies: { vidtml_session: tokenA },
        });
        assert.strictEqual(liveVideo.statusCode, 200);

        const legacyAsUser = await app.inject({
            method: 'GET', url: `/api/jobs/${legacyLive}`, cookies: { vidtml_session: tokenA },
        });
        assert.strictEqual(legacyAsUser.statusCode, 404);

        const legacyAsAdmin = await app.inject({
            method: 'GET', url: `/api/jobs/${legacyLive}`, cookies: { vidtml_session: tokenAdmin },
        });
        assert.strictEqual(legacyAsAdmin.statusCode, 200);

        // Job đang chạy: xoá phải bị chặn, không được dọn artifact khi worker còn ghi.
        await enqueueLive(blockedId, A_ID, '__block__');
        await waitForStatus(blockedId, ['running']);
        const blockedDelete = await app.inject({
            method: 'DELETE', url: `/api/jobs/${blockedId}`, cookies: { vidtml_session: tokenA },
        });
        assert.strictEqual(blockedDelete.statusCode, 409);
        blockers.get(blockedId)?.();
        await waitForStatus(blockedId, ['completed']);
    });
});
