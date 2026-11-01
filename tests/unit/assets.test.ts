import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join, basename } from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import {
    validateUploadedAsset,
    generateSafeAssetFilePath,
    resolveAssetPath,
    ASSETS_DIR,
    ALLOWED_ASSET_MIME_TYPES,
    ALLOWED_VIDEO_MIME_TYPES,
    MAX_IMAGE_ASSET_BYTES,
    MAX_VIDEO_ASSET_BYTES,
} from '../../src/security/uploadGuard.js';

// ============================================================
// UNIT TEST MODULE: THƯ VIỆN ASSET (#103) — src/security/uploadGuard.ts
// Mục tiêu: Đảm bảo tầng bảo mật cho asset (ảnh + video) chặn đúng file
//           độc hại, phân loại đúng image/video, và giam đường dẫn trong
//           ASSETS_DIR (chống path traversal / LFI).
// ============================================================

// ─── Buffer giả lập ──────────────────────────────────────────

function makePng(): Buffer {
    return Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, ...Buffer.alloc(64)]);
}

function makeSvg(content: string): Buffer {
    return Buffer.from(content, 'utf-8');
}

function makeMp4(): Buffer {
    // ISO BMFF: 4 byte size + "ftyp" + brand. Chỉ cần byte 4-7 = ftyp.
    const buf = Buffer.alloc(16);
    buf.write('ftyp', 4, 'ascii');
    return buf;
}

function makeWebm(): Buffer {
    // EBML: 1A 45 DF A3
    return Buffer.from([0x1A, 0x45, 0xDF, 0xA3, ...Buffer.alloc(32)]);
}

describe('Module: thư viện asset (#103) — validateUploadedAsset / path resolution', () => {
    describe('validateUploadedAsset — ảnh', () => {
        it('chấp nhận PNG hợp lệ', () => {
            const r = validateUploadedAsset(makePng(), 'image/png');
            assert.equal(r.isValid, true);
        });

        it('chấp nhận SVG và sanitize XSS', () => {
            const r = validateUploadedAsset(makeSvg('<svg><script>alert(1)</script><circle r="10"/></svg>'), 'image/svg+xml');
            assert.equal(r.isValid, true);
            assert.ok(r.sanitizedContent);
            assert.ok(!r.sanitizedContent!.includes('<script'));
            assert.ok(r.sanitizedContent!.includes('<circle'));
        });

        it('từ chối ảnh vượt quá 10MB', () => {
            const big = Buffer.concat([makePng(), Buffer.alloc(MAX_IMAGE_ASSET_BYTES)]);
            const r = validateUploadedAsset(big, 'image/png');
            assert.equal(r.isValid, false);
            assert.ok(r.reason!.includes('10MB'));
        });

        it('từ chối ảnh giả mạo (mime png nhưng nội dung không phải png)', () => {
            const r = validateUploadedAsset(Buffer.from('not a png at all'), 'image/png');
            assert.equal(r.isValid, false);
        });
    });

    describe('validateUploadedAsset — video', () => {
        it('chấp nhận MP4 hợp lệ (ftyp)', () => {
            const r = validateUploadedAsset(makeMp4(), 'video/mp4');
            assert.equal(r.isValid, true);
        });

        it('chấp nhận WEBM hợp lệ (EBML)', () => {
            const r = validateUploadedAsset(makeWebm(), 'video/webm');
            assert.equal(r.isValid, true);
        });

        it('từ chối video giả mạo (mime mp4 nhưng không có ftyp)', () => {
            const r = validateUploadedAsset(Buffer.from('random bytes'), 'video/mp4');
            assert.equal(r.isValid, false);
        });

        it('từ chối video vượt quá 200MB', () => {
            const big = Buffer.concat([makeMp4(), Buffer.alloc(MAX_VIDEO_ASSET_BYTES)]);
            const r = validateUploadedAsset(big, 'video/mp4');
            assert.equal(r.isValid, false);
            assert.ok(r.reason!.includes('200MB'));
        });

        it('từ chối MIME ngoài danh sách (application/octet-stream)', () => {
            const r = validateUploadedAsset(makeMp4(), 'application/octet-stream');
            assert.equal(r.isValid, false);
        });
    });

    describe('generateSafeAssetFilePath', () => {
        it('ánh xạ đúng phần mở rộng cho ảnh và video', () => {
            assert.ok(generateSafeAssetFilePath('image/png').endsWith('.png'));
            assert.ok(generateSafeAssetFilePath('image/jpeg').endsWith('.jpg'));
            assert.ok(generateSafeAssetFilePath('image/webp').endsWith('.webp'));
            assert.ok(generateSafeAssetFilePath('image/svg+xml').endsWith('.svg'));
            assert.ok(generateSafeAssetFilePath('video/mp4').endsWith('.mp4'));
            assert.ok(generateSafeAssetFilePath('video/webm').endsWith('.webm'));
        });
    });

    describe('resolveAssetPath — chống path traversal / LFI', () => {
        it('chấp nhận URL /uploads/assets/<name> hợp lệ', () => {
            const tmp = join(ASSETS_DIR, 'a1b2c3d4.png');
            mkdirSync(ASSETS_DIR, { recursive: true });
            writeFileSync(tmp, makePng());
            try {
                const resolved = resolveAssetPath('/uploads/assets/a1b2c3d4.png');
                assert.ok(resolved);
                assert.equal(basename(resolved!), 'a1b2c3d4.png');
            } finally {
                rmSync(tmp, { force: true });
            }
        });

        it('từ chối tên file chứa ../ (path traversal)', () => {
            assert.equal(resolveAssetPath('/uploads/assets/../../etc/passwd'), null);
        });

        it('từ chối đường dẫn tuyệt đối ngoài ASSETS_DIR', () => {
            assert.equal(resolveAssetPath('/etc/passwd'), null);
        });

        it('từ chối đuôi file không cho phép (.sh)', () => {
            assert.equal(resolveAssetPath('/uploads/assets/evil.sh'), null);
        });
    });

    describe('hằng số danh sách cho phép', () => {
        it('bao gồm đủ 4 ảnh + 2 video', () => {
            assert.deepEqual(ALLOWED_VIDEO_MIME_TYPES, ['video/mp4', 'video/webm']);
            assert.equal(ALLOWED_ASSET_MIME_TYPES.length, 6);
        });
    });
});
