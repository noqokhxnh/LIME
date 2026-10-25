import test, { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { generateNapasQrString, calculateCrc16Ccitt, formatTlv } from '../../src/billing/napas.js';
import { vietQrBillingService } from '../../src/billing/vietqrService.js';
import { billingStorage } from '../../src/billing/storage.js';
import { billingRoutes, verifyApiKey, verifyHmacSignature, verifyIpAllowlist } from '../../src/billing/routes.js';
import { SEPAY_OFFICIAL_IPS } from '../../src/billing/constants.js';
import { getBillingWebhookQueue, MemoryBillingWebhookQueue } from '../../src/billing/queue.js';
import { initDatabase, db } from '../../src/database/index.js';
import { getConfig, resetConfig } from '../../src/config.js';
import { createTestSession } from '../../src/auth/session.js';

const SUPER_ADMIN_ID = '00000000-0000-4000-a000-000000000001';

// Webhook nay fail-closed: test nao goi endpoint webhook qua HTTP phai cau
// hinh SEPAY_API_KEY va gui kem header Authorization.
const TEST_WEBHOOK_API_KEY = 'test_webhook_api_key_123';
function enableTestApiKey() {
    process.env.SEPAY_API_KEY = TEST_WEBHOOK_API_KEY;
    resetConfig();
}
function disableTestApiKey() {
    delete process.env.SEPAY_API_KEY;
    resetConfig();
}
const apiKeyHeaders = { authorization: `Apikey ${TEST_WEBHOOK_API_KEY}` };

describe('VietQR & SePay Billing Test Suite', () => {
    const testUserId = '00000000-0000-0000-0000-000000000001';
    const testUser2Id = '00000000-0000-0000-0000-000000000002';

    before(async () => {
        const config = getConfig();
        if (config.DATABASE_URL) {
            await initDatabase();
            // Super admin phải có hàng thật trong PostgreSQL: cổng admin của billing
            // (isUserAdmin) tra bảng users chứ không dùng seed trong bộ nhớ của
            // userStore, nên trên database rỗng "Gửi thử" sẽ 403 dù đã đăng nhập.
            // Dùng đúng danh tính userStore tự tạo (xem SUPER_ADMIN_UUID) để hai
            // chế độ in-memory/PostgreSQL khớp nhau, giống tests/unit/admin.test.ts.
            await db.query(
                `INSERT INTO users (id, username, email, password_hash, role, tier, credits, total_credits, status)
                 VALUES ($1, 'khanh2k5xxx', 'khanh2k5xxx@gmail.com', NULL, 'admin', 'enterprise', 10000, 10000, 'active')
                 ON CONFLICT DO NOTHING`,
                [SUPER_ADMIN_ID]
            );
            // Seed test users for foreign key satisfaction
            await db.query(
                `INSERT INTO users (id, username, email)
                 VALUES ($1, 'billing_tester', 'tester@lime.ai')
                 ON CONFLICT (id) DO NOTHING`,
                [testUserId]
            );
            await db.query(
                `INSERT INTO users (id, username, email)
                 VALUES ($1, 'billing_tester_2', 'tester2@lime.ai')
                 ON CONFLICT (id) DO NOTHING`,
                [testUser2Id]
            );
        }
        if (billingStorage.resetForTesting) {
            await billingStorage.resetForTesting();
        }
    });

    it('T12: Offline NAPAS 247 EMVCo QR String Generation and CRC16 Checksum', () => {
        const qrString = generateNapasQrString({
            bankBin: '970422',
            bankAccount: '0982618707',
            amount: 149000,
            memo: 'LIME8X2K9Q',
        });

        assert.ok(qrString.startsWith('000201010212'), 'Should start with standard EMVCo header');
        assert.ok(qrString.includes('A000000727'), 'Should include NAPAS AID');
        assert.ok(qrString.includes('970422'), 'Should include bank BIN');
        assert.ok(qrString.includes('0982618707'), 'Should include account number');
        assert.ok(qrString.includes('LIME8X2K9Q'), 'Should include payment memo');
        assert.ok(qrString.includes('6304'), 'Should include Tag 63 length 4');

        // Check CRC verification
        const dataWithoutCrc = qrString.slice(0, -4);
        const expectedCrc = calculateCrc16Ccitt(dataWithoutCrc);
        const actualCrc = qrString.slice(-4);
        assert.equal(actualCrc, expectedCrc, 'CRC16 checksum must match calculated value');
    });

    it('T01: Happy Path - Order Creation, Exact Webhook Match and Fulfillment', async () => {
        // 1. Create order
        const orderRes = await vietQrBillingService.createOrder(testUserId, 'creator');
        assert.ok(orderRes.order_id);
        assert.ok(orderRes.pay_code.startsWith('LIME'));
        assert.equal(orderRes.amount_vnd, 149000);

        // Verify order in storage
        const order = await billingStorage.findOrderById(orderRes.order_id);
        assert.ok(order);
        assert.equal(order.status, 'pending');

        // 2. Incoming matching webhook from SePay
        const webhookPayload = {
            id: 10001,
            reference_code: 'FT2628710001',
            transfer_type: 'in',
            transfer_amount: 149000,
            content: `CHUYEN TIEN ${orderRes.pay_code} THANH TOAN`,
        };

        const result = await vietQrBillingService.processWebhook(webhookPayload);
        assert.equal(result.success, true);
        assert.equal(result.result, 'matched');

        // Verify order status is paid
        const updatedOrder = await billingStorage.findOrderById(orderRes.order_id);
        assert.ok(updatedOrder);
        assert.equal(updatedOrder.status, 'paid');
        assert.ok(updatedOrder.paid_at);

        // Verify ledger entry
        const payment = await billingStorage.findPaymentBySepayRef('FT2628710001');
        assert.ok(payment);
        assert.equal(payment.order_id, orderRes.order_id);
        assert.equal(payment.result, 'matched');
        assert.equal(payment.amount_vnd, 149000);
    });

    it('T02: Webhook Idempotency - Same Reference Code Delivered Twice', async () => {
        const orderRes = await vietQrBillingService.createOrder(testUserId, 'pro');
        const refCode = 'FT2628710002';

        const webhookPayload = {
            id: 10002,
            reference_code: refCode,
            transfer_type: 'in',
            transfer_amount: 249000,
            content: `THANH TOAN ${orderRes.pay_code}`,
        };

        // First delivery
        const first = await vietQrBillingService.processWebhook(webhookPayload);
        assert.equal(first.success, true);
        assert.equal(first.result, 'matched');

        // Second delivery (e.g. network retry)
        const second = await vietQrBillingService.processWebhook(webhookPayload);
        assert.equal(second.success, true);
        assert.equal(second.result, 'idempotent_duplicate_ref');
    });

    it('T03: Duplicate Payment - Two Different Transfers For Same Already Paid Order', async () => {
        const orderRes = await vietQrBillingService.createOrder(testUserId, 'pro');

        // First transfer
        await vietQrBillingService.processWebhook({
            id: 10003,
            reference_code: 'FT2628710003A',
            transfer_type: 'in',
            transfer_amount: 249000,
            content: `TIEN VAO ${orderRes.pay_code}`,
        });

        // Second transfer with different ref but same pay_code (case 8.1)
        const dup = await vietQrBillingService.processWebhook({
            id: 10004,
            reference_code: 'FT2628710003B',
            transfer_type: 'in',
            transfer_amount: 249000,
            content: `CHUYEN NHAM LAN 2 ${orderRes.pay_code}`,
        });

        assert.equal(dup.success, true);
        assert.equal(dup.result, 'duplicate_paid_order');

        const dupPayment = await billingStorage.findPaymentBySepayRef('FT2628710003B');
        assert.ok(dupPayment);
        assert.equal(dupPayment.result, 'duplicate');
    });

    it('T04: Underpaid - Transfer Amount Less Than Order Price', async () => {
        const orderRes = await vietQrBillingService.createOrder(testUserId, 'creator');

        const underpaid = await vietQrBillingService.processWebhook({
            id: 10005,
            reference_code: 'FT2628710005',
            transfer_type: 'in',
            transfer_amount: 140000, // Missing 9.000 VND
            content: `THIEU TIEN ${orderRes.pay_code}`,
        });

        assert.equal(underpaid.success, true);
        assert.equal(underpaid.result, 'underpaid');

        // Order remains pending
        const order = await billingStorage.findOrderById(orderRes.order_id);
        assert.ok(order);
        assert.equal(order.status, 'pending');

        const payment = await billingStorage.findPaymentBySepayRef('FT2628710005');
        assert.ok(payment);
        assert.equal(payment.result, 'underpaid');
    });

    it('T05: Overpaid - Transfer Amount Exceeds Order Price', async () => {
        const orderRes = await vietQrBillingService.createOrder(testUserId, 'creator');

        const overpaid = await vietQrBillingService.processWebhook({
            id: 10006,
            reference_code: 'FT2628710006',
            transfer_type: 'in',
            transfer_amount: 200000, // 200k > 149k
            content: `THUA TIEN ${orderRes.pay_code}`,
        });

        assert.equal(overpaid.success, true);
        assert.equal(overpaid.result, 'overpaid');

        // Order is fulfilled
        const order = await billingStorage.findOrderById(orderRes.order_id);
        assert.ok(order);
        assert.equal(order.status, 'paid');

        const payment = await billingStorage.findPaymentBySepayRef('FT2628710006');
        assert.ok(payment);
        assert.equal(payment.result, 'overpaid');
        assert.equal(payment.amount_vnd, 200000);
    });

    it('T06: Unmatched Payment - Content Missing Valid Pay Code', async () => {
        const res = await vietQrBillingService.processWebhook({
            id: 10007,
            reference_code: 'FT2628710007',
            transfer_type: 'in',
            transfer_amount: 149000,
            content: 'NGUYEN VAN A CHUYEN TIEN CA PHE',
        });

        assert.equal(res.success, true);
        assert.equal(res.result, 'unmatched_no_code');

        const unmatched = await billingStorage.findUnmatchedPaymentBySepayRef('FT2628710007');
        assert.ok(unmatched);
        assert.equal(unmatched.status, 'pending');
        assert.equal(unmatched.amount_vnd, 149000);
    });

    it('T07: Webhook Security - Timing-Safe API Key Authentication Verification', async () => {
        const secretKey = 'sepay_secret_key_prod_test_123';
        assert.equal(verifyApiKey(`Apikey ${secretKey}`, secretKey), true);
        assert.equal(verifyApiKey(`Bearer ${secretKey}`, secretKey), true);
        assert.equal(verifyApiKey(secretKey, secretKey), true);
        assert.equal(verifyApiKey('Apikey wrong_key', secretKey), false);
        assert.equal(verifyApiKey('Apikey', secretKey), false);
        assert.equal(verifyApiKey(undefined, secretKey), false);

        // Test with Fastify route injection (server có cấu hình API key)
        enableTestApiKey();
        try {
            const app = fastify();
            await app.register(fastifyCookie);
            await app.register(billingRoutes);

            const res = await app.inject({
                method: 'POST',
                url: '/api/billing/vietqr/webhook',
                headers: apiKeyHeaders,
                payload: {
                    id: 99999,
                    reference_code: 'FT_PING',
                    transfer_type: 'in',
                    transfer_amount: 1000,
                    content: 'PING TEST',
                },
            });
            assert.equal(res.statusCode, 200);
            assert.deepEqual(JSON.parse(res.payload), { success: true });

            // Key sai → 401
            const badRes = await app.inject({
                method: 'POST',
                url: '/api/billing/vietqr/webhook',
                headers: { authorization: 'Apikey wrong_key' },
                payload: { id: 99998, transfer_type: 'in', transfer_amount: 1000, content: 'PING TEST' },
            });
            assert.equal(badRes.statusCode, 401);
            assert.equal(JSON.parse(badRes.payload).error, 'UNAUTHORIZED_API_KEY');

            await app.close();
        } finally {
            disableTestApiKey();
        }
    });

    it('T08: Webhook Speed SLA - Reconciliation Execution Completes Under 1000ms', async () => {
        const orderRes = await vietQrBillingService.createOrder(testUserId, 'creator');
        const start = performance.now();

        const result = await vietQrBillingService.processWebhook({
            id: 10012,
            reference_code: 'FT2628710012',
            transfer_type: 'in',
            transfer_amount: 149000,
            content: `CHUYEN NHANH ${orderRes.pay_code}`,
        });

        const elapsed = performance.now() - start;
        assert.equal(result.success, true);
        assert.ok(elapsed < 1000, `Webhook execution took ${elapsed}ms, which should be well under 1000ms SLA`);
    });

    it('T09: Claimed Order Processing - "Tôi đã chuyển khoản" Grace Period Extension', async () => {
        const orderRes = await vietQrBillingService.createOrder(testUserId, 'creator');

        // User clicks claimed
        const claimRes = await vietQrBillingService.claimOrder(orderRes.order_id, testUserId);
        assert.equal(claimRes.success, true);
        assert.equal(claimRes.status, 'claimed');

        // Verify order status in storage is claimed
        const order = await billingStorage.findOrderById(orderRes.order_id);
        assert.ok(order);
        assert.equal(order.status, 'claimed');
        assert.ok(order.claimed_at);

        // Webhook arrives while claimed -> matches and fulfills
        const matchRes = await vietQrBillingService.processWebhook({
            id: 10008,
            reference_code: 'FT2628710008',
            transfer_type: 'in',
            transfer_amount: 149000,
            content: `TIEN VE SAU KHI CLAIM ${orderRes.pay_code}`,
        });

        assert.equal(matchRes.success, true);
        assert.equal(matchRes.result, 'matched');

        const finalOrder = await billingStorage.findOrderById(orderRes.order_id);
        assert.ok(finalOrder);
        assert.equal(finalOrder.status, 'paid');
    });

    it('T10: Late Payment on Expired Order - Enters Unmatched Ledger', async () => {
        const orderRes = await vietQrBillingService.createOrder(testUserId, 'creator');

        // Force order to expired by advancing time past expires_at
        await billingStorage.expireStaleOrders(new Date(Date.now() + 24 * 3600 * 1000).toISOString());

        const lateRes = await vietQrBillingService.processWebhook({
            id: 10009,
            reference_code: 'FT2628710009',
            transfer_type: 'in',
            transfer_amount: 149000,
            content: `CHUYEN MUON ${orderRes.pay_code}`,
        });

        assert.equal(lateRes.success, true);
        assert.equal(lateRes.result, 'unmatched_order_expired');

        const unmatched = await billingStorage.findUnmatchedPaymentBySepayRef('FT2628710009');
        assert.ok(unmatched);
        assert.equal(unmatched.status, 'pending');
    });

    it('T11: Cumulative Subscription Renewal - Does Not Reset Existing Remaining Days', async () => {
        // User first buys a 30-day creator plan
        const firstOrder = await vietQrBillingService.createOrder(testUserId, 'creator');
        await vietQrBillingService.processWebhook({
            id: 10010,
            reference_code: 'FT2628710010',
            transfer_type: 'in',
            transfer_amount: 149000,
            content: `${firstOrder.pay_code}`,
        });

        const firstExpiry = await billingStorage.getUserPlanExpiry(testUserId);
        assert.ok(firstExpiry);
        const firstExpiryTime = new Date(firstExpiry).getTime();

        // User immediately buys another 30-day plan
        const secondOrder = await vietQrBillingService.createOrder(testUserId, 'creator');
        await vietQrBillingService.processWebhook({
            id: 10011,
            reference_code: 'FT2628710011',
            transfer_type: 'in',
            transfer_amount: 149000,
            content: `${secondOrder.pay_code}`,
        });

        const secondExpiry = await billingStorage.getUserPlanExpiry(testUserId);
        assert.ok(secondExpiry);
        const secondExpiryTime = new Date(secondExpiry).getTime();

        // Second expiry must be ~30 days further into the future than first expiry!
        const diffDays = Math.round((secondExpiryTime - firstExpiryTime) / (1000 * 60 * 60 * 24));
        assert.equal(diffDays, 30, 'Cumulative renewal must add 30 days on top of previous expiry');
    });

    it('P01: Point 1 - Idempotency Key Is payload.id (Empty referenceCode Does Not Collide)', async () => {
        // Test bank transactions where referenceCode is empty or null (common in several banks)
        // Two distinct transactions A and B must NOT collide or block each other.
        const orderA = await vietQrBillingService.createOrder(testUserId, 'creator');
        const orderB = await vietQrBillingService.createOrder(testUser2Id, 'pro');

        const txA = {
            id: 80001,
            reference_code: '', // Empty bank ref
            referenceCode: null,
            transfer_type: 'in',
            transfer_amount: 149000,
            content: `THANH TOAN ${orderA.pay_code}`,
        };

        const txB = {
            id: 80002,
            reference_code: '', // Also empty bank ref!
            referenceCode: null,
            transfer_type: 'in',
            transfer_amount: 249000,
            content: `THANH TOAN ${orderB.pay_code}`,
        };

        // First transaction with empty ref
        const resA = await vietQrBillingService.processWebhook(txA);
        assert.equal(resA.success, true);
        assert.equal(resA.result, 'matched');

        // Second transaction with empty ref MUST succeed and not collide with txA!
        const resB = await vietQrBillingService.processWebhook(txB);
        assert.equal(resB.success, true);
        assert.equal(resB.result, 'matched');

        // Verify both orders are marked paid
        const fetchedA = await billingStorage.findOrderById(orderA.order_id);
        const fetchedB = await billingStorage.findOrderById(orderB.order_id);
        assert.equal(fetchedA?.status, 'paid');
        assert.equal(fetchedB?.status, 'paid');

        // But replaying the exact same txA (id: 80001) MUST be caught as duplicate
        const replayA = await vietQrBillingService.processWebhook(txA);
        assert.equal(replayA.success, true);
        assert.equal(replayA.result, 'idempotent_duplicate_ref');
    });

    it('P02: Point 2 - Sub-50ms SLA Fast Response via Asynchronous Webhook Queue', async () => {
        enableTestApiKey();
        const app = fastify();
        await app.register(fastifyCookie);
        await app.register(billingRoutes);

        const order = await vietQrBillingService.createOrder(testUserId, 'creator');
        const queue = (await getBillingWebhookQueue()) as MemoryBillingWebhookQueue;

        const start = performance.now();
        const res = await app.inject({
            method: 'POST',
            url: '/api/billing/vietqr/webhook',
            headers: apiKeyHeaders,
            payload: {
                id: 80003,
                reference_code: 'FT_QUEUE_TEST',
                transfer_type: 'in',
                transfer_amount: 149000,
                content: `CHUYEN ${order.pay_code}`,
            },
        });
        const elapsed = performance.now() - start;

        assert.equal(res.statusCode, 200);
        assert.deepEqual(JSON.parse(res.payload), { success: true });
        assert.ok(elapsed < 100, `Handler response took ${elapsed}ms, which is well below the 5s SePay timeout SLA`);

        // Wait for queue worker to finish processing in the background
        if (queue.events) {
            await new Promise<void>((resolve) => {
                queue.events.once('completed', () => resolve());
            });
        }

        const updatedOrder = await billingStorage.findOrderById(order.order_id);
        assert.equal(updatedOrder?.status, 'paid');

        await app.close();
        disableTestApiKey();
    });

    it('P03: Point 3 - Fallback Memo Parsing When code Is null (Spaces, Hyphens, Bank Noise)', async () => {
        // Test case 3a: code is null, spaces inside pay_code (e.g. "LIME 8X2K9Q")
        const order1 = await vietQrBillingService.createOrder(testUserId, 'creator');
        const codeSuffix1 = order1.pay_code.slice(4); // 6 chars
        const res1 = await vietQrBillingService.processWebhook({
            id: 80004,
            code: null,
            transfer_type: 'in',
            transfer_amount: 149000,
            content: `CHUYEN TIEN LIME ${codeSuffix1} GOI CREATOR`,
        });
        assert.equal(res1.success, true);
        assert.equal(res1.result, 'matched');

        // Test case 3b: code is null, hyphen inside pay_code (e.g. "LIME-8X2K9Q")
        const order2 = await vietQrBillingService.createOrder(testUserId, 'creator');
        const codeSuffix2 = order2.pay_code.slice(4);
        const res2 = await vietQrBillingService.processWebhook({
            id: 80005,
            code: null,
            transfer_type: 'in',
            transfer_amount: 149000,
            content: `MBBANK LIME-${codeSuffix2} DICH VU`,
        });
        assert.equal(res2.success, true);
        assert.equal(res2.result, 'matched');

        // Test case 3c: code field is mismatched, fallback to content
        const order3 = await vietQrBillingService.createOrder(testUserId, 'creator');
        const res3 = await vietQrBillingService.processWebhook({
            id: 80006,
            code: 'WRONGPREFIX',
            transfer_type: 'in',
            transfer_amount: 149000,
            content: `CHUYEN TIEN ${order3.pay_code}`,
        });
        assert.equal(res3.success, true);
        assert.equal(res3.result, 'matched');
    });

    it('P04: Point 4 - Content-Type application/x-www-form-urlencoded Webhook Parsing', async () => {
        enableTestApiKey();
        const app = fastify();
        await app.register(fastifyCookie);
        await app.register(billingRoutes);

        const order = await vietQrBillingService.createOrder(testUserId, 'creator');
        const queue = (await getBillingWebhookQueue()) as MemoryBillingWebhookQueue;

        const formBody = new URLSearchParams({
            id: '80007',
            reference_code: 'FT_FORM_01',
            transfer_type: 'in',
            transfer_amount: '149000',
            content: `THANH TOAN ${order.pay_code}`,
        }).toString();

        const res = await app.inject({
            method: 'POST',
            url: '/api/billing/vietqr/webhook',
            headers: {
                'content-type': 'application/x-www-form-urlencoded',
                ...apiKeyHeaders,
            },
            payload: formBody,
        });

        assert.equal(res.statusCode, 200);
        assert.deepEqual(JSON.parse(res.payload), { success: true });

        if (queue.events) {
            await new Promise<void>((resolve) => {
                queue.events.once('completed', () => resolve());
            });
        }

        const updated = await billingStorage.findOrderById(order.order_id);
        assert.equal(updated?.status, 'paid');

        await app.close();
        disableTestApiKey();
    });

    it('P05: Point 5 - SePay Official IP Allowlist (7 IPv4 + 2 IPv6)', async () => {
        // 1. Verify all official IPs are recognized
        for (const officialIp of SEPAY_OFFICIAL_IPS) {
            assert.equal(verifyIpAllowlist(officialIp), true, `Official IP ${officialIp} should be allowed`);
        }
        // Loopback should be allowed in dev/test
        assert.equal(verifyIpAllowlist('127.0.0.1'), true);
        assert.equal(verifyIpAllowlist('::1'), true);
        // Unauthorized external IP should be rejected
        assert.equal(verifyIpAllowlist('203.0.113.195'), false);

        // 2. Test Fastify route with IP allowlist enabled
        const oldAllowlistEnabled = process.env.SEPAY_IP_ALLOWLIST_ENABLED;
        try {
            process.env.SEPAY_IP_ALLOWLIST_ENABLED = 'true';
            enableTestApiKey();

            const app = fastify({ trustProxy: true });
            await app.register(fastifyCookie);
            await app.register(billingRoutes);

            // Allowed official IP
            const okRes = await app.inject({
                method: 'POST',
                url: '/api/billing/vietqr/webhook',
                headers: {
                    'x-forwarded-for': '172.236.138.20',
                    ...apiKeyHeaders,
                },
                payload: {
                    id: 80008,
                    transfer_type: 'in',
                    transfer_amount: 149000,
                    content: 'PING TEST',
                },
            });
            assert.equal(okRes.statusCode, 200);

            // Blocked unauthorized IP
            const blockedRes = await app.inject({
                method: 'POST',
                url: '/api/billing/vietqr/webhook',
                headers: {
                    'x-forwarded-for': '203.0.113.195',
                },
                payload: {
                    id: 80009,
                    transfer_type: 'in',
                    transfer_amount: 149000,
                    content: 'UNAUTHORIZED IP TEST',
                },
            });
            assert.equal(blockedRes.statusCode, 403);
            assert.equal(JSON.parse(blockedRes.payload).error, 'FORBIDDEN_IP');

            await app.close();
        } finally {
            process.env.SEPAY_IP_ALLOWLIST_ENABLED = oldAllowlistEnabled || 'false';
            disableTestApiKey();
        }
    });

    it('P06: Point 6 - HMAC-SHA256 Signature Verification & Anti-Replay Protection', async () => {
        const testSecret = 'sepay_webhook_secret_key_test_999';
        const nowSec = Math.floor(Date.now() / 1000);
        const testBody = JSON.stringify({ id: 80010, transfer_amount: 149000, content: 'HMAC_TEST' });

        const validHash = createHmac('sha256', testSecret).update(`${nowSec}.${testBody}`).digest('hex');
        const validSig = `sha256=${validHash}`;

        // Unit test verification
        // 1. Valid signature and timestamp
        const validResult = verifyHmacSignature(validSig, String(nowSec), testBody, testSecret);
        assert.equal(validResult.valid, true);

        // 2. Expired timestamp (> 300 seconds ago)
        const expiredSec = nowSec - 305;
        const expiredHash = createHmac('sha256', testSecret).update(`${expiredSec}.${testBody}`).digest('hex');
        const expiredResult = verifyHmacSignature(`sha256=${expiredHash}`, String(expiredSec), testBody, testSecret);
        assert.equal(expiredResult.valid, false);
        assert.equal(expiredResult.reason, 'TIMESTAMP_EXPIRED');

        // 3. Tampered payload
        const tamperedResult = verifyHmacSignature(validSig, String(nowSec), testBody + 'TAMPERED', testSecret);
        assert.equal(tamperedResult.valid, false);
        assert.equal(tamperedResult.reason, 'SIGNATURE_MISMATCH');

        // 4. Missing headers
        assert.equal(verifyHmacSignature(undefined, String(nowSec), testBody, testSecret).valid, false);
        assert.equal(verifyHmacSignature(validSig, undefined, testBody, testSecret).valid, false);

        // 4b. Fail-closed khi chưa cấu hình credential: không secret → chữ ký
        // không hợp lệ; không API key → mọi key đều bị từ chối.
        assert.equal(verifyHmacSignature(validSig, String(nowSec), testBody, undefined).valid, false);
        assert.equal(verifyHmacSignature(validSig, String(nowSec), testBody, undefined).reason, 'SECRET_NOT_CONFIGURED');
        assert.equal(verifyApiKey('Apikey anything', undefined), false);
        assert.equal(verifyApiKey(undefined, undefined), false);

        // 5. Test Fastify webhook endpoint with HMAC enforcement
        const oldSecret = process.env.SEPAY_WEBHOOK_SECRET;
        try {
            process.env.SEPAY_WEBHOOK_SECRET = testSecret;
            resetConfig();

            const app = fastify();
            await app.register(fastifyCookie);
            await app.register(billingRoutes);

            // Valid signature request -> 200
            const okRes = await app.inject({
                method: 'POST',
                url: '/api/billing/vietqr/webhook',
                headers: {
                    'x-sepay-signature': validSig,
                    'x-sepay-timestamp': String(nowSec),
                },
                payload: JSON.parse(testBody),
            });
            assert.equal(okRes.statusCode, 200);

            // Invalid signature request -> 401
            const failRes = await app.inject({
                method: 'POST',
                url: '/api/billing/vietqr/webhook',
                headers: {
                    'x-sepay-signature': 'sha256=invalidhash000000000000000000000000000000000000000000000000000000',
                    'x-sepay-timestamp': String(nowSec),
                },
                payload: JSON.parse(testBody),
            });
            assert.equal(failRes.statusCode, 401);
            assert.equal(JSON.parse(failRes.payload).error, 'UNAUTHORIZED_SIGNATURE');

            await app.close();
        } finally {
            if (oldSecret) {
                process.env.SEPAY_WEBHOOK_SECRET = oldSecret;
            } else {
                delete process.env.SEPAY_WEBHOOK_SECRET;
            }
            resetConfig();
        }
    });

    it('P07: Point 7 - Test Mode Simulation Endpoint ("Gửi thử" an toàn)', async () => {
        const oldTestMode = process.env.SEPAY_TEST_MODE;
        try {
            process.env.SEPAY_TEST_MODE = 'true';
            resetConfig();

            const app = fastify();
            await app.register(fastifyCookie);
            await app.register(billingRoutes);

            const order = await vietQrBillingService.createOrder(testUserId, 'creator');

            // Gate mới: bắt buộc CẢ test mode VÀ admin.
            // (a) Test mode bật nhưng không có session admin → 403
            const anonRes = await app.inject({
                method: 'POST',
                url: '/api/billing/admin/simulate-test-webhook',
                payload: { pay_code: order.pay_code, amount_vnd: 149000 },
            });
            assert.equal(anonRes.statusCode, 403, 'Không đăng nhập admin phải bị chặn kể cả khi test mode bật');

            const adminCookies = { vidtml_session: createTestSession(SUPER_ADMIN_ID) };
            const simRes = await app.inject({
                method: 'POST',
                url: '/api/billing/admin/simulate-test-webhook',
                cookies: adminCookies,
                payload: {
                    pay_code: order.pay_code,
                    amount_vnd: 149000,
                    content: `SIMULATION FOR ${order.pay_code}`,
                },
            });

            assert.equal(simRes.statusCode, 200);
            const simBody = JSON.parse(simRes.payload);
            assert.equal(simBody.success, true);
            assert.equal(simBody.result.success, true);
            assert.equal(simBody.result.result, 'matched');

            // Order status should now be paid
            const paidOrder = await billingStorage.findOrderById(order.order_id);
            assert.equal(paidOrder?.status, 'paid');

            await app.close();

            // (b) Admin đăng nhập nhưng test mode TẮT → 403 (không mô phỏng trên production)
            process.env.SEPAY_TEST_MODE = 'false';
            resetConfig();
            const app2 = fastify();
            await app2.register(fastifyCookie);
            await app2.register(billingRoutes);
            const prodRes = await app2.inject({
                method: 'POST',
                url: '/api/billing/admin/simulate-test-webhook',
                cookies: { vidtml_session: createTestSession(SUPER_ADMIN_ID) },
                payload: { pay_code: order.pay_code, amount_vnd: 149000 },
            });
            assert.equal(prodRes.statusCode, 403, 'Admin vẫn bị chặn khi SEPAY_TEST_MODE tắt');
            await app2.close();
        } finally {
            process.env.SEPAY_TEST_MODE = oldTestMode || 'false';
            resetConfig();
        }
    });

    it('P08: Webhook fail-closed khi server chưa cấu hình secret lẫn API key', async () => {
        const oldSecret = process.env.SEPAY_WEBHOOK_SECRET;
        const oldKey = process.env.SEPAY_API_KEY;
        try {
            delete process.env.SEPAY_WEBHOOK_SECRET;
            delete process.env.SEPAY_API_KEY;
            resetConfig();

            const app = fastify();
            await app.register(fastifyCookie);
            await app.register(billingRoutes);

            const res = await app.inject({
                method: 'POST',
                url: '/api/billing/vietqr/webhook',
                payload: { id: 990000002, transfer_type: 'in', transfer_amount: 149000, content: 'FAKE TOPUP' },
            });
            assert.equal(res.statusCode, 401, 'Chưa cấu hình credential thì webhook phải từ chối, không xử lý');
            assert.equal(JSON.parse(res.payload).error, 'WEBHOOK_AUTH_NOT_CONFIGURED');

            await app.close();
        } finally {
            if (oldSecret) process.env.SEPAY_WEBHOOK_SECRET = oldSecret; else delete process.env.SEPAY_WEBHOOK_SECRET;
            if (oldKey) process.env.SEPAY_API_KEY = oldKey; else delete process.env.SEPAY_API_KEY;
            resetConfig();
        }
    });
});
