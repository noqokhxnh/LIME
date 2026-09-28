export interface IRateLimiter {
    checkRpm(id: string, maxRpm?: number): boolean;
    acquireConcurrentJob(id: string, maxConcurrent?: number): boolean;
    releaseConcurrentJob(id: string): void;
    checkAndIncrementDailyQuota(id: string, maxDaily?: number): boolean;
}

export class InMemoryRateLimiter implements IRateLimiter {
    private rpmMap = new Map<string, { count: number; resetAt: number }>();
    private concurrentMap = new Map<string, number>();
    private dailyMap = new Map<string, { count: number; resetAt: number }>();

    public checkRpm(id: string, maxRpm = 20): boolean {
        const now = Date.now();
        let record = this.rpmMap.get(id);
        
        if (!record || now > record.resetAt) {
            record = { count: 0, resetAt: now + 60_000 }; // reset after 1 minute
            this.rpmMap.set(id, record);
        }
        
        if (record.count >= maxRpm) {
            return false;
        }
        
        record.count++;
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
}

export const rateLimiter = new InMemoryRateLimiter();
