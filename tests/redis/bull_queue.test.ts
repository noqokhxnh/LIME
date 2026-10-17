/**
 * Test `BullMQQueue` — hàng đợi render thật dùng BullMQ + Redis (chế độ `QUEUE_TYPE=redis`
 * của môi trường chạy thật).
 *
 * Vì sao cần: `bullQueue.ts` là mã chạy ở production nhưng trước đây KHÔNG có test nào chạy
 * nó — nhóm `queue.test.ts` cũ chỉ kiểm `MemoryQueue`. Mọi đường ít dùng nhưng nguy hiểm
 * (huỷ job đang chạy, chạy lại job lỗi, job QA hỏng) chỉ được kiểm ở đây.
 *
 * Nhóm `redis` chỉ chạy khi có Redis thật (job đêm trong CI, hoặc máy phát triển có
 * `REDIS_URL`); nếu `redis-cli ping` không trả lời thì cả file tự bỏ qua thay vì đỏ.
 */
import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { BullMQQueue } from '../../src/queue/bullQueue.js';
import { hashString32 } from '../../src/pipeline/rng.js';
import { isolatedRedisUrl, connectForCleanup } from './test-redis.js';
import type { JobData, JobRecord } from '../../src/queue/interfaces.js';
import type { fullPipelineResult } from '../../src/pipeline/orchestrator.js';

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

/**
 * Test dùng một database riêng trong Redis (db 9) chứ không dùng db mặc định:
 *
 * - không đụng vào hàng đợi thật nếu máy phát triển đang chạy server/worker;
 * - `BullMQQueue` dùng CỐ ĐỊNH tên hàng đợi `video-generation`, nên job chưa xử lý của ca
 *   test trước sẽ bị worker của ca sau nhặt lên nếu mọi ca dùng chung một khoá (đã gặp
 *   thật: một ca đếm số lần handler chạy bị sai vì worker nhặt cả job còn sót của ca trước);
 * - mỗi file test có một database riêng vì `node --test` chạy các file song song (xem
 *   `tests/redis/test-redis.ts`).
 */
const TEST_REDIS_URL = isolatedRedisUrl(9, REDIS_URL);

/** Kết quả pipeline giả — chỉ cần đủ trường mà `mapJob` đọc tới. */
function fakeResult(qaStatus: 'pass' | 'warn' | 'fail' = 'pass'): fullPipelineResult {
    return {
        qaStatus,
        qaReport: { overall: qaStatus, checks: [] },
    } as unknown as fullPipelineResult;
}

function jobData(overrides: Partial<JobData> = {}): JobData {
    return {
        jobId: 'placeholder',
        userId: 'user-redis-test',
        outputDir: '/tmp/opencode/lime-redis-test',
        request: { prompt: 'chú mèo chạy trên máy chạy bộ' } as unknown as JobData['request'],
        ...overrides,
    };
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Chờ một điều kiện đúng (dùng cho sự kiện/hàng đợi bất đồng bộ). */
async function waitFor(condition: () => boolean, message: string, timeoutMs = 20000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (condition()) return;
        await delay(50);
    }
    throw new Error(`Hết thời gian chờ: ${message}`);
}

async function waitForJob(
    queue: BullMQQueue,
    jobId: string,
    predicate: (record: JobRecord | null) => boolean,
    message: string,
    timeoutMs = 30000,
): Promise<JobRecord | null> {
    const deadline = Date.now() + timeoutMs;
    let last: JobRecord | null = null;
    while (Date.now() < deadline) {
        last = await queue.getJob(jobId);
        if (predicate(last)) return last;
        await delay(50);
    }
    throw new Error(`Hết thời gian chờ: ${message} (trạng thái cuối: ${last?.status ?? 'không có job'})`);
}

/**
 * Chờ bộ nghe sự kiện đăng ký xong với Redis. Không chờ thì sự kiện có thể phát ra trước
 * khi đăng ký hoàn tất và bị bỏ lỡ (đã gặp thật: ca kiểm sự kiện `failed` chạy một mình
 * thì xanh, chạy cùng cả file thì hết thời gian chờ).
 */
async function waitForListeners(queue: BullMQQueue): Promise<void> {
    const events = (queue as unknown as { queueEvents?: { waitUntilReady: () => Promise<void> } }).queueEvents;
    await events?.waitUntilReady();
}

