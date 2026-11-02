import { Pool } from 'pg';
import { unlinkSync } from 'node:fs';
import { getConfig } from '../config.js';
import { resolveAssetPath } from '../security/uploadGuard.js';
import { AUTH_SQL, BRAND_KIT_SQL, BILLING_SQL, ANNOUNCEMENT_SQL, HELPDESK_SQL, ASSETS_SQL } from './base.js';
import { initPerformanceIndexes } from './indexes.js';

const config = getConfig();

export const db = new Pool({
    connectionString: config.DATABASE_URL,
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
});

db.on('error', (error: Error) => {
    console.error(
        'Unexpected PostgreSQL pool error:',
        error
    );
});

export async function initDatabase(): Promise<void> {
    if (!config.DATABASE_URL) return;
    // Chạy tuần tự: AUTH_SQL, BRAND_KIT_SQL, BILLING_SQL
    await db.query(AUTH_SQL);
    await db.query(BRAND_KIT_SQL);
    await db.query(BILLING_SQL);
    await db.query(ANNOUNCEMENT_SQL);
    await db.query(HELPDESK_SQL);
    await db.query(ASSETS_SQL);
    // Data migration (#103): dọn asset video cũ — loại asset không còn hỗ trợ.
    await removeLegacyVideoAssets();
    // Tối ưu truy vấn: tạo chỉ mục hiệu năng (idempotent, lỗi không chặn khởi động).
    await initPerformanceIndexes(db);
}

/**
 * Data migration (#103): xoá asset video cũ khỏi thư viện — loại asset không
 * còn được hỗ trợ kể từ khi thư viện chỉ nhận ảnh. Xoá file trên đĩa trước
 * (best-effort, giam qua resolveAssetPath), rồi xoá dòng DB. Idempotent: chạy
 * lại thì không còn dòng nào. Trả về số dòng đã xoá.
 */
async function removeLegacyVideoAssets(): Promise<number> {
    try {
        const { rows } = await db.query(
            `SELECT id, file_path FROM assets WHERE kind = 'video'`
        );
        for (const row of rows) {
            const real = resolveAssetPath(String(row.file_path ?? ''));
            if (real) {
                try { unlinkSync(real); } catch { /* file đã mất, bỏ qua */ }
            }
        }
        const result = await db.query(`DELETE FROM assets WHERE kind = 'video'`);
        const removed = result.rowCount ?? 0;
        if (removed > 0) {
            console.log(`[Assets] Đã xoá ${removed} asset video cũ (không còn hỗ trợ).`);
        }
        return removed;
    } catch (err) {
        console.warn('[Assets] Lỗi khi dọn asset video cũ:', err);
        return 0;
    }
}