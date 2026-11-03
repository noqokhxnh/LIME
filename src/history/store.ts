import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { getConfig } from '../config.js';
import { db } from '../database/index.js';
import { jobWorkDirs, safeJobDir } from '../queue/jobPaths.js';
import { resolveJobVideoPath } from '../queue/jobVideo.js';
import type { JobRecord } from '../queue/interfaces.js';
import type { videoRequest, videoScript } from '../llm/schema.js';

/**
 * Kho lịch sử video ("Video của tôi").
 *
 * Vì sao cần một lớp riêng thay vì đọc thẳng hàng đợi:
 *  - BullMQ/Redis là trạng thái tạm (job bị prune, Redis mất dữ liệu, worker
 *    restart). Lịch sử người dùng phải sống lâu hơn vòng đời job.
 *  - PostgreSQL là nguồn sự thật lâu dài. Khi chưa cấu hình DATABASE_URL (test,
 *    dev in-memory), lớp này giữ một Map tạm để tính năng vẫn chạy được và để
 *    test không phải dựng PostgreSQL.
 *  - Mọi truy vấn theo người dùng đều lọc `user_id`; không bao giờ trả job của
 *    tài khoản khác. Admin xem toàn bộ là quyết định ở tầng route (RBAC).
 */

export type VideoHistoryStatus = JobRecord['status'];

export interface VideoHistoryRecord {
    jobId: string;
    userId: string | null;
    topic: string;
    status: VideoHistoryStatus;
    request?: videoRequest;
    script?: videoScript;
    durationSec: number | null;
    resolution: string | null;
    qaStatus: string | null;
    error: string | null;
    videoPath: string | null;
    previewSceneId: string | null;
    createdAt: string;
    updatedAt: string;
    completedAt: string | null;
}

export type VideoHistorySort = 'newest' | 'oldest' | 'name-asc' | 'name-desc';

export interface VideoHistoryListParams {
    /** Lọc theo chủ sở hữu. `undefined` = admin xem tất cả. */
    userId?: string;
    /** Các trạng thái cần lấy; rỗng/undefined = tất cả. */
    statuses?: string[];
    /** Tìm chuỗi con trong topic hoặc jobId (không phân biệt hoa/thường). */
    q?: string;
    sort?: VideoHistorySort;
    /** Có `pageSize` thì phân trang; không có thì trả toàn bộ (tương thích API cũ). */
    page?: number;
    pageSize?: number;
}

export interface VideoHistoryListResult {
    items: VideoHistoryRecord[];
    total: number;
}

const memoryHistory = new Map<string, VideoHistoryRecord>();
let warnedDbFailure = false;

function dbEnabled(): boolean {
    return Boolean(getConfig().DATABASE_URL);
}

function logDbFailure(operation: string, err: unknown): void {
    if (warnedDbFailure) return;
    warnedDbFailure = true;
    console.warn(
        `[VideoHistory] Không dùng được PostgreSQL cho ${operation}; ` +
        `tạm dùng bộ nhớ. Lỗi: ${(err as Error)?.message || err}`
    );
}

function iso(value: unknown): string | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function toRecord(row: any): VideoHistoryRecord {
    return {
        jobId: String(row.job_id),
        userId: row.user_id ? String(row.user_id) : null,
        topic: String(row.topic ?? ''),
        status: (row.status || 'queued') as VideoHistoryStatus,
        request: row.request ?? undefined,
        script: row.script ?? undefined,
        durationSec: row.duration_sec == null ? null : Number(row.duration_sec),
        resolution: row.resolution ?? null,
        qaStatus: row.qa_status ?? null,
        error: row.error ?? null,
        videoPath: row.video_path ?? null,
        previewSceneId: row.preview_scene_id ?? null,
        createdAt: iso(row.created_at) ?? new Date().toISOString(),
        updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
        completedAt: iso(row.completed_at),
    };
}

function sortValue(record: VideoHistoryRecord, sort: VideoHistorySort = 'newest'): string | number {
    if (sort === 'name-asc' || sort === 'name-desc') return record.topic.toLocaleLowerCase('vi');
    const t = Date.parse(record.createdAt);
    return Number.isFinite(t) ? t : 0;
}

function filterInMemory(params: VideoHistoryListParams): VideoHistoryRecord[] {
    const q = String(params.q ?? '').trim().toLocaleLowerCase('vi');
    const statuses = params.statuses?.length ? new Set(params.statuses) : null;
    return [...memoryHistory.values()].filter((record) => {
        if (params.userId && record.userId !== params.userId) return false;
        if (statuses && !statuses.has(record.status)) return false;
        if (q) {
            const haystack = `${record.topic} ${record.jobId}`.toLocaleLowerCase('vi');
            if (!haystack.includes(q)) return false;
        }
        return true;
    });
}

