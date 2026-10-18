import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/index.js';
import { createTestSession } from '../../src/auth/session.js';
import { getConfig } from '../../src/config.js';
import { db, initDatabase } from '../../src/database/index.js';
import { userStore } from '../../src/admin/userStore.js';
import { billingStorage } from '../../src/billing/storage.js';
import { helpdeskStore, getRefundPayload } from '../../src/helpdesk/store.js';
import type { OrderStatus } from '../../src/billing/types.js';

/**
 * Bộ test cho yêu cầu hoàn tiền của người dùng.
 *
 * Trọng tâm nghiệp vụ (chốt với chủ dự án):
 *  - Người dùng gửi yêu cầu từ widget Hỗ trợ với danh mục "refund": chọn giao dịch
 *    lỗi, nhập số tài khoản + ngân hàng (+ tuỳ chọn ảnh chụp) và lý do.
 *  - **Chỉ giao dịch lỗi / chưa được xử lý mới hoàn tiền được**: đơn đã thanh toán
 *    thành công (`paid`) bị chặn thẳng.
 *  - Một giao dịch chỉ có tối đa một yêu cầu đang chờ/đã duyệt.
 *  - Quản trị xử lý theo luồng chờ → duyệt → đã chuyển tiền (hoặc từ chối), mỗi
 *    bước đều ghi vào sổ `refunds` khi tiền đã chuyển, và danh sách trả kèm mã
 *    VietQR dựng từ số tài khoản + ngân hàng của khách để quét trả tiền lại.
 */

const ADMIN_ID = '00000000-0000-4000-a000-000000000001';
const USER_A_ID = '00000000-0000-4000-b000-0000000000a1';
const USER_B_ID = '00000000-0000-4000-b000-0000000000b1';

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
const TAG = `zref${RUN}`;

const config = getConfig();
const OWNER_IDS = [USER_A_ID, USER_B_ID];

const TEST_USERS = [
    [USER_A_ID, 'urefundb000000a1'],
    [USER_B_ID, 'urefundb000000b1'],
] as const;

/** Tạo nhanh một đơn hàng cho test với trạng thái mong muốn. */
async function seedOrder(
    userId: string,
    suffix: string,
    status: OrderStatus,
    amountVnd: number
): Promise<string> {
    const order = await billingStorage.createOrder({
        user_id: userId,
        plan_id: 'creator',
        amount_vnd: amountVnd,
        pay_code: `${TAG}${suffix}`.slice(0, 50),
        status,
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        claimed_at: status === 'claimed' ? new Date().toISOString() : null,
        paid_at: status === 'paid' ? new Date().toISOString() : null,
    });
    return order.id;
}

