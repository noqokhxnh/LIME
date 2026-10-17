export interface Plan {
    id: string;
    name: string;
    price_vnd: number;
    quota_video: number;
    days: number;
    is_active: boolean;
    created_at?: string;
}

export type OrderStatus = 'pending' | 'claimed' | 'paid' | 'expired' | 'cancelled';

export interface Order {
    id: string;
    user_id: string;
    plan_id: string;
    amount_vnd: number;
    pay_code: string;
    status: OrderStatus;
    expires_at: string;
    claimed_at?: string | null;
    paid_at?: string | null;
    created_at: string;
}

/**
 * Bộ lọc + phân trang cho danh sách đơn hàng ở cổng quản trị.
 *
 * `search` khớp theo mã đơn (pay_code), ID đơn, ID người dùng và (khi có DB)
 * cả email người dùng. `page`/`limit` dùng để phân trang phía server.
 */
export interface AdminOrderQuery {
    status?: string;
    search?: string;
    page?: number;
    limit?: number;
}

/** Kết quả phân trang của danh sách đơn hàng dành cho admin. */
export interface AdminOrderPage {
    orders: Order[];
    total: number;
}

export type PaymentResult = 'matched' | 'duplicate' | 'underpaid' | 'overpaid' | 'unmatched';

export interface Payment {
    id: string;
    order_id?: string | null;
    sepay_ref: string;
    amount_vnd: number;
    raw: any;
    received_at: string;
    result: PaymentResult;
}

export type UnmatchedPaymentStatus = 'pending' | 'resolved' | 'refunded';

export interface UnmatchedPayment {
    id: string;
    sepay_ref: string;
    amount_vnd: number;
    content: string;
    raw: any;
    status: UnmatchedPaymentStatus;
    admin_note?: string | null;
    resolved_by?: string | null;
    resolved_at?: string | null;
    created_at: string;
}

export interface SePayWebhookPayload {
    id?: number | string;
    gateway?: string;
    transactionDate?: string;
    accountNumber?: string;
    subAccount?: string;
    transferType?: string;
    transfer_type?: string;
    transferAmount?: number | string;
    transfer_amount?: number | string;
    amount_in?: number | string;
    accumulated?: number | string;
    code?: string | null;
    content?: string;
    referenceCode?: string | null;
    reference_code?: string | null;
    description?: string;
    [key: string]: any;
}

export interface SimulateWebhookRequest {
    pay_code?: string;
    order_id?: string;
    amount_vnd?: number;
    content?: string;
    reference_code?: string;
    id?: number | string;
    auth_type?: 'hmac' | 'apikey' | 'none';
}

export interface CreateOrderRequest {
    plan_id: string;
}

export interface CreateOrderResponse {
    order_id: string;
    pay_code: string;
    amount_vnd: number;
    qr_content: string;
    qr_image: string;
    expires_at: string;
    bank_account: string;
    bank_code: string;
    bank_name: string;
}

export interface OrderStatusResponse {
    status: OrderStatus;
    amount_vnd: number;
    pay_code: string;
    expires_at: string;
    claimed_at?: string | null;
    paid_at?: string | null;
    plan_expires_at?: string | null;
}

export type RefundSourceType = 'unmatched' | 'duplicate';

export interface Refund {
    id: string;
    source_type: RefundSourceType;
    source_id: string;
    sepay_ref: string;
    amount_vnd: number;
    bank_account: string;
    bank_name: string;
    admin_note?: string | null;
    refunded_by?: string | null;
    refunded_at: string;
    created_at: string;
}
