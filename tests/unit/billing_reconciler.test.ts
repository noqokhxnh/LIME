/**
 * Test `syncSepayTransactions` — tác vụ đối chiếu giao dịch SePay chạy nền.
 *
 * Trước đây file này gần như 0% độ phủ: nó gọi API bên ngoài nên test "thật" là bất khả
 * thi. Ở đây `fetch` được stub nên kiểm được đủ các nhánh: chưa cấu hình API key, API lỗi,
 * lỗi mạng, giao dịch tiền ra, thiếu mã giao dịch, giao dịch đã xử lý, khớp đơn, không khớp
 * đơn và lỗi khi xử lý một giao dịch.
 */
import test, { describe, it, before, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { syncSepayTransactions } from '../../src/billing/reconciler.js';
import { vietQrBillingService } from '../../src/billing/vietqrService.js';
import { billingStorage } from '../../src/billing/storage.js';
import { initDatabase, db } from '../../src/database/index.js';
import { getConfig, resetConfig } from '../../src/config.js';

const USER_A = 'a2000000-0000-4000-8000-000000000001';

function uniqueRef(prefix = 'SEPAY'): string {
    return `${prefix}-${randomUUID()}`;
}

/** Bật/tắt API key của SePay cho từng ca test (config được cache nên phải reset). */
function setApiKey(value: string | undefined): void {
    if (value === undefined) {
        delete process.env.SEPAY_API_KEY;
    } else {
        process.env.SEPAY_API_KEY = value;
    }
    resetConfig();
}

/** Stub `fetch` trả JSON như SePay (hoặc ném lỗi để mô phỏng lỗi mạng). */
function stubFetch(response: { ok?: boolean; status?: number; body?: unknown } | Error) {
    return mock.method(globalThis, 'fetch', async () => {
        if (response instanceof Error) throw response;
        return {
            ok: response.ok ?? true,
            status: response.status ?? 200,
            json: async () => response.body ?? { status: 200, transactions: [] },
        } as unknown as Response;
    });
}

describe('SePay Reconciler — syncSepayTransactions', () => {
    before(async () => {
        const config = getConfig();
        if (config.DATABASE_URL) {
            await initDatabase();
            await db.query(
                `INSERT INTO users (id, username, email)
                 VALUES ($1, 'billing_reconciler', 'billing_reconciler@lime.test')
                 ON CONFLICT (id) DO NOTHING`,
                [USER_A],
            );
        }
        if (billingStorage.resetForTesting) {
            await billingStorage.resetForTesting();
        }
    });

    afterEach(() => {
        mock.restoreAll();
        setApiKey(undefined);
    });

    it('chưa cấu hình SEPAY_API_KEY ⇒ trả 0 và không gọi API', async () => {
        setApiKey(undefined);
        const fetchSpy = stubFetch({ body: { transactions: [{ id: 'X', amount_in: 149000 }] } });

        const result = await syncSepayTransactions();

        assert.deepEqual(result, { processed: 0, matched: 0, skipped: 0, errors: 0 });
        assert.equal(fetchSpy.mock.callCount(), 0, 'không được gọi API khi chưa có key');
    });

    it('API trả lỗi HTTP ⇒ ghi log cảnh báo và đếm 1 lỗi', async () => {
        setApiKey('test-key');
        stubFetch({ ok: false, status: 500 });
        const warn = mock.method(console, 'warn', () => {});

        const result = await syncSepayTransactions();

        assert.equal(result.errors, 1);
        assert.equal(result.processed, 0);
        assert.ok(
            String(warn.mock.calls[0]?.arguments[0]).includes('500'),
            'log cảnh báo phải nêu mã trạng thái',
        );
    });

    it('lỗi mạng ⇒ đếm 1 lỗi và không làm sập tác vụ nền', async () => {
        setApiKey('test-key');
        stubFetch(new Error('getaddrinfo ENOTFOUND my.sepay.vn'));
        const error = mock.method(console, 'error', () => {});

        const result = await syncSepayTransactions();

        assert.equal(result.errors, 1);
        assert.equal(error.mock.callCount(), 1);
    });

    it('phản hồi không có danh sách giao dịch ⇒ tất cả 0', async () => {
        setApiKey('test-key');
        stubFetch({ body: { status: 200, messages: { success: true } } });

        const result = await syncSepayTransactions();

        assert.deepEqual(result, { processed: 0, matched: 0, skipped: 0, errors: 0 });
    });

    it('giao dịch tiền ra (amount_in <= 0) bị bỏ qua hoàn toàn', async () => {
        setApiKey('test-key');
        const outRef = uniqueRef('OUT');
        stubFetch({
            body: {
                transactions: [
                    { id: outRef, amount_in: 0, transfer_type: 'out' },
                    { id: uniqueRef('NEG'), amount_in: '-1000' },
                ],
            },
        });

        const result = await syncSepayTransactions();

        assert.deepEqual(result, { processed: 0, matched: 0, skipped: 0, errors: 0 });
        assert.equal(await billingStorage.findUnmatchedPaymentBySepayRef(outRef), null);
    });

    it('phân loại đủ các tình huống: khớp đơn, đã xử lý, không khớp, lỗi xử lý', async () => {
        setApiKey('test-key');

        // Đơn đã thanh toán trước đó ⇒ giao dịch trùng phải bị bỏ qua.
        const paidOrder = await vietQrBillingService.createOrder(USER_A, 'creator');
        const dupRef = uniqueRef('DA-XU-LY');
        await vietQrBillingService.processWebhook({
            id: dupRef,
            transfer_type: 'in',
            transfer_amount: 149000,
            content: `THANH TOAN ${paidOrder.pay_code}`,
        });

        // Đơn đang chờ ⇒ giao dịch mới phải khớp và hoàn tất đơn.
        const pendingOrder = await vietQrBillingService.createOrder(USER_A, 'pro');
        const matchRef = uniqueRef('KHOP');
        const unmatchedRef = uniqueRef('KHONG-KHOP');
        const brokenRef = uniqueRef('LOI');

        // Một giao dịch lỗi khi xử lý, các giao dịch khác vẫn đi qua hàm thật.
        const process = vietQrBillingService.processWebhook.bind(vietQrBillingService);
        mock.method(vietQrBillingService, 'processWebhook', async (payload: { id?: unknown }) => {
            if (String(payload.id) === brokenRef) throw new Error('mô phỏng lỗi xử lý');
            return process(payload as never);
        });

        stubFetch({
            body: {
                transactions: [
                    { id: uniqueRef('TIEN-RA'), amount_in: 0 },
                    { id: '', reference_number: '', amount_in: 5000 },
                    { id: dupRef, amount_in: '149000', transaction_content: paidOrder.pay_code },
                    { id: matchRef, amount_in: '300000', transaction_content: `CK ${pendingOrder.pay_code}` },
                    { id: unmatchedRef, amount_in: '50000', transaction_content: 'CHUYEN KHOAN KHONG CO MA' },
                    { id: brokenRef, amount_in: '10000', transaction_content: 'LIME9Z8Y7X' },
                ],
            },
        });
        mock.method(console, 'error', () => {});

        const result = await syncSepayTransactions();

        assert.deepEqual(result, { processed: 2, matched: 1, skipped: 1, errors: 1 });

        const fulfilled = await billingStorage.findOrderById(pendingOrder.order_id);
        assert.equal(fulfilled?.status, 'paid', 'giao dịch khớp phải hoàn tất đơn đang chờ');
        assert.equal((await billingStorage.findPaymentBySepayRef(matchRef))?.result, 'overpaid');

        const unmatched = await billingStorage.findUnmatchedPaymentBySepayRef(unmatchedRef);
        assert.ok(unmatched, 'giao dịch có tiền nhưng không có mã đơn phải vào sổ chưa khớp');
        assert.equal(await billingStorage.findPaymentBySepayRef(brokenRef), null);
    });

    it('thiếu id thì dùng reference_number làm khoá giao dịch', async () => {
        setApiKey('test-key');
        const order = await vietQrBillingService.createOrder(USER_A, 'creator');
        const bankRef = uniqueRef('BANKREF');

        stubFetch({
            body: {
                transactions: [
                    {
                        reference_number: bankRef,
                        amount_in: '149000',
                        transaction_content: `THANH TOAN ${order.pay_code}`,
                    },
                ],
            },
        });

        const result = await syncSepayTransactions();

        assert.equal(result.processed, 1);
        assert.equal(result.matched, 1);
        assert.ok(
            await billingStorage.findPaymentBySepayRef(bankRef),
            'khoá giao dịch phải là reference_number khi SePay không trả id',
        );
    });
});
