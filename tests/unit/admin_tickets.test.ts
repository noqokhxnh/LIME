import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/index.js';
import { createTestSession } from '../../src/auth/session.js';
import { getConfig } from '../../src/config.js';
import { initDatabase } from '../../src/database/index.js';
import { db } from '../../src/database/index.js';
import { helpdeskStore } from '../../src/helpdesk/store.js';

/**
 * Bộ test Helpdesk / Ticketing phía quản trị.
 *
 * Trọng tâm:
 *  - Các API quản trị ticket (list / stats / chi tiết / phản hồi / cập nhật)
 *    phải yêu cầu quyền admin (403 với user, 401 cho khách).
 *  - Validate tham số lọc khi xem danh sách và validate patch trạng thái/ưu tiên.
 *  - Luồng trải nghiệm của admin: xem chi tiết hội thoại, phản hồi (kể cả ghi
 *    chú nội bộ), nâng mức ưu tiên — dữ liệu đọc được khớp với dữ liệu ghi.
 */

const ADMIN_ID = '00000000-0000-4000-a000-000000000001';
const USER_A_ID = '00000000-0000-4000-b000-000000000020';
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
const TAG = `zqatk${RUN}`;

const config = getConfig();

describe('Helpdesk Ticketing (admin side) Test Suite', () => {
    let app: FastifyInstance;
    let adminToken: string;
    const createdTicketIds: string[] = [];

    const admin = (method: string, url: string, payload?: unknown) =>
        app.inject({
            method: method as any,
            url,
            payload: payload as any,
            cookies: { vidtml_session: adminToken },
        });

    before(async () => {
        if (config.DATABASE_URL) {
            await initDatabase();
            await db.query(
                `INSERT INTO users (id, username, email)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (id) DO NOTHING`,
                [USER_A_ID, 'useticketb0000a', 'useticketb0000a@test.email']
            );
        }

        app = await buildApp({ logger: false });
        await app.ready();
        adminToken = createTestSession(ADMIN_ID);
    });

    after(async () => {
        if (config.DATABASE_URL) {
            await db.query(`DELETE FROM tickets WHERE user_id = ANY($1::uuid[])`, [[USER_A_ID]]);
        }
        await app.close();
    });

    it('Chặn 403 với khách chưa đăng nhập khi gọi các API quản trị ticket', async () => {
        const cases = [
            { method: 'GET' as const, url: '/api/admin/tickets' },
            { method: 'GET' as const, url: '/api/admin/tickets/stats' },
            { method: 'GET' as const, url: '/api/admin/tickets/some-id' },
            { method: 'POST' as const, url: '/api/admin/tickets/some-id/messages', payload: { body: 'hi' } },
            { method: 'PATCH' as const, url: '/api/admin/tickets/some-id', payload: { status: 'open' } },
        ];
        for (const c of cases) {
            const res = await app.inject({ ...c });
            assert.strictEqual(res.statusCode, 403, `${c.method} ${c.url} phải trả 403 cho khách`);
        }
    });

    it('Xem danh sách + thống kê: cấu trúc đúng và stats thực đi từ dữ liệu', async () => {
        const ticket = await helpdeskStore.createTicket({
            userId: USER_A_ID,
            userEmail: 'useticketb0000a@test.email',
            subject: `${TAG} Dựng video không hoàn tất ở khung 12`,
            category: 'render',
            body: `${TAG} Tiến trình dừng ở 92% rồi timeout.`,
        });
        createdTicketIds.push(ticket.id);

        const list = await admin('GET', '/api/admin/tickets?page=1&limit=25');
        assert.strictEqual(list.statusCode, 200, list.body);
        const data = list.json();
        assert.ok(Array.isArray(data.items), 'items phải là mảng');
        assert.ok(data.stats, 'Phải có thống kê');
        assert.ok(data.items.some((t: any) => t.id === ticket.id), 'Ticket mới được tạo phải xuất hiện trong danh sách admin');

        const stats = await admin('GET', '/api/admin/tickets/stats');
        assert.strictEqual(stats.statusCode, 200);
        assert.ok(stats.json().stats.total >= 1);
    });

    it('Lọc danh sách theo trạng thái hoạt động', async () => {
        const closed = await helpdeskStore.createTicket({
            userId: USER_A_ID,
            subject: `${TAG} Đã đóng ngay khi tạo`,
            category: 'other',
            body: `${TAG} Ticket này hạ đóng lui để test lọc.`,
        });
        await helpdeskStore.updateTicket(closed.id, { status: 'closed' });

        // Số lượng sẵn có của user A là cố định giữa các test → lọc theo trạng thái.
        const list = await admin('GET', '/api/admin/tickets?status=closed&limit=100');
        assert.strictEqual(list.statusCode, 200);
        const items = (list.json().items || []) as any[];
        assert.ok(items.length >= 1, 'Phải có ít nhất 1 ticket đã đóng');
        for (const t of items) {
            assert.strictEqual(t.status, 'closed', 'Mọi kết quả lọc status=closed phải là closed');
        }
    });

    it('Chặn 400 khi lọc sai trạng thái / danh mục / mức ưu tiên', async () => {
        for (const [key, value] of [
            ['status', 'dang-lam'],
            ['category', 'lad'],
            ['priority', 'gap-gap'],
        ] as const) {
            const res = await admin('GET', `/api/admin/tickets?${key}=${value}`);
            assert.strictEqual(res.statusCode, 400, `Lọc ${key}=${value} phải trả 400`);
        }
    });

    it('Chi tiết ticket trả về đầy đủ hội thoại (kể cả ghi chú nội bộ)', async () => {
        const ticket = await helpdeskStore.createTicket({
            userId: USER_A_ID,
            userEmail: 'useticketb0000a@test.email',
            subject: `${TAG} Sự cố tải khoản hết tín dụng`,
            category: 'billing',
            body: `${TAG} Tín dụng không cộng tự động khi thử mua gói.`,
        });
        createdTicketIds.push(ticket.id);

        await helpdeskStore.addMessage(ticket.id, {
            senderType: 'admin',
            senderEmail: 'admin@lime.test',
            body: `${TAG} Ghi chú nội bộ: kiểm tra giao dịch trên cổng ngân hàng.`,
            isInternal: true,
        });

        const res = await admin('GET', `/api/admin/tickets/${ticket.id}`);
        assert.strictEqual(res.statusCode, 200, res.body);
        const detail = res.json().ticket;
        assert.ok(detail.messages.some((m: any) => m.isInternal), 'Admin phải xem được ghi chú nội bộ');
        assert.strictEqual(detail.category, 'billing');
    });

    it('404 khi chi tiết ticket không tồn tại', async () => {
        const res = await admin('GET', '/api/admin/tickets/00000000-0000-4000-b000-0000000000ff');
        assert.strictEqual(res.statusCode, 404);
    });

    it('Phản hồi från admin cập nhật lastAdminReplyAt và trạng thái từ open → in_progress', async () => {
        const ticket = await helpdeskStore.createTicket({
            userId: USER_A_ID,
            subject: `${TAG} Ticket để test phản hồi admin`,
            category: 'bug',
            body: `${TAG} Nhấn nút không thấy phản hồi nào.`,
        });
        createdTicketIds.push(ticket.id);

        const reply = await admin('POST', `/api/admin/tickets/${ticket.id}/messages`, {
            body: `${TAG} Cảm ơn đã báo, đội ngũ đang xử lý.`,
        });
        assert.strictEqual(reply.statusCode, 200, reply.body);
        const updated = reply.json().ticket;
        assert.strictEqual(updated.status, 'in_progress');
        assert.ok(updated.lastAdminReplyAt, 'Phải có cột lastAdminReplyAt');

        // Ghi chú nội bộ cũng hợp lệ
        const note = await admin('POST', `/api/admin/tickets/${ticket.id}/messages`, {
            body: `${TAG} Ghi chú không gửi cho người dùng.`,
            isInternal: true,
        });
        assert.strictEqual(note.statusCode, 200);
        assert.strictEqual(note.json().ticket.status, 'in_progress', 'Ghi chú nội bộ không đổi trạng thái');
    });

    it('PATCH cập nhật trạng thái + mức ưu tiên; chặn giá trị lạ', async () => {
        const ticket = await helpdeskStore.createTicket({
            userId: USER_A_ID,
            subject: `${TAG} Ticket để test cập nhật trạng thái`,
            category: 'account',
            body: `${TAG} Cần đổi mật khẩu nhưng không nhận được email.`,
        });
        createdTicketIds.push(ticket.id);

        const patch = await admin('PATCH', `/api/admin/tickets/${ticket.id}`, {
            status: 'waiting_user',
            priority: 'urgent',
        });
        assert.strictEqual(patch.statusCode, 200, patch.body);
        assert.strictEqual(patch.json().ticket.status, 'waiting_user');
        assert.strictEqual(patch.json().ticket.priority, 'urgent');

        for (const bad of [{ status: 'dang-lam' }, { priority: 'cap-cap' }, {}]) {
            const res = await admin('PATCH', `/api/admin/tickets/${ticket.id}`, bad);
            assert.strictEqual(res.statusCode, 400, 'PATCH phải định dạng: ' + JSON.stringify(bad));
        }

        const res = await admin('PATCH', '/api/admin/tickets/00000000-0000-4000-b000-0000000000ff', {
            status: 'open',
        });
        assert.strictEqual(res.statusCode, 404, 'PATCH ticket không tồn tại phải trả 404');
    });
});
