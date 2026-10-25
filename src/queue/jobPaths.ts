import { join, resolve, sep } from "node:path";

/**
 * Khuôn jobId an toàn và đường dẫn thư mục job bị giam trong tmp/.
 *
 * jobId do client gửi lên (hoặc nằm trong URL) từng được nội suy thẳng vào
 * đường dẫn `tmp/job-<jobId>` ở nhiều nơi: đọc artifact, resolve video và
 * xoá đệ quy thư mục khi admin xoá job. Một jobId chứa `..` hoặc `/` biến
 * các thao tác đó thành path traversal — tệ nhất là rmSync đệ quy ra ngoài
 * thư mục job. Mọi nơi cần đường dẫn từ jobId phải đi qua module này.
 */

/** Chỉ chữ/số, `-`, `_`; bắt đầu bằng chữ/số; tối đa 80 ký tự (UUID = 36). */
export const JOB_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;

export function isSafeJobId(jobId: unknown): jobId is string {
    return typeof jobId === "string" && JOB_ID_PATTERN.test(jobId);
}

function tmpRoot(): string {
    return resolve(process.cwd(), "tmp");
}

/**
 * Thư mục làm việc của job (`tmp/job-<jobId>`) hoặc null nếu jobId không
 * an toàn / đường dẫn resolve thoát khỏi tmp/.
 */
export function safeJobDir(jobId: string): string | null {
    if (!isSafeJobId(jobId)) return null;
    const root = tmpRoot();
    const dir = resolve(root, `job-${jobId}`);
    return dir.startsWith(root + sep) ? dir : null;
}

/**
 * Mọi thư mục ứng viên của một job để DỌN DẸP: thư mục hiện tại
 * `tmp/job-<jobId>` và thư mục tương thích cũ `tmp/<jobId>`. Trả mảng rỗng
 * khi jobId không an toàn — nơi gọi phải bỏ qua việc xoá file trong
 * trường hợp đó thay vì xoá theo đường dẫn chưa kiểm chứng.
 */
export function jobWorkDirs(jobId: string): string[] {
    if (!isSafeJobId(jobId)) return [];
    const root = tmpRoot();
    return [resolve(root, `job-${jobId}`), resolve(root, jobId)].filter((d) =>
        d.startsWith(root + sep)
    );
}
