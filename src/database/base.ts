export const AUTH_SQL = `
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY,
    username VARCHAR(30) NOT NULL,
    email VARCHAR(255) NOT NULL,
    password_hash TEXT,
    google_id VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE users
ADD COLUMN IF NOT EXISTS google_id VARCHAR(255);
ALTER TABLE users
ALTER COLUMN password_hash DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_google_id_unique
ON users (google_id) WHERE google_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_unique
ON users (LOWER(username));

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique
ON users (LOWER(email));

CREATE TABLE IF NOT EXISTS sessions (
    token_hash CHAR(64) PRIMARY KEY,
    user_id UUID NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx
ON sessions(user_id);

CREATE INDEX IF NOT EXISTS sessions_expires_at_idx
ON sessions(expires_at);

-- User columns for role, tier, credits, total_credits, status, deleted_at, preferences
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'user';
ALTER TABLE users ADD COLUMN IF NOT EXISTS tier VARCHAR(20) NOT NULL DEFAULT 'free';
ALTER TABLE users ADD COLUMN IF NOT EXISTS credits INTEGER NOT NULL DEFAULT 20;
ALTER TABLE users ADD COLUMN IF NOT EXISTS total_credits INTEGER NOT NULL DEFAULT 20;
ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferences JSONB DEFAULT '{}'::jsonb;

-- Super Admin promotion for khanh2k5xxx@gmail.com
UPDATE users
SET role = 'admin',
    tier = 'enterprise',
    credits = GREATEST(credits, 10000),
    total_credits = GREATEST(total_credits, 10000),
    status = 'active',
    updated_at = NOW()
WHERE LOWER(email) = 'khanh2k5xxx@gmail.com';

-- System Settings
CREATE TABLE IF NOT EXISTS system_settings (
    key VARCHAR(50) PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by VARCHAR(255)
);

-- Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action VARCHAR(100) NOT NULL,
    user_id UUID,
    user_email VARCHAR(255),
    ip_address VARCHAR(45),
    status VARCHAR(20) NOT NULL DEFAULT 'success',
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Người THỰC HIỆN hành động (actor), tách khỏi user_id/user_email là ĐỐI TƯỢNG bị
-- tác động. Trước đây thông tin người thực hiện chỉ nằm rải rác trong details
-- (updatedBy/deletedBy/...) và ip_address không bao giờ được ghi từ cổng quản trị.
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS actor_id UUID;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS actor_email VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
`;

/**
 * Câu lệnh SQL khởi tạo bảng brand_kits.
 *
 * Bảng này lưu cấu hình logo/watermark của từng tài khoản người dùng.
 * Mỗi user chỉ có đúng 1 bản ghi brand kit (quan hệ 1-1 với bảng users).
 *
 * Các cột:
 *   - user_id     : Khóa ngoại liên kết với bảng users, cũng là khóa chính
 *                   (đảm bảo mỗi user chỉ có 1 brand kit)
 *   - logo_url    : Đường dẫn URL đến file logo trên server (ví dụ: /uploads/logos/uuid.png)
 *   - position    : Vị trí logo trên video (top-left, top-right, bottom-left, bottom-right, custom)
 *   - scale_pct   : Kích thước logo tính theo % chiều rộng video (5–50)
 *   - opacity     : Độ mờ đục của logo (0.1–1.0)
 *   - x_pct       : Tọa độ X theo % (chỉ dùng khi position = 'custom')
 *   - y_pct       : Tọa độ Y theo % (chỉ dùng khi position = 'custom')
 *   - updated_at  : Thời điểm cập nhật lần cuối (tự động cập nhật khi upsert)
 */
export const BRAND_KIT_SQL = `
CREATE TABLE IF NOT EXISTS brand_kits (
    user_id     UUID PRIMARY KEY
                    REFERENCES users(id)
                    ON DELETE CASCADE,
    logo_url    TEXT         NOT NULL,
    position    VARCHAR(20)  NOT NULL DEFAULT 'top-right',
    scale_pct   NUMERIC(5,2) NOT NULL DEFAULT 15,
    opacity     NUMERIC(4,3) NOT NULL DEFAULT 0.8,
    x_pct       NUMERIC(5,2),
    y_pct       NUMERIC(5,2),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
`;

