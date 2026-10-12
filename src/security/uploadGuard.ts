import { mkdirSync, realpathSync, statSync } from 'node:fs';
import { join, resolve, relative, basename, sep } from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { load } from 'cheerio';

// ============================================================
// MODULE BẢO MẬT UPLOAD LOGO / WATERMARK
// File: src/security/uploadGuard.ts
//
// Mục tiêu: Bảo vệ server khỏi các file độc hại được upload lên
// qua 3 tầng bảo vệ:
//   1. Kiểm tra định dạng file (chỉ chấp nhận PNG, JPEG, SVG, WEBP)
//   2. Kiểm tra magic bytes (chữ ký nhị phân thật của file)
//   3. Sanitize SVG — loại bỏ mã độc XSS và thực thể XML ngoài (XXE)
// ============================================================

/** Danh sách MIME type được phép upload */
export const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];

/** Giới hạn kích thước file tối đa: 5MB */
export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

/**
 * Kiểm tra "magic bytes" — chữ ký nhị phân ở đầu file.
 * Đây là cách đáng tin cậy nhất để xác định định dạng thật của file,
 * vì kẻ tấn công có thể đổi tên file .exe thành .png nhưng không thể
 * giả mạo magic bytes nếu không làm hỏng cấu trúc file.
 *
 * Magic bytes của từng định dạng:
 *   PNG  : 89 50 4E 47 (bắt đầu bằng \x89PNG)
 *   JPEG : FF D8 FF    (3 byte đầu)
 *   WEBP : 52 49 46 46 ... 57 45 42 50 (RIFF...WEBP)
 *   SVG  : là file văn bản XML, không có magic bytes nhị phân cố định
 *
 * @param buffer  Dữ liệu nhị phân của file vừa upload
 * @param mime    MIME type do client khai báo
 * @returns true nếu magic bytes khớp với MIME type
 */
export function validateMagicBytes(buffer: Buffer, mime: string): boolean {
    if (mime === 'image/png') {
        // PNG bắt đầu bằng 8 byte: 89 50 4E 47 0D 0A 1A 0A
        return (
            buffer.length >= 4 &&
            buffer[0] === 0x89 &&
            buffer[1] === 0x50 && // P
            buffer[2] === 0x4E && // N
            buffer[3] === 0x47    // G
        );
    }

    if (mime === 'image/jpeg') {
        // JPEG bắt đầu bằng: FF D8 FF
        return (
            buffer.length >= 3 &&
            buffer[0] === 0xFF &&
            buffer[1] === 0xD8 &&
            buffer[2] === 0xFF
        );
    }

    if (mime === 'image/webp') {
        // WEBP: 4 byte đầu là "RIFF" + 4 byte kích thước + 4 byte tiếp là "WEBP"
        return (
            buffer.length >= 12 &&
            buffer[0] === 0x52 && // R
            buffer[1] === 0x49 && // I
            buffer[2] === 0x46 && // F
            buffer[3] === 0x46 && // F
            buffer[8] === 0x57 && // W
            buffer[9] === 0x45 && // E
            buffer[10] === 0x42 && // B
            buffer[11] === 0x50   // P
        );
    }

    if (mime === 'image/svg+xml') {
        // SVG là file text XML, không có magic bytes nhị phân.
        // Kiểm tra bằng cách xem nội dung có chứa thẻ <svg hoặc <?xml không.
        const text = buffer.slice(0, 512).toString('utf-8').trimStart();
        return text.includes('<svg') || text.includes('<?xml');
    }

    // MIME type không nằm trong danh sách cho phép
    return false;
}

// ─────────────────────────────────────────────────────────────
// SANITIZE SVG THEO DANH SÁCH TRẮNG (WHITELIST) QUA XML PARSER
//
// Thay vì dùng regex (dễ bị lách như `<svg/onload="...">` — regex cũ
// yêu cầu khoảng trắng trước `on` nên không khớp), toàn bộ SVG được
// parse thành cây DOM rồi chỉ giữ lại thẻ/thuộc tính nằm trong danh
// sách trắng:
//   - Mọi event handler `on*` (onload, onclick, onerror, ...) đều bị xóa,
//     kể cả khi không có khoảng trắng đứng trước.
//   - Thẻ <script>, <style>, <foreignObject>, <metadata> bị xóa toàn bộ
//     kèm nội dung bên trong.
//   - Thẻ lạ khác: chỉ bỏ thẻ bọc ngoài, giữ lại nội dung text con.
//   - Chỉ thị XML (<?xml ...?>, <!DOCTYPE ...>, <!ENTITY ...>) bị xóa
//     để chặn tấn công XXE.
//   - Thuộc tính href/xlink:href trỏ tới `javascript:` (hoặc vbscript:)
//     bị xóa; href nội bộ (`#id`) được giữ lại.
// ─────────────────────────────────────────────────────────────

