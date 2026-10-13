import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { type FastifyInstance } from 'fastify';
import { buildApp } from '../../src/index.js';
import { createTestSession } from '../../src/auth/session.js';
import { userStore } from '../../src/admin/userStore.js';
import { billingStorage } from '../../src/billing/storage.js';
import { getConfig } from '../../src/config.js';
import { db, initDatabase } from '../../src/database/index.js';

describe('Admin Failed Payments & Refund Operations Test Suite', () => {
    let app: FastifyInstance;
    let adminToken: string;
    let userToken: string;

    const ADMIN_ID = '00000000-0000-4000-a000-000000000001';
    const TEST_USER_ID = '00000000-0000-4000-b000-000000000002';

    before(async () => {
        const config = getConfig();
        if (config.DATABASE_URL) {
            await initDatabase();
            // Ensure foreign key constraint users(id) exists for order tests
            await db.query(
                `INSERT INTO users (id, username, email)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (id) DO NOTHING`,
                [TEST_USER_ID, 'testbuyer', 'testbuyer@example.com']
            );
        }

        const { getQueue } = await import('../../src/queue/index.js');
        const queue = await getQueue();
        queue.startListeners();
        app = await buildApp({ queue, logger: false });
        await app.ready();

        await userStore.upsertUser({
            id: TEST_USER_ID,
            role: 'user',
            email: 'testbuyer@example.com',
            username: 'testbuyer',
            name: 'Test Buyer',
            tier: 'free',
            totalCredits: 20,
            credits: 15,
            creditPercent: 75,
            status: 'active',
        });

        adminToken = createTestSession(ADMIN_ID);
        userToken = createTestSession(TEST_USER_ID);
    });

    after(async () => {
        await app.close();
    });

    // -----------------------------------------------------------------
    // 1. Phân quyền truy cập (Admin Guards)
    // -----------------------------------------------------------------
    describe('1. Kiểm tra phân quyền truy cập (Admin Guards)', () => {
        it('Khách hoặc user thường bị từ chối 403 khi truy cập các endpoint quản lý giao dịch lỗi', async () => {
            const endpoints = [
                { method: 'GET' as const, url: '/api/admin/unmatched' },
                { method: 'POST' as const, url: '/api/admin/unmatched/test-id/resolve' },
                { method: 'POST' as const, url: '/api/admin/unmatched/test-id/refund' },
                { method: 'GET' as const, url: '/api/admin/payments/duplicates' },
                { method: 'POST' as const, url: '/api/admin/payments/test-id/refund' },
                { method: 'POST' as const, url: '/api/admin/orders/test-id/cancel' },
                { method: 'GET' as const, url: '/api/admin/refunds' },
            ];

            for (const ep of endpoints) {
                // Khách chưa đăng nhập
                const guestRes = await app.inject({
                    method: ep.method,
                    url: ep.url,
                });
                assert.strictEqual(guestRes.statusCode, 403, `Guest accessing ${ep.url} must be 403`);

                // User thường
                const userRes = await app.inject({
                    method: ep.method,
                    url: ep.url,
                    cookies: { vidtml_session: userToken },
                });
                assert.strictEqual(userRes.statusCode, 403, `Normal user accessing ${ep.url} must be 403`);
            }
        });
    });

    // -----------------------------------------------------------------
    // 2. Bảo vệ lỗi UUID (Không gây lỗi 500 PostgreSQL 22P02)
    // -----------------------------------------------------------------
    describe('2. Bảo vệ lỗi cú pháp UUID (An toàn 404, không ném 500)', () => {
        it('POST /api/admin/unmatched/:id/resolve với ID không phải UUID trả về 404', async () => {
            const res = await app.inject({
                method: 'POST',
                url: '/api/admin/unmatched/invalid-uuid-syntax/resolve',
                cookies: { vidtml_session: adminToken },
                body: { adminNote: 'Test note' },
            });
            assert.strictEqual(res.statusCode, 404);
            const body = JSON.parse(res.body);
            assert.strictEqual(body.error, 'Không tìm thấy giao dịch.');
        });

        it('POST /api/admin/unmatched/:id/resolve với orderId trong body không phải UUID trả về 404', async () => {
            // Tạo 1 unmatched payment hợp lệ trước
            const u = await billingStorage.recordUnmatchedPayment({
                sepay_ref: `TEST-REF-${Date.now()}`,
                amount_vnd: 149000,
                content: 'TEST UNMATCHED',
                raw: {},
                status: 'pending',
            });

            const res = await app.inject({
                method: 'POST',
                url: `/api/admin/unmatched/${u.id}/resolve`,
                cookies: { vidtml_session: adminToken },
                body: { orderId: 'not-a-valid-uuid' },
            });
            assert.strictEqual(res.statusCode, 404);
            const body = JSON.parse(res.body);
            assert.strictEqual(body.error, 'Không tìm thấy đơn hàng để đối soát.');
        });

        it('POST /api/admin/unmatched/:id/refund với ID không phải UUID trả về 404', async () => {
            const res = await app.inject({
                method: 'POST',
                url: '/api/admin/unmatched/not-a-uuid-string/refund',
                cookies: { vidtml_session: adminToken },
                body: { bankAccount: '12345678', bankName: 'Vietcombank' },
            });
            assert.strictEqual(res.statusCode, 404);
            const body = JSON.parse(res.body);
            assert.strictEqual(body.error, 'Không tìm thấy giao dịch.');
        });

        it('POST /api/admin/payments/:paymentId/refund với paymentId không phải UUID trả về 404', async () => {
            const res = await app.inject({
                method: 'POST',
                url: '/api/admin/payments/not-a-uuid-string/refund',
                cookies: { vidtml_session: adminToken },
                body: { bankAccount: '12345678', bankName: 'Vietcombank' },
            });
            assert.strictEqual(res.statusCode, 404);
            const body = JSON.parse(res.body);
            assert.strictEqual(body.error, 'Không tìm thấy giao dịch.');
        });

        it('POST /api/admin/orders/:orderId/cancel với orderId không phải UUID trả về 404', async () => {
            const res = await app.inject({
                method: 'POST',
                url: '/api/admin/orders/not-a-uuid-string/cancel',
                cookies: { vidtml_session: adminToken },
            });
            assert.strictEqual(res.statusCode, 404);
            const body = JSON.parse(res.body);
            assert.strictEqual(body.error, 'Không tìm thấy đơn hàng.');
        });
    });

    // -----------------------------------------------------------------
    // 3. Quản lý giao dịch không khớp (Unmatched Payments)
    // -----------------------------------------------------------------
    describe('3. Xử lý giao dịch không khớp (Unmatched Payments)', () => {
        it('GET /api/admin/unmatched trả về danh sách có phân loại status', async () => {
            const res = await app.inject({
                method: 'GET',
                url: '/api/admin/unmatched?status=pending',
                cookies: { vidtml_session: adminToken },
            });
            assert.strictEqual(res.statusCode, 200);
            const body = JSON.parse(res.body);
            assert.ok(Array.isArray(body.unmatched));
            assert.strictEqual(typeof body.total, 'number');
        });

        it('Đối soát thành công unmatched payment và nối chuỗi admin_note', async () => {
            const u = await billingStorage.recordUnmatchedPayment({
                sepay_ref: `TEST-RESOLVE-${Date.now()}`,
                amount_vnd: 249000,
                content: 'LIME DIAGNOSTIC TEST',
                raw: {},
                status: 'pending',
                admin_note: 'Thanh toán cho order đã expired (order-old-123)',
            });

            const res = await app.inject({
                method: 'POST',
                url: `/api/admin/unmatched/${u.id}/resolve`,
                cookies: { vidtml_session: adminToken },
                body: { adminNote: 'Admin đã kích hoạt gói tay cho khách' },
            });

            assert.strictEqual(res.statusCode, 200);
            const body = JSON.parse(res.body);
            assert.strictEqual(body.success, true);
            assert.strictEqual(body.unmatched.status, 'resolved');
            assert.strictEqual(
                body.unmatched.admin_note,
                'Thanh toán cho order đã expired (order-old-123) | Admin đã kích hoạt gói tay cho khách'
            );

            // Cố tình đối soát lại lần 2 phải bị từ chối 400
            const secondRes = await app.inject({
                method: 'POST',
                url: `/api/admin/unmatched/${u.id}/resolve`,
                cookies: { vidtml_session: adminToken },
                body: { adminNote: 'Đối soát lại' },
            });
            assert.strictEqual(secondRes.statusCode, 400);
            assert.strictEqual(JSON.parse(secondRes.body).error, 'Giao dịch này đã được xử lý trước đó.');
        });
    });

    // -----------------------------------------------------------------
    // 4. Hoàn tiền giao dịch không khớp & Chặn Double-Refund
    // -----------------------------------------------------------------
    describe('4. Hoàn tiền Unmatched Payments & Chặn Double-Refund', () => {
        it('Từ chối hoàn tiền nếu thiếu hoặc sai định dạng STK/Ngân hàng', async () => {
            const u = await billingStorage.recordUnmatchedPayment({
                sepay_ref: `TEST-REFUND-VAL-${Date.now()}`,
                amount_vnd: 100000,
                content: 'LIME VALIDATION',
                raw: {},
                status: 'pending',
            });

            // Thiếu bankAccount
            const res1 = await app.inject({
                method: 'POST',
                url: `/api/admin/unmatched/${u.id}/refund`,
                cookies: { vidtml_session: adminToken },
                body: { bankName: 'MBBank' },
            });
            assert.strictEqual(res1.statusCode, 400);

            // STK quá dài (> 50 ký tự)
            const res2 = await app.inject({
                method: 'POST',
                url: `/api/admin/unmatched/${u.id}/refund`,
                cookies: { vidtml_session: adminToken },
                body: { bankAccount: 'A'.repeat(51), bankName: 'MBBank' },
            });
            assert.strictEqual(res2.statusCode, 400);
        });

        it('Hoàn tiền unmatched thành công và ngăn chặn triệt để Double-Refund', async () => {
            const u = await billingStorage.recordUnmatchedPayment({
                sepay_ref: `TEST-DOUBLE-UM-${Date.now()}`,
                amount_vnd: 149000,
                content: 'LIME REFUND TEST',
                raw: {},
                status: 'pending',
            });

            // Hoàn tiền lần 1 thành công
            const res1 = await app.inject({
                method: 'POST',
                url: `/api/admin/unmatched/${u.id}/refund`,
                cookies: { vidtml_session: adminToken },
                body: {
                    bankAccount: '0987654321',
                    bankName: 'Vietinbank',
                    adminNote: 'Hoàn lại tiền do khách chuyển nhầm',
                },
            });
            assert.strictEqual(res1.statusCode, 200);
            const data1 = JSON.parse(res1.body);
            assert.strictEqual(data1.success, true);
            assert.strictEqual(data1.refund.source_type, 'unmatched');
            assert.strictEqual(data1.refund.source_id, u.id);

            // Hoàn tiền lần 2 cho cùng giao dịch phải bị chặn 400
            const res2 = await app.inject({
                method: 'POST',
                url: `/api/admin/unmatched/${u.id}/refund`,
                cookies: { vidtml_session: adminToken },
                body: {
                    bankAccount: '0987654321',
                    bankName: 'Vietinbank',
                    adminNote: 'Cố tình hoàn lại lần 2',
                },
            });
            assert.strictEqual(res2.statusCode, 400);
            const errBody = JSON.parse(res2.body);
            assert.ok(
                errBody.error === 'Giao dịch này đã được hoàn tiền trước đó.' ||
                errBody.error === 'Giao dịch này đã được xử lý trước đó.'
            );
        });
    });

    // -----------------------------------------------------------------
    // 5. Giao dịch trùng lặp (Duplicate Payments) & Hoàn tiền trùng
    // -----------------------------------------------------------------
    describe('5. Giao dịch trùng lặp (Duplicate Payments) & Chặn Double-Refund', () => {
        it('Hiển thị danh sách duplicates với cờ alreadyRefunded chính xác', async () => {
            const order = await billingStorage.createOrder({
                user_id: TEST_USER_ID,
                plan_id: 'creator',
                amount_vnd: 149000,
                pay_code: `DUP${Date.now().toString(36).slice(-6).toUpperCase()}`,
                status: 'paid',
                expires_at: new Date(Date.now() + 3600000).toISOString(),
                claimed_at: null,
                paid_at: new Date().toISOString(),
            });

            const dupPayment = await billingStorage.recordDuplicatePayment({
                orderId: order.id,
                sepayRef: `DUP-SEPAY-${Date.now()}`,
                amount: 149000,
                raw: {},
            });

            // GET duplicates kiểm tra cờ alreadyRefunded = false
            const getRes1 = await app.inject({
                method: 'GET',
                url: '/api/admin/payments/duplicates',
                cookies: { vidtml_session: adminToken },
            });
            assert.strictEqual(getRes1.statusCode, 200);
            const data1 = JSON.parse(getRes1.body);
            const found1 = data1.duplicates.find((p: any) => p.id === dupPayment.id);
            assert.ok(found1);
            assert.strictEqual(found1.alreadyRefunded, false);

            // Hoàn tiền duplicate payment
            const refundRes = await app.inject({
                method: 'POST',
                url: `/api/admin/payments/${dupPayment.id}/refund`,
                cookies: { vidtml_session: adminToken },
                body: {
                    bankAccount: '97042212345678',
                    bankName: 'MBBank',
                    adminNote: 'Hoàn tiền chuyển thừa',
                },
            });
            assert.strictEqual(refundRes.statusCode, 200);
            const refundData = JSON.parse(refundRes.body);
            assert.strictEqual(refundData.success, true);
            assert.strictEqual(refundData.refund.source_type, 'duplicate');
            assert.strictEqual(refundData.refund.source_id, dupPayment.id);

            // GET duplicates kiểm tra cờ alreadyRefunded = true
            const getRes2 = await app.inject({
                method: 'GET',
                url: '/api/admin/payments/duplicates',
                cookies: { vidtml_session: adminToken },
            });
            const data2 = JSON.parse(getRes2.body);
            const found2 = data2.duplicates.find((p: any) => p.id === dupPayment.id);
            assert.ok(found2);
            assert.strictEqual(found2.alreadyRefunded, true);

            // Hoàn tiền lần 2 phải bị chặn 400
            const doubleRefundRes = await app.inject({
                method: 'POST',
                url: `/api/admin/payments/${dupPayment.id}/refund`,
                cookies: { vidtml_session: adminToken },
                body: {
                    bankAccount: '97042212345678',
                    bankName: 'MBBank',
                    adminNote: 'Double refund attempt',
                },
            });
            assert.strictEqual(doubleRefundRes.statusCode, 400);
            assert.strictEqual(
                JSON.parse(doubleRefundRes.body).error,
                'Giao dịch này đã được hoàn tiền trước đó.'
            );
        });
    });

    // -----------------------------------------------------------------
    // 6. Hủy đơn hàng (Order Cancellation)
    // -----------------------------------------------------------------
    describe('6. Hủy đơn hàng (POST /api/admin/orders/:orderId/cancel)', () => {
        it('Hủy đơn hàng pending thành công và từ chối đơn đã hủy', async () => {
            const order = await billingStorage.createOrder({
                user_id: TEST_USER_ID,
                plan_id: 'pro',
                amount_vnd: 249000,
                pay_code: `CNC${Date.now().toString(36).slice(-6).toUpperCase()}`,
                status: 'pending',
                expires_at: new Date(Date.now() + 3600000).toISOString(),
                claimed_at: null,
                paid_at: null,
            });

            const cancelRes = await app.inject({
                method: 'POST',
                url: `/api/admin/orders/${order.id}/cancel`,
                cookies: { vidtml_session: adminToken },
            });
            assert.strictEqual(cancelRes.statusCode, 200);
            const cancelData = JSON.parse(cancelRes.body);
            assert.strictEqual(cancelData.success, true);
            assert.strictEqual(cancelData.order.status, 'cancelled');

            // Hủy lại lần nữa phải bị từ chối 400
            const secondCancel = await app.inject({
                method: 'POST',
                url: `/api/admin/orders/${order.id}/cancel`,
                cookies: { vidtml_session: adminToken },
            });
            assert.strictEqual(secondCancel.statusCode, 400);
            assert.strictEqual(
                JSON.parse(secondCancel.body).error,
                'Chỉ hủy được đơn hàng đang chờ thanh toán.'
            );
        });
    });

    // -----------------------------------------------------------------
    // 7. Lịch sử hoàn tiền (GET /api/admin/refunds)
    // -----------------------------------------------------------------
    describe('7. Lịch sử hoàn tiền (GET /api/admin/refunds)', () => {
        it('Trả về danh sách lịch sử hoàn tiền đầy đủ', async () => {
            const res = await app.inject({
                method: 'GET',
                url: '/api/admin/refunds',
                cookies: { vidtml_session: adminToken },
            });
            assert.strictEqual(res.statusCode, 200);
            const data = JSON.parse(res.body);
            assert.ok(Array.isArray(data.refunds));
            assert.ok(data.total >= 2);
            assert.ok(data.refunds.some((r: any) => r.source_type === 'unmatched'));
            assert.ok(data.refunds.some((r: any) => r.source_type === 'duplicate'));
        });
    });
});
