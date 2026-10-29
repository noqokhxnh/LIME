import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '../database/index.js';
import { getConfig } from '../config.js';
import { normalizeCycle } from './pricing.js';
import type {
    Plan,
    Order,
    Payment,
    UnmatchedPayment,
    PaymentResult,
    UnmatchedPaymentStatus,
    Refund,
    RefundSourceType,
    AdminOrderQuery,
    AdminOrderPage,
    AdminUnmatchedQuery,
    AdminUnmatchedPage,
    AdminDuplicateQuery,
    AdminDuplicatePage,
    AdminRefundQuery,
    AdminRefundPage,
} from './types.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(id: string): boolean {
    return typeof id === 'string' && UUID_REGEX.test(id);
}

export const DEFAULT_PLANS: Plan[] = [
    {
        id: 'creator',
        name: 'Gói Sáng Tạo',
        price_vnd: 149000,
        quota_video: 50,
        days: 30,
        is_active: true,
    },
    {
        id: 'pro',
        name: 'Gói Pro',
        price_vnd: 99000,
        quota_video: 150,
        days: 30,
        is_active: true,
    },
    {
        id: 'max',
        name: 'Gói Max',
        price_vnd: 499000,
        quota_video: 500,
        days: 30,
        is_active: true,
    },
];

const ADMIN_ORDERS_MAX_LIMIT = 100;
const ADMIN_ORDERS_DEFAULT_LIMIT = 25;

/**
 * Danh sách unmatched/duplicate trước đây luôn bị cắt ở 100 dòng (`LIMIT 100`) nên
 * admin không xem được các giao dịch cũ hơn và không thể phân trang. Mặc định vẫn là
 * 100 để giữ nguyên hành vi cũ khi client không gửi `limit`.
 */
const ADMIN_PAYMENTS_DEFAULT_LIMIT = 100;
const ADMIN_PAYMENTS_MAX_LIMIT = 200;

/** Chuẩn hoá tham số phân trang cho danh sách đơn hàng của admin. */
function normalizeAdminPaging(filters: { page?: number; limit?: number }): {
    page: number;
    limit: number;
    offset: number;
} {
    return normalizeListPaging(filters, ADMIN_ORDERS_DEFAULT_LIMIT, ADMIN_ORDERS_MAX_LIMIT);
}

/**
 * Chuẩn hoá tham số phân trang dùng chung.
 *
 * Không truyền `limit` ⇒ dùng `defaultLimit` (giữ hành vi cũ của endpoint).
 */
function normalizeListPaging(
    filters: { page?: number; limit?: number },
    defaultLimit: number,
    maxLimit: number
): { page: number; limit: number; offset: number } {
    const rawLimit = Number(filters.limit);
    const limit =
        Number.isFinite(rawLimit) && rawLimit > 0
            ? Math.min(Math.floor(rawLimit), maxLimit)
            : defaultLimit;
    const rawPage = Number(filters.page);
    const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;
    return { page, limit, offset: (page - 1) * limit };
}

export interface IBillingStorage {
    getPlans(): Promise<Plan[]>;
    getPlanById(id: string): Promise<Plan | null>;
    createOrder(order: Omit<Order, 'id' | 'created_at'>): Promise<Order>;
    findOrderById(id: string): Promise<Order | null>;
    findOrderByPayCode(payCode: string): Promise<Order | null>;
    findPendingOrderByUserId(userId: string): Promise<Order | null>;
    cancelActiveOrdersForUser(userId: string): Promise<void>;
    updateOrderClaimed(orderId: string, claimedAt: string, expiresAt: string): Promise<Order | null>;
    expireStaleOrders(nowIso?: string): Promise<number>;
    findPaymentBySepayRef(sepayRef: string): Promise<Payment | null>;
    findUnmatchedPaymentBySepayRef(sepayRef: string): Promise<UnmatchedPayment | null>;
    /** Khớp NGHIÊM NGẶT chỉ theo cột sepay_ref (= payload.id của SePay) — dùng cho kiểm tra trùng lặp idempotency. Finder cũ còn OR-match raw referenceCode dùng chung namespace với id nên có thể nhận nhầm giao dịch khác là "đã xử lý". */
    findPaymentBySepayId(sepayId: string): Promise<Payment | null>;
    findUnmatchedPaymentBySepayId(sepayId: string): Promise<UnmatchedPayment | null>;
    recordUnmatchedPayment(item: Omit<UnmatchedPayment, 'id' | 'created_at'>): Promise<UnmatchedPayment>;
    lockAndFulfillOrder(params: {
        orderId: string;
        sepayRef: string;
        receivedAmount: number;
        raw: any;
        planDays: number;
        quotaVideo: number;
        planId: string;
        result: PaymentResult;
    }): Promise<{ success: boolean; order?: Order; payment?: Payment; reason?: string }>;
    recordDuplicatePayment(params: {
        orderId: string;
        sepayRef: string;
        amount: number;
        raw: any;
    }): Promise<Payment>;
    recordUnderpaidPayment(params: {
        orderId: string;
        sepayRef: string;
        amount: number;
        raw: any;
    }): Promise<Payment>;
    getUserPlanExpiry(userId: string): Promise<string | null>;
    findPaymentById(id: string): Promise<Payment | null>;
    /** Giao dịch ngân hàng gắn với một đơn hàng (nếu có) — dùng khi đối soát hoàn tiền. */
    findPaymentByOrderId(orderId: string): Promise<Payment | null>;
    findUnmatchedPaymentById(id: string): Promise<UnmatchedPayment | null>;
    listDuplicatePayments(): Promise<Payment[]>;
    getUnmatchedPayments(status?: string): Promise<UnmatchedPayment[]>;
    /** Danh sách giao dịch trùng lặp có lọc + phân trang (cổng quản trị). */
    listDuplicatePaymentsForAdmin(filters?: AdminDuplicateQuery): Promise<AdminDuplicatePage>;
    /** Danh sách giao dịch chưa khớp có lọc + phân trang (cổng quản trị). */
    listUnmatchedPaymentsForAdmin(filters?: AdminUnmatchedQuery): Promise<AdminUnmatchedPage>;
    /** Lịch sử hoàn tiền thủ công có lọc + phân trang (cổng quản trị). */
    listRefundsForAdmin(filters?: AdminRefundQuery): Promise<AdminRefundPage>;
    /** Tra nhiều đơn hàng trong MỘT truy vấn (tránh N+1 khi làm giàu dữ liệu). */
    findOrdersByIds(ids: string[]): Promise<Map<string, Order>>;
    findRefundBySource(sourceType: RefundSourceType, sourceId: string): Promise<Refund | null>;
    getRefundedSourceIds(sourceType: RefundSourceType, sourceIds: string[]): Promise<Set<string>>;
    recordRefund(item: Omit<Refund, 'id' | 'created_at' | 'refunded_at'>): Promise<Refund>;
    listRefunds(): Promise<Refund[]>;
    cancelOrder(orderId: string): Promise<Order | null>;
    resolveUnmatchedPayment(
        id: string,
        status: UnmatchedPaymentStatus,
        adminNote?: string,
        resolvedBy?: string
    ): Promise<UnmatchedPayment | null>;
    listOrders(filters?: { status?: string; userId?: string }): Promise<Order[]>;
    /** Danh sách đơn hàng cho cổng quản trị: có tìm kiếm + phân trang phía server. */
    listOrdersForAdmin(filters?: AdminOrderQuery): Promise<AdminOrderPage>;
    resetForTesting?(): Promise<void>;
}

