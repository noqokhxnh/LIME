import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { type FastifyInstance } from 'fastify';
import { buildApp } from '../../src/index.js';
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
    title: 'API Test Video',
    fontFamily: 'Inter',
    colorPalette: { primary: '#3366cc', secondary: '#ff9900', background: '#ffffff', text: '#000000' },
    scenes: [ { id: 'scene-1', durationSec: 5, transition: 'fade', text: 'Hello', visualPrompt: 'hello', audioPrompt: 'hello' } ]
};

describe('Module 11: Queue & Background Worker', () => {
    let app: FastifyInstance;

    before(async () => {
        setLLMClient(new MockApiLLMClient(JSON.stringify(sampleScript)));
        setTTSClient(new MockApiTTSClient());
        
        const queue = await getQueue();
        queue.startListeners();
        app = await buildApp(queue, { logger: false });
        await app.ready();
    });

    after(async () => {
        await app.close();
    });

    it('POST /api/pipeline with async: true should return 202 and queue the job', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/pipeline',
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

        // Poll until completed
        let jobResult = null;
        for (let i = 0; i < 30; i++) {
            const checkRes = await app.inject({
                method: 'GET',
                url: `/api/jobs/${jobId}`
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

    it('GET /api/jobs/:jobId/stream should return SSE events', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/pipeline',
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
            url: `/api/jobs/${jobId}/stream`
        });

        assert.strictEqual(streamRes.statusCode, 200);
        assert.strictEqual(streamRes.headers['content-type'], 'text/event-stream');
        
        const body = streamRes.body;
        assert.ok(body.includes('data:'), 'SSE stream should contain data chunks');
    });
});
