import IORedis from "ioredis";
import { getConfig } from "./config.js";
import type { videoRequest } from "./llm/schema.js";
import type { fullPipelineResult } from "./pipeline/orchestrator.js";

export interface JobRecord {
    jobId: string;
    status: 'queued' | 'running' | 'completed' | 'failed' | 'draft';
    request: videoRequest;
    createdAt: string;
    updatedAt: string;
    progress?: { phase: string; progress: number; message: string };
    result?: fullPipelineResult;
    error?: string;
    script?: any;
}

const config = getConfig();
export const redisClient = new IORedis(config.REDIS_URL);

export const jobsStore = {
    async get(jobId: string): Promise<JobRecord | null> {
        const data = await redisClient.hget("vidtml:jobs", jobId);
        return data ? JSON.parse(data) : null;
    },
    async set(jobId: string, job: JobRecord): Promise<void> {
        await redisClient.hset("vidtml:jobs", jobId, JSON.stringify(job));
    },
    async getAll(): Promise<JobRecord[]> {
        const data = await redisClient.hgetall("vidtml:jobs");
        return Object.values(data).map(d => JSON.parse(d));
    }
};
