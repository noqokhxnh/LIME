/**
 * Test `BullMQBillingWebhookQueue` — hàng đợi webhook thanh toán khi triển khai CÓ Redis
 * (`QUEUE_TYPE=redis`), chạy trên Redis thật.
 *
 * Vì sao cần: nhánh bộ nhớ được kiểm ở `tests/unit/billing_queue_memory.test.ts`, còn nhánh
 * này là đường đi thật khi chạy nhiều tiến trình (server + worker riêng). Hai điều quan
 * trọng nhất được kiểm ở đây:
 *
 *   1. Mã giao dịch dùng làm `jobId` ⇒ SePay gửi lại cùng một webhook KHÔNG tạo job thứ hai
 *      (chống cộng tiền/gia hạn hai lần).
 *   2. Cấu hình thử lại (3 lần, chờ tăng dần) để webhook lỗi tạm thời vẫn được xử lý.
 *
 * Nhóm `redis` chỉ chạy khi có Redis thật (job đêm trong CI, hoặc máy phát triển có
 * `REDIS_URL`); không có Redis thì cả file tự bỏ qua.
 */
import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { BullMQBillingWebhookQueue } from '../../src/billing/queue.js';
import { vietQrBillingService } from '../../src/billing/vietqrService.js';
import { isolatedRedisUrl, connectForCleanup } from './test-redis.js';
import type { SePayWebhookPayload } from '../../src/billing/types.js';

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

/** Database riêng cho file này (xem `tests/redis/test-redis.ts`) — đừng dùng lại số 8. */
const TEST_REDIS_URL = isolatedRedisUrl(8, REDIS_URL);

const ORIGINAL_PROCESS_WEBHOOK = vietQrBillingService.processWebhook;

let sequence = 0;

function webhook(overrides: Partial<SePayWebhookPayload> = {}): SePayWebhookPayload {
    sequence += 1;
    const id = (Date.now() % 1_000_000_000) + sequence;
    return {
        id,
        gateway: 'MBBank',
        transactionDate: '2026-01-01 10:00:00',
        accountNumber: '123456789',
        code: `LIME${id}`,
        content: `LIME${id} chuyen tien`,
        transferType: 'in',
        transferAmount: 99_000,
        accumulated: 0,
        subAccount: null,
        referenceCode: `FT${id}`,
        description: 'chuyen tien',
        ...overrides,
    } as unknown as SePayWebhookPayload;
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(condition: () => Promise<boolean>, message: string, timeoutMs = 20000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await condition()) return;
        await delay(50);
    }
    throw new Error(`Hết thời gian chờ: ${message}`);
}

/** Client giữ mở để dọn dẹp giữa các ca test; đóng ở hook `after`. */
let redisClient: Redis | null = null;

redisClient = await connectForCleanup(TEST_REDIS_URL);
const redisAvailable = redisClient !== null;

/** Mở hàng đợi của lớp cần test kèm một hàng đợi "soi" riêng để đọc trạng thái job. */
async function withQueues<T>(
    fn: (queue: BullMQBillingWebhookQueue, inspector: Queue<SePayWebhookPayload>) => Promise<T>,
): Promise<T> {
    const connection = new Redis(TEST_REDIS_URL, { maxRetriesPerRequest: null });
    const inspector = new Queue<SePayWebhookPayload>('sepay-webhooks', { connection });
    const queue = new BullMQBillingWebhookQueue(TEST_REDIS_URL);
    try {
        return await fn(queue, inspector);
    } finally {
        await queue.close();
        await inspector.close();
        if (connection.status !== 'end') connection.disconnect();
    }
}

