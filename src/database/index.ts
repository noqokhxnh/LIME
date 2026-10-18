import { Pool } from 'pg';
import { getConfig } from '../config.js';
import { AUTH_SQL, BRAND_KIT_SQL, BILLING_SQL, ANNOUNCEMENT_SQL } from './base.js';
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
    // Tối ưu truy vấn: tạo chỉ mục hiệu năng (idempotent, lỗi không chặn khởi động).
    await initPerformanceIndexes(db);
}