export const BILLING_SQL = `
CREATE TABLE IF NOT EXISTS plans (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    price_vnd INTEGER NOT NULL CHECK (price_vnd > 0),
    quota_video INTEGER NOT NULL DEFAULT 0,
    days INTEGER NOT NULL DEFAULT 30,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO plans (id, name, price_vnd, quota_video, days, is_active)
VALUES
    ('creator', 'Gói Sáng Tạo', 149000, 50, 30, true),
    ('pro', 'Gói Pro', 249000, 150, 30, true),
    ('max', 'Gói Max', 499000, 500, 30, true)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    price_vnd = EXCLUDED.price_vnd,
    quota_video = EXCLUDED.quota_video,
    days = EXCLUDED.days,
    is_active = EXCLUDED.is_active;

CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_id VARCHAR(50) NOT NULL REFERENCES plans(id),
    amount_vnd INTEGER NOT NULL,
    pay_code VARCHAR(50) NOT NULL UNIQUE,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    expires_at TIMESTAMPTZ NOT NULL,
    claimed_at TIMESTAMPTZ,
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_user_status ON orders(user_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_expires_at ON orders(expires_at);
CREATE INDEX IF NOT EXISTS idx_orders_pay_code ON orders(pay_code);

CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    sepay_ref VARCHAR(100) NOT NULL UNIQUE,
    amount_vnd INTEGER NOT NULL,
    raw JSONB NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    result VARCHAR(20) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_result ON payments(result);

CREATE TABLE IF NOT EXISTS unmatched_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sepay_ref VARCHAR(100) NOT NULL UNIQUE,
    amount_vnd INTEGER NOT NULL,
    content TEXT NOT NULL,
    raw JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    admin_note TEXT,
    resolved_by VARCHAR(100),
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_unmatched_payments_status ON unmatched_payments(status);

ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_id VARCHAR(50) REFERENCES plans(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_expires_at TIMESTAMPTZ;

-- Lịch sử hoàn tiền thủ công cho giao dịch lỗi (unmatched / duplicate).
-- SePay webhook không trả về STK + ngân hàng của người chuyển, nên admin
-- phải nhập tay thông tin này khi thực hiện hoàn tiền.
CREATE TABLE IF NOT EXISTS refunds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_type VARCHAR(20) NOT NULL,
    source_id VARCHAR(100) NOT NULL,
    sepay_ref VARCHAR(100) NOT NULL,
    amount_vnd INTEGER NOT NULL,
    bank_account VARCHAR(50) NOT NULL,
    bank_name VARCHAR(100) NOT NULL,
    admin_note TEXT,
    refunded_by VARCHAR(100),
    refunded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_refunds_source ON refunds(source_type, source_id);
`;

/**
 * Câu lệnh SQL khởi tạo bảng announcements (System Broadcast Banner).
 *
 * Mỗi bản ghi là một thông báo có thể hiển thị cho toàn bộ người dùng — đã đăng
 * nhập lẫn khách chưa đăng nhập: bảo trì, ra mắt tính năng mới, cảnh báo…
 *
 * Các cột:
 *   - kind        : info | feature | warning | maintenance (quyết định màu/kểu banner)
 *   - priority    : số càng lớn càng ưu tiên hiển thị lên trên
 *   - is_active   : bật/tắt nhanh mà không cần xoá
 *   - starts_at   : thời điểm bắt đầu hiệu lực (NULL = ngay lập tức)
 *   - ends_at     : thời điểm hết hiệu lực (NULL = không hết hạn)
 *   - dismissible : người dùng có được phép đóng banner này không
 *   - audience    : all | users | guests (phạm vi người xem)
 */
export const ANNOUNCEMENT_SQL = `
CREATE TABLE IF NOT EXISTS announcements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(160) NOT NULL,
    body TEXT NOT NULL,
    kind VARCHAR(20) NOT NULL DEFAULT 'info',
    priority INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    dismissible BOOLEAN NOT NULL DEFAULT true,
    link_url TEXT,
    link_label VARCHAR(80),
    audience VARCHAR(20) NOT NULL DEFAULT 'all',
    created_by VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_announcements_active
ON announcements(is_active, priority DESC, created_at DESC);
`;

/**
 * Câu lệnh SQL khởi tạo bảng helpdesk (Yêu cầu hỗ trợ / Ticketing).
 *
 * Người dùng tạo ticket (báo lỗi, yêu cầu hỗ trợ kỹ thuật) ngay trên trang của
 * mình qua widget nổi; Admin tiếp nhận và phản hồi ngay trong trang Admin.
 * Mỗi ticket là một chuỗi hội thoại gồm nhiều `ticket_messages` (bên user/admin,
 * có thể kèm ảnh và ghi chú nội bộ `is_internal` ẩn khỏi người dùng).
 *
 * Các cột chính:
 *   - code     : mã ticket hiển thị dạng LIME-T-XXXXXX (unique, tránh nhầm lẫn với UUID)
 *   - status   : open | in_progress | waiting_user | resolved | closed
 *   - category : bug | feature_request | billing | account | render | other
 *   - priority : low | normal | high | urgent
 *   - context  : JSONB tự báo cáo (URL, userAgent, tier, jobId) giúp admin tra cứu
 */
export const HELPDESK_SQL = `
CREATE TABLE IF NOT EXISTS tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(20) NOT NULL UNIQUE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    user_email VARCHAR(255),
    subject VARCHAR(200) NOT NULL,
    category VARCHAR(30) NOT NULL DEFAULT 'other',
    priority VARCHAR(20) NOT NULL DEFAULT 'normal',
    status VARCHAR(20) NOT NULL DEFAULT 'open',
    context JSONB,
    last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_admin_reply_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tickets_status_last
ON tickets(status, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_user
ON tickets(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ticket_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    sender_type VARCHAR(10) NOT NULL,
    sender_id UUID,
    sender_email VARCHAR(255),
    body TEXT NOT NULL,
    attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_internal BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket
ON ticket_messages(ticket_id, created_at);
`;