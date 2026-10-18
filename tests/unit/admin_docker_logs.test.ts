import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { type FastifyInstance } from 'fastify';
import { buildApp } from '../../src/index.js';
import { createTestSession, inMemorySessions } from '../../src/auth/session.js';
import { isAllowedContainer, ALLOWED_CONTAINERS } from '../../src/admin/dockerLogs.js';
import { userStore } from '../../src/admin/userStore.js';
import { getConfig } from '../../src/config.js';
import { initDatabase, db } from '../../src/database/index.js';

const ADMIN_ID = '00000000-0000-4000-a000-000000000001';
const REGULAR_USER_ID = '00000000-0000-4000-a000-000000000002';

describe('Admin Docker Logs Test Suite', () => {
    let app: FastifyInstance;
    let adminToken: string;
    let userToken: string;

    before(async () => {
        const config = getConfig();
        if (config.DATABASE_URL) {
            await initDatabase();
            await db.query(
                `INSERT INTO users (id, username, email, password_hash, role, tier, credits, total_credits, status)
                 VALUES ($1, 'khanh2k5xxx', 'khanh2k5xxx@gmail.com', NULL, 'admin', 'enterprise', 10000, 10000, 'active')
                 ON CONFLICT DO NOTHING`,
                [ADMIN_ID]
            );
            await db.query(
                `INSERT INTO users (id, username, email, password_hash, role, tier, credits, total_credits, status)
                 VALUES ($1, 'lime_normal_test', 'lime_normal_test@lime.test', NULL, 'user', 'free', 15, 20, 'active')
                 ON CONFLICT DO NOTHING`,
                [REGULAR_USER_ID]
            );
        }

        await userStore.upsertUser({
            id: REGULAR_USER_ID,
            username: 'lime_normal_test',
            email: 'lime_normal_test@lime.test',
            role: 'user',
            tier: 'free',
            credits: 20,
            totalCredits: 20,
            status: 'active',
        });

        app = await buildApp({ logger: false });
        await app.ready();

        adminToken = createTestSession(ADMIN_ID);
        userToken = createTestSession(REGULAR_USER_ID);
    });

    after(async () => {
        await app.close();
    });

    it('isAllowedContainer chỉ chấp nhận đúng 5 container trong whitelist', () => {
        for (const c of ALLOWED_CONTAINERS) {
            assert.strictEqual(isAllowedContainer(c), true);
        }
        assert.strictEqual(isAllowedContainer(''), false);
        assert.strictEqual(isAllowedContainer('evil_container'), false);
        assert.strictEqual(isAllowedContainer('../etc/passwd'), false);
        assert.strictEqual(isAllowedContainer('lime_server; rm -rf /'), false);
    });

    it('GET /api/admin/docker-logs/containers từ chối khi chưa đăng nhập (403)', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/admin/docker-logs/containers',
        });
        assert.strictEqual(res.statusCode, 403);
    });

    it('GET /api/admin/docker-logs/containers từ chối tài khoản không phải Admin (403)', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/admin/docker-logs/containers',
            cookies: { vidtml_session: userToken },
        });
        assert.strictEqual(res.statusCode, 403);
    });

    it('GET /api/admin/docker-logs/containers trả về danh sách 5 container khi đăng nhập Admin (200)', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/admin/docker-logs/containers',
            cookies: { vidtml_session: adminToken },
        });

        assert.strictEqual(res.statusCode, 200);
        const data = res.json();
        assert.ok(Array.isArray(data.containers));
        assert.strictEqual(data.containers.length, 5);

        const names = data.containers.map((c: any) => c.name);
        for (const expected of ALLOWED_CONTAINERS) {
            assert.ok(names.includes(expected), `Phải có container ${expected}`);
        }
    });

    it('GET /api/admin/docker-logs/download từ chối container không hợp lệ (400)', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/admin/docker-logs/download?container=invalid_container',
            cookies: { vidtml_session: adminToken },
        });
        assert.strictEqual(res.statusCode, 400);
        assert.match(res.json().error, /Container không hợp lệ/);
    });

    it('GET /api/admin/docker-logs/stream từ chối container không hợp lệ (400)', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/admin/docker-logs/stream?container=evil_box',
            cookies: { vidtml_session: adminToken },
        });
        assert.strictEqual(res.statusCode, 400);
    });

    it('GET /api/admin/docker-logs/download trả về text/plain cho container hợp lệ', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/admin/docker-logs/download?container=lime_server&tail=5',
            cookies: { vidtml_session: adminToken },
        });
        assert.strictEqual(res.statusCode, 200);
        assert.ok(res.headers['content-type']?.includes('text/plain'));
        assert.ok(res.headers['content-disposition']?.includes('attachment; filename="lime_server-logs-'));
    });
});
