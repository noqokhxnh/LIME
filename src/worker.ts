import { getConfig } from './config.js';
import { getQueue } from './queue/index.js';
import { processVideoJob } from './queue/handler.js';
import { initDatabase, closeDatabase } from './database/index.js';
import { getBillingWebhookQueue } from './billing/queue.js';
import { getAssetCaptionQueue } from './queue/assetCaption.js';
import { cleanupExpiredVideoHistory } from './history/store.js';

async function startWorker() {
    const config = getConfig();
    if (config.QUEUE_TYPE !== 'redis') {
        console.warn('Worker should only be run when QUEUE_TYPE is redis.');
        process.exit(0);
    }

    await initDatabase();
    const queue = await getQueue();
    queue.process(processVideoJob);
    console.log('Worker listening for jobs on video-generation queue...');

    const billingQueue = await getBillingWebhookQueue();
    await billingQueue.startWorker();
    console.log('Worker listening for jobs on sepay-webhooks queue...');

    const assetCaptionQueue = await getAssetCaptionQueue();
    await assetCaptionQueue.startWorker();
    console.log('Worker listening for jobs on asset-captioning queue...');

    // Dọn lịch sử quá hạn retention (mặc định VIDEO_RETENTION_DAYS=0 = giữ mãi).
    // Chỉ job đã kết thúc mới bị xoá; job đang chờ/chạy không bao giờ bị chạm.
    let retentionTimer: NodeJS.Timeout | null = null;
    if (config.VIDEO_RETENTION_DAYS > 0) {
        const sweep = () => {
            cleanupExpiredVideoHistory(config.VIDEO_RETENTION_DAYS)
                .then((n) => { if (n > 0) console.log(`[VideoHistory] Đã dọn ${n} video quá hạn lưu trữ.`); })
                .catch((err) => console.error('[VideoHistory] Lỗi dọn lịch sử:', err));
        };
        retentionTimer = setInterval(sweep, 6 * 60 * 60 * 1000);
        sweep();
    }

    // Tắt an toàn: ngừng nhận job mới, chờ job đang chạy (có timeout), đóng
    // hàng đợi rồi mới đóng pool PostgreSQL. Guard chống SIGINT+SIGTERM trùng.
    let shuttingDown = false;
    const shutdown = async (signal: string) => {
        if (shuttingDown) return;
        shuttingDown = true;
        if (retentionTimer) clearInterval(retentionTimer);
        console.log(`[Worker] Nhận ${signal}, đang tắt an toàn...`);
        const withTimeout = <T>(promise: Promise<T>, ms: number) =>
            Promise.race([
                promise,
                new Promise<void>((resolve) => setTimeout(resolve, ms)),
            ]);

        // BullMQ Worker.close() chờ job đang chạy xong; timeout bảo vệ để
        // deployment không bị treo vô hạn khi một render kẹt.
        try {
            await withTimeout(queue.close(), 60_000);
        } catch (err) {
            console.error('[Worker] Lỗi khi đóng video queue:', err);
        }
        try {
            await withTimeout(billingQueue.close(), 15_000);
        } catch (err) {
            console.error('[Worker] Lỗi khi đóng billing webhook queue:', err);
        }
        try {
            await withTimeout(assetCaptionQueue.close(), 15_000);
        } catch (err) {
            console.error('[Worker] Lỗi khi đóng asset caption queue:', err);
        }

        await closeDatabase();
        console.log('[Worker] Đã tắt an toàn.');
        process.exit(0);
    };
    process.once('SIGINT', () => { void shutdown('SIGINT'); });
    process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
}

startWorker().catch(err => {
    console.error('Worker failed to start:', err);
    process.exit(1);
});
