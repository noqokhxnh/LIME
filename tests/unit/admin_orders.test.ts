import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { type FastifyInstance } from 'fastify';
import { buildApp } from '../../src/index.js';
import { createTestSession } from '../../src/auth/session.js';
import { userStore } from '../../src/admin/userStore.js';
import { billingStorage } from '../../src/billing/storage.js';
import { getConfig } from '../../src/config.js';
import { db, initDatabase } from '../../src/database/index.js';
import { CORE_INDEX_SQL, TRIGRAM_INDEX_SQL } from '../../src/database/indexes.js';

/**
 * Bộ test cho module "Đơn hàng" của cổng quản trị.
 *
 * Trọng tâm (theo kết quả audit nghiệp vụ):
 *  - Bảng đơn hàng phải trả về đúng tên trường (camelCase) + email khách hàng + thông tin gói,
 *    thay vì để frontend hiển thị 0 ₫ / Guest / PRO / N/A.
 *  - Tìm kiếm + lọc trạng thái + phân trang phải do server xử lý.
 *  - Duyệt nạp thủ công phải cộng đúng hạn mức của gói và không cho duyệt lại đơn đã thanh toán.
 */
describe('Admin Orders Management Test Suite', () => {
    let app: FastifyInstance;
    let adminToken: string;
    let userToken: string;

    const ADMIN_ID = '00000000-0000-4000-a000-000000000001';
    const TEST_USER_ID = '00000000-0000-4000-b000-0000000000aa';
    const TEST_USER_EMAIL = 'ordersbuyer@example.com';

    /** Hậu tố duy nhất cho mỗi lần chạy để không đụng dữ liệu cũ trong DB. */
    const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`.toUpperCase();
    const payCode = (suffix: string) => `LIME${RUN}${suffix}`;

    /** ID của 3 đơn hàng seed cho test phân trang. */
    const seededOrderIds: string[] = [];

    async function createOrder(suffix: string, status: 'pending' | 'paid' = 'pending') {
        const created = await billingStorage.createOrder({
            user_id: TEST_USER_ID,
            plan_id: 'creator',
            amount_vnd: 149000,
            pay_code: payCode(suffix),
            status,
            expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        });
        return created;
    }

    before(async () => {
        const config = getConfig();
        if (config.DATABASE_URL) {
            await initDatabase();
            // Đảm bảo user tồn tại cho ràng buộc khoá ngoại của bảng orders.
            await db.query(
                `INSERT INTO users (id, username, email)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (id) DO NOTHING`,
                [TEST_USER_ID, 'ordersbuyer', TEST_USER_EMAIL]
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
            email: TEST_USER_EMAIL,
            username: 'ordersbuyer',
            name: 'Orders Buyer',
            tier: 'creator',
            totalCredits: 50,
            credits: 50,
            creditPercent: 100,
            status: 'active',
        });

        adminToken = createTestSession(ADMIN_ID);
        userToken = createTestSession(TEST_USER_ID);

        // Seed 3 đơn: 2 pending + 1 paid để kiểm tra phân trang và lọc trạng thái.
        seededOrderIds.push((await createOrder('A')).id);
        seededOrderIds.push((await createOrder('B')).id);
        seededOrderIds.push((await createOrder('C', 'paid')).id);
    });

    after(async () => {
        await app.close();
    });

    // -----------------------------------------------------------------
    // 1. Phân quyền
    // -----------------------------------------------------------------
    describe('1. Phân quyền truy cập', () => {
        it('Khách chưa đăng nhập nhận 403 khi xem danh sách đơn hàng', async () => {
            const res = await app.inject({ method: 'GET', url: '/api/admin/orders' });
            assert.strictEqual(res.statusCode, 403);
        });

        it('Người dùng thường nhận 403 khi xem danh sách đơn hàng', async () => {
            const res = await app.inject({
                method: 'GET',
                url: '/api/admin/orders',
                cookies: { vidtml_session: userToken },
            });
            assert.strictEqual(res.statusCode, 403);
        });
    });

    // -----------------------------------------------------------------
    // 2. Danh sách đơn hàng (dữ liệu + phân trang + tìm kiếm + lọc)
    // -----------------------------------------------------------------
    describe('2. Danh sách đơn hàng', () => {
        it('Từ chối trạng thái không hợp lệ bằng 400', async () => {
            const res = await app.inject({
                method: 'GET',
                url: '/api/admin/orders?status=khong-ton-tai',
                cookies: { vidtml_session: adminToken },
            });
            assert.strictEqual(res.statusCode, 400);
            assert.match(JSON.parse(res.body).error, /Trạng thái/);
        });

        it('Trả về đúng trường camelCase, email khách hàng và thông tin gói cước', async () => {
            const res = await app.inject({
                method: 'GET',
                url: `/api/admin/orders?search=${RUN}`,
                cookies: { vidtml_session: adminToken },
            });
            assert.strictEqual(res.statusCode, 200);

            const body = JSON.parse(res.body);
            assert.strictEqual(body.total, 3, 'Phải tìm thấy đúng 3 đơn đã seed');

            const order = body.orders.find((o: any) => o.payCode === payCode('A'));
            assert.ok(order, 'Phải có đơn A trong kết quả');

            // Các trường mà trước đây frontend đọc sai (snake_case) khiến bảng hiển thị 0 ₫ / Guest.
            assert.strictEqual(order.orderId, order.id);
            assert.strictEqual(order.userId, TEST_USER_ID);
            assert.strictEqual(order.userEmail, TEST_USER_EMAIL);
            assert.strictEqual(order.planId, 'creator');
            assert.strictEqual(order.tier, 'creator');
            assert.strictEqual(order.planName, 'Gói Sáng Tạo');
            assert.strictEqual(order.amountVnd, 149000);
            assert.strictEqual(order.quotaVideo, 50);
            assert.strictEqual(order.planDays, 30);
            assert.ok(order.createdAt, 'Phải có createdAt');
            assert.ok(order.expiresAt, 'Phải có expiresAt');
            // Không còn trường snake_case lẫn lộn.
            assert.strictEqual(order.amount_vnd, undefined);
            assert.strictEqual(order.pay_code, undefined);
        });

        it('Phân trang phía server không trùng lặp và đúng tổng số', async () => {
            const page1 = JSON.parse(
                (
                    await app.inject({
                        method: 'GET',
                        url: `/api/admin/orders?search=${RUN}&page=1&limit=2`,
                        cookies: { vidtml_session: adminToken },
                    })
                ).body
            );
            const page2 = JSON.parse(
                (
                    await app.inject({
                        method: 'GET',
                        url: `/api/admin/orders?search=${RUN}&page=2&limit=2`,
                        cookies: { vidtml_session: adminToken },
                    })
                ).body
            );

            assert.strictEqual(page1.total, 3);
            assert.strictEqual(page1.page, 1);
            assert.strictEqual(page1.limit, 2);
            assert.strictEqual(page1.orders.length, 2);
            assert.strictEqual(page2.orders.length, 1);

            const ids = new Set([
                ...page1.orders.map((o: any) => o.orderId),
                ...page2.orders.map((o: any) => o.orderId),
            ]);
            assert.strictEqual(ids.size, 3, 'Hai trang không được trùng đơn hàng');
        });

        it('Lọc theo trạng thái chỉ trả về đơn đúng trạng thái', async () => {
            const res = await app.inject({
                method: 'GET',
                url: `/api/admin/orders?search=${RUN}&status=paid`,
                cookies: { vidtml_session: adminToken },
            });
            const body = JSON.parse(res.body);
            assert.strictEqual(body.total, 1);
            assert.strictEqual(body.orders[0].payCode, payCode('C'));
            assert.strictEqual(body.orders[0].status, 'paid');
        });

        it('Tìm kiếm theo mã đơn trả về đúng một đơn', async () => {
            const res = await app.inject({
                method: 'GET',
                url: `/api/admin/orders?search=${payCode('B')}`,
                cookies: { vidtml_session: adminToken },
            });
            const body = JSON.parse(res.body);
            assert.strictEqual(body.total, 1);
            assert.strictEqual(body.orders[0].payCode, payCode('B'));
        });
    });

    // -----------------------------------------------------------------
    // 3. Duyệt nạp & hủy đơn
    // -----------------------------------------------------------------
    describe('3. Duyệt nạp thủ công & hủy đơn', () => {
        it('Duyệt nạp đơn pending: chuyển paid, không cho duyệt lại', async () => {
            const order = await createOrder('D');

            const fulfillRes = await app.inject({
                method: 'POST',
                url: `/api/admin/orders/${order.id}/fulfill`,
                cookies: { vidtml_session: adminToken },
            });
            assert.strictEqual(fulfillRes.statusCode, 200, fulfillRes.body);

            const after = await billingStorage.findOrderById(order.id);
            assert.strictEqual(after?.status, 'paid');

            const again = await app.inject({
                method: 'POST',
                url: `/api/admin/orders/${order.id}/fulfill`,
                cookies: { vidtml_session: adminToken },
            });
            assert.strictEqual(again.statusCode, 400, 'Không được duyệt lại đơn đã thanh toán');
        });

        it('Hủy đơn đang chờ thành công và không hủy được đơn đã thanh toán', async () => {
            const pending = await createOrder('E');
            const cancelRes = await app.inject({
                method: 'POST',
                url: `/api/admin/orders/${pending.id}/cancel`,
                cookies: { vidtml_session: adminToken },
            });
            assert.strictEqual(cancelRes.statusCode, 200, cancelRes.body);

            const paid = await createOrder('F', 'paid');
            const cancelPaidRes = await app.inject({
                method: 'POST',
                url: `/api/admin/orders/${paid.id}/cancel`,
                cookies: { vidtml_session: adminToken },
            });
            assert.strictEqual(cancelPaidRes.statusCode, 400);
        });

        it('Duyệt nạp đơn đã hủy bị từ chối (400)', async () => {
            const order = await createOrder('G');
            await billingStorage.cancelOrder(order.id);

            const res = await app.inject({
                method: 'POST',
                url: `/api/admin/orders/${order.id}/fulfill`,
                cookies: { vidtml_session: adminToken },
            });
            assert.strictEqual(res.statusCode, 400);
        });
    });

    // -----------------------------------------------------------------
    // 4. Chỉ mục hiệu năng (database indexing)
    // -----------------------------------------------------------------
    describe('4. Chỉ mục hiệu năng', () => {
        it('DDL chỉ mục chứa các chỉ mục phục vụ truy vấn admin', () => {
            assert.match(CORE_INDEX_SQL, /idx_orders_status_created_at/);
            assert.match(CORE_INDEX_SQL, /idx_orders_created_at/);
            assert.match(CORE_INDEX_SQL, /idx_users_active_created_at/);
            assert.match(CORE_INDEX_SQL, /idx_audit_logs_user_created_at/);
            assert.match(TRIGRAM_INDEX_SQL, /idx_orders_pay_code_trgm/);
        });

        it('Chỉ mục được tạo thực tế trong PostgreSQL (khi có DB)', async () => {
            const config = getConfig();
            if (!config.DATABASE_URL) return;

            const res = await db.query(
                `SELECT indexname FROM pg_indexes WHERE indexname = ANY($1::text[])`,
                [
                    [
                        'idx_orders_status_created_at',
                        'idx_orders_created_at',
                        'idx_users_active_created_at',
                        'idx_audit_logs_user_created_at',
                        'idx_unmatched_status_created_at',
                        'idx_refunds_refunded_at',
                        'idx_payments_result_received_at',
                    ],
                ]
            );
            const found = new Set(res.rows.map((r: any) => r.indexname));
            assert.ok(found.has('idx_orders_status_created_at'), 'Thiếu idx_orders_status_created_at');
            assert.ok(found.has('idx_orders_created_at'), 'Thiếu idx_orders_created_at');
            assert.ok(found.has('idx_users_active_created_at'), 'Thiếu idx_users_active_created_at');
            assert.ok(
                found.has('idx_audit_logs_user_created_at'),
                'Thiếu idx_audit_logs_user_created_at'
            );
        });
    });
});
