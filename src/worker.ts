import { getConfig } from './config.js';
import { getQueue } from './queue/index.js';
import { processVideoJob } from './queue/handler.js';
import { initDatabase, db } from './database/index.js';
import { getBillingWebhookQueue } from './billing/queue.js';
import { getAssetCaptionQueue } from './queue/assetCaption.js';
import { installProcessGuards } from './security/processGuards.js';
import { cleanStaleJobWorkdirs } from './queue/tmpCleaner.js';

installProcessGuards('Worker');

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

    // TTL cleanup cron: quét và xoá tmp/job-* quá 24h mỗi 30 phút (#131)
    cleanStaleJobWorkdirs();
    const cleanupInterval = setInterval(() => {
        try {
            const { deletedCount } = cleanStaleJobWorkdirs();
            if (deletedCount > 0) {
                console.log(`[Worker-Cleaner] Đã dọn dẹp ${deletedCount} thư mục tạm quá 24h.`);
            }
        } catch (err: any) {
            console.warn('[Worker-Cleaner] Lỗi khi dọn dẹp thư mục tạm:', err.message);
        }
    }, 30 * 60 * 1000);

    // Graceful shutdown handling (SIGTERM, SIGINT) (#131)
    let isShuttingDown = false;
    const shutdown = async (signal: string) => {
        if (isShuttingDown) return;
        isShuttingDown = true;
        console.log(`[Worker] Nhận tín hiệu ${signal}. Bắt đầu graceful shutdown...`);

        clearInterval(cleanupInterval);

        // Force exit sau 30s nếu có tác vụ treo
        const forceExitTimer = setTimeout(() => {
            console.error('[Worker] Shutdown timeout (30s) vượt quá giới hạn. Buộc thoát tiến trình.');
            process.exit(1);
        }, 30_000);
        forceExitTimer.unref();

        try {
            await Promise.allSettled([
                queue.close(),
                billingQueue.close(),
                assetCaptionQueue.close(),
                db.end(),
            ]);
            console.log('[Worker] Graceful shutdown hoàn tất thành công.');
            process.exit(0);
        } catch (err) {
            console.error('[Worker] Lỗi trong quá trình graceful shutdown:', err);
            process.exit(1);
        }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

startWorker().catch(err => {
    console.error('Worker failed to start:', err);
    process.exit(1);
});
