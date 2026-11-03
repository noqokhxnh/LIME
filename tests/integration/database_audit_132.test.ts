import test, { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { getConfig } from '../../src/config.js';
import { db, initDatabase } from '../../src/database/index.js';
import { MIGRATIONS } from '../../src/database/migrations.js';
import { billingStorage } from '../../src/billing/storage.js';
import { vietQrBillingService } from '../../src/billing/vietqrService.js';
import { userStore } from '../../src/admin/userStore.js';
import { helpdeskStore } from '../../src/helpdesk/store.js';
import { createTestSession, cleanupExpiredSessions } from '../../src/auth/session.js';
import { buildApp } from '../../src/index.js';
import type { FastifyInstance } from 'fastify';

/**
 * Hồi quy cho Issue #132 (audit PostgreSQL).
 *
 * Toàn bộ file chỉ chạy khi có DATABASE_URL thật — các hành vi cần kiểm chứng
 * (deadlock, unique conflict đồng thời, transaction rollback, advisory lock
 * migration) không thể chứng minh bằng mock. Trên CI không có PostgreSQL, các
 * test được đánh dấu SKIPPED một cách tường minh (không phải "passed").
 *
 * Dữ liệu test dùng UUID/prefix riêng (`IT132-`), KHÔNG gọi resetForTesting()
 * để không xoá dữ liệu của các suite integration khác chạy song song.
 */
const hasDb = Boolean(getConfig().DATABASE_URL);
const skip = hasDb ? false : 'DATABASE_URL chưa cấu hình — bỏ qua test PostgreSQL thật';

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
const TEST_USER_IDS: string[] = [];
const TEST_SEPAY_REFS: string[] = [];
const TEST_TICKET_IDS: string[] = [];

function newUserId(): string {
    const id = randomUUID();
    TEST_USER_IDS.push(id);
    return id;
}

async function seedUser(credits = 20, displayName?: string): Promise<{ id: string; email: string }> {
    const id = newUserId();
    const email = `it132_${RUN}_${id.slice(0, 8)}@test.local`;
    await db.query(
        `INSERT INTO users (id, username, email, display_name, credits, total_credits, tier, status)
         VALUES ($1, $2, $3, $4, $5, $5, 'free', 'active')`,
        [id, `it132_${id.slice(0, 8)}`, email, displayName || null, credits]
    );
    return { id, email };
}

function sepayRef(label: string): string {
    const ref = `IT132-${label}-${RUN}-${randomBytes(3).toString('hex')}`;
    TEST_SEPAY_REFS.push(ref);
    return ref;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`TIMEOUT: ${label} quá ${ms}ms (nghi deadlock)`)), ms);
        promise.then(
            (value) => { clearTimeout(timer); resolve(value); },
            (err) => { clearTimeout(timer); reject(err); }
        );
    });
}

