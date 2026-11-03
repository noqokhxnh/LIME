import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../src/index.js';
import { installProcessGuards } from '../../src/security/processGuards.js';

describe('Global Error Handler & Process Guards (#131)', () => {
    it('app.setErrorHandler chuẩn hoá lỗi trả về JSON với statusCode và error', async () => {
        const app = await buildApp({ logger: false });
        
        // Đăng ký route ném lỗi để kiểm tra error handler
        app.get('/test-error-handler', async () => {
            const err: any = new Error('Custom validation failure');
            err.statusCode = 422;
            throw err;
        });

        const res = await app.inject({
            method: 'GET',
            url: '/test-error-handler',
        });

        assert.strictEqual(res.statusCode, 422);
        const body = res.json();
        assert.strictEqual(body.error, 'Custom validation failure');
        assert.strictEqual(body.statusCode, 422);

        await app.close();
    });

    it('installProcessGuards đăng ký các sự kiện an toàn cho process mà không văng lỗi', () => {
        assert.doesNotThrow(() => {
            installProcessGuards('TestGuards');
        });
    });
});
