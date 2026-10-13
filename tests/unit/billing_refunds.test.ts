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

    it('findUnmatchedPaymentById tìm đúng giao dịch không khớp', async () => {
        const u = await store.recordUnmatchedPayment({
            sepay_ref: 'FT-UM-FIND-1',
            amount_vnd: 150000,
            content: 'LIME UNKNOWN',
            raw: {},
            status: 'pending',
            admin_note: 'Sai cú pháp',
        });

        const found = await store.findUnmatchedPaymentById(u.id);
        assert.ok(found);
        assert.strictEqual(found.id, u.id);
        assert.strictEqual(found.sepay_ref, 'FT-UM-FIND-1');
        assert.strictEqual(await store.findUnmatchedPaymentById('khong-ton-tai'), null);
    });

    it('findRefundBySource tìm được bản ghi hoàn tiền và recordRefund chặn hoàn tiền trùng', async () => {
        assert.strictEqual(await store.findRefundBySource('unmatched', 'src-1'), null);

        const r = await store.recordRefund({
            source_type: 'unmatched',
            source_id: 'src-1',
            sepay_ref: 'FT-SRC-1',
            amount_vnd: 200000,
            bank_account: '0123456789',
            bank_name: 'MBBank',
            admin_note: 'Hoàn lần 1',
        });

        const found = await store.findRefundBySource('unmatched', 'src-1');
        assert.ok(found);
        assert.strictEqual(found.id, r.id);
        assert.strictEqual(found.amount_vnd, 200000);

        // Khác source_type hoặc khác source_id thì không tìm thấy
        assert.strictEqual(await store.findRefundBySource('duplicate', 'src-1'), null);
        assert.strictEqual(await store.findRefundBySource('unmatched', 'src-2'), null);

        // Ghi đè / hoàn tiền lần 2 cho cùng source_type + source_id phải ném lỗi 23505
        await assert.rejects(
            async () => {
                await store.recordRefund({
                    source_type: 'unmatched',
                    source_id: 'src-1',
                    sepay_ref: 'FT-SRC-1',
                    amount_vnd: 200000,
                    bank_account: '0123456789',
                    bank_name: 'MBBank',
                    admin_note: 'Cố tình hoàn lần 2',
                });
            },
            (err: any) => {
                assert.strictEqual(err.code, '23505');
                assert.match(err.message, /Refund already exists/);
                return true;
            }
        );
    });

    it('getRefundedSourceIds trả về tập hợp source_id đã hoàn tiền chính xác', async () => {
        await store.recordRefund({
            source_type: 'duplicate',
            source_id: 'dup-1',
            sepay_ref: 'FT-D1',
            amount_vnd: 100000,
            bank_account: '123456',
            bank_name: 'Vietinbank',
        });
        await store.recordRefund({
            source_type: 'duplicate',
            source_id: 'dup-3',
            sepay_ref: 'FT-D3',
            amount_vnd: 300000,
            bank_account: '123456',
            bank_name: 'Vietinbank',
        });
        await store.recordRefund({
            source_type: 'unmatched',
            source_id: 'dup-2',
            sepay_ref: 'FT-U2',
            amount_vnd: 200000,
            bank_account: '123456',
            bank_name: 'Vietinbank',
        });

        const set = await store.getRefundedSourceIds('duplicate', ['dup-1', 'dup-2', 'dup-3', 'dup-4']);
        assert.strictEqual(set.has('dup-1'), true);
        assert.strictEqual(set.has('dup-2'), false); // dup-2 là source_type 'unmatched'
        assert.strictEqual(set.has('dup-3'), true);
        assert.strictEqual(set.has('dup-4'), false);
        assert.strictEqual(set.size, 2);

        // Mảng rỗng trả về Set rỗng
        const emptySet = await store.getRefundedSourceIds('duplicate', []);
        assert.strictEqual(emptySet.size, 0);
    });

    it('resolveUnmatchedPayment nối chuỗi admin_note thay vì ghi đè mất thông tin webhook', async () => {
        const u = await store.recordUnmatchedPayment({
            sepay_ref: 'FT-NOTE-1',
            amount_vnd: 100000,
            content: 'LIME 999999',
            raw: {},
            status: 'pending',
            admin_note: 'Thanh toán cho order đã expired (order-uuid-123)',
        });

        // Resolve kèm ghi chú mới
        const resolved = await store.resolveUnmatchedPayment(
            u.id,
            'resolved',
            'Đã đối soát thủ công với user',
            'admin@test.com'
        );

        assert.ok(resolved);
        assert.strictEqual(resolved.status, 'resolved');
        assert.strictEqual(
            resolved.admin_note,
            'Thanh toán cho order đã expired (order-uuid-123) | Đã đối soát thủ công với user'
        );

        // Trường hợp ban đầu chưa có note
        const u2 = await store.recordUnmatchedPayment({
            sepay_ref: 'FT-NOTE-2',
            amount_vnd: 50000,
            content: 'LIME TEST',
            raw: {},
            status: 'pending',
        });

        const resolved2 = await store.resolveUnmatchedPayment(u2.id, 'refunded', 'Đã chuyển khoản trả');
        assert.ok(resolved2);
        assert.strictEqual(resolved2.admin_note, 'Đã chuyển khoản trả');

        // Trường hợp không truyền note thì giữ nguyên note cũ
        const resolved3 = await store.resolveUnmatchedPayment(resolved2.id, 'resolved');
        assert.ok(resolved3);
        assert.strictEqual(resolved3.admin_note, 'Đã chuyển khoản trả');
    });
});
