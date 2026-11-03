import { existsSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Quét thư mục tmp/ và xoá các thư mục scratch job (job-*, cli-job-*) có mtime quá maxAgeHours (mặc định 24h).
 * Ngăn ngừa cạn kiệt dung lượng đĩa cứng máy chủ (Issue #131).
 */
export function cleanStaleJobWorkdirs(options: { tmpDir?: string; maxAgeHours?: number } = {}): { deletedCount: number; errors: string[] } {
    const tmpDir = options.tmpDir ?? join(process.cwd(), 'tmp');
    const maxAgeHours = options.maxAgeHours ?? 24;
    const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
    const now = Date.now();

    let deletedCount = 0;
    const errors: string[] = [];

    if (!existsSync(tmpDir)) {
        return { deletedCount: 0, errors: [] };
    }

    try {
        const entries = readdirSync(tmpDir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory() && (entry.name.startsWith('job-') || entry.name.startsWith('cli-job-'))) {
                const fullPath = join(tmpDir, entry.name);
                try {
                    const stats = statSync(fullPath);
                    if (now - stats.mtimeMs > maxAgeMs) {
                        rmSync(fullPath, { recursive: true, force: true });
                        deletedCount++;
                    }
                } catch (err: any) {
                    errors.push(`Failed to remove ${entry.name}: ${err.message}`);
                }
            }
        }
    } catch (err: any) {
        errors.push(`Failed to read tmp directory: ${err.message}`);
    }

    return { deletedCount, errors };
}
