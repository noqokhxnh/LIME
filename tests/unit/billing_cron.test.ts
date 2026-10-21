/**
 * Test `startBillingCron` / `stopBillingCron` — hai tác vụ chạy nền của module thanh toán.
 *
 * Đồng hồ được giả lập (`mock.timers`) nên test chạy tức thì thay vì chờ 1 phút / 10 phút,
 * và `fetch` được stub nên không gọi API SePay thật. Mỗi ca test đều dọn dẹp bằng
 * `stopBillingCron()` để không rò rỉ interval sang ca khác.
 */
import test, { describe, after, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { startBillingCron, stopBillingCron } from '../../src/billing/cron.js';
import { billingStorage } from '../../src/billing/storage.js';
import { resetConfig } from '../../src/config.js';

/** Cho các microtask của callback bất đồng bộ chạy xong. */
async function flushMicrotasks(): Promise<void> {
    await new Promise<void>((resolve) => setImmediate(resolve));
}

/**
 * Chờ đến khi điều kiện đúng (tối đa `timeoutMs`).
 *
 * Cần thiết vì ở chế độ PostgreSQL thật, callback nền còn phải chờ truy vấn qua mạng —
 * một lần `flushMicrotasks()` là không đủ (test từng đỏ ở chế độ PostgreSQL nhưng xanh ở
 * chế độ in-memory vì lý do này). `setTimeout` không bị giả lập nên dùng được để chờ.
 */
async function waitFor(condition: () => boolean, timeoutMs = 5000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (condition()) return true;
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    return condition();
}

function enableFakeTimers(): void {
    mock.timers.enable({ apis: ['setInterval'] });
}

function setApiKey(value: string | undefined): void {
    if (value === undefined) {
        delete process.env.SEPAY_API_KEY;
    } else {
        process.env.SEPAY_API_KEY = value;
    }
    resetConfig();
}

/** Đếm số lần dọn đơn hết hạn; trả về số đơn "đã dọn" như mong muốn của từng ca test. */
function spyExpire(implementation: () => Promise<number>): void {
    mock.method(billingStorage, 'expireStaleOrders', implementation);
}

describe('Billing Cron — tác vụ nền', () => {
    afterEach(() => {
        stopBillingCron();
        mock.timers.reset();
        mock.restoreAll();
        setApiKey(undefined);
    });

    after(() => {
        stopBillingCron();
    });

    test('dọn đơn hết hạn mỗi phút và ghi log khi có đơn bị dọn', async () => {
        enableFakeTimers();
        let calls = 0;
        spyExpire(async () => {
            calls++;
            return 2;
        });
        const log = mock.method(console, 'log', () => {});

        startBillingCron();
        mock.timers.tick(60 * 1000);
        await flushMicrotasks();
        assert.equal(calls, 1, 'sau 1 phút phải chạy dọn đơn một lần');
        assert.ok(
            log.mock.calls.some((call) => String(call.arguments[0]).includes('Expired 2 stale orders')),
            'có đơn bị dọn thì phải ghi log',
        );

        mock.timers.tick(60 * 1000);
        await flushMicrotasks();
        assert.equal(calls, 2, 'tác vụ phải lặp lại ở phút tiếp theo');
    });

    test('đối chiếu SePay mỗi 10 phút', async () => {
        enableFakeTimers();
        spyExpire(async () => 0);
        setApiKey('test-key');
        const fetchSpy = mock.method(globalThis, 'fetch', async () =>
            ({
                ok: true,
                status: 200,
                json: async () => ({ status: 200, transactions: [] }),
            }) as unknown as Response,
        );

        startBillingCron();

        mock.timers.tick(9 * 60 * 1000);
        await flushMicrotasks();
        assert.equal(fetchSpy.mock.callCount(), 0, 'chưa đủ 10 phút thì chưa đối chiếu');

        mock.timers.tick(60 * 1000);
        await flushMicrotasks();
        assert.equal(fetchSpy.mock.callCount(), 1, 'đủ 10 phút phải gọi API đối chiếu');
    });

    test('đối chiếu xử lý được giao dịch thì ghi log kết quả', async () => {
        enableFakeTimers();
        spyExpire(async () => 0);
        setApiKey('test-key');
        // Giao dịch không có mã đơn ⇒ vẫn được tính là "đã xử lý" và sinh log.
        mock.method(globalThis, 'fetch', async () =>
            ({
                ok: true,
                status: 200,
                json: async () => ({
                    status: 200,
                    transactions: [{ id: `CRON-${Date.now()}`, amount_in: '15000', transaction_content: 'KHONG CO MA' }],
                }),
            }) as unknown as Response,
        );
        const log = mock.method(console, 'log', () => {});

        startBillingCron();
        mock.timers.tick(10 * 60 * 1000);
        const logged = await waitFor(() =>
            log.mock.calls.some((call) => String(call.arguments[0]).includes('Reconciled')),
        );

        assert.ok(logged, 'phải ghi log khi tác vụ xử lý được giao dịch');
    });

    test('chưa cấu hình API key thì tác vụ đối chiếu tự bỏ qua, không gọi mạng', async () => {
        enableFakeTimers();
        spyExpire(async () => 0);
        setApiKey(undefined);
        const fetchSpy = mock.method(globalThis, 'fetch', async () => {
            throw new Error('không được gọi mạng khi chưa có API key');
        });

        startBillingCron();
        mock.timers.tick(10 * 60 * 1000);
        await flushMicrotasks();

        assert.equal(fetchSpy.mock.callCount(), 0);
    });

    test('gọi startBillingCron nhiều lần không nhân đôi tác vụ', async () => {
        enableFakeTimers();
        let calls = 0;
        spyExpire(async () => {
            calls++;
            return 0;
        });

        startBillingCron();
        startBillingCron();
        startBillingCron();
        mock.timers.tick(60 * 1000);
        await flushMicrotasks();

        assert.equal(calls, 1, 'chỉ được có một tác vụ dọn đơn dù gọi khởi động nhiều lần');
    });

    test('lỗi trong tác vụ dọn đơn không làm chết cron', async () => {
        enableFakeTimers();
        let calls = 0;
        spyExpire(async () => {
            calls++;
            if (calls === 1) throw new Error('database tạm thời không phản hồi');
            return 1;
        });
        const error = mock.method(console, 'error', () => {});

        startBillingCron();
        mock.timers.tick(60 * 1000);
        await flushMicrotasks();
        assert.equal(error.mock.callCount(), 1, 'lỗi phải được ghi log');

        mock.timers.tick(60 * 1000);
        await flushMicrotasks();
        assert.equal(calls, 2, 'chu kỳ sau vẫn phải chạy tiếp');
    });

    test('stopBillingCron dừng cả hai tác vụ và gọi lại nhiều lần vẫn an toàn', async () => {
        enableFakeTimers();
        let calls = 0;
        spyExpire(async () => {
            calls++;
            return 0;
        });

        startBillingCron();
        stopBillingCron();
        stopBillingCron();

        mock.timers.tick(60 * 60 * 1000);
        await flushMicrotasks();

        assert.equal(calls, 0, 'sau khi dừng thì không tác vụ nào được chạy');
    });

    test('hook onClose của app dừng cron khi server đóng', async () => {
        enableFakeTimers();
        let calls = 0;
        spyExpire(async () => {
            calls++;
            return 0;
        });

        const hooks: { event: string; handler: () => unknown }[] = [];
        const fakeApp = {
            addHook: (event: string, handler: () => unknown) => {
                hooks.push({ event, handler });
                return fakeApp;
            },
        } as unknown as FastifyInstance;

        startBillingCron(fakeApp);
        assert.equal(hooks.length, 1, 'phải đăng ký đúng một hook');
        assert.equal(hooks[0].event, 'onClose');

        await hooks[0].handler();

        mock.timers.tick(60 * 1000);
        await flushMicrotasks();
        assert.equal(calls, 0);
    });

    test('không truyền app thì vẫn chạy được (worker/CLI khởi động riêng)', async () => {
        enableFakeTimers();
        let calls = 0;
        spyExpire(async () => {
            calls++;
            return 0;
        });

        startBillingCron();
        mock.timers.tick(60 * 1000);
        await flushMicrotasks();

        assert.equal(calls, 1);
    });
});
