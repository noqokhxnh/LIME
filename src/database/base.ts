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