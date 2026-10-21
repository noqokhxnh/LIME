import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { type FastifyInstance } from 'fastify';
import { buildApp } from '../../src/index.js';
import { createTestSession } from '../../src/auth/session.js';
import { userStore } from '../../src/admin/userStore.js';
import { systemSettings } from '../../src/admin/systemSettings.js';
import { auditLog } from '../../src/security/auditLog.js';
import { pageViewTracker } from '../../src/security/pageViewTracker.js';
import { maintenanceTracker } from '../../src/admin/maintenanceTracker.js';
import { setLLMClientFactory, resetLLMClientFactory } from '../../src/llm/client.js';
import { initDatabase, db } from '../../src/database/index.js';
import { getConfig } from '../../src/config.js';

describe('Admin, Profile, and Settings Test Suite', () => {
    let app: FastifyInstance;
    let adminToken: string;
    let userToken: string;

    const ADMIN_ID = '00000000-0000-4000-a000-000000000001';
    // Phải là UUID hợp lệ: cột `users.id` là kiểu UUID nên ở chế độ PostgreSQL thật
    // (job `postgres` trong CI) một id kiểu 'user-test-uuid-001' bị PostgreSQL từ chối
    // ⇒ người dùng không tồn tại và endpoint danh sách người dùng trả về rỗng.
    const NORMAL_USER_ID = '00000000-0000-4000-a000-000000000002';

    before(async () => {
        const config = getConfig();
        if (config.DATABASE_URL) {
            // Cổng quản trị đọc danh sách người dùng từ PostgreSQL chứ không đọc cache bộ
            // nhớ, nên ở chế độ PostgreSQL thật phải có sẵn hai hàng dữ liệu này. Trước đây
            // file này là test admin DUY NHẤT không tự tạo người dùng ⇒ trên một database
            // rỗng (đúng như job `postgres` trong CI) nó chỉ thấy dữ liệu do test khác chạy
            // song song chèn vào, nên lúc đỏ lúc xanh tuỳ thứ tự chạy.
            await initDatabase();
            // Dùng ĐÚNG danh tính mà `userStore` tự tạo trong bộ nhớ (xem SUPER_ADMIN_UUID /
            // ADMIN_EMAIL trong src/admin/userStore.ts): nhiều file test khác cũng dùng
            // ADMIN_ID này và đối chiếu email, nên hai chế độ phải khớp nhau.
            await db.query(
                `INSERT INTO users (id, username, email, password_hash, role, tier, credits, total_credits, status)
                 VALUES ($1, 'khanh2k5xxx', 'khanh2k5xxx@gmail.com', NULL, 'admin', 'enterprise', 10000, 10000, 'active')
                 ON CONFLICT DO NOTHING`,
                [ADMIN_ID],
            );
            await db.query(
                `INSERT INTO users (id, username, email, password_hash, role, tier, credits, total_credits, status)
                 VALUES ($1, 'lime_normal_test', 'lime_normal_test@lime.test', NULL, 'user', 'free', 15, 20, 'active')
                 ON CONFLICT DO NOTHING`,
                [NORMAL_USER_ID],
            );
        }

        const { getQueue } = await import('../../src/queue/index.js');
        const queue = await getQueue();
        queue.startListeners();
        app = await buildApp({ queue, logger: false });
        await app.ready();

        // Setup test user (đường dùng cho chế độ in-memory)
        await userStore.upsertUser({
            id: NORMAL_USER_ID,
            role: 'user',
            email: 'normaluser@example.com',
            username: 'normaluser',
            name: 'Normal User',
            tier: 'free',
            totalCredits: 20,
            credits: 15,
            creditPercent: 75,
            status: 'active',
        });

        adminToken = createTestSession(ADMIN_ID);
        userToken = createTestSession(NORMAL_USER_ID);
    });

    after(async () => {
        await app.close();
    });

    // -------------------------------------------------------------
    // 1. ROUTE ACCESS GUARDS (/admin, /profile, /setting)
    // -------------------------------------------------------------
    describe('TC-GUARD: Kiểm tra bảo vệ quyền truy cập các trang', () => {
        it('Khách chưa đăng nhập truy cập /admin phải bị chuyển hướng', async () => {
            const res = await app.inject({
                method: 'GET',
                url: '/admin',
            });
            assert.strictEqual(res.statusCode, 302);
            assert.match(res.headers.location || '', /auth=open/);
        });

        it('Người dùng thông thường (role: user) truy cập /admin phải bị từ chối 403', async () => {
            const res = await app.inject({
                method: 'GET',
                url: '/admin',
                cookies: { vidtml_session: userToken },
            });
            assert.strictEqual(res.statusCode, 403);
            const body = JSON.parse(res.body);
            assert.match(body.error, /Super Admin/);
        });

        it('Super Admin (role: admin) truy cập /admin phải trả về 200 OK với admin.html', async () => {
            const res = await app.inject({
                method: 'GET',
                url: '/admin',
                cookies: { vidtml_session: adminToken },
            });
            assert.strictEqual(res.statusCode, 200);
            assert.match(res.headers['content-type'] || '', /text\/html/);
            assert.match(res.body, /Super Admin Dashboard/);
        });

        it('Khách chưa đăng nhập truy cập /profile phải bị chuyển hướng', async () => {
            const res = await app.inject({
                method: 'GET',
                url: '/profile',
            });
            assert.strictEqual(res.statusCode, 302);
            assert.match(res.headers.location || '', /auth=open/);
        });

        it('Người dùng đã đăng nhập truy cập /profile phải trả về 200 OK với profile.html', async () => {
            const res = await app.inject({
                method: 'GET',
                url: '/profile',
                cookies: { vidtml_session: userToken },
            });
            assert.strictEqual(res.statusCode, 200);
            assert.match(res.headers['content-type'] || '', /text\/html/);
            assert.match(res.body, /credit-gauge-circle/);
            assert.match(res.body, /credit-percent-number/);
        });

        it('Khách chưa đăng nhập truy cập /setting phải bị chuyển hướng', async () => {
            const res = await app.inject({
                method: 'GET',
                url: '/setting',
            });
            assert.strictEqual(res.statusCode, 302);
        });

        it('Người dùng đã đăng nhập truy cập /setting và /settings phải trả về 200 OK', async () => {
            const res1 = await app.inject({
                method: 'GET',
                url: '/setting',
                cookies: { vidtml_session: userToken },
            });
            assert.strictEqual(res1.statusCode, 200);
            assert.match(res1.body, /Brand Kit & Watermark/);

            const res2 = await app.inject({
                method: 'GET',
                url: '/settings',
                cookies: { vidtml_session: userToken },
            });
            assert.strictEqual(res2.statusCode, 200);
        });
    });

    // -------------------------------------------------------------
    // 2. CREDIT PERCENTAGE CALCULATION
    // -------------------------------------------------------------
    describe('TC-CREDIT: Tính toán tỷ lệ phần trăm Credit (%)', () => {
        it('Tài khoản Super Admin phải có creditPercent đạt 100%', async () => {
            const admin = await userStore.findById(ADMIN_ID);
            assert.ok(admin);
            assert.strictEqual(admin.creditPercent, 100);
        });

        it('Tính toán tỷ lệ phần trăm chính xác khi thay đổi credits của người dùng', async () => {
            // Đặt credits = 10 trên total = 20 => 50%
            await userStore.setCredits(NORMAL_USER_ID, 10);
            const u1 = await userStore.findById(NORMAL_USER_ID);
            assert.ok(u1);
            assert.strictEqual(u1.creditPercent, Math.round((10 / u1.totalCredits) * 100));

            // Thêm credits +5
            await userStore.addCredits(NORMAL_USER_ID, 5);
            const u2 = await userStore.findById(NORMAL_USER_ID);
            assert.ok(u2);
            assert.strictEqual(u2.credits, 15);
            assert.strictEqual(u2.creditPercent, Math.round((15 / u2.totalCredits) * 100));

            // Trừ credits -15
            await userStore.deductCredits(NORMAL_USER_ID, 15);
            const u3 = await userStore.findById(NORMAL_USER_ID);
            assert.ok(u3);
            assert.strictEqual(u3.credits, 0);
            assert.strictEqual(u3.creditPercent, 0);
        });
    });

    // -------------------------------------------------------------
    // 3. SETTINGS API (/api/settings)
    // -------------------------------------------------------------
    describe('TC-SETTINGS: API Cấu hình người dùng & AI/TTS Provider', () => {
        it('GET /api/settings phải trả về cấu hình hiện tại và danh sách provider', async () => {
            const res = await app.inject({
                method: 'GET',
                url: '/api/settings',
                cookies: { vidtml_session: userToken },
            });
            assert.strictEqual(res.statusCode, 200);
            const body = JSON.parse(res.body);
            assert.ok(body.settings);
            assert.ok(Array.isArray(body.providers?.llm));
            assert.ok(Array.isArray(body.providers?.tts));
            assert.ok(body.providers.llm.includes('deepseek'));
            assert.ok(body.providers.tts.includes('edge'));
        });

        it('PUT /api/settings phải từ chối khi chưa đăng nhập', async () => {
            const res = await app.inject({
                method: 'PUT',
                url: '/api/settings',
                body: { llmProvider: 'gemini' },
            });
            assert.strictEqual(res.statusCode, 401);
        });

        it('PUT /api/settings phải lưu tùy chọn cá nhân thành công', async () => {
            const res = await app.inject({
                method: 'PUT',
                url: '/api/settings',
                cookies: { vidtml_session: userToken },
                body: {
                    llmProvider: 'deepseek',
                    llmModel: 'deepseek-chat',
                    ttsProvider: 'edge',
                    ttsVoice: 'vi-VN-HoaiMyNeural',
                    elevenlabsApiKey: 'test_key_123',
                },
            });
            assert.strictEqual(res.statusCode, 200);
            const body = JSON.parse(res.body);
            assert.strictEqual(body.success, true);
            assert.strictEqual(body.preferences.llmProvider, 'deepseek');
            assert.strictEqual(body.preferences.ttsProvider, 'edge');
        });
    });

    // -------------------------------------------------------------
    // 4. ADMIN API ENDPOINTS (/api/admin/*)
    // -------------------------------------------------------------
    describe('TC-ADMIN-API: Các API cổng Quản trị Super Admin', () => {
        it('Người dùng thông thường gọi /api/admin/stats phải bị 403 Forbidden', async () => {
            const res = await app.inject({
                method: 'GET',
                url: '/api/admin/stats',
                cookies: { vidtml_session: userToken },
            });
            assert.strictEqual(res.statusCode, 403);
        });

        it('Super Admin gọi GET /api/admin/stats phải trả về đầy đủ các chỉ số', async () => {
            const res = await app.inject({
                method: 'GET',
                url: '/api/admin/stats',
                cookies: { vidtml_session: adminToken },
            });
            assert.strictEqual(res.statusCode, 200);
            const body = JSON.parse(res.body);
            assert.ok(body.users);
            assert.ok(typeof body.users.total === 'number');
            assert.ok(body.jobs);
            assert.ok(body.revenue);
            assert.ok(body.system);
            assert.ok(body.stats); // Hỗ trợ định dạng stats của sidebar admin
            assert.ok(body.stats.views);
            assert.ok(body.stats.maintenance);
        });

        it('Super Admin gọi GET /api/admin/analytics phải trả về các chỉ số SaaS', async () => {
            const res = await app.inject({
                method: 'GET',
                url: '/api/admin/analytics?period=30d',
                cookies: { vidtml_session: adminToken },
            });
            assert.strictEqual(res.statusCode, 200);
            const body = JSON.parse(res.body);
            assert.strictEqual(body.period, '30d');
            assert.ok(body.kpi);
            assert.ok(typeof body.kpi.mrrVnd === 'number');
            assert.ok(typeof body.kpi.arrVnd === 'number');
            assert.ok(typeof body.kpi.arpuVnd === 'number');
            assert.ok(typeof body.kpi.ltvVnd === 'number');
            assert.ok(typeof body.kpi.churnRate === 'number');
            assert.ok(typeof body.kpi.trialToPaidRate === 'number');
            assert.ok(body.signups);
            assert.ok(Array.isArray(body.signups.series));
            assert.ok(body.revenue);
            assert.ok(body.churn);
            assert.ok(body.conversion);
            assert.ok(body.featureUsage);
            assert.ok(Array.isArray(body.featureUsage.dimensions));
        });

        it('Người dùng thông thường gọi /api/admin/analytics phải bị 403 Forbidden', async () => {
            const res = await app.inject({
                method: 'GET',
                url: '/api/admin/analytics',
                cookies: { vidtml_session: userToken },
            });
            assert.strictEqual(res.statusCode, 403);
        });


        it('Super Admin gọi GET /api/admin/users phải trả về danh sách người dùng', async () => {
            const res = await app.inject({
                method: 'GET',
                url: '/api/admin/users',
                cookies: { vidtml_session: adminToken },
            });
            assert.strictEqual(res.statusCode, 200);
            const body = JSON.parse(res.body);
            assert.ok(Array.isArray(body.users));
            assert.ok(body.total >= 1);
            const adminUser = body.users.find((u: any) => u.id === ADMIN_ID);
            assert.ok(adminUser);
            assert.strictEqual(adminUser.role, 'admin');
        });

        it('Super Admin gọi PATCH /api/admin/users/:userId cập nhật gói cước và hạn mức', async () => {
            const res = await app.inject({
                method: 'PATCH',
                url: `/api/admin/users/${NORMAL_USER_ID}`,
                cookies: { vidtml_session: adminToken },
                body: {
                    tier: 'pro',
                    credits: 50,
                    status: 'active',
                },
            });
            assert.strictEqual(res.statusCode, 200);
            const body = JSON.parse(res.body);
            assert.strictEqual(body.success, true);
            assert.strictEqual(body.user.tier, 'pro');
            assert.strictEqual(body.user.credits, 50);
        });

        it('Super Admin gọi GET & PUT /api/admin/settings để quản lý cấu hình toàn cục', async () => {
            // GET
            const getRes = await app.inject({
                method: 'GET',
                url: '/api/admin/settings',
                cookies: { vidtml_session: adminToken },
            });
            assert.strictEqual(getRes.statusCode, 200);
            const getData = JSON.parse(getRes.body);
            assert.ok(getData.settings);
            assert.ok(getData.providersStatus);

            // PUT
            const putRes = await app.inject({
                method: 'PUT',
                url: '/api/admin/settings',
                cookies: { vidtml_session: adminToken },
                body: {
                    maintenanceMode: false,
                    systemNotice: 'Thông báo bảo trì định kỳ từ Super Admin',
                },
            });
            assert.strictEqual(putRes.statusCode, 200);
            const putData = JSON.parse(putRes.body);
            assert.strictEqual(putData.success, true);
            assert.strictEqual(putData.settings.systemNotice, 'Thông báo bảo trì định kỳ từ Super Admin');
        });

        it('Super Admin gọi POST /api/admin/test-provider để kiểm tra kết nối', async () => {
            // test-provider nay gọi API thật; dùng factory thay thế để không phụ thuộc mạng.
            setLLMClientFactory((provider) => ({
                provider,
                async generate() {
                    return '{"status":"ok"}';
                },
            }) as any);
            try {
                const res = await app.inject({
                    method: 'POST',
                    url: '/api/admin/test-provider',
                    cookies: { vidtml_session: adminToken },
                    body: {
                        provider: '9router',
                        type: 'llm',
                    },
                });
                assert.strictEqual(res.statusCode, 200);
                const body = JSON.parse(res.body);
                assert.strictEqual(body.success, true, body.message);
                assert.strictEqual(body.provider, '9router');
            } finally {
                resetLLMClientFactory();
            }
        });

        it('Super Admin gọi GET /api/admin/audit-logs ghi nhận đầy đủ hành động', async () => {
            const res = await app.inject({
                method: 'GET',
                url: '/api/admin/audit-logs',
                cookies: { vidtml_session: adminToken },
            });
            assert.strictEqual(res.statusCode, 200);
            const body = JSON.parse(res.body);
            assert.ok(Array.isArray(body.logs));
            assert.ok(body.logs.length > 0);
        });

        it('Super Admin gọi GET /api/admin/views và /api/admin/maintenance', async () => {
            // Page views
            const viewsRes = await app.inject({
                method: 'GET',
                url: '/api/admin/views',
                cookies: { vidtml_session: adminToken },
            });
            assert.strictEqual(viewsRes.statusCode, 200);
            const viewsData = JSON.parse(viewsRes.body);
            assert.strictEqual(viewsData.success, true);

            // Maintenance logs
            const maintRes = await app.inject({
                method: 'GET',
                url: '/api/admin/maintenance',
                cookies: { vidtml_session: adminToken },
            });
            assert.strictEqual(maintRes.statusCode, 200);
            const maintData = JSON.parse(maintRes.body);
            assert.strictEqual(maintData.success, true);
        });
    });
});
