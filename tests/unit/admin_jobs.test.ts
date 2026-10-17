import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { type FastifyInstance } from 'fastify';
import { buildApp } from '../../src/index.js';
import { createTestSession } from '../../src/auth/session.js';
import { userStore } from '../../src/admin/userStore.js';
import { getConfig } from '../../src/config.js';
import { db, initDatabase } from '../../src/database/index.js';
import { MemoryQueue } from '../../src/queue/memoryQueue.js';
import { type JobData, type JobRecord } from '../../src/queue/interfaces.js';
import { systemSettings } from '../../src/admin/systemSettings.js';

/**
 * Bộ test cho module "Video Jobs" của cổng quản trị.
 *
 * Trọng tâm (theo kết quả audit nghiệp vụ):
 *  - Job phải lưu chủ sở hữu (`userId`) → trước đây mọi job hiển thị "Anonymous"
 *    và tìm kiếm theo email người dùng không bao giờ khớp.
 *  - `POST /cancel` trước đây chỉ ghi audit log, không hủy gì → nay hủy thật và
 *    chặn hủy job đã kết thúc.
 *  - `POST /retry` và `PATCH /:jobId` trước đây không tồn tại (404) dù frontend
 *    vẫn gọi → nay có, kèm validate.
 *  - `DELETE` trước đây chỉ xoá thư mục (và sai cả đường dẫn), job vẫn còn trong
 *    danh sách → nay xoá cả khỏi hàng đợi.
 *  - `GET /api/admin/jobs` trước đây nạp toàn bộ bảng người dùng, không phân
 *    trang, không validate `status` → nay validate + phân trang + tra email theo
 *    đúng các job trả về.
 */

const ADMIN_ID = '00000000-0000-4000-a000-000000000001';

/** Hậu tố duy nhất mỗi lần chạy để không đụng dữ liệu cũ. */
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
const TOKEN = `zq${RUN}x`;

const config = getConfig();

function pipelinePayload(prompt: string) {
    return {
        prompt,
        async: true,
        targetDurationSec: 15,
        aspectRatio: '16:9',
        language: 'en',
        style: 'modern',
    };
}