function sortInMemory(records: VideoHistoryRecord[], sort: VideoHistorySort = 'newest'): VideoHistoryRecord[] {
    const sorted = [...records].sort((a, b) => {
        const av = sortValue(a, sort);
        const bv = sortValue(b, sort);
        if (typeof av === 'number' && typeof bv === 'number') {
            return sort === 'oldest' ? av - bv : bv - av;
        }
        const cmp = String(av).localeCompare(String(bv), 'vi');
        return sort === 'name-desc' ? -cmp : cmp;
    });
    return sorted;
}

function listMemory(params: VideoHistoryListParams): VideoHistoryListResult {
    const filtered = sortInMemory(filterInMemory(params), params.sort);
    const total = filtered.length;
    if (!params.pageSize) return { items: filtered, total };
    const page = Math.max(1, Math.floor(params.page || 1));
    const start = (page - 1) * params.pageSize;
    return { items: filtered.slice(start, start + params.pageSize), total };
}

function orderBySql(sort: VideoHistorySort = 'newest'): string {
    switch (sort) {
        case 'oldest':
            return 'created_at ASC';
        case 'name-asc':
            return 'LOWER(topic) ASC, created_at DESC';
        case 'name-desc':
            return 'LOWER(topic) DESC, created_at DESC';
        case 'newest':
        default:
            return 'created_at DESC';
    }
}

