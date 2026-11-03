import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, existsSync, rmSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { cleanStaleJobWorkdirs } from '../../src/queue/tmpCleaner.js';

describe('Worker Lifecycle & Tmp Workdir Cleanup (#131)', () => {
    it('cleanStaleJobWorkdirs xoá thư mục tmp/job-* cũ quá 24h và giữ lại thư mục mới', () => {
        const testTmpDir = join(process.cwd(), 'tmp', 'test-cleaner-dir');
        mkdirSync(testTmpDir, { recursive: true });

        const staleJobDir = join(testTmpDir, 'job-stale-123');
        const freshJobDir = join(testTmpDir, 'job-fresh-456');
        const nonJobDir = join(testTmpDir, 'other-dir');

        mkdirSync(staleJobDir, { recursive: true });
        mkdirSync(freshJobDir, { recursive: true });
        mkdirSync(nonJobDir, { recursive: true });

        writeFileSync(join(staleJobDir, 'index.html'), 'old');
        writeFileSync(join(freshJobDir, 'index.html'), 'new');

        // Giả lập mtime cho thư mục cũ: 25 giờ trước
        const twentyFiveHoursAgo = (Date.now() - 25 * 60 * 60 * 1000) / 1000;
        utimesSync(staleJobDir, twentyFiveHoursAgo, twentyFiveHoursAgo);

        const result = cleanStaleJobWorkdirs({ tmpDir: testTmpDir, maxAgeHours: 24 });

        assert.strictEqual(result.deletedCount, 1);
        assert.strictEqual(existsSync(staleJobDir), false);
        assert.strictEqual(existsSync(freshJobDir), true);
        assert.strictEqual(existsSync(nonJobDir), true);

        // Dọn dẹp sau test
        rmSync(testTmpDir, { recursive: true, force: true });
    });
});
