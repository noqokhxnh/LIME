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
`;