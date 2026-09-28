import { type videoRequest, type videoScript } from "../llm/schema.js";
import { type fullPipelineResult } from "../pipeline/orchestrator.js";

export interface JobProgress {
    phase: string;
    progress: number;
    message: string;
}

export interface JobData {
    jobId: string;
    request: videoRequest;
    script?: videoScript;
    bgmPath?: string;
    skipPreview?: boolean;
    outputDir: string;
}

export interface IVideoQueue {
    /** Queue a new video generation job */
    addJob(jobId: string, data: JobData): Promise<void>;

    /** Fetch the current status of a job */
    getJob(jobId: string): Promise<JobRecord | null>;

    /** Register the worker processing handler */
    process(handler: (data: JobData, updateProgress: (p: JobProgress) => Promise<void>) => Promise<fullPipelineResult>): void;
    
    /** Start listening for global events (completed, failed, progress) on the API side */
    startListeners(): void;

    /** Global events emitter */
    events: import('node:events').EventEmitter;

    /** Stop listeners or workers */
    close(): Promise<void>;
}

// Emitting exactly what index.ts expects for /api/jobs
export interface JobRecord {
    jobId: string;
    status: 'queued' | 'running' | 'completed' | 'failed';
    request: videoRequest;
    createdAt: string;
    updatedAt: string;
    progress?: JobProgress;
    result?: fullPipelineResult;
    error?: string;
}
