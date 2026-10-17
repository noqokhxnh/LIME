/**
 * Tiện ích dùng chung cho các file test trong `tests/redis/`.
 *
 * Vì sao mỗi file phải có một database Redis riêng: `node --test` chạy các FILE song song
 * (mỗi file một tiến trình). Nếu hai file dùng chung một database thì `flushdb` dọn dẹp của
 * file này sẽ xoá job đang chạy của file kia — đã gặp thật: ca "worker lỗi thì job được thử
 * lại" treo hết thời gian chờ vì job bị file bên cạnh dọn mất giữa chừng.
 *
 * Bảng cấp phát (thêm file mới thì lấy số tiếp theo, KHÔNG dùng lại):
 *   9 → `bull_queue.test.ts`
 *   8 → `billing_queue_bullmq.test.ts`
 *   7 → (trống)
 */
import Redis from 'ioredis';

/** URL Redis trỏ vào một database riêng, giữ nguyên host/port/mật khẩu của `REDIS_URL`. */
export function isolatedRedisUrl(dbIndex: number, redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379'): string {
    const url = new URL(redisUrl);
    url.pathname = `/${dbIndex}`;
    return url.toString();
}

/**
 * Mở một kết nối tới database test để dọn dẹp giữa các ca test.
 * Trả về `null` nếu Redis không kết nối được (khi đó cả file test sẽ tự bỏ qua).
 */
export async function connectForCleanup(url: string): Promise<Redis | null> {
    const client = new Redis(url, {
        maxRetriesPerRequest: 1,
        retryStrategy: (times: number) => (times > 2 ? null : 200),
        connectTimeout: 2000,
    });
    client.on('error', () => {});
    try {
        await client.ping();
        return client;
    } catch {
        client.disconnect();
        return null;
    }
}
