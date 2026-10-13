import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getConfig } from '../config.js';
import { getCurrentUser } from '../auth/session.js';
import { db } from '../database/index.js';
import { billingStorage } from './storage.js';
import { vietQrBillingService } from './vietqrService.js';
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
    // 1. Get available plans
    app.get('/api/billing/plans', async () => {
        const plans = await billingStorage.getPlans();
        return {
            success: true,
            plans,
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

    // 5. SePay Webhook (POST /api/billing/vietqr/webhook)
    app.post('/api/billing/vietqr/webhook', async (request: FastifyRequest, reply: FastifyReply) => {
        const config = getConfig();
        const authHeader = (request.headers.authorization as string) || (request.headers['x-api-key'] as string) || '';

        // Verify API Key
        if (config.SEPAY_API_KEY && !verifyApiKey(authHeader, config.SEPAY_API_KEY)) {
            console.warn('[SePay Webhook] Unauthorized attempt with invalid or missing API key.');
            return reply.status(401).send({ error: 'UNAUTHORIZED' });
        }

        const payload = (request.body as SePayWebhookPayload) || {};

        try {
            await vietQrBillingService.processWebhook(payload);
            // Spec requires exact response within 30s: HTTP 200 {"success": true}
            return reply.status(200).send({ success: true });
        } catch (err) {
            console.error('[SePay Webhook] Error processing webhook:', err);
            // Still return success to prevent infinite bad retry loops from SePay if internal error, or handle gracefully
            return reply.status(200).send({ success: true });
        }
    });

    // Alias: POST /api/billing/webhook
    app.post('/api/billing/webhook', async (request: FastifyRequest, reply: FastifyReply) => {
        const config = getConfig();
        const authHeader = (request.headers.authorization as string) || (request.headers['x-api-key'] as string) || '';

        if (config.SEPAY_API_KEY && !verifyApiKey(authHeader, config.SEPAY_API_KEY)) {
            return reply.status(401).send({ error: 'UNAUTHORIZED' });
        }

        const payload = (request.body as SePayWebhookPayload) || {};
        await vietQrBillingService.processWebhook(payload);
        return reply.status(200).send({ success: true });
    });

    // 6. Admin Endpoints
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
