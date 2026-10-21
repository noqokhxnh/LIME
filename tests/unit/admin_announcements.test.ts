import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { type FastifyInstance } from 'fastify';
import { buildApp } from '../../src/index.js';
import { createTestSession } from '../../src/auth/session.js';
import { getConfig } from '../../src/config.js';
import { initDatabase } from '../../src/database/index.js';
import { systemSettings } from '../../src/admin/systemSettings.js';
import { announcementsStore } from '../../src/admin/announcements.js';

/**
 * Bộ test cho "System Broadcast Banner" (thông báo toàn hệ thống).
 *
 * Trọng tâm:
 *  - API công khai `GET /api/announcements` phải hoạt động cả với khách chưa đăng
 *    nhập và vẫn trả về được khi hệ thống đang bật chế độ bảo trì (allowlist).
 *  - Chỉ thông báo ĐANG hiệu lực mới tới người dùng: loại bỏ bản đã tắt, đã hết hạn,
 *    chưa tới giờ chạy, và sai đối tượng (users/guests).
 *  - CRUD của quản trị được bảo vệ và kiểm tra dữ liệu đầu vào.
 */

const ADMIN_ID = '00000000-0000-4000-a000-000000000001';
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
const TAG = `zqann${RUN}`;

const config = getConfig();

