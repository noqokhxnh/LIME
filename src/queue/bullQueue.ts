import { Queue, Worker, QueueEvents, Job } from 'bullmq';
import Redis from 'ioredis';
import { IVideoQueue, JobData, JobRecord, JobProgress } from './interfaces.js';
import { type fullPipelineResult } from '../pipeline/orchestrator.js';
import { EventEmitter } from 'node:events';

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
        await this.queue.add('render', data, { jobId });
    }

    async getJob(jobId: string): Promise<JobRecord | null> {
        const job = await this.queue.getJob(jobId);
        if (!job) return null;

        const state = await job.getState();
        
        // Map bullmq state to JobRecord status
        let status: JobRecord['status'] = 'queued';
        if (state === 'active') status = 'running';
        else if (state === 'completed') status = 'completed';
        else if (state === 'failed') status = 'failed';

        return {
            jobId: job.id!,
            status,
            request: job.data.request,
            createdAt: new Date(job.timestamp).toISOString(),
            updatedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : new Date().toISOString(),
            progress: typeof job.progress === 'object' && job.progress !== null ? (job.progress as JobProgress) : undefined,
            result: job.returnvalue || undefined,
            error: job.failedReason || undefined,
        };
    }

    async getJobs(): Promise<JobRecord[]> {
        const jobs = await this.queue.getJobs(['active', 'waiting', 'completed', 'failed']);
        const records: JobRecord[] = [];
        for (const job of jobs) {
            const state = await job.getState();
            let status: JobRecord['status'] = 'queued';
            if (state === 'active') status = 'running';
            else if (state === 'completed') status = 'completed';
            else if (state === 'failed') status = 'failed';
            records.push({
                jobId: job.id!,
                status,
                request: job.data.request,
                createdAt: new Date(job.timestamp).toISOString(),
                updatedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : new Date().toISOString(),
            });
        }
        return records;
    }

    process(handler: (data: JobData, updateProgress: (p: JobProgress) => Promise<void>) => Promise<fullPipelineResult>): void {
        const connection = new Redis(this.redisUrl, this.connectionOptions);
        this.worker = new Worker('video-generation', async (job: Job<JobData>) => {
            return await handler(job.data, async (p) => {
                await job.updateProgress(p as any);
            });
        }, { 
            connection,
            concurrency: 2 // Max 2 parallel jobs on worker
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
