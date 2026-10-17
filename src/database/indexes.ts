import type { Pool } from 'pg';

/**
 * Chỉ mục hiệu năng cho PostgreSQL.
 *
 * Tập trung toàn bộ DDL chỉ mục ở một chỗ để tránh rải rác giữa các module và
 * để `initDatabase()` (src/database/index.ts) chạy một lần khi khởi động.
 * Mọi câu lệnh đều idempotent (`IF NOT EXISTS`) nên chạy lại an toàn.
 */

/**
 * Chỉ mục B-tree thuần — an toàn trên mọi bản PostgreSQL, không cần extension.
 * Phục vụ trực tiếp các truy vấn của cổng quản trị:
 *  - Lọc theo `status` + sắp xếp `created_at DESC` + phân trang (orders, unmatched, payments).
 *  - Danh sách người dùng theo `deleted_at IS NULL` + `created_at DESC`.
 *  - Lịch sử đăng nhập theo `user_id` + `created_at DESC`.
 */
export const CORE_INDEX_SQL = `
-- ------------------------------------------------------------------
-- orders: danh sách đơn hàng admin (lọc trạng thái + phân trang theo thời gian)
-- ------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_orders_created_at
    ON orders (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status_created_at
    ON orders (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_plan_id
    ON orders (plan_id);

-- ------------------------------------------------------------------
-- payments: danh sách giao dịch trùng lặp (result = 'duplicate')
-- ------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_payments_result_received_at
    ON payments (result, received_at DESC);

-- ------------------------------------------------------------------
-- unmatched_payments: giao dịch chưa khớp đơn, lọc theo trạng thái
-- ------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_unmatched_status_created_at
    ON unmatched_payments (status, created_at DESC);
-- Khi lọc "tất cả trạng thái" vẫn sắp xếp theo thời gian mới nhất trước.
CREATE INDEX IF NOT EXISTS idx_unmatched_created_at
    ON unmatched_payments (created_at DESC);

-- ------------------------------------------------------------------
-- refunds: lịch sử hoàn tiền mới nhất trước
-- ------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_refunds_refunded_at
    ON refunds (refunded_at DESC);

-- ------------------------------------------------------------------
-- users: danh sách admin (chỉ user chưa xoá, mới nhất trước) + lọc role/tier/status
-- ------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_users_active_created_at
    ON users (created_at DESC)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_role
    ON users (role);
CREATE INDEX IF NOT EXISTS idx_users_tier
    ON users (tier);
CREATE INDEX IF NOT EXISTS idx_users_status
    ON users (status);

-- ------------------------------------------------------------------
-- audit_logs: lịch sử đăng nhập / thao tác của một người dùng
-- ------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_created_at
    ON audit_logs (user_id, created_at DESC);

-- Lịch sử đăng nhập của một người dùng (lọc theo action + sắp xếp mới nhất trước).
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_action_created_at
    ON audit_logs (user_id, action, created_at DESC);

-- Danh sách nhật ký kiểm toán của admin: lọc theo action/trạng thái/người thực hiện/IP
-- kèm sắp xếp mới nhất trước và phân trang.
CREATE INDEX IF NOT EXISTS idx_audit_logs_action_created_at
    ON audit_logs (action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_status_created_at
    ON audit_logs (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_created_at
    ON audit_logs (actor_email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_ip
    ON audit_logs (ip_address);
`;

/**
 * Chỉ mục trigram (pg_trgm) để tăng tốc tìm kiếm chuỗi con `ILIKE '%...%'`
 * — loại truy vấn mà B-tree không dùng được.
 *
 * Cần extension `pg_trgm`. Trên máy chủ không cài/không có quyền tạo extension,
 * khối này sẽ thất bại và được bỏ qua một cách an toàn (hệ thống vẫn chạy).
 */
export const TRIGRAM_INDEX_SQL = `
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_orders_pay_code_trgm
    ON orders USING gin (pay_code gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_users_email_trgm
    ON users USING gin (email gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_users_username_trgm
    ON users USING gin (username gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_unmatched_content_trgm
    ON unmatched_payments USING gin (content gin_trgm_ops);

-- Tìm giao dịch theo mã SePay (khớp chuỗi con ILIKE); điều kiện khớp chính xác
-- đã dùng chỉ mục UNIQUE có sẵn, chỉ mục trigram bổ sung cho phần khớp chuỗi con.
CREATE INDEX IF NOT EXISTS idx_unmatched_sepay_ref_trgm
    ON unmatched_payments USING gin (sepay_ref gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_payments_sepay_ref_trgm
    ON payments USING gin (sepay_ref gin_trgm_ops);

-- Tìm kiếm nhật ký kiểm toán theo action (ILIKE '%...%')
CREATE INDEX IF NOT EXISTS idx_audit_logs_action_trgm
    ON audit_logs USING gin (action gin_trgm_ops);
`;

/**
 * Tạo toàn bộ chỉ mục hiệu năng.
 *
 * Không bao giờ ném lỗi ra ngoài: chỉ mục là tối ưu, không phải điều kiện sống còn
 * của hệ thống. Lỗi (thiếu quyền, thiếu extension, ...) chỉ được ghi log.
 *
 * @param pool Pool kết nối PostgreSQL đang dùng của ứng dụng.
 */
export async function initPerformanceIndexes(pool: Pool): Promise<void> {
    try {
        await pool.query(CORE_INDEX_SQL);
    } catch (err: any) {
        console.error('[Database] Không tạo được chỉ mục hiệu năng:', err?.message || err);
    }

    try {
        await pool.query(TRIGRAM_INDEX_SQL);
    } catch (err: any) {
        console.warn(
            '[Database] Bỏ qua chỉ mục trigram (pg_trgm chưa khả dụng):',
            err?.message || err
        );
    }
}