describe('BullMQBillingWebhookQueue — hàng đợi webhook thanh toán trên Redis thật', { skip: redisAvailable ? false : `Redis không khả dụng tại ${REDIS_URL}` }, () => {
    beforeEach(async () => {
        await redisClient!.flushdb();
    });

    beforeEach(() => {
        vietQrBillingService.processWebhook = async () => ({ success: true });
    });

    after(() => {
        vietQrBillingService.processWebhook = ORIGINAL_PROCESS_WEBHOOK;
        redisClient?.disconnect();
        redisClient = null;
    });

    it('addJob ghi job vào hàng đợi sepay-webhooks với mã giao dịch làm jobId', async () => {
        await withQueues(async (queue, inspector) => {
            const payload = webhook();
            await queue.addJob(payload);

            const job = await inspector.getJob(`sepay-${payload.id}`);
            assert.ok(job, 'job phải tồn tại dưới id suy ra từ mã giao dịch');
            assert.equal(job?.data.id, payload.id, 'dữ liệu job phải là nguyên webhook');
        });
    });

    it('webhook gửi lại (cùng mã giao dịch) không tạo job thứ hai', async () => {
        await withQueues(async (queue, inspector) => {
            const payload = webhook();
            await queue.addJob(payload);
            await queue.addJob(payload);

            const jobs = await inspector.getJobs(['waiting', 'delayed', 'active', 'completed']);
            assert.equal(jobs.length, 1, 'cùng jobId thì BullMQ chỉ giữ một job — chống xử lý trùng');
        });
    });

    it('webhook không có mã giao dịch vẫn được nhận (BullMQ tự đặt id)', async () => {
        await withQueues(async (queue, inspector) => {
            await queue.addJob(webhook({ id: undefined } as Partial<SePayWebhookPayload>));

            const jobs = await inspector.getJobs(['waiting', 'delayed', 'active', 'completed']);
            assert.equal(jobs.length, 1, 'webhook thiếu id vẫn phải vào hàng đợi');
            assert.ok(jobs[0].id, 'job phải có id do BullMQ sinh');
        });
    });

    it('cấu hình thử lại khi xử lý lỗi: 3 lần, chờ tăng dần', async () => {
        await withQueues(async (queue, inspector) => {
            const payload = webhook();
            await queue.addJob(payload);

            const job = await inspector.getJob(`sepay-${payload.id}`);
            assert.equal(job?.opts.attempts, 3, 'webhook lỗi tạm thời phải được thử lại 3 lần');
            assert.equal(job?.opts.backoff?.type, 'exponential', 'chờ giữa các lần thử phải tăng dần');
            assert.equal(job?.opts.backoff?.delay, 2000);
        });
    });

    it('startWorker() chạy webhook và đánh dấu job hoàn tất', async () => {
        const seen: SePayWebhookPayload[] = [];
        vietQrBillingService.processWebhook = async (payload: SePayWebhookPayload) => {
            seen.push(payload);
            return { success: true };
        };

        await withQueues(async (queue, inspector) => {
            await queue.startWorker();
            const payload = webhook();
            await queue.addJob(payload);

            await waitFor(async () => (await inspector.getJob(`sepay-${payload.id}`))?.isCompleted() ?? false, 'job hoàn tất');
            assert.equal(seen.length, 1, 'worker phải xử lý webhook đúng một lần');
            assert.equal(seen[0].id, payload.id);
        });
    });

    it('worker lỗi thì job được thử lại rồi mới thất bại', async () => {
        let attempts = 0;
        vietQrBillingService.processWebhook = async () => {
            attempts += 1;
            throw new Error('mô phỏng lỗi xử lý webhook');
        };

        await withQueues(async (queue, inspector) => {
            await queue.startWorker();
            const payload = webhook();
            await queue.addJob(payload);

            await waitFor(
                async () => (await inspector.getJob(`sepay-${payload.id}`))?.isFailed() ?? false,
                'job thất bại sau khi hết lượt thử',
                60000,
            );
            const job = await inspector.getJob(`sepay-${payload.id}`);
            assert.equal(attempts, 3, 'phải thử đúng 3 lần (1 lần đầu + 2 lần lại)');
            assert.match(String(job?.failedReason), /mô phỏng lỗi xử lý webhook/);
        });
    });

    it('close() đóng worker và hàng đợi, gọi lại lần hai vẫn an toàn', async () => {
        const seen: SePayWebhookPayload[] = [];
        vietQrBillingService.processWebhook = async (payload: SePayWebhookPayload) => {
            seen.push(payload);
            return { success: true };
        };

        const connection = new Redis(TEST_REDIS_URL, { maxRetriesPerRequest: null });
        const inspector = new Queue<SePayWebhookPayload>('sepay-webhooks', { connection });
        const queue = new BullMQBillingWebhookQueue(TEST_REDIS_URL);
        try {
            await queue.startWorker();
            await queue.close();
            // Gọi lại lần hai không được ném lỗi và không được treo.
            await queue.close();

            // Job thêm SAU khi đóng (qua kết nối của người gọi) vẫn nằm chờ nhưng không còn
            // worker nào xử lý — đúng ý nghĩa của việc đóng hàng đợi.
            const payload = webhook();
            await inspector.add('process-webhook', payload, { jobId: `sepay-${payload.id}` });
            await delay(500);

            assert.equal(seen.length, 0, 'hàng đợi đã đóng thì không xử lý thêm webhook');
            const job = await inspector.getJob(`sepay-${payload.id}`);
            assert.equal(await job?.getState(), 'waiting', 'job vẫn nằm chờ khi worker đã đóng');
        } finally {
            await inspector.close();
            if (connection.status !== 'end') connection.disconnect();
        }
    });
});
