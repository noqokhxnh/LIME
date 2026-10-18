import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/index.js';
import { createTestSession } from '../../src/auth/session.js';
import { getConfig } from '../../src/config.js';
import { initDatabase } from '../../src/database/index.js';
import { db } from '../../src/database/index.js';
import {
    helpdeskStore,
    TICKET_CREATE_LIMIT_PER_HOUR,
} from '../../src/helpdesk/store.js';

/**
 * Bộ test Helpdesk / Ticketing phía người dùng.
 *
 * Trọng tâm:
 *  - Widget "Hỗ trợ" yêu cầu đăng nhập (401 cho khách), người dùng thường
 *    không được chạm vào API quản trị (403).
 *  - Một người dùng chỉ thấy / trả lời được ticket của chính mình (404 với
 *    ticket của người khác, không lộ sự tồn tại).
 *  - Validate đầu vào khi tạo ticket (tiêu đề, danh mục, mức ưu tiên, ảnh
 *    đính kèm) và chống spam (giới hạn số ticket mỗi giờ).
 *  - Upload ảnh đính kèm phải qua bộ kiểm tra bảo mật (magic bytes…).
 *  - Chu trình ticket: tạo → admin phản hồi → đóng; ticket đóng thì chặn
 *    tiếp diễn hội thoại (409).
 */

const ADMIN_ID = '00000000-0000-4000-a000-000000000001';
const USER_A_ID = '00000000-0000-4000-b000-000000000020';
const USER_B_ID = '00000000-0000-4000-b000-000000000021';
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
const TAG = `zqtk${RUN}`;

const config = getConfig();
const OWNER_IDS = [USER_A_ID, USER_B_ID];

