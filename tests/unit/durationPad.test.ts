import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { padScenesToTarget } from '../../src/pipeline/audioSysnthesis.js';

const sum = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0);

describe('padScenesToTarget — bù khoảng lặng để đủ thời lượng mục tiêu', () => {
    it('bù toàn bộ phần thiếu vào cảnh CUỐI để tổng khớp target', () => {
        const durations = { s1: 3.0, s2: 5.0, s3: 4.0 }; // 12s
        const result = padScenesToTarget(durations, 20);

        assert.strictEqual(result.applied, true);
        assert.strictEqual(result.lastSceneId, 's3');
        assert.strictEqual(result.deficitSec, 8);
        assert.strictEqual(result.tailGapSec, 8);
        assert.strictEqual(result.paddedDurations.s3, 12);
        assert.strictEqual(sum(result.paddedDurations), 20);
    });

    it('giữ nguyên các cảnh không phải cảnh cuối (không phá tương phản nhịp điệu)', () => {
        const durations = { a: 2.0, b: 10.0 }; // 12s, ratio 5
        const result = padScenesToTarget(durations, 30);
        assert.strictEqual(result.paddedDurations.a, 2.0);
        assert.strictEqual(result.paddedDurations.b, 28.0);
        // ratio sau khi bù vẫn >= 4 như Oracle QA yêu cầu
        assert.ok(result.paddedDurations.b / result.paddedDurations.a >= 4);
    });

    it('không bù khi thời lượng thực đã bằng hoặc vượt target', () => {
        const exact = padScenesToTarget({ s1: 7, s2: 3 }, 10);
        assert.strictEqual(exact.applied, false);
        assert.strictEqual(exact.deficitSec, 0);
        assert.deepStrictEqual(exact.paddedDurations, { s1: 7, s2: 3 });

        const over = padScenesToTarget({ s1: 20 }, 10);
        assert.strictEqual(over.applied, false);
        assert.strictEqual(over.deficitSec, -10);
        assert.deepStrictEqual(over.paddedDurations, { s1: 20 });
    });

    it('không bù khi chỉ thiếu vụn (< minDeficitSec) để tránh file im lặng vô nghĩa', () => {
        const result = padScenesToTarget({ s1: 9.9 }, 10);
        assert.strictEqual(result.applied, false);
        assert.strictEqual(result.tailGapSec, 0);
    });

    it('KHÔNG bù khi narration quá ngắn (< 25% target) — tránh video gần như im lặng', () => {
        const result = padScenesToTarget({ s1: 2.0 }, 30);
        assert.strictEqual(result.applied, false);
        assert.strictEqual(result.deficitSec, 28);
        assert.deepStrictEqual(result.paddedDurations, { s1: 2.0 });
    });

    it('bù khi narration đạt tối thiểu 25% target (ví dụ người dùng 35s cho mục tiêu 90s)', () => {
        const result = padScenesToTarget({ s1: 35 }, 90);
        assert.strictEqual(result.applied, true);
        assert.strictEqual(sum(result.paddedDurations), 90);
    });

    it('bỏ qua khi không có cảnh hoặc target không hợp lệ', () => {
        assert.strictEqual(padScenesToTarget({}, 30).applied, false);
        assert.strictEqual(padScenesToTarget({ s1: 5 }, 0).applied, false);
        assert.strictEqual(padScenesToTarget({ s1: 5 }, -10).applied, false);
    });

    it('làm tròn tới 2 chữ số thập phân để tổng vẫn khớp target', () => {
        const durations = { s1: 3.33, s2: 4.44, s3: 5.55 }; // 13.32
        const result = padScenesToTarget(durations, 20);
        assert.strictEqual(result.applied, true);
        assert.strictEqual(sum(result.paddedDurations), 20);
    });

    it('cho phép tinh chỉnh ngưỡng qua options', () => {
        // Với minCoverageRatio = 0.1 thì script 3s cho target 30s vẫn được bù
        const result = padScenesToTarget({ s1: 3.0 }, 30, { minCoverageRatio: 0.1 });
        assert.strictEqual(result.applied, true);
        assert.strictEqual(result.paddedDurations.s1, 30);
    });
});