describe('Refund Requests (yêu cầu hoàn tiền) Test Suite', () => {
    let app: FastifyInstance;
    let adminToken: string;
    let tokenA: string;
    let tokenB: string;

    let orderPendingA = '';
    let orderClaimedA = '';
    let orderPaidA = '';
    let orderPendingB = '';
    let refundTicketId = '';
    let rejectTicketId = '';

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

    function refundPayload(orderId: string, extra: Record<string, unknown> = {}) {
        return {
            subject: `${TAG} Yêu cầu hoàn tiền giao dịch lỗi`,
            body: `${TAG} Tôi đã chuyển khoản nhưng đơn hàng không được xử lý, xin hoàn lại tiền.`,
            category: 'refund',
            attachments: [],
            refund: {
                orderId,
                bankCode: 'VCB',
                bankAccount: '0011002233445',
                accountHolder: 'Nguyen Van A',
                ...extra,
            },
        };
    }

    before(async () => {
        if (config.DATABASE_URL) {
            await initDatabase();
            for (const [id, username] of TEST_USERS) {
                await db.query(
                    `INSERT INTO users (id, username, email)
                     VALUES ($1, $2, $3)
                     ON CONFLICT (id) DO NOTHING`,
                    [id, username, `${username}@test.email`]
                );
            }
        }

        for (const [id, username] of TEST_USERS) {
            await userStore.upsertUser({ id, username, email: `${username}@test.email` });
        }

        app = await buildApp({ logger: false });
        await app.ready();

        adminToken = createTestSession(ADMIN_ID);
        tokenA = createTestSession(USER_A_ID);
        tokenB = createTestSession(USER_B_ID);

        orderPendingA = await seedOrder(USER_A_ID, 'PA', 'pending', 149000);
        orderClaimedA = await seedOrder(USER_A_ID, 'CA', 'claimed', 199000);
        orderPaidA = await seedOrder(USER_A_ID, 'DA', 'paid', 249000);
        orderPendingB = await seedOrder(USER_B_ID, 'PB', 'pending', 149000);
    });

    after(async () => {
        if (config.DATABASE_URL) {
            await db.query(`DELETE FROM tickets WHERE user_id = ANY($1::uuid[])`, [OWNER_IDS]);
            await db.query(`DELETE FROM refunds WHERE sepay_ref LIKE $1`, [`${TAG}%`]);
            await db.query(`DELETE FROM orders WHERE pay_code LIKE $1`, [`${TAG}%`]);
        }
        await app.close();
    });

    // ------------------------------------------------------------------
    // 1. Bảo mật
    // ------------------------------------------------------------------
    it('Khách chưa đăng nhập không xem được lịch sử thanh toán (401)', async () => {
        const res = await inject('GET', '/api/billing/orders');
        assert.strictEqual(res.statusCode, 401, res.body);
    });

    it('Người dùng thường không chạm được API hoàn tiền của quản trị (403)', async () => {
        const list = await userA('GET', '/api/admin/refund-requests');
        assert.strictEqual(list.statusCode, 403, list.body);

        const patch = await userA('PATCH', '/api/admin/refund-requests/whatever', { status: 'approved' });
        assert.strictEqual(patch.statusCode, 403, patch.body);
    });

    // ------------------------------------------------------------------
    // 2. Danh mục ngân hàng + lịch sử thanh toán
    // ------------------------------------------------------------------
    it('Trả danh mục ngân hàng hỗ trợ kèm mã BIN', async () => {
        const res = await inject('GET', '/api/billing/banks');
        assert.strictEqual(res.statusCode, 200, res.body);
        const banks = res.json().banks;
        assert.ok(Array.isArray(banks) && banks.length >= 10, 'Danh sách ngân hàng phải đủ dùng');
        const vcb = banks.find((b: any) => b.code === 'VCB');
        assert.ok(vcb, 'Phải có Vietcombank');
        assert.strictEqual(vcb.bin, '970436');
    });

    it('Lịch sử thanh toán chỉ trả đơn của chính mình và cờ refundable đúng quy tắc', async () => {
        const res = await userA('GET', '/api/billing/orders');
        assert.strictEqual(res.statusCode, 200, res.body);
        const orders = res.json().orders;
        const ids = orders.map((o: any) => o.id);

        assert.ok(ids.includes(orderPendingA), 'Phải thấy đơn của mình');
        assert.ok(!ids.includes(orderPendingB), 'Không được thấy đơn của người khác');

        const paid = orders.find((o: any) => o.id === orderPaidA);
        assert.strictEqual(paid.refundable, false, 'Đơn đã thanh toán thành công thì không thể hoàn tiền');
        assert.strictEqual(paid.planName, 'Gói Sáng Tạo');

        const pending = orders.find((o: any) => o.id === orderPendingA);
        assert.strictEqual(pending.refundable, true, 'Đơn lỗi/chưa xử lý thì được yêu cầu hoàn tiền');
    });

    // ------------------------------------------------------------------
    // 3. Validate khi người dùng tạo yêu cầu
    // ------------------------------------------------------------------
    it('Từ chối thiếu thông tin hoặc thông tin không hợp lệ', async () => {
        const cases: Array<[Record<string, unknown>, string]> = [
            [{ orderId: '' }, 'thiếu giao dịch'],
            [{ bankCode: 'KHONG-CO-NGAN-HANG-NAY' }, 'ngân hàng lạ'],
            [{ bankAccount: '12ab' }, 'số tài khoản sai định dạng'],
            [{ bankAccount: '123' }, 'số tài khoản quá ngắn'],
            [{ accountHolder: 'x'.repeat(101) }, 'tên chủ tài khoản quá dài'],
        ];
        for (const [override, label] of cases) {
            const res = await userA('POST', '/api/support/tickets', refundPayload(orderPendingA, override));
            assert.strictEqual(res.statusCode, 400, `${label}: ${res.body}`);
        }
    });

    it('Chặn yêu cầu hoàn tiền cho đơn đã thanh toán thành công và đã xử lý', async () => {
        const res = await userA('POST', '/api/support/tickets', refundPayload(orderPaidA));
        assert.strictEqual(res.statusCode, 400, res.body);
        assert.match(res.json().error, /đã thanh toán thành công/i);
    });

    it('Chặn yêu cầu hoàn tiền cho đơn của người khác', async () => {
        const res = await userA('POST', '/api/support/tickets', refundPayload(orderPendingB));
        assert.strictEqual(res.statusCode, 400, res.body);
        assert.match(res.json().error, /Không tìm thấy giao dịch của bạn/i);
    });

    // ------------------------------------------------------------------
    // 4. Gửi yêu cầu hợp lệ
    // ------------------------------------------------------------------
    it('Tạo được yêu cầu hoàn tiền: số tiền lấy từ đơn thật, ngân hàng chuẩn hoá', async () => {
        const res = await userA('POST', '/api/support/tickets', refundPayload(orderPendingA));
        assert.strictEqual(res.statusCode, 200, res.body);
        const ticket = res.json().ticket;
        refundTicketId = ticket.id;

        assert.strictEqual(ticket.category, 'refund');
        const refund = ticket.context?.refund;
        assert.ok(refund, 'Phải có payload hoàn tiền trong context');
        assert.strictEqual(refund.orderId, orderPendingA);
        assert.strictEqual(refund.amountVnd, 149000, 'Số tiền lấy từ đơn hàng, không tin client');
        assert.strictEqual(refund.payCode, `${TAG}PA`);
        assert.strictEqual(refund.planName, 'Gói Sáng Tạo');
        assert.strictEqual(refund.bankCode, 'VCB');
        assert.strictEqual(refund.bankName, 'Vietcombank');
        assert.strictEqual(refund.bankAccount, '0011002233445');
        assert.strictEqual(refund.accountHolder, 'NGUYEN VAN A', 'Tên chủ tài khoản viết hoa');
        assert.strictEqual(refund.status, 'pending');
        assert.match(refund.reason, /chuyển khoản/i, 'Lý do lấy từ nội dung người dùng nhập');
    });

    it('Người dùng không gửi trùng cho cùng một giao dịch đang chờ', async () => {
        const res = await userA('POST', '/api/support/tickets', refundPayload(orderPendingA));
        assert.strictEqual(res.statusCode, 400, res.body);
        assert.match(res.json().error, /đang chờ xử lý/i);
    });

    it('Lịch sử thanh toán hiển thị trạng thái yêu cầu hoàn tiền của đơn', async () => {
        const res = await userA('GET', '/api/billing/orders');
        const order = res.json().orders.find((o: any) => o.id === orderPendingA);
        assert.strictEqual(order.refundStatus, 'pending');
        assert.strictEqual(order.refundable, false, 'Đang chờ xử lý thì không gửi thêm được');
    });

    // ------------------------------------------------------------------
    // 5. Quản trị xử lý
    // ------------------------------------------------------------------
    it('Danh sách quản trị trả yêu cầu kèm mã VietQR để quét trả tiền', async () => {
        const res = await admin('GET', `/api/admin/refund-requests?search=${encodeURIComponent(TAG)}`);
        assert.strictEqual(res.statusCode, 200, res.body);
        const body = res.json();
        assert.strictEqual(body.total, 1);
        assert.strictEqual(body.stats.pending, 1);

        const item = body.requests[0];
        assert.strictEqual(item.code, (await helpdeskStore.findById(refundTicketId))!.code);
        assert.strictEqual(item.refund.amountVnd, 149000);
        assert.ok(item.qr, 'Phải dựng được QR trả tiền');
        assert.strictEqual(item.qr.bankCode, 'VCB');
        assert.strictEqual(item.qr.bankAccount, '0011002233445');
        assert.strictEqual(item.qr.amountVnd, 149000);
        assert.match(item.qr.memo, /HOAN TIEN LIME-T-/);
        assert.match(item.qr.image, /^https:\/\/qr\.sepay\.vn\/img\?/);
        assert.match(item.qr.content, /^00020101/, 'QR phải là chuỗi EMVCo hợp lệ');
    });

    it('Không thể nhảy cóc sang "đã hoàn tiền" khi chưa duyệt', async () => {
        const res = await admin('PATCH', `/api/admin/refund-requests/${refundTicketId}`, { status: 'refunded' });
        assert.strictEqual(res.statusCode, 409, res.body);
    });

    it('Từ chối phải kèm lý do; duyệt rồi thì ghi được sổ hoàn tiền', async () => {
        const noNote = await admin('PATCH', `/api/admin/refund-requests/${refundTicketId}`, { status: 'rejected' });
        assert.strictEqual(noNote.statusCode, 400, noNote.body);

        const approve = await admin('PATCH', `/api/admin/refund-requests/${refundTicketId}`, {
            status: 'approved',
            note: 'Đã đối chiếu sao kê, đủ điều kiện hoàn.',
        });
        assert.strictEqual(approve.statusCode, 200, approve.body);
        assert.strictEqual(approve.json().refund.status, 'approved');
        assert.ok(approve.json().refund.reviewedBy, 'Phải ghi nhận người duyệt');
        // Duyệt thì chưa ghi sổ, chưa có mã bút toán.
        assert.strictEqual(approve.json().refund.refundId, null);

        const again = await admin('PATCH', `/api/admin/refund-requests/${refundTicketId}`, { status: 'approved' });
        assert.strictEqual(again.statusCode, 409, again.body);
    });

    it('Chuyển tiền xong: ghi sổ refunds, đóng đơn và báo cho người dùng', async () => {
        const res = await admin('PATCH', `/api/admin/refund-requests/${refundTicketId}`, {
            status: 'refunded',
            note: 'Chuyển khoản lúc 10:15',
        });
        assert.strictEqual(res.statusCode, 200, res.body);
        const refund = res.json().refund;
        assert.strictEqual(refund.status, 'refunded');
        assert.ok(refund.refundId, 'Phải có mã bút toán trong sổ refunds');
        assert.ok(refund.refundedAt);

        // Sổ hoàn tiền có bản ghi nguồn 'refund_request'.
        const ledger = await admin('GET', `/api/admin/refunds?sourceType=refund_request&search=${encodeURIComponent(TAG)}`);
        assert.strictEqual(ledger.statusCode, 200, ledger.body);
        assert.strictEqual(ledger.json().total, 1);
        const entry = ledger.json().refunds[0];
        assert.strictEqual(entry.id, refund.refundId);
        assert.strictEqual(entry.source_id, refundTicketId);
        assert.strictEqual(entry.amount_vnd, 149000);
        assert.strictEqual(entry.bank_account, '0011002233445');
        assert.strictEqual(entry.bank_name, 'Vietcombank');
        assert.ok(entry.refunded_by, 'Phải ghi nhận người chuyển tiền hoàn');

        // Đơn chưa xử lý bị đóng để giao dịch về muộn không kích hoạt gói nữa.
        const order = await billingStorage.findOrderById(orderPendingA);
        assert.strictEqual(order?.status, 'cancelled');

        // Người dùng thấy thông báo trong hội thoại và ticket khép lại.
        const detail = await userA('GET', `/api/support/tickets/${refundTicketId}`);
        assert.strictEqual(detail.statusCode, 200, detail.body);
        const messages = detail.json().ticket.messages;
        const last = messages[messages.length - 1];
        assert.strictEqual(last.senderType, 'admin');
        assert.match(last.body, /Đã hoàn 149\.000 ₫/);
        assert.match(last.body, /Vietcombank/);
        assert.ok(!last.body.includes('0011002233445'), 'Không lộ đủ số tài khoản trong hội thoại');
        assert.strictEqual(detail.json().ticket.status, 'resolved');
    });

    it('Đã hoàn tiền rồi thì không nhận yêu cầu mới cho cùng giao dịch', async () => {
        const res = await userA('POST', '/api/support/tickets', refundPayload(orderPendingA));
        assert.strictEqual(res.statusCode, 400, res.body);
        assert.match(res.json().error, /đã được hoàn tiền trước đó/i);
    });

    it('Từ chối yêu cầu và lưu lại lý do', async () => {
        const created = await userA('POST', '/api/support/tickets', refundPayload(orderClaimedA));
        assert.strictEqual(created.statusCode, 200, created.body);
        rejectTicketId = created.json().ticket.id;

        const res = await admin('PATCH', `/api/admin/refund-requests/${rejectTicketId}`, {
            status: 'rejected',
            note: 'Sao kê không có giao dịch tương ứng.',
        });
        assert.strictEqual(res.statusCode, 200, res.body);
        assert.strictEqual(res.json().refund.status, 'rejected');
        assert.strictEqual(res.json().refund.adminNote, 'Sao kê không có giao dịch tương ứng.');

        const after = await helpdeskStore.findById(rejectTicketId);
        const payload = getRefundPayload(after!);
        assert.strictEqual(payload?.status, 'rejected');

        // Bị từ chối thì người dùng gửi lại được (có thêm bằng chứng mới).
        const retry = await userA('POST', '/api/support/tickets', refundPayload(orderClaimedA));
        assert.strictEqual(retry.statusCode, 200, retry.body);
    });

    it('Lọc danh sách quản trị theo trạng thái', async () => {
        const pending = await admin('GET', `/api/admin/refund-requests?status=pending&search=${encodeURIComponent(TAG)}`);
        assert.strictEqual(pending.statusCode, 200, pending.body);
        for (const item of pending.json().requests) {
            assert.strictEqual(item.refund.status, 'pending');
        }

        const refunded = await admin('GET', `/api/admin/refund-requests?status=refunded&search=${encodeURIComponent(TAG)}`);
        assert.strictEqual(refunded.json().total, 1);
        assert.strictEqual(refunded.json().requests[0].ticketId, refundTicketId);

        const bad = await admin('GET', '/api/admin/refund-requests?status=khong-co');
        assert.strictEqual(bad.statusCode, 400);
    });

    it('Nhận diện trạng thái không hợp lệ và thiếu dữ liệu hoàn tiền', async () => {
        const notRefund = await admin('PATCH', `/api/admin/refund-requests/${rejectTicketId}`, { status: 'pending' });
        assert.strictEqual(notRefund.statusCode, 400, notRefund.body);

        const badId = await admin('PATCH', '/api/admin/refund-requests/khong-ton-tai', { status: 'approved' });
        assert.strictEqual(badId.statusCode, 404, badId.body);

        const badStatus = await admin('PATCH', `/api/admin/refund-requests/${rejectTicketId}`, { status: 'xyz' });
        assert.strictEqual(badStatus.statusCode, 400, badStatus.body);
    });
});
