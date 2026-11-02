import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { getConfig } from '../config.js';
import { getAssetByIdForUser, updateAssetCaption } from '../database/assets.js';
import { captionAsset } from '../pipeline/assetCaption.js';

// ============================================================
// HÀNG ĐỢI MÔ TẢ ASSET (#103) — vision model chạy nền
// File: src/queue/assetCaption.ts
//
// Sau khi upload asset, API đẩy một job nền để gọi vision model mô tả nội dung
// ảnh rồi ghi ngược vào cột description + tags. Tách khỏi request upload
// để upload không phải chờ gọi model (có thể vài giây).
//
// Theo đúng khuôn của billing/queue.ts: BullMQ khi có Redis, memory fallback
// khi không. Memory fallback xử lý ngay bằng setImmediate trong cùng tiến trình.
// ============================================================

export interface AssetCaptionPayload {
    assetId: string;
    userId: string;
}

async function processCaption(payload: AssetCaptionPayload): Promise<void> {
    const asset = await getAssetByIdForUser(payload.assetId, payload.userId);
    if (!asset) {
        console.warn(`[AssetCaption] Bỏ qua asset không tồn tại / không thuộc user: ${payload.assetId}`);
        return;
    }

    try {
        const caption = await captionAsset(asset);
        await updateAssetCaption(asset.id, asset.userId, caption.description, caption.tags);
        console.log(`[AssetCaption] Đã mô tả asset ${asset.id} (${asset.kind})`);
    } catch (err) {
        // Mô tả lỗi KHÔNG làm hỏng asset — description giữ nguyên (rỗng) và user vẫn dùng được.
        console.warn(`[AssetCaption] Lỗi mô tả asset ${asset.id}: ${(err as Error)?.message}`);
    }
}

export interface IAssetCaptionQueue {
    addJob(payload: AssetCaptionPayload): Promise<void>;
    startWorker(): Promise<void>;
    close(): Promise<void>;
}

export class BullMQAssetCaptionQueue implements IAssetCaptionQueue {
    private queue: Queue<AssetCaptionPayload>;
    private worker?: Worker<AssetCaptionPayload>;
    private connections: Redis[] = [];
    private closed = false;
    private redisUrl: string;

    constructor(redisUrl: string) {
        this.redisUrl = redisUrl;
        this.queue = new Queue('asset-captioning', { connection: this.createConnection() });
    }

    private createConnection(): Redis {
        const connection = new Redis(this.redisUrl, { maxRetriesPerRequest: null });
        this.connections.push(connection);
        return connection;
    }

    async addJob(payload: AssetCaptionPayload): Promise<void> {
        await this.queue.add('caption-asset', payload, {
            jobId: `caption-${payload.assetId}`,
            removeOnComplete: 1000,
            removeOnFail: 5000,
            attempts: 2,
            backoff: { type: 'exponential', delay: 3000 },
        });
    }

    async startWorker(): Promise<void> {
        if (this.worker) return;
        const connection = this.createConnection();
        this.worker = new Worker(
            'asset-captioning',
            async (job) => { await processCaption(job.data); },
            { connection, concurrency: 3 }
        );
        this.worker.on('error', (err) => {
            console.error('[AssetCaption Worker] BullMQ error:', err);
        });
    }

    async close(): Promise<void> {
        if (this.closed) return;
        this.closed = true;
        if (this.worker) await this.worker.close();
        await this.queue.close();
        for (const connection of this.connections) {
            if (connection.status !== 'end') connection.disconnect();
        }
        this.connections = [];
    }
}

export class MemoryAssetCaptionQueue implements IAssetCaptionQueue {
    private isRunning = true;

    async addJob(payload: AssetCaptionPayload): Promise<void> {
        // Xử lý ngay trong tiến trình API khi không có Redis — không chặn request.
        setImmediate(async () => {
            if (!this.isRunning) return;
            try {
                await processCaption(payload);
            } catch (err) {
                console.error('[Memory AssetCaption Queue] Error:', err);
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

let _assetCaptionQueue: IAssetCaptionQueue | null = null;

export async function getAssetCaptionQueue(): Promise<IAssetCaptionQueue> {
    if (_assetCaptionQueue) return _assetCaptionQueue;

    const config = getConfig();
    if (config.QUEUE_TYPE === 'redis' && config.REDIS_URL) {
        let isConnected = false;
        try {
            const redis = new Redis(config.REDIS_URL, {
                maxRetriesPerRequest: null,
                retryStrategy: (times: number) => (times > 2 ? null : 1000),
                connectTimeout: 2000,
            });
            await redis.ping();
            isConnected = true;
            redis.disconnect();
        } catch {
            // Fallback to memory
        }

        if (isConnected) {
            _assetCaptionQueue = new BullMQAssetCaptionQueue(config.REDIS_URL);
            return _assetCaptionQueue;
        }
    }

    _assetCaptionQueue = new MemoryAssetCaptionQueue();
    return _assetCaptionQueue;
}

export function setAssetCaptionQueue(queue: IAssetCaptionQueue | null): void {
    _assetCaptionQueue = queue;
}
