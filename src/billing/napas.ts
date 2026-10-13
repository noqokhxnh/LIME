/**
 * Pure TypeScript EMVCo / NAPAS 247 VietQR Generator
 * Implements standard merchant-presented mode TLV format and CRC-16/CCITT without external dependencies.
 */

export const BANK_BINS: Record<string, string> = {
    MB: '970422',
    MBBANK: '970422',
    VCB: '970436',
    VIETCOMBANK: '970436',
    TCB: '970407',
    TECHCOMBANK: '970407',
    ACB: '970416',
    VPB: '970432',
    VPBANK: '970432',
    TPB: '970423',
    TPBANK: '970423',
    BIDV: '970418',
    CTG: '970415',
    VIETINBANK: '970415',
    VIB: '970441',
    STB: '970403',
    SACOMBANK: '970403',
    SHB: '970443',
    HDB: '970437',
    HDBANK: '970437',
    OCB: '970448',
    MSB: '970426',
    LPB: '970449',
    SEABANK: '970440',
};

export function getBankBin(bankCode: string): string {
    const normalized = bankCode.toUpperCase().replace(/[^A-Z0-9]/g, '');
    return BANK_BINS[normalized] || '970422'; // Default to MBBank
}

export function formatTlv(tag: string, value: string): string {
    const len = value.length.toString().padStart(2, '0');
    return `${tag}${len}${value}`;
}

export function calculateCrc16Ccitt(data: string): string {
    let crc = 0xffff;
    for (let i = 0; i < data.length; i++) {
        crc ^= data.charCodeAt(i) << 8;
        for (let j = 0; j < 8; j++) {
            if ((crc & 0x8000) !== 0) {
                crc = ((crc << 1) ^ 0x1021) & 0xffff;
            } else {
                crc = (crc << 1) & 0xffff;
            }
        }
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
}

export interface NapasQrOptions {
    bankBin: string;
    bankAccount: string;
    amount: number;
    memo: string;
}

export function generateNapasQrString(options: NapasQrOptions): string {
    const { bankBin, bankAccount, amount, memo } = options;

    // Sub-tags for Beneficiary Bank Info (38.01)
    const beneficiaryValue = formatTlv('00', bankBin) + formatTlv('01', bankAccount);

    // Sub-tags for Tag 38 (Merchant Account Info - NAPAS)
    const tag38Value =
        formatTlv('00', 'A000000727') +
        formatTlv('01', beneficiaryValue) +
        formatTlv('02', 'QRIBFTTA');

    // Sub-tag for Tag 62 (Additional Data Field - Purpose / Memo)
    const tag62Value = formatTlv('08', memo);

    let raw =
        formatTlv('00', '01') + // Format indicator
        formatTlv('01', '12') + // Dynamic QR
        formatTlv('38', tag38Value) +
        formatTlv('53', '704') + // VND
        formatTlv('54', Math.round(amount).toString()) +
        formatTlv('58', 'VN') +
        formatTlv('62', tag62Value) +
        '6304'; // CRC tag and length placeholder

    const crc = calculateCrc16Ccitt(raw);
    return `${raw.slice(0, -4)}${formatTlv('63', crc)}`;
}

export function generateQrImageUrl(options: {
    bankCode: string;
    bankAccount: string;
    amount: number;
    memo: string;
    accountName?: string;
}): string {
    const { bankCode, bankAccount, amount, memo, accountName } = options;
    const encodedMemo = encodeURIComponent(memo);
    const encodedName = accountName ? encodeURIComponent(accountName) : '';

    // Primary: qr.sepay.vn/img
    // Fallback: img.vietqr.io
    return `https://qr.sepay.vn/img?acc=${bankAccount}&bank=${bankCode}&amount=${amount}&des=${encodedMemo}&template=compact`;
}
