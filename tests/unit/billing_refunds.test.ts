import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryBillingStorage } from '../../src/billing/storage.js';

function makeOrder(overrides: Record<string, any> = {}) {
    return {
        user_id: 'user-test-1',
        plan_id: 'pro',
        amount_vnd: 249000,
        pay_code: `LIME${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        status: 'pending' as const,
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        ...overrides,
    };
}

describe('Billing refunds & order cancellation (InMemoryBillingStorage)', () => {
    let store: InMemoryBillingStorage;

    beforeEach(async () => {
        store = new InMemoryBillingStorage();
        await store.resetForTesting();
    });

    after(async () => {
        await store.resetForTesting();
    });

    it('recordRefund lưu bản ghi và listRefunds trả về đầy đủ trường', async () => {
        const refund = await store.recordRefund({
            source_type: 'unmatched',
            source_id: 'um-1',
            sepay_ref: 'FT123456',
            amount_vnd: 149000,
            bank_account: '97042212345678',
            bank_name: 'Vietcombank',
            admin_note: 'Hoàn thừa tiền',
            refunded_by: 'admin@lime.test',
        });

        assert.ok(refund.id);
        assert.strictEqual(refund.source_type, 'unmatched');
        assert.strictEqual(refund.bank_account, '97042212345678');
        assert.strictEqual(refund.bank_name, 'Vietcombank');
        assert.strictEqual(refund.refunded_by, 'admin@lime.test');
        assert.ok(refund.refunded_at);
        assert.ok(refund.created_at);

        const list = await store.listRefunds();
        assert.strictEqual(list.length, 1);
        assert.strictEqual(list[0].id, refund.id);
    });

    it('cancelOrder thành công với đơn pending và claimed', async () => {
        const pending = await store.createOrder(makeOrder({ status: 'pending' }));
        const claimed = await store.createOrder(makeOrder({ status: 'claimed' }));

        const r1 = await store.cancelOrder(pending.id);
        assert.ok(r1);
        assert.strictEqual(r1.status, 'cancelled');

        const r2 = await store.cancelOrder(claimed.id);
        assert.ok(r2);
        assert.strictEqual(r2.status, 'cancelled');
    });

    it('cancelOrder từ chối đơn paid / expired / không tồn tại', async () => {
        const paid = await store.createOrder(makeOrder({ status: 'paid' }));
        const expired = await store.createOrder(makeOrder({ status: 'expired' }));

        assert.strictEqual(await store.cancelOrder(paid.id), null);
        assert.strictEqual(await store.cancelOrder(expired.id), null);
        assert.strictEqual(await store.cancelOrder('order-khong-ton-tai'), null);

        // Đơn paid/expired giữ nguyên trạng thái
        assert.strictEqual((await store.findOrderById(paid.id))?.status, 'paid');
        assert.strictEqual((await store.findOrderById(expired.id))?.status, 'expired');
    });

    it('listDuplicatePayments chỉ trả về giao dịch result=duplicate, mới nhất trước', async () => {
        const order = await store.createOrder(makeOrder({}));
        await store.recordDuplicatePayment({ orderId: order.id, sepayRef: 'FT-DUP-1', amount: 149000, raw: {} });
        await new Promise((r) => setTimeout(r, 5));
        await store.recordDuplicatePayment({ orderId: order.id, sepayRef: 'FT-DUP-2', amount: 149000, raw: {} });
        await store.recordUnderpaidPayment({ orderId: order.id, sepayRef: 'FT-UNDER-1', amount: 100000, raw: {} });

        const dups = await store.listDuplicatePayments();
        assert.strictEqual(dups.length, 2);
        assert.ok(dups.every((p) => p.result === 'duplicate'));
        assert.strictEqual(dups[0].sepay_ref, 'FT-DUP-2');
        assert.strictEqual(dups[1].sepay_ref, 'FT-DUP-1');
    });

    it('getUnmatchedPayments lọc được theo status', async () => {
        const u1 = await store.recordUnmatchedPayment({
            sepay_ref: 'FT-UM-1', amount_vnd: 100000, content: 'LIME ABC', raw: {}, status: 'pending',
        });
        const u2 = await store.recordUnmatchedPayment({
            sepay_ref: 'FT-UM-2', amount_vnd: 200000, content: 'LIME XYZ', raw: {}, status: 'pending',
        });

        assert.strictEqual((await store.getUnmatchedPayments('pending')).length, 2);

        await store.resolveUnmatchedPayment(u1.id, 'refunded', 'Đã hoàn', 'admin@lime.test');

        const pending = await store.getUnmatchedPayments('pending');
        assert.strictEqual(pending.length, 1);
        assert.strictEqual(pending[0].id, u2.id);

        const refunded = await store.getUnmatchedPayments('refunded');
        assert.strictEqual(refunded.length, 1);
        assert.strictEqual(refunded[0].id, u1.id);

        const all = await store.getUnmatchedPayments('all');
        assert.strictEqual(all.length, 2);
        assert.strictEqual((await store.getUnmatchedPayments()).length, 2);
    });

    it('findPaymentById tìm đúng giao dịch', async () => {
        const order = await store.createOrder(makeOrder({}));
        const p = await store.recordDuplicatePayment({ orderId: order.id, sepayRef: 'FT-FIND-1', amount: 149000, raw: {} });

        const found = await store.findPaymentById(p.id);
        assert.ok(found);
        assert.strictEqual(found.sepay_ref, 'FT-FIND-1');
        assert.strictEqual(await store.findPaymentById('khong-ton-tai'), null);
    });
});