/** Các thẻ SVG được phép giữ lại */
const ALLOWED_SVG_TAGS = new Set([
    'svg', 'g', 'defs', 'desc', 'title', 'symbol', 'use',
    'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
    'text', 'tspan', 'textpath', 'a',
    'lineargradient', 'radialgradient', 'stop',
    'clippath', 'mask', 'pattern', 'image',
]);

/**
 * Các thẻ bị xóa toàn bộ kèm nội dung bên trong:
 * script/style có thể chứa mã độc, foreignObject cho phép nhúng HTML
 * tùy ý, metadata có thể chứa nội dung không kiểm soát.
 */
const STRIP_ENTIRELY_TAGS = new Set(['script', 'style', 'foreignobject', 'metadata']);

/** Thuộc tính SVG được phép (so sánh không phân biệt hoa/thường) */
const ALLOWED_SVG_ATTRS = new Set([
    'id', 'class',
    'xmlns', 'xmlns:xlink',
    'x', 'y', 'width', 'height', 'cx', 'cy', 'r', 'rx', 'ry',
    'x1', 'y1', 'x2', 'y2', 'dx', 'dy', 'd', 'points',
    'viewbox', 'preserveaspectratio',
    'fill', 'fill-opacity', 'fill-rule',
    'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin',
    'stroke-dasharray', 'stroke-dashoffset',
    'opacity', 'transform', 'transform-origin',
    'gradientunits', 'gradienttransform', 'spreadmethod',
    'offset', 'stop-color', 'stop-opacity',
    'clip-path', 'clip-rule', 'mask',
    'patternunits', 'patterncontentunits', 'patterntransform',
    'maskunits', 'maskcontentunits',
    'font-family', 'font-size', 'font-weight', 'font-style',
    'text-anchor', 'dominant-baseline', 'alignment-baseline',
    'letter-spacing', 'word-spacing', 'rotate',
    'textlength', 'lengthadjust',
    'style',
    'href', 'xlink:href',
]);