export class PostgresBillingStorage implements IBillingStorage {
    async getPlans(): Promise<Plan[]> {
        const res = await db.query('SELECT * FROM plans WHERE is_active = true ORDER BY price_vnd ASC');
        if (res.rows.length === 0) {
            return DEFAULT_PLANS;
        }
        return res.rows.map(r => ({
            id: r.id,
            name: r.name,
            price_vnd: r.price_vnd,
            quota_video: r.quota_video,
            days: r.days,
            is_active: r.is_active,
            created_at: r.created_at ? new Date(r.created_at).toISOString() : undefined,
        }));
    }

    async getPlanById(id: string): Promise<Plan | null> {
        const res = await db.query('SELECT * FROM plans WHERE id = $1 LIMIT 1', [id]);
        if (res.rows.length === 0) {
            const found = DEFAULT_PLANS.find(p => p.id === id);
            return found || null;
        }
        const r = res.rows[0];
        return {
            id: r.id,
            name: r.name,
            price_vnd: r.price_vnd,
            quota_video: r.quota_video,
            days: r.days,
            is_active: r.is_active,
            created_at: r.created_at ? new Date(r.created_at).toISOString() : undefined,
        };
    }

    async createOrder(order: Omit<Order, 'id' | 'created_at'>): Promise<Order> {
        const id = randomUUID();
        const res = await db.query(
            `INSERT INTO orders (id, user_id, plan_id, cycle, amount_vnd, pay_code, status, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING *`,
            [id, order.user_id, order.plan_id, normalizeCycle(order.cycle), order.amount_vnd, order.pay_code, order.status, order.expires_at]
        );
        const r = res.rows[0];
        return this.mapOrder(r);
    }

    async findOrderById(id: string): Promise<Order | null> {
        if (!isUuid(id)) return null;
        const res = await db.query('SELECT * FROM orders WHERE id = $1 LIMIT 1', [id]);
        if (res.rows.length === 0) return null;
        return this.mapOrder(res.rows[0]);
    }

    async findOrderByPayCode(payCode: string): Promise<Order | null> {
        const res = await db.query('SELECT * FROM orders WHERE pay_code = $1 LIMIT 1', [payCode]);
        if (res.rows.length === 0) return null;
        return this.mapOrder(res.rows[0]);
    }

    async findPendingOrderByUserId(userId: string): Promise<Order | null> {
        if (!isUuid(userId)) return null;
        const res = await db.query(
            `SELECT * FROM orders WHERE user_id = $1 AND status IN ('pending', 'claimed') ORDER BY created_at DESC LIMIT 1`,
            [userId]
        );
        if (res.rows.length === 0) return null;
        return this.mapOrder(res.rows[0]);
    }

    async cancelActiveOrdersForUser(userId: string): Promise<void> {
        if (!isUuid(userId)) return;
        await db.query(
            `UPDATE orders SET status = 'cancelled' WHERE user_id = $1 AND status IN ('pending', 'claimed')`,
            [userId]
        );
    }

    async updateOrderClaimed(orderId: string, claimedAt: string, expiresAt: string): Promise<Order | null> {
        if (!isUuid(orderId)) return null;
        const res = await db.query(
            `UPDATE orders
             SET status = 'claimed', claimed_at = $1, expires_at = $2
             WHERE id = $3 AND status = 'pending'
             RETURNING *`,
            [claimedAt, expiresAt, orderId]
        );
        if (res.rows.length === 0) return null;
        return this.mapOrder(res.rows[0]);
    }

    async expireStaleOrders(nowIso?: string): Promise<number> {
        const now = nowIso ? new Date(nowIso) : new Date();
        const res = await db.query(
            `UPDATE orders
             SET status = 'expired'
             WHERE status IN ('pending', 'claimed') AND expires_at < $1`,
            [now]
        );
        return res.rowCount || 0;
    }

    async findPaymentBySepayRef(sepayRef: string): Promise<Payment | null> {
        const res = await db.query(
            `SELECT * FROM payments
             WHERE sepay_ref = $1
                OR (raw->>'referenceCode' = $1 AND raw->>'referenceCode' IS NOT NULL AND raw->>'referenceCode' != '')
                OR (raw->>'reference_code' = $1 AND raw->>'reference_code' IS NOT NULL AND raw->>'reference_code' != '')
             LIMIT 1`,
            [sepayRef]
        );
        if (res.rows.length === 0) return null;
        const r = res.rows[0];
        return {
            id: r.id,
            order_id: r.order_id,
            sepay_ref: r.sepay_ref,
            amount_vnd: r.amount_vnd,
            raw: r.raw,
            received_at: new Date(r.received_at).toISOString(),
            result: r.result,
        };
    }

    async findUnmatchedPaymentBySepayRef(sepayRef: string): Promise<UnmatchedPayment | null> {
        const res = await db.query(
            `SELECT * FROM unmatched_payments
             WHERE sepay_ref = $1
                OR (raw->>'referenceCode' = $1 AND raw->>'referenceCode' IS NOT NULL AND raw->>'referenceCode' != '')
                OR (raw->>'reference_code' = $1 AND raw->>'reference_code' IS NOT NULL AND raw->>'reference_code' != '')
             LIMIT 1`,
            [sepayRef]
        );
        if (res.rows.length === 0) return null;
        const r = res.rows[0];
        return {
            id: r.id,
            sepay_ref: r.sepay_ref,
            amount_vnd: r.amount_vnd,
            content: r.content,
            raw: r.raw,
            status: r.status,
            admin_note: r.admin_note,
            resolved_by: r.resolved_by,
            resolved_at: r.resolved_at ? new Date(r.resolved_at).toISOString() : null,
            created_at: new Date(r.created_at).toISOString(),
        };
    }

    async findPaymentBySepayId(sepayId: string): Promise<Payment | null> {
        const res = await db.query(
            `SELECT * FROM payments WHERE sepay_ref = $1 LIMIT 1`,
            [sepayId]
        );
        if (res.rows.length === 0) return null;
        const r = res.rows[0];
        return {
            id: r.id,
            order_id: r.order_id,
            sepay_ref: r.sepay_ref,
            amount_vnd: r.amount_vnd,
            raw: r.raw,
            received_at: new Date(r.received_at).toISOString(),
            result: r.result,
        };
    }

