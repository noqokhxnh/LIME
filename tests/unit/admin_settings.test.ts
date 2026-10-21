import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { type FastifyInstance } from 'fastify';
import { buildApp } from '../../src/index.js';
import { createTestSession } from '../../src/auth/session.js';
import { getConfig } from '../../src/config.js';
import { db, initDatabase } from '../../src/database/index.js';
import { systemSettings, validateSettingsPatch } from '../../src/admin/systemSettings.js';
import { MemoryQueue } from '../../src/queue/memoryQueue.js';
import { setLLMClientFactory, resetLLMClientFactory } from '../../src/llm/client.js';

/**
 * Bộ test cho module "Cài đặt hệ thống" của cổng quản trị.
 *
 * Trọng tâm (theo kết quả audit nghiệp vụ): các cài đặt trước đây chỉ được LƯU mà
 * không hề được ÁP DỤNG:
 *  - `registrationEnabled` không chặn được đăng ký.
 *  - `freeCreditsOnRegister` bị bỏ qua (credit tặng cứng là 20).
 *  - `maintenanceMode` không chặn được API của người dùng thường.
 *  - `maxConcurrentJobs` bị bỏ qua (hàng đợi cứng 2 job song song).
 *  - `POST /api/admin/test-provider` trả về "độ trễ" ngẫu nhiên mà không gọi API thật.
 *  - `PUT /api/admin/settings` nhận dữ liệu bất kỳ, không kiểm tra hợp lệ.
 */

const ADMIN_ID = '00000000-0000-4000-a000-000000000001';

/** Hậu tố duy nhất mỗi lần chạy để không đụng dữ liệu cũ. */
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
const TOKEN = `zq${RUN}x`;

/**
 * Giá trị dùng làm mật khẩu cho tài khoản test, sinh tại thời điểm chạy nên không
 * phải bí mật thật (tránh công cụ quét secret báo nhầm).
 */
function makeCredential(): string {
    return `Aa1${randomUUID().replace(/-/g, '')}`;
}
const CREDENTIAL = makeCredential();

const config = getConfig();

