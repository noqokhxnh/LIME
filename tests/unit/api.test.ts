import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { type FastifyInstance } from 'fastify';
import { buildApp } from '../../src/index.js';
import { setLLMClient, resetLLMClient, type LLMClient } from '../../src/llm/client.js';
import { setTTSClient, resetTTSClient, generateSilence, type TTSClient } from '../../src/pipeline/audioSysnthesis.js';

class MockApiLLMClient implements LLMClient {
    readonly provider = 'mock-llm';
    constructor(private response: string) {}
    async generate(): Promise<string> {
        return this.response;
    }
}

class MockApiTTSClient implements TTSClient {
    readonly provider = 'mock-tts';
    async synthesize(_text: string, outputPath: string): Promise<void> {
        await generateSilence(outputPath, 0.5);
    }
}

const sampleScript = {
    id: 'api-script-01',
    title: 'API Test Video',
    description: 'API test description',
    globalStyles: 'body { margin: 0; }',
    globalSetupJs: 'console.log("ready");',
    scenes: [
        {
            id: 'scene-1',
            title: 'Scene 1',
            voiceOverText: 'Xin chao Viet Nam.',
            visualDescription: '',
            htmlCode: '<div class="scene" id="scene-1"><h1>Test</h1></div>',
            cssCode: '',
            jsCode: 'tl.to("#scene-1", { duration: {{SCENE_DURATION}}, opacity: 1 });',
            transition: 'fade',
            backgroundColor: '#000000',
        }
    ],
    colorPalette: {
        primary: '#3b82f6',
        secondary: '#1d4ed8',
        accent: '#f59e0b',
        background: '#0f172a',
        text: '#ffffff',
    },
    fontFamily: 'Inter',
};

describe('Module 9: Fastify API Server & Health Endpoint (src/index.ts)', () => {
    let app: FastifyInstance;

    before(async () => {
        setLLMClient(new MockApiLLMClient(JSON.stringify(sampleScript)));
        setTTSClient(new MockApiTTSClient());
        app = await buildApp({ logger: false });
        app.post('/test-body-size', async (request) => {
            const body = request.body as { data: string };
            return { receivedBytes: body.data.length };
        });
        await app.ready();
    });

    after(async () => {
        resetLLMClient();
        resetTTSClient();
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

    describe('TC-API-003: Endpoint kiểm tra chẩn đoán hệ thống (GET /api/health)', () => {
        it('phải trả về status ok cùng thông tin llmProvider và ttsProvider', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/api/health',
            });

            assert.strictEqual(response.statusCode, 200);
            const body = response.json();
            assert.strictEqual(body.status, 'ok');
            assert.ok(typeof body.llmProvider === 'string');
            assert.ok(typeof body.ttsProvider === 'string');
            assert.ok(typeof body.timestamp === 'string');
        });
    });

    describe('TC-API-004: Endpoint sinh kịch bản nháp (POST /api/script/draft)', () => {
        it('phải từ chối yêu cầu khi dữ liệu body không hợp lệ (prompt quá ngắn)', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/api/script/draft',
                payload: {
                    promt: 'ngan',
                    aspectRatio: '16:9',
                    targetDurationSec: 30,
                    language: 'vi',
                    style: 'modern',
                },
            });

            assert.strictEqual(response.statusCode, 400);
            const body = response.json();
            assert.strictEqual(body.success, false);
            assert.ok(body.error);
        });
    });

    describe('TC-API-005: Endpoint thực thi pipeline (POST /api/pipeline)', () => {
        it('phải trả về lỗi 400 khi thiếu thông số videoRequest', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/api/pipeline',
                payload: {},
            });

            assert.strictEqual(response.statusCode, 400);
            const body = response.json();
            assert.strictEqual(body.error, 'Invalid video request');
        });

        it('phải hỗ trợ chế độ bất đồng bộ (async: true) và trả về 202 Accepted', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/api/pipeline',
                payload: {
                    promt: 'Video gioi thieu du lich Ha Noi 3 canh',
                    aspectRatio: '16:9',
                    targetDurationSec: 20,
                    language: 'vi',
                    style: 'modern',
                    async: true,
                    skipPreview: true,
                },
            });

            assert.strictEqual(response.statusCode, 202);
            const body = response.json();
            assert.strictEqual(body.message, 'Video generation queued');
            assert.ok(body.jobId);
            assert.ok(body.checkStatusUrl.includes(body.jobId));
        });
    });

    describe('TC-API-006: Endpoint truy xuất danh sách và chi tiết công việc (GET /api/jobs)', () => {
        it('phải trả về danh sách các công việc đã ghi nhận', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/api/jobs',
            });

            assert.strictEqual(response.statusCode, 200);
            const body = response.json();
            assert.ok(Array.isArray(body));
        });

        it('phải trả về lỗi 404 khi jobId không tồn tại', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/api/jobs/non-existent-uuid',
            });

            assert.strictEqual(response.statusCode, 404);
            const body = response.json();
            assert.strictEqual(body.error, 'Job not found');
        });
    });
});
