import { Queue, Worker, QueueEvents, Job } from 'bullmq';
import Redis from 'ioredis';
import { IVideoQueue, JobData, JobRecord, JobProgress, JobUpdate } from './interfaces.js';
import { type fullPipelineResult } from '../pipeline/orchestrator.js';
import { EventEmitter } from 'node:events';
import { hashString32, parseSeedSafe } from '../pipeline/rng.js';
import { systemSettings } from '../admin/systemSettings.js';

/** Trạng thái BullMQ được coi là "chưa kết thúc" (có thể hủy). */
const BULLMQ_ALL_STATES = ['active', 'waiting', 'delayed', 'prioritized', 'waiting-children', 'completed', 'failed'] as const;

export class BullMQQueue implements IVideoQueue {
    private queue: Queue<JobData, fullPipelineResult, string>;
    private worker?: Worker<JobData, fullPipelineResult, string>;
    private queueEvents?: QueueEvents;
    private connectionOptions: any;
    private redisUrl: string;

    // We can simulate an event emitter so the API has a unified way to listen
    // regardless of BullMQ or Memory.
    public events = new EventEmitter();

    constructor(redisUrl: string) {
        this.redisUrl = redisUrl;
        this.connectionOptions = {
            maxRetriesPerRequest: null // Required by BullMQ
        };
        const connection = new Redis(this.redisUrl, this.connectionOptions);

        this.queue = new Queue('video-generation', { connection });
    }

    async addJob(jobId: string, data: JobData): Promise<void> {
        if (data.seed === undefined) {
            data.seed = parseSeedSafe(data.request?.seed, hashString32(jobId));
        }
        data.cancelled = false;
        await this.queue.add('render', data, { jobId });
    }

    /** Chuyển trạng thái BullMQ (+ cờ cancelled) sang JobRecord. */
    private mapJob(job: Job<JobData, fullPipelineResult, string>, state: string): JobRecord {
        let status: JobRecord['status'] = 'queued';
        if (job.data?.cancelled) {
            status = 'cancelled';
        } else if (state === 'active') status = 'running';
        else if (state === 'completed') {
            status = job.returnvalue?.qaStatus === 'fail' ? 'qa_failed' : 'completed';
        } else if (state === 'failed') status = 'failed';

        return {
            jobId: job.id!,
            userId: job.data?.userId,
            status,
            request: job.data.request,
            script: job.data.script,
            seed: job.data.seed ?? (job.data.request?.seed !== undefined ? job.data.request?.seed : hashString32(job.id!)),
            createdAt: new Date(job.timestamp).toISOString(),
            updatedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : new Date().toISOString(),
            progress: typeof job.progress === 'object' && job.progress !== null ? (job.progress as JobProgress) : undefined,
            result: job.returnvalue || undefined,
            qaStatus: job.returnvalue?.qaStatus,
            qaReport: job.returnvalue?.qaReport,
            error: job.failedReason || undefined,
        };
    }

    async getJob(jobId: string): Promise<JobRecord | null> {
        const job = await this.queue.getJob(jobId);
        if (!job) return null;
        return this.mapJob(job, await job.getState());
    }

    async getJobs(): Promise<JobRecord[]> {
        const jobs = await this.queue.getJobs([...BULLMQ_ALL_STATES]);
        const records: JobRecord[] = [];
        for (const job of jobs) {
            records.push(this.mapJob(job, await job.getState()));
        }
        return records;
    }

    async cancelJob(jobId: string): Promise<boolean> {
        const job = await this.queue.getJob(jobId);
        if (!job) return false;
        const state = await job.getState();
        if (state === 'completed' || state === 'failed') return false;

        if (state === 'active') {
            // Không thể dừng handler đang chạy; đánh dấu để lần đọc sau trả về cancelled
            // và để job không được thử lại.
            await job.updateData({ ...job.data, cancelled: true });
            return true;
        }

        // Job đang chờ: xoá khỏi hàng đợi để worker không nhặt lên chạy.
        try {
            await job.remove();
        } catch {
            await job.updateData({ ...job.data, cancelled: true });
        }
        return true;
    }

    async retryJob(jobId: string): Promise<boolean> {
        const job = await this.queue.getJob(jobId);
        if (!job) return false;
        const state = await job.getState();
        const wasCancelled = Boolean(job.data?.cancelled);
        if (state !== 'failed' && !wasCancelled) return false;

        await job.updateData({ ...job.data, cancelled: false });
        if (state === 'failed') {
            await job.retry('failed');
        } else if (state === 'completed') {
            await job.retry('completed');
        }
        return true;
    }

    async removeJob(jobId: string): Promise<boolean> {
        const job = await this.queue.getJob(jobId);
        if (!job) return false;
        try {
            await job.remove();
            return true;
        } catch {
            return false;
        }
    }

    async updateJob(jobId: string, patch: JobUpdate): Promise<JobRecord | null> {
        const job = await this.queue.getJob(jobId);
        if (!job) return null;
        const data: JobData = { ...job.data };
        if (patch.targetDurationSec !== undefined) {
            data.request = { ...data.request, targetDurationSec: patch.targetDurationSec };
        }
        if (patch.script !== undefined) {
            data.script = patch.script;
        }
        await job.updateData(data);
        return this.getJob(jobId);
    }

    process(handler: (data: JobData, updateProgress: (p: JobProgress) => Promise<void>) => Promise<fullPipelineResult>): void {
        const connection = new Redis(this.redisUrl, this.connectionOptions);
        // Số job chạy song song lấy theo cài đặt quản trị (trước đây viết cứng là 2).
        const configured = Math.round(Number(systemSettings.get().maxConcurrentJobs));
        const concurrency = Number.isFinite(configured) && configured > 0 ? configured : 2;
        this.worker = new Worker('video-generation', async (job: Job<JobData>) => {
            return await handler(job.data, async (p) => {
                await job.updateProgress(p as any);
            });
        }, {
            connection,
            concurrency
        });

        this.worker.on('error', (err: any) => {
            console.error('BullMQ Worker error:', err);
        });
    }

    startListeners(): void {
        const connection = new Redis(this.redisUrl, this.connectionOptions);
        this.queueEvents = new QueueEvents('video-generation', { connection });

        this.queueEvents.on('progress', (args: any) => {
            this.events.emit('progress', args);
        });

        this.queueEvents.on('completed', (args: any) => {
            this.events.emit('completed', args);
        });

        this.queueEvents.on('failed', (args: any) => {
            this.events.emit('failed', args);
        });
    }

    async close(): Promise<void> {
        if (this.worker) await this.worker.close();
        if (this.queueEvents) await this.queueEvents.close();
        await this.queue.close();
    }
}