describe('Issue #132 — PostgreSQL audit regressions', () => {
    let app: FastifyInstance | null = null;
    const createdAttachmentTickets: string[] = [];

    before(async () => {
        if (!hasDb) return;
        await initDatabase();
    });

    after(async () => {
        if (!hasDb) return;
        if (app) await app.close();

        const ids = TEST_USER_IDS;
        if (ids.length > 0) {
            await db.query(`DELETE FROM payments WHERE order_id IN (SELECT id FROM orders WHERE user_id = ANY($1::uuid[]))`, [ids]);
            await db.query(`DELETE FROM orders WHERE user_id = ANY($1::uuid[])`, [ids]);
            await db.query(`DELETE FROM sessions WHERE user_id = ANY($1::uuid[])`, [ids]);
            await db.query(`DELETE FROM tickets WHERE user_id = ANY($1::uuid[])`, [ids]);
            await db.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [ids]);
        }
        if (TEST_SEPAY_REFS.length > 0) {
            await db.query(`DELETE FROM payments WHERE sepay_ref = ANY($1::text[])`, [TEST_SEPAY_REFS]);
            await db.query(`DELETE FROM unmatched_payments WHERE sepay_ref = ANY($1::text[])`, [TEST_SEPAY_REFS]);
        }
        for (const id of createdAttachmentTickets) {
            await db.query(`DELETE FROM tickets WHERE id = $1`, [id]);
        }
    });

    it('Task 1.1 — page_views có DDL, insert/select chạy được trên PostgreSQL thật', { skip }, async () => {
        const id = randomUUID();
        await db.query(
            `INSERT INTO page_views (id, ip, path, user_agent, browser, os, device, referrer, location, isp, country, city, user_id, user_email, created_at)
             VALUES ($1, '127.0.0.1', '/it132', 'ua', 'Chrome', 'Linux', 'Desktop', 'direct', 'HCM', 'ISP', 'VN', 'HCM', $2, $3, NOW())`,
            [id, null, 'it132@test.local']
        );
        const res = await db.query(`SELECT id, path, created_at FROM page_views WHERE id = $1`, [id]);
        assert.equal(res.rows.length, 1);
        assert.equal(res.rows[0].path, '/it132');
        await db.query(`DELETE FROM page_views WHERE id = $1`, [id]);
    });

    it('Phase 3 — migration chạy lặp lại và đồng thời vẫn idempotent (advisory lock)', { skip }, async () => {
        await Promise.all([initDatabase(), initDatabase(), initDatabase()]);
        const res = await db.query(`SELECT version FROM schema_migrations ORDER BY version`);
        const versions = res.rows.map((r) => String(r.version));
        assert.equal(versions.length, MIGRATIONS.length);
        assert.equal(new Set(versions).size, versions.length);
        for (const migration of MIGRATIONS) {
            assert.ok(versions.includes(migration.version), `thiếu migration ${migration.version}`);
        }
    });

    it('Task 2.1 — index dư thừa bị bỏ, composite index mới tồn tại', { skip }, async () => {
        const res = await db.query(
            `SELECT tablename, indexname FROM pg_indexes WHERE schemaname = 'public'`
        );
        const names = new Set(res.rows.map((r) => String(r.indexname)));
        assert.equal(names.has('idx_orders_pay_code'), false, 'idx_orders_pay_code trùng UNIQUE phải bị xoá');
        assert.equal(names.has('idx_payments_result'), false, 'idx_payments_result là tiền tố, phải bị xoá');
        assert.equal(names.has('idx_unmatched_payments_status'), false, 'idx_unmatched_payments_status là tiền tố, phải bị xoá');
        assert.equal(names.has('idx_orders_user_status_created'), true);
        assert.equal(names.has('idx_payments_order_received_at'), true);
    });

    it('Task 1.2 — findIdsBySearch tìm theo display_name (không còn lỗi users.name)', { skip }, async () => {
        const marker = `IT132DN${RUN}`;
        const user = await seedUser(20, `${marker} Nguyễn Văn Test`);
        const ids = await userStore.findIdsBySearch(marker);
        assert.ok(ids.includes(user.id), `phải tìm thấy user qua display_name, nhận: ${JSON.stringify(ids)}`);
    });

    it('Task 1.3 — cùng một webhook gửi 2 lần ĐỒNG THỜI: 1 payment, credits chỉ cộng 1 lần', { skip }, async () => {
        const user = await seedUser(20);
        const order = await vietQrBillingService.createOrder(user.id, 'pro');
        const ref = sepayRef('SAME');
        const payload = {
            id: ref,
            reference_code: ref,
            transfer_type: 'in',
            transfer_amount: order.amount_vnd,
            content: `THANH TOAN ${order.pay_code}`,
        };

        const [r1, r2] = await Promise.all([
            vietQrBillingService.processWebhook(payload),
            vietQrBillingService.processWebhook(payload),
        ]);
        assert.equal(r1.success, true);
        assert.equal(r2.success, true);

        const results = [r1.result, r2.result];
        assert.ok(results.includes('matched'), `một lần phải matched, nhận ${JSON.stringify(results)}`);
        assert.ok(
            results.some((r) => r && (r.startsWith('idempotent') || r.startsWith('duplicate'))),
            `lần còn lại phải idempotent/duplicate, nhận ${JSON.stringify(results)}`
        );

        const payments = await db.query(`SELECT * FROM payments WHERE sepay_ref = $1`, [ref]);
        assert.equal(payments.rows.length, 1, 'cùng sepay_ref chỉ được có 1 bút toán');
        assert.equal(payments.rows[0].result, 'matched');

        const credits = await db.query(`SELECT credits FROM users WHERE id = $1`, [user.id]);
        assert.equal(Number(credits.rows[0].credits), 20 + 150, 'credits chỉ được cộng đúng 1 gói');
    });

    it('Task 1.3 — hai webhook KHÁC nhau thanh toán cùng đơn: 2 bút toán, credits chỉ cộng 1 lần', { skip }, async () => {
        const user = await seedUser(20);
        const order = await vietQrBillingService.createOrder(user.id, 'pro');
        const refA = sepayRef('DIF-A');
        const refB = sepayRef('DIF-B');
        const makePayload = (ref: string) => ({
            id: ref,
            reference_code: ref,
            transfer_type: 'in',
            transfer_amount: order.amount_vnd,
            content: `THANH TOAN ${order.pay_code}`,
        });

        const [r1, r2] = await Promise.all([
            vietQrBillingService.processWebhook(makePayload(refA)),
            vietQrBillingService.processWebhook(makePayload(refB)),
        ]);
        assert.equal(r1.success, true);
        assert.equal(r2.success, true);

        const payments = await db.query(
            `SELECT sepay_ref, result FROM payments WHERE sepay_ref = ANY($1::text[]) ORDER BY sepay_ref`,
            [[refA, refB]]
        );
        assert.equal(payments.rows.length, 2, 'hai giao dịch khác nhau đều phải có bút toán');
        assert.deepEqual(
            payments.rows.map((r) => r.result).sort(),
            ['duplicate', 'matched']
        );

        const credits = await db.query(`SELECT credits FROM users WHERE id = $1`, [user.id]);
        assert.equal(Number(credits.rows[0].credits), 20 + 150, 'không được cộng credits hai lần');
    });

    it('Task 1.4 — thanh toán đồng thời 2 đơn của cùng user: không deadlock, không double fulfillment', { skip }, async () => {
        const user = await seedUser(20);
        const orderA = await vietQrBillingService.createOrder(user.id, 'pro');
        const orderB = await vietQrBillingService.createOrder(user.id, 'creator');
        const storedA = await billingStorage.findOrderById(orderA.order_id);
        const storedB = await billingStorage.findOrderById(orderB.order_id);
        assert.ok(storedA && storedB);

        const fulfill = (order: typeof storedA, label: string) =>
            withTimeout(
                billingStorage.lockAndFulfillOrder({
                    orderId: order!.id,
                    sepayRef: sepayRef(label),
                    receivedAmount: order!.amount_vnd,
                    raw: { label },
                    planDays: 30,
                    quotaVideo: 150,
                    planId: order!.plan_id,
                    result: 'matched',
                }),
                5_000,
                label
            );

        const [a, b] = await Promise.all([
            fulfill(storedA, 'LOCK-A'),
            fulfill(storedB, 'LOCK-B'),
        ]);
        assert.equal([a, b].filter((r) => r.success).length, 1, 'đúng một đơn được thanh toán');

        const credits = await db.query(`SELECT credits FROM users WHERE id = $1`, [user.id]);
        assert.equal(Number(credits.rows[0].credits), 20 + 150, 'chỉ cộng quota của một đơn');
    });

    it('Task 1.5 — createTicket rollback cả ticket khi ghi message thất bại (không orphan)', { skip }, async () => {
        const user = await seedUser(20);
        const tag = `IT132-FAIL-${RUN}`;
        const fn = `it132_fail_msg_${RUN}`;
        const trigger = `it132_fail_msg_${RUN}`;

        await db.query(`
            CREATE OR REPLACE FUNCTION ${fn}() RETURNS trigger AS $$
            BEGIN
                IF NEW.body = 'IT132_TRIGGER_FAIL' THEN
                    RAISE EXCEPTION 'forced message failure for issue 132';
                END IF;
                RETURN NEW;
            END
            $$ LANGUAGE plpgsql
        `);
        await db.query(`
            CREATE TRIGGER ${trigger}
            BEFORE INSERT ON ticket_messages
            FOR EACH ROW EXECUTE FUNCTION ${fn}()
        `);

        try {
            await assert.rejects(
                helpdeskStore.createTicket({
                    userId: user.id,
                    userEmail: user.email,
                    subject: `${tag} subject`,
                    category: 'bug',
                    body: 'IT132_TRIGGER_FAIL',
                })
            );
        } finally {
            await db.query(`DROP TRIGGER IF EXISTS ${trigger} ON ticket_messages`);
            await db.query(`DROP FUNCTION IF EXISTS ${fn}()`);
        }

        const res = await db.query(`SELECT id FROM tickets WHERE subject = $1`, [`${tag} subject`]);
        assert.equal(res.rows.length, 0, 'message thất bại ⇒ ticket phải rollback, không để orphan');
    });

    it('Task 1.5 — mã ticket trùng được retry an toàn trong transaction mới', { skip }, async () => {
        const user = await seedUser(20);
        // Cố định Math.random: lần thử 1 sinh LIME-T-AAAAAA (đã tồn tại),
        // lần thử 2 sinh LIME-T-BBBBBB.
        await db.query(
            `INSERT INTO tickets (id, code, user_id, subject, category, priority, status)
             VALUES ($1, 'LIME-T-AAAAAA', $2, 'IT132 collision seed', 'other', 'normal', 'open')`,
            [randomUUID(), user.id]
        );

        const originalRandom = Math.random;
        let calls = 0;
        Math.random = () => {
            calls++;
            return calls <= 6 ? 0 : 0.04;
        };
        let created;
        try {
            created = await helpdeskStore.createTicket({
                userId: user.id,
                userEmail: user.email,
                subject: `IT132-RETRY-${RUN}`,
                category: 'bug',
                body: 'retry body',
            });
        } finally {
            Math.random = originalRandom;
        }
        TEST_TICKET_IDS.push(created.id);
        assert.equal(created.code, 'LIME-T-BBBBBB');
        const msg = await db.query(`SELECT COUNT(*)::int AS c FROM ticket_messages WHERE ticket_id = $1`, [created.id]);
        assert.equal(Number(msg.rows[0].c), 1, 'retry chỉ được để lại đúng 1 message');
    });

    it('Task 1.6 — addCredits/deductCredits đồng thời không mất cập nhật', { skip }, async () => {
        const user = await seedUser(0);
        await Promise.all(Array.from({ length: 20 }, () => userStore.addCredits(user.id, 5)));
        let row = await db.query(`SELECT credits, total_credits FROM users WHERE id = $1`, [user.id]);
        assert.equal(Number(row.rows[0].credits), 100, '20 lần +5 phải thành 100, không lost update');
        assert.ok(Number(row.rows[0].total_credits) >= 100);

        const results = await Promise.all(
            Array.from({ length: 10 }, () => userStore.deductCredits(user.id, 7))
        );
        assert.ok(results.every((r) => r.success));
        row = await db.query(`SELECT credits FROM users WHERE id = $1`, [user.id]);
        assert.equal(Number(row.rows[0].credits), 30, '10 lần -7 từ 100 phải còn 30');

        await userStore.deductCredits(user.id, 10_000);
        row = await db.query(`SELECT credits FROM users WHERE id = $1`, [user.id]);
        assert.equal(Number(row.rows[0].credits), 0, 'credits không được âm');
    });

    it('Task 1.7 — hai request sửa hai preference khác nhau không ghi đè nhau', { skip }, async () => {
        const user = await seedUser(20);
        const token = createTestSession(user.id);
        app = await buildApp({ logger: false });
        await app.ready();

        const put = (payload: Record<string, unknown>) =>
            app!.inject({
                method: 'PUT',
                url: '/api/settings',
                payload,
                cookies: { vidtml_session: token },
            });

        const [r1, r2] = await Promise.all([
            put({ llmProvider: 'deepseek' }),
            put({ ttsVoice: 'vi-female' }),
        ]);
        assert.equal(r1.statusCode, 200, r1.body);
        assert.equal(r2.statusCode, 200, r2.body);

        const row = await db.query(`SELECT preferences FROM users WHERE id = $1`, [user.id]);
        assert.equal(row.rows[0].preferences.llmProvider, 'deepseek');
        assert.equal(row.rows[0].preferences.ttsVoice, 'vi-female');
    });

    it('Phase 3 — cleanupExpiredSessions chỉ xoá phiên hết hạn', { skip }, async () => {
        const user = await seedUser(20);
        const expired = randomBytes(32).toString('hex');
        const active = randomBytes(32).toString('hex');
        await db.query(
            `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, NOW() - INTERVAL '1 day')`,
            [expired, user.id]
        );
        await db.query(
            `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '1 day')`,
            [active, user.id]
        );

        await cleanupExpiredSessions();

        const res = await db.query(
            `SELECT token_hash FROM sessions WHERE token_hash = ANY($1::text[])`,
            [[expired, active]]
        );
        const remaining = res.rows.map((r) => r.token_hash);
        assert.equal(remaining.includes(expired), false, 'session hết hạn phải bị xoá');
        assert.equal(remaining.includes(active), true, 'session còn hiệu lực phải được giữ');
    });

    it('Task 2.2 — listForUser/findTicketByAttachment lọc ở SQL, nhiều user không lẫn dữ liệu', { skip }, async () => {
        const userA = await seedUser(20);
        const userB = await seedUser(20);
        const tagA = `IT132-A-${RUN}`;
        const tagB = `IT132-B-${RUN}`;

        const ticketA = await helpdeskStore.createTicket({
            userId: userA.id,
            userEmail: userA.email,
            subject: `${tagA} ticket`,
            category: 'bug',
            body: 'A body',
            attachments: [{ url: `/uploads/tickets/${tagA}-shot.png` }],
        });
        const ticketB = await helpdeskStore.createTicket({
            userId: userB.id,
            userEmail: userB.email,
            subject: `${tagB} ticket`,
            category: 'bug',
            body: 'B body',
            attachments: [{ url: `/uploads/tickets/${tagB}-shot.png` }],
        });
        createdAttachmentTickets.push(ticketA.id, ticketB.id);

        const listA = await helpdeskStore.listForUser(userA.id, { page: 1, limit: 50 });
        assert.equal(listA.total, 1, 'user A chỉ thấy ticket của mình');
        assert.equal(listA.items[0].id, ticketA.id);
        assert.equal(listA.items.some((t) => t.id === ticketB.id), false, 'không lẫn ticket user B');

        const foundA = await helpdeskStore.findTicketByAttachment(`${tagA}-shot.png`);
        const foundB = await helpdeskStore.findTicketByAttachment(`${tagB}-shot.png`);
        assert.equal(foundA?.id, ticketA.id);
        assert.equal(foundB?.id, ticketB.id);
        assert.equal(await helpdeskStore.findTicketByAttachment(`missing-${RUN}.png`), null);
    });

    it('Task 2.3 — COUNT của listUsersForAdmin khớp danh sách khi có/không search', { skip }, async () => {
        const marker = `IT132CNT${RUN}`;
        await seedUser(20, `${marker} Một`);
        await seedUser(20, `${marker} Hai`);

        const noSearch = await userStore.listUsersForAdmin({ search: marker, limit: 50, page: 1 });
        assert.equal(noSearch.total, 2);
        assert.equal(noSearch.users.length, 2);

        const withFilter = await userStore.listUsersForAdmin({ search: marker, tier: 'free', limit: 1, page: 1 });
        assert.equal(withFilter.total, 2, 'total phải tính toàn bộ kết quả, không chỉ trang hiện tại');
        assert.equal(withFilter.users.length, 1);
    });
});
