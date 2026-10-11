import { db } from './index.js';

// ============================================================
// MODULE TRUY CẬP DỮ LIỆU: BRAND KIT (src/database/brandKit.ts)
//
// Mục tiêu: Cung cấp 2 hàm để đọc và lưu cài đặt logo/watermark
//           của người dùng vào bảng brand_kits trong PostgreSQL.
// ============================================================

/**
 * Kiểu dữ liệu biểu diễn một bản ghi trong bảng brand_kits.
 * Tương ứng 1-1 với các cột trong bảng (dùng snake_case như PostgreSQL).
 */
export interface BrandKitRow {
    user_id: string;
    logo_url: string;
    position: string;
    scale_pct: number;
    opacity: number;
    x_pct: number | null;
    y_pct: number | null;
    updated_at: Date;
}

/**
 * Dữ liệu đầu vào để tạo hoặc cập nhật brand kit.
 * Không bao gồm user_id (được truyền riêng) và updated_at (tự động).
 */
export interface UpsertBrandKitInput {
    logoUrl: string;
    position: string;
    scalePct: number;
    opacity: number;
    xPct?: number | null;
    yPct?: number | null;
}

/**
 * Lấy thông tin brand kit (cài đặt logo) của một người dùng theo userId.
 *
 * Trả về null nếu người dùng chưa thiết lập brand kit lần nào.
 *
 * @param userId  UUID của người dùng (từ bảng users)
 * @returns Bản ghi brand kit hoặc null nếu chưa có
 */
export async function getBrandKitByUserId(userId: string): Promise<BrandKitRow | null> {
    const result = await db.query<BrandKitRow>(
        `SELECT user_id, logo_url, position, scale_pct, opacity, x_pct, y_pct, updated_at
         FROM brand_kits
         WHERE user_id = $1`,
        [userId]
    );

    // rows[0] là bản ghi đầu tiên; undefined nếu không tìm thấy → trả null
    return result.rows[0] ?? null;
}

/**
 * Lưu (tạo mới hoặc cập nhật) cài đặt brand kit cho người dùng.
 *
 * Sử dụng câu lệnh "UPSERT" (INSERT ... ON CONFLICT DO UPDATE) của PostgreSQL:
 *   - Nếu user_id chưa có trong bảng → INSERT tạo mới bản ghi
 *   - Nếu user_id đã có → UPDATE cập nhật các trường bị thay đổi
 *
 * Điều này đảm bảo mỗi user chỉ có đúng 1 bản ghi brand kit.
 *
 * @param userId  UUID của người dùng
 * @param input   Dữ liệu brand kit mới cần lưu
 * @returns Bản ghi brand kit sau khi đã lưu (đã cập nhật updated_at)
 */
export async function upsertBrandKit(
    userId: string,
    input: UpsertBrandKitInput
): Promise<BrandKitRow> {
    const result = await db.query<BrandKitRow>(
        `INSERT INTO brand_kits (user_id, logo_url, position, scale_pct, opacity, x_pct, y_pct, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (user_id) DO UPDATE SET
             logo_url   = EXCLUDED.logo_url,
             position   = EXCLUDED.position,
             scale_pct  = EXCLUDED.scale_pct,
             opacity    = EXCLUDED.opacity,
             x_pct      = EXCLUDED.x_pct,
             y_pct      = EXCLUDED.y_pct,
             updated_at = NOW()
         RETURNING user_id, logo_url, position, scale_pct, opacity, x_pct, y_pct, updated_at`,
        [
            userId,
            input.logoUrl,
            input.position,
            input.scalePct,
            input.opacity,
            input.xPct ?? null,    // undefined → null trong PostgreSQL
            input.yPct ?? null,
        ]
    );

    // RETURNING đảm bảo luôn trả về đúng 1 hàng sau khi INSERT/UPDATE
    return result.rows[0];
}
