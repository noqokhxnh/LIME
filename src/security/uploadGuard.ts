import { mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { v4 as uuidv4 } from 'uuid';

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

/**
 * Làm sạch (sanitize) nội dung SVG để loại bỏ mã độc.
 *
 * Các mối nguy hiểm trong SVG:
 *   - XSS qua thẻ <script>: cho phép chạy JavaScript
 *   - XSS qua event handler: onload="alert(1)", onclick="fetch(...)", ...
 *   - XXE (XML External Entity): <!ENTITY xxe SYSTEM "file:///etc/passwd">
 *     cho phép đọc file trên server
 *   - foreignObject: cho phép nhúng HTML tùy ý vào SVG
 *   - use href: có thể tham chiếu đến tài nguyên ngoài
 *
 * @param svgContent  Chuỗi nội dung SVG thô do người dùng upload
 * @returns Chuỗi SVG đã được làm sạch, an toàn để lưu và hiển thị
 */
export function sanitizeSvg(svgContent: string): string {
    let clean = svgContent;

    // 1. Xóa toàn bộ thẻ <script>...</script> (kể cả nhiều dòng)
    clean = clean.replace(/<script[\s\S]*?<\/script>/gi, '');

    // 2. Xóa thẻ <script ... /> tự đóng
    clean = clean.replace(/<script[^>]*\/>/gi, '');

    // 3. Xóa toàn bộ event handler dạng on* (onload, onclick, onerror, ...)
    //    Ví dụ: onload="maliciousCode()" → bị xóa
    clean = clean.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '');

    // 4. Xóa các khai báo <!DOCTYPE và <!ENTITY để chặn tấn công XXE
    //    Ví dụ: <!ENTITY xxe SYSTEM "file:///etc/passwd"> → bị xóa
    clean = clean.replace(/<!DOCTYPE[^>]*>/gi, '');
    clean = clean.replace(/<!ENTITY[^>]*>/gi, '');

    // 5. Xóa thẻ <foreignObject> cho phép nhúng HTML tùy ý vào SVG
    clean = clean.replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '');

    // 6. Xóa thuộc tính href trỏ đến javascript: (JavaScript URI)
    //    Ví dụ: href="javascript:alert(1)" → bị xóa
    clean = clean.replace(/href\s*=\s*["']javascript:[^"']*["']/gi, '');

    // 7. Xóa thuộc tính xlink:href trỏ đến bên ngoài (dạng URL http/https/data)
    //    Nhưng giữ lại xlink:href trỏ đến id nội bộ (bắt đầu bằng #)
    clean = clean.replace(/xlink:href\s*=\s*["'](?!#)[^"']*["']/gi, '');

    return clean;
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
