import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { type FastifyInstance } from 'fastify';
import { buildApp } from '../../src/index.js';
import { createTestSession } from '../../src/auth/session.js';
import { userStore } from '../../src/admin/userStore.js';
import { getConfig } from '../../src/config.js';
import { db, initDatabase } from '../../src/database/index.js';
import { auditLog } from '../../src/security/auditLog.js';

/**
 * Bộ test cho module "Người dùng" của cổng quản trị.
 *
 * Trọng tâm (theo kết quả audit nghiệp vụ):
 *  - Danh sách người dùng: lọc/sắp xếp/tìm kiếm/phân trang phía server (trước đây
 *    nạp hết bảng `users` vào RAM rồi mới phân trang).
 *  - Gói cước: dropdown trước đây chỉ có free/pro/enterprise nên không gán được
 *    gói đang bán (creator/max) — nay API validate + chấp nhận đủ 5 tier.
 *  - PATCH: validate dữ liệu, chặn hạ quyền/khoá Super Admin và chính mình, và
 *    KHÔNG reset hạn gói khi admin chỉ sửa credits.
 *  - Đặt lại mật khẩu: trước đây luôn đặt về "12345678" và trả về nguyên văn;
 *    nay sinh mật khẩu tạm ngẫu nhiên, chặn tài khoản Google, thu hồi phiên cũ.
 *  - Lịch sử đăng nhập: trước đây không ghi nhận sự kiện nào nên tab luôn trống.
 *  - Xuất CSV: trước đây chỉ xuất các dòng đang hiển thị; nay xuất toàn bộ kết quả
 *    theo bộ lọc ở phía server.
 */