describe('Admin Jobs Management Test Suite', () => {
    let app: FastifyInstance;
    let queue: MemoryQueue;
    let adminToken: string;
    let userToken: string;
    let ownerId: string;
    const ownerEmail = `jobtest_${TOKEN}_owner@example.com`;
    const ownerUsername = `jt_${TOKEN}_owner`;
    /** Job "__block__" bị giữ ở trạng thái đang chạy cho tới khi được giải phóng. */
    const blockedJobs = new Map<string, () => void>();

    /** Tạo job qua API (async) và chờ tới khi kết thúc. */
    async function createFinishedJob(token = userToken): Promise<string> {
        const res = await app.inject({
            method: 'POST',
            url: '/api/pipeline',
            cookies: { vidtml_session: token },
            payload: pipelinePayload(`job test ${TOKEN}`),
        });
        assert.strictEqual(res.statusCode, 202, res.body);
        const jobId = res.json().jobId as string;

        for (let i = 0; i < 60; i++) {
            const detail = await app.inject({
                method: 'GET',
                url: `/api/admin/jobs/${jobId}`,
                cookies: { vidtml_session: adminToken },
            });
            if (detail.statusCode === 200 && ['completed', 'failed', 'qa_failed'].includes(detail.json().status)) {
                break;
            }
            await new Promise((r) => setTimeout(r, 25));
        }
        return jobId;
    }

    before(async () => {
        if (config.DATABASE_URL) {
            await initDatabase();
        }

        ownerId = randomUUID();
        if (config.DATABASE_URL) {
            await db.query(
                `INSERT INTO users (id, username, email, password_hash, role, tier, credits, total_credits, status, plan_id)
                 VALUES ($1,$2,$3,$4,'user','free',20,300,'active',NULL)
                 ON CONFLICT (id) DO NOTHING`,
                [ownerId, ownerUsername, ownerEmail, null]
            );
        }
        await userStore.upsertUser({ id: ownerId, username: ownerUsername, email: ownerEmail });

        queue = new MemoryQueue();
        app = await buildApp({ queue, logger: false });
        await app.ready();

        // buildApp đăng ký pipeline thật; thay bằng handler giả để test nhanh, tất định.
        queue.process(async (data, update) => {
            await update({ phase: 'test', progress: 10, message: 'processing' });
            if (String(data.request?.prompt || '').includes('__fail__')) {
                throw new Error('cố ý thất bại để kiểm thử');
            }
            if (String(data.request?.prompt || '').includes('__block__')) {
                await new Promise<void>((resolve) => blockedJobs.set(data.jobId, resolve));
            }
            if (String(data.request?.prompt || '').includes('__degraded__')) {
                // QA thất bại nhưng pipeline vẫn render ra video (graceful degradation).
                return {
                    jobId: data.jobId,
                    durationSec: 12,
                    videoPath: `/tmp/${data.jobId}/final_video.mp4`,
                    qaStatus: 'fail',
                    qaReport: { jobId: data.jobId, qaStatus: 'fail', valid: false, degraded: true, errors: ['[RHYTHM] Lỗi nhịp điệu'], warnings: [] },
                } as any;
            }
            return { jobId: data.jobId, durationSec: 12, qaStatus: 'pass' } as any;
        });

        adminToken = createTestSession(ADMIN_ID);
        userToken = createTestSession(ownerId);
    });

    after(async () => {
        for (const resolve of blockedJobs.values()) resolve();
        await app.close();
    });

    it('Ghi nhận chủ sở hữu job và trả về email thật (thay vì Anonymous)', async () => {
        const jobId = await createFinishedJob();
        const res = await app.inject({
            method: 'GET',
            url: `/api/admin/jobs/${jobId}`,
            cookies: { vidtml_session: adminToken },
        });
        assert.strictEqual(res.statusCode, 200, res.body);
        const body = res.json();
        assert.strictEqual(body.userId, ownerId, 'Job phải lưu userId của người tạo');
        assert.strictEqual(body.userEmail, ownerEmail, 'Phải tra được email người tạo');
    });

    it('Danh sách job trả về email người tạo và tổng số dòng', async () => {
        const jobId = await createFinishedJob();
        const res = await app.inject({
            method: 'GET',
            url: `/api/admin/jobs?status=all`,
            cookies: { vidtml_session: adminToken },
        });
        assert.strictEqual(res.statusCode, 200, res.body);
        const body = res.json();
        const job = body.jobs.find((j: any) => j.jobId === jobId);
        assert.ok(job, 'Phải thấy job vừa tạo trong danh sách');
        assert.strictEqual(job.userEmail, ownerEmail, 'Danh sách phải hiển thị email thật');
        assert.ok(body.total >= 1, 'Phải trả về tổng số job');
    });

    it('Tìm kiếm theo email người tạo tìm đúng job', async () => {
        const jobId = await createFinishedJob();
        const res = await app.inject({
            method: 'GET',
            url: `/api/admin/jobs?search=${encodeURIComponent(ownerEmail)}`,
            cookies: { vidtml_session: adminToken },
        });
        assert.strictEqual(res.statusCode, 200, res.body);
        const ids = res.json().jobs.map((j: any) => j.jobId);
        assert.ok(ids.includes(jobId), 'Tìm theo email phải trả về job của người đó');
    });

    it('Từ chối trạng thái không hợp lệ khi lọc', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/admin/jobs?status=khong-ton-tai',
            cookies: { vidtml_session: adminToken },
        });
        assert.strictEqual(res.statusCode, 400);
    });

    it('Phân trang chỉ khi client gửi limit', async () => {
        await createFinishedJob();
        const res = await app.inject({
            method: 'GET',
            url: '/api/admin/jobs?limit=1&page=1',
            cookies: { vidtml_session: adminToken },
        });
        assert.strictEqual(res.statusCode, 200);
        const body = res.json();
        assert.strictEqual(body.jobs.length, 1, 'limit=1 phải trả về đúng 1 job');
        assert.strictEqual(body.page, 1);
        assert.strictEqual(body.limit, 1);
        assert.ok(body.total >= 1);
    });

    it('PATCH cập nhật thời lượng mục tiêu và validate dữ liệu', async () => {
        const jobId = await createFinishedJob();

        const bad = await app.inject({
            method: 'PATCH',
            url: `/api/admin/jobs/${jobId}`,
            cookies: { vidtml_session: adminToken },
            payload: { targetDurationSec: 5 },
        });
        assert.strictEqual(bad.statusCode, 400, 'Thời lượng < 10 giây phải bị từ chối');

        const badScript = await app.inject({
            method: 'PATCH',
            url: `/api/admin/jobs/${jobId}`,
            cookies: { vidtml_session: adminToken },
            payload: { script: {} },
        });
        assert.strictEqual(badScript.statusCode, 400, 'Kịch bản không hợp lệ phải bị từ chối');

        const empty = await app.inject({
            method: 'PATCH',
            url: `/api/admin/jobs/${jobId}`,
            cookies: { vidtml_session: adminToken },
            payload: {},
        });
        assert.strictEqual(empty.statusCode, 400, 'Không có trường nào để cập nhật');

        const ok = await app.inject({
            method: 'PATCH',
            url: `/api/admin/jobs/${jobId}`,
            cookies: { vidtml_session: adminToken },
            payload: { targetDurationSec: 42 },
        });
        assert.strictEqual(ok.statusCode, 200, ok.body);

        const detail = await app.inject({
            method: 'GET',
            url: `/api/admin/jobs/${jobId}`,
            cookies: { vidtml_session: adminToken },
        });
        assert.strictEqual(detail.json().request.targetDurationSec, 42, 'Thời lượng mới phải được lưu');
    });

    it('PATCH trả 404 khi job không tồn tại', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: `/api/admin/jobs/${randomUUID()}`,
            cookies: { vidtml_session: adminToken },
            payload: { targetDurationSec: 20 },
        });
        assert.strictEqual(res.statusCode, 404);
    });

    it('Không thể hủy job đã kết thúc', async () => {
        const jobId = await createFinishedJob();
        const res = await app.inject({
            method: 'POST',
            url: `/api/admin/jobs/${jobId}/cancel`,
            cookies: { vidtml_session: adminToken },
        });
        assert.strictEqual(res.statusCode, 409, res.body);
    });

    it('Hủy job đang chạy qua route thì trạng thái chuyển thành cancelled', async () => {
        const jobId = `block-${TOKEN}-${randomUUID().slice(0, 8)}`;
        await queue.addJob(jobId, {
            jobId,
            userId: ownerId,
            request: { prompt: '__block__ job đang chạy' } as any,
            outputDir: `/tmp/${jobId}`,
        });

        let status = '';
        for (let i = 0; i < 60; i++) {
            const r = await app.inject({
                method: 'GET',
                url: `/api/admin/jobs/${jobId}`,
                cookies: { vidtml_session: adminToken },
            });
            if (r.statusCode === 200 && r.json().status === 'running') {
                status = 'running';
                break;
            }
            await new Promise((r2) => setTimeout(r2, 25));
        }
        assert.strictEqual(status, 'running', 'Job phải đang chạy trước khi hủy');

        const res = await app.inject({
            method: 'POST',
            url: `/api/admin/jobs/${jobId}/cancel`,
            cookies: { vidtml_session: adminToken },
        });
        assert.strictEqual(res.statusCode, 200, res.body);

        const detail = await app.inject({
            method: 'GET',
            url: `/api/admin/jobs/${jobId}`,
            cookies: { vidtml_session: adminToken },
        });
        assert.strictEqual(detail.json().status, 'cancelled', 'Job phải chuyển sang cancelled');

        blockedJobs.get(jobId)?.();
        blockedJobs.delete(jobId);
        await queue.removeJob(jobId);
    });

    it('Không thể chạy lại job chưa thất bại', async () => {
        const jobId = await createFinishedJob();
        const res = await app.inject({
            method: 'POST',
            url: `/api/admin/jobs/${jobId}/retry`,
            cookies: { vidtml_session: adminToken },
        });
        assert.strictEqual(res.statusCode, 409, res.body);
    });

    it('Chạy lại job thất bại qua route', async () => {
        const jobId = `fail-${TOKEN}-${randomUUID().slice(0, 8)}`;
        await queue.addJob(jobId, {
            jobId,
            userId: ownerId,
            request: { prompt: '__fail__ job thất bại' } as any,
            outputDir: `/tmp/${jobId}`,
        });

        let status = '';
        for (let i = 0; i < 60; i++) {
            const r = await app.inject({
                method: 'GET',
                url: `/api/admin/jobs/${jobId}`,
                cookies: { vidtml_session: adminToken },
            });
            if (r.statusCode === 200 && ['failed', 'completed', 'qa_failed'].includes(r.json().status)) {
                status = r.json().status;
                break;
            }
            await new Promise((r2) => setTimeout(r2, 25));
        }
        assert.strictEqual(status, 'failed', 'Job phải thất bại trước khi chạy lại');

        const res = await app.inject({
            method: 'POST',
            url: `/api/admin/jobs/${jobId}/retry`,
            cookies: { vidtml_session: adminToken },
        });
        assert.strictEqual(res.statusCode, 200, res.body);

        await queue.removeJob(jobId);
    });

    it('DELETE xoá job khỏi hàng đợi (không còn trong danh sách)', async () => {
        const jobId = await createFinishedJob();
        const del = await app.inject({
            method: 'DELETE',
            url: `/api/admin/jobs/${jobId}`,
            cookies: { vidtml_session: adminToken },
        });
        assert.strictEqual(del.statusCode, 200, del.body);

        const detail = await app.inject({
            method: 'GET',
            url: `/api/admin/jobs/${jobId}`,
            cookies: { vidtml_session: adminToken },
        });
        assert.strictEqual(detail.statusCode, 404, 'Sau khi xoá, job phải không còn tồn tại');

        const delAgain = await app.inject({
            method: 'DELETE',
            url: `/api/admin/jobs/${jobId}`,
            cookies: { vidtml_session: adminToken },
        });
        assert.strictEqual(delAgain.statusCode, 404);
    });

    it('Không có quyền quản trị thì bị chặn 403', async () => {
        const jobId = await createFinishedJob();
        for (const req of [
            { method: 'GET' as const, url: '/api/admin/jobs' },
            { method: 'GET' as const, url: `/api/admin/jobs/${jobId}` },
            { method: 'POST' as const, url: `/api/admin/jobs/${jobId}/cancel` },
            { method: 'POST' as const, url: `/api/admin/jobs/${jobId}/retry` },
            { method: 'PATCH' as const, url: `/api/admin/jobs/${jobId}`, payload: { targetDurationSec: 20 } },
        ]) {
            const res = await app.inject({ ...req, cookies: { vidtml_session: userToken } });
            assert.strictEqual(res.statusCode, 403, `${req.method} ${req.url} phải trả 403 cho user thường`);
        }
    });

    it('Job QA thất bại nhưng vẫn render (degraded) hiện đúng qa_failed + cờ degraded + có video', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/pipeline',
            cookies: { vidtml_session: userToken },
            payload: pipelinePayload(`__degraded__ job test ${TOKEN}`),
        });
        assert.strictEqual(res.statusCode, 202, res.body);
        const jobId = res.json().jobId as string;

        let detail: any = null;
        for (let i = 0; i < 60; i++) {
            detail = await app.inject({
                method: 'GET',
                url: `/api/admin/jobs/${jobId}`,
                cookies: { vidtml_session: adminToken },
            });
            if (detail.statusCode === 200 && ['completed', 'failed', 'qa_failed'].includes(detail.json().status)) {
                break;
            }
            await new Promise((r) => setTimeout(r, 25));
        }

        const detailBody = detail.json();
        // Kết luận QA trung thực: vẫn fail, nhưng video vẫn tồn tại (không abort).
        assert.strictEqual(detailBody.status, 'qa_failed', detail.body);
        assert.strictEqual(detailBody.qaStatus, 'fail');
        assert.strictEqual(detailBody.degraded, true);
        assert.strictEqual(detailBody.result?.hasVideo, true, 'Vẫn phải có video dù QA thất bại');

        // Job phải xuất hiện trong bộ lọc qa_failed kèm cờ suy giảm chất lượng.
        const list = await app.inject({
            method: 'GET',
            url: `/api/admin/jobs?status=qa_failed&search=${encodeURIComponent(jobId)}`,
            cookies: { vidtml_session: adminToken },
        });
        assert.strictEqual(list.statusCode, 200, list.body);
        const found = list.json().jobs.find((j: any) => j.jobId === jobId);
        assert.ok(found, 'Job degraded phải xuất hiện trong bộ lọc qa_failed');
        assert.strictEqual(found.degraded, true);
        assert.strictEqual(found.hasVideo, true);

        // Và chạy lại được (nút "Thử lại" của qa_failed có ý nghĩa trở lại).
        const retry = await app.inject({
            method: 'POST',
            url: `/api/admin/jobs/${jobId}/retry`,
            cookies: { vidtml_session: adminToken },
        });
        assert.ok([200, 202].includes(retry.statusCode), `Retry phải được chấp nhận: ${retry.body}`);

        await new Promise((r) => setTimeout(r, 50));
        await queue.removeJob(jobId);
    });
});

