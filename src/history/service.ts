import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { IVideoQueue, JobRecord } from '../queue/interfaces.js';
import { isJobVideoAvailable, resolveJobVideoPath } from '../queue/jobVideo.js';
import { safeJobDir } from '../queue/jobPaths.js';
import {
    getVideoHistory,
    historyThumbnailUrl,
    historyToJobRecord,
    isHistoryVideoAvailable,
    listVideoHistory,
    type VideoHistoryRecord,
    type VideoHistorySort,
} from './store.js';

export interface JobOwner {
    id: string;
    role: string;
}

export interface JobListQuery {
    q?: unknown;
    status?: unknown;
    sort?: unknown;
    page?: unknown;
    pageSize?: unknown;
    limit?: unknown;
    format?: unknown;
}

export interface JobSummary {
    jobId: string;
    status: JobRecord['status'];
    topic: string;
    createdAt: string;
    updatedAt: string;
    completedAt: string | null;
    durationSec: number | null;
    resolution: string | null;
    qaStatus: string | null;
    error: string | null;
    progress: number | null;
    hasVideo: boolean;
    videoAvailable: boolean;
    canRestore: boolean;
    thumbnailUrl: string | null;
}

export interface JobListResult {
    items: JobSummary[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
    paginated: boolean;
}

const VALID_STATUS_FILTERS = new Set([
    'all', 'queued', 'running', 'processing', 'completed', 'failed', 'qa_failed', 'cancelled',
]);
const VALID_SORTS = new Set<VideoHistorySort>(['newest', 'oldest', 'name-asc', 'name-desc']);

/**
 * Chính sách sở hữu nghiêm ngặt cho thư viện cá nhân.
 *
 * Khác quy tắc legacy trước đây (`!job.userId || ...`): job không có chủ sở hữu
 * KHÔNG được coi là của mọi người dùng đã đăng nhập. Chỉ admin (RBAC) đọc được
 * job không xác định chủ. Nhờ vậy danh sách "Video của tôi" không bao giờ lộ job
 * của tài khoản khác hoặc job cũ thiếu userId.
 */
export function canReadJob(user: JobOwner, job: { userId?: string | null } | null | undefined): boolean {
    if (!job) return false;
    if (user.role === 'admin') return true;
    return Boolean(job.userId) && job.userId === user.id;
}

/** Phân tích bộ lọc trạng thái: "processing" gộp queued+running, "failed" gộp failed+qa_failed. */
export function parseStatusFilter(raw: unknown): { statuses?: string[]; error?: string } {
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value || value === 'all') return {};
    const parts = value.split(',').map((part) => part.trim()).filter(Boolean);
    if (!parts.length) return {};
    const statuses = new Set<string>();
    for (const part of parts) {
        if (!VALID_STATUS_FILTERS.has(part)) return { error: `Trạng thái không hợp lệ: ${part}` };
        if (part === 'processing') {
            statuses.add('queued');
            statuses.add('running');
        } else if (part === 'failed') {
            statuses.add('failed');
            statuses.add('qa_failed');
        } else if (part !== 'all') {
            statuses.add(part);
        }
    }
    return statuses.size ? { statuses: [...statuses] } : {};
}

function parseIntValue(raw: unknown): number | undefined {
    if (raw === undefined || raw === null || raw === '') return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.floor(n) : undefined;
}

function parseSort(raw: unknown): VideoHistorySort {
    return typeof raw === 'string' && VALID_SORTS.has(raw as VideoHistorySort)
        ? raw as VideoHistorySort
        : 'newest';
}

function queueJobTime(job: JobRecord): number {
    const t = Date.parse(job.updatedAt || job.createdAt || '');
    return Number.isFinite(t) ? t : 0;
}

function matchesQueueFilter(job: JobRecord, statuses?: string[], q?: string): boolean {
    if (statuses?.length && !statuses.includes(job.status)) return false;
    if (q) {
        const haystack = `${job.request?.prompt ?? job.topic ?? ''} ${job.jobId}`.toLocaleLowerCase('vi');
        if (!haystack.includes(q.toLocaleLowerCase('vi'))) return false;
    }
    return true;
}

function queueThumbnailUrl(job: JobRecord): string | null {
    const sceneId =
        job.result?.preview?.previews?.[0]?.sceneId ||
        job.result?.scences?.[0]?.id;
    if (!sceneId) return null;
    const workDir = job.result?.workDir ?? safeJobDir(job.jobId);
    if (!workDir) return null;
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(sceneId)) return null;
    if (!existsSync(join(workDir, 'previews', `${sceneId}.webp`))) return null;
    return `/api/jobs/${encodeURIComponent(job.jobId)}/preview/${encodeURIComponent(sceneId)}`;
}

