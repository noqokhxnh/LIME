import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { type FastifyInstance } from 'fastify';
import { buildApp } from '../../src/index.js';
import { setLLMClient, resetLLMClient, type LLMClient } from '../../src/llm/client.js';

/**
 * LLM giả lập phân biệt được ba phương án nhờ VARIANT BRIEF trong prompt.
 *
 * Nếu mock trả cùng một kịch bản cho cả ba lần gọi thì dedupe sẽ gộp lại còn
 * một — đúng hành vi thật, nhưng không kiểm được nhánh nhiều phương án.
 */
class VariantAwareLLM implements LLMClient {
    readonly provider = 'mock-llm';
    public calls: string[] = [];

    private paletteFor(prompt: string) {
        if (prompt.includes('BIÊN TẬP')) {
            return { primary: '#d4af37', secondary: '#334155', accent: '#c0392b', background: '#0f141c', text: '#f5f5f0' };
        }
        if (prompt.includes('DỮ LIỆU')) {
            return { primary: '#8b5cf6', secondary: '#06b6d4', accent: '#ec4899', background: '#0b0f19', text: '#f8fafc' };
        }
        if (prompt.includes('TRUYỆN TRANH')) {
            return { primary: '#ffd166', secondary: '#ef476f', accent: '#118ab2', background: '#fffaf0', text: '#1f2937' };
        }
        return { primary: '#111111', secondary: '#333333', accent: '#ff0000', background: '#ffffff', text: '#000000' };
    }

    async generate(_system: string, user: string): Promise<string> {
        this.calls.push(user);

        // Prompt phân loại của /api/script/clarify.
        if (user.includes('Chọn đúng một đáp án cho mỗi chiều')) {
            return JSON.stringify({
                audience: { value: 'student', confidence: 0.55 },
                purpose: { value: 'persuade', confidence: 0.92 },
                structure: { value: 'lenses', confidence: 0.45 },
            });
        }

        const palette = this.paletteFor(user);
        return JSON.stringify({
            id: `script-${palette.primary.replace('#', '')}`,
            title: 'Phương án thử',
            description: 'Mô tả',
            globalStyles: 'body { margin: 0; }',
            globalSetupJs: 'window.__ready = true;',
            scenes: [
                {
                    id: 'scene-1',
                    title: 'Scene 1',
                    voiceOverText: 'Xin chao Viet Nam, day la mot doan loi thoai du dai de kiem tra.',
                    visualDescription: '',
                    htmlCode: '<div class="scene" id="scene-1"><h1>Test</h1></div>',
                    cssCode: '',
                    jsCode: 'tl.to("#scene-1", { duration: {{SCENE_DURATION}}, opacity: 1 });',
                    transition: 'fade',
                    backgroundColor: palette.background,
                },
            ],
            boundaries: [],
            colorPalette: palette,
            fontFamily: 'Inter',
        });
    }
}

const baseRequest = {
    prompt: 'Giới thiệu Hà Nội trong 3 cảnh: Hồ Gươm, phố cổ, ẩm thực',
    aspectRatio: '16:9',
    targetDurationSec: 20,
    language: 'vi',
    style: 'modern',
};

