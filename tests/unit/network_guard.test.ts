import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { decideRequestAllowed } from '../../src/pipeline/networkGuard.js';

// Test cho quyết định chặn/cho phép request của NetworkGuard (issue #133).
// decideRequestAllowed là hàm thuần nên test không cần trình duyệt thật.
// Các đường dẫn file:// được dựng theo process.cwd() giống hệt cách guard
// tính thư mục gốc mặc định khi chạy thật.
const cwd = process.cwd();
const jobDir = join(cwd, 'tmp', 'job-cua-toi');
const fileUrl = (p: string) => pathToFileURL(p).href;

describe('Module: NetworkGuard (src/pipeline/networkGuard.ts)', () => {
    describe('TC-NG-001: Phạm vi đọc file:// sau khi thu hẹp (issue #133)', () => {
        it('phải cho phép file nằm trong thư mục job được truyền qua fileRoots', () => {
            const d = decideRequestAllowed(fileUrl(join(jobDir, 'scene.html')), 'document', { fileRoots: [jobDir] });
            assert.strictEqual(d.allowed, true);
        });

        it('phải chặn file thuộc job của tenant khác trong cùng cây tmp', () => {
            const d = decideRequestAllowed(fileUrl(join(cwd, 'tmp', 'job-cua-nguoi-khac', 'script.json')), 'fetch', { fileRoots: [jobDir] });
            assert.strictEqual(d.allowed, false);
            assert.strictEqual(d.reason, 'file-outside-allowed-roots');
        });

        it('phải chặn file log token tmp/usage.jsonl', () => {
            const d = decideRequestAllowed(fileUrl(join(cwd, 'tmp', 'usage.jsonl')), 'fetch', { fileRoots: [jobDir] });
            assert.strictEqual(d.allowed, false);
        });

        it('phải chặn .env và /etc/passwd', () => {
            assert.strictEqual(decideRequestAllowed(fileUrl(join(cwd, '.env')), 'fetch', { fileRoots: [jobDir] }).allowed, false);
            assert.strictEqual(decideRequestAllowed('file:///etc/passwd', 'fetch', { fileRoots: [jobDir] }).allowed, false);
        });

        it('phải cho phép thư viện tư liệu dùng chung assets/ của app', () => {
            const d = decideRequestAllowed(fileUrl(join(cwd, 'assets', 'fonts', 'font.woff2')), 'font', { fileRoots: [jobDir] });
            assert.strictEqual(d.allowed, true);
        });

        it('không truyền fileRoots thì thư mục tmp vẫn bị chặn (mặc định đã thu hẹp)', () => {
            const d = decideRequestAllowed(fileUrl(join(cwd, 'tmp', 'job-bat-ky', 'a.png')), 'image');
            assert.strictEqual(d.allowed, false);
        });
    });

    describe('TC-NG-002: Các quy tắc mạng sẵn có phải giữ nguyên', () => {
        it('phải chặn https tới địa chỉ metadata 169.254.169.254', () => {
            const d = decideRequestAllowed('https://169.254.169.254/latest/meta-data', 'image');
            assert.strictEqual(d.allowed, false);
            assert.strictEqual(d.reason, 'private-or-local-host');
        });

        it('phải chặn http thuần', () => {
            assert.strictEqual(decideRequestAllowed('http://example.com/a.png', 'image').allowed, false);
        });

        it('phải cho phép tài nguyên tĩnh https từ host công khai', () => {
            assert.strictEqual(decideRequestAllowed('https://upload.wikimedia.org/a.png', 'image').allowed, true);
        });

        it('phải chặn fetch tới host không nằm trong danh sách CDN cho phép', () => {
            assert.strictEqual(decideRequestAllowed('https://evil.example.com/x', 'fetch').allowed, false);
        });
    });
});
