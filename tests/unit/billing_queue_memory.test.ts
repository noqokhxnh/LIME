/**
 * Test `billing/queue.ts` ở nhánh chạy được in-memory: `MemoryBillingWebhookQueue` (mặc
 * định khi không cấu hình Redis) và hàm chọn hàng đợi `getBillingWebhookQueue()`.
 *
 * Vì sao cần: đây là đường đi của MỌI webhook thanh toán khi triển khai không có Redis —
 * sai ở đây thì tiền vào mà đơn không được kích hoạt, hoặc webhook hỏng làm chết tiến trình
 * server. Nhánh BullMQ thật của cùng file được kiểm riêng ở `tests/redis/`.
 *
 * File này KHÔNG cần Redis và không cần database: `processWebhook` được thay bằng hàm giả
 * nên chỉ kiểm phần hàng đợi (phát sự kiện, tắt/bật, chọn hàng đợi).
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    MemoryBillingWebhookQueue,
    getBillingWebhookQueue,
    setBillingWebhookQueue,
} from '../../src/billing/queue.js';
import { vietQrBillingService } from '../../src/billing/vietqrService.js';
import { resetConfig } from '../../src/config.js';
import type { SePayWebhookPayload } from '../../src/billing/types.js';

const ORIGINAL_PROCESS_WEBHOOK = vietQrBillingService.processWebhook;
const ORIGINAL_ENV = {
    QUEUE_TYPE: process.env.QUEUE_TYPE,
    REDIS_URL: process.env.REDIS_URL,
};

/** Bộ đếm để mã giao dịch không trùng giữa các lần chạy (test có thể chạy song song). */
let sequence = 0;

/** Webhook mẫu; mã giao dịch sinh mới mỗi lần để không đụng nhau khi chạy song song. */
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

/** Chờ một điều kiện đúng (sự kiện của hàng đợi là bất đồng bộ). */
async function waitFor(condition: () => boolean, message: string, timeoutMs = 5000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (condition()) return;
        await delay(20);
    }
    throw new Error(`Hết thời gian chờ: ${message}`);
}

describe('MemoryBillingWebhookQueue — hàng đợi webhook thanh toán không cần Redis', () => {
    let calls: SePayWebhookPayload[] = [];

    beforeEach(() => {
        calls = [];
        setBillingWebhookQueue(null);
        resetConfig();
        vietQrBillingService.processWebhook = async (payload: SePayWebhookPayload) => {
            calls.push(payload);
            return { success: true };
        };
    });

    afterEach(() => {
        vietQrBillingService.processWebhook = ORIGINAL_PROCESS_WEBHOOK;
        setBillingWebhookQueue(null);
        if (ORIGINAL_ENV.QUEUE_TYPE === undefined) delete process.env.QUEUE_TYPE;
        else process.env.QUEUE_TYPE = ORIGINAL_ENV.QUEUE_TYPE;
        if (ORIGINAL_ENV.REDIS_URL === undefined) delete process.env.REDIS_URL;
        else process.env.REDIS_URL = ORIGINAL_ENV.REDIS_URL;
        resetConfig();
    });

    it('addJob xử lý webhook rồi phát sự kiện completed', async () => {
        const queue = new MemoryBillingWebhookQueue();
        const done: SePayWebhookPayload[] = [];
        queue.events.on('completed', (payload: SePayWebhookPayload) => done.push(payload));

        const payload = webhook();
        await queue.addJob(payload);

        await waitFor(() => done.length === 1, 'sự kiện completed phát ra');
        assert.equal(calls.length, 1, 'webhook phải được xử lý đúng một lần');
        assert.equal(calls[0].id, payload.id);
        assert.ok(done[0], 'sự kiện completed phải kèm payload');
    });

    it('addJob không chặn người gọi (xử lý ở nhịp sau)', async () => {
        const queue = new MemoryBillingWebhookQueue();

        await queue.addJob(webhook());

        // `addJob` trả về ngay: webhook phải được xử lý ở nhịp sau, không đồng bộ trong lời gọi.
        assert.equal(calls.length, 0, 'chưa xử lý ngay trong lời gọi addJob');
        await waitFor(() => calls.length === 1, 'webhook được xử lý ở nhịp sau');
    });

    it('addJob phát sự kiện failed và ghi log khi xử lý lỗi (không làm sập tiến trình)', async () => {
        const queue = new MemoryBillingWebhookQueue();
        const failures: unknown[] = [];
        queue.events.on('failed', (info: unknown) => failures.push(info));

        const logged: string[] = [];
        const originalError = console.error;
        console.error = (...args: unknown[]) => {
            logged.push(args.map(String).join(' '));
        };
        try {
            vietQrBillingService.processWebhook = async () => {
                throw new Error('mô phỏng lỗi xử lý webhook');
            };

            await queue.addJob(webhook());
            await waitFor(() => failures.length === 1, 'sự kiện failed phát ra');
        } finally {
            console.error = originalError;
        }

        assert.ok(
            logged.some((line) => line.includes('Memory Billing Webhook Queue')),
            `phải ghi log lỗi xử lý webhook, log nhận được: ${JSON.stringify(logged)}`,
        );
    });

    it('close() dừng nhận việc mới', async () => {
        const queue = new MemoryBillingWebhookQueue();
        await queue.close();

        await queue.addJob(webhook());
        await delay(100);

        assert.equal(calls.length, 0, 'hàng đợi đã đóng thì không xử lý thêm webhook nào');
    });

    it('startWorker() bật lại việc xử lý sau khi đã đóng', async () => {
        const queue = new MemoryBillingWebhookQueue();
        await queue.close();
        await queue.startWorker();

        await queue.addJob(webhook());

        await waitFor(() => calls.length === 1, 'webhook được xử lý lại sau khi bật worker');
    });

    describe('getBillingWebhookQueue()', () => {
        it('trả hàng đợi bộ nhớ khi cấu hình là memory (mặc định)', async () => {
            delete process.env.QUEUE_TYPE;
            delete process.env.REDIS_URL;
            resetConfig();

            const queue = await getBillingWebhookQueue();

            assert.ok(queue instanceof MemoryBillingWebhookQueue, 'phải dùng hàng đợi bộ nhớ');
            assert.equal(await getBillingWebhookQueue(), queue, 'phải dùng lại đúng một thực thể');
        });

        it('lùi về hàng đợi bộ nhớ khi Redis không kết nối được', async () => {
            process.env.QUEUE_TYPE = 'redis';
            // Cổng 1 chắc chắn không có Redis ⇒ phép thử kết nối thất bại ngay.
            process.env.REDIS_URL = 'redis://127.0.0.1:1';
            resetConfig();

            const queue = await getBillingWebhookQueue();

            assert.ok(
                queue instanceof MemoryBillingWebhookQueue,
                'Redis hỏng thì phải lùi về bộ nhớ chứ không làm webhook ngừng chạy',
            );
        });

        it('setBillingWebhookQueue() cho phép tiêm hàng đợi khác và trả về khi đặt lại null', async () => {
            const injected = new MemoryBillingWebhookQueue();
            setBillingWebhookQueue(injected);
            assert.equal(await getBillingWebhookQueue(), injected, 'phải trả về đúng hàng đợi được tiêm');

            setBillingWebhookQueue(null);
            const rebuilt = await getBillingWebhookQueue();
            assert.notEqual(rebuilt, injected, 'đặt lại null thì phải dựng hàng đợi mới');
            assert.ok(rebuilt instanceof MemoryBillingWebhookQueue);
        });
    });
});
