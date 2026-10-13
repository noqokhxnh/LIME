import { getConfig } from './config.js';
import { getQueue } from './queue/index.js';
import { processVideoJob } from './queue/handler.js';
import { initDatabase } from './database/index.js';
import { getBillingWebhookQueue } from './billing/queue.js';

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
}

startWorker().catch(err => {
    console.error('Worker failed to start:', err);
    process.exit(1);
});
