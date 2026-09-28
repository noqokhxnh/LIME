import { EventEmitter } from 'node:events';
import { IVideoQueue, JobData, JobRecord, JobProgress } from './interfaces.js';
import { type fullPipelineResult } from '../pipeline/orchestrator.js';

export const memoryQueueEvents = new EventEmitter();

export class MemoryQueue implements IVideoQueue {
    private store = new Map<string, JobRecord>();
    private pendingJobs: JobData[] = [];
    private isProcessing = false;
    private handler?: (data: JobData, updateProgress: (p: JobProgress) => Promise<void>) => Promise<fullPipelineResult>;
    // Allow up to 2 concurrent jobs
    private maxConcurrency = 2;
    private activeJobs = 0;
    
    public events = memoryQueueEvents;

    constructor() {}

    async addJob(jobId: string, data: JobData): Promise<void> {
        const record: JobRecord = {
            jobId,
            status: 'queued',
            request: data.request,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        this.store.set(jobId, record);
        this.pendingJobs.push(data);
        this.pump();
    }

    async getJob(jobId: string): Promise<JobRecord | null> {
        return this.store.get(jobId) || null;
    }

    process(handler: (data: JobData, updateProgress: (p: JobProgress) => Promise<void>) => Promise<fullPipelineResult>): void {
        this.handler = handler;
        this.pump();
    }

    startListeners(): void {
        // Events are emitted globally on memoryQueueEvents, API can attach listeners to it.
        // We do nothing specific to "start" them here since it's an EventEmitter.
    }

    async close(): Promise<void> {
        this.pendingJobs = [];
    }

    public getAllJobs(): JobRecord[] {
        return Array.from(this.store.values());
    }

    private pump(): void {
        if (!this.handler || this.activeJobs >= this.maxConcurrency || this.pendingJobs.length === 0) {
            return;
        }

        const data = this.pendingJobs.shift();
        if (!data) return;

        this.activeJobs++;
        this.runJob(data).finally(() => {
            this.activeJobs--;
            this.pump(); // Try to process the next job
        });
        
        // If we can still process more, pump again immediately
        this.pump();
    }

    private async runJob(data: JobData): Promise<void> {
        const record = this.store.get(data.jobId);
        if (record) {
            record.status = 'running';
            record.updatedAt = new Date().toISOString();
            this.store.set(data.jobId, record);
        }

        try {
            const result = await this.handler!(data, async (p) => {
                const rec = this.store.get(data.jobId);
                if (rec) {
                    rec.progress = p;
                    rec.updatedAt = new Date().toISOString();
                    this.store.set(data.jobId, rec);
                    memoryQueueEvents.emit('progress', { jobId: data.jobId, data: p });
                }
            });

            const finalRecord = this.store.get(data.jobId);
            if (finalRecord) {
                finalRecord.status = 'completed';
                finalRecord.result = result;
                finalRecord.updatedAt = new Date().toISOString();
                this.store.set(data.jobId, finalRecord);
            }
            memoryQueueEvents.emit('completed', { jobId: data.jobId, returnvalue: result });
        } catch (err: any) {
            const errRecord = this.store.get(data.jobId);
            if (errRecord) {
                errRecord.status = 'failed';
                errRecord.error = err.message;
                errRecord.updatedAt = new Date().toISOString();
                this.store.set(data.jobId, errRecord);
            }
            memoryQueueEvents.emit('failed', { jobId: data.jobId, failedReason: err.message });
        }
    }
}
