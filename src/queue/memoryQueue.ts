import { EventEmitter } from 'node:events';
import { IVideoQueue, JobData, JobRecord, JobProgress, JobUpdate } from './interfaces.js';
import { type fullPipelineResult } from '../pipeline/orchestrator.js';
import { hashString32, parseSeedSafe } from '../pipeline/rng.js';
import { systemSettings } from '../admin/systemSettings.js';

export const memoryQueueEvents = new EventEmitter();

/**
 * Hàng đợi trong bộ nhớ (dùng khi không cấu hình Redis).
 *
 * Ngoài việc xếp hàng/chạy job, lớp này còn cung cấp đầy đủ thao tác quản trị mà
 * trước đây cổng quản trị gọi nhưng không hề tồn tại: hủy, chạy lại, xoá và sửa
 * dữ liệu job trước khi chạy lại.
 */
export class MemoryQueue implements IVideoQueue {
    private store = new Map<string, JobRecord>();
    /** Dữ liệu gốc của job, giữ lại để có thể chạy lại sau khi kết thúc. */
    private dataStore = new Map<string, JobData>();
    private pendingJobs: JobData[] = [];
    /** Các job đã yêu cầu hủy trong lúc đang chạy (không thể dừng handler giữa chừng). */
    private cancelRequested = new Set<string>();
    private isProcessing = false;
    private handler?: (data: JobData, updateProgress: (p: JobProgress) => Promise<void>) => Promise<fullPipelineResult>;
    /**
     * Số job chạy song song tối đa — lấy theo cài đặt quản trị (`maxConcurrentJobs`).
     * Đọc mỗi lần pump nên thay đổi trong trang Cài đặt có hiệu lực ngay, không cần
     * khởi động lại. Trước đây giá trị này bị viết cứng là 2.
     */
    private get maxConcurrency(): number {
        const configured = Math.round(Number(systemSettings.get().maxConcurrentJobs));
        return Number.isFinite(configured) && configured > 0 ? configured : 2;
    }
    private activeJobs = 0;

    public events = memoryQueueEvents;

    constructor() {}

    async addJob(jobId: string, data: JobData): Promise<void> {
        const seed = parseSeedSafe(data.seed ?? data.request?.seed, hashString32(jobId));
        data.seed = seed;
        data.cancelled = false;
        const now = new Date().toISOString();
        const record: JobRecord = {
            jobId,
            userId: data.userId,
            status: 'queued',
            request: data.request,
            script: data.script,
            seed,
            createdAt: now,
            updatedAt: now,
        };
        this.store.set(jobId, record);
        this.dataStore.set(jobId, data);
        this.pendingJobs.push(data);
        this.pump();
    }

    async getJob(jobId: string): Promise<JobRecord | null> {
        return this.store.get(jobId) || null;
    }

    async getJobs(): Promise<JobRecord[]> {
        return Array.from(this.store.values());
    }

    async cancelJob(jobId: string): Promise<boolean> {
        const record = this.store.get(jobId);
        if (!record) return false;
        // Job đã kết thúc thì không thể hủy nữa.
        if (['completed', 'failed', 'qa_failed', 'cancelled'].includes(record.status)) {
            return false;
        }

        this.pendingJobs = this.pendingJobs.filter((d) => d.jobId !== jobId);
        const data = this.dataStore.get(jobId);
        if (data) data.cancelled = true;
        this.cancelRequested.add(jobId);

        record.status = 'cancelled';
        record.error = 'Job đã bị hủy bởi quản trị viên.';
        record.updatedAt = new Date().toISOString();
        this.store.set(jobId, record);

        memoryQueueEvents.emit('cancelled', { jobId, reason: 'Đã hủy bởi quản trị viên' });
        return true;
    }

    async retryJob(jobId: string): Promise<boolean> {
        const record = this.store.get(jobId);
        const data = this.dataStore.get(jobId);
        if (!record || !data) return false;
        // Chỉ chạy lại job đã kết thúc; job đang chờ/đang chạy phải hủy trước.
        if (record.status === 'queued' || record.status === 'running') return false;

        this.cancelRequested.delete(jobId);
        data.cancelled = false;
        // Đồng bộ dữ liệu chạy lại với những gì admin đã sửa.
        data.request = record.request;
        data.script = record.script;

        record.status = 'queued';
        record.error = undefined;
        record.progress = undefined;
        record.result = undefined;
        record.qaStatus = undefined;
        record.qaReport = undefined;
        record.updatedAt = new Date().toISOString();
        this.store.set(jobId, record);

        this.pendingJobs.push(data);
        this.pump();
        return true;
    }

    async removeJob(jobId: string): Promise<boolean> {
        const existed = this.store.delete(jobId);
        this.dataStore.delete(jobId);
        this.cancelRequested.delete(jobId);
        this.pendingJobs = this.pendingJobs.filter((d) => d.jobId !== jobId);
        return existed;
    }

    async updateJob(jobId: string, patch: JobUpdate): Promise<JobRecord | null> {
        const record = this.store.get(jobId);
        if (!record) return null;

        if (patch.targetDurationSec !== undefined) {
            record.request = { ...record.request, targetDurationSec: patch.targetDurationSec };
        }
        if (patch.script !== undefined) {
            record.script = patch.script;
        }
        record.updatedAt = new Date().toISOString();
        this.store.set(jobId, record);

        const data = this.dataStore.get(jobId);
        if (data) {
            data.request = record.request;
            data.script = record.script;
        }
        return record;
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

    private pump(): void {
        if (!this.handler || this.activeJobs >= this.maxConcurrency || this.pendingJobs.length === 0) {
            return;
        }

        const data = this.pendingJobs.shift();
        if (!data) return;

        // Job đã bị hủy trước khi kịp chạy — bỏ qua.
        if (this.cancelRequested.has(data.jobId) || data.cancelled) {
            this.pump();
            return;
        }

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

            // Nếu admin đã hủy trong lúc job đang chạy, giữ nguyên trạng thái "cancelled".
            if (this.cancelRequested.has(data.jobId)) {
                this.cancelRequested.delete(data.jobId);
                return;
            }

            const finalRecord = this.store.get(data.jobId);
            if (finalRecord) {
                finalRecord.status = result.qaStatus === 'fail' ? 'qa_failed' : 'completed';
                finalRecord.qaStatus = result.qaStatus;
                finalRecord.qaReport = result.qaReport;
                finalRecord.result = result;
                finalRecord.updatedAt = new Date().toISOString();
                this.store.set(data.jobId, finalRecord);
            }
            memoryQueueEvents.emit('completed', { jobId: data.jobId, returnvalue: result });
        } catch (err: any) {
            if (this.cancelRequested.has(data.jobId)) {
                this.cancelRequested.delete(data.jobId);
                return;
            }
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
