import type { Pool, PoolClient } from 'pg';
import {
    AUTH_SQL,
    BRAND_KIT_SQL,
    BILLING_SQL,
    ANNOUNCEMENT_SQL,
    HELPDESK_SQL,
    ASSETS_SQL,
    PAGE_VIEWS_SQL,
    VIDEO_HISTORY_SQL,
} from './base.js';
import { CORE_INDEX_SQL, TRIGRAM_INDEX_SQL } from './indexes.js';

/**
 * Schema migration có phiên bản cho PostgreSQL.
 *
 * Vì sao cần: trước đây `initDatabase()` chạy lại toàn bộ 6 khối DDL lớn ở MỖI
 * lần khởi động, trên cả API server lẫn worker. Hai tiến trình khởi động đồng
 * thời sẽ tranh catalog lock; và không có cách nào biết bước DDL nào đã áp dụng.
 *
 * Thiết kế tối giản, an toàn với database LIME hiện có:
 *  - Bảng `schema_migrations(version, description, applied_at)` là sổ đăng ký.
 *  - Mỗi migration chạy trong MỘT transaction cùng với bản ghi phiên bản ⇒
 *    "đã ghi nhận" và "đã áp dụng" luôn đi đôi; lỗi giữa chừng rollback sạch.
 *  - `pg_advisory_lock` trên một khoá cố định tuần tự hoá nhiều tiến trình
 *    (server + worker) khởi động cùng lúc.
 *  - Migration đều idempotent (`IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`) nên
 *    database cũ chưa có `schema_migrations` chỉ cần chạy một lần là nâng cấp
 *    an toàn, không drop/recreate bảng và không mất dữ liệu.
 *  - KHÔNG tự rollback migration đã áp dụng trên dữ liệu thật.
 */

export interface Migration {
    version: string;
    description: string;
    up: (client: PoolClient) => Promise<void>;
}

/** Khoá advisory cố định cho toàn bộ tiến trình LIME ('LIME' dạng số). */
export const MIGRATION_LOCK_KEY = 0x4c494d45;

const authMigration: Migration = {
    version: '001_auth',
    description: 'users + sessions',
    up: (client) => client.query(AUTH_SQL).then(() => undefined),
};

const brandKitMigration: Migration = {
    version: '002_brand_kits',
    description: 'brand_kits',
    up: (client) => client.query(BRAND_KIT_SQL).then(() => undefined),
};

const billingMigration: Migration = {
    version: '003_billing',
    description: 'plans + orders + payments + unmatched + refunds',
    up: (client) => client.query(BILLING_SQL).then(() => undefined),
};

const announcementsMigration: Migration = {
    version: '004_announcements',
    description: 'announcements',
    up: (client) => client.query(ANNOUNCEMENT_SQL).then(() => undefined),
};

const helpdeskMigration: Migration = {
    version: '005_helpdesk',
    description: 'tickets + ticket_messages',
    up: (client) => client.query(HELPDESK_SQL).then(() => undefined),
};

const assetsMigration: Migration = {
    version: '006_assets',
    description: 'assets',
    up: (client) => client.query(ASSETS_SQL).then(() => undefined),
};

const pageViewsMigration: Migration = {
    version: '007_page_views',
    description: 'page_views (analytics) — trước đây thiếu DDL hoàn toàn',
    up: (client) => client.query(PAGE_VIEWS_SQL).then(() => undefined),
};

const videoHistoryMigration: Migration = {
    version: '009_video_history',
    description: 'video_history (lịch sử video của người dùng)',
    up: (client) => client.query(VIDEO_HISTORY_SQL).then(() => undefined),
};

const performanceIndexesMigration: Migration = {
    version: '008_performance_indexes',
    description: 'index hiệu năng + dọn index dư thừa',
    up: async (client) => {
        await client.query(CORE_INDEX_SQL);
        // pg_trgm là tuỳ chọn: thiếu extension/quyền thì bỏ qua, KHÔNG làm hỏng
        // transaction. Một câu lệnh lỗi trong PostgreSQL huỷ cả transaction, nên
        // phải bọc savepoint rồi rollback về đó.
        await client.query('SAVEPOINT trigram_indexes');
        try {
            await client.query(TRIGRAM_INDEX_SQL);
            await client.query('RELEASE SAVEPOINT trigram_indexes');
        } catch (err: any) {
            await client.query('ROLLBACK TO SAVEPOINT trigram_indexes');
            console.warn(
                '[Database] Bỏ qua chỉ mục trigram (pg_trgm chưa khả dụng):',
                err?.message || err
            );
        }
    },
};

