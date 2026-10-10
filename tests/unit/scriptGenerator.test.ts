import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { narrationWordBudget, buildUserPrompt } from '../../src/pipeline/scriptGenerator.js';
import type { videoRequest } from '../../src/llm/schema.js';

const baseRequest: videoRequest = {
    prompt: 'Video giới thiệu du lịch vịnh Hạ Long với 3 cảnh đẹp kỳ vĩ',
    aspectRatio: '16:9',
    targetDurationSec: 15,
    language: 'vi',
    style: 'modern',
};

describe('narrationWordBudget', () => {
    it('15s tiếng Việt cho budget 33 từ (165wpm, trừ 20% headroom)', () => {
        // 15 * 0.8 * 165 / 60 = 33
        assert.strictEqual(narrationWordBudget(15, 'vi'), 33);
    });

    it('30s tiếng Anh cho budget 60 từ (150wpm)', () => {
        // 30 * 0.8 * 150 / 60 = 60
        assert.strictEqual(narrationWordBudget(30, 'en'), 60);
    });

    it('ngôn ngữ lạ fallback về 150wpm', () => {
        // 15 * 0.8 * 150 / 60 = 30
        assert.strictEqual(narrationWordBudget(15, 'xx'), 30);
    });

    it('không có ngôn ngữ thì mặc định tiếng Việt', () => {
        assert.strictEqual(narrationWordBudget(15), 33);
    });

    it('budget tối thiểu là 10 từ kể cả video rất ngắn', () => {
        assert.strictEqual(narrationWordBudget(1, 'vi'), 10);
    });
});

describe('buildUserPrompt word budget', () => {
    it('prompt chứa giới hạn tổng số từ narration khớp với targetDurationSec', () => {
        const prompt = buildUserPrompt(baseRequest, '1920x1080');
        assert.ok(
            prompt.includes('must be ≤ 33 words'),
            'prompt phải nêu rõ budget 33 từ cho video 15s tiếng Việt'
        );
        assert.ok(prompt.includes('Target Duration: 15 seconds'));
    });

    it('đổi targetDurationSec thì budget trong prompt đổi theo', () => {
        const prompt = buildUserPrompt({ ...baseRequest, targetDurationSec: 60 }, '1920x1080');
        // 60 * 0.8 * 165 / 60 = 132
        assert.ok(prompt.includes('must be ≤ 132 words'));
    });
});
