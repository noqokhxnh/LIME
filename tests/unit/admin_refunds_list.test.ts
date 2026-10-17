import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { type FastifyInstance } from 'fastify';
import { buildApp } from '../../src/index.js';
import { createTestSession } from '../../src/auth/session.js';
import { billingStorage } from '../../src/billing/storage.js';
import { getConfig } from '../../src/config.js';
import { db, initDatabase } from '../../src/database/index.js';

/**
 * Bộ test cho bộ lọc + phân trang của lịch sử hoàn tiền ở trang "Thanh toán lỗi":
 *  - GET /api/admin/refunds
 *
 * Trước đây endpoint trả tối đa 100 bản ghi mới nhất (`LIMIT 100`), không lọc được
 * theo từ khoá/khoảng thời gian/loại nguồn và không phân trang; ở chế độ in-memory
 * lại trả về toàn bộ nên hai chế độ hành xử khác nhau.
 */
describe('Admin Refund History (lọc + phân trang) Test Suite', () => {
    let app: FastifyInstance;
    let adminToken: string;
    let hasDatabase = false;

    const ADMIN_ID = '00000000-0000-4000-a000-000000000001';

    /** Hậu tố duy nhất mỗi lần chạy để không đụng dữ liệu của test khác. */
    const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
    const TAG = `zltrf-${RUN}`;

    const getRefunds = (queryString = '') =>
        app.inject({
            method: 'GET',
            url: `/api/admin/refunds${queryString}`,
            cookies: { vidtml_session: adminToken },
        });

    const seedRefund = (suffix: string, sourceType: 'unmatched' | 'duplicate', amount: number, refundedBy: string, note: string) =>
        billingStorage.recordRefund({
            source_type: sourceType,
            source_id: `${TAG}-SRC-${suffix}`,
            sepay_ref: `${TAG}-${suffix}`,
            amount_vnd: amount,
            bank_account: '0123456789',
            bank_name: 'Vietcombank',
            admin_note: note,
            refunded_by: refundedBy,
        });

    before(async () => {
        const config = getConfig();
        hasDatabase = Boolean(config.DATABASE_URL);

        if (hasDatabase) {
            await initDatabase();
        }

        const { getQueue } = await import('../../src/queue/index.js');
        const queue = await getQueue();
        queue.startListeners();
        app = await buildApp({ queue, logger: false });
        await app.ready();
        adminToken = createTestSession(ADMIN_ID);

        // 3 bản ghi nguồn 'unmatched' + 2 bản ghi nguồn 'duplicate'.
        await seedRefund('U1', 'unmatched', 777001, 'admin-alpha', `hoan ${TAG} giao dịch lạ`);
        await seedRefund('U2', 'unmatched', 777002, 'admin-beta', `hoan ${TAG} giao dịch lạ`);
        await seedRefund('U3', 'unmatched', 777003, 'admin-beta', 'ghi chu khac');
        await seedRefund('D1', 'duplicate', 777004, 'admin-alpha', 'trung lap');
        await seedRefund('D2', 'duplicate', 777005, 'admin-gamma', 'trung lap');
    });

    after(async () => {
        if (hasDatabase) {
            await db.query('DELETE FROM refunds WHERE sepay_ref LIKE $1', [`${TAG}%`]);
        }
        await app.close();
    });

    it('Tìm kiếm theo mã SePay trả đúng các bản ghi của test', async () => {
        const res = await getRefunds(`?search=${encodeURIComponent(TAG)}&limit=50`);
        assert.strictEqual(res.statusCode, 200, res.body);
        const body = res.json();

        assert.strictEqual(body.total, 5);
        assert.strictEqual(body.refunds.length, 5);
        for (const item of body.refunds) {
            assert.ok(String(item.sepay_ref).startsWith(TAG), 'Chỉ trả về bản ghi khớp từ khoá');
        }
    });

    it('Lọc theo loại nguồn (sourceType) kết hợp từ khoá', async () => {
        const unmatched = await getRefunds(`?sourceType=unmatched&search=${encodeURIComponent(TAG)}&limit=50`);
        const unmatchedBody = unmatched.json();
        assert.strictEqual(unmatchedBody.total, 3);
        for (const item of unmatchedBody.refunds) {
            assert.strictEqual(item.source_type, 'unmatched');
        }

        const duplicate = await getRefunds(`?sourceType=duplicate&search=${encodeURIComponent(TAG)}&limit=50`);
        const duplicateBody = duplicate.json();
        assert.strictEqual(duplicateBody.total, 2);
        for (const item of duplicateBody.refunds) {
            assert.strictEqual(item.source_type, 'duplicate');
        }

        // sourceType=all tương đương không lọc.
        const all = await getRefunds(`?sourceType=all&search=${encodeURIComponent(TAG)}&limit=50`);
        assert.strictEqual(all.json().total, 5);
    });

    it('Tìm kiếm khớp cả người duyệt, ghi chú và số tiền', async () => {
        const byAdmin = await getRefunds(`?search=${encodeURIComponent('admin-beta')}&limit=50`);
        assert.ok(byAdmin.json().total >= 2, 'Phải khớp theo người duyệt');

        const byNote = await getRefunds(`?search=${encodeURIComponent('ghi chu khac')}&limit=50`);
        assert.ok(byNote.json().total >= 1, 'Phải khớp theo ghi chú');

        const byAmount = await getRefunds(`?search=777003&limit=50`);
        assert.ok(byAmount.json().total >= 1, 'Phải khớp theo số tiền');
    });

    it('Lọc theo khoảng thời gian (from/to)', async () => {
        const tag = `search=${encodeURIComponent(TAG)}`;
        const hourAgo = new Date(Date.now() - 3600_000).toISOString();
        const inAnHour = new Date(Date.now() + 3600_000).toISOString();

        const recent = await getRefunds(`?${tag}&from=${encodeURIComponent(hourAgo)}&limit=50`);
        assert.strictEqual(recent.json().total, 5);

        const future = await getRefunds(`?${tag}&from=${encodeURIComponent(inAnHour)}&limit=50`);
        assert.strictEqual(future.json().total, 0);

        const untilNow = await getRefunds(`?${tag}&to=${encodeURIComponent(inAnHour)}&limit=50`);
        assert.strictEqual(untilNow.json().total, 5);

        const past = await getRefunds(`?${tag}&to=${encodeURIComponent(hourAgo)}&limit=50`);
        assert.strictEqual(past.json().total, 0);
    });

    it('Phân trang khi client gửi limit, giữ hành vi cũ khi không gửi', async () => {
        const tag = `search=${encodeURIComponent(TAG)}`;

        const page1 = await getRefunds(`?${tag}&limit=2&page=1`);
        const body1 = page1.json();
        assert.strictEqual(body1.total, 5, 'total là tổng số bản ghi khớp lọc');
        assert.strictEqual(body1.refunds.length, 2);
        assert.strictEqual(body1.page, 1);
        assert.strictEqual(body1.limit, 2);

        const page3 = await getRefunds(`?${tag}&limit=2&page=3`);
        const body3 = page3.json();
        assert.strictEqual(body3.refunds.length, 1);

        const ids1 = body1.refunds.map((r: any) => r.id);
        const ids3 = body3.refunds.map((r: any) => r.id);
        assert.strictEqual(ids1.filter((id: string) => ids3.includes(id)).length, 0, 'Các trang không trùng bản ghi');

        // Không gửi limit ⇒ giới hạn mặc định 100, không phân trang.
        const legacy = await getRefunds(`?${tag}`);
        const legacyBody = legacy.json();
        assert.strictEqual(legacyBody.total, 5);
        assert.strictEqual(legacyBody.refunds.length, 5);
        assert.strictEqual(legacyBody.limit, 100);
    });

    it('Từ chối tham số không hợp lệ (400)', async () => {
        for (const qs of [
            '?sourceType=khong-ton-tai',
            '?limit=0',
            '?limit=abc',
            '?limit=2&page=0',
            '?limit=2&page=xyz',
            '?from=khong-phai-ngay',
            '?to=khong-phai-ngay',
        ]) {
            const res = await getRefunds(qs);
            assert.strictEqual(res.statusCode, 400, `${qs} phải bị từ chối`);
        }
    });
});
