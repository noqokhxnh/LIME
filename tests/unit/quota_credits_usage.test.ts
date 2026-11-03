import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../src/index.js';
import { InMemoryRateLimiter, RedisRateLimiter } from '../../src/security/rateLimiter.js';
import { defaultTokenTracker } from '../../src/usage/tokenTracker.js';
import { userStore } from '../../src/admin/userStore.js';
import { createTestSession } from '../../src/auth/session.js';

describe('Rate Limit, Quotas, Credits & Usage (#131)', () => {
    it('InMemoryRateLimiter quản lý RPM, concurrency và daily quota chính xác', () => {
        const limiter = new InMemoryRateLimiter();
        const id = 'test-user-rate-1';

        // RPM limit (max 3)
        assert.strictEqual(limiter.checkRpm(id, 3, 2), true);
        assert.strictEqual(limiter.checkRpm(id, 3, 2), false); // vượt 3

        // Concurrency (max 2)
        assert.strictEqual(limiter.acquireConcurrentJob(id, 2), true);
        assert.strictEqual(limiter.acquireConcurrentJob(id, 2), true);
        assert.strictEqual(limiter.acquireConcurrentJob(id, 2), false); // đầy slot
        limiter.releaseConcurrentJob(id);
        assert.strictEqual(limiter.acquireConcurrentJob(id, 2), true); // nhả slot thành công

        // Daily quota (max 2)
        assert.strictEqual(limiter.checkAndIncrementDailyQuota(id, 2), true);
        assert.strictEqual(limiter.checkAndIncrementDailyQuota(id, 2), true);
        assert.strictEqual(limiter.checkAndIncrementDailyQuota(id, 2), false); // đầy quota ngày (lần 3)
        limiter.refundDailyQuota(id);
        assert.strictEqual(limiter.checkAndIncrementDailyQuota(id, 2), true); // hoàn quota thành công
    });

    it('RedisRateLimiter tự động fallback về bộ nhớ khi không có kết nối Redis', async () => {
        const limiter = new RedisRateLimiter('redis://127.0.0.1:9999'); // invalid redis
        const id = 'test-fallback-user';

        assert.strictEqual(await limiter.acquireConcurrentJob(id, 2), true);
        assert.strictEqual(await limiter.acquireConcurrentJob(id, 2), true);
        assert.strictEqual(await limiter.acquireConcurrentJob(id, 2), false);
        await limiter.releaseConcurrentJob(id);
        assert.strictEqual(await limiter.acquireConcurrentJob(id, 2), true);
    });

    it('Từ chối 402 Insufficient credits khi user không đủ credits', async () => {
        const app = await buildApp({ logger: false });
        const brokeUserId = '00000000-0000-4000-a000-000000000999';
        await userStore.upsertUser({
            id: brokeUserId,
            username: 'broke_user',
            email: 'broke@example.com',
            role: 'user',
            tier: 'free',
            credits: 0,
            status: 'active',
        });

        const res = await app.inject({
            method: 'POST',
            url: '/api/generate',
            cookies: { vidtml_session: createTestSession(brokeUserId) },
            payload: {
                prompt: 'test broke video',
                async: true,
                aspectRatio: '16:9',
                targetDurationSec: 10,
                language: 'vi',
                style: 'modern'
            }
        });

        assert.strictEqual(res.statusCode, 402);
        const json = res.json();
        assert.strictEqual(json.error, 'Insufficient credits');

        await app.close();
    });

    it('GET /api/usage trả về summary và recent tokens của user', async () => {
        const app = await buildApp({ logger: false });
        const testUserId = '00000000-0000-4000-a000-000000000888';
        await userStore.upsertUser({
            id: testUserId,
            username: 'test_usage_user',
            email: 'usage@example.com',
            role: 'user',
            tier: 'pro',
            credits: 10,
            status: 'active',
        });

        defaultTokenTracker.record({
            userId: testUserId,
            provider: 'openai',
            model: 'gpt-4o',
            promptTokens: 100,
            completionTokens: 200,
        });

        const res = await app.inject({
            method: 'GET',
            url: '/api/usage',
            cookies: { vidtml_session: createTestSession(testUserId) },
        });

        assert.strictEqual(res.statusCode, 200);
        const body = res.json();
        assert.strictEqual(body.success, true);
        assert.strictEqual(body.summary.totalRequests >= 1, true);
        assert.strictEqual(body.summary.totalPromptTokens >= 100, true);

        await app.close();
    });
});
