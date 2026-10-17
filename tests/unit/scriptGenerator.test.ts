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
    it('15s tiếng Việt/VieNeu cho mục tiêu 44 từ (195wpm đo thực, 90% thời gian đọc)', () => {
        // 15 * 0.9 * 195 / 60 = 43.875 -> 44
        assert.strictEqual(narrationWordTarget(15, 'vi'), 44);
    });

    it('30s tiếng Anh cho mục tiêu 68 từ (không có số đo riêng nên dùng 150wpm)', () => {
        // 30 * 0.9 * 150 / 60 = 67.5 -> 68
        assert.strictEqual(narrationWordTarget(30, 'en'), 68);
    });

    it('ngôn ngữ lạ fallback về 150wpm', () => {
        assert.strictEqual(narrationWordTarget(15, 'xx'), 34);
    });

    it('không có ngôn ngữ thì mặc định tiếng Việt + engine mặc định', () => {
        assert.strictEqual(narrationWordTarget(15), 44);
    });

    it('mục tiêu tối thiểu là 10 từ kể cả video rất ngắn', () => {
        assert.strictEqual(narrationWordTarget(1, 'vi'), 10);
    });

    it('hỗ trợ BCP-47 locale tags (vi-VN, en-US)', () => {
        assert.strictEqual(narrationWordTarget(15, 'vi-VN'), 44);
        assert.strictEqual(narrationWordTarget(30, 'en-US'), 68);
        assert.strictEqual(narrationWordTarget(15, 'en_US'), 34);
    });
});

describe('narrationWordFloor (cận dưới chống video ngắn)', () => {
    it('15s tiếng Việt cho floor 35 từ (72% thời gian đọc)', () => {
        // 15 * 0.72 * 195 / 60 = 35.1 -> 35
        assert.strictEqual(narrationWordFloor(15, 'vi'), 35);
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

    it('video 90s tiếng Việt cần floor >= 210 từ — đủ lấp gần hết thời lượng', () => {
        // 90 * 0.72 * 195 / 60 = 210.6 -> 210
        assert.strictEqual(narrationWordFloor(90, 'vi'), 210);
    });
});

describe('narrationWordBudget (trần an toàn)', () => {
    it('15s tiếng Việt cho budget 48 từ (tốc độ đọc thuần)', () => {
        // 15 * 1.0 * 195 / 60 = 48.75 -> 48
        assert.strictEqual(narrationWordBudget(15, 'vi'), 48);
    });

    it('30s tiếng Anh cho budget 75 từ (150wpm)', () => {
        // 30 * 1.0 * 150 / 60 = 75
        assert.strictEqual(narrationWordBudget(30, 'en'), 75);
    });

    it('ngôn ngữ lạ fallback về 150wpm', () => {
        assert.strictEqual(narrationWordBudget(15, 'xx'), 37);
    });

    it('không có ngôn ngữ thì mặc định tiếng Việt', () => {
        assert.strictEqual(narrationWordBudget(15), 48);
    });

    it('budget tối thiểu là 10 từ kể cả video rất ngắn', () => {
        assert.strictEqual(narrationWordBudget(1, 'vi'), 10);
    });

    it('hỗ trợ BCP-47 locale tags (vi-VN, en-US)', () => {
        assert.strictEqual(narrationWordBudget(15, 'vi-VN'), 48);
        assert.strictEqual(narrationWordBudget(30, 'en-US'), 75);
        assert.strictEqual(narrationWordBudget(15, 'en_US'), 37);
    });
});

describe('narration rate theo engine TTS (vieneu đọc nhanh hơn 165wpm)', () => {
    it('vieneu (mặc định) xin nhiều từ hơn edge cho cùng mục tiêu tiếng Việt', () => {
        const vieneuTarget = narrationWordTarget(90, 'vi', 'vieneu');
        const edgeTarget = narrationWordTarget(90, 'vi', 'edge');
        assert.ok(
            vieneuTarget > edgeTarget,
            `vieneu=${vieneuTarget} phải > edge=${edgeTarget} vì VieNeu đọc nhanh hơn`
        );
    });

    it('edge tiếng Việt dùng tốc độ ước lượng chung 165wpm', () => {
        // 15 * 0.9 * 165 / 60 = 37.125 -> 37 ; 15 * 1.0 * 165 / 60 = 41.25 -> 41
        assert.strictEqual(narrationWordTarget(15, 'vi', 'edge'), 37);
        assert.strictEqual(narrationWordBudget(15, 'vi', 'edge'), 41);
    });

    it('engine lạ fallback về wordsPerMinute() chung', () => {
        assert.strictEqual(narrationWordTarget(15, 'vi', 'openai'), 37);
        assert.strictEqual(narrationWordTarget(30, 'en', 'vieneu'), 68);
    });
});

describe('wordsPerMinute (single source of truth cho độ dài audio)', () => {
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
            prompt.includes('between 35 and 48 words'),
            'prompt phải nêu khoảng 35–48 từ cho video 15s tiếng Việt'
        );
        assert.ok(
            prompt.includes('Aim for about 44 words'),
            'prompt phải nêu mục tiêu ~44 từ để lấp đầy 15 giây'
        );
        assert.ok(prompt.includes('Target Duration: 15 seconds'));
    });

    it('đổi targetDurationSec thì dải số từ trong prompt đổi theo', () => {
        const prompt = buildUserPrompt({ ...baseRequest, targetDurationSec: 60 }, '1920x1080');
        // floor = 60*0.72*195/60 = 140 ; budget = 60*195/60 = 195 ; target = 60*0.9*195/60 = 176
        assert.ok(prompt.includes('between 140 and 195 words'));
        assert.ok(prompt.includes('Aim for about 176 words'));
    });

    it('chọn engine edge thì dải số từ hạ về tốc độ 165wpm', () => {
        const prompt = buildUserPrompt(
            { ...baseRequest, targetDurationSec: 60, ttsProvider: 'edge' },
            '1920x1080'
        );
        // floor = 60*0.72*165/60 = 118 ; budget = 60*165/60 = 165 ; target = 60*0.9*165/60 = 149
        assert.ok(prompt.includes('between 118 and 165 words'));
        assert.ok(prompt.includes('Aim for about 149 words'));
    });

    it('prompt nhắc số từ mỗi cảnh để dễ đạt mục tiêu', () => {
        const prompt = buildUserPrompt({ ...baseRequest, targetDurationSec: 60 }, '1920x1080');
        assert.ok(prompt.includes('words per scene'));
    });
});