/** Tạo điều kiện WHERE dùng chung cho câu SELECT và COUNT. */
function buildListWhere(params: VideoHistoryListParams): { sql: string; values: unknown[] } {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (params.userId) {
        values.push(params.userId);
        conditions.push(`user_id = $${values.length}`);
    }
    if (params.statuses?.length) {
        values.push(params.statuses);
        conditions.push(`status = ANY($${values.length}::text[])`);
    }
    const q = String(params.q ?? '').trim();
    if (q) {
        values.push(`%${q}%`);
        conditions.push(`(topic ILIKE $${values.length} OR job_id ILIKE $${values.length})`);
    }
    return { sql: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', values };
}

/**
 * Đọc lịch sử. Khi PostgreSQL lỗi/không cấu hình, tự rơi về Map trong bộ nhớ
 * (đủ cho dev/test; production có DATABASE_URL sẽ dùng DB).
 */
export async function listVideoHistory(params: VideoHistoryListParams = {}): Promise<VideoHistoryListResult> {
    if (!dbEnabled()) return listMemory(params);
    const pageSize = params.pageSize;
    const page = Math.max(1, Math.floor(params.page || 1));
    const { sql: where, values } = buildListWhere(params);
    try {
        const countRes = await db.query(`SELECT COUNT(*)::int AS total FROM video_history ${where}`, values);
        const total = Number(countRes.rows[0]?.total ?? 0);
        let selectSql = `SELECT * FROM video_history ${where} ORDER BY ${orderBySql(params.sort)}`;
        const selectValues = [...values];
        if (pageSize) {
            selectValues.push(pageSize, (page - 1) * pageSize);
            selectSql += ` LIMIT $${selectValues.length - 1} OFFSET $${selectValues.length}`;
        }
        const rows = await db.query(selectSql, selectValues);
        return { items: rows.rows.map(toRecord), total };
    } catch (err) {
        logDbFailure('listVideoHistory', err);
        // PostgreSQL lỗi giữa chừng: vẫn trả được những bản ghi đã ghi vào Map.
        return listMemory(params);
    }
}

export async function getVideoHistory(jobId: string): Promise<VideoHistoryRecord | null> {
    if (dbEnabled()) {
        try {
            const res = await db.query('SELECT * FROM video_history WHERE job_id = $1 LIMIT 1', [jobId]);
            if (res.rows[0]) return toRecord(res.rows[0]);
        } catch (err) {
            logDbFailure('getVideoHistory', err);
        }
    }
    return memoryHistory.get(jobId) ?? null;
}

/** Ghi nhận job vừa được chấp nhận. Idempotent theo jobId. */
export async function recordVideoQueued(input: {
    jobId: string;
    userId?: string | null;
    topic?: string;
    request?: videoRequest;
}): Promise<void> {
    const now = new Date().toISOString();
    const topic = String(input.topic ?? '').slice(0, 2000);
    const previous = memoryHistory.get(input.jobId);
    const record: VideoHistoryRecord = {
        jobId: input.jobId,
        userId: input.userId ?? previous?.userId ?? null,
        topic: topic || previous?.topic || '',
        status: previous?.status ?? 'queued',
        request: input.request ?? previous?.request,
        script: previous?.script,
        durationSec: previous?.durationSec ?? null,
        resolution: previous?.resolution ?? null,
        qaStatus: previous?.qaStatus ?? null,
        error: previous?.error ?? null,
        videoPath: previous?.videoPath ?? null,
        previewSceneId: previous?.previewSceneId ?? null,
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
        completedAt: previous?.completedAt ?? null,
    };
    memoryHistory.set(input.jobId, record);
    if (!dbEnabled()) return;
    try {
        await db.query(
            `INSERT INTO video_history (job_id, user_id, topic, status, request, created_at, updated_at)
             VALUES ($1, $2, $3, 'queued', $4, NOW(), NOW())
             ON CONFLICT (job_id) DO UPDATE SET
                user_id = COALESCE(video_history.user_id, EXCLUDED.user_id),
                topic = CASE WHEN EXCLUDED.topic <> '' THEN EXCLUDED.topic ELSE video_history.topic END,
                request = COALESCE(EXCLUDED.request, video_history.request),
                updated_at = NOW()`,
            [input.jobId, input.userId ?? null, topic, input.request ?? null]
        );
    } catch (err) {
        logDbFailure('recordVideoQueued', err);
    }
}

async function updateHistory(
    jobId: string,
    fields: {
        status?: VideoHistoryStatus;
        error?: string | null;
        durationSec?: number | null;
        resolution?: string | null;
        qaStatus?: string | null;
        videoPath?: string | null;
        previewSceneId?: string | null;
        script?: videoScript;
        completed?: boolean;
    }
): Promise<void> {
    const now = new Date().toISOString();
    const previous = memoryHistory.get(jobId);
    if (previous || !dbEnabled()) {
        const base: VideoHistoryRecord = previous ?? {
            jobId,
            userId: null,
            topic: '',
            status: 'queued',
            durationSec: null,
            resolution: null,
            qaStatus: null,
            error: null,
            videoPath: null,
            previewSceneId: null,
            createdAt: now,
            updatedAt: now,
            completedAt: null,
        };
        memoryHistory.set(jobId, {
            ...base,
            status: fields.status ?? base.status,
            error: fields.error !== undefined ? fields.error : base.error,
            durationSec: fields.durationSec !== undefined ? fields.durationSec : base.durationSec,
            resolution: fields.resolution !== undefined ? fields.resolution : base.resolution,
            qaStatus: fields.qaStatus !== undefined ? fields.qaStatus : base.qaStatus,
            videoPath: fields.videoPath !== undefined ? fields.videoPath : base.videoPath,
            previewSceneId: fields.previewSceneId !== undefined ? fields.previewSceneId : base.previewSceneId,
            script: fields.script ?? base.script,
            updatedAt: now,
            completedAt: fields.completed ? now : base.completedAt,
        });
    }
    if (!dbEnabled()) return;
    try {
        await db.query(
            `UPDATE video_history SET
                status = COALESCE($2, status),
                error = $3,
                duration_sec = COALESCE($4, duration_sec),
                resolution = COALESCE($5, resolution),
                qa_status = COALESCE($6, qa_status),
                video_path = COALESCE($7, video_path),
                preview_scene_id = COALESCE($8, preview_scene_id),
                script = COALESCE($9, script),
                updated_at = NOW(),
                completed_at = CASE WHEN $10 THEN NOW() ELSE completed_at END
             WHERE job_id = $1`,
            [
                jobId,
                fields.status ?? null,
                fields.error !== undefined ? fields.error : null,
                fields.durationSec ?? null,
                fields.resolution ?? null,
                fields.qaStatus ?? null,
                fields.videoPath ?? null,
                fields.previewSceneId ?? null,
                fields.script ?? null,
                Boolean(fields.completed),
            ]
        );
    } catch (err) {
        logDbFailure('updateHistory', err);
    }
}

export async function recordVideoStarted(jobId: string): Promise<void> {
    await updateHistory(jobId, { status: 'running', error: null });
}

export async function recordVideoCompleted(
    jobId: string,
    result: {
        durationSec?: number;
        resolution?: string;
        qaStatus?: string;
        videoPath?: string;
        scences?: Array<{ id?: string }>;
        preview?: { previews?: Array<{ sceneId?: string }> };
    } | null | undefined,
    script?: videoScript
): Promise<void> {
    const qaStatus = result?.qaStatus ?? null;
    const previewSceneId =
        result?.preview?.previews?.[0]?.sceneId ||
        result?.scences?.[0]?.id ||
        script?.scenes?.[0]?.id ||
        null;
    await updateHistory(jobId, {
        status: qaStatus === 'fail' ? 'qa_failed' : 'completed',
        error: null,
        durationSec: typeof result?.durationSec === 'number' ? result.durationSec : null,
        resolution: result?.resolution ?? null,
        qaStatus,
        videoPath: result?.videoPath || null,
        previewSceneId,
        script,
        completed: true,
    });
}

export async function recordVideoFailed(jobId: string, error: string): Promise<void> {
    await updateHistory(jobId, {
        status: 'failed',
        error: String(error || 'Lỗi không xác định').slice(0, 4000),
        completed: true,
    });
}

export async function recordVideoCancelled(jobId: string, reason = 'Đã hủy'): Promise<void> {
    await updateHistory(jobId, {
        status: 'cancelled',
        error: reason,
        completed: true,
    });
}

/** Xoá một bản ghi lịch sử. Trả về true nếu có bản ghi bị xoá. */
export async function deleteVideoHistory(jobId: string): Promise<boolean> {
    const hadMemory = memoryHistory.delete(jobId);
    if (!dbEnabled()) return hadMemory;
    try {
        const res = await db.query('DELETE FROM video_history WHERE job_id = $1', [jobId]);
        return hadMemory || Boolean(res.rowCount);
    } catch (err) {
        logDbFailure('deleteVideoHistory', err);
        return hadMemory;
    }
}

/** Chuyển bản ghi lịch sử thành dạng JobRecord để dùng lại các route hiện có. */
export function historyToJobRecord(record: VideoHistoryRecord): JobRecord {
    const scenes = record.script?.scenes ?? [];
    const hasResult = Boolean(
        record.videoPath || record.durationSec != null || record.resolution || record.qaStatus
    );
    return {
        jobId: record.jobId,
        userId: record.userId ?? undefined,
        status: record.status,
        request: record.request,
        script: record.script,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        qaStatus: (record.qaStatus ?? undefined) as JobRecord['qaStatus'],
        error: record.error ?? undefined,
        topic: record.topic,
        result: hasResult ? {
            jobId: record.jobId,
            durationSec: record.durationSec ?? 0,
            resolution: record.resolution ?? '',
            scences: scenes,
            videoPath: record.videoPath ?? '',
        } as any : undefined,
    };
}

/** Tệp MP4 của bản ghi lịch sử còn trên máy chủ này không. */
export function isHistoryVideoAvailable(record: VideoHistoryRecord): boolean {
    try {
        return existsSync(resolveJobVideoPath(
            { jobId: record.jobId, result: { videoPath: record.videoPath ?? undefined } },
            record.jobId
        ));
    } catch {
        return false;
    }
}

/** URL thumbnail nếu tệp preview còn tồn tại; null thì UI dùng fallback. */
export function historyThumbnailUrl(record: VideoHistoryRecord): string | null {
    const sceneId = record.previewSceneId || record.script?.scenes?.[0]?.id;
    if (!sceneId) return null;
    const dir = safeJobDir(record.jobId);
    if (!dir) return null;
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(sceneId)) return null;
    if (!existsSync(join(dir, 'previews', `${sceneId}.webp`))) return null;
    return `/api/jobs/${encodeURIComponent(record.jobId)}/preview/${encodeURIComponent(sceneId)}`;
}

