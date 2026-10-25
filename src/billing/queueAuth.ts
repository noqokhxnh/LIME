import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getConfig } from "../config.js";
import type { SePayWebhookPayload } from "./types.js";

/**
 * Chữ ký toàn vẹn cho payload webhook khi đi qua hàng đợi.
 *
 * Hàng đợi SePay (Redis) không có cơ chế xác thực người ghi: bất kỳ tiến
 * trình nào chạm được Redis đều enqueue được một "giao dịch" và worker sẽ
 * xử lý như tiền thật. Route HTTP đã kiểm chứng chữ ký SePay TRƯỚC khi
 * enqueue, nhưng niềm tin đó bị mất ngay khi payload vào queue.
 *
 * Lớp này ký HMAC-SHA256 lên payload lúc enqueue và kiểm chứng lúc worker
 * nhặt job; payload không có chữ ký hợp lệ bị bỏ (drop + log), không xử lý.
 * Khoá ký lấy từ bí mật đã có của server (SEPAY_WEBHOOK_SECRET →
 * SEPAY_API_KEY → DATABASE_URL); nếu không có gì (dev in-memory thuần),
 * dùng khoá ngẫu nhiên theo tiến trình — vẫn chặn được ghi chéo tiến trình.
 */

let ephemeralKey: string | null = null;

function signingKey(): string {
    const config = getConfig();
    const material = config.SEPAY_WEBHOOK_SECRET || config.SEPAY_API_KEY || config.DATABASE_URL;
    if (material) return `lime-sepay-queue:${material}`;
    if (!ephemeralKey) ephemeralKey = randomBytes(32).toString("hex");
    return `lime-sepay-queue-ephemeral:${ephemeralKey}`;
}

function canonical(payload: SePayWebhookPayload): string {
    const { _queueSig, ...rest } = payload as Record<string, unknown>;
    return JSON.stringify(rest, Object.keys(rest).sort());
}

function computeSig(payload: SePayWebhookPayload): string {
    return createHmac("sha256", signingKey()).update(canonical(payload)).digest("hex");
}

/** Trả bản sao payload đã gắn chữ ký hàng đợi. */
export function signWebhookPayload(payload: SePayWebhookPayload): SePayWebhookPayload {
    return { ...payload, _queueSig: computeSig(payload) };
}

/** Kiểm chứng chữ ký hàng đợi (không có chữ ký = không hợp lệ). */
export function verifyWebhookPayload(payload: SePayWebhookPayload): boolean {
    const sig = (payload as Record<string, unknown>)?._queueSig;
    if (typeof sig !== "string" || !sig) return false;
    const expected = computeSig(payload);
    if (sig.length !== expected.length) return false;
    try {
        return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    } catch {
        return false;
    }
}

/** Bỏ trường chữ ký trước khi payload tới logic nghiệp vụ/lưu trữ. */
export function stripWebhookSignature(payload: SePayWebhookPayload): SePayWebhookPayload {
    const { _queueSig, ...rest } = payload as Record<string, unknown>;
    return rest as SePayWebhookPayload;
}
