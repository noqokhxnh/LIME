import { randomBytes } from 'node:crypto';
import { getConfig } from '../config.js';
import { billingStorage } from './storage.js';
import { generateNapasQrString, generateQrImageUrl, getBankBin } from './napas.js';
import { normalizeCycle, resolveCycleEntitlement } from './pricing.js';
import type {
    BillingCycle,
    CreateOrderResponse,
    OrderStatusResponse,
    SePayWebhookPayload,
    Order,
} from './types.js';

export class VietQrBillingService {
    /**
     * Generates a unique pay_code with format PREFIX + 6 alphanumeric characters.
     * E.g. LIME8X2K9Q
     */
    async generateUniquePayCode(prefix: string): Promise<string> {
        const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // Exclude ambiguous 0, 1, I, O
        for (let attempt = 0; attempt < 10; attempt++) {
            const bytes = randomBytes(6);
            let code = prefix.toUpperCase();
            for (let i = 0; i < 6; i++) {
                code += chars[bytes[i] % chars.length];
            }
            const existing = await billingStorage.findOrderByPayCode(code);
            if (!existing) {
                return code;
            }
        }
        // Fallback with timestamp suffix if repeated collisions
        return `${prefix.toUpperCase()}${Date.now().toString(36).slice(-6).toUpperCase()}`;
    }

    /**
     * Creates a new VietQR billing order for a user.
     * Enforces the 1 pending order per user rule.
     *
     * @param cycle `month` (giá tháng) hoặc `year` (trả trọn năm, -20%).
     */
    async createOrder(userId: string, planId: string, cycle: BillingCycle = 'month'): Promise<CreateOrderResponse> {
        const config = getConfig();
        const plan = await billingStorage.getPlanById(planId);
        if (!plan) {
            throw new Error('PLAN_NOT_FOUND');
        }
        if (!plan.is_active) {
            throw new Error('PLAN_INACTIVE');
        }

        const normalizedCycle = normalizeCycle(cycle);
        const entitlement = resolveCycleEntitlement(plan, normalizedCycle);

        const payCode = await this.generateUniquePayCode(config.PAY_CODE_PREFIX || 'LIME');
        const ttlMinutes = config.ORDER_TTL_MINUTES || 15;
        const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();

        // Tạo đơn mới, KHÔNG huỷ các đơn pending/claimed cũ của user:
        // đơn cũ sống tới hết hạn (ORDER_TTL_MINUTES) để user đã kịp quét
        // mã cũ và đang chuyển khoản vẫn được webhook khớp theo pay_code.
        // Đơn hiển thị cho user là đơn mới nhất (findPendingOrderByUserId).
        const order = await billingStorage.createOrder({
            user_id: userId,
            plan_id: plan.id,
            cycle: normalizedCycle,
            amount_vnd: entitlement.amount,
            pay_code: payCode,
            status: 'pending',
            expires_at: expiresAt,
            claimed_at: null,
            paid_at: null,
        });

        const bankBin = config.BANK_BIN || getBankBin(config.BANK_CODE || 'MB');
        const qrContent = generateNapasQrString({
            bankBin,
            bankAccount: config.BANK_ACCOUNT || '0982618707',
            amount: entitlement.amount,
            memo: payCode,
        });

        const qrImage = generateQrImageUrl({
            bankCode: config.BANK_CODE || 'MB',
            bankAccount: config.BANK_ACCOUNT || '0982618707',
            amount: entitlement.amount,
            memo: payCode,
            accountName: config.BANK_ACCOUNT_NAME,
        });

        return {
            order_id: order.id,
            pay_code: payCode,
            cycle: normalizedCycle,
            amount_vnd: entitlement.amount,
            qr_content: qrContent,
            qr_image: qrImage,
            expires_at: expiresAt,
            bank_account: config.BANK_ACCOUNT || '0982618707',
            bank_code: config.BANK_CODE || 'MB',
            bank_name: config.BANK_NAME || 'MBBank',
        };
    }