/**
 * Dọn job đã kết thúc quá hạn retention (mặc định tắt: VIDEO_RETENTION_DAYS=0).
 * Chỉ xoá thư mục qua jobWorkDirs (đã giam trong tmp/), không xoá đường dẫn lạ.
 */
export async function cleanupExpiredVideoHistory(retentionDays = getConfig().VIDEO_RETENTION_DAYS): Promise<number> {
    if (!retentionDays || retentionDays <= 0 || !dbEnabled()) return 0;
    let removed = 0;
    try {
        const res = await db.query(
            `SELECT job_id FROM video_history
             WHERE completed_at IS NOT NULL
               AND completed_at < NOW() - ($1::int * INTERVAL '1 day')
             LIMIT 500`,
            [retentionDays]
        );
        for (const row of res.rows) {
            const jobId = String(row.job_id);
            for (const dir of jobWorkDirs(jobId)) {
                if (!existsSync(dir)) continue;
                try { rmSync(dir, { recursive: true, force: true }); } catch { /* bỏ qua */ }
            }
            await deleteVideoHistory(jobId);
            removed++;
        }
    } catch (err) {
        logDbFailure('cleanupExpiredVideoHistory', err);
    }
    return removed;
}

/** Chỉ dùng trong test: xoá Map trong bộ nhớ (không đụng PostgreSQL). */
export function __resetVideoHistoryForTests(): void {
    memoryHistory.clear();
    warnedDbFailure = false;
}