describe('Helpdesk Ticketing (user side) Test Suite', () => {
    let app: FastifyInstance;
    let adminToken: string;
    let tokenA: string;
    let tokenB: string;
    const createdTicketIds: string[] = [];

    function inject(method: string, url: string, token?: string, payload?: unknown) {
        return app.inject({
            method: method as any,
            url,
            payload: payload as any,
            cookies: token ? { vidtml_session: token } : {},
        });
    }

    const admin = (m: string, u: string, p?: unknown) => inject(m, u, adminToken, p);
    const userA = (m: string, u: string, p?: unknown) => inject(m, u, tokenA, p);
    const userB = (m: string, u: string, p?: unknown) => inject(m, u, tokenB, p);

    async function createTicket(payload: Record<string, unknown> = {}) {
        const res = await userA('POST', '/api/support/tickets', {
            subject: `${TAG} Lỗi hệ thống cần hỗ trợ`,
            body: `${TAG} Trình dựng bị treo khi render cảnh 3, vui lòng kiểm tra.`,
            category: 'bug',
            ...payload,
        });
        assert.strictEqual(res.statusCode, 200, res.body);
        const ticket = res.json().ticket;
        createdTicketIds.push(ticket.id);
        return ticket;
    }

    before(async () => {
        if (config.DATABASE_URL) {
            await initDatabase();
            // Đảm bảo dòng users tồn tại cho ràng buộc khoá ngoại tickets.user_id
            for (const [id, username] of [
                [USER_A_ID, 'useticketb0000a'],
                [USER_B_ID, 'useticketb0000b'],
            ] as const) {
                await db.query(
                    `INSERT INTO users (id, username, email)
                     VALUES ($1, $2, $3)
                     ON CONFLICT (id) DO NOTHING`,
                    [id, username, `${username}@test.email`]
                );
            }
        }

        app = await buildApp({ logger: false });
        await app.ready();

        adminToken = createTestSession(ADMIN_ID);
        tokenA = createTestSession(USER_A_ID);
        tokenB = createTestSession(USER_B_ID);
    });

    after(async () => {
        if (config.DATABASE_URL) {
            await db.query(`DELETE FROM tickets WHERE user_id = ANY($1::uuid[])`, [OWNER_IDS]);
        }
        await app.close();
    });

    // ------------------------------------------------------------------
    // 1. Bảo mật & phân quyền
    // ------------------------------------------------------------------
    it('Chặn 401 khi khách chưa đăng nhập dùng các API hỗ trợ', async () => {
        const cases = [
            { method: 'GET' as const, url: '/api/support/tickets' },
            { method: 'POST' as const, url: '/api/support/tickets', payload: { subject: 'abcde', body: 'abcdefgh' } },
            { method: 'POST' as const, url: '/api/support/tickets' },
        ];
        for (const c of cases) {
            const res = await inject(c.method, c.url, undefined, c.payload);
            assert.strictEqual(res.statusCode, 401, `Khách gọi ${c.method} ${c.url} phải 401`);
        }
    });

    it('Chặn 403 khi người dùng thường gọi các API quản trị ticket', async () => {
        const cases = [
            { method: 'GET' as const, url: '/api/admin/tickets' },
            { method: 'GET' as const, url: '/api/admin/tickets/stats' },
            { method: 'GET' as const, url: '/api/admin/tickets/some-id' },
            { method: 'POST' as const, url: '/api/admin/tickets/some-id/messages', payload: { body: 'hi' } },
            { method: 'PATCH' as const, url: '/api/admin/tickets/some-id', payload: { status: 'open' } },
        ];
        for (const c of cases) {
            const res = await userA(c.method, c.url, c.payload);
            assert.strictEqual(res.statusCode, 403, `${c.method} ${c.url} phải trả 403`);
        }
    });

    // ------------------------------------------------------------------
    // 2. Validate đầu vào khi tạo ticket
    // ------------------------------------------------------------------
    it('Tạo ticket thành công: có mã LIME-T-*, trạng thái mở và tin nhắn đầu tiên của user', async () => {
        const ticket = await createTicket();
        assert.ok(/^LIME-T-[A-Z2-9]{6}$/.test(ticket.code), 'Mã ticket sai định dạng: ' + ticket.code);
        assert.strictEqual(ticket.status, 'open');
        assert.strictEqual(ticket.category, 'bug');
        assert.strictEqual(ticket.userEmail, 'useticketb0000a@test.email');
        assert.strictEqual(ticket.messages.length, 1);
        assert.strictEqual(ticket.messages[0].senderType, 'user');
    });

    it('Chặn tạo ticket với dữ liệu không hợp lệ', async () => {
        const badPayloads = [
            { subject: 'ngắn' }, // tiêu đề < 5
            { body: 'ngắn' }, // nội dung < 5
            { category: 'danh-muc-lad' }, // danh mục lạ
            { priority: 'gap-gap-cap' }, // ưu tiên lạ
            { attachments: [ '../../../etc/passwd' ] }, // đính kèm không đúng URL đã upload
        ];
        for (const bad of badPayloads) {
            const res = await userA('POST', '/api/support/tickets', {
                subject: `${TAG} Tiêu đề chuẩn 5+ ký tự`,
                body: `${TAG} Nội dung chuẩn chuẩn chuẩn.`,
                category: 'bug',
                ...bad,
            });
            assert.strictEqual(res.statusCode, 400, 'Phải 400 với payload: ' + JSON.stringify(bad));
        }
    });

    // ------------------------------------------------------------------
    // 3. Sở hữu & riêng tư hội thoại
    // ------------------------------------------------------------------
    it('User B không thấy ticket của user A (404), list chỉ chứa ticket của chính mình', async () => {
        const mine = await createTicket();
        const res = await userB('GET', `/api/support/tickets/${mine.id}`);
        assert.strictEqual(res.statusCode, 404, 'Ticket của người khác phải trả 404');

        const listB = await userB('GET', '/api/support/tickets?limit=50');
        assert.strictEqual(listB.statusCode, 200);
        const itemIds = (listB.json().items || []).map((t: any) => t.id);
        assert.ok(!itemIds.includes(mine.id), 'Danh sách của user B không được chứa ticket của user A');
    });

    it('Ghi chú nội bộ (isInternal) của admin không lộ cho user', async () => {
        const ticket = await createTicket({ subject: `${TAG} Sự cố về hành vi người dùng`, category: 'account' });

        // Admin đánh dấu ghi chú nội bộ
        const noteRes = await admin('POST', `/api/admin/tickets/${ticket.id}/messages`, {
            body: `${TAG} Người dùng này đã vi phạm chính sách.`,
            isInternal: true,
        });
        assert.strictEqual(noteRes.statusCode, 200, noteRes.body);

        // Người dùng xem hội thoại: không được chứa ghi chú nội bộ
        const res = await userA('GET', `/api/support/tickets/${ticket.id}`);
        assert.strictEqual(res.statusCode, 200);
        const messages = res.json().ticket.messages || [];
        const hasInternal = messages.some((m: any) => m.isInternal);
        assert.strictEqual(hasInternal, false, 'Ghi chú nội bộ không được xuất hiện cho người dùng');
        assert.ok(
            !messages.some((m: any) => (m.body || '').includes('vi phạm chính sách')),
            'Nội dung ghi chú nội bộ không được lộ cho người dùng'
        );
    });

    // ------------------------------------------------------------------
    // 4. Chuẩn hoá hội thoại & chuyển trạng thái
    // ------------------------------------------------------------------
    it('Admin phản hồi → trạng thái in_progress; user trả lời khi waiting_user → trở lại open', async () => {
        const ticket = await createTicket();

        const noteRes = await admin('POST', `/api/admin/tickets/${ticket.id}/messages`, {
            body: `${TAG} Cảm ơn bạn, chúng tôi đang kiểm tra.`,
        });
        assert.strictEqual(noteRes.statusCode, 200, noteRes.body);
        assert.strictEqual(noteRes.json().ticket.status, 'in_progress', 'Admin phản hồi → in_progress');

        const patched = await admin('PATCH', `/api/admin/tickets/${ticket.id}`, { status: 'waiting_user' });
        assert.strictEqual(patched.statusCode, 200, patched.body);
        assert.strictEqual(patched.json().ticket.status, 'waiting_user');

        const reply = await userA('POST', `/api/support/tickets/${ticket.id}/messages`, {
            body: `${TAG} Mình đã thử lại và vẫn lỗi đó.`,
        });
        assert.strictEqual(reply.statusCode, 200, reply.body);
        assert.strictEqual(reply.json().ticket.status, 'open', 'User trả lời khi waiting_user → open');
    });

    it('User đóng ticket được (closed), sau đó chặn việc trả lời tiếp (409)', async () => {
        const ticket = await createTicket({ subject: `${TAG} Lỗi thanh toán cần xử lý` });

        const close = await userA('POST', `/api/support/tickets/${ticket.id}/close`);
        assert.strictEqual(close.statusCode, 200, close.body);
        assert.strictEqual(close.json().ticket.status, 'closed');

        const reply = await userA('POST', `/api/support/tickets/${ticket.id}/messages`, {
            body: `${TAG} Trả lời sau khi đóng ticket.`,
        });
        assert.strictEqual(reply.statusCode, 409, 'Ticket đã đóng phải chặn phản hồi tiếp (409)');

        // Admin cũng không được phản hồi ticket đã đóng
        const adminReply = await admin('POST', `/api/admin/tickets/${ticket.id}/messages`, {
            body: `${TAG} Phản hồi sau khi đóng vai trò test.`,
        });
        assert.strictEqual(adminReply.statusCode, 409);
    });

    // ------------------------------------------------------------------
    // 5. Upload ảnh đính kèm
    // ------------------------------------------------------------------
    it('Upload ảnh PNG hợp lệ → trả URL /uploads/tickets/ ; file giả mạo → 400', async () => {
        const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

        const boundary = '----limeTestBoundary123';
        const buildMultipart = (data: Buffer, mime: string) =>
            Buffer.concat([
                Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="shot.dat"\r\nContent-Type: ${mime}\r\n\r\n`),
                data,
                Buffer.from(`\r\n--${boundary}--\r\n`),
            ]);

        const ok = await app.inject({
            method: 'POST',
            url: '/api/support/attachments',
            payload: buildMultipart(png, 'image/png'),
            headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
            cookies: { vidtml_session: tokenA },
        });
        assert.strictEqual(ok.statusCode, 200, ok.body);
        assert.ok(/^\/uploads\/tickets\/[a-f0-9-]+\.png$/.test(ok.json().url), 'URL đính kèm sai: ' + ok.json().url);

        // File text giả danh PNG (magic bytes sai) → bị từ chối
        const fake = Buffer.from('</html>khong phai anh</html>');
        const bad = await app.inject({
            method: 'POST',
            url: '/api/support/attachments',
            payload: buildMultipart(fake, 'image/png'),
            headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
            cookies: { vidtml_session: tokenA },
        });
        assert.strictEqual(bad.statusCode, 400, 'File không đúng magic bytes phải bị từ chối');
    });

    it('Tạo ticket kèm ảnh đính kèm hợp lệ', async () => {
        // URL theo định dạng an toàn (file thật sự có thể chưa tải lên ở bước này);
        // server chỉ validate dạng đường dẫn, file vật lý ảnh đã bước upload riêng.
        const shot = `/uploads/tickets/${'b'.repeat(8)}-4444-4444-4444-aaaaaabbbbbb.png`;
        const res = await userB('POST', '/api/support/tickets', {
            subject: `${TAG} Ticket kèm ảnh chụp màn hình lỗi`,
            body: `${TAG} Màn hình trắng khi bấm nút dựng, ảnh ở phần đính kèm.`,
            category: 'render',
            attachments: [{ url: shot, name: 'screenshot.png' }],
        });
        assert.strictEqual(res.statusCode, 200, res.body);
        assert.strictEqual(res.json().ticket.messages[0].attachments[0].url, shot);
    });

    it('Sai định dạng URL đính kèm khi phản hồi hội thoại → 400', async () => {
        // Tạo trực tiếp bằng store: đã skip hạn mức API của user A (test chống spam ở cuối)
        const ticket = await helpdeskStore.createTicket({
            userId: USER_A_ID,
            userEmail: 'useticketb0000a@test.email',
            subject: `${TAG} Ticket đính kèm sai đường dẫn`,
            category: 'bug',
            body: `${TAG} Nội dung hội thoại đính kèm sai quy cách.`,
        });
        createdTicketIds.push(ticket.id);
        const res = await userA('POST', `/api/support/tickets/${ticket.id}/messages`, {
            body: `${TAG} Phản hồi kèm ảnh sai đường dẫn.`,
            attachments: ['/uploads/logos/x.png'],
        });
        assert.strictEqual(res.statusCode, 400, 'Ảnh đính kèm phải là tệp đã upload qua /api/support/attachments.');
    });

    // ------------------------------------------------------------------
    // 6. User thấy danh sách + phân trang cơ bản
    // ------------------------------------------------------------------
    it('Danh sách phân trang đúng cấu trúc', async () => {
        const res = await userA('GET', '/api/support/tickets?page=1&limit=5');
        assert.strictEqual(res.statusCode, 200, res.body);
        const data = res.json();
        assert.ok(Array.isArray(data.items));
        assert.ok(data.limit === 5);
        assert.ok(data.items.length <= 5);
        for (const t of data.items) {
            assert.strictEqual(t.userEmail, 'useticketb0000a@test.email', 'Chỉ gồm ticket của user A');
        }
    });

    // ------------------------------------------------------------------
    // 7. Chống spam (để cuối suite để không chiếm hạn mức 1 giờ, ảnh hưởng test khác)
    // ------------------------------------------------------------------
    it('Chống spam: chặn 429 khi user tạo vượt số ticket cho phép trong 1 giờ', async () => {
        // (Số ticket sẵn có của user A không cố định giữa các test → tạo lặp cho tới khi bị chặn.)
        let blocked = false;
        for (let i = 0; i < TICKET_CREATE_LIMIT_PER_HOUR + 2; i++) {
            const res = await userA('POST', '/api/support/tickets', {
                subject: `${TAG} Ticket gần chạm giới hạn số ${i}`,
                body: `${TAG} Nội dung của ticket gần ngưỡng số ${i}.`,
                category: 'other',
            });
            if (res.statusCode === 200) {
                createdTicketIds.push(res.json().ticket.id);
            } else {
                blocked = true;
                assert.strictEqual(res.statusCode, 429, 'Vượt hạn mức phải trả 429');
                break;
            }
        }
        assert.ok(blocked, 'Cuối cùng phải bị chặn khi vượt giới hạn tạo mới trong 1 giờ.');
    });
});
