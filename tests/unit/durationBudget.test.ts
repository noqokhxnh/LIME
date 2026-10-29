import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assessDurationBudget } from '../../src/pipeline/audioSysnthesis.js';

const sum = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0);

describe('assessDurationBudget — target là trần mềm, không bù khoảng lặng (#107)', () => {
    it('KHÔNG kéo dài cảnh cuối khi narration ngắn hơn target', () => {
        const durations = { s1: 3.0, s2: 5.0, s3: 4.0 }; // 12s
        const result = assessDurationBudget(durations, 20);

        assert.strictEqual(result.status, 'short');
        assert.strictEqual(result.deficitSec, 8);
        assert.strictEqual(result.actualTotalSec, 12);
        // Độ dài từng cảnh giữ nguyên — end card không bị kéo thành 12s
        assert.deepStrictEqual(result.sceneDurations, { s1: 3.0, s2: 5.0, s3: 4.0 });
        assert.strictEqual(sum(result.sceneDurations), 12);
        assert.ok(result.warning?.includes('không bù khoảng lặng'));
    });

    it('không mutate object đầu vào', () => {
        const durations = { s1: 4.0, s2: 6.0 };
        const snapshot = { ...durations };
        assessDurationBudget(durations, 30);
        assert.deepStrictEqual(durations, snapshot);
    });

    it('giữ nguyên khi thời lượng thực đã bằng hoặc vượt target trong ngưỡng', () => {
        const exact = assessDurationBudget({ s1: 7, s2: 3 }, 10);
        assert.strictEqual(exact.status, 'ok');
        assert.strictEqual(exact.deficitSec, 0);
        assert.deepStrictEqual(exact.sceneDurations, { s1: 7, s2: 3 });

        const over = assessDurationBudget({ s1: 11 }, 10);
        assert.strictEqual(over.status, 'ok');
        assert.strictEqual(over.deficitSec, -1);
        assert.deepStrictEqual(over.sceneDurations, { s1: 11 });
    });

    it('báo short khi thiếu hơn 25% target (ngưỡng chấp nhận)', () => {
        const result = assessDurationBudget({ s1: 7 }, 10);
        assert.strictEqual(result.status, 'short');
        assert.strictEqual(result.coverageRatio, 0.7);
        assert.ok(result.warning);

        // Thiếu 10% vẫn nằm trong ngưỡng → ok, nhưng deficit vẫn được báo
        const within = assessDurationBudget({ s1: 9 }, 10);
        assert.strictEqual(within.status, 'ok');
        assert.strictEqual(within.deficitSec, 1);
    });

    it('báo over khi vượt hơn 25% target', () => {
        const result = assessDurationBudget({ s1: 13 }, 10);
        assert.strictEqual(result.status, 'over');
        assert.strictEqual(result.deficitSec, -3);
        assert.ok(result.warning?.includes('vượt mục tiêu'));
    });

    it('cho phép tinh chỉnh ngưỡng qua options', () => {
        const result = assessDurationBudget({ s1: 7 }, 10, { toleranceRatio: 0.4 });
        assert.strictEqual(result.status, 'ok');
    });

    it('invalid khi không có cảnh hoặc target không hợp lệ', () => {
        assert.strictEqual(assessDurationBudget({}, 30).status, 'invalid');
        assert.strictEqual(assessDurationBudget({ s1: 5 }, 0).status, 'invalid');
        assert.strictEqual(assessDurationBudget({ s1: 5 }, -10).status, 'invalid');
    });

    it('làm tròn tới 2 chữ số thập phân', () => {
        const result = assessDurationBudget({ s1: 3.33, s2: 4.44, s3: 5.55 }, 20);
        assert.strictEqual(result.actualTotalSec, 13.32);
        assert.strictEqual(result.deficitSec, 6.68);
        assert.deepStrictEqual(result.sceneDurations, { s1: 3.33, s2: 4.44, s3: 5.55 });
    });
});
