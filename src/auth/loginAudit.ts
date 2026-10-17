import type { FastifyRequest } from 'fastify';
import { auditLog } from '../security/auditLog.js';
import { resolveIpGeo } from '../security/geoIp.js';
import { extractClientIp } from '../security/pageViewTracker.js';

/**
 * Các hành động xác thực được ghi vào `audit_logs`.
 * Dùng prefix `auth.` để phân biệt với log thao tác của admin và để lịch sử
 * đăng nhập ở cổng quản trị lọc được chính xác.
 */
export type AuthEventAction =
    | 'auth.register'
    | 'auth.login'
    | 'auth.login_failed'
    | 'auth.password_changed';

export const LOGIN_ACTIONS: AuthEventAction[] = [
    'auth.register',
    'auth.login',
    'auth.login_failed',
    'auth.password_changed',
];

/** Môi trường test: không gọi dịch vụ GeoIP bên ngoài để test không bị chậm. */
const isTestEnv =
    process.env.NODE_ENV === 'test' || process.argv.some((arg) => arg.includes('test'));

export interface AuthEvent {
    action: AuthEventAction;
    request: FastifyRequest;
    status?: 'success' | 'failure' | 'warning';
    userId?: string | null;
    userEmail?: string | null;
    provider?: 'local' | 'google';
    details?: Record<string, unknown>;
}

/**
 * Ghi nhật ký xác thực kèm IP thật và vị trí/nhà mạng phân giải từ IP.
 *
 * Trước đây hệ thống không ghi lại lần đăng nhập nào, nên tab "Lịch sử đăng nhập"
 * ở cổng quản trị luôn trống và bảng người dùng luôn hiển thị "Chưa đăng nhập".
 *
 * Hàm chờ ghi xong vào DB để ngay sau đó có thể truy vấn lại (xem `auditLog.recordAndPersist`).
 */
export async function recordAuthEvent(event: AuthEvent): Promise<void> {
    const ip = extractClientIp(event.request);

    let location: string | undefined;
    let isp: string | undefined;
    try {
        const geo = await resolveIpGeo(ip, event.request, { allowRemote: !isTestEnv });
        location = geo.location;
        isp = geo.isp;
    } catch {
        // Không phân giải được vị trí thì vẫn phải ghi nhận sự kiện đăng nhập.
    }

    const userAgentHeader = event.request.headers['user-agent'];
    const userAgent = (Array.isArray(userAgentHeader) ? userAgentHeader[0] : userAgentHeader) || '';

    try {
        await auditLog.recordAndPersist({
            action: event.action,
            status: event.status || 'success',
            userId: event.userId || undefined,
            userEmail: event.userEmail || undefined,
            ip,
            details: {
                provider: event.provider || 'local',
                location,
                isp,
                userAgent: userAgent.slice(0, 300),
                ...(event.details || {}),
            },
        });
    } catch (err) {
        // Ghi log lỗi không được làm hỏng luồng đăng nhập của người dùng.
        console.error('[AuthAudit] Không ghi được nhật ký xác thực:', err);
    }
}