/** Tổng hợp một job (queue hoặc lịch sử) thành dòng danh sách an toàn cho client. */
export function summarizeJob(job: JobRecord, history?: VideoHistoryRecord | null): JobSummary {
    const videoPath = job.result?.videoPath || history?.videoPath || null;
    const videoSource = {
        jobId: job.jobId,
        result: videoPath ? { videoPath } : undefined,
    };
    const topic = job.request?.prompt ?? job.topic ?? history?.topic ?? '(job cũ thiếu thông tin yêu cầu)';
    const durationSec = job.result?.durationSec ?? history?.durationSec ?? null;
    const resolution = job.result?.resolution ?? history?.resolution ?? null;
    return {
        jobId: job.jobId,
        status: job.status,
        topic,
        createdAt: job.createdAt ?? history?.createdAt ?? new Date().toISOString(),
        updatedAt: job.updatedAt ?? history?.updatedAt ?? new Date().toISOString(),
        completedAt: history?.completedAt ?? ((job.status === 'completed' || job.status === 'qa_failed' || job.status === 'failed' || job.status === 'cancelled') ? job.updatedAt : null),
        durationSec: typeof durationSec === 'number' ? durationSec : null,
        resolution,
        qaStatus: job.qaStatus ?? history?.qaStatus ?? null,
        error: job.error ?? history?.error ?? null,
        progress: typeof job.progress?.progress === 'number' ? job.progress.progress : null,
        hasVideo: Boolean(videoPath),
        videoAvailable: isJobVideoAvailable(videoSource, job.jobId),
        canRestore: Boolean(job.request?.prompt || job.script || history?.request?.prompt || history?.script),
        thumbnailUrl: queueThumbnailUrl(job) ?? (history ? historyThumbnailUrl(history) : null),
    };
}

/**
 * Đọc lịch sử + trạng thái live. PostgreSQL cung cấp nền lâu dài; queue chỉ
 * được dùng để phủ trạng thái mới nhất lên các dòng đã có.
 */
export async function listJobsForUser(
    queue: IVideoQueue,
    user: JobOwner,
    query: JobListQuery = {}
): Promise<JobListResult | { error: string }> {
    const { statuses, error } = parseStatusFilter(query.status);
    if (error) return { error };

    const sort = parseSort(query.sort);
    const rawPageSize = parseIntValue(query.pageSize) ?? parseIntValue(query.limit);
    const paginated = query.page !== undefined || rawPageSize !== undefined || query.format === 'page';
    const page = Math.max(1, parseIntValue(query.page) ?? 1);
    const pageSize = Math.min(50, Math.max(1, rawPageSize ?? 12));
    const q = typeof query.q === 'string' ? query.q.trim().slice(0, 200) : undefined;

    const historyPage = await listVideoHistory({
        userId: user.role === 'admin' ? undefined : user.id,
        statuses,
        q,
        sort,
        page: paginated ? page : undefined,
        pageSize: paginated ? pageSize : undefined,
    });

    const allQueueJobs = (await queue.getJobs()).filter((job) => canReadJob(user, job));
    const queueById = new Map(allQueueJobs.map((job) => [job.jobId, job]));

    let items = historyPage.items.map((record) =>
        summarizeJob(queueById.get(record.jobId) ?? historyToJobRecord(record), record)
    );

    if (!paginated) {
        // Tương thích API cũ: trả TẤT CẢ, gồm cả job chỉ còn trong queue (job cũ
        // chưa có dòng video_history) nhưng vẫn thoả bộ lọc và quyền sở hữu.
        const known = new Set(historyPage.items.map((record) => record.jobId));
        for (const job of allQueueJobs) {
            if (known.has(job.jobId)) continue;
            if (!matchesQueueFilter(job, statuses, q)) continue;
            items.push(summarizeJob(job, undefined));
        }
        items.sort((a, b) => {
            if (sort === 'name-asc' || sort === 'name-desc') {
                const cmp = a.topic.localeCompare(b.topic, 'vi');
                return sort === 'name-desc' ? -cmp : cmp;
            }
            const at = Date.parse(a.createdAt);
            const bt = Date.parse(b.createdAt);
            return sort === 'oldest' ? at - bt : bt - at;
        });
    }

    const total = paginated ? historyPage.total : items.length;
    return {
        items,
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
        paginated,
    };
}

export interface ReadableJob {
    job: JobRecord;
    history: VideoHistoryRecord | null;
}

