import { Pool } from 'pg';
import { unlinkSync } from 'node:fs';
import { getConfig } from '../config.js';
import { resolveAssetPath } from '../security/uploadGuard.js';
import { runMigrations } from './migrations.js';

const config = getConfig();

export const db = new Pool({
    connectionString: config.DATABASE_URL,
    max: config.DATABASE_POOL_MAX,
    statement_timeout: config.DATABASE_STATEMENT_TIMEOUT_MS,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
});

db.on('error', (error: Error) => {
    console.error(
        'Unexpected PostgreSQL pool error:',
        error
    );
});

let isClosing = false;
let closePromise: Promise<void> | null = null;

/**
 * Đóng pool đúng MỘT lần dù nhiều tín hiệu tắt máy (SIGINT/SIGTERM) hoặc nhiều
 * hook `onClose` cùng gọi. Gọi lại là việc rỗng, tránh `db.end()` lần hai ném lỗi
 * "Called end on pool more than once".
 */
export function closeDatabase(): Promise<void> {
    if (!closePromise) {
        isClosing = true;
        closePromise = db.end().catch((err) => {
            console.error('[Database] Error closing PostgreSQL pool:', err);
        });
    }
    return closePromise;
}

export function isDatabaseClosing(): boolean {
    return isClosing;
}

export async function initDatabase(): Promise<void> {
    if (!config.DATABASE_URL) return;
    // Chạy migration có phiên bản, tuần tự và được tuần tự hoá giữa các tiến
    // trình bằng advisory lock (xem src/database/migrations.ts).
    await runMigrations(db);
    // Data migration (#103): dọn asset video cũ — loại asset không còn hỗ trợ.
    await removeLegacyVideoAssets();
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