describe('Admin Settings Test Suite', () => {
    let app: FastifyInstance;
    let adminToken: string;
    let original: {
        registrationEnabled: boolean;
        freeCreditsOnRegister: number;
        maxConcurrentJobs: number;
        maintenanceMode: boolean;
        allowSandboxPayments: boolean;
    };

    const adminGet = (url: string, token = adminToken) =>
        app.inject({ method: 'GET', url, cookies: { vidtml_session: token } });

    const adminPut = (url: string, payload: unknown, token = adminToken) =>
        app.inject({ method: 'PUT', url, payload: payload as any, cookies: { vidtml_session: token } });

    before(async () => {
        if (config.DATABASE_URL) {
            await initDatabase();
        }
        const s = systemSettings.get();
        original = {
            registrationEnabled: s.registrationEnabled,
            freeCreditsOnRegister: s.freeCreditsOnRegister,
            maxConcurrentJobs: s.maxConcurrentJobs,
            maintenanceMode: s.maintenanceMode,
            allowSandboxPayments: s.allowSandboxPayments,
        };

        app = await buildApp({ logger: false });
        await app.ready();
        adminToken = createTestSession(ADMIN_ID);
    });

    after(async () => {
        await app.close();
        // Trả cài đặt về trạng thái ban đầu để không ảnh hưởng test khác.
        systemSettings.update(original);
        resetLLMClientFactory();
    });

    // ------------------------------------------------------------------
    // 1. Phân quyền
    // ------------------------------------------------------------------
    it('Chặn người dùng thường (403) ở các API cài đặt', async () => {
        const userToken = createTestSession('00000000-0000-4000-a000-0000000000ff');
        const cases = [
            { method: 'GET' as const, url: '/api/admin/settings' },
            { method: 'PUT' as const, url: '/api/admin/settings', payload: { maintenanceMode: false } },
            { method: 'POST' as const, url: '/api/admin/test-provider', payload: { type: 'llm', provider: '9router' } },
        ];
        for (const c of cases) {
            const res = await app.inject({ ...c, cookies: { vidtml_session: userToken } });
            assert.strictEqual(res.statusCode, 403, `${c.method} ${c.url} phải trả 403`);
        }
    });

    // ------------------------------------------------------------------
    // 2. Đọc cài đặt
    // ------------------------------------------------------------------
    it('Trả về đầy đủ các trường cài đặt', async () => {
        const res = await adminGet('/api/admin/settings');
        assert.strictEqual(res.statusCode, 200, res.body);
        const s = res.json().settings;
        for (const key of [
            'maintenanceMode',
            'registrationEnabled',
            'freeCreditsOnRegister',
            'maxConcurrentJobs',
            'allowSandboxPayments',
        ]) {
            assert.ok(key in s, `Thiếu trường ${key}`);
        }
    });

    // ------------------------------------------------------------------
    // 3. Kiểm tra hợp lệ khi cập nhật
    // ------------------------------------------------------------------
    describe('3. Validate cập nhật cài đặt', () => {
        it('Từ chối maxConcurrentJobs không hợp lệ', async () => {
            for (const value of [0, -1, 1.5, 'abc', 999]) {
                const res = await adminPut('/api/admin/settings', { maxConcurrentJobs: value });
                assert.strictEqual(res.statusCode, 400, `maxConcurrentJobs=${value} phải bị từ chối (nhận ${res.statusCode})`);
            }
        });

        it('Từ chối freeCreditsOnRegister âm', async () => {
            const res = await adminPut('/api/admin/settings', { freeCreditsOnRegister: -5 });
            assert.strictEqual(res.statusCode, 400);
        });

        it('Từ chối giá trị boolean sai kiểu', async () => {
            const res = await adminPut('/api/admin/settings', { maintenanceMode: 'yes' });
            assert.strictEqual(res.statusCode, 400);
        });

        it('Lưu được cài đặt hợp lệ và đọc lại đúng', async () => {
            const res = await adminPut('/api/admin/settings', {
                maxConcurrentJobs: 5,
                freeCreditsOnRegister: 33,
                registrationEnabled: true,
                maintenanceMode: false,
            });
            assert.strictEqual(res.statusCode, 200, res.body);

            const after = await adminGet('/api/admin/settings');
            const s = after.json().settings;
            assert.strictEqual(s.maxConcurrentJobs, 5);
            assert.strictEqual(s.freeCreditsOnRegister, 33);
        });

        it('validateSettingsPatch là hàm thuần (kiểm tra biên)', () => {
            assert.strictEqual(validateSettingsPatch({ maxConcurrentJobs: 1 }), null);
            assert.strictEqual(validateSettingsPatch({ maxConcurrentJobs: 20 }), null);
            assert.ok(validateSettingsPatch({ maxConcurrentJobs: 21 }));
            assert.strictEqual(validateSettingsPatch({ freeCreditsOnRegister: 0 }), null);
            assert.ok(validateSettingsPatch({ freeCreditsOnRegister: -1 }));
            assert.strictEqual(validateSettingsPatch({ maintenanceMode: true }), null);
            assert.ok(validateSettingsPatch({ maintenanceMode: 1 }));
            assert.ok(validateSettingsPatch(null));
        });
    });

    // ------------------------------------------------------------------
    // 4. registrationEnabled + freeCreditsOnRegister (cần DB thật)
    // ------------------------------------------------------------------
    describe('4. Áp dụng registrationEnabled & freeCreditsOnRegister', () => {
        const email = `settingstest_${TOKEN}_reg@example.com`;
        const username = `st_${TOKEN}_reg`;

        async function register() {
            return app.inject({
                method: 'POST',
                url: '/api/auth/register',
                payload: { username, email, password: CREDENTIAL },
            });
        }

        after(async () => {
            if (!config.DATABASE_URL) return;
            try {
                await db.query('DELETE FROM users WHERE LOWER(email) = LOWER($1)', [email]);
            } catch {
                /* bỏ qua */
            }
        });

        it('Chặn đăng ký khi registrationEnabled = false', async () => {
            if (!config.DATABASE_URL) return; // đăng ký cần PostgreSQL
            await adminPut('/api/admin/settings', { registrationEnabled: false });

            const res = await register();
            assert.strictEqual(res.statusCode, 403, res.body);
            assert.match(res.json().error, /đăng ký/i);

            await adminPut('/api/admin/settings', { registrationEnabled: true });
        });

        it('Tặng đúng số credit cấu hình khi đăng ký', async () => {
            if (!config.DATABASE_URL) return;
            await adminPut('/api/admin/settings', { registrationEnabled: true, freeCreditsOnRegister: 7 });

            const res = await register();
            assert.strictEqual(res.statusCode, 201, res.body);
            assert.strictEqual(res.json().credits, 7, 'Credit tặng phải theo freeCreditsOnRegister, không phải 20 cứng');
            assert.strictEqual(res.json().totalCredits, 7);
        });
    });

    // ------------------------------------------------------------------
    // 5. maintenanceMode
    // ------------------------------------------------------------------
    describe('5. Áp dụng maintenanceMode', () => {
        after(async () => {
            await adminPut('/api/admin/settings', { maintenanceMode: false });
        });

        it('Chặn API người dùng thường nhưng vẫn cho admin và các route thiết yếu', async () => {
            await adminPut('/api/admin/settings', { maintenanceMode: true });

            // Người dùng thường (không phiên) → 503.
            const blocked = await app.inject({ method: 'GET', url: '/api/jobs' });
            assert.strictEqual(blocked.statusCode, 503, blocked.body);

            // Admin vẫn dùng được.
            const adminOk = await app.inject({ method: 'GET', url: '/api/jobs', cookies: { vidtml_session: adminToken } });
            assert.strictEqual(adminOk.statusCode, 200, adminOk.body);

            // Route thiết yếu vẫn mở: /api/settings (để hiển thị thông báo) và /api/auth/*.
            const settings = await app.inject({ method: 'GET', url: '/api/settings' });
            assert.notStrictEqual(settings.statusCode, 503, '/api/settings phải được phép khi bảo trì');
            const auth = await app.inject({ method: 'GET', url: '/api/auth/me' });
            assert.notStrictEqual(auth.statusCode, 503, '/api/auth/* phải được phép khi bảo trì');

            // Tắt bảo trì → người dùng thường vào lại được.
            await adminPut('/api/admin/settings', { maintenanceMode: false });
            const reopened = await app.inject({ method: 'GET', url: '/api/jobs' });
            assert.strictEqual(reopened.statusCode, 200, reopened.body);
        });
    });

    // ------------------------------------------------------------------
    // 6. maxConcurrentJobs áp dụng cho hàng đợi
    // ------------------------------------------------------------------
    it('Hàng đợi tôn trọng maxConcurrentJobs', async () => {
        await adminPut('/api/admin/settings', { maxConcurrentJobs: 1 });

        const queue = new MemoryQueue();
        const blockers = new Map<string, () => void>();
        queue.process(async (data) => {
            await new Promise<void>((resolve) => blockers.set(data.jobId, resolve));
            return { jobId: data.jobId, durationSec: 1, qaStatus: 'pass' } as any;
        });

        const mk = (id: string) => ({ jobId: id, request: { prompt: id } as any, outputDir: `/tmp/${id}` });
        await queue.addJob('conc-1', mk('conc-1'));
        await queue.addJob('conc-2', mk('conc-2'));
        await new Promise((r) => setTimeout(r, 20));

        const first = await queue.getJob('conc-1');
        const second = await queue.getJob('conc-2');
        assert.strictEqual(first?.status, 'running', 'Job 1 phải chạy');
        assert.strictEqual(second?.status, 'queued', 'Với maxConcurrentJobs=1, job 2 phải còn chờ');

        blockers.get('conc-1')?.();
        for (const resolve of blockers.values()) resolve();
        await queue.close();
    });

    // ------------------------------------------------------------------
    // 7. test-provider phải gọi thật
    // ------------------------------------------------------------------
    describe('7. Kiểm tra nhà cung cấp (test-provider)', () => {
        after(() => resetLLMClientFactory());

        it('Trả 400 khi loại kiểm tra không hợp lệ', async () => {
            const res = await app.inject({
                method: 'POST',
                url: '/api/admin/test-provider',
                payload: { type: 'khong-ton-tai' },
                cookies: { vidtml_session: adminToken },
            });
            assert.strictEqual(res.statusCode, 400, res.body);
        });

        it('Lỗi rõ ràng khi provider TTS không tồn tại (không báo thành công giả)', async () => {
            const res = await app.inject({
                method: 'POST',
                url: '/api/admin/test-provider',
                payload: { type: 'tts', provider: 'khong-ton-tai' },
                cookies: { vidtml_session: adminToken },
            });
            assert.strictEqual(res.statusCode, 200, res.body);
            const body = res.json();
            assert.strictEqual(body.success, false, 'Trước đây trả success giả; nay phải thất bại vì thực sự gọi provider');
            assert.match(body.message, /giọng đọc|provider/i);
        });

        it('Thực sự gọi client LLM (dùng factory có thể thay thế)', async () => {
            let calledWith: string | null = null;
            setLLMClientFactory((provider) => {
                calledWith = provider;
                return {
                    provider,
                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                    async generate() {
                        return '{"status":"ok"}';
                    },
                } as any;
            });

            const res = await app.inject({
                method: 'POST',
                url: '/api/admin/test-provider',
                payload: { type: 'llm', provider: '9router' },
                cookies: { vidtml_session: adminToken },
            });
            assert.strictEqual(res.statusCode, 200, res.body);
            const body = res.json();
            assert.strictEqual(body.success, true, body.message);
            assert.strictEqual(calledWith, '9router', 'Phải thực sự tạo client LLM cho provider yêu cầu');
            assert.match(body.message, /thành công/i);
        });
    });
});