    /**
     * Gets order status for polling.
     */
    async getOrderStatus(orderId: string, userId: string, isAdmin = false): Promise<OrderStatusResponse> {
        const order = await billingStorage.findOrderById(orderId);
        if (!order) {
            throw new Error('ORDER_NOT_FOUND');
        }
        if (!isAdmin && order.user_id !== userId) {
            throw new Error('FORBIDDEN');
        }

        const planExpiresAt = await billingStorage.getUserPlanExpiry(order.user_id);

        return {
            status: order.status,
            cycle: normalizeCycle(order.cycle),
            amount_vnd: order.amount_vnd,
            pay_code: order.pay_code,
            expires_at: order.expires_at,
            claimed_at: order.claimed_at,
            paid_at: order.paid_at,
            plan_expires_at: planExpiresAt,
        };
    }

    /**
     * Handles "Tôi đã chuyển khoản" button.
     * Transitions pending order to claimed and extends expiry by CLAIMED_EXTEND_MINUTES (30 mins).
     * Maximum 1 extension per order.
     */
    async claimOrder(orderId: string, userId: string): Promise<{ success: boolean; status: string; expires_at: string }> {
        const config = getConfig();
        const order = await billingStorage.findOrderById(orderId);
        if (!order) {
            throw new Error('ORDER_NOT_FOUND');
        }
        if (order.user_id !== userId) {
            throw new Error('FORBIDDEN');
        }

        // Đơn đã quá hạn (kể cả claimed đã hết gia hạn) thì nút "tôi đã
        // chuyển khoản" không hồi sinh được nữa: tiền về muộn đi đường
        // unmatched cho admin duyệt, tránh claim kéo dài hạn vô hạn.
        if (
            (order.status === 'pending' || order.status === 'claimed') &&
            new Date(order.expires_at).getTime() <= Date.now()
        ) {
            throw new Error('ORDER_EXPIRED');
        }

        if (order.status === 'claimed') {
            return {
                success: true,
                status: 'claimed',
                expires_at: order.expires_at,
            };
        }

        if (order.status !== 'pending') {
            throw new Error(`CANNOT_CLAIM_STATUS_${order.status.toUpperCase()}`);
        }

        const claimedAt = new Date().toISOString();
        const extendMinutes = config.CLAIMED_EXTEND_MINUTES || 30;
        const newExpiresAt = new Date(Date.now() + extendMinutes * 60 * 1000).toISOString();

        const updated = await billingStorage.updateOrderClaimed(orderId, claimedAt, newExpiresAt);
        if (!updated) {
            throw new Error('ORDER_UPDATE_FAILED');
        }

        return {
            success: true,
            status: 'claimed',
            expires_at: newExpiresAt,
        };
    }

    /**
     * Normalizes transaction memo and extracts the pay_code.
     * Robust against null code, spaces, hyphens, and surrounding bank noise.
     */
    extractPayCode(payload: SePayWebhookPayload, prefix: string): string | null {
        const normalizedPrefix = prefix.toUpperCase();

        // 1. Try payload.code first if present and matches prefix
        if (payload.code && typeof payload.code === 'string') {
            const cleanCode = payload.code.trim().toUpperCase().replace(/[\s\-_]+/g, '');
            if (cleanCode.startsWith(normalizedPrefix) && cleanCode.length >= normalizedPrefix.length + 6) {
                return normalizedPrefix + cleanCode.slice(normalizedPrefix.length, normalizedPrefix.length + 6);
            }
        }

        // 2. Fallback to raw content / description when code is null, missing, or mismatched
        const rawContent = (payload.content || payload.description || '').toString();
        if (!rawContent) return null;

        // Strip Vietnamese accents, convert to uppercase
        const normalized = rawContent
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .toUpperCase();

        // Pattern: PREFIX optionally followed by whitespace, dash, or underscore and 6 alphanumeric characters
        const regex = new RegExp(`(?:^|[^A-Z0-9])(${normalizedPrefix})[\\s\\-_]*([A-Z0-9]{6})(?:[^A-Z0-9]|$)`, 'i');
        const match = normalized.match(regex);
        if (match && match[2]) {
            return `${normalizedPrefix}${match[2].toUpperCase()}`;
        }

        // Broad fallback: strip all non-alphanumeric chars and search for PREFIX + 6 chars
        const cleaned = normalized.replace(/[^A-Z0-9]/g, '');
        const broadRegex = new RegExp(`(${normalizedPrefix})([A-Z0-9]{6})`, 'i');
        const broadMatch = cleaned.match(broadRegex);
        if (broadMatch && broadMatch[2]) {
            return `${normalizedPrefix}${broadMatch[2].toUpperCase()}`;
        }

        return null;
    }

