import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    throwIfAborted,
    raceWithAbort,
    registerJobProcess,
    killJobProcesses,
    watchJobCancellation,
    JobCancelledError,
} from '../../src/pipeline/cancel.js';
import { EventEmitter } from 'node:events';

describe('Cancellation & Zombie Process Prevention (#131)', () => {
    it('throwIfAborted ném JobCancelledError khi signal đã abort', () => {
        const controller = new AbortController();
        assert.doesNotThrow(() => throwIfAborted(controller.signal));

        controller.abort();
        assert.throws(() => throwIfAborted(controller.signal), (err: any) => {
            return err instanceof JobCancelledError;
        });
    });

    it('raceWithAbort reject với JobCancelledError và gọi cleanup khi signal bị huỷ', async () => {
        const controller = new AbortController();
        let cleanedUp = false;

        const hangingPromise = new Promise((resolve) => setTimeout(resolve, 5000));

        const racePromise = raceWithAbort(hangingPromise, controller.signal, () => {
            cleanedUp = true;
        });

        // Trigger abort
        setTimeout(() => controller.abort(), 10);

        await assert.rejects(racePromise, (err: any) => {
            return err instanceof JobCancelledError;
        });
        assert.strictEqual(cleanedUp, true);
    });

    it('registerJobProcess và killJobProcesses gửi SIGKILL dọn sạch tiến trình con', () => {
        const fakeProcess: any = new EventEmitter();
        fakeProcess.killed = false;
        fakeProcess.exitCode = null;
        let killSignalSent: string | null = null;
        fakeProcess.kill = (sig: string) => {
            killSignalSent = sig;
            fakeProcess.killed = true;
            fakeProcess.emit('exit', 0);
            return true;
        };

        const unregister = registerJobProcess('job-test-kill-1', fakeProcess);
        assert.strictEqual(typeof unregister, 'function');

        const killedCount = killJobProcesses('job-test-kill-1', 'SIGKILL');
        assert.strictEqual(killedCount, 1);
        assert.strictEqual(killSignalSent, 'SIGKILL');
        assert.strictEqual(fakeProcess.killed, true);
    });

    it('watchJobCancellation phát hiện trạng thái hủy và kích hoạt AbortController', async () => {
        let isCancelled = false;
        const { controller, stop } = watchJobCancellation(
            'job-test-watch-1',
            async () => isCancelled,
            20
        );

        assert.strictEqual(controller.signal.aborted, false);
        isCancelled = true;

        await new Promise((r) => setTimeout(r, 60));
        assert.strictEqual(controller.signal.aborted, true);
        stop();
    });
});
