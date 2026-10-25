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
    /**
     * Kết nối ioredis do lớp này tạo. BullMQ KHÔNG đóng kết nối mà bên gọi truyền vào
     * (nó coi kết nối đó thuộc về bên gọi), nên phải tự giữ và tự đóng ở `close()` —
     * nếu không, tiến trình gọi `close()` (worker, CLI, test) vẫn còn socket mở và treo.
     */
    private connections: Redis[] = [];
    /** `close()` phải gọi lại được (worker/CLI có thể đóng hai lần khi tắt máy). */
    private closed = false;

    // We can simulate an event emitter so the API has a unified way to listen
    // regardless of BullMQ or Memory.
    public events = new EventEmitter();

    constructor(redisUrl: string) {
        this.redisUrl = redisUrl;
        this.connectionOptions = {
            maxRetriesPerRequest: null // Required by BullMQ
        };
        this.queue = new Queue('video-generation', { connection: this.createConnection() });
    }

    private createConnection(): Redis {
        const connection = new Redis(this.redisUrl, this.connectionOptions);
        this.connections.push(connection);
        return connection;
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
            this.events.emit('cancelled', { jobId });
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
            // Báo 'cancelled' để nhả slot đồng thời của job (nếu có) —
            // job bị xoá không còn sự kiện kết thúc nào khác.
            this.events.emit('cancelled', { jobId });
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
        const connection = this.createConnection();
        // Số job chạy song song lấy theo cài đặt quản trị (trước đây viết cứng là 2).
        const configured = Math.round(Number(systemSettings.get().maxConcurrentJobs));
        const concurrency = Number.isFinite(configured) && configured > 0 ? configured : 2;
        this.worker = new Worker('video-generation', async (job: Job<JobData>) => {
            return await handler(job.data, async (p) => {
                // Admin huỷ job đang chạy chỉ sửa được bản ghi trong Redis —
                // job đang chạy giữ bản sao data cũ nên không tự thấy cờ.
                // Đọc lại bản ghi ở mỗi lần báo tiến độ: thấy cờ cancelled
                // thì dừng pipeline ngay thay vì render hết rồi mới biết.
                const fresh = job.id ? await this.queue.getJob(job.id) : undefined;
                if (fresh?.data?.cancelled) {
                    throw new Error('JOB_CANCELLED');
                }
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
        const connection = this.createConnection();
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

        // Job bị xoá trong lúc chờ (admin cancel/remove) không sinh
        // completed/failed: chuyển 'removed' thành 'cancelled' để nơi giữ
        // slot đồng thời (releaseJobSlot ở index.ts) được nhả — trước đây
        // slot rò vĩnh viễn tới khi restart tiến trình.
        this.queueEvents.on('removed', (args: any) => {
            this.events.emit('cancelled', args);
        });
    }

    async close(): Promise<void> {
        // Gọi lại lần hai phải là việc rỗng: đóng tiếp một hàng đợi đã đóng khiến BullMQ
        // gửi lệnh trên kết nối đã ngắt và treo hàng chục giây (đã gặp thật khi test gọi
        // close() hai lần).
        if (this.closed) return;
        this.closed = true;
        if (this.worker) await this.worker.close();
        if (this.queueEvents) await this.queueEvents.close();
        await this.queue.close();
        // Đóng nốt các kết nối mình đã tạo (BullMQ không sở hữu chúng) để tiến trình
        // gọi close() thật sự thoát được, không để lại socket mở.
        for (const connection of this.connections) {
            if (connection.status !== 'end') connection.disconnect();
        }
        this.connections = [];
    }
}
