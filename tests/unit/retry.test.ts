import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { withRetry, sleep, isAbortError } from '../../src/pipeline/retry.js';

describe('Pipeline Retry Utility (src/pipeline/retry.ts)', () => {
    it('thành công ngay lần thử đầu tiên và không gọi sleep/onRetry', async () => {
        let calls = 0;
        let retryCalled = false;

        const result = await withRetry(
            async (attempt) => {
                calls++;
                return `success-attempt-${attempt}`;
            },
            {
                maxAttempts: 3,
                initialDelayMs: 10,
                onRetry: () => {
                    retryCalled = true;
                },
            }
        );

        assert.equal(result, 'success-attempt-1');
        assert.equal(calls, 1);
        assert.equal(retryCalled, false);
    });

    it('thất bại lần 1, thử lại và thành công ở lần 2', async () => {
        let calls = 0;
        const retryLogs: Array<{ attempt: number; delay: number; msg: string }> = [];

        const result = await withRetry(
            async (attempt) => {
                calls++;
                if (attempt === 1) {
                    throw new Error('Transient Network Glitch');
                }
                return `recovered-at-${attempt}`;
            },
            {
                maxAttempts: 3,
                initialDelayMs: 15,
                backoffFactor: 2,
                onRetry: (err, attempt, nextDelay) => {
                    retryLogs.push({ attempt, delay: nextDelay, msg: err.message });
                },
            }
        );

        assert.equal(result, 'recovered-at-2');
        assert.equal(calls, 2);
        assert.equal(retryLogs.length, 1);
        assert.equal(retryLogs[0].attempt, 1);
        assert.equal(retryLogs[0].delay, 15);
        assert.equal(retryLogs[0].msg, 'Transient Network Glitch');
    });

    it('tính toán Exponential Backoff Delay tăng dần', async () => {
        let calls = 0;
        const delays: number[] = [];

        await assert.rejects(
            async () => {
                await withRetry(
                    async (attempt) => {
                        calls++;
                        throw new Error(`Failure at ${attempt}`);
                    },
                    {
                        maxAttempts: 4,
                        initialDelayMs: 10,
                        backoffFactor: 2,
                        maxDelayMs: 100,
                        onRetry: (_err, _attempt, delay) => {
                            delays.push(delay);
                        },
                    }
                );
            },
            /Failure at 4/
        );

        assert.equal(calls, 4);
        assert.deepEqual(delays, [10, 20, 40]);
    });

    it('không vượt quá maxDelayMs khi nhân backoff', async () => {
        const delays: number[] = [];

        await assert.rejects(
            async () => {
                await withRetry(
                    async () => {
                        throw new Error('Continuous Failure');
                    },
                    {
                        maxAttempts: 4,
                        initialDelayMs: 30,
                        backoffFactor: 2,
                        maxDelayMs: 50,
                        onRetry: (_err, _attempt, delay) => {
                            delays.push(delay);
                        },
                    }
                );
            },
            /Continuous Failure/
        );

        assert.deepEqual(delays, [30, 50, 50]);
    });

    it('dừng ngay lập tức và không retry nếu gặp AbortError', async () => {
        let calls = 0;
        let retryCount = 0;

        await assert.rejects(
            async () => {
                await withRetry(
                    async () => {
                        calls++;
                        const abortErr = new DOMException('Cancelled by user', 'AbortError');
                        throw abortErr;
                    },
                    {
                        maxAttempts: 3,
                        initialDelayMs: 10,
                        onRetry: () => {
                            retryCount++;
                        },
                    }
                );
            },
            /Cancelled by user/
        );

        assert.equal(calls, 1);
        assert.equal(retryCount, 0);
    });

    it('tuân thủ bộ lọc shouldRetry tùy chỉnh', async () => {
        let calls = 0;

        await assert.rejects(
            async () => {
                await withRetry(
                    async () => {
                        calls++;
                        throw new Error('Fatal Invalid Schema');
                    },
                    {
                        maxAttempts: 3,
                        initialDelayMs: 10,
                        shouldRetry: (err) => !err.message.includes('Fatal'),
                    }
                );
            },
            /Fatal Invalid Schema/
        );

        // Phải dừng ngay lần 1 vì shouldRetry trả về false
        assert.equal(calls, 1);
    });

    it('hàm sleep ngắt ngay lập tức khi AbortSignal kích hoạt', async () => {
        const controller = new AbortController();
        const start = Date.now();

        setTimeout(() => {
            controller.abort();
        }, 20);

        await assert.rejects(
            async () => {
                await sleep(5000, controller.signal);
            },
            (err: any) => isAbortError(err)
        );

        const elapsed = Date.now() - start;
        assert.ok(elapsed < 1000, `Sleep phải bị ngắt sớm, nhưng mất ${elapsed}ms`);
    });
});
