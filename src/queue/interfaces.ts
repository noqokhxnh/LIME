import { type videoRequest, type videoScript } from "../llm/schema.js";
import { type fullPipelineResult } from "../pipeline/orchestrator.js";
import { type QAReport } from "../pipeline/oracleQa.js";
import { type PartialClarifyAnswers } from "../pipeline/clarify.js";

export interface JobProgress {
    phase: string;
    progress: number;
    message: string;
}

export interface JobData {
    jobId: string;
    /**
     * ID người dùng đã yêu cầu job (nếu đã đăng nhập).
     *
     * Trước đây job không lưu chủ sở hữu nên cổng quản trị luôn hiển thị
     * "Anonymous"/"Guest" và tìm kiếm theo email người dùng không bao giờ khớp.
     */
    userId?: string;
    request: videoRequest;
    script?: videoScript;
    /**
     * Chế độ "Để AI quyết hết": worker tự trả lời 3 câu làm rõ, tự sinh 3 phương
     * án, tự chọn phương án khớp thời lượng nhất rồi render — không qua bước duyệt.
     */
    autoDirect?: boolean;
    /** Câu trả lời người dùng đã chọn cho chế độ auto; thiếu thì worker tự suy ra. */
    autoAnswers?: PartialClarifyAnswers;
    /** Xoay bộ phương án khi người dùng bấm "Đổi bộ" trước khi giao cho AI. */
    variantRotation?: number;
    bgmPath?: string;
    skipPreview?: boolean;
    outputDir: string;
    seed?: number;
    /**
     * Đánh dấu job đã bị quản trị viên hủy. Cần thiết cho hàng đợi BullMQ vì
     * không thể xoá ngay một job đang chạy — cờ này được lưu kèm dữ liệu job để
     * lần đọc trạng thái sau trả về `cancelled`.
     */
    cancelled?: boolean;
}

/** Dữ liệu quản trị viên có thể sửa trước khi cho job chạy lại. */
export interface JobUpdate {
    /** Thời lượng mục tiêu (giây) ghi đè vào `request.targetDurationSec`. */
    targetDurationSec?: number;
    /** Kịch bản mới (đã được validate ở tầng route). */
    script?: videoScript;
}

export interface IVideoQueue {
    /** Queue a new video generation job */
    addJob(jobId: string, data: JobData): Promise<void>;

    /** Fetch the current status of a job */
    getJob(jobId: string): Promise<JobRecord | null>;

    /** Fetch all jobs (for API listing) */
    getJobs(): Promise<JobRecord[]>;

    /**
     * Hủy một job đang chờ hoặc đang chạy (best-effort với job đang chạy).
     * Trả về `false` nếu không tìm thấy job hoặc job đã kết thúc.
     */
    cancelJob(jobId: string): Promise<boolean>;

    /**
     * Đưa một job đã kết thúc (thất bại / bị hủy) trở lại hàng đợi để chạy lại.
     * Trả về `false` nếu job không tồn tại hoặc đang ở trạng thái không hợp lệ.
     */
    retryJob(jobId: string): Promise<boolean>;

    /** Xoá hẳn job khỏi hàng đợi và bộ lưu trạng thái. Trả về `false` nếu không có. */
    removeJob(jobId: string): Promise<boolean>;

    /** Cập nhật dữ liệu job (thời lượng / kịch bản) dùng cho lần chạy lại. */
    updateJob(jobId: string, patch: JobUpdate): Promise<JobRecord | null>;

    /** Register the worker processing handler */
    process(handler: (data: JobData, updateProgress: (p: JobProgress) => Promise<void>) => Promise<fullPipelineResult>): void;

    /** Start listening for global events (completed, failed, cancelled, progress) on the API side */
    startListeners(): void;

    /** Global events emitter */
    events: import('node:events').EventEmitter;

    /** Stop listeners or workers */
    close(): Promise<void>;
}

// Emitting exactly what index.ts expects for /api/jobs
export interface JobRecord {
    jobId: string;
    /** ID người dùng sở hữu job (nếu đã đăng nhập). */
    userId?: string;
    status: 'queued' | 'running' | 'completed' | 'failed' | 'qa_failed' | 'cancelled';
    request: videoRequest;
    /** Kịch bản gắn với job (nếu có) để admin xem/sửa trước khi chạy lại. */
    script?: videoScript;
    createdAt: string;
    updatedAt: string;
    progress?: JobProgress;
    result?: fullPipelineResult;
    error?: string;
    seed?: number;
    qaStatus?: 'pass' | 'warn' | 'fail' | 'skipped' | 'qa_failed';
    qaReport?: QAReport;
}
