import { type ChildProcess } from 'node:child_process';

/**
 * Lỗi hủy job trong pipeline (#131).
 */
export class JobCancelledError extends Error {
    readonly code = 'JOB_CANCELLED';
    constructor(message: string = 'Job was cancelled') {
        super(message);
        this.name = 'JobCancelledError';
    }
}

export function isJobCancelledError(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;
    const e = err as any;
    return e.code === 'JOB_CANCELLED' || e.name === 'JobCancelledError' || e.message === 'JOB_CANCELLED' || e.name === 'AbortError';
}

/**
 * Ném JobCancelledError ngay lập tức nếu signal đã bị abort.
 */
export function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
        throw new JobCancelledError('Tác vụ đã bị huỷ bởi người dùng hoặc hệ thống');
    }
}

/**
 * Đua Promise với AbortSignal: nếu signal kích hoạt trước khi promise hoàn thành,
 * gọi hàm onAbort dọn dẹp và reject với JobCancelledError.
 */
export function raceWithAbort<T>(
    promise: Promise<T>,
    signal?: AbortSignal,
    onAbort?: () => void | Promise<void>
): Promise<T> {
    if (!signal) return promise;
    if (signal.aborted) {
        onAbort?.();
        return Promise.reject(new JobCancelledError());
    }

    return new Promise<T>((resolve, reject) => {
        const handleAbort = async () => {
            try {
                await onAbort?.();
            } finally {
                cleanup();
                reject(new JobCancelledError());
            }
        };

        const cleanup = () => {
            signal.removeEventListener('abort', handleAbort);
        };

        signal.addEventListener('abort', handleAbort, { once: true });

        promise
            .then((result) => {
                cleanup();
                resolve(result);
            })
            .catch((err) => {
                cleanup();
                reject(err);
            });
    });
}

/**
 * Quản lý các tiến trình con (FFmpeg, Chromium) đang chạy theo từng jobId.
 * Đảm bảo kill sạch sẽ khi job bị hủy hoặc timeout, không để lại zombie process (#131).
 */
const jobProcessMap = new Map<string, Set<ChildProcess>>();

export function registerJobProcess(jobId: string, proc: ChildProcess): () => void {
    if (!jobProcessMap.has(jobId)) {
        jobProcessMap.set(jobId, new Set());
    }
    const set = jobProcessMap.get(jobId)!;
    set.add(proc);

    const unregister = () => {
        set.delete(proc);
        if (set.size === 0) {
            jobProcessMap.delete(jobId);
        }
    };

    proc.once('exit', unregister);
    proc.once('error', unregister);

    return unregister;
}

export function killJobProcesses(jobId: string, signal: NodeJS.Signals = 'SIGKILL'): number {
    const set = jobProcessMap.get(jobId);
    if (!set || set.size === 0) return 0;

    let killed = 0;
    for (const proc of set) {
        try {
            if (!proc.killed && proc.exitCode === null) {
                proc.kill(signal);
                killed++;
            }
        } catch { }
    }
    jobProcessMap.delete(jobId);
    return killed;
}

/**
 * Định kỳ kiểm tra cờ hủy của job trong hàng đợi (Redis/Memory) và kích hoạt AbortController.
 */
export function watchJobCancellation(
    jobId: string,
    checkFn: () => Promise<boolean>,
    intervalMs: number = 2000
): { controller: AbortController; stop: () => void } {
    const controller = new AbortController();
    let isStopped = false;

    const timer = setInterval(async () => {
        if (isStopped || controller.signal.aborted) return;
        try {
            const isCancelled = await checkFn();
            if (isCancelled) {
                controller.abort();
                killJobProcesses(jobId, 'SIGKILL');
                stop();
            }
        } catch { }
    }, intervalMs);

    const stop = () => {
        if (isStopped) return;
        isStopped = true;
        clearInterval(timer);
    };

    return { controller, stop };
}