    /**
     * Processes SePay incoming webhook transaction.
     * Guarantees 3-layer idempotency (keyed on SePay transaction ID) and exact reconciliation.
     */
    async processWebhook(payload: SePayWebhookPayload): Promise<{ success: boolean; result?: string; reason?: string }> {
        const config = getConfig();

        // 1. Filter transfer_type: only process money in ("in")
        const transferType = (payload.transferType || payload.transfer_type || 'in').toString().toLowerCase();
        if (transferType !== 'in') {
            return { success: true, result: 'ignored_transfer_out' };
        }

        // 2. Primary idempotency key: MUST be payload.id (SePay transaction id).
        // Official SePay docs note referenceCode may be empty with some banks, so using referenceCode
        // would cause two different transactions to collide.
        const rawId = (payload.id !== undefined && payload.id !== null && String(payload.id).trim() !== '')
            ? String(payload.id).trim()
            : (payload.referenceCode || payload.reference_code ? String(payload.referenceCode || payload.reference_code).trim() : null);

        if (!rawId) {
            return { success: false, reason: 'MISSING_TRANSACTION_ID' };
        }
        const sepayRef = rawId;

        // 3. Layer 1 Idempotency Check: if SePay transaction ID already exists, do nothing.
        // Dùng finder NGHIÊM NGẶT theo cột sepay_ref: finder cũ OR-match cả raw
        // referenceCode của bản ghi khác — một giao dịch có referenceCode trùng
        // id của giao dịch này sẽ bị nhận nhầm là trùng lặp và bị bỏ qua
        // (mất tiền nạp). referenceCode chỉ là fallback khi payload thiếu id.
        const existingPayment = await billingStorage.findPaymentBySepayId(sepayRef);
        if (existingPayment) {
            return { success: true, result: 'idempotent_duplicate_ref' };
        }
        const existingUnmatched = await billingStorage.findUnmatchedPaymentBySepayId(sepayRef);
        if (existingUnmatched) {
            return { success: true, result: 'idempotent_duplicate_unmatched_ref' };
        }

        // 4. Extract amount
        const amount = Number(payload.transferAmount || payload.transfer_amount || payload.amount_in || 0);

        // Số tiền phải hữu hạn và > 0: NaN làm mọi phép so sánh thành false
        // và trượt thẳng xuống nhánh "đủ tiền" — gói bị kích hoạt bởi một
        // giao dịch không có số tiền thật. Ghi unmatched để admin đối soát
        // thay vì cho khớp đơn.
        if (!Number.isFinite(amount) || amount <= 0) {
            await billingStorage.recordUnmatchedPayment({
                sepay_ref: sepayRef,
                amount_vnd: 0,
                content: (payload.content || payload.description || '').toString(),
                raw: payload,
                status: 'pending',
                admin_note: 'Số tiền giao dịch không hợp lệ (thiếu/NaN/không dương)',
            });
            return { success: true, result: 'unmatched_invalid_amount' };
        }

        // 5. Extract pay_code
        const prefix = config.PAY_CODE_PREFIX || 'LIME';
        const payCode = this.extractPayCode(payload, prefix);
        const rawContent = (payload.content || payload.description || '').toString();

        if (!payCode) {
            // Unmatched case: missing or unparseable pay_code
            await billingStorage.recordUnmatchedPayment({
                sepay_ref: sepayRef,
                amount_vnd: amount,
                content: rawContent,
                raw: payload,
                status: 'pending',
                admin_note: 'Không tìm thấy pay_code trong nội dung chuyển khoản',
            });
            return { success: true, result: 'unmatched_no_code' };
        }

        // 6. Look up order by pay_code
        const order = await billingStorage.findOrderByPayCode(payCode);
        if (!order) {
            // Unmatched case: pay_code does not match any order
            await billingStorage.recordUnmatchedPayment({
                sepay_ref: sepayRef,
                amount_vnd: amount,
                content: rawContent,
                raw: payload,
                status: 'pending',
                admin_note: `Không tìm thấy order cho mã ${payCode}`,
            });
            return { success: true, result: 'unmatched_order_not_found' };
        }

        // 7. Check order status
        if (order.status === 'paid') {
            // Case 8.1: Duplicate transfer on already paid order
            await billingStorage.recordDuplicatePayment({
                orderId: order.id,
                sepayRef,
                amount,
                raw: payload,
            });
            return { success: true, result: 'duplicate_paid_order' };
        }

        if (order.status === 'expired' || order.status === 'cancelled') {
            // Payment arrived after order expired or was cancelled
            await billingStorage.recordUnmatchedPayment({
                sepay_ref: sepayRef,
                amount_vnd: amount,
                content: rawContent,
                raw: payload,
                status: 'pending',
                admin_note: `Thanh toán cho order đã ${order.status} (${order.id})`,
            });
            return { success: true, result: `unmatched_order_${order.status}` };
        }

        // Đơn còn ghi pending/claimed nhưng hạn thanh toán đã qua (cron
        // chưa kịp lật sang 'expired'): tiền về muộn đi đường unmatched
        // cho admin duyệt tay, không tự kích hoạt gói.
        if (new Date(order.expires_at).getTime() <= Date.now()) {
            await billingStorage.recordUnmatchedPayment({
                sepay_ref: sepayRef,
                amount_vnd: amount,
                content: rawContent,
                raw: payload,
                status: 'pending',
                admin_note: `Thanh toán cho order đã hết hạn (${order.id})`,
            });
            return { success: true, result: 'unmatched_order_expired' };
        }

        // Order is pending or claimed
        if (amount < order.amount_vnd) {
            // Case 8.2: Underpaid transfer
            await billingStorage.recordUnderpaidPayment({
                orderId: order.id,
                sepayRef,
                amount,
                raw: payload,
            });
            return { success: true, result: 'underpaid' };
        }

        // Matched or Overpaid transfer (amount >= order.amount_vnd)
        const plan = await billingStorage.getPlanById(order.plan_id);
        // Quyền lợi chốt theo chu kỳ của đơn (gói năm: 365 ngày, quota × 12),
        // không phải theo giá tháng hiện tại của gói.
        const entitlement = plan
            ? resolveCycleEntitlement(plan, normalizeCycle(order.cycle))
            : { amount: order.amount_vnd, days: 30, quota: 0 };
        const planDays = entitlement.days;
        const quotaVideo = entitlement.quota;
        const paymentResult = amount > order.amount_vnd ? 'overpaid' : 'matched';

        const fulfillRes = await billingStorage.lockAndFulfillOrder({
            orderId: order.id,
            sepayRef,
            receivedAmount: amount,
            raw: payload,
            planDays,
            quotaVideo,
            planId: order.plan_id,
            result: paymentResult,
        });

        if (!fulfillRes.success) {
            if (fulfillRes.reason === 'ALREADY_PAID') {
                await billingStorage.recordDuplicatePayment({
                    orderId: order.id,
                    sepayRef,
                    amount,
                    raw: payload,
                });
                return { success: true, result: 'duplicate_concurrent' };
            }
            throw new Error(`FULFILL_FAILED_${fulfillRes.reason}`);
        }

        return {
            success: true,
            result: paymentResult,
        };
    }
}

export const vietQrBillingService = new VietQrBillingService();
