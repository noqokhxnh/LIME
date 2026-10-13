import { EventEmitter } from 'node:events';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { getConfig } from '../config.js';
import { vietQrBillingService } from './vietqrService.js';
import type { SePayWebhookPayload } from './types.js';

export interface IBillingWebhookQueue {
    addJob(payload: SePayWebhookPayload): Promise<void>;
    startWorker(): Promise<void>;
    close(): Promise<void>;
}

export class BullMQBillingWebhookQueue implements IBillingWebhookQueue {
    private queue: Queue<SePayWebhookPayload>;
    private worker?: Worker<SePayWebhookPayload>;
    private redisUrl: string;

    constructor(redisUrl: string) {
        this.redisUrl = redisUrl;
        const connection = new Redis(this.redisUrl, {
            maxRetriesPerRequest: null,
        });
        this.queue = new Queue('sepay-webhooks', { connection });
    }

    async addJob(payload: SePayWebhookPayload): Promise<void> {
        const jobId = payload.id ? `sepay-${payload.id}` : undefined;
        await this.queue.add('process-webhook', payload, {
            jobId,
            removeOnComplete: 1000,
            removeOnFail: 5000,
            attempts: 3,
            backoff: {
                type: 'exponential',
                delay: 2000,
            },
        });
    }

    async startWorker(): Promise<void> {
        if (this.worker) return;
        const connection = new Redis(this.redisUrl, {
            maxRetriesPerRequest: null,
        });
        this.worker = new Worker(
            'sepay-webhooks',
            async (job) => {
                await vietQrBillingService.processWebhook(job.data);
            },
            { connection, concurrency: 5 }
        );
        this.worker.on('error', (err) => {
            console.error('[Billing Webhook Worker] BullMQ error:', err);
        });
    }

    async close(): Promise<void> {
        if (this.worker) {
            await this.worker.close();
        }
        await this.queue.close();
    }
}

export class MemoryBillingWebhookQueue implements IBillingWebhookQueue {
    public events = new EventEmitter();
    private isRunning = true;

    async addJob(payload: SePayWebhookPayload): Promise<void> {
        // Asynchronously process without blocking caller
        setImmediate(async () => {
            if (!this.isRunning) return;
            try {
                await vietQrBillingService.processWebhook(payload);
                this.events.emit('completed', payload);
            } catch (err) {
                console.error('[Memory Billing Webhook Queue] Error processing webhook:', err);
                this.events.emit('failed', { payload, error: err });
            }
        });
    }

    async startWorker(): Promise<void> {
        this.isRunning = true;
    }

    async close(): Promise<void> {
        this.isRunning = false;
    }
}

let _billingQueue: IBillingWebhookQueue | null = null;

export async function getBillingWebhookQueue(): Promise<IBillingWebhookQueue> {
    if (_billingQueue) return _billingQueue;

    const config = getConfig();
    if (config.QUEUE_TYPE === 'redis' && config.REDIS_URL) {
        let isConnected = false;
        try {
            const redis = new Redis(config.REDIS_URL, {
                maxRetriesPerRequest: null,
                retryStrategy: (times: number) => {
                    if (times > 2) return null;
                    return 1000;
                },
                connectTimeout: 2000,
            });
            await redis.ping();
            isConnected = true;
            redis.disconnect();
        } catch {
            // Fallback to memory
        }

        if (isConnected) {
            _billingQueue = new BullMQBillingWebhookQueue(config.REDIS_URL);
            return _billingQueue;
        }
    }

    _billingQueue = new MemoryBillingWebhookQueue();
    return _billingQueue;
}

export function setBillingWebhookQueue(queue: IBillingWebhookQueue | null): void {
    _billingQueue = queue;
}
