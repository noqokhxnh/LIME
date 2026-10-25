import { getConfig } from '../config.js';
import { vietQrBillingService } from './vietqrService.js';
import { billingStorage } from './storage.js';

export interface SePayApiTransaction {
    id: number | string;
    bank_brand_name?: string;
    account_number?: string;
    transaction_date?: string;
    amount_out?: string | number;
    amount_in?: string | number;
    accumulated?: string | number;
    transaction_content?: string;
    reference_number?: string;
    code?: string;
    sub_account?: string;
}

export interface SePayTransactionsApiResponse {
    status: number;
    messages?: {
        success?: boolean;
    };
    transactions?: SePayApiTransaction[];
}

export async function syncSepayTransactions(): Promise<{ processed: number; matched: number; skipped: number; errors: number }> {
    const config = getConfig();
    if (!config.SEPAY_API_KEY) {
        return { processed: 0, matched: 0, skipped: 0, errors: 0 };
    }

    try {
        const url = 'https://my.sepay.vn/userapi/transactions/list?limit=50';
        const res = await fetch(url, {
            headers: {
                Authorization: `Apikey ${config.SEPAY_API_KEY}`,
                'Content-Type': 'application/json',
            },
        });

        if (!res.ok) {
            console.warn(`[SePay Reconciler] API returned status ${res.status}`);
            return { processed: 0, matched: 0, skipped: 0, errors: 1 };
        }

        const data = (await res.json()) as SePayTransactionsApiResponse;
        const list = data.transactions || [];

        let processed = 0;
        let matched = 0;
        let skipped = 0;
        let errors = 0;

        for (const tx of list) {
            const amountIn = Number(tx.amount_in || 0);
            if (amountIn <= 0) {
                // Outgoing transfer
                continue;
            }

            const sepayId = (tx.id !== undefined && tx.id !== null) ? String(tx.id).trim() : String(tx.reference_number || '').trim();
            if (!sepayId) continue;
            const bankRef = tx.reference_number ? String(tx.reference_number).trim() : '';

            // Check if already processed — khớp nghiêm ngặt theo khoá đã lưu
            // (sepay_ref), tránh nhận nhầm qua raw referenceCode của bản ghi khác.
            const existingPayment = await billingStorage.findPaymentBySepayId(sepayId);
            const existingUnmatched = await billingStorage.findUnmatchedPaymentBySepayId(sepayId);
            if (existingPayment || existingUnmatched) {
                skipped++;
                continue;
            }

            // Map SePay API format to Webhook format
            const payload = {
                id: tx.id,
                reference_code: bankRef,
                referenceCode: bankRef,
                transfer_type: 'in',
                transfer_amount: amountIn,
                amount_in: amountIn,
                content: tx.transaction_content,
                code: tx.code,
                accountNumber: tx.account_number,
                transactionDate: tx.transaction_date,
            };

            try {
                const result = await vietQrBillingService.processWebhook(payload);
                processed++;
                if (result.result === 'matched' || result.result === 'overpaid') {
                    matched++;
                }
            } catch (err) {
                console.error(`[SePay Reconciler] Error processing transaction ${sepayId}:`, err);
                errors++;
            }
        }

        return { processed, matched, skipped, errors };
    } catch (err) {
        console.error('[SePay Reconciler] Network or fetch error:', err);
        return { processed: 0, matched: 0, skipped: 0, errors: 1 };
    }
}