/** Mở một hàng đợi và luôn đóng lại sau khi xong (không để rò rỉ kết nối Redis). */
async function withQueue<T>(fn: (queue: BullMQQueue) => Promise<T>): Promise<T> {
    const queue = new BullMQQueue(TEST_REDIS_URL);
    try {
        return await fn(queue);
    } finally {
        await queue.close();
    }
}

/** Client giữ mở để dọn dẹp giữa các ca test; đóng ở hook `after`. */
let redisClient: Redis | null = null;

redisClient = await connectForCleanup(TEST_REDIS_URL);
const redisAvailable = redisClient !== null;

describe('BullMQQueue — hàng đợi render trên Redis thật', { skip: redisAvailable ? false : `Redis không khả dụng tại ${REDIS_URL}` }, () => {
    // Mỗi ca test bắt đầu từ một Redis sạch (xem TEST_REDIS_URL ở đầu file).
    beforeEach(async () => {
        await redisClient!.flushdb();
    });

    after(() => {
        redisClient?.disconnect();
        redisClient = null;
    });

    it('addJob lưu job kèm seed tất định theo jobId', async () => {
        await withQueue(async (queue) => {
            const jobId = `seed-${randomUUID()}`;
            await queue.addJob(jobId, jobData({ jobId }));

            const record = await queue.getJob(jobId);
            assert.ok(record, 'job vừa thêm phải đọc lại được');
            assert.equal(record?.status, 'queued');
            assert.equal(record?.userId, 'user-redis-test');
            assert.equal(record?.seed, hashString32(jobId), 'không truyền seed thì lấy băm của jobId');
            assert.equal(record?.createdAt.length, new Date(record!.createdAt).toISOString().length);
        });
    });

    it('tôn trọng seed do người dùng truyền trong request', async () => {
        await withQueue(async (queue) => {
            const jobId = `seed-user-${randomUUID()}`;
            const request = { prompt: 'x', seed: 4242 } as unknown as JobData['request'];
            await queue.addJob(jobId, jobData({ jobId, request }));

            const record = await queue.getJob(jobId);
            assert.equal(record?.seed, 4242, 'seed người dùng truyền phải được giữ nguyên');
        });
    });

    it('getJob trả null với job không tồn tại', async () => {
        await withQueue(async (queue) => {
            assert.equal(await queue.getJob(`khong-ton-tai-${randomUUID()}`), null);
        });
    });

    it('worker chạy job, báo tiến độ và trả kết quả QA đạt', async () => {
        await withQueue(async (queue) => {
            const jobId = `ok-${randomUUID()}`;
            const progress: number[] = [];
            const events: string[] = [];
            queue.startListeners();
            await waitForListeners(queue);
            queue.events.on('progress', () => events.push('progress'));
            queue.events.on('completed', () => events.push('completed'));

            queue.process(async (_data, updateProgress) => {
                await updateProgress({ phase: 'render', progress: 40, message: 'đang dựng hình' });
                progress.push(40);
                return fakeResult('pass');
            });

            await queue.addJob(jobId, jobData({ jobId }));
            const done = await waitForJob(queue, jobId, (r) => r?.status === 'completed', 'job hoàn tất');

            assert.equal(done?.result?.qaStatus, 'pass');
            assert.equal(done?.qaStatus, 'pass');
            assert.deepEqual(progress, [40]);

            await waitFor(() => events.includes('completed'), 'sự kiện completed phát ra');
            await waitFor(() => events.includes('progress'), 'sự kiện progress phát ra');
        });
    });

    it('QA hỏng thì trạng thái là qa_failed chứ không phải completed', async () => {
        await withQueue(async (queue) => {
            const jobId = `qa-fail-${randomUUID()}`;
            queue.process(async () => fakeResult('fail'));

            await queue.addJob(jobId, jobData({ jobId }));
            const done = await waitForJob(queue, jobId, (r) => r?.status === 'qa_failed', 'job QA hỏng');

            assert.equal(done?.qaStatus, 'fail');
        });
    });

    it('handler ném lỗi ⇒ trạng thái failed kèm thông báo lỗi', async () => {
        await withQueue(async (queue) => {
            const jobId = `loi-${randomUUID()}`;
            queue.process(async () => {
                throw new Error('mô phỏng lỗi render');
            });

            await queue.addJob(jobId, jobData({ jobId }));
            const failed = await waitForJob(queue, jobId, (r) => r?.status === 'failed', 'job thất bại');

            assert.match(String(failed?.error), /mô phỏng lỗi render/);
        });
    });

    it('retryJob chạy lại job đã thất bại và từ chối job đã xong', async () => {
        await withQueue(async (queue) => {
            const jobId = `retry-${randomUUID()}`;
            let attempts = 0;
            queue.process(async () => {
                attempts++;
                if (attempts === 1) throw new Error('lần đầu hỏng');
                return fakeResult('pass');
            });

            await queue.addJob(jobId, jobData({ jobId }));
            await waitForJob(queue, jobId, (r) => r?.status === 'failed', 'job thất bại lần đầu');

            assert.equal(await queue.retryJob(jobId), true, 'job lỗi phải chạy lại được');
            const done = await waitForJob(queue, jobId, (r) => r?.status === 'completed', 'job chạy lại thành công');
            assert.equal(attempts, 2);
            assert.equal(done?.status, 'completed');

            assert.equal(await queue.retryJob(jobId), false, 'job đã xong thì không chạy lại');
        });
    });

    it('cancelJob xoá job đang chờ, và trả false với job không tồn tại / đã xong', async () => {
        await withQueue(async (queue) => {
            const jobId = `huy-${randomUUID()}`;
            await queue.addJob(jobId, jobData({ jobId }));

            assert.equal(await queue.cancelJob(jobId), true);
            assert.equal(await queue.getJob(jobId), null, 'job đang chờ bị huỷ thì biến mất khỏi hàng đợi');
            assert.equal(await queue.cancelJob(jobId), false);
            assert.equal(await queue.cancelJob(`khong-co-${randomUUID()}`), false);
        });
    });

    it('cancelJob đánh dấu job đang chạy (không thể dừng handler giữa chừng)', async () => {
        await withQueue(async (queue) => {
            const jobId = `huy-active-${randomUUID()}`;
            let release!: () => void;
            const gate = new Promise<void>((resolve) => {
                release = resolve;
            });

            queue.process(async () => {
                await gate;
                return fakeResult('pass');
            });

            await queue.addJob(jobId, jobData({ jobId }));
            await waitForJob(queue, jobId, (r) => r?.status === 'running', 'job bắt đầu chạy');
            assert.equal(await queue.cancelJob(jobId), true);

            const cancelled = await queue.getJob(jobId);
            assert.equal(cancelled?.status, 'cancelled', 'job đang chạy bị huỷ phải đọc ra là cancelled');

            release();
            await delay(300);
            const afterFinish = await queue.getJob(jobId);
            assert.equal(afterFinish?.status, 'cancelled', 'chạy xong vẫn giữ trạng thái đã huỷ');
        });
    });

    it('retryJob chạy lại được job đã bị huỷ trong lúc đang chạy', async () => {
        await withQueue(async (queue) => {
            const jobId = `retry-huy-${randomUUID()}`;
            const events: string[] = [];
            let release!: () => void;
            const gate = new Promise<void>((resolve) => {
                release = resolve;
            });

            queue.startListeners();
            await waitForListeners(queue);
            queue.events.on('completed', () => events.push('completed'));
            queue.process(async () => {
                await gate;
                return fakeResult('pass');
            });

            await queue.addJob(jobId, jobData({ jobId }));
            await waitForJob(queue, jobId, (r) => r?.status === 'running', 'job bắt đầu chạy');
            assert.equal(await queue.cancelJob(jobId), true);
            release();

            // Chờ job chạy xong thật sự (sự kiện completed) — nếu chỉ đọc trạng thái thì
            // không phân biệt được "đang chạy nhưng đã bị đánh dấu huỷ" với "đã xong".
            await waitFor(() => events.includes('completed'), 'job đã huỷ nhưng vẫn chạy xong');
            const finished = await queue.getJob(jobId);
            assert.equal(finished?.status, 'cancelled', 'chạy xong vẫn giữ trạng thái đã huỷ');

            assert.equal(await queue.retryJob(jobId), true, 'job đã huỷ mà đã chạy xong thì chạy lại được');
            // `job.retry()` xoá kết quả cũ TRƯỚC khi chuyển trạng thái, nên phải chờ tới
            // khi có kết quả mới — chỉ nhìn trạng thái 'completed' sẽ bắt gặp khoảnh khắc
            // trạng thái cũ còn nguyên mà kết quả đã bị xoá (đã gặp thật, test chập chờn).
            const again = await waitForJob(
                queue,
                jobId,
                (r) => r?.status === 'completed' && r?.qaStatus === 'pass',
                'job chạy lại và hoàn tất có kết quả QA',
            );
            assert.equal(again?.qaStatus, 'pass');
        });
    });

    it('sự kiện failed phát ra cho người nghe khi handler ném lỗi', async () => {
        await withQueue(async (queue) => {
            const jobId = `su-kien-failed-${randomUUID()}`;
            const events: string[] = [];
            queue.startListeners();
            await waitForListeners(queue);
            queue.events.on('failed', () => events.push('failed'));

            queue.process(async () => {
                throw new Error('lỗi để kiểm sự kiện failed');
            });

            await queue.addJob(jobId, jobData({ jobId }));
            await waitForJob(queue, jobId, (r) => r?.status === 'failed', 'job thất bại');
            await waitFor(() => events.includes('failed'), 'sự kiện failed phát ra');
        });
    });

    it('removeJob từ chối job đang chạy vì job đang bị khoá', async () => {
        await withQueue(async (queue) => {
            const jobId = `xoa-active-${randomUUID()}`;
            let release!: () => void;
            const gate = new Promise<void>((resolve) => {
                release = resolve;
            });

            queue.process(async () => {
                await gate;
                return fakeResult('pass');
            });

            await queue.addJob(jobId, jobData({ jobId }));
            await waitForJob(queue, jobId, (r) => r?.status === 'running', 'job bắt đầu chạy');

            assert.equal(await queue.removeJob(jobId), false, 'job đang chạy không xoá được');
            release();
            await delay(200);
        });
    });

    it('lỗi của worker được ghi log chứ không làm sập tiến trình', async () => {
        await withQueue(async (queue) => {
            queue.process(async () => fakeResult('pass'));

            const logged: string[] = [];
            const original = console.error;
            console.error = (...args: unknown[]) => {
                logged.push(args.map(String).join(' '));
            };
            try {
                // BullMQ phát 'error' khi kết nối Redis trục trặc; worker phải nuốt lỗi và
                // ghi log thay vì ném ra ngoài (ném ra sẽ làm chết tiến trình worker).
                (queue as unknown as { worker: { emit: (event: string, error: Error) => void } })
                    .worker.emit('error', new Error('mô phỏng lỗi kết nối Redis'));
            } finally {
                console.error = original;
            }

            assert.ok(
                logged.some((line) => line.includes('BullMQ Worker error')),
                `phải ghi log lỗi của worker, log nhận được: ${JSON.stringify(logged)}`,
            );
        });
    });

    it('removeJob xoá hẳn job và trả false khi không có', async () => {
        await withQueue(async (queue) => {
            const jobId = `xoa-${randomUUID()}`;
            await queue.addJob(jobId, jobData({ jobId }));

            assert.equal(await queue.removeJob(jobId), true);
            assert.equal(await queue.getJob(jobId), null);
            assert.equal(await queue.removeJob(jobId), false);
        });
    });

    it('updateJob sửa được thời lượng mục tiêu và kịch bản, trả null nếu không có job', async () => {
        await withQueue(async (queue) => {
            const jobId = `sua-${randomUUID()}`;
            const request = { prompt: 'x', targetDurationSec: 15 } as unknown as JobData['request'];
            await queue.addJob(jobId, jobData({ jobId, request }));

            const script = { title: 'Kịch bản mới', scenes: [] } as unknown as JobData['script'];
            const updated = await queue.updateJob(jobId, { targetDurationSec: 30, script });

            assert.equal(updated?.request.targetDurationSec, 30);
            assert.deepEqual(updated?.script, script);
            assert.equal(await queue.updateJob(`khong-co-${randomUUID()}`, { targetDurationSec: 5 }), null);
        });
    });

    it('getJobs liệt kê job đã thêm kèm trạng thái đã ánh xạ', async () => {
        await withQueue(async (queue) => {
            const jobId = `ds-${randomUUID()}`;
            await queue.addJob(jobId, jobData({ jobId }));

            const jobs = await queue.getJobs();
            const found = jobs.find((j) => j.jobId === jobId);
            assert.ok(found, 'job vừa thêm phải nằm trong danh sách');
            assert.equal(found?.status, 'queued');
        });
    });

    it('close() đóng cả worker, bộ nghe sự kiện và hàng đợi', async () => {
        const queue = new BullMQQueue(TEST_REDIS_URL);
        queue.startListeners();
        queue.process(async () => fakeResult('pass'));
        await queue.close();
        // Đóng lần hai không được ném lỗi (worker/queueEvents đã đóng).
        await queue.close();
    });
});
