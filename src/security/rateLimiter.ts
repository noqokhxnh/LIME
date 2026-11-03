import Redis from 'ioredis';
import { getConfig } from '../config.js';

export interface IRateLimiter {
    checkRpm(id: string, maxRpm?: number, cost?: number): Promise<boolean> | boolean;
    acquireConcurrentJob(id: string, maxConcurrent?: number): Promise<boolean> | boolean;
    releaseConcurrentJob(id: string): Promise<void> | void;
    checkAndIncrementDailyQuota(id: string, maxDaily?: number): Promise<boolean> | boolean;
    refundDailyQuota(id: string): Promise<void> | void;
}

export class InMemoryRateLimiter implements IRateLimiter {
    private rpmMap = new Map<string, { count: number; resetAt: number }>();
    private concurrentMap = new Map<string, number>();
    private dailyMap = new Map<string, { count: number; resetAt: number }>();

    constructor() {
        setInterval(() => this.cleanup(), 15 * 60 * 1000).unref();
    }

    private cleanup() {
        const now = Date.now();
        for (const [ip, data] of this.rpmMap.entries()) {
            if (now > data.resetAt) {
                this.rpmMap.delete(ip);
            }
        }
        for (const [ip, data] of this.dailyMap.entries()) {
            if (now > data.resetAt) {
                this.dailyMap.delete(ip);
            }
        }
    }

    /**
     * Tiêu `cost` lượt trong cửa sổ 1 phút.
     */
    public checkRpm(id: string, maxRpm = 20, cost = 1): boolean {
        const now = Date.now();
        let record = this.rpmMap.get(id);
        
        if (!record || now > record.resetAt) {
            record = { count: 0, resetAt: now + 60_000 }; // reset after 1 minute
            this.rpmMap.set(id, record);
        }
        
        const amount = Math.max(1, Math.floor(cost));
        if (record.count + amount > maxRpm) {
            return false;
        }
        
        record.count += amount;
        return true;
    }

    public acquireConcurrentJob(id: string, maxConcurrent = 2): boolean {
        const count = this.concurrentMap.get(id) || 0;
        if (count >= maxConcurrent) {
            return false;
        }
        this.concurrentMap.set(id, count + 1);
        return true;
    }

    public releaseConcurrentJob(id: string): void {
        const count = this.concurrentMap.get(id) || 0;
        if (count > 0) {
            this.concurrentMap.set(id, count - 1);
        }
    }

    public checkAndIncrementDailyQuota(id: string, maxDaily = 10): boolean {
        const now = Date.now();
        let record = this.dailyMap.get(id);
        
        if (!record || now > record.resetAt) {
            record = { count: 0, resetAt: now + 24 * 60 * 60 * 1000 }; // reset after 24 hours
            this.dailyMap.set(id, record);
        }
        
        if (record.count >= maxDaily) {
            return false;
        }
        
        record.count++;
        return true;
    }

    /**
     * Hoàn một lượt quota ngày đã trừ.
     */
    public refundDailyQuota(id: string): void {
        const record = this.dailyMap.get(id);
        if (record && record.count > 0 && Date.now() <= record.resetAt) {
            record.count--;
        }
    }
}

/**
 * Redis-backed Rate Limiter & Concurrency Manager (#131).
 * Đồng bộ hạn mức giữa các replica Fastify và BullMQ workers.
 * Tự động fallback về bộ nhớ cục bộ (InMemoryRateLimiter) khi Redis không khả dụng.
 */
export class RedisRateLimiter implements IRateLimiter {
    private fallback = new InMemoryRateLimiter();
    private redis: Redis | null = null;
    private isConnected = false;

    constructor(redisUrl?: string) {
        if (redisUrl) {
            try {
                this.redis = new Redis(redisUrl, {
                    maxRetriesPerRequest: 1,
                    connectTimeout: 2000,
                    retryStrategy: () => null,
                    enableOfflineQueue: false,
                });
                this.redis.on('connect', () => { this.isConnected = true; });
                this.redis.on('ready', () => { this.isConnected = true; });
                this.redis.on('error', () => { this.isConnected = false; });
                this.redis.on('close', () => { this.isConnected = false; });
            } catch {
                this.isConnected = false;
            }
        }
    }

    public async checkRpm(id: string, maxRpm = 20, cost = 1): Promise<boolean> {
        if (!this.isConnected || !this.redis) {
            return this.fallback.checkRpm(id, maxRpm, cost);
        }
        try {
            const key = `ratelimit:rpm:${id}`;
            const amount = Math.max(1, Math.floor(cost));
            const count = await this.redis.incrby(key, amount);
            if (count === amount) {
                await this.redis.expire(key, 60);
            }
            if (count > maxRpm) {
                return false;
            }
            return true;
        } catch {
            return this.fallback.checkRpm(id, maxRpm, cost);
        }
    }

    public async acquireConcurrentJob(id: string, maxConcurrent = 2): Promise<boolean> {
        if (!this.isConnected || !this.redis) {
            return this.fallback.acquireConcurrentJob(id, maxConcurrent);
        }
        try {
            const key = `ratelimit:concurrent:${id}`;
            const count = await this.redis.incr(key);
            if (count === 1) {
                await this.redis.expire(key, 3600); // 1 giờ tự động xoá tránh treo vĩnh viễn nếu worker sập
            }
            if (count > maxConcurrent) {
                await this.redis.decr(key);
                return false;
            }
            return true;
        } catch {
            return this.fallback.acquireConcurrentJob(id, maxConcurrent);
        }
    }

    public async releaseConcurrentJob(id: string): Promise<void> {
        if (!this.isConnected || !this.redis) {
            this.fallback.releaseConcurrentJob(id);
            return;
        }
        try {
            const key = `ratelimit:concurrent:${id}`;
            const count = await this.redis.decr(key);
            if (count <= 0) {
                await this.redis.del(key);
            }
        } catch {
            this.fallback.releaseConcurrentJob(id);
        }
    }

    public async checkAndIncrementDailyQuota(id: string, maxDaily = 10): Promise<boolean> {
        if (!this.isConnected || !this.redis) {
            return this.fallback.checkAndIncrementDailyQuota(id, maxDaily);
        }
        try {
            const key = `ratelimit:daily:${id}`;
            const count = await this.redis.incr(key);
            if (count === 1) {
                await this.redis.expire(key, 86400); // 24 giờ
            }
            if (count > maxDaily) {
                return false;
            }
            return true;
        } catch {
            return this.fallback.checkAndIncrementDailyQuota(id, maxDaily);
        }
    }

    public async refundDailyQuota(id: string): Promise<void> {
        if (!this.isConnected || !this.redis) {
            this.fallback.refundDailyQuota(id);
            return;
        }
        try {
            const key = `ratelimit:daily:${id}`;
            const count = await this.redis.decr(key);
            if (count <= 0) {
                await this.redis.del(key);
            }
        } catch {
            this.fallback.refundDailyQuota(id);
        }
    }
}

export function createRateLimiter(): IRateLimiter {
    const config = getConfig();
    if (config.QUEUE_TYPE === 'redis' && config.REDIS_URL) {
        return new RedisRateLimiter(config.REDIS_URL);
    }
    return new InMemoryRateLimiter();
}

export const rateLimiter: IRateLimiter = createRateLimiter();
