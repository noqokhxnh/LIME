export interface IRateLimiter {
    checkRpm(id: string, maxRpm?: number, cost?: number): boolean;
    acquireConcurrentJob(id: string, maxConcurrent?: number): boolean;
    releaseConcurrentJob(id: string): void;
    checkAndIncrementDailyQuota(id: string, maxDaily?: number): boolean;
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
     *
     * Một request sinh 3 phương án gọi LLM 3 lần (cộng 1 lần phân loại), nên
     * tính theo lượt gọi thật thay vì theo request — nếu không, người dùng có
     * thể nhân chi phí LLM lên 3 lần mà vẫn nằm trong hạn mức.
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
}

export const rateLimiter = new InMemoryRateLimiter();
