import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../src/index.js';
import { MemoryQueue } from '../../src/queue/memoryQueue.js';
import { createTestSession } from '../../src/auth/session.js';

const ADMIN_ID = '00000000-0000-4000-a000-000000000001';
const authCookies = () => ({ vidtml_session: createTestSession(ADMIN_ID) });

describe('SSE and Stream Leak Guards (#131)', () => {
    it('SSE tự đóng khi job nhận trạng thái cancelled', async () => {
        const queue = new MemoryQueue();
        const app = await buildApp({ queue, logger: false });

        const jobId = 'test-job-sse-cancel';
        await queue.addJob(jobId, {
            jobId,
            userId: ADMIN_ID,
            request: { prompt: 'cancel test', aspectRatio: '16:9', targetDurationSec: 10, language: 'vi', style: 'minimal' },
        });

        // Hủy job ngay
        await queue.cancelJob(jobId);

        const res = await app.inject({
            method: 'GET',
            url: `/api/jobs/${jobId}/events`,
            cookies: authCookies(),
        });

        assert.strictEqual(res.statusCode, 200);
        // Kiểm tra stream đã đóng và chứa trạng thái cancelled
        assert.match(res.body, /cancelled/);

        await app.close();
    });
});
