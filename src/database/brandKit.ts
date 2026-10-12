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
    logoUrl?: string;
    logoPath?: string;
    position: string;
    scale_pct: number;
    scalePct?: number;
    scalePercent?: number;
    opacity: number;
    x_pct: number | null;
    xPct?: number | null;
    xPercent?: number | null;
    y_pct: number | null;
    yPct?: number | null;
    yPercent?: number | null;
    updated_at: Date;
}

/**
 * Chuẩn hoá một bản ghi brand kit từ PostgreSQL.
 *
 * Driver `pg` trả cột NUMERIC về dạng string trong JavaScript, nên cần
 * ép kiểu rõ ràng để API luôn trả về number cho client.
 */
function toBrandKitRow(row: any): BrandKitRow {
    const logo = row.logo_url ?? row.logoUrl ?? row.logoPath ?? '';
    const scale = Number(row.scale_pct ?? row.scalePct ?? row.scalePercent);
    const op = Number(row.opacity);
    const xp = row.x_pct == null && row.xPct == null && row.xPercent == null ? null : Number(row.x_pct ?? row.xPct ?? row.xPercent);
    const yp = row.y_pct == null && row.yPct == null && row.yPercent == null ? null : Number(row.y_pct ?? row.yPct ?? row.yPercent);

    return {
        user_id: row.user_id,
        logo_url: logo,
        logoUrl: logo,
        logoPath: logo,
        position: row.position,
        scale_pct: scale,
        scalePct: scale,
        scalePercent: scale,
        opacity: op,
        x_pct: xp,
        xPct: xp,
        xPercent: xp,
        y_pct: yp,
        yPct: yp,
        yPercent: yp,
        updated_at: row.updated_at,
    };
}

/**
 * Dữ liệu đầu vào để tạo hoặc cập nhật brand kit.
 * Không bao gồm user_id (được truyền riêng) và updated_at (tự động).
 */
export interface UpsertBrandKitInput {
    logoUrl?: string;
    logoPath?: string;
    position: string;
    scalePct?: number;
    scalePercent?: number;
    opacity: number;
    xPct?: number | null;
    xPercent?: number | null;
    yPct?: number | null;
    yPercent?: number | null;
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
    const row = result.rows[0] ?? null;
    return row ? toBrandKitRow(row) : null;
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
    const logo = input.logoUrl ?? input.logoPath ?? '';
    const scale = Number(input.scalePct ?? input.scalePercent ?? 15);
    const xp = input.xPct ?? input.xPercent ?? null;
    const yp = input.yPct ?? input.yPercent ?? null;

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
            logo,
            input.position,
            scale,
            input.opacity,
            xp,
            yp,
        ]
    );

    // RETURNING đảm bảo luôn trả về đúng 1 hàng sau khi INSERT/UPDATE
    return toBrandKitRow(result.rows[0]);
}