    async findUnmatchedPaymentBySepayId(sepayId: string): Promise<UnmatchedPayment | null> {
        const res = await db.query(
            `SELECT * FROM unmatched_payments WHERE sepay_ref = $1 LIMIT 1`,
            [sepayId]
        );
        if (res.rows.length === 0) return null;
        const r = res.rows[0];
        return {
            id: r.id,
            sepay_ref: r.sepay_ref,
            amount_vnd: r.amount_vnd,
            content: r.content,
            raw: r.raw,
            status: r.status,
            admin_note: r.admin_note,
            resolved_by: r.resolved_by,
            resolved_at: r.resolved_at ? new Date(r.resolved_at).toISOString() : null,
            created_at: new Date(r.created_at).toISOString(),
        };
    }

    async recordUnmatchedPayment(item: Omit<UnmatchedPayment, 'id' | 'created_at'>): Promise<UnmatchedPayment> {
        const id = randomUUID();
        const res = await db.query(
            `INSERT INTO unmatched_payments (id, sepay_ref, amount_vnd, content, raw, status, admin_note)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [id, item.sepay_ref, item.amount_vnd, item.content, JSON.stringify(item.raw), item.status, item.admin_note || null]
        );
        const r = res.rows[0];
        return {
            id: r.id,
            sepay_ref: r.sepay_ref,
            amount_vnd: r.amount_vnd,
            content: r.content,
            raw: r.raw,
            status: r.status,
            admin_note: r.admin_note,
            resolved_by: r.resolved_by,
            resolved_at: r.resolved_at ? new Date(r.resolved_at).toISOString() : null,
            created_at: new Date(r.created_at).toISOString(),
        };
    }

    async lockAndFulfillOrder(params: {
        orderId: string;
        sepayRef: string;
        receivedAmount: number;
        raw: any;
        planDays: number;
        quotaVideo: number;
        planId: string;
        result: PaymentResult;
    }): Promise<{ success: boolean; order?: Order; payment?: Payment; reason?: string }> {
        const client = await db.connect();
        try {
            await client.query('BEGIN');

            // Lock order row
            const orderRes = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [params.orderId]);
            if (orderRes.rows.length === 0) {
                await client.query('ROLLBACK');
                return { success: false, reason: 'ORDER_NOT_FOUND' };
            }
            const order = orderRes.rows[0];
            if (order.status === 'paid') {
                await client.query('ROLLBACK');
                return { success: false, reason: 'ALREADY_PAID' };
            }
            // Chỉ đơn đang chờ mới được thanh toán: trạng thái khác (expired/
            // cancelled lọt qua tầng service) hoặc đã quá hạn theo đồng hồ
            // thì dừng — tiền về muộn thuộc đường unmatched duyệt tay.
            if (order.status !== 'pending' && order.status !== 'claimed') {
                await client.query('ROLLBACK');
                return { success: false, reason: 'ORDER_NOT_PAYABLE' };
            }
            if (new Date(order.expires_at).getTime() <= Date.now()) {
                await client.query('ROLLBACK');
                return { success: false, reason: 'ORDER_EXPIRED' };
            }

            // Mark order as paid
            const updatedOrderRes = await client.query(
                `UPDATE orders SET status = 'paid', paid_at = NOW() WHERE id = $1 RETURNING *`,
                [params.orderId]
            );

            // Record payment ledger
            const paymentId = randomUUID();
            const paymentRes = await client.query(
                `INSERT INTO payments (id, order_id, sepay_ref, amount_vnd, raw, result)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 RETURNING *`,
                [paymentId, params.orderId, params.sepayRef, params.receivedAmount, JSON.stringify(params.raw), params.result]
            );

            // Extend user plan and credits cumulatively:
            // plan_expires_at = max(now, plan_expires_at) + plan.days
            await client.query(
                `UPDATE users
                 SET plan_id = $1,
                     tier = $1,
                     plan_expires_at = GREATEST(NOW(), COALESCE(plan_expires_at, NOW())) + ($2 || ' days')::INTERVAL,
                     credits = COALESCE(credits, 0) + $3
                 WHERE id = $4`,
                [params.planId, params.planDays, params.quotaVideo, order.user_id]
            );

            // Cancel any other pending/claimed orders of this user
            await client.query(
                `UPDATE orders
                 SET status = 'cancelled'
                 WHERE user_id = $1 AND id != $2 AND status IN ('pending', 'claimed')`,
                [order.user_id, params.orderId]
            );

            await client.query('COMMIT');

            return {
                success: true,
                order: this.mapOrder(updatedOrderRes.rows[0]),
                payment: {
                    id: paymentRes.rows[0].id,
                    order_id: paymentRes.rows[0].order_id,
                    sepay_ref: paymentRes.rows[0].sepay_ref,
                    amount_vnd: paymentRes.rows[0].amount_vnd,
                    raw: paymentRes.rows[0].raw,
                    received_at: new Date(paymentRes.rows[0].received_at).toISOString(),
                    result: paymentRes.rows[0].result,
                },
            };
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    async recordDuplicatePayment(params: {
        orderId: string;
        sepayRef: string;
        amount: number;
        raw: any;
    }): Promise<Payment> {
        const id = randomUUID();
        const res = await db.query(
            `INSERT INTO payments (id, order_id, sepay_ref, amount_vnd, raw, result)
             VALUES ($1, $2, $3, $4, $5, 'duplicate')
             RETURNING *`,
            [id, params.orderId, params.sepayRef, params.amount, JSON.stringify(params.raw)]
        );
        const r = res.rows[0];
        return {
            id: r.id,
            order_id: r.order_id,
            sepay_ref: r.sepay_ref,
            amount_vnd: r.amount_vnd,
            raw: r.raw,
            received_at: new Date(r.received_at).toISOString(),
            result: 'duplicate',
        };
    }

    async recordUnderpaidPayment(params: {
        orderId: string;
        sepayRef: string;
        amount: number;
        raw: any;
    }): Promise<Payment> {
        const id = randomUUID();
        const res = await db.query(
            `INSERT INTO payments (id, order_id, sepay_ref, amount_vnd, raw, result)
             VALUES ($1, $2, $3, $4, $5, 'underpaid')
             RETURNING *`,
            [id, params.orderId, params.sepayRef, params.amount, JSON.stringify(params.raw)]
        );
        const r = res.rows[0];
        return {
            id: r.id,
            order_id: r.order_id,
            sepay_ref: r.sepay_ref,
            amount_vnd: r.amount_vnd,
            raw: r.raw,
            received_at: new Date(r.received_at).toISOString(),
            result: 'underpaid',
        };
    }

    async getUserPlanExpiry(userId: string): Promise<string | null> {
        if (!isUuid(userId)) return null;
        const res = await db.query('SELECT plan_expires_at FROM users WHERE id = $1 LIMIT 1', [userId]);
        if (res.rows.length === 0 || !res.rows[0].plan_expires_at) return null;
        return new Date(res.rows[0].plan_expires_at).toISOString();
    }

    async getUnmatchedPayments(status?: string): Promise<UnmatchedPayment[]> {
        const filter = status && status !== 'all' ? status : null;
        const res = filter
            ? await db.query('SELECT * FROM unmatched_payments WHERE status = $1 ORDER BY created_at DESC LIMIT 100', [filter])
            : await db.query('SELECT * FROM unmatched_payments ORDER BY created_at DESC LIMIT 100');
        return res.rows.map(r => this.mapUnmatched(r));
    }

    async listUnmatchedPaymentsForAdmin(filters: AdminUnmatchedQuery = {}): Promise<AdminUnmatchedPage> {
        const { limit, offset } = normalizeListPaging(
            filters,
            ADMIN_PAYMENTS_DEFAULT_LIMIT,
            ADMIN_PAYMENTS_MAX_LIMIT
        );

        const conditions: string[] = [];
        const params: any[] = [];

        if (filters.status && filters.status !== 'all') {
            params.push(filters.status);
            conditions.push(`status = $${params.length}`);
        }

        const search = (filters.search || '').trim();
        if (search) {
            params.push(`%${search}%`);
            const like = `$${params.length}`;
            conditions.push(
                `(sepay_ref ILIKE ${like} OR content ILIKE ${like}` +
                ` OR COALESCE(admin_note, '') ILIKE ${like} OR amount_vnd::text ILIKE ${like})`
            );
        }

        if (filters.from) {
            params.push(filters.from);
            conditions.push(`created_at >= $${params.length}`);
        }
        if (filters.to) {
            params.push(filters.to);
            conditions.push(`created_at <= $${params.length}`);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const countRes = await db.query(
            `SELECT COUNT(*)::int AS total FROM unmatched_payments ${whereClause}`,
            params
        );
        const total = Number(countRes.rows[0]?.total ?? 0);

        const listParams = [...params, limit, offset];
        const res = await db.query(
            `SELECT * FROM unmatched_payments
             ${whereClause}
             ORDER BY created_at DESC
             LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
            listParams
        );

        return { unmatched: res.rows.map(r => this.mapUnmatched(r)), total };
    }

