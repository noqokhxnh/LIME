import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { type FastifyInstance } from 'fastify';
import { buildApp } from '../../src/index.js';

describe('Module 9: Fastify API Server & Health Endpoint (src/index.ts)', () => {
    let app: FastifyInstance;

    before(async () => {
        app = await buildApp({ logger: false });
        app.post('/test-body-size', async (request) => {
            const body = request.body as { data: string };
            return { receivedBytes: body.data.length };
        });
        await app.ready();
    });

    after(async () => {
        await app.close();
    });

    describe('TC-API-001: Endpoint kiểm tra trạng thái sức khỏe (GET /)', () => {
        it('phải trả về mã trạng thái 200 OK', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/',
            });

            assert.strictEqual(response.statusCode, 200);
        });

        it('phải trả về body định dạng JSON chứa status "ok" và timestamp ISO hợp lệ', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/',
            });

            const body = response.json();
            assert.strictEqual(body.status, 'ok');
            assert.ok(typeof body.timestamp === 'string');

            const parsedDate = Date.parse(body.timestamp);
            assert.ok(!isNaN(parsedDate), 'Timestamp phải là chuỗi định dạng ISO Date hợp lệ');

            // Thời gian trả về phải sát với thời điểm hiện tại (dung sai 10 giây)
            assert.ok(Math.abs(Date.now() - parsedDate) < 10000);
        });
    });

    describe('TC-API-002: Kiểm tra cấu hình CORS và Giới hạn Body Limit', () => {
        it('phải cho phép CORS từ mọi nguồn (origin: true)', async () => {
            const testOrigin = 'http://localhost:5173';
            const response = await app.inject({
                method: 'GET',
                url: '/',
                headers: {
                    origin: testOrigin,
                },
            });

            assert.strictEqual(response.statusCode, 200);
            assert.strictEqual(
                response.headers['access-control-allow-origin'],
                testOrigin,
                'Phải phản hồi Access-Control-Allow-Origin khớp với Origin gửi lên'
            );
        });

        it('phải hỗ trợ OPTIONS Preflight Request cho CORS', async () => {
            const response = await app.inject({
                method: 'OPTIONS',
                url: '/',
                headers: {
                    origin: 'http://localhost:3000',
                    'access-control-request-method': 'GET',
                },
            });

            assert.strictEqual(response.statusCode, 204);
            assert.ok(response.headers['access-control-allow-origin']);
        });

        it('phải cấu hình giới hạn kích thước Body Limit là 10MB', () => {
            const expectedLimit = 10 * 1024 * 1024; // 10MB in bytes
            assert.strictEqual(app.initialConfig.bodyLimit, expectedLimit);
        });

        it('phải chấp nhận payload JSON dung lượng lớn (2MB) mà không báo lỗi 413', async () => {
            const payloadSize = 2 * 1024 * 1024; // 2MB string
            const largeData = 'a'.repeat(payloadSize);

            const response = await app.inject({
                method: 'POST',
                url: '/test-body-size',
                payload: {
                    data: largeData,
                },
            });

            assert.strictEqual(response.statusCode, 200);
            assert.strictEqual(response.json().receivedBytes, payloadSize);
        });

        it('phải từ chối lỗi 413 FST_ERR_CTP_BODY_TOO_LARGE khi payload vượt quá 10MB', async () => {
            const oversizedBytes = 11 * 1024 * 1024; // 11MB (> 10MB)
            const oversizedData = 'x'.repeat(oversizedBytes);

            const response = await app.inject({
                method: 'POST',
                url: '/test-body-size',
                payload: {
                    data: oversizedData,
                },
            });

            assert.strictEqual(response.statusCode, 413, 'Phải trả về mã 413 Payload Too Large');
        });
    });
});
