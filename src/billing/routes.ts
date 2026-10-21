import { timingSafeEqual, createHmac } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getConfig } from '../config.js';
import { getCurrentUser } from '../auth/session.js';
import { db } from '../database/index.js';
import { billingStorage } from './storage.js';
import { SUPPORTED_BANKS } from './banks.js';
import { helpdeskStore } from '../helpdesk/store.js';

import { vietQrBillingService } from './vietqrService.js';
import { getBillingWebhookQueue } from './queue.js';
import { SEPAY_OFFICIAL_IPS } from './constants.js';
import type { SePayWebhookPayload } from './types.js';

const createOrderSchema = z.object({
    plan_id: z.string().min(1),
});

export function verifyApiKey(authHeader?: string, expectedKey?: string): boolean {
    if (!expectedKey) {
        // If no SEPAY_API_KEY is set in environment (e.g. dev/test mode without key)
        return true;
    }
    if (!authHeader) return false;

    // Expected format: "Apikey <KEY>" or "Bearer <KEY>" or "<KEY>"
    const parts = authHeader.split(' ');
    const providedKey = parts.length > 1 ? parts[1].trim() : parts[0].trim();

    if (providedKey.length !== expectedKey.length) {
        return false;
    }

    try {
        return timingSafeEqual(Buffer.from(providedKey), Buffer.from(expectedKey));
    } catch {
        return false;
    }
}

/**
 * Verifies SePay HMAC-SHA256 signature and checks for replay attacks.
 * Headers:
 * - X-SePay-Signature: sha256={hex_hash}
 * - X-SePay-Timestamp: Unix timestamp in seconds
 */
export function verifyHmacSignature(
    signatureHeader: string | undefined,
    timestampHeader: string | undefined,
    rawBody: string | Buffer | undefined,
    secret: string | undefined
): { valid: boolean; reason?: string } {
    if (!secret) {
        return { valid: true };
    }
    if (!signatureHeader || !timestampHeader || rawBody === undefined || rawBody === null) {
        return { valid: false, reason: 'MISSING_SIGNATURE_HEADERS' };
    }

    const timestamp = Number(timestampHeader);
    if (isNaN(timestamp) || timestamp <= 0) {
        return { valid: false, reason: 'INVALID_TIMESTAMP' };
    }

    // Anti-replay: reject timestamps off by more than 300 seconds (5 minutes)
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSeconds - timestamp) > 300) {
        return { valid: false, reason: 'TIMESTAMP_EXPIRED' };
    }

    const bodyStr = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    const computedHash = createHmac('sha256', secret)
        .update(`${timestamp}.${bodyStr}`)
        .digest('hex');
    const expectedSignature = `sha256=${computedHash}`;

    const sigBuf = Buffer.from(signatureHeader.trim());
    const expBuf = Buffer.from(expectedSignature);

    if (sigBuf.length !== expBuf.length) {
        return { valid: false, reason: 'SIGNATURE_MISMATCH' };
    }

    try {
        if (timingSafeEqual(sigBuf, expBuf)) {
            return { valid: true };
        }
    } catch {
        return { valid: false, reason: 'TIMING_SAFE_EQUAL_ERROR' };
    }

    return { valid: false, reason: 'SIGNATURE_MISMATCH' };
}

/**
 * Checks whether client IP matches SePay's official IPs (7 IPv4 + 2 IPv6).
 */
export function verifyIpAllowlist(clientIp: string | undefined, customAllowlist?: string): boolean {
    if (!clientIp) return false;
    const normalizedClient = clientIp.replace(/^::ffff:/, '').trim().toLowerCase();

    // In local development / tests, allow loopback
    if (normalizedClient === '127.0.0.1' || normalizedClient === '::1' || normalizedClient === 'localhost') {
        return true;
    }

    const allowedSet = new Set<string>(SEPAY_OFFICIAL_IPS.map(ip => ip.toLowerCase()));
    if (customAllowlist) {
        customAllowlist.split(',').forEach(ip => {
            const clean = ip.trim().toLowerCase();
            if (clean) allowedSet.add(clean);
        });
    }

    return allowedSet.has(normalizedClient);
}

async function isUserAdmin(userId: string): Promise<boolean> {
    const config = getConfig();
    if (!config.DATABASE_URL) {
        return true; // Dev mode
    }
    try {
        const res = await db.query('SELECT role FROM users WHERE id = $1 LIMIT 1', [userId]);
        return res.rows[0]?.role === 'admin';
    } catch {
        return false;
    }
}