describe('Admin Users Management Test Suite', () => {
    let app: FastifyInstance;
    let adminToken: string;
    let userToken: string;

    const ADMIN_ID = '00000000-0000-4000-a000-000000000001';
    const SUPER_ADMIN_EMAIL = 'khanh2k5xxx@gmail.com';

    /** Hậu tố duy nhất mỗi lần chạy để không đụng dữ liệu cũ. */
    const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
    /**
     * Token tìm kiếm có chứa ký tự ngoài hệ thập lục phân (z, q, x) nên không thể
     * trùng với UUID hay địa chỉ IP → chỉ khớp đúng dữ liệu do test tạo ra.
     */
    const TOKEN = `zq${RUN}x`;

    const emailOf = (suffix: string) => `usertest_${TOKEN}_${suffix}@example.com`.toLowerCase();
    const usernameOf = (suffix: string) => `ut_${TOKEN}_${suffix}`.toLowerCase();

    /**
     * Mật khẩu test được sinh ngay lúc chạy thay vì viết cứng trong mã nguồn.
     * Việc viết cứng các chuỗi như "Password123" khiến công cụ quét bí mật
     * (GitGuardian…) báo động nhầm là mật khẩu thật bị lộ.
     */
    const PASSWORD = `Aa1!${RUN}pw`;
    const WRONG_PASSWORD = `Aa1!${RUN}x`;

    /** ID của 3 người dùng seed: credits 300 / 200 / 100, tier creator / pro / free. */
    const seededIds: string[] = [];
    const seededCredits = { a: 300, b: 200, c: 100 };

    const config = getConfig();

    async function seedUser(opts: {
        suffix: string;
        tier?: string;
        credits?: number;
        role?: string;
        status?: string;
        provider?: 'local' | 'google';
        planExpiresAt?: string | null;
        passwordHash?: string | null;
    }): Promise<string> {
        const id = randomUUID();
        const email = emailOf(opts.suffix);
        const username = usernameOf(opts.suffix);
        const tier = opts.tier ?? 'free';
        const credits = opts.credits ?? 20;
        const role = opts.role ?? 'user';
        const status = opts.status ?? 'active';
        const provider = opts.provider ?? 'local';
        const planId = ['creator', 'pro', 'max'].includes(tier) ? tier : null;

        if (config.DATABASE_URL) {
            await db.query(
                `INSERT INTO users (id, username, email, password_hash, google_id, role, tier, credits, total_credits, status, plan_id, plan_expires_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
                 ON CONFLICT (id) DO NOTHING`,
                [
                    id,
                    username,
                    email,
                    opts.passwordHash ?? null,
                    provider === 'google' ? `google-${id}` : null,
                    role,
                    tier,
                    credits,
                    Math.max(credits, 300),
                    status,
                    planId,
                    opts.planExpiresAt ?? null,
                ]
            );
        }

        await userStore.upsertUser({
            id,
            username,
            email,
            tier,
            credits,
            totalCredits: Math.max(credits, 300),
            role: role as any,
            status: status as any,
            provider,
            planId,
            planExpiresAt: opts.planExpiresAt ?? null,
        });

        return id;
    }

    const adminGet = (url: string, token = adminToken) =>
        app.inject({ method: 'GET', url, cookies: { vidtml_session: token } });

    before(async () => {
        if (config.DATABASE_URL) {
            await initDatabase();
        }

        const { getQueue } = await import('../../src/queue/index.js');
        const queue = await getQueue();
        queue.startListeners();
        app = await buildApp({ queue, logger: false });
        await app.ready();

        adminToken = createTestSession(ADMIN_ID);
        userToken = createTestSession(seededIds[0] || randomUUID());

        seededIds.push(await seedUser({ suffix: 'a', tier: 'creator', credits: seededCredits.a }));
        seededIds.push(await seedUser({ suffix: 'b', tier: 'pro', credits: seededCredits.b }));
        seededIds.push(await seedUser({ suffix: 'c', tier: 'free', credits: seededCredits.c }));
    });

    after(async () => {
        await app.close();
    });

    // ------------------------------------------------------------------
    // 1. Phân quyền
    // ------------------------------------------------------------------
    describe('1. Phân quyền truy cập', () => {
        it('Khách chưa đăng nhập nhận 403 khi xem danh sách người dùng', async () => {
            const res = await app.inject({ method: 'GET', url: '/api/admin/users' });
            assert.strictEqual(res.statusCode, 403);
        });

        it('Người dùng thường nhận 403 khi xem danh sách người dùng', async () => {
            const res = await adminGet('/api/admin/users', userToken);
            assert.strictEqual(res.statusCode, 403);
        });

        it('Khách chưa đăng nhập nhận 403 khi xuất CSV', async () => {
            const res = await app.inject({ method: 'GET', url: '/api/admin/users/export' });
            assert.strictEqual(res.statusCode, 403);
        });
    });

    // ------------------------------------------------------------------
    // 2. Danh sách người dùng (lọc / tìm kiếm / phân trang / sắp xếp)
    // ------------------------------------------------------------------
    describe('2. Danh sách người dùng', () => {
        it('Từ chối bộ lọc không hợp lệ bằng 400', async () => {
            for (const url of [
                '/api/admin/users?status=khong-ton-tai',
                '/api/admin/users?role=superuser',
                '/api/admin/users?tier=platinum',
            ]) {
                const res = await adminGet(url);
                assert.strictEqual(res.statusCode, 400, `URL sai: ${url}`);
            }
        });

        it('Chấp nhận đủ 5 gói cước, gồm creator và max (trước đây thiếu)', async () => {
            const res = await adminGet(`/api/admin/users?tier=creator&search=${TOKEN}`);
            assert.strictEqual(res.statusCode, 200);
            const body = JSON.parse(res.body);
            assert.strictEqual(body.total, 1);
            assert.strictEqual(body.users[0].id, seededIds[0]);
            assert.strictEqual(body.users[0].tier, 'creator');
        });

        it('Tìm kiếm theo email trả về đúng người dùng', async () => {
            const res = await adminGet(`/api/admin/users?search=${emailOf('b')}`);
            const body = JSON.parse(res.body);
            assert.strictEqual(body.total, 1);
            assert.strictEqual(body.users[0].id, seededIds[1]);
        });

        it('Phân trang phía server trả đủ tổng số và không trùng lặp', async () => {
            const page1 = JSON.parse((await adminGet(`/api/admin/users?search=${TOKEN}&page=1&limit=2`)).body);
            const page2 = JSON.parse((await adminGet(`/api/admin/users?search=${TOKEN}&page=2&limit=2`)).body);

            assert.strictEqual(page1.total, 3);
            assert.strictEqual(page1.page, 1);
            assert.strictEqual(page1.limit, 2);
            assert.strictEqual(page1.users.length, 2);
            assert.strictEqual(page2.users.length, 1);

            const ids = new Set([...page1.users.map((u: any) => u.id), ...page2.users.map((u: any) => u.id)]);
            assert.strictEqual(ids.size, 3, 'Hai trang không được trùng người dùng');
        });

        it('Sắp xếp theo credits giảm dần', async () => {
            const res = await adminGet(`/api/admin/users?search=${TOKEN}&sortBy=credits&sortOrder=desc&limit=10`);
            const body = JSON.parse(res.body);
            const credits = body.users.map((u: any) => u.credits);
            assert.deepStrictEqual(credits, [seededCredits.a, seededCredits.b, seededCredits.c]);
        });

        it('Lọc theo danh sách ID (dùng cho "xuất người dùng đã chọn")', async () => {
            const url = `/api/admin/users?search=${TOKEN}&ids=${seededIds[0]}&ids=${seededIds[2]}`;
            const body = JSON.parse((await adminGet(url)).body);
            assert.strictEqual(body.total, 2);
            const ids = body.users.map((u: any) => u.id).sort();
            assert.deepStrictEqual(ids, [seededIds[0], seededIds[2]].sort());
        });
    });

    // ------------------------------------------------------------------
    // 3. PATCH – cập nhật người dùng
    // ------------------------------------------------------------------
    describe('3. Cập nhật người dùng (PATCH)', () => {
        const patch = (userId: string, payload: unknown, token = adminToken) =>
            app.inject({
                method: 'PATCH',
                url: `/api/admin/users/${userId}`,
                cookies: { vidtml_session: token },
                payload,
            });

        it('Từ chối tier / role / status / credits không hợp lệ', async () => {
            const target = seededIds[2];
            const cases: Array<[unknown, string]> = [
                [{ tier: 'platinum' }, 'tier'],
                [{ role: 'superuser' }, 'role'],
                [{ status: 'sleeping' }, 'status'],
                [{ credits: -5 }, 'credits âm'],
                [{ credits: 1.5 }, 'credits thập phân'],
                [{ credits: 99999999 }, 'credits quá lớn'],
                [{ durationDays: 0 }, 'thời hạn 0'],
                [{ durationDays: 'abc' }, 'thời hạn không phải số'],
            ];

            for (const [payload, label] of cases) {
                const res = await patch(target, payload);
                assert.strictEqual(res.statusCode, 400, `Phải từ chối ${label}`);
            }
        });

        it('Sửa credits KHÔNG làm reset hạn gói cước', async () => {
            if (!config.DATABASE_URL) return; // chỉ kiểm chứng được khi có cột plan_expires_at thật
            const expiresAt = '2030-01-01T00:00:00.000Z';
            const target = await seedUser({ suffix: 'keep-exp', tier: 'creator', credits: 120, planExpiresAt: expiresAt });

            const res = await patch(target, { credits: 155 });
            assert.strictEqual(res.statusCode, 200, res.body);

            const body = JSON.parse(res.body);
            assert.strictEqual(body.user.credits, 155);
            assert.strictEqual(
                body.user.planExpiresAt,
                expiresAt,
                'Chỉ sửa credits không được đổi hạn gói'
            );
            assert.strictEqual(body.user.tier, 'creator');
            assert.strictEqual(body.user.planId, 'creator');
        });

        it('Đổi gói cước thì cập nhật hạn gói và plan_id tương ứng', async () => {
            if (!config.DATABASE_URL) return;
            const target = await seedUser({ suffix: 'upgrade', tier: 'free', credits: 20 });

            const before = await userStore.findById(target);
            assert.strictEqual(before?.tier, 'free');

            const res = await patch(target, { tier: 'pro' });
            assert.strictEqual(res.statusCode, 200, res.body);

            const body = JSON.parse(res.body);
            assert.strictEqual(body.user.tier, 'pro');
            assert.strictEqual(body.user.planId, 'pro');
            assert.ok(body.user.planExpiresAt, 'Đổi gói phải có hạn gói mới');

            const expires = new Date(body.user.planExpiresAt).getTime();
            const in29Days = Date.now() + 29 * 24 * 60 * 60 * 1000;
            assert.ok(expires > in29Days, 'Hạn gói mới phải xa hơn ~29 ngày');
        });

        it('Không cho hạ quyền / khoá Super Admin', async () => {
            const demote = await patch(ADMIN_ID, { role: 'user' });
            assert.strictEqual(demote.statusCode, 400);

            const ban = await patch(ADMIN_ID, { status: 'banned' });
            assert.strictEqual(ban.statusCode, 400);

            // Super Admin vẫn nguyên quyền và đang hoạt động
            const me = await adminGet('/api/admin/users', adminToken);
            assert.strictEqual(me.statusCode, 200);
        });

        it('Không cho admin tự hạ quyền hoặc tự khoá chính mình', async () => {
            const selfBan = await patch(ADMIN_ID, { status: 'banned' });
            assert.strictEqual(selfBan.statusCode, 400);
            assert.match(JSON.parse(selfBan.body).error, /chính mình|Super Admin/);

            const selfDemote = await patch(ADMIN_ID, { role: 'user' });
            assert.strictEqual(selfDemote.statusCode, 400);
        });

        it('Trả 404 khi người dùng không tồn tại', async () => {
            const res = await patch(randomUUID(), { credits: 10 });
            assert.strictEqual(res.statusCode, 404);
        });

        it('Không ghi audit log khi không có thay đổi nào', async () => {
            const target = seededIds[1];
            const before = auditLog.getRecent(200, 'admin.user_update').length;
            const res = await patch(target, { credits: seededCredits.b });
            assert.strictEqual(res.statusCode, 200);
            const after = auditLog.getRecent(200, 'admin.user_update').length;
            assert.strictEqual(after, before, 'Không có thay đổi thì không ghi log');
        });
    });

    // ------------------------------------------------------------------
    // 4. Đặt lại mật khẩu
    // ------------------------------------------------------------------
    describe('4. Đặt lại mật khẩu', () => {
        const resetPassword = (userId: string, payload?: unknown) =>
            app.inject({
                method: 'POST',
                url: `/api/admin/users/${userId}/reset-password`,
                cookies: { vidtml_session: adminToken },
                ...(payload === undefined ? {} : { payload }),
            });

        it('Từ chối tài khoản đăng nhập bằng Google', async () => {
            const googleUser = await seedUser({ suffix: 'google', provider: 'google' });
            const res = await resetPassword(googleUser);
            assert.strictEqual(res.statusCode, 400);
            assert.match(JSON.parse(res.body).error, /Google/);
        });

        it('Từ chối mật khẩu admin tự nhập nếu quá yếu', async () => {
            const target = seededIds[0];
            for (const weak of ['123', 'abcdefgh', '12345678']) {
                const res = await resetPassword(target, { newPassword: weak });
                assert.strictEqual(res.statusCode, 400, `Phải từ chối "${weak}"`);
            }
        });

        it('Trả 404 khi người dùng không tồn tại', async () => {
            const res = await resetPassword(randomUUID());
            assert.strictEqual(res.statusCode, 404);
        });

        it('Sinh mật khẩu tạm mạnh, không còn dùng "12345678", và thu hồi phiên cũ', async () => {
            if (!config.DATABASE_URL) return;

            const email = emailOf('reset');
            const created = await app.inject({
                method: 'POST',
                url: '/api/auth/register',
                payload: { username: usernameOf('reset'), email, password: PASSWORD },
            });
            assert.strictEqual(created.statusCode, 201, created.body);
            const userId = JSON.parse(created.body).id;

            // Phiên hiện tại của người dùng (dùng để kiểm tra thu hồi sau khi reset).
            const oldSession = createTestSession(userId);
            const beforeReset = await app.inject({
                method: 'GET',
                url: '/api/auth/me',
                cookies: { vidtml_session: oldSession },
            });
            assert.strictEqual(beforeReset.statusCode, 200);

            const res = await resetPassword(userId);
            assert.strictEqual(res.statusCode, 200, res.body);
            const body = JSON.parse(res.body);

            assert.strictEqual(body.generated, true);
            assert.ok(body.temporaryPassword, 'Phải trả về mật khẩu tạm');
            assert.notStrictEqual(body.temporaryPassword, '12345678');
            assert.ok(body.temporaryPassword.length >= 12, 'Mật khẩu tạm phải đủ dài');
            assert.match(body.temporaryPassword, /[A-Za-z]/);
            assert.match(body.temporaryPassword, /[0-9]/);
            assert.ok(!JSON.stringify(body.message).includes('12345678'));

            // Đăng nhập bằng mật khẩu tạm thành công.
            const newLogin = await app.inject({
                method: 'POST',
                url: '/api/auth/login',
                payload: { username: email, password: body.temporaryPassword },
            });
            assert.strictEqual(newLogin.statusCode, 200, newLogin.body);

            // Mật khẩu cũ không còn hiệu lực.
            const oldLogin = await app.inject({
                method: 'POST',
                url: '/api/auth/login',
                payload: { username: email, password: PASSWORD },
            });
            assert.strictEqual(oldLogin.statusCode, 401);

            // Phiên cũ đã bị thu hồi.
            const afterReset = await app.inject({
                method: 'GET',
                url: '/api/auth/me',
                cookies: { vidtml_session: oldSession },
            });
            assert.strictEqual(afterReset.statusCode, 401, 'Phiên cũ phải bị thu hồi sau khi đổi mật khẩu');
        });

        it('Từ chối khi hệ thống không có cơ sở dữ liệu (không báo thành công giả)', async () => {
            if (config.DATABASE_URL) return; // chỉ đúng khi chạy ở chế độ in-memory
            const target = await seedUser({ suffix: 'nodb' });
            const res = await resetPassword(target);
            assert.strictEqual(res.statusCode, 503);
        });
    });

    // ------------------------------------------------------------------
    // 5. Lịch sử đăng nhập
    // ------------------------------------------------------------------
    describe('5. Lịch sử đăng nhập', () => {
        it('Ghi nhận đăng ký/đăng nhập và trả về createdAt + IP thật', async () => {
            if (!config.DATABASE_URL) return;

            const email = emailOf('logs');
            const created = await app.inject({
                method: 'POST',
                url: '/api/auth/register',
                payload: { username: usernameOf('logs'), email, password: PASSWORD },
            });
            assert.strictEqual(created.statusCode, 201, created.body);
            const userId = JSON.parse(created.body).id;

            // Đăng nhập sai để có bản ghi thất bại.
            await app.inject({
                method: 'POST',
                url: '/api/auth/login',
                payload: { username: email, password: WRONG_PASSWORD },
            });

            const res = await adminGet(`/api/admin/users/${userId}/login-logs`);
            assert.strictEqual(res.statusCode, 200, res.body);
            const body = JSON.parse(res.body);
            assert.ok(body.logs.length >= 2, 'Phải có cả sự kiện đăng ký/đăng nhập và đăng nhập thất bại');

            const successEntry = body.logs.find((l: any) => l.action === 'auth.login' && l.status === 'success');
            assert.ok(successEntry, 'Phải có bản ghi đăng nhập thành công');
            assert.ok(successEntry.createdAt, 'Bản ghi phải có createdAt (trước đây frontend đọc createdAt nhưng API trả timestamp)');
            assert.ok(!Number.isNaN(new Date(successEntry.createdAt).getTime()), 'createdAt phải là ngày hợp lệ');
            assert.ok(successEntry.ipAddress, 'Phải ghi lại IP của người đăng nhập');

            const failedEntry = body.logs.find((l: any) => l.status === 'failure');
            assert.ok(failedEntry, 'Phải ghi lại lần đăng nhập thất bại');
        });

        it('Danh sách người dùng trả về IP/ thời điểm đăng nhập thật thay vì N/A', async () => {
            if (!config.DATABASE_URL) return;

            const email = emailOf('lastlogin');
            const created = await app.inject({
                method: 'POST',
                url: '/api/auth/register',
                payload: { username: usernameOf('lastlogin'), email, password: PASSWORD },
            });
            assert.strictEqual(created.statusCode, 201, created.body);
            const userId = JSON.parse(created.body).id;

            const body = JSON.parse((await adminGet(`/api/admin/users?search=${usernameOf('lastlogin')}`)).body);
            const user = body.users.find((u: any) => u.id === userId);
            assert.ok(user, 'Phải tìm thấy người dùng vừa đăng ký');
            assert.ok(user.lastLoginAt, 'Phải có thời điểm đăng nhập gần nhất');
            assert.ok(user.lastLoginIp, 'Phải có IP đăng nhập gần nhất');
            assert.ok(user.signupIp, 'Phải có IP đăng ký');
        });

        it('Lịch sử đăng nhập vẫn hoạt động khi bản ghi DB chưa kịp ghi (bộ đệm bộ nhớ)', async () => {
            const userId = randomUUID();
            auditLog.record({
                action: 'auth.login',
                userId,
                userEmail: 'buffer@example.com',
                ip: '203.0.113.9',
                status: 'success',
                details: { provider: 'local', location: 'Hà Nội', isp: 'Viettel' },
            });

            const logs = await userStore.getUserLoginLogs(userId, 10);
            assert.strictEqual(logs.length, 1);
            assert.strictEqual(logs[0].ipAddress, '203.0.113.9');
            assert.strictEqual(logs[0].location, 'Hà Nội');
            assert.strictEqual(logs[0].isp, 'Viettel');
            assert.ok(logs[0].createdAt, 'Bản ghi phải có createdAt');
        });

        it('Bộ lọc lịch sử chỉ lấy sự kiện xác thực, bỏ qua log của admin', async () => {
            const userId = randomUUID();
            auditLog.record({
                action: 'admin.user_update',
                userId,
                status: 'success',
                details: { updatedBy: 'admin@example.com' },
            });

            const logs = await userStore.getUserLoginLogs(userId, 10);
            assert.strictEqual(logs.length, 0, 'Không được lẫn log thao tác admin vào lịch sử đăng nhập');
        });
    });

    // ------------------------------------------------------------------
    // 6. Xuất CSV
    // ------------------------------------------------------------------
    describe('6. Xuất CSV', () => {
        const csvIds: string[] = [];

        before(async () => {
            // Nhãn riêng "csv" chỉ xuất hiện ở 3 người dùng này → đếm dòng chính xác.
            csvIds.push(await seedUser({ suffix: 'csvone', tier: 'free', credits: 11 }));
            csvIds.push(await seedUser({ suffix: 'csvtwo', tier: 'pro', credits: 22 }));
            csvIds.push(await seedUser({ suffix: 'csvthree', tier: 'max', credits: 33 }));
        });

        const dataLinesOf = (body: string) =>
            body
                .replace('\ufeff', '')
                .split('\r\n')
                .filter((line) => line.length > 0);

        it('Xuất toàn bộ kết quả theo bộ lọc (không giới hạn theo trang)', async () => {
            const res = await adminGet(`/api/admin/users/export?search=${TOKEN}_csv`);
            assert.strictEqual(res.statusCode, 200, res.body);
            assert.match(res.headers['content-type'] as string, /text\/csv/);
            assert.match(res.headers['content-disposition'] as string, /attachment/);

            const csv = res.body;
            assert.ok(csv.startsWith('\ufeff'), 'CSV phải có BOM UTF-8 để Excel đọc đúng');
            assert.ok(csv.includes('"ID","Username","Email"'), 'CSV phải có dòng tiêu đề');

            const dataLines = dataLinesOf(csv);
            assert.strictEqual(dataLines.length, 1 + 3, 'Phải có 1 dòng tiêu đề + 3 dòng dữ liệu');
            for (const suffix of ['csvone', 'csvtwo', 'csvthree']) {
                assert.ok(csv.includes(emailOf(suffix)), `CSV phải chứa ${emailOf(suffix)}`);
            }
        });

        it('Xuất đúng những người dùng đã chọn qua tham số ids', async () => {
            const res = await adminGet(`/api/admin/users/export?ids=${csvIds[0]}&ids=${csvIds[2]}`);
            assert.strictEqual(res.statusCode, 200);

            const dataLines = dataLinesOf(res.body);
            assert.strictEqual(dataLines.length, 1 + 2, 'Phải có 1 dòng tiêu đề + đúng 2 dòng dữ liệu');
            assert.ok(res.body.includes(emailOf('csvone')));
            assert.ok(res.body.includes(emailOf('csvthree')));
            assert.ok(!res.body.includes(emailOf('csvtwo')));
        });
    });

    // ------------------------------------------------------------------
    // 7. Chỉ mục hiệu năng
    // ------------------------------------------------------------------
    describe('7. Chỉ mục hiệu năng', () => {
        it('Có chỉ mục phục vụ lịch sử đăng nhập theo người dùng', async () => {
            if (!config.DATABASE_URL) return;
            const res = await db.query(
                `SELECT indexname FROM pg_indexes WHERE indexname = $1`,
                ['idx_audit_logs_user_action_created_at']
            );
            assert.strictEqual(res.rows.length, 1, 'Thiếu idx_audit_logs_user_action_created_at');
        });
    });
});