    async listDuplicatePaymentsForAdmin(filters: AdminDuplicateQuery = {}): Promise<AdminDuplicatePage> {
        const { limit, offset } = normalizeListPaging(
            filters,
            ADMIN_PAYMENTS_DEFAULT_LIMIT,
            ADMIN_PAYMENTS_MAX_LIMIT
        );

        // Chỉ lấy giao dịch trùng lặp; các điều kiện còn lại lọc thêm.
        const conditions: string[] = [`p.result = 'duplicate'`];
        const params: any[] = [];

        const search = (filters.search || '').trim();
        if (search) {
            params.push(search);
            const exact = `$${params.length}`;
            params.push(`%${search}%`);
            const like = `$${params.length}`;
            conditions.push(
                `(p.sepay_ref = ${exact} OR p.sepay_ref ILIKE ${like}` +
                ` OR p.amount_vnd::text ILIKE ${like} OR COALESCE(o.pay_code, '') ILIKE ${like})`
            );
        }

        if (filters.from) {
            params.push(filters.from);
            conditions.push(`p.received_at >= $${params.length}`);
        }
        if (filters.to) {
            params.push(filters.to);
            conditions.push(`p.received_at <= $${params.length}`);
        }

        const whereClause = `WHERE ${conditions.join(' AND ')}`;
        const joins = `FROM payments p LEFT JOIN orders o ON o.id = p.order_id`;

        const countRes = await db.query(`SELECT COUNT(*)::int AS total ${joins} ${whereClause}`, params);
        const total = Number(countRes.rows[0]?.total ?? 0);

        const listParams = [...params, limit, offset];
        const res = await db.query(
            `SELECT p.*
             ${joins}
             ${whereClause}
             ORDER BY p.received_at DESC
             LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
            listParams
        );

        return { duplicates: res.rows.map(r => this.mapPayment(r)), total };
    }

    async findOrdersByIds(ids: string[]): Promise<Map<string, Order>> {
        const map = new Map<string, Order>();
        const unique = Array.from(new Set((ids || []).filter((id): id is string => isUuid(id))));
        if (unique.length === 0) return map;

        const res = await db.query('SELECT * FROM orders WHERE id = ANY($1::uuid[])', [unique]);
        for (const r of res.rows) {
            const order = this.mapOrder(r);
            map.set(order.id, order);
        }
        return map;
    }

    async findUnmatchedPaymentById(id: string): Promise<UnmatchedPayment | null> {
        if (!isUuid(id)) return null;
        const res = await db.query('SELECT * FROM unmatched_payments WHERE id = $1 LIMIT 1', [id]);
        if (res.rows.length === 0) return null;
        return this.mapUnmatched(res.rows[0]);
    }

    async findPaymentById(id: string): Promise<Payment | null> {
        if (!isUuid(id)) return null;
        const res = await db.query('SELECT * FROM payments WHERE id = $1 LIMIT 1', [id]);
        if (res.rows.length === 0) return null;
        const r = res.rows[0];
        return {
            id: r.id,
            order_id: r.order_id,
            sepay_ref: r.sepay_ref,
            amount_vnd: r.amount_vnd,
            raw: r.raw,
            received_at: new Date(r.received_at).toISOString(),
            result: r.result,
        };
    }

    async listDuplicatePayments(): Promise<Payment[]> {
        const res = await db.query(
            `SELECT * FROM payments WHERE result = 'duplicate' ORDER BY received_at DESC LIMIT 100`
        );
        return res.rows.map(r => this.mapPayment(r));
    }

    async findPaymentByOrderId(orderId: string): Promise<Payment | null> {
        if (!isUuid(orderId)) return null;
        const res = await db.query(
            'SELECT * FROM payments WHERE order_id = $1 ORDER BY received_at DESC LIMIT 1',
            [orderId]
        );
        if (res.rows.length === 0) return null;
        return this.mapPayment(res.rows[0]);
    }

    async findRefundBySource(sourceType: RefundSourceType, sourceId: string): Promise<Refund | null> {
        const res = await db.query(
            'SELECT * FROM refunds WHERE source_type = $1 AND source_id = $2 LIMIT 1',
            [sourceType, sourceId]
        );
        if (res.rows.length === 0) return null;
        const r = res.rows[0];
        return {
            id: r.id,
            source_type: r.source_type,
            source_id: r.source_id,
            sepay_ref: r.sepay_ref,
            amount_vnd: r.amount_vnd,
            bank_account: r.bank_account,
            bank_name: r.bank_name,
            admin_note: r.admin_note,
            refunded_by: r.refunded_by,
            refunded_at: new Date(r.refunded_at).toISOString(),
            created_at: new Date(r.created_at).toISOString(),
        };
    }

    async getRefundedSourceIds(sourceType: RefundSourceType, sourceIds: string[]): Promise<Set<string>> {
        if (sourceIds.length === 0) return new Set();
        const res = await db.query(
            'SELECT source_id FROM refunds WHERE source_type = $1 AND source_id = ANY($2)',
            [sourceType, sourceIds]
        );
        return new Set(res.rows.map(r => r.source_id));
    }

    async recordRefund(item: Omit<Refund, 'id' | 'created_at' | 'refunded_at'>): Promise<Refund> {
        const id = randomUUID();
        const res = await db.query(
            `INSERT INTO refunds (id, source_type, source_id, sepay_ref, amount_vnd, bank_account, bank_name, admin_note, refunded_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING *`,
            [id, item.source_type, item.source_id, item.sepay_ref, item.amount_vnd, item.bank_account, item.bank_name, item.admin_note || null, item.refunded_by || null]
        );
        const r = res.rows[0];
        return {
            id: r.id,
            source_type: r.source_type,
            source_id: r.source_id,
            sepay_ref: r.sepay_ref,
            amount_vnd: r.amount_vnd,
            bank_account: r.bank_account,
            bank_name: r.bank_name,
            admin_note: r.admin_note,
            refunded_by: r.refunded_by,
            refunded_at: new Date(r.refunded_at).toISOString(),
            created_at: new Date(r.created_at).toISOString(),
        };
    }

    async listRefunds(): Promise<Refund[]> {
        const res = await db.query('SELECT * FROM refunds ORDER BY created_at DESC LIMIT 100');
        return res.rows.map(r => this.mapRefund(r));
    }

    async listRefundsForAdmin(filters: AdminRefundQuery = {}): Promise<AdminRefundPage> {
        const { limit, offset } = normalizeListPaging(
            filters,
            ADMIN_PAYMENTS_DEFAULT_LIMIT,
            ADMIN_PAYMENTS_MAX_LIMIT
        );

        const conditions: string[] = [];
        const params: any[] = [];

        if (filters.sourceType && filters.sourceType !== 'all') {
            params.push(filters.sourceType);
            conditions.push(`source_type = $${params.length}`);
        }

        const search = (filters.search || '').trim();
        if (search) {
            params.push(`%${search}%`);
            const like = `$${params.length}`;
            conditions.push(
                `(sepay_ref ILIKE ${like} OR bank_account ILIKE ${like} OR bank_name ILIKE ${like}` +
                ` OR COALESCE(refunded_by, '') ILIKE ${like} OR COALESCE(admin_note, '') ILIKE ${like}` +
                ` OR amount_vnd::text ILIKE ${like})`
            );
        }

        if (filters.from) {
            params.push(filters.from);
            conditions.push(`created_at >= $${params.length}`);
        }
        if (filters.to) {
            params.push(filters.to);
            conditions.push(`created_at <= $${params.length}`);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const countRes = await db.query(`SELECT COUNT(*)::int AS total FROM refunds ${whereClause}`, params);
        const total = Number(countRes.rows[0]?.total ?? 0);

        const listParams = [...params, limit, offset];
        const res = await db.query(
            `SELECT * FROM refunds
             ${whereClause}
             ORDER BY created_at DESC
             LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
            listParams
        );

        return { refunds: res.rows.map(r => this.mapRefund(r)), total };
    }

    private mapRefund(r: any): Refund {
        return {
            id: r.id,
            source_type: r.source_type,
            source_id: r.source_id,
            sepay_ref: r.sepay_ref,
            amount_vnd: r.amount_vnd,
            bank_account: r.bank_account,
            bank_name: r.bank_name,
            admin_note: r.admin_note,
            refunded_by: r.refunded_by,
            refunded_at: new Date(r.refunded_at).toISOString(),
            created_at: new Date(r.created_at).toISOString(),
        };
    }

    async cancelOrder(orderId: string): Promise<Order | null> {
        if (!isUuid(orderId)) return null;
        const res = await db.query(
            `UPDATE orders
             SET status = 'cancelled'
             WHERE id = $1 AND status IN ('pending', 'claimed')
             RETURNING *`,
            [orderId]
        );
        if (res.rows.length === 0) return null;
        return this.mapOrder(res.rows[0]);
    }

    async resolveUnmatchedPayment(
        id: string,
        status: UnmatchedPaymentStatus,
        adminNote?: string,
        resolvedBy?: string
    ): Promise<UnmatchedPayment | null> {
        if (!isUuid(id)) return null;
        const trimmedNote = adminNote?.trim() || null;
        const res = await db.query(
            `UPDATE unmatched_payments
             SET status = $1,
                 admin_note = CASE
                     WHEN $2::text IS NULL OR $2::text = '' THEN admin_note
                     WHEN admin_note IS NULL OR admin_note = '' THEN $2::text
                     ELSE admin_note || ' | ' || $2::text
                 END,
                 resolved_by = $3,
                 resolved_at = NOW()
             WHERE id = $4
             RETURNING *`,
            [status, trimmedNote, resolvedBy || 'admin', id]
        );
        if (res.rows.length === 0) return null;
        const r = res.rows[0];
        return {
            id: r.id,
            sepay_ref: r.sepay_ref,
            amount_vnd: r.amount_vnd,
            content: r.content,
            raw: r.raw,
            status: r.status,
            admin_note: r.admin_note,
            resolved_by: r.resolved_by,
            resolved_at: r.resolved_at ? new Date(r.resolved_at).toISOString() : null,
            created_at: new Date(r.created_at).toISOString(),
        };
    }

    async listOrders(filters?: { status?: string; userId?: string }): Promise<Order[]> {
        const conditions: string[] = [];
        const params: any[] = [];
        if (filters?.status) {
            params.push(filters.status);
            conditions.push(`status = $${params.length}`);
        }
        if (filters?.userId) {
            params.push(filters.userId);
            conditions.push(`user_id = $${params.length}`);
        }
        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const res = await db.query(`SELECT * FROM orders ${whereClause} ORDER BY created_at DESC LIMIT 100`, params);
        return res.rows.map(r => this.mapOrder(r));
    }

    async listOrdersForAdmin(filters: AdminOrderQuery = {}): Promise<AdminOrderPage> {
        const { limit, offset } = normalizeAdminPaging(filters);
        const conditions: string[] = [];
        const params: any[] = [];

        if (filters.status && filters.status !== 'all') {
            params.push(filters.status);
            conditions.push(`o.status = $${params.length}`);
        }

        const search = (filters.search || '').trim();
        if (search) {
            // Khớp chính xác dùng được index B-tree (idx_orders_pay_code / khoá chính),
            // khớp chuỗi con dùng index trigram (idx_orders_pay_code_trgm) nếu có pg_trgm.
            params.push(search);
            const exactIdx = params.length;
            params.push(`%${search}%`);
            const likeIdx = params.length;
            conditions.push(
                `(o.pay_code = $${exactIdx}` +
                    ` OR o.pay_code ILIKE $${likeIdx}` +
                    ` OR o.id::text ILIKE $${likeIdx}` +
                    ` OR o.user_id::text ILIKE $${likeIdx}` +
                    ` OR COALESCE(u.email, '') ILIKE $${likeIdx})`
            );
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const countRes = await db.query(
            `SELECT COUNT(*)::int AS total
             FROM orders o
             LEFT JOIN users u ON u.id = o.user_id
             ${whereClause}`,
            params
        );
        const total = Number(countRes.rows[0]?.total ?? 0);

        const listParams = [...params, limit, offset];
        const res = await db.query(
            `SELECT o.*
             FROM orders o
             LEFT JOIN users u ON u.id = o.user_id
             ${whereClause}
             ORDER BY o.created_at DESC
             LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
            listParams
        );

        return { orders: res.rows.map((r) => this.mapOrder(r)), total };
    }

    private mapOrder(r: any): Order {
        return {
            id: r.id,
            user_id: r.user_id,
            plan_id: r.plan_id,
            cycle: normalizeCycle(r.cycle),
            amount_vnd: r.amount_vnd,
            pay_code: r.pay_code,
            status: r.status,
            expires_at: new Date(r.expires_at).toISOString(),
            claimed_at: r.claimed_at ? new Date(r.claimed_at).toISOString() : null,
            paid_at: r.paid_at ? new Date(r.paid_at).toISOString() : null,
            created_at: new Date(r.created_at).toISOString(),
        };
    }

    private mapPayment(r: any): Payment {
        return {
            id: r.id,
            order_id: r.order_id,
            sepay_ref: r.sepay_ref,
            amount_vnd: r.amount_vnd,
            raw: r.raw,
            received_at: new Date(r.received_at).toISOString(),
            result: r.result,
        };
    }

    private mapUnmatched(r: any): UnmatchedPayment {
        return {
            id: r.id,
            sepay_ref: r.sepay_ref,
            amount_vnd: r.amount_vnd,
            content: r.content,
            raw: r.raw,
            status: r.status,
            admin_note: r.admin_note,
            resolved_by: r.resolved_by,
            resolved_at: r.resolved_at ? new Date(r.resolved_at).toISOString() : null,
            created_at: new Date(r.created_at).toISOString(),
        };
    }

    async resetForTesting(): Promise<void> {
        await db.query('DELETE FROM refunds');
        await db.query('DELETE FROM payments');
        await db.query('DELETE FROM unmatched_payments');
        await db.query('DELETE FROM orders');
    }
}

export class InMemoryBillingStorage implements IBillingStorage {
    private orders = new Map<string, Order>();
    private payments = new Map<string, Payment>();
    private unmatched = new Map<string, UnmatchedPayment>();
    private refunds = new Map<string, Refund>();
    private userExpiries = new Map<string, string>();
    private userCredits = new Map<string, number>();
    private filePath: string;

    constructor() {
        this.filePath = join(process.cwd(), 'data', 'billing.json');
        this.loadFromDisk();
    }

    private loadFromDisk() {
        try {
            if (existsSync(this.filePath)) {
                const data = JSON.parse(readFileSync(this.filePath, 'utf-8'));
                if (data.orders) {
                    for (const o of data.orders) {
                        // Dữ liệu cũ (trước khi có gói năm) không có `cycle`.
                        o.cycle = normalizeCycle(o.cycle);
                        this.orders.set(o.id, o);
                    }
                }
                if (data.payments) {
                    for (const p of data.payments) this.payments.set(p.id, p);
                }
                if (data.unmatched) {
                    for (const u of data.unmatched) this.unmatched.set(u.id, u);
                }
                if (data.refunds) {
                    for (const r of data.refunds) this.refunds.set(r.id, r);
                }
                if (data.userExpiries) {
                    for (const [k, v] of Object.entries(data.userExpiries)) this.userExpiries.set(k, v as string);
                }
                if (data.userCredits) {
                    for (const [k, v] of Object.entries(data.userCredits)) this.userCredits.set(k, v as number);
                }
            }
        } catch (e) {
            console.error('[InMemoryBillingStorage] Error loading billing file:', e);
        }
    }

    private saveToDisk() {
        try {
            const dir = join(process.cwd(), 'data');
            if (!existsSync(dir)) {
                mkdirSync(dir, { recursive: true });
            }
            const data = {
                orders: Array.from(this.orders.values()),
                payments: Array.from(this.payments.values()),
                unmatched: Array.from(this.unmatched.values()),
                refunds: Array.from(this.refunds.values()),
                userExpiries: Object.fromEntries(this.userExpiries.entries()),
                userCredits: Object.fromEntries(this.userCredits.entries()),
            };
            writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
        } catch (e) {
            console.error('[InMemoryBillingStorage] Error saving billing file:', e);
        }
    }

    async getPlans(): Promise<Plan[]> {
        return DEFAULT_PLANS;
    }

    async getPlanById(id: string): Promise<Plan | null> {
        return DEFAULT_PLANS.find(p => p.id === id) || null;
    }

    async createOrder(order: Omit<Order, 'id' | 'created_at'>): Promise<Order> {
        const id = randomUUID();
        const created: Order = {
            ...order,
            id,
            created_at: new Date().toISOString(),
        };
        this.orders.set(id, created);
        this.saveToDisk();
        return created;
    }

    async findOrderById(id: string): Promise<Order | null> {
        return this.orders.get(id) || null;
    }

    async findOrderByPayCode(payCode: string): Promise<Order | null> {
        for (const order of this.orders.values()) {
            if (order.pay_code.toUpperCase() === payCode.toUpperCase()) {
                return order;
            }
        }
        return null;
    }

    async findPendingOrderByUserId(userId: string): Promise<Order | null> {
        for (const order of this.orders.values()) {
            if (order.user_id === userId && (order.status === 'pending' || order.status === 'claimed')) {
                return order;
            }
        }
        return null;
    }

    async cancelActiveOrdersForUser(userId: string): Promise<void> {
        for (const order of this.orders.values()) {
            if (order.user_id === userId && (order.status === 'pending' || order.status === 'claimed')) {
                order.status = 'cancelled';
            }
        }
        this.saveToDisk();
    }

    async updateOrderClaimed(orderId: string, claimedAt: string, expiresAt: string): Promise<Order | null> {
        const order = this.orders.get(orderId);
        if (!order || order.status !== 'pending') return null;
        order.status = 'claimed';
        order.claimed_at = claimedAt;
        order.expires_at = expiresAt;
        this.saveToDisk();
        return order;
    }

    async expireStaleOrders(nowIso?: string): Promise<number> {
        const now = nowIso ? new Date(nowIso).getTime() : Date.now();
        let count = 0;
        for (const order of this.orders.values()) {
            if ((order.status === 'pending' || order.status === 'claimed') && new Date(order.expires_at).getTime() < now) {
                order.status = 'expired';
                count++;
            }
        }
        if (count > 0) this.saveToDisk();
        return count;
    }

    async findPaymentBySepayRef(sepayRef: string): Promise<Payment | null> {
        for (const p of this.payments.values()) {
            if (p.sepay_ref === sepayRef) return p;
            if (sepayRef && (p.raw?.referenceCode === sepayRef || p.raw?.reference_code === sepayRef)) return p;
        }
        return null;
    }

    async findUnmatchedPaymentBySepayRef(sepayRef: string): Promise<UnmatchedPayment | null> {
        for (const u of this.unmatched.values()) {
            if (u.sepay_ref === sepayRef) return u;
            if (sepayRef && (u.raw?.referenceCode === sepayRef || u.raw?.reference_code === sepayRef)) return u;
        }
        return null;
    }

    async findPaymentBySepayId(sepayId: string): Promise<Payment | null> {
        for (const p of this.payments.values()) {
            if (p.sepay_ref === sepayId) return p;
        }
        return null;
    }

    async findUnmatchedPaymentBySepayId(sepayId: string): Promise<UnmatchedPayment | null> {
        for (const u of this.unmatched.values()) {
            if (u.sepay_ref === sepayId) return u;
        }
        return null;
    }

    async recordUnmatchedPayment(item: Omit<UnmatchedPayment, 'id' | 'created_at'>): Promise<UnmatchedPayment> {
        const id = randomUUID();
        const unmatched: UnmatchedPayment = {
            ...item,
            id,
            created_at: new Date().toISOString(),
        };
        this.unmatched.set(id, unmatched);
        this.saveToDisk();
        return unmatched;
    }

    async lockAndFulfillOrder(params: {
        orderId: string;
        sepayRef: string;
        receivedAmount: number;
        raw: any;
        planDays: number;
        quotaVideo: number;
        planId: string;
        result: PaymentResult;
    }): Promise<{ success: boolean; order?: Order; payment?: Payment; reason?: string }> {
        const order = this.orders.get(params.orderId);
        if (!order) return { success: false, reason: 'ORDER_NOT_FOUND' };
        if (order.status === 'paid') return { success: false, reason: 'ALREADY_PAID' };
        if (order.status !== 'pending' && order.status !== 'claimed') {
            return { success: false, reason: 'ORDER_NOT_PAYABLE' };
        }
        if (new Date(order.expires_at).getTime() <= Date.now()) {
            return { success: false, reason: 'ORDER_EXPIRED' };
        }

        order.status = 'paid';
        order.paid_at = new Date().toISOString();

        const paymentId = randomUUID();
        const payment: Payment = {
            id: paymentId,
            order_id: params.orderId,
            sepay_ref: params.sepayRef,
            amount_vnd: params.receivedAmount,
            raw: params.raw,
            received_at: new Date().toISOString(),
            result: params.result,
        };
        this.payments.set(paymentId, payment);

        // Cumulative renewal
        const now = Date.now();
        const currentExpiry = this.userExpiries.get(order.user_id);
        const baseTime = currentExpiry ? Math.max(now, new Date(currentExpiry).getTime()) : now;
        const newExpiryTime = baseTime + params.planDays * 24 * 60 * 60 * 1000;
        this.userExpiries.set(order.user_id, new Date(newExpiryTime).toISOString());

        const currentCredits = this.userCredits.get(order.user_id) || 0;
        this.userCredits.set(order.user_id, currentCredits + params.quotaVideo);

        // Cancel other pending orders
        for (const o of this.orders.values()) {
            if (o.user_id === order.user_id && o.id !== order.id && (o.status === 'pending' || o.status === 'claimed')) {
                o.status = 'cancelled';
            }
        }

        this.saveToDisk();
        return { success: true, order, payment };
    }

    async recordDuplicatePayment(params: {
        orderId: string;
        sepayRef: string;
        amount: number;
        raw: any;
    }): Promise<Payment> {
        const id = randomUUID();
        const payment: Payment = {
            id,
            order_id: params.orderId,
            sepay_ref: params.sepayRef,
            amount_vnd: params.amount,
            raw: params.raw,
            received_at: new Date().toISOString(),
            result: 'duplicate',
        };
        this.payments.set(id, payment);
        this.saveToDisk();
        return payment;
    }

    async recordUnderpaidPayment(params: {
        orderId: string;
        sepayRef: string;
        amount: number;
        raw: any;
    }): Promise<Payment> {
        const id = randomUUID();
        const payment: Payment = {
            id,
            order_id: params.orderId,
            sepay_ref: params.sepayRef,
            amount_vnd: params.amount,
            raw: params.raw,
            received_at: new Date().toISOString(),
            result: 'underpaid',
        };
        this.payments.set(id, payment);
        this.saveToDisk();
        return payment;
    }

    async getUserPlanExpiry(userId: string): Promise<string | null> {
        return this.userExpiries.get(userId) || null;
    }

    async getUnmatchedPayments(status?: string): Promise<UnmatchedPayment[]> {
        let list = Array.from(this.unmatched.values());
        if (status && status !== 'all') {
            list = list.filter(u => u.status === status);
        }
        return list.sort((a, b) => b.created_at.localeCompare(a.created_at));
    }

    async findUnmatchedPaymentById(id: string): Promise<UnmatchedPayment | null> {
        return this.unmatched.get(id) || null;
    }

    async findPaymentById(id: string): Promise<Payment | null> {
        return this.payments.get(id) || null;
    }

    async findPaymentByOrderId(orderId: string): Promise<Payment | null> {
        const matches = Array.from(this.payments.values())
            .filter(p => p.order_id === orderId)
            .sort((a, b) => b.received_at.localeCompare(a.received_at));
        return matches[0] || null;
    }

    async listDuplicatePayments(): Promise<Payment[]> {
        return Array.from(this.payments.values())
            .filter(p => p.result === 'duplicate')
            .sort((a, b) => b.received_at.localeCompare(a.received_at));
    }

    async listUnmatchedPaymentsForAdmin(filters: AdminUnmatchedQuery = {}): Promise<AdminUnmatchedPage> {
        const { limit, offset } = normalizeListPaging(
            filters,
            ADMIN_PAYMENTS_DEFAULT_LIMIT,
            ADMIN_PAYMENTS_MAX_LIMIT
        );

        const status = filters.status && filters.status !== 'all' ? filters.status : undefined;
        const search = (filters.search || '').trim().toLowerCase();
        const fromTs = filters.from ? new Date(filters.from).getTime() : NaN;
        const toTs = filters.to ? new Date(filters.to).getTime() : NaN;

        const list = Array.from(this.unmatched.values())
            .filter((u) => {
                if (status && u.status !== status) return false;
                const ts = new Date(u.created_at).getTime();
                if (!Number.isNaN(fromTs) && ts < fromTs) return false;
                if (!Number.isNaN(toTs) && ts > toTs) return false;
                if (search) {
                    const haystack = [u.sepay_ref, u.content, u.admin_note, String(u.amount_vnd)]
                        .filter(Boolean)
                        .join(' ')
                        .toLowerCase();
                    if (!haystack.includes(search)) return false;
                }
                return true;
            })
            .sort((a, b) => b.created_at.localeCompare(a.created_at));

        return { unmatched: list.slice(offset, offset + limit), total: list.length };
    }

    async listDuplicatePaymentsForAdmin(filters: AdminDuplicateQuery = {}): Promise<AdminDuplicatePage> {
        const { limit, offset } = normalizeListPaging(
            filters,
            ADMIN_PAYMENTS_DEFAULT_LIMIT,
            ADMIN_PAYMENTS_MAX_LIMIT
        );

        const search = (filters.search || '').trim().toLowerCase();
        const fromTs = filters.from ? new Date(filters.from).getTime() : NaN;
        const toTs = filters.to ? new Date(filters.to).getTime() : NaN;

        const list = Array.from(this.payments.values())
            .filter((p) => {
                if (p.result !== 'duplicate') return false;
                const ts = new Date(p.received_at).getTime();
                if (!Number.isNaN(fromTs) && ts < fromTs) return false;
                if (!Number.isNaN(toTs) && ts > toTs) return false;
                if (search) {
                    const orderPayCode = p.order_id ? this.orders.get(p.order_id)?.pay_code : undefined;
                    const haystack = [p.sepay_ref, String(p.amount_vnd), orderPayCode]
                        .filter(Boolean)
                        .join(' ')
                        .toLowerCase();
                    if (!haystack.includes(search)) return false;
                }
                return true;
            })
            .sort((a, b) => b.received_at.localeCompare(a.received_at));

        return { duplicates: list.slice(offset, offset + limit), total: list.length };
    }

    async findOrdersByIds(ids: string[]): Promise<Map<string, Order>> {
        const map = new Map<string, Order>();
        for (const id of new Set((ids || []).filter(Boolean))) {
            const order = this.orders.get(id);
            if (order) map.set(order.id, order);
        }
        return map;
    }

    async findRefundBySource(sourceType: RefundSourceType, sourceId: string): Promise<Refund | null> {
        for (const r of this.refunds.values()) {
            if (r.source_type === sourceType && r.source_id === sourceId) {
                return r;
            }
        }
        return null;
    }

    async getRefundedSourceIds(sourceType: RefundSourceType, sourceIds: string[]): Promise<Set<string>> {
        const idSet = new Set(sourceIds);
        const res = new Set<string>();
        for (const r of this.refunds.values()) {
            if (r.source_type === sourceType && idSet.has(r.source_id)) {
                res.add(r.source_id);
            }
        }
        return res;
    }

    async recordRefund(item: Omit<Refund, 'id' | 'created_at' | 'refunded_at'>): Promise<Refund> {
        const existing = await this.findRefundBySource(item.source_type, item.source_id);
        if (existing) {
            const err: any = new Error(`Refund already exists for source ${item.source_type}:${item.source_id}`);
            err.code = '23505';
            throw err;
        }
        const id = randomUUID();
        const now = new Date().toISOString();
        const refund: Refund = {
            ...item,
            id,
            refunded_at: now,
            created_at: now,
        };
        this.refunds.set(id, refund);
        this.saveToDisk();
        return refund;
    }

    async listRefunds(): Promise<Refund[]> {
        return Array.from(this.refunds.values()).sort((a, b) => b.created_at.localeCompare(a.created_at));
    }

    async listRefundsForAdmin(filters: AdminRefundQuery = {}): Promise<AdminRefundPage> {
        const { limit, offset } = normalizeListPaging(
            filters,
            ADMIN_PAYMENTS_DEFAULT_LIMIT,
            ADMIN_PAYMENTS_MAX_LIMIT
        );

        const sourceType = filters.sourceType && filters.sourceType !== 'all' ? filters.sourceType : undefined;
        const search = (filters.search || '').trim().toLowerCase();
        const fromTs = filters.from ? new Date(filters.from).getTime() : NaN;
        const toTs = filters.to ? new Date(filters.to).getTime() : NaN;

        const list = Array.from(this.refunds.values())
            .filter((r) => {
                if (sourceType && r.source_type !== sourceType) return false;
                const ts = new Date(r.created_at).getTime();
                if (!Number.isNaN(fromTs) && ts < fromTs) return false;
                if (!Number.isNaN(toTs) && ts > toTs) return false;
                if (search) {
                    const haystack = [
                        r.sepay_ref,
                        r.bank_account,
                        r.bank_name,
                        r.refunded_by,
                        r.admin_note,
                        String(r.amount_vnd),
                    ]
                        .filter(Boolean)
                        .join(' ')
                        .toLowerCase();
                    if (!haystack.includes(search)) return false;
                }
                return true;
            })
            .sort((a, b) => b.created_at.localeCompare(a.created_at));

        return { refunds: list.slice(offset, offset + limit), total: list.length };
    }

    async cancelOrder(orderId: string): Promise<Order | null> {
        const order = this.orders.get(orderId);
        if (!order) return null;
        if (order.status !== 'pending' && order.status !== 'claimed') return null;
        order.status = 'cancelled';
        this.saveToDisk();
        return order;
    }

    async resolveUnmatchedPayment(
        id: string,
        status: UnmatchedPaymentStatus,
        adminNote?: string,
        resolvedBy?: string
    ): Promise<UnmatchedPayment | null> {
        const item = this.unmatched.get(id);
        if (!item) return null;
        item.status = status;
        const trimmedNote = adminNote?.trim();
        if (trimmedNote) {
            item.admin_note = item.admin_note ? `${item.admin_note} | ${trimmedNote}` : trimmedNote;
        }
        item.resolved_by = resolvedBy || 'admin';
        item.resolved_at = new Date().toISOString();
        this.saveToDisk();
        return item;
    }

    async listOrders(filters?: { status?: string; userId?: string }): Promise<Order[]> {
        let list = Array.from(this.orders.values());
        if (filters?.status) list = list.filter(o => o.status === filters.status);
        if (filters?.userId) list = list.filter(o => o.user_id === filters.userId);
        return list.sort((a, b) => b.created_at.localeCompare(a.created_at));
    }

    async listOrdersForAdmin(filters: AdminOrderQuery = {}): Promise<AdminOrderPage> {
        const { limit, offset } = normalizeAdminPaging(filters);
        let list = Array.from(this.orders.values());

        if (filters.status && filters.status !== 'all') {
            list = list.filter((o) => o.status === filters.status);
        }

        const search = (filters.search || '').trim().toLowerCase();
        if (search) {
            list = list.filter(
                (o) =>
                    o.pay_code.toLowerCase().includes(search) ||
                    o.id.toLowerCase().includes(search) ||
                    o.user_id.toLowerCase().includes(search)
            );
        }

        list.sort((a, b) => b.created_at.localeCompare(a.created_at));
        return { orders: list.slice(offset, offset + limit), total: list.length };
    }

    async resetForTesting(): Promise<void> {
        this.orders.clear();
        this.payments.clear();
        this.unmatched.clear();
        this.refunds.clear();
        this.userExpiries.clear();
        this.userCredits.clear();
        try {
            if (existsSync(this.filePath)) {
                unlinkSync(this.filePath);
            }
        } catch {}
    }
}

const config = getConfig();
export const billingStorage: IBillingStorage = config.DATABASE_URL
    ? new PostgresBillingStorage()
    : new InMemoryBillingStorage();