export async function billingRoutes(app: FastifyInstance): Promise<void> {
    // 0. Register content type parsers for billing routes
    // Handles application/x-www-form-urlencoded and preserves rawBody for HMAC-SHA256
    app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'buffer' }, (req, body, done) => {
        try {
            const str = (body as Buffer).toString('utf8');
            (req as any).rawBody = str;
            const parsed = Object.fromEntries(new URLSearchParams(str));
            done(null, parsed);
        } catch (err: any) {
            done(err, undefined);
        }
    });

    app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
        try {
            const str = (body as Buffer).toString('utf8');
            (req as any).rawBody = str;
            const parsed = str ? JSON.parse(str) : {};
            done(null, parsed);
        } catch (err: any) {
            done(err, undefined);
        }
    });

    // 1. Get available plans
    app.get('/api/billing/plans', async () => {
        const plans = await billingStorage.getPlans();
        return {
            success: true,
            plans,
        };
    });

    // 1b. Danh mục ngân hàng hỗ trợ nhận tiền hoàn (nguồn dữ liệu cho ô chọn ngân hàng).
    app.get('/api/billing/banks', async () => {
        return { success: true, banks: SUPPORTED_BANKS };
    });

    /**
     * 1c. Lịch sử thanh toán của chính người dùng đang đăng nhập.
     *
     * Mỗi đơn kèm trạng thái yêu cầu hoàn tiền hiện có và cờ `refundable`.
     * Quy tắc nghiệp vụ: **chỉ giao dịch lỗi / chưa được xử lý mới hoàn tiền được**.
     * Đơn đã thanh toán thành công (`status = 'paid'` — tiền vào và gói đã kích
     * hoạt) bị đánh dấu không thể hoàn tiền; máy chủ chặn lần nữa khi tạo yêu cầu.
     */
    app.get('/api/billing/orders', async (request: FastifyRequest, reply: FastifyReply) => {
        const user = await getCurrentUser(request);
        if (!user) {
            return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Vui lòng đăng nhập để xem lịch sử thanh toán.' });
        }

        const query = (request.query as any) || {};
        const statusFilter = String(query.status || 'all');
        const ALLOWED = ['all', 'pending', 'claimed', 'paid', 'expired', 'cancelled'];
        if (!ALLOWED.includes(statusFilter)) {
            return reply.status(400).send({
                error: 'INVALID_STATUS',
                message: `Trạng thái không hợp lệ. Chỉ chấp nhận: ${ALLOWED.join(', ')}.`,
            });
        }

        const orders = await billingStorage.listOrders({
            userId: user.id,
            status: statusFilter === 'all' ? undefined : statusFilter,
        });
        const refundMap = await helpdeskStore.mapRefundRequestsByOrder(user.id);
        const plans = await billingStorage.getPlans();
        const planNameById = new Map(plans.map((p) => [p.id, p.name]));

        return {
            success: true,
            orders: orders.map((order) => {
                const refundStatus = refundMap.get(order.id) ?? null;
                return {
                    id: order.id,
                    payCode: order.pay_code,
                    planId: order.plan_id,
                    planName: planNameById.get(order.plan_id) ?? null,
                    amountVnd: order.amount_vnd,
                    status: order.status,
                    claimedAt: order.claimed_at ?? null,
                    paidAt: order.paid_at ?? null,
                    expiresAt: order.expires_at,
                    createdAt: order.created_at,
                    refundStatus,
                    refundable: order.status !== 'paid' && (!refundStatus || refundStatus === 'rejected'),
                };
            }),
        };
    });

    // 2. Create order (POST /api/billing/vietqr/order)
    app.post('/api/billing/vietqr/order', async (request: FastifyRequest, reply: FastifyReply) => {
        const user = await getCurrentUser(request);
        if (!user) {
            return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Vui lòng đăng nhập để nâng cấp gói.' });
        }

        const parsed = createOrderSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({ error: 'INVALID_REQUEST', details: parsed.error.flatten() });
        }

        try {
            const orderRes = await vietQrBillingService.createOrder(user.id, parsed.data.plan_id);
            return reply.status(200).send(orderRes);
        } catch (err: any) {
            if (err.message === 'PLAN_NOT_FOUND') {
                return reply.status(404).send({ error: 'PLAN_NOT_FOUND', message: 'Gói dịch vụ không tồn tại.' });
            }
            if (err.message === 'PLAN_INACTIVE') {
                return reply.status(400).send({ error: 'PLAN_INACTIVE', message: 'Gói dịch vụ tạm thời ngưng cung cấp.' });
            }
            return reply.status(500).send({ error: 'INTERNAL_ERROR', message: err.message });
        }
    });

    // Alias: POST /api/billing/create-order (backward compatibility)
    app.post('/api/billing/create-order', async (request: FastifyRequest, reply: FastifyReply) => {
        const user = await getCurrentUser(request);
        if (!user) {
            return reply.status(401).send({ error: 'UNAUTHORIZED' });
        }
        const body = (request.body as any) || {};
        const planId = body.plan_id || body.targetId || body.plan;
        if (!planId) {
            return reply.status(400).send({ error: 'MISSING_PLAN_ID' });
        }
        try {
            const orderRes = await vietQrBillingService.createOrder(user.id, planId);
            return reply.status(200).send({ success: true, order: orderRes });
        } catch (err: any) {
            return reply.status(400).send({ error: err.message });
        }
    });

    // 3. Get order status (GET /api/billing/vietqr/order/:id)
    app.get('/api/billing/vietqr/order/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        const user = await getCurrentUser(request);
        if (!user) {
            return reply.status(401).send({ error: 'UNAUTHORIZED' });
        }

        const { id } = request.params;
        try {
            const isAdmin = await isUserAdmin(user.id);
            const statusRes = await vietQrBillingService.getOrderStatus(id, user.id, isAdmin);
            return reply.status(200).send(statusRes);
        } catch (err: any) {
            if (err.message === 'ORDER_NOT_FOUND') {
                return reply.status(404).send({ error: 'ORDER_NOT_FOUND', message: 'Không tìm thấy đơn hàng.' });
            }
            if (err.message === 'FORBIDDEN') {
                return reply.status(403).send({ error: 'FORBIDDEN', message: 'Bạn không có quyền xem đơn hàng này.' });
            }
            return reply.status(500).send({ error: 'INTERNAL_ERROR', message: err.message });
        }
    });

    // Alias: GET /api/billing/orders/:id
    app.get('/api/billing/orders/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        const user = await getCurrentUser(request);
        if (!user) {
            return reply.status(401).send({ error: 'UNAUTHORIZED' });
        }
        const { id } = request.params;
        try {
            const isAdmin = await isUserAdmin(user.id);
            const statusRes = await vietQrBillingService.getOrderStatus(id, user.id, isAdmin);
            return reply.status(200).send({ success: true, order: statusRes });
        } catch (err: any) {
            return reply.status(404).send({ error: err.message });
        }
    });

    // 4. Claim payment - "Tôi đã chuyển khoản" (POST /api/billing/vietqr/order/:id/claimed)
    app.post('/api/billing/vietqr/order/:id/claimed', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        const user = await getCurrentUser(request);
        if (!user) {
            return reply.status(401).send({ error: 'UNAUTHORIZED' });
        }

        const { id } = request.params;
        try {
            const result = await vietQrBillingService.claimOrder(id, user.id);
            return reply.status(200).send(result);
        } catch (err: any) {
            if (err.message === 'ORDER_NOT_FOUND') {
                return reply.status(404).send({ error: 'ORDER_NOT_FOUND' });
            }
            if (err.message === 'FORBIDDEN') {
                return reply.status(403).send({ error: 'FORBIDDEN' });
            }
            return reply.status(400).send({ error: err.message });
        }
    });

    // 5. SePay Webhook (POST /api/billing/vietqr/webhook & /api/billing/webhook)
    const handleWebhookRequest = async (request: FastifyRequest, reply: FastifyReply) => {
        const config = getConfig();

        // 1. IP Allowlist Check (if enabled)
        if (config.SEPAY_IP_ALLOWLIST_ENABLED) {
            const clientIp = request.ip;
            if (!verifyIpAllowlist(clientIp, config.SEPAY_IP_ALLOWLIST)) {
                console.warn(`[SePay Webhook] Rejected IP not in allowlist: ${clientIp}`);
                return reply.status(403).send({ error: 'FORBIDDEN_IP', message: 'IP address not allowed.' });
            }
        }

        // 2. Authentication Check (HMAC-SHA256 preferred, API Key fallback)
        const sigHeader = request.headers['x-sepay-signature'] as string | undefined;
        const tsHeader = request.headers['x-sepay-timestamp'] as string | undefined;
        const authHeader = (request.headers.authorization as string) || (request.headers['x-api-key'] as string) || '';
        const rawBody = (request as any).rawBody !== undefined
            ? (request as any).rawBody
            : (typeof request.body === 'string' ? request.body : JSON.stringify(request.body));

        if (config.SEPAY_WEBHOOK_SECRET) {
            // Secret configured: enforce HMAC-SHA256 signature verification
            const hmacResult = verifyHmacSignature(sigHeader, tsHeader, rawBody, config.SEPAY_WEBHOOK_SECRET);
            if (!hmacResult.valid) {
                console.warn(`[SePay Webhook] HMAC verification failed: ${hmacResult.reason}`);
                return reply.status(401).send({ error: 'UNAUTHORIZED_SIGNATURE', reason: hmacResult.reason });
            }
        } else if (config.SEPAY_API_KEY) {
            // Fallback to API Key if no webhook secret configured
            if (!verifyApiKey(authHeader, config.SEPAY_API_KEY)) {
                console.warn('[SePay Webhook] Unauthorized attempt with invalid or missing API key.');
                return reply.status(401).send({ error: 'UNAUTHORIZED_API_KEY' });
            }
        }

        const payload = (request.body as SePayWebhookPayload) || {};

        // 3. Dispatch to BullMQ / async queue and return HTTP 200 immediately (SLA < 5s)
        try {
            const queue = await getBillingWebhookQueue();
            await queue.addJob(payload);
            return reply.status(200).send({ success: true });
        } catch (err: any) {
            console.error('[SePay Webhook] Queue error:', err);
            // Fallback to background direct processing so SePay receives 200 without retrying
            vietQrBillingService.processWebhook(payload).catch(e => {
                console.error('[SePay Webhook] Direct execution fallback error:', e);
            });
            return reply.status(200).send({ success: true });
        }
    };

    app.post('/api/billing/vietqr/webhook', handleWebhookRequest);
    app.post('/api/billing/webhook', handleWebhookRequest);

    // 6. Admin Endpoints
    // 6.1 Simulate / Test Webhook ("Gửi thử" an toàn)
    app.post('/api/billing/admin/simulate-test-webhook', async (request: FastifyRequest, reply: FastifyReply) => {
        const user = await getCurrentUser(request);
        const config = getConfig();

        const isAdmin = user ? await isUserAdmin(user.id) : false;
        if (!config.SEPAY_TEST_MODE && !isAdmin) {
            return reply.status(403).send({ error: 'FORBIDDEN', message: 'Chỉ Admin mới có thể mô phỏng webhook.' });
        }

        const body = (request.body as any) || {};
        const payCode = body.pay_code;
        const amount = Number(body.amount_vnd || 149000);
        const testId = body.id || Math.floor(100000 + Math.random() * 900000);
        const refCode = body.reference_code || `SIM_${Date.now()}`;
        const content = body.content || (payCode ? `CHUYEN TIEN ${payCode}` : 'SIMULATION TEST WITHOUT CODE');

        const testPayload: SePayWebhookPayload = {
            id: testId,
            reference_code: refCode,
            transfer_type: 'in',
            transfer_amount: amount,
            content,
            code: payCode || null,
            gateway: 'MBBank',
            transactionDate: new Date().toISOString(),
        };

        const result = await vietQrBillingService.processWebhook(testPayload);
        return reply.status(200).send({
            success: true,
            simulated_payload: testPayload,
            result,
        });
    });
    app.get('/api/billing/admin/unmatched', async (request: FastifyRequest, reply: FastifyReply) => {
        const user = await getCurrentUser(request);
        if (!user || !(await isUserAdmin(user.id))) {
            return reply.status(403).send({ error: 'FORBIDDEN' });
        }
        const unmatched = await billingStorage.getUnmatchedPayments();
        return { success: true, items: unmatched };
    });

    app.post('/api/billing/admin/unmatched/:id/resolve', async (request: FastifyRequest<{ Params: { id: string }; Body: { status: any; admin_note?: string } }>, reply: FastifyReply) => {
        const user = await getCurrentUser(request);
        if (!user || !(await isUserAdmin(user.id))) {
            return reply.status(403).send({ error: 'FORBIDDEN' });
        }
        const { id } = request.params;
        const body = request.body || {};
        const updated = await billingStorage.resolveUnmatchedPayment(id, body.status, body.admin_note, user.username);
        return { success: true, item: updated };
    });

    app.get('/api/billing/admin/orders', async (request: FastifyRequest<{ Querystring: { status?: string; user_id?: string } }>, reply: FastifyReply) => {
        const user = await getCurrentUser(request);
        if (!user || !(await isUserAdmin(user.id))) {
            return reply.status(403).send({ error: 'FORBIDDEN' });
        }
        const query = request.query || {};
        const orders = await billingStorage.listOrders({ status: query.status, userId: query.user_id });
        return { success: true, orders };
    });
}