describe('MemoryQueue: thao tác quản trị job (unit)', () => {
    let queue: MemoryQueue;
    const deferred = new Map<string, () => void>();
    let block = true;

    function baseData(jobId: string): JobData {
        return {
            jobId,
            userId: randomUUID(),
            request: { prompt: `unit ${jobId}` } as any,
            outputDir: `/tmp/${jobId}`,
        };
    }

    let previousConcurrency = 2;

    before(async () => {
        // Số job chạy song song nay lấy từ cài đặt quản trị — đặt cố định = 2 để test tất định.
        previousConcurrency = systemSettings.get().maxConcurrentJobs;
        systemSettings.update({ maxConcurrentJobs: 2 });

        queue = new MemoryQueue();
        queue.process(async (data) => {
            if (block) {
                await new Promise<void>((resolve) => deferred.set(data.jobId, resolve));
            }
            return { jobId: data.jobId, durationSec: 12, qaStatus: 'pass' } as any;
        });
    });

    after(async () => {
        for (const resolve of deferred.values()) resolve();
        await queue.close();
        systemSettings.update({ maxConcurrentJobs: previousConcurrency });
    });

    it('Hủy job đang chờ: không bao giờ chạy và chuyển trạng thái cancelled', async () => {
        // Chiếm 2 suất chạy song song để job thứ ba nằm ở hàng chờ.
        await queue.addJob('q-run-1', baseData('q-run-1'));
        await queue.addJob('q-run-2', baseData('q-run-2'));
        await queue.addJob('q-wait-1', baseData('q-wait-1'));
        await new Promise((r) => setTimeout(r, 10));

        const before = await queue.getJob('q-wait-1');
        assert.strictEqual(before?.status, 'queued', 'Job thứ ba phải đang chờ');

        const ok = await queue.cancelJob('q-wait-1');
        assert.strictEqual(ok, true);
        const record = await queue.getJob('q-wait-1');
        assert.strictEqual(record?.status, 'cancelled');
        assert.strictEqual(await queue.cancelJob('q-wait-1'), false, 'Không thể hủy lại job đã hủy');
    });

    it('Hủy job đang chạy: giữ trạng thái cancelled sau khi handler kết thúc', async () => {
        const ok = await queue.cancelJob('q-run-1');
        assert.strictEqual(ok, true);
        const rec = await queue.getJob('q-run-1');
        assert.strictEqual(rec?.status, 'cancelled');

        deferred.get('q-run-1')?.();
        await new Promise((r) => setTimeout(r, 20));
        const afterRun = await queue.getJob('q-run-1');
        assert.strictEqual(afterRun?.status, 'cancelled', 'Handler kết thúc không được ghi đè trạng thái đã hủy');
    });

    it('Chạy lại job đã hủy: quay về hàng đợi rồi hoàn thành', async () => {
        block = false;
        const ok = await queue.retryJob('q-wait-1');
        assert.strictEqual(ok, true);
        await new Promise((r) => setTimeout(r, 20));
        const rec = await queue.getJob('q-wait-1');
        assert.strictEqual(rec?.status, 'completed', 'Sau khi chạy lại, job phải hoàn thành');
    });

    it('Không chạy lại job đang chờ hoặc đang chạy', async () => {
        // q-run-2 đang chạy (đã bị chặn) — không thể retry.
        const rec = await queue.getJob('q-run-2');
        assert.strictEqual(rec?.status, 'running');
        assert.strictEqual(await queue.retryJob('q-run-2'), false);
    });

    it('updateJob lưu thời lượng/kịch bản để lần chạy lại dùng lại', async () => {
        const updated = await queue.updateJob('q-wait-1', {
            targetDurationSec: 33,
            script: { id: 's', title: 't', scenes: [] } as any,
        });
        assert.ok(updated);
        assert.strictEqual((updated as JobRecord).request.targetDurationSec, 33);
        assert.ok((updated as JobRecord).script, 'Phải lưu kịch bản');
    });

    it('removeJob xoá hẳn job khỏi hàng đợi và bộ lưu trạng thái', async () => {
        assert.strictEqual(await queue.removeJob('q-wait-1'), true);
        assert.strictEqual(await queue.getJob('q-wait-1'), null);
        assert.strictEqual(await queue.removeJob('q-wait-1'), false);
    });
});
