import { EventEmitter } from 'node:events';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { getConfig } from '../config.js';
import { vietQrBillingService } from './vietqrService.js';
import { signWebhookPayload, verifyWebhookPayload, stripWebhookSignature } from './queueAuth.js';
import type { SePayWebhookPayload } from './types.js';

/**
 * Cổng kiểm chứng phía worker: payload không có chữ ký hàng đợi hợp lệ
 * (bị ghi thẳng vào Redis bởi bên thứ ba, hoặc bản ghi cũ trước khi có ký)
 * bị bỏ qua — log rõ ràng, không ném lỗi để BullMQ không retry vô ích.
 */
async function processVerifiedWebhook(payload: SePayWebhookPayload): Promise<void> {
    if (!verifyWebhookPayload(payload)) {
        console.error('[Billing Webhook Queue] Dropped payload without valid queue signature (id=%s)', (payload as any)?.id);
        return;
    }
    await vietQrBillingService.processWebhook(stripWebhookSignature(payload));
}

export interface IBillingWebhookQueue {
    addJob(payload: SePayWebhookPayload): Promise<void>;
    startWorker(): Promise<void>;
    close(): Promise<void>;
}

export class BullMQBillingWebhookQueue implements IBillingWebhookQueue {
    private queue: Queue<SePayWebhookPayload>;
    private worker?: Worker<SePayWebhookPayload>;
    private redisUrl: string;
    /**
     * Kết nối ioredis do lớp này tạo. BullMQ không đóng kết nối mà bên gọi truyền vào,
     * nên phải tự giữ và tự đóng ở `close()` để tiến trình gọi close() thoát được.
     */
    private connections: Redis[] = [];
    /** `close()` phải gọi lại được (worker/CLI có thể đóng hai lần khi tắt máy). */
    private closed = false;

    constructor(redisUrl: string) {
        this.redisUrl = redisUrl;
        this.queue = new Queue('sepay-webhooks', { connection: this.createConnection() });
    }

    private createConnection(): Redis {
        const connection = new Redis(this.redisUrl, {
            maxRetriesPerRequest: null,
        });
        this.connections.push(connection);
        return connection;
    }

    async addJob(payload: SePayWebhookPayload): Promise<void> {
        const jobId = payload.id ? `sepay-${payload.id}` : undefined;
        await this.queue.add('process-webhook', signWebhookPayload(payload), {
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
        const connection = this.createConnection();
        this.worker = new Worker(
            'sepay-webhooks',
            async (job) => {
                await processVerifiedWebhook(job.data);
            },
            { connection, concurrency: 5 }
        );
        this.worker.on('error', (err) => {
            console.error('[Billing Webhook Worker] BullMQ error:', err);
        });
    }

    async close(): Promise<void> {
        // Gọi lại lần hai phải là việc rỗng (xem chú thích ở BullMQQueue.close).
        if (this.closed) return;
        this.closed = true;
        if (this.worker) {
            await this.worker.close();
        }
        await this.queue.close();
        // Đóng nốt các kết nối mình đã tạo (BullMQ không sở hữu chúng).
        for (const connection of this.connections) {
            if (connection.status !== 'end') connection.disconnect();
        }
        this.connections = [];
    }
}

export class MemoryBillingWebhookQueue implements IBillingWebhookQueue {
    public events = new EventEmitter();
    private isRunning = true;

    async addJob(payload: SePayWebhookPayload): Promise<void> {
        // Ký ngay khi enqueue và kiểm chứng ở phía xử lý như BullMQ — cùng
        // một cổng tin cậy cho cả hai loại hàng đợi.
        const signed = signWebhookPayload(payload);
        // Asynchronously process without blocking caller
        setImmediate(async () => {
            if (!this.isRunning) return;
            try {
                await processVerifiedWebhook(signed);
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
