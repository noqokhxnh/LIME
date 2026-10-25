import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { type FastifyInstance } from 'fastify';
import { buildApp } from '../../src/index.js';
import { createTestSession } from '../../src/auth/session.js';
const ADMIN_ID = '00000000-0000-4000-a000-000000000001';
const authCookies = () => ({ vidtml_session: createTestSession(ADMIN_ID) });
import { getQueue } from '../../src/queue/index.js';
import { setLLMClient, type LLMClient } from '../../src/llm/client.js';
import { setTTSClient, type TTSClient, generateSilence } from '../../src/pipeline/audioSysnthesis.js';

class MockApiLLMClient implements LLMClient {
    readonly provider = 'mock-llm';
    constructor(private response: string) { }
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
    boundaries: [],
    colorPalette: {
        primary: '#3b82f6',
        secondary: '#1d4ed8',
        accent: '#f59e0b',
        background: '#0f172a',
        text: '#ffffff',
    },
    fontFamily: 'Inter',
};

describe('Module 11: Queue & Background Worker', () => {
    let app: FastifyInstance;

    before(async () => {
        setLLMClient(new MockApiLLMClient(JSON.stringify(sampleScript)));
        setTTSClient(new MockApiTTSClient());
        
        const queue = await getQueue();
        queue.startListeners();
        app = await buildApp({ queue, logger: false });
        await app.ready();
    });

    after(async () => {
        await app.close();
    });

    it('POST /api/pipeline with async: true should return 202 and queue the job', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/pipeline',
            cookies: authCookies(),
            payload: {
                prompt: 'queue test prompt',
                async: true,
                targetDurationSec: 15,
                aspectRatio: '16:9',
                language: 'en',
                style: 'modern'
            }
        });

        assert.strictEqual(res.statusCode, 202);
        const json = res.json();
        assert.ok(json.jobId);
        assert.strictEqual(json.message, "Video generation queued");
        
        const jobId = json.jobId;

        // Poll until completed.
        // Chạy cả bộ test song song trong CI khiến pipeline (Playwright + ffmpeg)
        // bị tranh tài nguyên, có lúc vượt mốc 15s cũ ⇒ nới lên ~60s cho ổn định.
        let jobResult = null;
        for (let i = 0; i < 120; i++) {
            const checkRes = await app.inject({
                method: 'GET',
                url: `/api/jobs/${jobId}`,
                cookies: authCookies()
            });
            assert.strictEqual(checkRes.statusCode, 200);
            const checkJson = checkRes.json();
            
            if (checkJson.status === 'completed') {
                jobResult = checkJson;
                break;
            }
            if (checkJson.status === 'failed') {
                assert.fail(`Job failed: ${checkJson.error}`);
            }
            await new Promise(r => setTimeout(r, 500));
        }

        assert.ok(jobResult, 'Job should complete within timeout');
        assert.strictEqual(jobResult.status, 'completed');
        assert.ok(jobResult.result);
    });

    it('GET /api/jobs/:jobId/events should return SSE events', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/pipeline',
            cookies: authCookies(),
            payload: {
                prompt: 'sse test prompt',
                async: true,
                targetDurationSec: 15,
                aspectRatio: '16:9',
                language: 'en',
                style: 'modern'
            }
        });
        
        const jobId = res.json().jobId;

        const streamRes = await app.inject({
            method: 'GET',
            url: `/api/jobs/${jobId}/events`,
            cookies: authCookies()
        });

        assert.strictEqual(streamRes.statusCode, 200);
        assert.strictEqual(streamRes.headers['content-type'], 'text/event-stream');
        
        const body = streamRes.body;
        assert.ok(body.includes('data:'), 'SSE stream should contain data chunks');
    });
});

describe('Queue trust boundary (dedup jobId, re-validate khi dequeue, chữ ký webhook queue)', () => {
    it('MemoryQueue: addJob trùng jobId ném JOB_ID_CONFLICT và không ghi đè job cũ', async () => {
        const { MemoryQueue } = await import('../../src/queue/memoryQueue.js');
        const { JobIdConflictError } = await import('../../src/queue/interfaces.js');
        const q = new MemoryQueue();
        const jobId = `conflict-${Date.now()}`;
        const data: any = {
            jobId,
            request: { prompt: 'first', targetDurationSec: 10, aspectRatio: '16:9' },
            outputDir: `/tmp/job-${jobId}`,
        };
        await q.addJob(jobId, data);
        await assert.rejects(
            () => q.addJob(jobId, { ...data, request: { prompt: 'hijack', targetDurationSec: 10, aspectRatio: '16:9' } }),
            (err: any) => err instanceof JobIdConflictError || err?.code === 'JOB_ID_CONFLICT'
        );
        const record = await q.getJob(jobId);
        assert.equal(record?.request?.prompt, 'first', 'Job gốc không được bị ghi đè');
        await q.close();
    });

    it('revalidateJobData: jobId nguy hiểm bị loại, outputDir thoát tmp bị suy lại, bgm ngoài vùng bị bỏ', async () => {
        const { revalidateJobData } = await import('../../src/queue/handler.js');
        const { safeJobDir } = await import('../../src/queue/jobPaths.js');
        const { join } = await import('node:path');

        assert.throws(
            () => revalidateJobData({ jobId: '../evil', request: { prompt: 'x' }, outputDir: '/tmp' } as any),
            /JOB_REJECTED/
        );
        assert.throws(
            () => revalidateJobData({ jobId: 'ok-id-1', request: { nope: true }, outputDir: '/tmp' } as any),
            'request sai schema phải bị loại ở biên worker'
        );

        const jobId = 'forge-123';
        const forged: any = {
            jobId,
            request: { prompt: 'legit prompt', targetDurationSec: 10, aspectRatio: '16:9' },
            outputDir: '/home/khxnh/evil',
            bgmPath: '/etc/passwd',
            userId: 'user-1',
        };
        const clean = revalidateJobData(forged);
        assert.equal(clean.outputDir, safeJobDir(jobId));
        assert.equal(clean.bgmPath, undefined);
        assert.equal(clean.userId, 'user-1');

        // Thư mục hợp lệ của route/CLI (trong tmp/, tên chứa jobId) được giữ nguyên
        const legitDir = join(process.cwd(), 'tmp', `job-${jobId}`);
        const clean2 = revalidateJobData({ ...forged, outputDir: legitDir, bgmPath: undefined });
        assert.equal(clean2.outputDir, legitDir);
    });

    it('queueAuth: ký/kiểm chứng payload webhook hàng đợi, sửa nội dung là mất hiệu lực', async () => {
        const { signWebhookPayload, verifyWebhookPayload, stripWebhookSignature } = await import('../../src/billing/queueAuth.js');
        const payload: any = { id: 424242, transfer_amount: 149000, content: 'LIME TEST' };

        assert.equal(verifyWebhookPayload(payload), false, 'Chưa ký → không hợp lệ');
        const signed = signWebhookPayload(payload);
        assert.equal(verifyWebhookPayload(signed), true);
        assert.equal(verifyWebhookPayload({ ...signed, transfer_amount: 1 }), false, 'Sửa số tiền → chữ ký sai');
        assert.equal(verifyWebhookPayload({ ...signed, _queueSig: 'deadbeef' }), false);
        const stripped = stripWebhookSignature(signed);
        assert.equal((stripped as any)._queueSig, undefined);
        assert.equal(stripped.transfer_amount, 149000);
    });
});
