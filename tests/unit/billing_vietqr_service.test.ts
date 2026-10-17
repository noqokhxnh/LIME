/**
 * Test trực tiếp `VietQrBillingService` cho các nhánh mà test qua HTTP
 * (`tests/integration/billing_vietqr.test.ts`) không chạm tới: lỗi gói cước, phân quyền khi
 * xem/claim đơn, các nhánh thoát sớm của webhook, và đường dự phòng khi sinh mã thanh toán.
 *
 * Chạy được ở CẢ HAI chế độ: in-memory (mặc định, dùng ở job PR) và PostgreSQL thật — mọi
 * chỗ cần ép hành vi đều dùng `mock.method` thay vì sửa dữ liệu dùng chung.
 */
import test, { describe, it, before, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { vietQrBillingService } from '../../src/billing/vietqrService.js';
import { billingStorage } from '../../src/billing/storage.js';
import { initDatabase, db } from '../../src/database/index.js';
import { getConfig } from '../../src/config.js';
import type { Order, Plan } from '../../src/billing/types.js';

const USER_A = 'a1000000-0000-4000-8000-000000000001';
const USER_B = 'a1000000-0000-4000-8000-000000000002';

/** Khoá giao dịch SePay duy nhất mỗi lần chạy ⇒ không đụng dữ liệu của lần chạy trước. */
function uniqueRef(prefix = 'SEPAY'): string {
    return `${prefix}-${randomUUID()}`;
}

/** Mã 6 ký tự đúng định dạng nhưng gần như chắc chắn không trùng đơn nào đang có. */
function randomCodeSuffix(): string {
    return randomUUID().replace(/[^A-Z0-9]/gi, '').slice(0, 6).toUpperCase();
}

function fakePlan(overrides: Partial<Plan> = {}): Plan {
    return {
        id: 'pro',
        name: 'Gói Pro',
        price_vnd: 249000,
        quota_video: 150,
        days: 30,
        is_active: true,
        ...overrides,
    };
}

describe('VietQrBillingService — các nhánh nghiệp vụ', () => {
    before(async () => {
        const config = getConfig();
        if (config.DATABASE_URL) {
            await initDatabase();
            // Đơn hàng có khoá ngoại tới users ⇒ phải có người dùng trước.
            await db.query(
                `INSERT INTO users (id, username, email)
                 VALUES ($1, 'vqr_service_a', 'vqr_service_a@lime.test')
                 ON CONFLICT (id) DO NOTHING`,
                [USER_A],
            );
            await db.query(
                `INSERT INTO users (id, username, email)
                 VALUES ($1, 'vqr_service_b', 'vqr_service_b@lime.test')
                 ON CONFLICT (id) DO NOTHING`,
                [USER_B],
            );
        }
        if (billingStorage.resetForTesting) {
            await billingStorage.resetForTesting();
        }
    });

    afterEach(() => {
        mock.restoreAll();
    });

    describe('generateUniquePayCode', () => {
        it('sinh mã viết hoa tiền tố, đúng 6 ký tự và loại bỏ ký tự dễ nhầm (0, 1, I, O)', async () => {
            const code = await vietQrBillingService.generateUniquePayCode('lime');
            assert.match(code, /^LIME[2-9A-HJ-NP-Z]{6}$/);
        });

        it('thử lại khi mã đầu tiên đã tồn tại', async () => {
            const seen: string[] = [];
            mock.method(billingStorage, 'findOrderByPayCode', async (code: string) => {
                seen.push(code);
                // Lần đầu coi như trùng, lần sau trống ⇒ phải đổi mã khác.
                return seen.length === 1 ? ({ id: 'collision' } as Order) : null;
            });

            const code = await vietQrBillingService.generateUniquePayCode('LIME');

            assert.equal(seen.length, 2, 'phải thử lại đúng một lần');
            assert.equal(code, seen[1], 'mã trả về phải là mã của lần thử thứ hai');
            assert.notEqual(code, seen[0]);
        });

        it('sau 10 lần va chạm thì dùng mã dự phòng theo thời gian', async () => {
            const seen: string[] = [];
            mock.method(billingStorage, 'findOrderByPayCode', async (code: string) => {
                seen.push(code);
                return { id: 'collision' } as Order; // luôn trùng
            });

            const code = await vietQrBillingService.generateUniquePayCode('LIME');

            assert.equal(seen.length, 10, 'chỉ thử tối đa 10 lần rồi mới dự phòng');
            assert.equal(code.length, 'LIME'.length + 6);
            assert.ok(code.startsWith('LIME'));
            assert.ok(!seen.includes(code), 'mã dự phòng không được trùng mã đã thử');
        });
    });

    describe('createOrder', () => {
        it('gói cước không tồn tại ⇒ PLAN_NOT_FOUND', async () => {
            mock.method(billingStorage, 'getPlanById', async () => null);
            await assert.rejects(
                () => vietQrBillingService.createOrder(USER_A, 'khong-ton-tai'),
                /PLAN_NOT_FOUND/,
            );
        });

        it('gói cước đã tắt ⇒ PLAN_INACTIVE', async () => {
            mock.method(billingStorage, 'getPlanById', async () => fakePlan({ is_active: false }));
            await assert.rejects(
                () => vietQrBillingService.createOrder(USER_A, 'pro'),
                /PLAN_INACTIVE/,
            );
        });
    });

    describe('getOrderStatus', () => {
        it('đơn không tồn tại ⇒ ORDER_NOT_FOUND', async () => {
            await assert.rejects(
                () => vietQrBillingService.getOrderStatus(randomUUID(), USER_A),
                /ORDER_NOT_FOUND/,
            );
        });

        it('người khác xem đơn ⇒ FORBIDDEN, nhưng admin thì được', async () => {
            const order = await vietQrBillingService.createOrder(USER_A, 'creator');

            await assert.rejects(
                () => vietQrBillingService.getOrderStatus(order.order_id, USER_B),
                /FORBIDDEN/,
            );

            const asAdmin = await vietQrBillingService.getOrderStatus(order.order_id, USER_B, true);
            assert.equal(asAdmin.status, 'pending');
            assert.equal(asAdmin.amount_vnd, 149000);
            assert.equal(asAdmin.pay_code, order.pay_code);
        });

        it('trả về hạn gói cước của người dùng sau khi thanh toán', async () => {
            const order = await vietQrBillingService.createOrder(USER_A, 'creator');
            await vietQrBillingService.processWebhook({
                id: uniqueRef(),
                transfer_type: 'in',
                transfer_amount: 149000,
                content: `THANH TOAN ${order.pay_code}`,
            });

            const status = await vietQrBillingService.getOrderStatus(order.order_id, USER_A);

            assert.equal(status.status, 'paid');
            assert.ok(status.paid_at);
            assert.ok(status.plan_expires_at, 'hạn gói cước phải được trả về sau khi thanh toán');
        });
    });

    describe('claimOrder', () => {
        it('đơn không tồn tại ⇒ ORDER_NOT_FOUND', async () => {
            await assert.rejects(
                () => vietQrBillingService.claimOrder(randomUUID(), USER_A),
                /ORDER_NOT_FOUND/,
            );
        });

        it('người khác claim đơn ⇒ FORBIDDEN', async () => {
            const order = await vietQrBillingService.createOrder(USER_A, 'creator');
            await assert.rejects(
                () => vietQrBillingService.claimOrder(order.order_id, USER_B),
                /FORBIDDEN/,
            );
        });

        it('claim lần hai trả về nguyên hạn cũ (không gia hạn thêm)', async () => {
            const order = await vietQrBillingService.createOrder(USER_A, 'creator');

            const first = await vietQrBillingService.claimOrder(order.order_id, USER_A);
            const second = await vietQrBillingService.claimOrder(order.order_id, USER_A);

            assert.equal(second.success, true);
            assert.equal(second.status, 'claimed');
            assert.equal(second.expires_at, first.expires_at, 'không được gia hạn lần thứ hai');
        });

        it('đơn đã thanh toán ⇒ không cho claim', async () => {
            const order = await vietQrBillingService.createOrder(USER_A, 'creator');
            await vietQrBillingService.processWebhook({
                id: uniqueRef(),
                transfer_type: 'in',
                transfer_amount: 149000,
                content: `THANH TOAN ${order.pay_code}`,
            });

            await assert.rejects(
                () => vietQrBillingService.claimOrder(order.order_id, USER_A),
                /CANNOT_CLAIM_STATUS_PAID/,
            );
        });

        it('cập nhật thất bại ⇒ ORDER_UPDATE_FAILED', async () => {
            const order = await vietQrBillingService.createOrder(USER_A, 'creator');
            mock.method(billingStorage, 'updateOrderClaimed', async () => null);

            await assert.rejects(
                () => vietQrBillingService.claimOrder(order.order_id, USER_A),
                /ORDER_UPDATE_FAILED/,
            );
        });

        it('gia hạn thêm đúng số phút cấu hình', async () => {
            const config = getConfig();
            const ttl = config.ORDER_TTL_MINUTES || 15;
            const extend = config.CLAIMED_EXTEND_MINUTES || 30;

            const order = await vietQrBillingService.createOrder(USER_A, 'creator');
            const claimed = await vietQrBillingService.claimOrder(order.order_id, USER_A);

            const addedMinutes =
                (new Date(claimed.expires_at).getTime() - new Date(order.expires_at).getTime()) / 60000;
            assert.ok(
                Math.abs(addedMinutes - (extend - ttl)) < 1,
                `hạn mới phải xa hơn hạn cũ ${extend - ttl} phút, nhận được ${addedMinutes.toFixed(2)}`,
            );
        });
    });

    describe('extractPayCode', () => {
        it('chuẩn hoá mã trong trường code (khoảng trắng, gạch, chữ thường)', () => {
            assert.equal(
                vietQrBillingService.extractPayCode({ code: 'lime-8x2k9q' }, 'LIME'),
                'LIME8X2K9Q',
            );
            assert.equal(
                vietQrBillingService.extractPayCode({ code: ' LIME 8X2K9Q ' }, 'LIME'),
                'LIME8X2K9Q',
            );
        });

        it('bỏ qua trường code sai tiền tố hoặc quá ngắn rồi tìm trong nội dung', () => {
            assert.equal(
                vietQrBillingService.extractPayCode(
                    { code: 'WRONG9X2K9Q', content: 'CK LIME7Y3M4N giup em' },
                    'LIME',
                ),
                'LIME7Y3M4N',
            );
            assert.equal(
                vietQrBillingService.extractPayCode({ code: 'LIME8X2', content: 'LIME9Z8Y7X' }, 'LIME'),
                'LIME9Z8Y7X',
            );
        });

        it('bỏ dấu tiếng Việt và xử lý tiền tố dính liền (đường dự phòng rộng)', () => {
            assert.equal(
                vietQrBillingService.extractPayCode(
                    { content: 'CHUYỂN TIỀN ĐẾN LIME-4B5C6D CẢM ƠN' },
                    'LIME',
                ),
                'LIME4B5C6D',
            );
            // Không có ký tự phân cách trước tiền tố ⇒ phải dùng đường dự phòng rộng.
            assert.equal(
                vietQrBillingService.extractPayCode({ content: 'ABCKLIME8X2K9QXYZ' }, 'LIME'),
                'LIME8X2K9Q',
            );
        });

        it('không có mã nào ⇒ null', () => {
            assert.equal(vietQrBillingService.extractPayCode({ content: 'CHUYEN TIEN CA PHE' }, 'LIME'), null);
            assert.equal(vietQrBillingService.extractPayCode({}, 'LIME'), null);
        });
    });

    describe('processWebhook — các nhánh thoát sớm và lỗi', () => {
        it('giao dịch tiền ra ⇒ bỏ qua', async () => {
            const res = await vietQrBillingService.processWebhook({
                id: uniqueRef(),
                transfer_type: 'out',
                transfer_amount: 149000,
                content: 'LIME8X2K9Q',
            });
            assert.equal(res.success, true);
            assert.equal(res.result, 'ignored_transfer_out');
        });

        it('thiếu cả id lẫn referenceCode ⇒ MISSING_TRANSACTION_ID', async () => {
            const res = await vietQrBillingService.processWebhook({
                transfer_type: 'in',
                transfer_amount: 149000,
                content: 'LIME8X2K9Q',
            });
            assert.equal(res.success, false);
            assert.equal(res.reason, 'MISSING_TRANSACTION_ID');
        });

        it('id rỗng thì dùng referenceCode làm khoá chống trùng', async () => {
            const order = await vietQrBillingService.createOrder(USER_A, 'creator');
            const ref = uniqueRef('BANKREF');

            const first = await vietQrBillingService.processWebhook({
                id: '',
                referenceCode: ref,
                transfer_type: 'in',
                transfer_amount: 149000,
                content: `THANH TOAN ${order.pay_code}`,
            });
            assert.equal(first.result, 'matched');
            assert.ok(await billingStorage.findPaymentBySepayRef(ref));

            const replay = await vietQrBillingService.processWebhook({
                id: '',
                referenceCode: ref,
                transfer_type: 'in',
                transfer_amount: 149000,
                content: `THANH TOAN ${order.pay_code}`,
            });
            assert.equal(replay.result, 'idempotent_duplicate_ref');
        });

        it('trùng khoá với giao dịch chưa khớp đơn ⇒ idempotent_duplicate_unmatched_ref', async () => {
            const ref = uniqueRef('DUP');

            const first = await vietQrBillingService.processWebhook({
                id: ref,
                transfer_type: 'in',
                transfer_amount: 50000,
                content: 'CHUYEN KHOAN KHONG CO MA',
            });
            assert.equal(first.result, 'unmatched_no_code');

            const second = await vietQrBillingService.processWebhook({
                id: ref,
                transfer_type: 'in',
                transfer_amount: 50000,
                content: 'CHUYEN KHOAN KHONG CO MA',
            });
            assert.equal(second.result, 'idempotent_duplicate_unmatched_ref');
        });

        it('mã hợp lệ nhưng không có đơn nào ⇒ ghi vào sổ chưa khớp', async () => {
            const code = `LIME${randomCodeSuffix()}`;
            const ref = uniqueRef('NOORDER');

            const res = await vietQrBillingService.processWebhook({
                id: ref,
                transfer_type: 'in',
                transfer_amount: 149000,
                content: `CHUYEN TIEN ${code}`,
            });

            assert.equal(res.result, 'unmatched_order_not_found');
            const unmatched = await billingStorage.findUnmatchedPaymentBySepayRef(ref);
            assert.ok(unmatched);
            assert.ok(unmatched.admin_note?.includes(code), 'ghi chú phải nêu mã không tìm thấy đơn');
        });

        it('đơn đã huỷ ⇒ ghi vào sổ chưa khớp', async () => {
            const order = await vietQrBillingService.createOrder(USER_A, 'creator');
            await billingStorage.cancelOrder(order.order_id);
            const ref = uniqueRef('CANCELLED');

            const res = await vietQrBillingService.processWebhook({
                id: ref,
                transfer_type: 'in',
                transfer_amount: 149000,
                content: `THANH TOAN ${order.pay_code}`,
            });

            assert.equal(res.result, 'unmatched_order_cancelled');
            assert.ok(await billingStorage.findUnmatchedPaymentBySepayRef(ref));
        });

        it('tranh chấp khi khoá đơn (ALREADY_PAID) ⇒ ghi nhận giao dịch trùng', async () => {
            const order = await vietQrBillingService.createOrder(USER_A, 'creator');
            const ref = uniqueRef('RACE');
            mock.method(billingStorage, 'lockAndFulfillOrder', async () => ({
                success: false,
                reason: 'ALREADY_PAID',
            }));

            const res = await vietQrBillingService.processWebhook({
                id: ref,
                transfer_type: 'in',
                transfer_amount: 149000,
                content: `THANH TOAN ${order.pay_code}`,
            });

            assert.equal(res.success, true);
            assert.equal(res.result, 'duplicate_concurrent');
            const duplicate = await billingStorage.findPaymentBySepayRef(ref);
            assert.ok(duplicate);
            assert.equal(duplicate.result, 'duplicate');
        });

        it('khoá đơn thất bại vì lý do khác ⇒ ném lỗi để hàng đợi thử lại', async () => {
            const order = await vietQrBillingService.createOrder(USER_A, 'creator');
            mock.method(billingStorage, 'lockAndFulfillOrder', async () => ({
                success: false,
                reason: 'DB_DOWN',
            }));

            await assert.rejects(
                () =>
                    vietQrBillingService.processWebhook({
                        id: uniqueRef('FAIL'),
                        transfer_type: 'in',
                        transfer_amount: 149000,
                        content: `THANH TOAN ${order.pay_code}`,
                    }),
                /FULFILL_FAILED_DB_DOWN/,
            );
        });
    });
});