describe('System Broadcast Banner Test Suite', () => {
    let app: FastifyInstance;
    let adminToken: string;
    const createdIds: string[] = [];
    let originalMaintenanceMode = false;

    const admin = (method: string, url: string, payload?: unknown) =>
        app.inject({
            method: method as any,
            url,
            payload: payload as any,
            cookies: { vidtml_session: adminToken },
        });

    async function createAnnouncement(overrides: Record<string, unknown> = {}) {
        const res = await admin('POST', '/api/admin/announcements', {
            title: `${TAG} thông báo`,
            body: `${TAG} nội dung`,
            kind: 'info',
            ...overrides,
        });
        assert.strictEqual(res.statusCode, 200, res.body);
        const announcement = res.json().announcement;
        createdIds.push(announcement.id);
        return announcement;
    }

    before(async () => {
        if (config.DATABASE_URL) {
            await initDatabase();
        }
        originalMaintenanceMode = systemSettings.get().maintenanceMode;
        app = await buildApp({ logger: false });
        await app.ready();
        adminToken = createTestSession(ADMIN_ID);
    });

    after(async () => {
        for (const id of createdIds) {
            try {
                await announcementsStore.remove(id);
            } catch {
                /* ignore cleanup errors */
            }
        }
        systemSettings.update({ maintenanceMode: originalMaintenanceMode });
        await app.close();
    });

    // ------------------------------------------------------------------
    // 1. Phân quyền
    // ------------------------------------------------------------------
    it('Chặn người dùng thường (403) ở các API quản trị thông báo', async () => {
        const userToken = createTestSession('00000000-0000-4000-a000-0000000000ff');
        const cases = [
            { method: 'GET' as const, url: '/api/admin/announcements' },
            { method: 'POST' as const, url: '/api/admin/announcements', payload: { title: 'x', body: 'y' } },
            { method: 'PATCH' as const, url: '/api/admin/announcements/some-id', payload: { title: 'x' } },
            { method: 'POST' as const, url: '/api/admin/announcements/some-id/toggle' },
            { method: 'DELETE' as const, url: '/api/admin/announcements/some-id' },
        ];
        for (const c of cases) {
            const res = await app.inject({ ...c, cookies: { vidtml_session: userToken } });
            assert.strictEqual(res.statusCode, 403, `${c.method} ${c.url} phải trả 403`);
        }
    });

    it('API công khai trả về danh sách thông báo (200) cho khách chưa đăng nhập', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/announcements' });
        assert.strictEqual(res.statusCode, 200, res.body);
        const data = res.json();
        assert.ok(Array.isArray(data.announcements), 'Phải có mảng announcements');
        assert.strictEqual(data.viewer, 'guest');
    });

    // ------------------------------------------------------------------
    // 2. Kiểm tra dữ liệu đầu vào
    // ------------------------------------------------------------------
    it('Từ chối dữ liệu không hợp lệ khi tạo thông báo', async () => {
        const missingTitle = await admin('POST', '/api/admin/announcements', { body: 'nội dung' });
        assert.strictEqual(missingTitle.statusCode, 400);

        const badKind = await admin('POST', '/api/admin/announcements', { title: 'a', body: 'b', kind: 'unknown' });
        assert.strictEqual(badKind.statusCode, 400);

        const badRange = await admin('POST', '/api/admin/announcements', {
            title: 'a',
            body: 'b',
            startsAt: '2030-01-02T00:00:00.000Z',
            endsAt: '2030-01-01T00:00:00.000Z',
        });
        assert.strictEqual(badRange.statusCode, 400, 'Kết thúc trước bắt đầu phải bị từ chối');

        const badLink = await admin('POST', '/api/admin/announcements', {
            title: 'a',
            body: 'b',
            linkUrl: 'javascript:alert(1)',
        });
        assert.strictEqual(badLink.statusCode, 400, 'Liên kết ngoài http(s)/đường dẫn nội bộ phải bị từ chối');
    });

    // ------------------------------------------------------------------
    // 3. Lọc thông báo đang hiệu lực
    // ------------------------------------------------------------------
    it('Chỉ hiển thị thông báo đang hiệu lực cho khách, đúng đối tượng, đúng lịch', async () => {
        const active = await createAnnouncement({ title: `${TAG} ACTIVE`, audience: 'all' });
        const usersOnly = await createAnnouncement({ title: `${TAG} USERS`, audience: 'users' });
        const inactive = await createAnnouncement({ title: `${TAG} OFF`, isActive: false });
        const expired = await createAnnouncement({ title: `${TAG} EXPIRED`, endsAt: new Date(Date.now() - 60_000).toISOString() });
        const scheduled = await createAnnouncement({ title: `${TAG} SCHEDULED`, startsAt: new Date(Date.now() + 3_600_000).toISOString() });

        const guestRes = await app.inject({ method: 'GET', url: '/api/announcements' });
        const guestIds = guestRes.json().announcements.map((a: any) => a.id);
        assert.ok(guestIds.includes(active.id), 'Thông báo đang hiệu lực phải hiển thị cho khách');
        assert.ok(!guestIds.includes(usersOnly.id), 'Thông báo chỉ dành cho người dùng đã đăng nhập không được hiển thị cho khách');
        assert.ok(!guestIds.includes(inactive.id), 'Thông báo đã tắt không được hiển thị');
        assert.ok(!guestIds.includes(expired.id), 'Thông báo đã hết hạn không được hiển thị');
        assert.ok(!guestIds.includes(scheduled.id), 'Thông báo chưa tới giờ chạy không được hiển thị');

        const userRes = await app.inject({
            method: 'GET',
            url: '/api/announcements',
            cookies: { vidtml_session: adminToken },
        });
        const userData = userRes.json();
        assert.strictEqual(userData.viewer, 'user');
        const userIds = userData.announcements.map((a: any) => a.id);
        assert.ok(userIds.includes(active.id));
        assert.ok(userIds.includes(usersOnly.id), 'Người dùng đã đăng nhập phải thấy thông báo audience=users');
    });

    it('Ẩn thông báo sau khi tắt và hiện lại sau khi bật', async () => {
        const item = await createAnnouncement({ title: `${TAG} TOGGLE`, audience: 'all' });

        const off = await admin('POST', `/api/admin/announcements/${item.id}/toggle`);
        assert.strictEqual(off.statusCode, 200, off.body);
        assert.strictEqual(off.json().announcement.isActive, false);

        let listIds = (await app.inject({ method: 'GET', url: '/api/announcements' })).json().announcements.map((a: any) => a.id);
        assert.ok(!listIds.includes(item.id), 'Sau khi tắt, thông báo không còn hiển thị');

        const on = await admin('POST', `/api/admin/announcements/${item.id}/toggle`);
        assert.strictEqual(on.json().announcement.isActive, true);

        listIds = (await app.inject({ method: 'GET', url: '/api/announcements' })).json().announcements.map((a: any) => a.id);
        assert.ok(listIds.includes(item.id), 'Sau khi bật lại, thông báo hiển thị trở lại');
    });

    // ------------------------------------------------------------------
    // 4. Cập nhật & xoá
    // ------------------------------------------------------------------
    it('Cập nhật nội dung thông báo và trả về 404 cho id không tồn tại', async () => {
        const item = await createAnnouncement({ title: `${TAG} EDIT`, audience: 'all' });

        const updated = await admin('PATCH', `/api/admin/announcements/${item.id}`, { title: `${TAG} EDITED` });
        assert.strictEqual(updated.statusCode, 200, updated.body);
        assert.strictEqual(updated.json().announcement.title, `${TAG} EDITED`);

        const missing = await admin('PATCH', '/api/admin/announcements/does-not-exist', { title: 'x' });
        assert.strictEqual(missing.statusCode, 404);

        const emptyPatch = await admin('PATCH', `/api/admin/announcements/${item.id}`, {});
        assert.strictEqual(emptyPatch.statusCode, 400, 'PATCH rỗng phải bị từ chối');
    });

    it('Xoá thông báo, xoá lại trả về 404', async () => {
        const item = await createAnnouncement({ title: `${TAG} DELETE`, audience: 'all' });

        const del = await admin('DELETE', `/api/admin/announcements/${item.id}`);
        assert.strictEqual(del.statusCode, 200, del.body);

        const again = await admin('DELETE', `/api/admin/announcements/${item.id}`);
        assert.strictEqual(again.statusCode, 404);

        const listIds = (await app.inject({ method: 'GET', url: '/api/announcements' })).json().announcements.map((a: any) => a.id);
        assert.ok(!listIds.includes(item.id), 'Thông báo đã xoá không còn trong danh sách công khai');
    });

    // ------------------------------------------------------------------
    // 5. Danh sách quản trị + thống kê
    // ------------------------------------------------------------------
    it('Danh sách quản trị hỗ trợ lọc theo trạng thái và trả về thống kê', async () => {
        await createAnnouncement({ title: `${TAG} LIST`, audience: 'all' });

        const res = await admin('GET', `/api/admin/announcements?status=all&search=${encodeURIComponent(TAG)}&limit=50`);
        assert.strictEqual(res.statusCode, 200, res.body);
        const data = res.json();
        assert.ok(Array.isArray(data.items));
        assert.ok(data.items.every((a: any) => a.title.includes(TAG) || (a.body || '').includes(TAG)));
        assert.ok(data.stats && typeof data.stats.total === 'number');

        const badStatus = await admin('GET', '/api/admin/announcements?status=khong-hop-le');
        assert.strictEqual(badStatus.statusCode, 400);
    });

    // ------------------------------------------------------------------
    // 6. Bảo trì không chặn API thông báo
    // ------------------------------------------------------------------
    it('Vẫn trả về thông báo khi hệ thống đang bật chế độ bảo trì', async () => {
        const item = await createAnnouncement({ title: `${TAG} MAINT`, kind: 'maintenance', audience: 'all' });

        systemSettings.update({ maintenanceMode: true });
        try {
            const res = await app.inject({ method: 'GET', url: '/api/announcements' });
            assert.strictEqual(res.statusCode, 200, 'API thông báo phải nằm trong allowlist khi bảo trì');
            assert.strictEqual(res.json().maintenanceMode, true);
            const ids = res.json().announcements.map((a: any) => a.id);
            assert.ok(ids.includes(item.id));
        } finally {
            systemSettings.update({ maintenanceMode: originalMaintenanceMode });
        }
    });
});
