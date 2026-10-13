import test, { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { generateNapasQrString, calculateCrc16Ccitt, formatTlv } from '../../src/billing/napas.js';
import { vietQrBillingService } from '../../src/billing/vietqrService.js';
import { billingStorage } from '../../src/billing/storage.js';
import { billingRoutes, verifyApiKey } from '../../src/billing/routes.js';
import { initDatabase, db } from '../../src/database/index.js';
import { getConfig } from '../../src/config.js';

describe('VietQR & SePay Billing Test Suite', () => {
    const testUserId = '00000000-0000-0000-0000-000000000001';

    before(async () => {
        const config = getConfig();
        if (config.DATABASE_URL) {
            await initDatabase();
            // Seed a test user for foreign key satisfaction
            await db.query(
                `INSERT INTO users (id, username, email)
                 VALUES ($1, 'billing_tester', 'tester@lime.ai')
                 ON CONFLICT (id) DO NOTHING`,
                [testUserId]
            );
            // Clean up test records to ensure idempotent test runs
            await db.query(`DELETE FROM payments WHERE sepay_ref LIKE 'FT262871%'`);
            await db.query(`DELETE FROM unmatched_payments WHERE sepay_ref LIKE 'FT262871%'`);
            await db.query(`DELETE FROM orders WHERE user_id = $1`, [testUserId]);
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

        // Test with Fastify route injection
        const app = fastify();
        await app.register(fastifyCookie);
        await app.register(billingRoutes);

        const res = await app.inject({
            method: 'POST',
            url: '/api/billing/vietqr/webhook',
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
        await app.close();
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
});
