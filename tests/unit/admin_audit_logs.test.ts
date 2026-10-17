import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { type FastifyInstance } from 'fastify';
import { buildApp } from '../../src/index.js';
import { createTestSession } from '../../src/auth/session.js';
import { getConfig } from '../../src/config.js';
import { initDatabase } from '../../src/database/index.js';
import { auditLog } from '../../src/security/auditLog.js';
import { systemSettings } from '../../src/admin/systemSettings.js';

/**
 * Bộ test cho module "Nhật ký kiểm toán" (Audit Logs) của cổng quản trị.
 *
 * Trọng tâm (theo kết quả audit nghiệp vụ):
 *  - Bản ghi thiếu danh tính NGƯỜI THỰC HIỆN (actor) và IP.
 *  - `DELETE /api/admin/audit-logs` xoá bằng `TRUNCATE` bắn đi không chờ → lỗi bị bỏ
 *    qua, và bản ghi "đã xoá nhật ký" bị chính lệnh TRUNCATE cuốn mất.
 *  - Danh sách không lọc được theo trạng thái/thời gian và không phân trang.
 */

const ADMIN_ID = '00000000-0000-4000-a000-000000000001';
const ADMIN_EMAIL = 'khanh2k5xxx@gmail.com';

/** Hậu tố duy nhất mỗi lần chạy để không đụng dữ liệu của test khác. */
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
const TAG = `zltaudit-${RUN}`;
const TEST_ACTION = `test.audit_logs.${RUN}`;
const FORWARDED_IP = '203.0.113.7';

const config = getConfig();

