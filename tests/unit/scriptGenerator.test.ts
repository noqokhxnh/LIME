import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    narrationWordBudget,
    narrationWordFloor,
    narrationWordTarget,
    buildUserPrompt,
} from '../../src/pipeline/scriptGenerator.js';
import { wordsPerMinute } from '../../src/pipeline/estimateDuration.js';
import type { videoRequest } from '../../src/llm/schema.js';

const baseRequest: videoRequest = {
    prompt: 'Video giới thiệu du lịch vịnh Hạ Long với 3 cảnh đẹp kỳ vĩ',
    aspectRatio: '16:9',
    targetDurationSec: 15,
    language: 'vi',
    style: 'modern',
};

describe('narrationWordTarget (số từ mục tiêu theo thời lượng)', () => {
    it('15s tiếng Việt cho mục tiêu 37 từ (165wpm, 90% thời gian đọc)', () => {
        // 15 * 0.9 * 165 / 60 = 37.125 -> 37
        assert.strictEqual(narrationWordTarget(15, 'vi'), 37);
    });

    it('30s tiếng Anh cho mục tiêu 68 từ (150wpm)', () => {
        // 30 * 0.9 * 150 / 60 = 67.5 -> 68
        assert.strictEqual(narrationWordTarget(30, 'en'), 68);
    });

    it('ngôn ngữ lạ fallback về 150wpm', () => {
        assert.strictEqual(narrationWordTarget(15, 'xx'), 34);
    });

    it('không có ngôn ngữ thì mặc định tiếng Việt', () => {
        assert.strictEqual(narrationWordTarget(15), 37);
    });

    it('mục tiêu tối thiểu là 10 từ kể cả video rất ngắn', () => {
        assert.strictEqual(narrationWordTarget(1, 'vi'), 10);
    });

    it('hỗ trợ BCP-47 locale tags (vi-VN, en-US)', () => {
        assert.strictEqual(narrationWordTarget(15, 'vi-VN'), 37);
        assert.strictEqual(narrationWordTarget(30, 'en-US'), 68);
        assert.strictEqual(narrationWordTarget(15, 'en_US'), 34);
    });
});

describe('narrationWordFloor (cận dưới chống video ngắn)', () => {
    it('15s tiếng Việt cho floor 29 từ (72% thời gian đọc)', () => {
        // 15 * 0.72 * 165 / 60 = 29.7 -> 29
        assert.strictEqual(narrationWordFloor(15, 'vi'), 29);
    });

    it('30s tiếng Anh cho floor 54 từ', () => {
        // 30 * 0.72 * 150 / 60 = 54
        assert.strictEqual(narrationWordFloor(30, 'en'), 54);
    });

    it('floor luôn nhỏ hơn hoặc bằng target, target luôn nhỏ hơn hoặc bằng budget', () => {
        for (const [dur, lang] of [[15, 'vi'], [30, 'en'], [90, 'vi'], [7, 'xx']] as const) {
            const floor = narrationWordFloor(dur, lang);
            const target = narrationWordTarget(dur, lang);
            const budget = narrationWordBudget(dur, lang);
            assert.ok(floor <= target, `floor(${dur},${lang})=${floor} phải <= target=${target}`);
            assert.ok(target <= budget, `target(${dur},${lang})=${target} phải <= budget=${budget}`);
        }
    });

    it('video 90s tiếng Việt cần floor >= 178 từ — không còn ngân sách kiểu 0.8 ép video ngắn', () => {
        // 90 * 0.72 * 165 / 60 = 178.2 -> 178
        assert.strictEqual(narrationWordFloor(90, 'vi'), 178);
    });
});

describe('narrationWordBudget (trần an toàn)', () => {
    it('15s tiếng Việt cho budget 41 từ (tốc độ đọc thuần)', () => {
        // 15 * 1.0 * 165 / 60 = 41.25 -> 41
        assert.strictEqual(narrationWordBudget(15, 'vi'), 41);
    });

    it('30s tiếng Anh cho budget 75 từ (150wpm)', () => {
        // 30 * 1.0 * 150 / 60 = 75
        assert.strictEqual(narrationWordBudget(30, 'en'), 75);
    });

    it('ngôn ngữ lạ fallback về 150wpm', () => {
        assert.strictEqual(narrationWordBudget(15, 'xx'), 37);
    });

    it('không có ngôn ngữ thì mặc định tiếng Việt', () => {
        assert.strictEqual(narrationWordBudget(15), 41);
    });

    it('budget tối thiểu là 10 từ kể cả video rất ngắn', () => {
        assert.strictEqual(narrationWordBudget(1, 'vi'), 10);
    });

    it('hỗ trợ BCP-47 locale tags (vi-VN, en-US)', () => {
        assert.strictEqual(narrationWordBudget(15, 'vi-VN'), 41);
        assert.strictEqual(narrationWordBudget(30, 'en-US'), 75);
        assert.strictEqual(narrationWordBudget(15, 'en_US'), 37);
    });
});

describe('wordsPerMinute (single source of truth)', () => {
    it('map đúng tốc độ đọc theo ngôn ngữ', () => {
        assert.strictEqual(wordsPerMinute('vi'), 165);
        assert.strictEqual(wordsPerMinute('en'), 150);
        assert.strictEqual(wordsPerMinute(), 165); // mặc định tiếng Việt
    });

    it('chuẩn hoá BCP-47 về mã ngôn ngữ chính', () => {
        assert.strictEqual(wordsPerMinute('vi-VN'), 165);
        assert.strictEqual(wordsPerMinute('en-US'), 150);
    });

    it('ngôn ngữ lạ fallback về 150wpm', () => {
        assert.strictEqual(wordsPerMinute('xx'), 150);
    });
});

describe('buildUserPrompt word budget', () => {
    it('prompt nêu cả cận dưới lẫn trần số từ narration khớp targetDurationSec', () => {
        const prompt = buildUserPrompt(baseRequest, '1920x1080');
        assert.ok(
            prompt.includes('between 29 and 41 words'),
            'prompt phải nêu khoảng 29–41 từ cho video 15s tiếng Việt'
        );
        assert.ok(
            prompt.includes('Aim for about 37 words'),
            'prompt phải nêu mục tiêu ~37 từ để lấp đầy 15 giây'
        );
        assert.ok(prompt.includes('Target Duration: 15 seconds'));
    });

    it('đổi targetDurationSec thì dải số từ trong prompt đổi theo', () => {
        const prompt = buildUserPrompt({ ...baseRequest, targetDurationSec: 60 }, '1920x1080');
        // floor = 60*0.72*165/60 = 118 ; budget = 60*165/60 = 165 ; target = 60*0.9*165/60 = 149
        assert.ok(prompt.includes('between 118 and 165 words'));
        assert.ok(prompt.includes('Aim for about 149 words'));
    });

    it('prompt nhắc số từ mỗi cảnh để dễ đạt mục tiêu', () => {
        const prompt = buildUserPrompt({ ...baseRequest, targetDurationSec: 60 }, '1920x1080');
        assert.ok(prompt.includes('words per scene'));
    });
});
