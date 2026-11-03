/**
 * Global Process Guards for Unhandled Rejection & Uncaught Exception.
 * Ngăn chặn tiến trình crash đột ngột khi xảy ra lỗi ngoài luồng xử lý chính
 * trong các tác vụ background (analytics, cleanup cron, stream listeners).
 */
let guardsInstalled = false;

export function installProcessGuards(label: string = "Server"): void {
    if (guardsInstalled) return;
    guardsInstalled = true;

    process.on("unhandledRejection", (reason: unknown, promise: Promise<unknown>) => {
        console.error(`[${label}] ⚠️ Unhandled Rejection at:`, promise, "reason:", reason);
    });

    process.on("uncaughtException", (err: Error) => {
        console.error(`[${label}] 💥 Uncaught Exception:`, err);
    });
}