describe('Admin Audit Logs Test Suite', () => {
    let app: FastifyInstance;
    let adminToken: string;
    let userToken: string;
    let originalNotice: string;

    const getLogs = (queryString = '') =>
        app.inject({
            method: 'GET',
            url: `/api/admin/audit-logs${queryString}`,
            cookies: { vidtml_session: adminToken },
        });

    const delLogs = (queryString = '', token = adminToken) =>
        app.inject({
            method: 'DELETE',
            url: `/api/admin/audit-logs${queryString}`,
            headers: { 'x-forwarded-for': FORWARDED_IP },
            cookies: { vidtml_session: token },
        });

    before(async () => {
        if (config.DATABASE_URL) {
            await initDatabase();
        }
        originalNotice = systemSettings.get().systemNotice;
        app = await buildApp({ logger: false });
        await app.ready();
        adminToken = createTestSession(ADMIN_ID);
        userToken = createTestSession('00000000-0000-4000-a000-0000000000ff');

        // 3 bản ghi có action duy nhất cho bài test: 2 thành công + 1 thất bại.
        await auditLog.recordAndPersist({
            action: TEST_ACTION,
            status: 'success',
            userId: '00000000-0000-4000-a000-000000000123',
            userEmail: `target-${RUN}@example.com`,
            actorId: ADMIN_ID,
            actorEmail: ADMIN_EMAIL,
            ip: FORWARDED_IP,
            details: { note: TAG, targetEmail: `target-${RUN}@example.com` },
        });
        await auditLog.recordAndPersist({
            action: TEST_ACTION,
            status: 'success',
            actorId: ADMIN_ID,
            actorEmail: ADMIN_EMAIL,
            ip: FORWARDED_IP,
            details: { note: TAG },
        });
        await auditLog.recordAndPersist({
            action: TEST_ACTION,
            status: 'failure',
            actorId: ADMIN_ID,
            actorEmail: ADMIN_EMAIL,
            ip: FORWARDED_IP,
            details: { note: TAG },
        });
    });

    after(async () => {
        // Dọn riêng các bản ghi của bài test (không đụng nhật ký của test khác).
        try {
            await auditLog.clear({ action: TEST_ACTION });
        } catch {
            /* bỏ qua */
        }
        systemSettings.update({ systemNotice: originalNotice });
        await app.close();
    });

    // ------------------------------------------------------------------
    // 1. Phân quyền
    // ------------------------------------------------------------------
    it('Chặn người dùng thường (403) khi đọc/xoá nhật ký', async () => {
        const read = await app.inject({
            method: 'GET',
            url: '/api/admin/audit-logs',
            cookies: { vidtml_session: userToken },
        });
        assert.strictEqual(read.statusCode, 403);

        const clear = await delLogs('', userToken);
        assert.strictEqual(clear.statusCode, 403);
    });

    // ------------------------------------------------------------------
    // 2. Actor + IP tự động từ route thật
    // ------------------------------------------------------------------
    it('Tự động ghi danh tính người thực hiện và IP cho hành động quản trị', async () => {
        const res = await app.inject({
            method: 'PUT',
            url: '/api/admin/settings',
            headers: { 'x-forwarded-for': FORWARDED_IP },
            cookies: { vidtml_session: adminToken },
            payload: { systemNotice: TAG },
        });
        assert.strictEqual(res.statusCode, 200, res.body);

        const logsRes = await getLogs(`?action=admin.settings_updated&search=${encodeURIComponent(TAG)}&limit=10`);
        assert.strictEqual(logsRes.statusCode, 200, logsRes.body);
        const logs = logsRes.json().logs;
        assert.ok(logs.length >= 1, 'Phải tìm thấy bản ghi vừa tạo');

        assert.strictEqual(logs[0].action, 'admin.settings_updated');
        assert.strictEqual(logs[0].actorEmail, ADMIN_EMAIL, 'Phải ghi rõ ai là người thực hiện');
        assert.strictEqual(logs[0].actorId, ADMIN_ID);
        assert.strictEqual(logs[0].ip, FORWARDED_IP, 'Phải ghi IP người thực hiện');
    });

    // ------------------------------------------------------------------
    // 3. Lọc
    // ------------------------------------------------------------------
    it('Lọc theo hành động (action)', async () => {
        const res = await getLogs(`?action=${encodeURIComponent(TEST_ACTION)}&limit=50`);
        assert.strictEqual(res.statusCode, 200, res.body);
        const body = res.json();
        assert.strictEqual(body.total, 3);
        assert.strictEqual(body.logs.length, 3);
        for (const log of body.logs) {
            assert.strictEqual(log.action, TEST_ACTION);
            assert.strictEqual(log.actorEmail, ADMIN_EMAIL);
            assert.strictEqual(log.ip, FORWARDED_IP);
        }
    });

    it('Lọc theo trạng thái (status)', async () => {
        const success = await getLogs(`?action=${encodeURIComponent(TEST_ACTION)}&status=success`);
        assert.strictEqual(success.json().total, 2);

        const failure = await getLogs(`?action=${encodeURIComponent(TEST_ACTION)}&status=failure`);
        assert.strictEqual(failure.json().total, 1);

        const warning = await getLogs(`?action=${encodeURIComponent(TEST_ACTION)}&status=warning`);
        assert.strictEqual(warning.json().total, 0);
    });

    it('Tìm kiếm toàn văn (search) khớp cả nội dung details', async () => {
        const hit = await getLogs(`?action=${encodeURIComponent(TEST_ACTION)}&search=${encodeURIComponent(TAG)}&limit=50`);
        assert.strictEqual(hit.json().total, 3, 'TAG nằm trong details của cả 3 bản ghi test');

        const miss = await getLogs(`?search=${encodeURIComponent(`khong-ton-tai-${RUN}`)}&limit=50`);
        assert.strictEqual(miss.json().total, 0);
    });

    it('Lọc theo khoảng thời gian (from/to)', async () => {
        const hourAgo = new Date(Date.now() - 3600_000).toISOString();
        const inAnHour = new Date(Date.now() + 3600_000).toISOString();

        const included = await getLogs(`?action=${encodeURIComponent(TEST_ACTION)}&from=${encodeURIComponent(hourAgo)}`);
        assert.strictEqual(included.json().total, 3);

        const future = await getLogs(`?action=${encodeURIComponent(TEST_ACTION)}&from=${encodeURIComponent(inAnHour)}`);
        assert.strictEqual(future.json().total, 0);

        const untilNow = await getLogs(`?action=${encodeURIComponent(TEST_ACTION)}&to=${encodeURIComponent(inAnHour)}`);
        assert.strictEqual(untilNow.json().total, 3);

        const past = await getLogs(`?action=${encodeURIComponent(TEST_ACTION)}&to=${encodeURIComponent(hourAgo)}`);
        assert.strictEqual(past.json().total, 0);
    });

    // ------------------------------------------------------------------
    // 4. Phân trang
    // ------------------------------------------------------------------
    it('Phân trang khi client gửi limit', async () => {
        const page1 = await getLogs(`?action=${encodeURIComponent(TEST_ACTION)}&limit=2&page=1`);
        const body1 = page1.json();
        assert.strictEqual(body1.total, 3, 'total phải là tổng số bản ghi khớp lọc, không phải số bản ghi của trang');
        assert.strictEqual(body1.logs.length, 2);
        assert.strictEqual(body1.limit, 2);
        assert.strictEqual(body1.page, 1);

        const page2 = await getLogs(`?action=${encodeURIComponent(TEST_ACTION)}&limit=2&page=2`);
        const body2 = page2.json();
        assert.strictEqual(body2.logs.length, 1);

        const ids1 = body1.logs.map((l: any) => l.id);
        const ids2 = body2.logs.map((l: any) => l.id);
        assert.strictEqual(ids1.filter((id: string) => ids2.includes(id)).length, 0, 'Hai trang không được trùng bản ghi');
    });

    it('Không truyền limit thì giữ hành vi cũ (không phân trang)', async () => {
        const res = await getLogs('');
        assert.strictEqual(res.statusCode, 200, res.body);
        const body = res.json();
        assert.ok(Array.isArray(body.logs));
        assert.ok(body.logs.length > 0, 'Vẫn phải trả về danh sách như trước');
        assert.ok(body.total >= body.logs.length);
    });

    // ------------------------------------------------------------------
    // 5. Kiểm tra hợp lệ tham số
    // ------------------------------------------------------------------
    it('Từ chối tham số không hợp lệ (400)', async () => {
        for (const qs of ['?status=khong-ton-tai', '?limit=0', '?limit=abc', '?limit=10&page=0', '?limit=10&page=xyz']) {
            const res = await getLogs(qs);
            assert.strictEqual(res.statusCode, 400, `${qs} phải bị từ chối`);
        }
    });

    // ------------------------------------------------------------------
    // 6. Xoá nhật ký an toàn
    // ------------------------------------------------------------------
    it('Xoá theo bộ lọc chỉ xoá bản ghi khớp và vẫn lưu vết người xoá', async () => {
        const res = await delLogs(`?action=${encodeURIComponent(TEST_ACTION)}`);
        assert.strictEqual(res.statusCode, 200, res.body);
        assert.strictEqual(res.json().success, true);

        // Các bản ghi test đã biến mất...
        const gone = await getLogs(`?action=${encodeURIComponent(TEST_ACTION)}&limit=50`);
        assert.strictEqual(gone.json().total, 0);

        // ...nhưng bản ghi "đã xoá nhật ký" phải tồn tại, kèm actor + IP.
        const marker = await getLogs(`?search=${encodeURIComponent(RUN)}&limit=50`);
        const cleared = marker.json().logs.find((l: any) => l.action === 'admin.logs_cleared');
        assert.ok(cleared, 'Phải còn dấu vết thao tác xoá nhật ký (không bị chính lệnh xoá cuốn mất)');
        assert.strictEqual(cleared.actorEmail, ADMIN_EMAIL);
        assert.strictEqual(cleared.ip, FORWARDED_IP);
        assert.strictEqual(cleared.status, 'warning');
    });

    it('Xoá toàn bộ (không lọc) vẫn ghi lại dấu vết người xoá', async () => {
        // Ở chế độ PostgreSQL, "xoá toàn bộ" sẽ xoá nhật ký của mọi test đang chạy song
        // song nên chỉ kiểm tra trong chế độ in-memory (chỉ ảnh hưởng tiến trình này).
        if (config.DATABASE_URL) return;

        auditLog.record({ action: `test.other.${RUN}`, status: 'success' });

        const res = await delLogs('');
        assert.strictEqual(res.statusCode, 200, res.body);

        const after = await getLogs('?limit=10');
        const body = after.json();
        assert.strictEqual(body.logs.length, 1, 'Chỉ còn lại đúng bản ghi "đã xoá nhật ký"');
        assert.strictEqual(body.logs[0].action, 'admin.logs_cleared');
        assert.strictEqual(body.logs[0].actorEmail, ADMIN_EMAIL);
    });
});
