/**
 * Đường dẫn tệp video của một job, và tệp đó có thật trên máy chủ này không.
 *
 * Vì sao cần dùng chung một chỗ: bản ghi trong hàng đợi chỉ cho biết job *từng*
 * render ra video. Tệp thật có thể đã bị dọn khỏi thư mục tạm, hoặc job được
 * render ở máy khác (worker ở máy khác, chạy thử trên host…). Nếu nơi phục vụ tệp
 * (`/api/jobs/:jobId/video`) và nơi hiển thị nút "Xem video" tự tính đường dẫn
 * theo hai cách khác nhau thì giao diện sẽ hứa một tệp mà route không thể trả về —
 * đúng lỗi "Không tải được tệp video" trước đây.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

/** Job tối thiểu cần cho việc tra cứu (nhận cả `JobRecord` lẫn bản ghi thô của Bull). */
export type JobVideoSource =
    | { jobId?: string; result?: { videoPath?: string; mp4Path?: string } | null }
    | null
    | undefined;

/**
 * Đường dẫn tệp video mà route `/api/jobs/:jobId/video` sẽ phục vụ cho job này.
 *
 * Ưu tiên `result.videoPath` do worker ghi lại; nếu job chưa có (hoặc giá trị
 * rỗng, ví dụ job đang chờ phê duyệt kịch bản) thì dùng đúng vị trí mà
 * orchestrator ghi tệp: `<cwd>/tmp/job-<jobId>/final_video.mp4`.
 */
export function resolveJobVideoPath(job: JobVideoSource, jobId?: string): string {
    const declared = job?.result?.videoPath;
    if (declared) return declared;
    const id = jobId || job?.jobId || "";
    return join(process.cwd(), "tmp", `job-${id}`, "final_video.mp4");
}

/** Tệp video của job có thật trên máy chủ đang chạy hay không. */
export function isJobVideoAvailable(job: JobVideoSource, jobId?: string): boolean {
    try {
        return existsSync(resolveJobVideoPath(job, jobId));
    } catch {
        return false;
    }
}
