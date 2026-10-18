import { BANK_BINS } from './napas.js';

/**
 * Danh mục ngân hàng hỗ trợ hoàn tiền.
 *
 * `code` là mã ngắn dùng xuyên suốt hệ thống (trùng khoá trong `BANK_BINS` của
 * NAPAS 247 nên sinh được VietQR khi cần), `name` là tên hiển thị cho người dùng
 * và quản trị viên, `bin` là mã BIN NAPAS.
 *
 * Danh sách này là nguồn sự thật duy nhất cho ô chọn ngân hàng trong yêu cầu
 * hoàn tiền: máy chủ chỉ chấp nhận `code` nằm trong đây, nhờ vậy tên ngân hàng
 * lưu vào hồ sơ luôn chuẩn hoá (không phụ thuộc chuỗi người dùng gõ tay).
 */
export interface SupportedBank {
    code: string;
    name: string;
    bin: string;
}

export const SUPPORTED_BANKS: SupportedBank[] = [
    { code: 'MB', name: 'MB Bank', bin: BANK_BINS.MB },
    { code: 'VCB', name: 'Vietcombank', bin: BANK_BINS.VCB },
    { code: 'TCB', name: 'Techcombank', bin: BANK_BINS.TCB },
    { code: 'ACB', name: 'ACB', bin: BANK_BINS.ACB },
    { code: 'VPB', name: 'VPBank', bin: BANK_BINS.VPB },
    { code: 'TPB', name: 'TPBank', bin: BANK_BINS.TPB },
    { code: 'BIDV', name: 'BIDV', bin: BANK_BINS.BIDV },
    { code: 'CTG', name: 'VietinBank', bin: BANK_BINS.CTG },
    { code: 'VIB', name: 'VIB', bin: BANK_BINS.VIB },
    { code: 'STB', name: 'Sacombank', bin: BANK_BINS.STB },
    { code: 'SHB', name: 'SHB', bin: BANK_BINS.SHB },
    { code: 'HDB', name: 'HDBank', bin: BANK_BINS.HDB },
    { code: 'OCB', name: 'OCB', bin: BANK_BINS.OCB },
    { code: 'MSB', name: 'MSB', bin: BANK_BINS.MSB },
    { code: 'LPB', name: 'LPBank', bin: BANK_BINS.LPB },
    { code: 'SEABANK', name: 'SeABank', bin: BANK_BINS.SEABANK },
];

/** Tra ngân hàng theo mã (không phân biệt hoa thường). */
export function getBankByCode(code: string): SupportedBank | null {
    const normalized = String(code || '').trim().toUpperCase();
    return SUPPORTED_BANKS.find((b) => b.code === normalized) || null;
}
