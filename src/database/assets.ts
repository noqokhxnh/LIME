import { db } from './index.js';

// ============================================================
// MODULE TRUY CẬP DỮ LIỆU: THƯ VIỆN ASSET (#103)
// File: src/database/assets.ts
//
// Mục tiêu: Cung cấp các hàm đọc/ghi/xoá asset (ảnh + video) của người
//           dùng trong bảng assets. Mọi hàm đều gắn với user_id để đảm bảo
//           ownership: chỉ chủ sở hữu (hoặc admin) mới được list/đọc/xoá.
// ============================================================

export type AssetKind = 'image' | 'video';

export interface AssetRow {
    id: string;
    userId: string;
    kind: AssetKind;
    mimeType: string;
    filePath: string;
    url: string;
    description: string;
    tags: string[];
    fileSizeBytes: number;
    createdAt: Date;
}

/**
 * Chuẩn hoá một bản ghi asset từ PostgreSQL về dạng camelCase cho API.
 * `tags` là TEXT[] (pg trả về string[]); file_size_bytes là BIGINT (pg trả
 * về string) nên ép Number rõ ràng.
 */
function toAssetRow(row: any): AssetRow {
    return {
        id: row.id,
        userId: row.user_id,
        kind: row.kind === 'video' ? 'video' : 'image',
        mimeType: row.mime_type,
        filePath: row.file_path,
        url: row.url,
        description: row.description ?? '',
        tags: Array.isArray(row.tags) ? row.tags : [],
        fileSizeBytes: Number(row.file_size_bytes ?? 0),
        createdAt: row.created_at,
    };
}

export interface CreateAssetInput {
    userId: string;
    kind: AssetKind;
    mimeType: string;
    filePath: string;
    url: string;
    description?: string;
    tags?: string[];
    fileSizeBytes: number;
}

/**
 * Ghi một bản ghi asset mới vào bảng assets.
 * `id` do PostgreSQL sinh (gen_random_uuid), `created_at` tự động.
 */
export async function createAsset(input: CreateAssetInput): Promise<AssetRow> {
    const result = await db.query(
        `INSERT INTO assets (user_id, kind, mime_type, file_path, url, description, tags, file_size_bytes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, user_id, kind, mime_type, file_path, url, description, tags, file_size_bytes, created_at`,
        [
            input.userId,
            input.kind,
            input.mimeType,
            input.filePath,
            input.url,
            input.description ?? '',
            input.tags ?? [],
            input.fileSizeBytes,
        ]
    );
    return toAssetRow(result.rows[0]);
}

/**
 * Liệt kê toàn bộ asset của một người dùng, mới nhất lên trước.
 */
export async function listAssetsByUserId(userId: string): Promise<AssetRow[]> {
    const result = await db.query(
        `SELECT id, user_id, kind, mime_type, file_path, url, description, tags, file_size_bytes, created_at
         FROM assets
         WHERE user_id = $1
         ORDER BY created_at DESC`,
        [userId]
    );
    return result.rows.map(toAssetRow);
}

/**
 * Đọc một asset theo id VÀ userId — nếu asset thuộc người khác thì trả null.
 * Đây là chốt ownership cho các route đọc/xoá asset.
 */
export async function getAssetByIdForUser(id: string, userId: string): Promise<AssetRow | null> {
    const result = await db.query(
        `SELECT id, user_id, kind, mime_type, file_path, url, description, tags, file_size_bytes, created_at
         FROM assets
         WHERE id = $1 AND user_id = $2`,
        [id, userId]
    );
    const row = result.rows[0] ?? null;
    return row ? toAssetRow(row) : null;
}

/**
 * Đọc nhiều asset theo danh sách id VÀ userId (bỏ qua id không thuộc user).
 * Dùng để resolve assetIds khi sinh kịch bản / render.
 */
export async function getAssetsByIdsForUser(ids: string[], userId: string): Promise<AssetRow[]> {
    if (!ids || ids.length === 0) return [];
    const result = await db.query(
        `SELECT id, user_id, kind, mime_type, file_path, url, description, tags, file_size_bytes, created_at
         FROM assets
         WHERE user_id = $1 AND id = ANY($2::uuid[])
         ORDER BY created_at DESC`,
        [userId, ids]
    );
    return result.rows.map(toAssetRow);
}

/**
 * Xoá một asset theo id VÀ userId. Trả về true nếu xoá được, false nếu
 * không tồn tại hoặc thuộc người khác. KHÔNG tự xoá file trên đĩa — caller
 * chịu trách nhiệm dọn file (để tránh xoá file rồi DB lỗi thì mất tham chiếu).
 */
export async function deleteAssetByIdForUser(id: string, userId: string): Promise<boolean> {
    const result = await db.query(
        `DELETE FROM assets WHERE id = $1 AND user_id = $2`,
        [id, userId]
    );
    return (result.rowCount ?? 0) > 0;
}
