export interface RetryOptions {
    /**
     * Số lần thử tối đa (tính cả lần đầu tiên). Mặc định là 3.
     */
    maxAttempts?: number;
    /**
     * Thời gian chờ ban đầu trước lần thử thứ 2 (ms).
     * Mặc định là 500ms (hoặc 10ms nếu NODE_ENV === 'test').
     */
    initialDelayMs?: number;
    /**
     * Hệ số nhân thời gian chờ sau mỗi lần thử. Mặc định là 2.
     */
    backoffFactor?: number;
    /**
     * Thời gian chờ tối đa cho 1 lần retry (ms). Mặc định là 5000ms.
     */
    maxDelayMs?: number;
    /**
     * Bộ lọc kiểm tra lỗi có nên thử lại hay không.
     * Trả về false nếu lỗi không thể khắc phục (ví dụ AbortError do người dùng chủ động huỷ).
     */
    shouldRetry?: (error: any, attempt: number) => boolean;
    /**
     * Callback được gọi ngay trước khi thực hiện lần thử tiếp theo.
     */
    onRetry?: (error: any, attempt: number, nextDelayMs: number) => void;
    /**
     * Tín hiệu huỷ (nếu có).
     */
    signal?: AbortSignal;
}

/**
 * Hàm tạm dừng (sleep) có hỗ trợ ngắt tức thì qua AbortSignal.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
        return Promise.reject(new DOMException("Operation aborted", "AbortError"));
    }
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, ms);

        const onAbort = () => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", onAbort);
            reject(new DOMException("Operation aborted", "AbortError"));
        };

        signal?.addEventListener("abort", onAbort, { once: true });
    });
}

/**
 * Kiểm tra xem một lỗi có phải là do chủ động hủy hay không.
 */
export function isAbortError(error: any): boolean {
    if (!error) return false;
    return (
        error.name === "AbortError" ||
        error.name === "JobCancelledError" ||
        error.code === "ABORT_ERR" ||
        (typeof error.message === "string" && error.message.toLowerCase().includes("aborted"))
    );
}

/**
 * Bọc một hàm bất đồng bộ với cơ chế tự động thử lại (Exponential Backoff Retry).
 */
export async function withRetry<T>(
    fn: (attempt: number) => Promise<T>,
    options: RetryOptions = {}
): Promise<T> {
    const isTest = process.env.NODE_ENV === "test";
    const {
        maxAttempts = 3,
        initialDelayMs = isTest ? 10 : 500,
        backoffFactor = 2,
        maxDelayMs = 5000,
        shouldRetry = (err) => !isAbortError(err),
        onRetry,
        signal,
    } = options;

    let attempt = 1;
    let currentDelay = initialDelayMs;

    while (true) {
        if (signal?.aborted) {
            throw new DOMException("Operation aborted", "AbortError");
        }

        try {
            return await fn(attempt);
        } catch (error: any) {
            if (attempt >= maxAttempts || !shouldRetry(error, attempt) || signal?.aborted) {
                throw error;
            }

            const nextDelay = Math.min(currentDelay, maxDelayMs);
            onRetry?.(error, attempt, nextDelay);

            await sleep(nextDelay, signal);

            attempt++;
            currentDelay = Math.round(currentDelay * backoffFactor);
        }
    }
}
