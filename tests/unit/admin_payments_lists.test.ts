import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { type FastifyInstance } from 'fastify';
import { buildApp } from '../../src/index.js';
import { createTestSession } from '../../src/auth/session.js';
import { userStore } from '../../src/admin/userStore.js';
import { billingStorage } from '../../src/billing/storage.js';
import { getConfig } from '../../src/config.js';
import { db, initDatabase } from '../../src/database/index.js';

/**
 * Bộ test cho bộ lọc + phân trang của hai danh sách ở trang "Thanh toán lỗi":
 *  - GET /api/admin/unmatched
 *  - GET /api/admin/payments/duplicates
 *
 * Trước đây cả hai endpoint chỉ trả tối đa 100 bản ghi mới nhất (`LIMIT 100`), không
 * lọc được theo từ khoá/khoảng thời gian, không phân trang; endpoint duplicates còn
 * tra từng dòng (N+1: mỗi giao dịch lại 1 truy vấn đơn hàng + 1 truy vấn người dùng).
 */
describe('Admin Payments Lists (lọc + phân trang) Test Suite', () => {
    let app: FastifyInstance;
    let adminToken: string;
    let hasDatabase = false;

    const ADMIN_ID = '00000000-0000-4000-a000-000000000001';
    const TEST_USER_ID = '00000000-0000-4000-b000-000000000002';

    /** Hậu tố duy nhất mỗi lần chạy để không đụng dữ liệu của test khác. */
    const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
    const TAG = `zltpay-${RUN}`;
    const ORDER_PAY_CODE = `ZLTD${RUN}`.toUpperCase();
    const BUYER_EMAIL = `zltbuyer-${RUN}@example.com`;

    const getUnmatched = (queryString = '') =>
        app.inject({
            method: 'GET',
            url: `/api/admin/unmatched${queryString}`,
            cookies: { vidtml_session: adminToken },
        });

    const getDuplicates = (queryString = '') =>
        app.inject({
            method: 'GET',
            url: `/api/admin/payments/duplicates${queryString}`,
            cookies: { vidtml_session: adminToken },
        });

    before(async () => {
        const config = getConfig();
        hasDatabase = Boolean(config.DATABASE_URL);

        if (hasDatabase) {
            await initDatabase();
            // Đảm bảo user tồn tại cho ràng buộc khoá ngoại của bảng orders, đồng thời
            // ghi đè email (bản ghi cũ của lần chạy trước có thể còn trong DB).
            await db.query(
                `INSERT INTO users (id, username, email)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, username = EXCLUDED.username`,
                [TEST_USER_ID, `zltbuyer${RUN}`, BUYER_EMAIL]
            );
        }

        const { getQueue } = await import('../../src/queue/index.js');
        const queue = await getQueue();
        queue.startListeners();
        app = await buildApp({ queue, logger: false });
        await app.ready();
        adminToken = createTestSession(ADMIN_ID);

        // Ở chế độ in-memory, email khách hàng được lấy từ userStore nên phải nạp vào đó.
        await userStore.upsertUser({
            id: TEST_USER_ID,
            role: 'user',
            email: BUYER_EMAIL,
            username: `zltbuyer${RUN}`,
            name: 'ZLT Buyer',
            tier: 'free',
            credits: 20,
            totalCredits: 20,
            status: 'active',
        });

        // 3 giao dịch chưa khớp (unmatched) với trạng thái khác nhau.
        await billingStorage.recordUnmatchedPayment({
            sepay_ref: `${TAG}-PEND`,
            amount_vnd: 111000,
            content: `${TAG} giao dịch chờ`,
            raw: {},
            status: 'pending',
        });
        await billingStorage.recordUnmatchedPayment({
            sepay_ref: `${TAG}-RES`,
            amount_vnd: 222000,
            content: `${TAG} giao dịch đã đối soát`,
            raw: {},
            status: 'resolved',
        });
        await billingStorage.recordUnmatchedPayment({
            sepay_ref: `${TAG}-REF`,
            amount_vnd: 333000,
            content: `${TAG} giao dịch đã hoàn tiền`,
            raw: {},
            status: 'refunded',
        });

        // 1 đơn hàng gốc + 3 giao dịch trùng lặp trỏ về đơn đó.
        const order = await billingStorage.createOrder({
            user_id: TEST_USER_ID,
            plan_id: 'creator',
            amount_vnd: 149000,
            pay_code: ORDER_PAY_CODE,
            status: 'paid',
            expires_at: new Date(Date.now() + 3600_000).toISOString(),
            claimed_at: null,
            paid_at: new Date().toISOString(),
        });
        for (const suffix of ['1', '2', '3']) {
            await billingStorage.recordDuplicatePayment({
                orderId: order.id,
                sepayRef: `${TAG}-DUP-${suffix}`,
                amount: 149000,
                raw: {},
            });
        }
    });

    after(async () => {
        if (hasDatabase) {
            // Dọn riêng dữ liệu của bài test này.
            await db.query('DELETE FROM payments WHERE sepay_ref LIKE $1', [`${TAG}%`]);
            await db.query('DELETE FROM unmatched_payments WHERE sepay_ref LIKE $1', [`${TAG}%`]);
            await db.query('DELETE FROM orders WHERE pay_code = $1', [ORDER_PAY_CODE]);
        }
        await app.close();
    });

    // -----------------------------------------------------------------
    // 1. Lọc danh sách unmatched
    // -----------------------------------------------------------------
    describe('1. GET /api/admin/unmatched — lọc + phân trang', () => {
        it('Lọc theo từ khoá (search) trên mã SePay/nội dung', async () => {
            const res = await getUnmatched(`?status=all&search=${encodeURIComponent(TAG)}&limit=50`);
            assert.strictEqual(res.statusCode, 200, res.body);
            const body = res.json();

            assert.strictEqual(body.total, 3);
            assert.strictEqual(body.unmatched.length, 3);
            for (const item of body.unmatched) {
                assert.ok(String(item.sepay_ref).startsWith(TAG), 'Chỉ trả về bản ghi khớp từ khoá');
            }
        });

        it('Lọc theo trạng thái kết hợp từ khoá', async () => {
            const pending = await getUnmatched(`?status=pending&search=${encodeURIComponent(TAG)}&limit=50`);
            const pendingBody = pending.json();
            assert.strictEqual(pendingBody.total, 1);
            assert.strictEqual(pendingBody.unmatched[0].status, 'pending');

            const refunded = await getUnmatched(`?status=refunded&search=${encodeURIComponent(TAG)}&limit=50`);
            assert.strictEqual(refunded.json().total, 1);
        });

        it('Lọc theo khoảng thời gian (from/to)', async () => {
            const hourAgo = new Date(Date.now() - 3600_000).toISOString();
            const inAnHour = new Date(Date.now() + 3600_000).toISOString();
            const tag = `status=all&search=${encodeURIComponent(TAG)}`;

            const recent = await getUnmatched(`?${tag}&from=${encodeURIComponent(hourAgo)}&limit=50`);
            assert.strictEqual(recent.json().total, 3);

            const future = await getUnmatched(`?${tag}&from=${encodeURIComponent(inAnHour)}&limit=50`);
            assert.strictEqual(future.json().total, 0);

            const untilNow = await getUnmatched(`?${tag}&to=${encodeURIComponent(inAnHour)}&limit=50`);
            assert.strictEqual(untilNow.json().total, 3);

            const past = await getUnmatched(`?${tag}&to=${encodeURIComponent(hourAgo)}&limit=50`);
            assert.strictEqual(past.json().total, 0);
        });

        it('Phân trang khi client gửi limit, giữ hành vi cũ khi không gửi', async () => {
            const tag = `status=all&search=${encodeURIComponent(TAG)}`;

            const page1 = await getUnmatched(`?${tag}&limit=2&page=1`);
            const body1 = page1.json();
            assert.strictEqual(body1.total, 3, 'total là tổng số bản ghi khớp lọc');
            assert.strictEqual(body1.unmatched.length, 2);
            assert.strictEqual(body1.page, 1);
            assert.strictEqual(body1.limit, 2);

            const page2 = await getUnmatched(`?${tag}&limit=2&page=2`);
            const body2 = page2.json();
            assert.strictEqual(body2.unmatched.length, 1);

            const ids1 = body1.unmatched.map((u: any) => u.id);
            const ids2 = body2.unmatched.map((u: any) => u.id);
            assert.strictEqual(ids1.filter((id: string) => ids2.includes(id)).length, 0);

            // Không gửi limit ⇒ giới hạn mặc định 100, không phân trang.
            const legacy = await getUnmatched(`?${tag}`);
            const legacyBody = legacy.json();
            assert.strictEqual(legacyBody.total, 3);
            assert.strictEqual(legacyBody.unmatched.length, 3);
            assert.strictEqual(legacyBody.limit, 100);
        });

        it('Từ chối tham số không hợp lệ (400)', async () => {
            for (const qs of [
                '?status=khong-ton-tai',
                '?limit=0',
                '?limit=abc',
                '?limit=2&page=0',
                '?limit=2&page=xyz',
                '?from=khong-phai-ngay',
                '?to=khong-phai-ngay',
            ]) {
                const res = await getUnmatched(qs);
                assert.strictEqual(res.statusCode, 400, `${qs} phải bị từ chối`);
            }
        });
    });

    // -----------------------------------------------------------------
    // 2. Lọc danh sách duplicates
    // -----------------------------------------------------------------
    describe('2. GET /api/admin/payments/duplicates — lọc + phân trang', () => {
        it('Lọc theo mã đơn gốc và làm giàu dữ liệu đơn hàng/khách hàng', async () => {
            const res = await getDuplicates(`?search=${encodeURIComponent(ORDER_PAY_CODE)}&limit=50`);
            assert.strictEqual(res.statusCode, 200, res.body);
            const body = res.json();

            assert.strictEqual(body.total, 3);
            assert.strictEqual(body.duplicates.length, 3);
            for (const item of body.duplicates) {
                assert.strictEqual(item.order?.pay_code, ORDER_PAY_CODE, 'Phải kèm thông tin đơn gốc');
                assert.strictEqual(item.userEmail, BUYER_EMAIL, 'Phải kèm email khách hàng (tra gộp)');
                assert.strictEqual(item.alreadyRefunded, false);
                assert.ok(String(item.sepay_ref).startsWith(TAG));
            }
        });

        it('Phân trang duplicates', async () => {
            const search = `search=${encodeURIComponent(ORDER_PAY_CODE)}`;

            const page1 = await getDuplicates(`?${search}&limit=2&page=1`);
            const body1 = page1.json();
            assert.strictEqual(body1.total, 3);
            assert.strictEqual(body1.duplicates.length, 2);

            const page2 = await getDuplicates(`?${search}&limit=2&page=2`);
            assert.strictEqual(page2.json().duplicates.length, 1);

            const ids1 = body1.duplicates.map((p: any) => p.id);
            const ids2 = page2.json().duplicates.map((p: any) => p.id);
            assert.strictEqual(ids1.filter((id: string) => ids2.includes(id)).length, 0);

            const legacy = await getDuplicates(`?${search}`);
            assert.strictEqual(legacy.json().total, 3);
            assert.strictEqual(legacy.json().limit, 100);
        });

        it('Lọc duplicates theo khoảng thời gian', async () => {
            const search = `search=${encodeURIComponent(ORDER_PAY_CODE)}`;
            const inAnHour = new Date(Date.now() + 3600_000).toISOString();

            const included = await getDuplicates(`?${search}&to=${encodeURIComponent(inAnHour)}&limit=50`);
            assert.strictEqual(included.json().total, 3);

            const excluded = await getDuplicates(`?${search}&from=${encodeURIComponent(inAnHour)}&limit=50`);
            assert.strictEqual(excluded.json().total, 0);
        });

        it('Từ chối tham số không hợp lệ (400)', async () => {
            for (const qs of ['?limit=0', '?limit=2&page=-1', '?to=khong-phai-ngay']) {
                const res = await getDuplicates(qs);
                assert.strictEqual(res.statusCode, 400, `${qs} phải bị từ chối`);
            }
        });
    });
});
