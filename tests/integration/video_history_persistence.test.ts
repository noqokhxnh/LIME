import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { getConfig } from '../../src/config.js';
import { db, initDatabase } from '../../src/database/index.js';
import {
    deleteVideoHistory,
    getVideoHistory,
    listVideoHistory,
    recordVideoCompleted,
    recordVideoQueued,
    __resetVideoHistoryForTests,
} from '../../src/history/store.js';

/**
 * Độ bền của "Video của tôi" trên PostgreSQL thật.
 *
 * Chỉ chạy khi có DATABASE_URL. Mục tiêu: chứng minh metadata sống ngoài bộ nhớ
 * tiến trình — tương đương việc API/worker restart hoặc queue Redis bị prune.
 * Không kiểm tra file MP4 (thư mục tmp là artifact tạm, không thuộc DB).
 */
const hasDb = Boolean(getConfig().DATABASE_URL);
const skip = hasDb ? false : 'DATABASE_URL chưa cấu hình — bỏ qua test PostgreSQL thật';

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
const USER_A = randomUUID();
const USER_B = randomUUID();
const JOB_IDS = [`hist_it_${RUN}_a`, `hist_it_${RUN}_b`];

describe('Video history — bền vững trên PostgreSQL', { skip }, () => {
    before(async () => {
        if (!hasDb) return;
        await initDatabase();
        await db.query(
            `INSERT INTO users (id, username, email, password_hash, role, tier, credits, total_credits, status, plan_id)
             VALUES ($1,$2,$3,$4,'user','free',20,20,'active',NULL),
                    ($5,$6,$7,$4,'user','free',20,20,'active',NULL)
             ON CONFLICT (id) DO NOTHING`,
            [
                USER_A, `it_hist_a_${RUN}`, `it_hist_a_${RUN}@test.local`, null,
                USER_B, `it_hist_b_${RUN}`, `it_hist_b_${RUN}@test.local`,
            ]
        );
    });

    after(async () => {
        if (!hasDb) return;
        for (const jobId of JOB_IDS) await deleteVideoHistory(jobId);
        await db.query('DELETE FROM video_history WHERE job_id LIKE $1', [`hist_it_${RUN}%`]);
        await db.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[USER_A, USER_B]]);
        __resetVideoHistoryForTests();
    });

    it('migration video_history đã áp dụng', async () => {
        const res = await db.query('SELECT version FROM schema_migrations WHERE version = $1', ['009_video_history']);
        assert.strictEqual(res.rows.length, 1);
    });

    it('metadata sống lại sau khi mất bộ nhớ tiến trình (mô phỏng restart)', async () => {
        const jobId = JOB_IDS[0];
        await recordVideoQueued({
            jobId,
            userId: USER_A,
            topic: 'Video bền vững',
            request: {
                prompt: 'Video bền vững',
                targetDurationSec: 15,
                aspectRatio: '16:9',
                language: 'vi',
                style: 'modern',
            } as any,
        });
        await recordVideoCompleted(jobId, {
            durationSec: 21.5,
            resolution: '1920x1080',
            qaStatus: 'pass',
            videoPath: `/tmp/khong-ton-tai/${jobId}.mp4`,
        });

        // Xoá Map in-memory: mọi lần đọc sau phải đến từ PostgreSQL.
        __resetVideoHistoryForTests();

        const fromDb = await getVideoHistory(jobId);
        assert.ok(fromDb, 'bản ghi phải còn sau khi reset bộ nhớ');
        assert.strictEqual(fromDb!.status, 'completed');
        assert.strictEqual(fromDb!.userId, USER_A);
        assert.strictEqual(fromDb!.durationSec, 21.5);
        assert.strictEqual(fromDb!.resolution, '1920x1080');
        assert.ok(fromDb!.completedAt, 'completed_at phải được ghi');
    });

    it('truy vấn lịch sử luôn lọc theo user_id', async () => {
        const own = await listVideoHistory({ userId: USER_A, q: `hist_it_${RUN}` });
        assert.ok(own.items.some((row) => row.jobId === JOB_IDS[0]));

        const other = await listVideoHistory({ userId: USER_B, q: `hist_it_${RUN}` });
        assert.strictEqual(other.items.length, 0, 'B không được thấy lịch sử của A');

        const otherGet = await getVideoHistory(JOB_IDS[0]);
        assert.strictEqual(otherGet!.userId, USER_A);
    });

    it('xoá lịch sử xoá metadata trong DB', async () => {
        assert.strictEqual(await deleteVideoHistory(JOB_IDS[0]), true);
        __resetVideoHistoryForTests();
        assert.strictEqual(await getVideoHistory(JOB_IDS[0]), null);
    });
});
