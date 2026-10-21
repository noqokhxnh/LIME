import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    CLARIFY_QUESTIONS,
    DEFAULT_ANSWERS,
    buildAnswerDirectives,
    buildQuestionViews,
    heuristicAnswers,
    inferAnswers,
    mergeAnswers,
} from '../../src/pipeline/clarify.js';
import { setLLMClient, resetLLMClient, type LLMClient } from '../../src/llm/client.js';

class FixedLLM implements LLMClient {
    readonly provider = 'mock-llm';
    constructor(private response: string | Error) { }
    async generate(): Promise<string> {
        if (this.response instanceof Error) throw this.response;
        return this.response;
    }
}

class CapturingLLM implements LLMClient {
    readonly provider = 'mock-llm';
    public lastUserPrompt = '';
    constructor(private response: string) { }
    async generate(_system: string, user: string): Promise<string> {
        this.lastUserPrompt = user;
        return this.response;
    }
}

describe('Module HITL: clarify', () => {
    afterEach(() => resetLLMClient());

    it('mỗi câu hỏi có ít nhất 3 phương án và id không trùng', () => {
        assert.equal(CLARIFY_QUESTIONS.length, 3);
        for (const question of CLARIFY_QUESTIONS) {
            assert.ok(question.options.length >= 3, `${question.id} phải có ≥ 3 phương án`);
            const ids = question.options.map(o => o.id);
            assert.equal(new Set(ids).size, ids.length);
        }
    });

    it('mọi phương án đều có directive riêng', () => {
        const directives = new Set<string>();
        for (const question of CLARIFY_QUESTIONS) {
            for (const option of question.options) {
                assert.ok(option.directive.trim().length > 0, `${question.id}:${option.id} thiếu directive`);
                directives.add(option.directive);
            }
        }
        const total = CLARIFY_QUESTIONS.reduce((sum, q) => sum + q.options.length, 0);
        assert.equal(directives.size, total);
    });

    it('heuristic nhận diện được prompt thiên về thuyết phục', () => {
        const result = heuristicAnswers('Giải thích để chứng minh rằng ma không có thật');
        assert.equal(result.answers.purpose, 'persuade');
        assert.equal(result.source, 'heuristic');
    });

    it('heuristic nhận diện nhiều lăng kính khi prompt nhắc nhiều ngành', () => {
        const result = heuristicAnswers('Giải thích theo góc độ vật lý, hoá học và sinh học');
        assert.equal(result.answers.structure, 'lenses');
    });

    it('buildAnswerDirectives chứa đủ ba chiều đã chọn', () => {
        const block = buildAnswerDirectives({
            audience: 'student',
            purpose: 'persuade',
            structure: 'contradiction',
            cta: 'none',
        });
        assert.match(block, /học sinh\/sinh viên/i);
        assert.match(block, /thuyết phục/i);
        assert.match(block, /phản chứng/i);
    });

    it('buildQuestionViews ẩn câu hỏi khi confidence cao', () => {
        const views = buildQuestionViews({
            answers: { ...DEFAULT_ANSWERS },
            confidence: { audience: 0.9, purpose: 0.4, structure: 0.2 },
            source: 'llm',
        });
        assert.equal(views.find(v => v.id === 'audience')?.visible, false);
        assert.equal(views.find(v => v.id === 'purpose')?.visible, true);
    });

    it('inferAnswers parse JSON hợp lệ từ LLM', async () => {
        setLLMClient(new FixedLLM(JSON.stringify({
            audience: { value: 'biz', confidence: 0.9 },
            purpose: { value: 'persuade', confidence: 0.95 },
            structure: { value: 'lenses', confidence: 0.4 },
        })));
        const result = await inferAnswers('bán hàng cho quản lý');
        assert.equal(result.source, 'llm');
        assert.equal(result.answers.audience, 'biz');
        assert.equal(result.confidence.purpose, 0.95);
    });

    it('inferAnswers rơi về heuristic khi LLM lỗi', async () => {
        setLLMClient(new FixedLLM(new Error('boom')));
        const result = await inferAnswers('Giải thích API cho dev');
        assert.equal(result.source, 'heuristic');
        assert.ok(result.error?.includes('boom'));
        assert.equal(result.answers.audience, 'dev');
    });

    it('inferAnswers bỏ id không hợp lệ và dùng mặc định', async () => {
        setLLMClient(new FixedLLM(JSON.stringify({
            audience: { value: 'alien', confidence: 0.99 },
            purpose: { value: 'persuade', confidence: 0.7 },
            structure: { value: 'single', confidence: 0.6 },
        })));
        const result = await inferAnswers('prompt bất kỳ');
        assert.equal(result.answers.audience, 'general');
    });

    it('mergeAnswers chỉ ghi đè trường người dùng chọn', () => {
        const merged = mergeAnswers(DEFAULT_ANSWERS, { purpose: 'viral' });
        assert.equal(merged.purpose, 'viral');
        assert.equal(merged.audience, DEFAULT_ANSWERS.audience);
    });

    it('directives và variant brief thực sự đi vào prompt gửi LLM', async () => {
        const script = {
            id: 's', title: 't', description: 'd', globalStyles: '', globalSetupJs: '',
            scenes: [{
                id: 'scene-1', title: 'Scene 1', voiceOverText: 'Xin chao Viet Nam.',
                visualDescription: '', htmlCode: '<div></div>', cssCode: '', jsCode: '',
                transition: 'fade', backgroundColor: '#000000',
            }],
            boundaries: [],
            colorPalette: { primary: '#1', secondary: '#2', accent: '#3', background: '#4', text: '#5' },
            fontFamily: 'Inter',
        };
        const llm = new CapturingLLM(JSON.stringify(script));
        setLLMClient(llm);

        const { generateScript } = await import('../../src/pipeline/scriptGenerator.js');
        const { ARCHETYPES } = await import('../../src/pipeline/scriptVariants.js');
        const directives = buildAnswerDirectives({ audience: 'dev', purpose: 'explain', structure: 'single', cta: 'none' });

        await generateScript(
            {
                prompt: 'Video giải thích API cho dev',
                aspectRatio: '16:9',
                targetDurationSec: 15,
                language: 'vi',
                style: 'modern',
            } as any,
            undefined,
            undefined,
            ARCHETYPES.swiss,
            directives
        );

        assert.match(llm.lastUserPrompt, /NGƯỜI XEM, MỤC ĐÍCH/);
        assert.match(llm.lastUserPrompt, /VARIANT BRIEF: TỐI GIẢN/);
        assert.match(llm.lastUserPrompt, /minimal/);
    });
});
