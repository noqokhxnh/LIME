import { Pool } from 'pg';
import { getConfig } from '../config.js';
import { AUTH_SQL, BRAND_KIT_SQL } from './base.js';

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
    // Chạy tuần tự: AUTH_SQL trước (tạo bảng users/sessions),
    // sau đó BRAND_KIT_SQL (tạo bảng brand_kits có khóa ngoại đến users).
    // Thứ tự quan trọng: brand_kits phụ thuộc vào bảng users đã tồn tại.
    await db.query(AUTH_SQL);
    await db.query(BRAND_KIT_SQL);
}