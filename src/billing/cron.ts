import type { FastifyInstance } from 'fastify';
import { billingStorage } from './storage.js';
import { syncSepayTransactions } from './reconciler.js';

let expireInterval: NodeJS.Timeout | null = null;
let reconcileInterval: NodeJS.Timeout | null = null;

export function startBillingCron(app?: FastifyInstance): void {
    if (expireInterval) return; // Already running

    // 1. Expire stale orders every 1 minute
    expireInterval = setInterval(async () => {
        try {
            const count = await billingStorage.expireStaleOrders();
            if (count > 0) {
                console.log(`[Billing Cron] Expired ${count} stale orders.`);
            }
        } catch (err) {
            console.error('[Billing Cron] Error in expireOrdersJob:', err);
        }
    }, 60 * 1000);

    // 2. SePay transaction reconciliation catch-up every 10 minutes
    reconcileInterval = setInterval(async () => {
        try {
            const res = await syncSepayTransactions();
            if (res.processed > 0) {
                console.log(`[Billing Cron] Reconciled ${res.processed} transactions (${res.matched} matched).`);
            }
        } catch (err) {
            console.error('[Billing Cron] Error in sepayReconcileJob:', err);
        }
    }, 10 * 60 * 1000);

    if (app) {
        app.addHook('onClose', async () => {
            stopBillingCron();
        });
    }

    console.log('[Billing Cron] Background tasks scheduled.');
}

export function stopBillingCron(): void {
    if (expireInterval) {
        clearInterval(expireInterval);
        expireInterval = null;
    }
    if (reconcileInterval) {
        clearInterval(reconcileInterval);
        reconcileInterval = null;
    }
    console.log('[Billing Cron] Background tasks stopped.');
}