/**
 * Tìm job người dùng được phép đọc. Job còn trong queue là nguồn trạng thái
 * chính; nếu queue đã prune thì rơi về lịch sử PostgreSQL.
 *
 * Nếu queue có job nhưng không thuộc user, trả null ngay — không thử lịch sử
 * để tránh mọi đường vòng ghi đè ownership.
 */
export async function findReadableJob(
    queue: IVideoQueue,
    jobId: string,
    user: JobOwner
): Promise<ReadableJob | null> {
    const queued = await queue.getJob(jobId);
    if (queued) {
        if (!canReadJob(user, queued)) return null;
        const history = await getVideoHistory(jobId);
        return { job: queued, history };
    }
    const history = await getVideoHistory(jobId);
    if (!history || !canReadJob(user, history)) return null;
    return { job: historyToJobRecord(history), history };
}

function previewPayload(job: JobRecord): unknown {
    const preview = job.result?.preview;
    if (!preview) return undefined;
    const previews = Array.isArray(preview.previews) ? preview.previews : [];
    return {
        totalScenes: preview.totalScenes,
        durationSec: preview.durationSec,
        previews: previews.map((item) => ({
            sceneId: item.sceneId,
            index: item.sceneIndex,
            title: item.title,
            timeSec: item.timeSec,
            url: `/api/jobs/${encodeURIComponent(job.jobId)}/preview/${encodeURIComponent(item.sceneId)}`,
        })),
    };
}

/**
 * Request có thể chứa `watermark.logoPath` — đường dẫn tệp logo phía máy chủ do
 * client gửi lên. Client không cần lại đường dẫn này để phát/khôi phục video,
 * nên bỏ trước khi serialize để không rò filesystem path qua API chi tiết.
 */
function requestForClient(request: JobRecord['request'] | undefined): unknown {
    if (!request) return undefined;
    const watermark = (request as any).watermark;
    if (!watermark || typeof watermark !== 'object') return request;
    const { logoPath, ...safeWatermark } = watermark;
    return { ...request, watermark: safeWatermark };
}

/**
 * Chi tiết job cho chủ sở hữu/admin. Chỉ trả URL và metadata — không bao giờ
 * trả `workDir`, `videoPath`, `imagePath` hay bất kỳ đường dẫn filesystem nào.
 */
export function serializeJobDetail(job: JobRecord, history?: VideoHistoryRecord | null): Record<string, unknown> {
    const result = job.result;
    const script = job.script ?? history?.script;
    const request = job.request ?? history?.request;
    const scenes = result?.scences ?? script?.scenes ?? [];
    const videoPath = result?.videoPath || history?.videoPath || null;
    const videoAvailable = isJobVideoAvailable(
        { jobId: job.jobId, result: videoPath ? { videoPath } : undefined },
        job.jobId
    );
    const durationSec = result?.durationSec ?? history?.durationSec ?? null;
    const resolution = result?.resolution ?? history?.resolution ?? null;
    return {
        jobId: job.jobId,
        status: job.status,
        topic: request?.prompt ?? job.topic ?? history?.topic ?? '',
        createdAt: job.createdAt ?? history?.createdAt,
        updatedAt: job.updatedAt ?? history?.updatedAt,
        completedAt: history?.completedAt
            ?? (['completed', 'failed', 'qa_failed', 'cancelled'].includes(job.status) ? job.updatedAt : null),
        progress: job.progress,
        error: job.error ?? history?.error ?? null,
        qaStatus: job.qaStatus ?? result?.qaStatus ?? history?.qaStatus ?? null,
        qaReport: job.qaReport ?? result?.qaReport,
        request: requestForClient(request),
        script,
        canRestore: Boolean(request?.prompt || script),        result: (result || history) ? {
            durationSec,
            resolution,
            scenes,
            timing: result?.timing,
            hasVideo: Boolean(videoPath),
            videoAvailable,
            htmlUrl: `/api/jobs/${job.jobId}/html`,
            audioUrl: `/api/jobs/${job.jobId}/audio`,
            previews: previewPayload(job),
        } : undefined,
    };
}

/** Đường dẫn video thực tế cho route stream/download (đã gồm fallback tmp/job-<id>). */
export function jobVideoPath(job: JobRecord, jobId: string): string {
    return resolveJobVideoPath(job, jobId);
}

/** Tiện ích cho route video: job này có tệp MP4 thật trên máy chủ không. */
export function jobVideoAvailable(job: JobRecord, jobId: string, history?: VideoHistoryRecord | null): boolean {
    if (history && !job.result?.videoPath) {
        return isHistoryVideoAvailable(history);
    }
    return isJobVideoAvailable(job, jobId);
}