describe('Module HITL: API sinh nhiều phương án', () => {
    let app: FastifyInstance;
    let llm: VariantAwareLLM;

    before(async () => {
        llm = new VariantAwareLLM();
        setLLMClient(llm);
        const { getQueue } = await import('../../src/queue/index.js');
        const queue = await getQueue();
        queue.startListeners();
        app = await buildApp({ queue, logger: false });
        await app.ready();
    });

    after(async () => {
        resetLLMClient();
        await app.close();
    });

    it('TC-HITL-001: trả về 3 phương án khác nhau kèm điểm và gợi ý', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/api/script/draft',
            payload: {
                ...baseRequest,
                variantCount: 3,
                variantRotation: 0,
                answers: { audience: 'student', purpose: 'persuade', structure: 'lenses' },
            },
        });

        assert.equal(response.statusCode, 200);
        const body = response.json();
        assert.equal(body.success, true);
        assert.ok(Array.isArray(body.drafts));
        assert.equal(body.drafts.length, 3);

        const keys = body.drafts.map((d: any) => d.key);
        assert.equal(new Set(keys).size, 3);

        for (const draft of body.drafts) {
            assert.ok(draft.script);
            assert.ok(draft.label);
            assert.ok(draft.style);
            assert.ok(draft.blueprintId);
            assert.ok(typeof draft.score === 'number');
            assert.ok(draft.estimated.totalDurationSec > 0);
        }

        assert.ok(keys.includes(body.recommended));
        assert.equal(body.answers.audience, 'student');
    });

    it('TC-HITL-002: variantCount = 1 giữ shape cũ để không phá client cũ', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/api/script/draft',
            payload: { ...baseRequest, variantCount: 1 },
        });

        assert.equal(response.statusCode, 200);
        const body = response.json();
        assert.equal(body.success, true);
        assert.ok(body.script);
        assert.ok(body.estimated);
        assert.equal(body.drafts, undefined);
    });

    it('TC-HITL-003: thiếu answers thì vẫn tự suy ra và trả confidence', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/api/script/draft',
            payload: { ...baseRequest, variantCount: 2 },
        });

        assert.equal(response.statusCode, 200);
        const body = response.json();
        assert.equal(body.success, true);
        assert.equal(body.answers.purpose, 'persuade');
        assert.equal(body.confidence.purpose, 0.92);
        assert.equal(body.clarifySource, 'llm');
    });

    it('TC-HITL-004: /api/script/clarify trả 3 câu hỏi, ẩn câu đủ chắc', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/api/script/clarify',
            payload: { prompt: baseRequest.prompt },
        });

        assert.equal(response.statusCode, 200);
        const body = response.json();
        assert.equal(body.success, true);
        assert.equal(body.questions.length, 3);

        const purpose = body.questions.find((q: any) => q.id === 'purpose');
        assert.equal(purpose.visible, false); // confidence 0.92

        const audience = body.questions.find((q: any) => q.id === 'audience');
        assert.equal(audience.visible, true); // confidence 0.55
        assert.ok(audience.options.length >= 3);
    });

    it('TC-HITL-005: /api/script/clarify từ chối prompt quá ngắn', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/api/script/clarify',
            payload: { prompt: 'ngan' },
        });
        assert.equal(response.statusCode, 400);
    });

    it('TC-HITL-006: /api/pipeline trả 400 khi script sai schema thay vì để job failed', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/api/pipeline',
            payload: { ...baseRequest, async: true, script: { scenes: 'không phải mảng' } },
        });

        assert.equal(response.statusCode, 400);
        const body = response.json();
        assert.equal(body.error, 'Invalid script');
        assert.ok(body.details);
    });

    it('TC-HITL-007: /api/pipeline trả 400 khi script vượt 150% thời lượng mục tiêu', async () => {
        const longText = Array.from({ length: 300 }, (_, i) => `tu${i}`).join(' ');
        const response = await app.inject({
            method: 'POST',
            url: '/api/pipeline',
            payload: {
                ...baseRequest,
                async: true,
                script: {
                    id: 'too-long',
                    title: 'Too long',
                    description: '',
                    globalStyles: '',
                    globalSetupJs: '',
                    scenes: [{
                        id: 'scene-1',
                        title: 'Scene 1',
                        voiceOverText: longText,
                        visualDescription: '',
                        htmlCode: '<div></div>',
                        cssCode: '',
                        jsCode: '',
                        transition: 'fade',
                        backgroundColor: '#000000',
                    }],
                    boundaries: [],
                    colorPalette: { primary: '#1', secondary: '#2', accent: '#3', background: '#4', text: '#5' },
                    fontFamily: 'Inter',
                },
            },
        });

        assert.equal(response.statusCode, 400);
        const body = response.json();
        assert.equal(body.error, 'Script too long');
    });
});