/** Kiểm tra giá trị thuộc tính style có chứa mẫu CSS nguy hiểm không */
function isDangerousStyleValue(value: string): boolean {
    const v = value.toLowerCase();
    return (
        v.includes('javascript:') ||
        v.includes('vbscript:') ||
        /expression\s*\(/.test(v) ||
        /url\s*\(\s*['"]?(?!#)/.test(v) // url(...) không trỏ tới id nội bộ (#...)
    );
}

/**
 * Làm sạch (sanitize) nội dung SVG để loại bỏ mã độc.
 *
 * Các mối nguy hiểm trong SVG:
 *   - XSS qua thẻ <script>: cho phép chạy JavaScript
 *   - XSS qua event handler: onload="alert(1)", onclick="fetch(...)", ...
 *     kể cả dạng không có khoảng trắng như `<svg/onload="...">`
 *   - XXE (XML External Entity): <!ENTITY xxe SYSTEM "file:///etc/passwd">
 *     cho phép đọc file trên server
 *   - foreignObject: cho phép nhúng HTML tùy ý vào SVG
 *   - href trỏ tới javascript:: thực thi mã khi click
 *
 * @param svgContent  Chuỗi nội dung SVG thô do người dùng upload
 * @returns Chuỗi SVG đã được làm sạch, an toàn để lưu và hiển thị
 */
export function sanitizeSvg(svgContent: string): string {
    const $ = load(svgContent, { xml: true });

    // 1. Xóa toàn bộ chỉ thị XML: <?xml ...?>, <!DOCTYPE ...>, <!ENTITY ...>
    //    để chặn tấn công XXE ngay từ khâu parse.
    $.root().contents().each((_i, el: any) => {
        if (el.type === 'directive') {
            $(el).remove();
        }
    });

    // 2. Duyệt mọi thẻ, chỉ giữ lại thẻ/thuộc tính trong danh sách trắng.
    $('*').each((_i, el: any) => {
        const tag = String(el.tagName || '').toLowerCase();

        // Thẻ nguy hiểm: xóa toàn bộ kèm nội dung bên trong
        if (STRIP_ENTIRELY_TAGS.has(tag)) {
            $(el).remove();
            return;
        }

        // Thẻ lạ: bỏ thẻ bọc ngoài nhưng giữ lại nội dung con
        if (!ALLOWED_SVG_TAGS.has(tag)) {
            $(el).replaceWith($(el).contents());
            return;
        }

        const attribs: Record<string, string> = el.attribs || {};
        for (const name of Object.keys(attribs)) {
            const lower = name.toLowerCase();
            const value = attribs[name] ?? '';

            // Chặn mọi event handler on* (kể cả dạng <svg/onload="...">)
            if (lower.startsWith('on')) {
                $(el).removeAttr(name);
                continue;
            }

            // Thuộc tính không nằm trong danh sách trắng → xóa
            if (!ALLOWED_SVG_ATTRS.has(lower)) {
                $(el).removeAttr(name);
                continue;
            }

            // href/xlink:href: xóa khi trỏ tới javascript:/vbscript:, giữ href nội bộ (#id)
            if (lower === 'href' || lower === 'xlink:href') {
                const v = value.trim().toLowerCase();
                if (v.startsWith('javascript:') || v.startsWith('vbscript:')) {
                    $(el).removeAttr(name);
                }
                continue;
            }

            // style: chỉ xóa khi chứa mẫu CSS nguy hiểm
            if (lower === 'style' && isDangerousStyleValue(value)) {
                $(el).removeAttr(name);
            }
        }
    });

    return $.xml();
}

/**
 * Kết quả trả về sau khi kiểm tra và xác thực file upload.
 */
export interface UploadValidationResult {
    /** true = file hợp lệ, false = file bị từ chối */
    isValid: boolean;
    /** Lý do từ chối (chỉ có khi isValid = false) */
    reason?: string;
    /** Nội dung file đã được làm sạch (chỉ có với SVG và khi isValid = true) */
    sanitizedContent?: string;
}

/**
 * Hàm tổng hợp: kiểm tra toàn bộ tính hợp lệ và bảo mật của file logo.
 *
 * Thứ tự kiểm tra:
 *   1. Kích thước file <= 5MB
 *   2. MIME type nằm trong danh sách trắng
 *   3. Magic bytes khớp với MIME type khai báo
 *   4. Với SVG: sanitize nội dung
 *
 * @param buffer    Dữ liệu nhị phân của file
 * @param mimeType  MIME type do client khai báo
 * @returns Kết quả xác thực
 */
export function validateUploadedFile(buffer: Buffer, mimeType: string): UploadValidationResult {
    // Kiểm tra 1: Kích thước file
    if (buffer.length > MAX_FILE_SIZE_BYTES) {
        return {
            isValid: false,
            reason: `Kích thước file vượt giới hạn tối đa ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB`,
        };
    }

    // Kiểm tra 2: MIME type có trong danh sách cho phép không
    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
        return {
            isValid: false,
            reason: `Định dạng file "${mimeType}" không được hỗ trợ. Chỉ chấp nhận: ${ALLOWED_MIME_TYPES.join(', ')}`,
        };
    }

    // Kiểm tra 3: Magic bytes (chữ ký nhị phân thật của file)
    if (!validateMagicBytes(buffer, mimeType)) {
        return {
            isValid: false,
            reason: 'Nội dung file không khớp với định dạng được khai báo. File có thể bị giả mạo.',
        };
    }

    // Kiểm tra 4 (chỉ với SVG): Sanitize để loại bỏ mã độc
    if (mimeType === 'image/svg+xml') {
        const originalContent = buffer.toString('utf-8');
        const sanitized = sanitizeSvg(originalContent);
        return {
            isValid: true,
            sanitizedContent: sanitized,
        };
    }

    // File hợp lệ (PNG, JPEG, WEBP)
    return { isValid: true };
}

/**
 * Tạo tên file ngẫu nhiên an toàn dựa trên UUID để lưu logo upload.
 * Tránh các lỗ hổng Path Traversal khi người dùng đặt tên file độc hại
 * như "../../etc/passwd" hoặc "../config.ts".
 *
 * @param originalMime  MIME type của file để xác định phần mở rộng
 * @param uploadDir     Thư mục lưu file (mặc định: uploads/logos)
 * @returns Đường dẫn đầy đủ để lưu file
 */
export function generateSafeFilePath(
    originalMime: string,
    uploadDir: string = join(process.cwd(), 'tmp', 'uploads', 'logos')
): string {
    // Ánh xạ MIME type sang phần mở rộng file
    const extMap: Record<string, string> = {
        'image/png': '.png',
        'image/jpeg': '.jpg',
        'image/svg+xml': '.svg',
        'image/webp': '.webp',
    };

    const ext = extMap[originalMime] ?? '.bin';

    // Tạo thư mục nếu chưa tồn tại
    mkdirSync(uploadDir, { recursive: true });

    // Tên file = UUID ngẫu nhiên (không thể đoán, không chứa ký tự nguy hiểm)
    return join(uploadDir, `${uuidv4()}${ext}`);
}

// ─────────────────────────────────────────────────────────────
// GIỚI HẠN PHẠM VI ĐƯỜNG DẪN LOGO (chống LFI / Path Traversal)
//
// Client chỉ được tham chiếu tới file logo nằm trong thư mục
// tmp/uploads/logos/ (nơi API upload lưu file). Mọi đường dẫn khác —
// kể cả đường dẫn tuyệt đối như /etc/passwd hay thiết bị đặc biệt
// như /dev/zero — đều bị từ chối.
// ─────────────────────────────────────────────────────────────

/** Thư mục duy nhất được phép chứa file logo dùng làm watermark */
export const LOGOS_DIR = resolve(process.cwd(), 'tmp', 'uploads', 'logos');

/** Tên file logo hợp lệ: chỉ gồm ký tự an toàn + đuôi ảnh cho phép */
const SAFE_LOGO_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(png|jpg|jpeg|svg|webp)$/i;

/**
 * Chuẩn hoá và kiểm tra đường dẫn logo do client cung cấp.
 *
 * Chấp nhận 3 dạng đầu vào:
 *   1. URL tĩnh do API upload trả về: "/uploads/logos/<uuid>.png"
 *   2. Đường dẫn tuyệt đối nằm trong thư mục logos
 *      (tương thích các bản ghi brand kit đã lưu trước đây)
 *   3. Đường dẫn tương đối (được quy chiếu về thư mục logos)
 *
 * @param logoPath  Đường dẫn logo do client gửi lên
 * @returns Đường dẫn tuyệt đối đã canonicalize (kể cả symlink) nếu file
 *          tồn tại, là file thường và nằm trong LOGOS_DIR; ngược lại null.
 */
export function resolveLogoPath(logoPath: string): string | null {
    if (typeof logoPath !== 'string' || !logoPath.trim()) return null;
    const input = logoPath.trim();

    let candidate: string;
    if (input.startsWith('/uploads/logos/')) {
        // Dạng URL tĩnh: chỉ lấy tên file, loại bỏ mọi thành phần đường dẫn khác
        const name = basename(input);
        if (!SAFE_LOGO_FILENAME.test(name)) return null;
        candidate = join(LOGOS_DIR, name);
    } else {
        candidate = resolve(input);
    }

    let real: string;
    try {
        // Canonicalize đường dẫn và resolve symlink; throw nếu file không tồn tại
        real = realpathSync(candidate);
    } catch {
        return null;
    }

    // Chỉ chấp nhận file nằm trong LOGOS_DIR (chặn ../ và symlink trỏ ra ngoài)
    const rel = relative(LOGOS_DIR, real);
    if (!rel || rel === '..' || rel.startsWith(`..${sep}`)) {
        return null;
    }

    // Tên file phải an toàn và phải là file thường
    // (chặn thiết bị đặc biệt như /dev/zero, FIFO, thư mục)
    if (!SAFE_LOGO_FILENAME.test(basename(real))) return null;
    try {
        if (!statSync(real).isFile()) return null;
    } catch {
        return null;
    }

    return real;
}