export const MIGRATIONS: Migration[] = [
    authMigration,
    brandKitMigration,
    billingMigration,
    announcementsMigration,
    helpdeskMigration,
    assetsMigration,
    pageViewsMigration,
    performanceIndexesMigration,
    videoHistoryMigration,
];

export interface MigrationResult {
    applied: string[];
    skipped: string[];
    /** Database đã có bảng nghiệp vụ trước khi có schema_migrations. */
    upgradedExisting: boolean;
}

/**
 * Áp dụng các migration còn thiếu.
 *
 * @returns Danh sách migration vừa áp dụng và đã bỏ qua (đã có phiên bản).
 */
export async function runMigrations(pool: Pool): Promise<MigrationResult> {
    const client = await pool.connect();
    let lockHeld = false;
    // Ghi lại timeout của session trước khi nới lỏng: `SET` KHÔNG phải `SET
    // LOCAL` nên nếu không khôi phục, kết nối trả về pool sẽ mất giới hạn
    // statement_timeout và request sau chạy trên đó có thể treo vô hạn.
    let previousTimeouts: { statement_timeout: string; lock_timeout: string } | null = null;
    try {
        const prevRes = await client.query(
            `SELECT current_setting('statement_timeout') AS statement_timeout,
                    current_setting('lock_timeout') AS lock_timeout`
        );
        previousTimeouts = {
            statement_timeout: String(prevRes.rows[0]?.statement_timeout ?? '0'),
            lock_timeout: String(prevRes.rows[0]?.lock_timeout ?? '0'),
        };
        // Migration là DDL có thể lâu trên bảng lớn: bỏ statement_timeout của
        // session này (pool mặc định 10s) để CREATE INDEX không bị huỷ giữa
        // chừng; vẫn giữ nguyên timeout cho các kết nối phục vụ request khác.
        await client.query("SET statement_timeout = 0");
        // Chờ tiến trình khác đang migrate thay vì bỏ cuộc giữa chừng.
        await client.query("SET lock_timeout = 0");

        // Khoá trước khi tạo bảng sổ đăng ký: hai tiến trình CREATE TABLE IF
        // NOT EXISTS đồng thời vẫn có thể đụng catalog lock.
        await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
        lockHeld = true;

        await client.query(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version VARCHAR(100) PRIMARY KEY,
                description TEXT NOT NULL DEFAULT '',
                applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);

        const existingSchemaRes = await client.query(
            `SELECT to_regclass('public.users') IS NOT NULL
                    AND to_regclass('public.orders') IS NOT NULL
                    AND to_regclass('public.tickets') IS NOT NULL AS has_schema`
        );
        const appliedRes = await client.query('SELECT version FROM schema_migrations');
        const applied = new Set<string>(appliedRes.rows.map((r) => String(r.version)));
        const upgradedExisting = Boolean(existingSchemaRes.rows[0]?.has_schema) && applied.size === 0;

        const justApplied: string[] = [];
        const skipped: string[] = [];

        for (const migration of MIGRATIONS) {
            if (applied.has(migration.version)) {
                skipped.push(migration.version);
                continue;
            }

            await client.query('BEGIN');
            try {
                await migration.up(client);
                await client.query(
                    `INSERT INTO schema_migrations (version, description)
                     VALUES ($1, $2)
                     ON CONFLICT (version) DO NOTHING`,
                    [migration.version, migration.description]
                );
                await client.query('COMMIT');
                justApplied.push(migration.version);
                console.log(
                    `[Database] Migration ${migration.version} (${migration.description}) đã áp dụng${upgradedExisting ? ' [nâng cấp schema cũ]' : ''}.`
                );
            } catch (err: any) {
                await client.query('ROLLBACK').catch(() => undefined);
                throw new Error(
                    `Migration ${migration.version} thất bại: ${err?.message || err}`
                );
            }
        }

        return { applied: justApplied, skipped, upgradedExisting };
    } finally {
        if (lockHeld) {
            await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => undefined);
        }
        // Khôi phục đúng giá trị cũ để kết nối về pool vẫn có timeout như cấu hình.
        if (previousTimeouts) {
            await client
                .query(
                    `SELECT set_config('statement_timeout', $1, false),
                            set_config('lock_timeout', $2, false)`,
                    [previousTimeouts.statement_timeout, previousTimeouts.lock_timeout]
                )
                .catch((err) => {
                    console.error('[Database] Không khôi phục được timeout của session:', err);
                });
        }
        client.release();
    }
}
