import { db } from './index.js';
import { readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, basename } from 'node:path';
import { ASSETS_DIR } from '../security/uploadGuard.js';

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
 * Ghi mô tả + tags do vision model sinh ra vào cột description/tags của asset.
 * Trả true nếu có dòng bị cập nhật (asset tồn tại + thuộc user).
 */
export async function updateAssetCaption(
    id: string,
    userId: string,
    description: string,
    tags: string[]
): Promise<boolean> {
    const result = await db.query(
        `UPDATE assets SET description = $3, tags = $4 WHERE id = $1 AND user_id = $2`,
        [id, userId, description ?? '', tags ?? []]
    );
    return (result.rowCount ?? 0) > 0;
}

export interface AssetUsage {
    count: number;
    totalBytes: number;
}

/**
 * Đếm số asset và tổng dung lượng của một người dùng — dùng để áp hạn mức
 * upload (quota) trước khi ghi file mới.
 */
export async function getAssetUsageForUser(userId: string): Promise<AssetUsage> {
    const result = await db.query(
        `SELECT COUNT(*)::int AS count, COALESCE(SUM(file_size_bytes), 0)::bigint AS total_bytes
         FROM assets
         WHERE user_id = $1`,
        [userId]
    );
    const row = result.rows[0] ?? { count: 0, total_bytes: 0 };
    return { count: Number(row.count ?? 0), totalBytes: Number(row.total_bytes ?? 0) };
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

const SAFE_ASSET_BASENAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(png|jpg|jpeg|svg|webp|mp4|webm)$/i;

/**
 * Dọn file asset mồ côi: file nằm trong ASSETS_DIR nhưng không còn dòng DB
 * tương ứng (upload xong nhưng createAsset lỗi, hoặc DB bị xoá trước khi xoá
 * file). Chỉ xoá file khớp mẫu tên an toàn và đã tồn tại lâu hơn `graceMs`
 * (mặc định 1 giờ — tránh xoá file đang upload dở). Trả về số file đã xoá.
 */
export async function cleanupOrphanedAssetFiles(graceMs = 60 * 60 * 1000): Promise<number> {
    try {
        const valid = new Set<string>();
        const rows = await db.query(`SELECT file_path FROM assets`);
        for (const row of rows.rows) {
            const name = basename(String(row.file_path ?? ''));
            if (name) valid.add(name);
        }

        let removed = 0;
        const now = Date.now();
        const names = readdirSync(ASSETS_DIR);
        for (const name of names) {
            if (!SAFE_ASSET_BASENAME.test(name)) continue;
            if (valid.has(name)) continue;
            const full = join(ASSETS_DIR, name);
            try {
                if (now - statSync(full).mtimeMs < graceMs) continue;
                unlinkSync(full);
                removed++;
            } catch {
                // File đã mất hoặc đang bận — bỏ qua.
            }
        }
        if (removed > 0) console.log(`[Assets] Đã dọn ${removed} file asset mồ côi.`);
        return removed;
    } catch (err) {
        console.warn('[Assets] Lỗi khi dọn asset mồ côi:', err);
        return 0;
    }
}
