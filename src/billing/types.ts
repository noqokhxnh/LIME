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

/**
 * Chu kỳ thanh toán của đơn:
 *  - `month`: trả theo tháng (đúng giá niêm yết `plans.price_vnd`);
 *  - `year` : trả trọn 12 tháng, hưởng chiết khấu 20% (làm tròn nghìn đồng).
 */
export type BillingCycle = 'month' | 'year';

export interface Order {
    id: string;
    user_id: string;
    plan_id: string;
    cycle: BillingCycle;
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

/**
 * Bộ lọc + phân trang cho danh sách giao dịch chưa khớp đơn (unmatched).
 *
 * `search` khớp mã giao dịch SePay, nội dung chuyển khoản, ghi chú và số tiền.
 * `from`/`to` là ISO timestamp lọc theo `created_at`.
 */
export interface AdminUnmatchedQuery {
    status?: string;
    search?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
}

/** Kết quả phân trang của danh sách giao dịch chưa khớp. */
export interface AdminUnmatchedPage {
    unmatched: UnmatchedPayment[];
    total: number;
}

/**
 * Bộ lọc + phân trang cho danh sách giao dịch trùng lặp (duplicate).
 *
 * `search` khớp mã giao dịch SePay, mã đơn gốc (pay_code) và số tiền.
 * `from`/`to` là ISO timestamp lọc theo `received_at`.
 */
export interface AdminDuplicateQuery {
    search?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
}

/** Kết quả phân trang của danh sách giao dịch trùng lặp. */
export interface AdminDuplicatePage {
    duplicates: Payment[];
    total: number;
}

/**
 * Bộ lọc + phân trang cho lịch sử hoàn tiền thủ công.
 *
 * `search` khớp mã giao dịch SePay, số tài khoản, ngân hàng, người duyệt, ghi chú
 * và số tiền. `from`/`to` là ISO timestamp lọc theo `created_at`.
 */
export interface AdminRefundQuery {
    search?: string;
    /** 'unmatched' | 'duplicate'. */
    sourceType?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
}

/** Kết quả phân trang của lịch sử hoàn tiền. */
export interface AdminRefundPage {
    refunds: Refund[];
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
    /** Chữ ký toàn vẹn khi payload đi qua hàng đợi (queueAuth) — không phải dữ liệu SePay, bị loại trước khi xử lý nghiệp vụ. */
    _queueSig?: string;
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
    /** Mặc định `month` khi client cũ không gửi. */
    cycle?: BillingCycle;
}

export interface CreateOrderResponse {
    order_id: string;
    pay_code: string;
    cycle: BillingCycle;
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
    cycle?: BillingCycle;
    amount_vnd: number;
    pay_code: string;
    expires_at: string;
    claimed_at?: string | null;
    paid_at?: string | null;
    plan_expires_at?: string | null;
}

/**
 * Nguồn của một bút toán hoàn tiền:
 *  - `unmatched`: giao dịch chuyển khoản không khớp đơn nào;
 *  - `duplicate`: giao dịch trùng lặp (khách chuyển 2 lần);
 *  - `refund_request`: hoàn theo yêu cầu người dùng gửi từ widget Hỗ trợ
 *    (`source_id` là ID ticket, không phải ID giao dịch).
 */
export type RefundSourceType = 'unmatched' | 'duplicate' | 'refund_request';

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
