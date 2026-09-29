import { IVideoQueue } from './interfaces.js';
import { MemoryQueue } from './memoryQueue.js';
import { BullMQQueue } from './bullQueue.js';
import { getConfig } from '../config.js';
import Redis from 'ioredis';

let queueInstance: IVideoQueue | null = null;

export async function getQueue(): Promise<IVideoQueue> {
    if (queueInstance) return queueInstance;

    const config = getConfig();

    if (config.QUEUE_TYPE === 'redis' && config.REDIS_URL) {
        let isConnected = false;
        try {
            const redis = new Redis(config.REDIS_URL, {
                maxRetriesPerRequest: null,
                retryStrategy: (times: number) => {
                    if (times > 2) return null; // stop retrying
                    return 1000;
                },
                connectTimeout: 3000 // 3 seconds timeout
            });

            await redis.ping();
            isConnected = true;
            redis.disconnect();
        } catch (err: any) {
            console.warn(`[Queue] Failed to connect to Redis (${err.message}). Fallback to Memory Queue.`);
        }

        if (isConnected) {
            queueInstance = new BullMQQueue(config.REDIS_URL);
            return queueInstance;
        }
    }

    queueInstance = new MemoryQueue();
    return queueInstance;
}
