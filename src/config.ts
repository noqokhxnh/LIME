import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
    PORT: z.coerce.number().default(3000),
    NODE_ENV: z.enum(['production', 'development']).default('development'),
    DATABASE_URL: z.string().optional(),
    // Số kết nối tối đa của pool PostgreSQL (mỗi tiến trình). Mặc định 10 như
    // trước, nay cấu hình được để khớp giới hạn `max_connections` của server.
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(1000).default(10),
    // Chặn truy vấn treo giữ lock vô hạn và chiếm hết pool. 0 = tắt giới hạn.
    DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(0).default(10000),
    SESSION_TTL_DAYS: z.coerce.number().int().positive().default(7),
    QUEUE_TYPE: z.enum(['redis', 'memory']).default('memory'),
    REDIS_URL: z.string().optional(),
    // Danh sách origin được phép gọi API từ trình duyệt khác domain (CORS),
    // cách nhau bằng dấu phẩy — ví dụ "https://lime.app". Mặc định rỗng =
    // không cho phép origin nào, vì frontend được chính server này phục vụ
    // (cùng origin) nên không cần nới CORS. Vá theo issue #133: trước đây
    // index.ts dùng origin: true kèm credentials: true, phản chiếu mọi
    // origin và để website lạ đọc trộm dữ liệu phiên của người dùng.
    CORS_ORIGIN: z.string().default(''),
    // Chỉ bật (true) khi app chạy sau reverse proxy (Nginx/Cloudflare/Docker):
    // Fastify mới tin X-Forwarded-For để lấy IP thật của client cho rate limit
    // và kiểm tra IP webhook. Bật khi KHÔNG có proxy sẽ cho client giả mạo IP
    // qua header. Nhận '1'/'true' là bật, còn lại (kể cả không đặt) là tắt.
    // Vá theo issue #133: biến này đã có trong tài liệu nhưng code chưa đọc.
    TRUST_PROXY: z.preprocess((val) => {
        if (typeof val === 'string') return val === '1' || val.toLowerCase() === 'true';
        return Boolean(val);
    }, z.boolean().default(false)),


    LLM_Provider: z.preprocess(
        (val) => {
            const v = val || process.env.LLM_PROVIDER;
            return typeof v === 'string' ? v.toLowerCase() : v;
        },
        z.enum(['openai', 'deepseek', 'gemini', 'claude', '9router']).default('gemini')
    ),
    LLM_AUTO_SWITCH: z.preprocess((val) => {
        if (val === undefined || val === null || val === '') return true;
        if (typeof val === 'string') {
            return val.toLowerCase() !== 'false' && val !== '0';
        }
        return Boolean(val);
    }, z.boolean().default(true)),

    NineRouter_BaseURL: z.preprocess(
        (val) => val || process.env.NINEROUTER_BASE_URL || process.env.NINE_ROUTER_BASE_URL || 'http://localhost:20128/v1',
        z.string().default('http://localhost:20128/v1')
    ),
    NineRouter_APIKEY: z.preprocess(
        (val) => val || process.env.NINEROUTER_API_KEY || process.env.NINE_ROUTER_API_KEY,
        z.string().optional()
    ),
    NineRouter_Model: z.preprocess(
        (val) => val || process.env.NINEROUTER_MODEL || process.env.NINE_ROUTER_MODEL || 'ag/gemini-3.8-flash-high',
        z.string().default('ag/gemini-3.8-flash-high')
    ),

    // Mô hình vision (multimodal) dùng để tự mô tả asset ảnh (#103).
    // Mặc định dùng cùng mô hình 9router đã cấu hình — ag/gemini-3.8-flash-high
    // hỗ trợ ảnh nên đủ cho asset.
    Vision_Model: z.preprocess(
        (val) => val || process.env.VISION_MODEL || 'ag/gemini-3.8-flash-high',
        z.string().default('ag/gemini-3.8-flash-high')
    ),

    OpenAI_APIKEY: z.string().optional(),
    OpenAI_Model: z.string().default('gpt-5.3-codex'),

    DeepSeek_APIKEY: z.string().optional(),
    DeepSeek_Model: z.string().default('deepseek-4-flash'),

    Gemini_APIKEY: z.string().optional(),
    Gemini_Model: z.string().default('gemini-3.5-flash'),

    Claude_APIKEY: z.string().optional(),
    Claude_Model: z.string().default("claude sonnet 4.5"),

    TTS_Provider: z.enum(['edge', 'elevenlabs', 'openai', 'google', 'vieneu']).default('edge'),
    RENDER_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(1),
    VIENEU_TTS_URL: z.string().default('http://127.0.0.1:7860'),
    TTS_Voice: z.string().default('alloy'),

    Elevenlabs_API_KEY: z.string().optional(),
    Elevenlabs_Voice_ID: z.string().optional(),
    OpenAI_TTS_Model: z.string().optional(),
    Google_TTS_Model: z.string().optional(),
    Google_TTS_APIKEY: z.string().optional(),

    Default_FPS: z.coerce.number().default(30),
    Default_Width: z.coerce.number().default(1920),
    Default_Height: z.coerce.number().default(1080),

    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    GOOGLE_REDIRECT_URI: z.string().default('http://localhost:3000/api/auth/google/callback'),

    // Thư viện asset (#103): hạn mức tải lên theo tài khoản, chống lạm dụng ổ đĩa.
    ASSET_MAX_COUNT_PER_USER: z.coerce.number().int().min(1).default(100),
    ASSET_MAX_TOTAL_BYTES_PER_USER: z.coerce.number().int().min(1).default(1024 * 1024 * 1024), // 1GB

    // VietQR & SePay Billing Configuration
    SEPAY_API_KEY: z.string().optional(),
    SEPAY_WEBHOOK_SECRET: z.string().optional(),
    BANK_ACCOUNT: z.string().default('0982618707'),
    BANK_CODE: z.string().default('MB'),
    BANK_BIN: z.string().default('970422'),
    BANK_NAME: z.string().default('Ngân hàng Quân Đội (MBBank)'),
    BANK_ACCOUNT_NAME: z.string().default('NGUYEN QUANG KHANH'),
    PAY_CODE_PREFIX: z.string().default('LIME'),
    ORDER_TTL_MINUTES: z.coerce.number().default(15),
    CLAIMED_EXTEND_MINUTES: z.coerce.number().default(30),
    SEPAY_IP_ALLOWLIST: z.string().optional(),
    SEPAY_IP_ALLOWLIST_ENABLED: z.enum(['true', 'false', '1', '0']).default('false').transform(val => val === 'true' || val === '1'),
    SEPAY_TEST_MODE: z.enum(['true', 'false', '1', '0']).default('false').transform(val => val === 'true' || val === '1'),
});

export type Config = z.infer<typeof envSchema>;

export { envSchema };

let _config: Config | null = null;
/**
 * Tách chuỗi CORS_ORIGIN trong .env thành danh sách origin sạch
 * (cắt khoảng trắng thừa, bỏ phần tử rỗng). Chuỗi rỗng/không đặt -> [].
 */
export function parseCorsOrigins(raw: string | undefined): string[] {
    return (raw ?? '')
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0);
}

/**
 * Kiểm tra một Origin có nằm trong danh sách được phép gọi API hay không.
 * Danh sách rỗng nghĩa là chặn mọi origin (mặc định an toàn của issue #133).
 */
export function isCorsOriginAllowed(origin: string, allowedOrigins: string[]): boolean {
    return allowedOrigins.includes(origin);
}

export function getConfig(): Config {
    if (!_config) {
        // Chấp nhận cả TTS_PROVIDER (chuẩn ALL_CAPS trong .env/docker) lẫn TTS_Provider (schema cũ).
        // Dùng bản sao để KHÔNG ghi ngược vào process.env — tránh rò rỉ trạng thái
        // giữa các lần gọi `getConfig()`/`resetConfig()` và làm test phụ thuộc thứ tự.
        const env = { ...process.env };
        if (!env.TTS_Provider && env.TTS_PROVIDER) {
            env.TTS_Provider = env.TTS_PROVIDER;
        }
        const result = envSchema.safeParse(env);
        if (!result.success) {
            throw new Error(`Configuration error: ${result.error.message}`);
        }
        _config = result.data;
    }
    return _config;
}

export function resetConfig(): void {
    _config = null;
}


export type videoPreset = {
    name: string;
    width: number;
    height: number;
    label: string;
};

export const videoPreset: Record<string, videoPreset> = {
    "16:9": {
        name: "16:9",
        width: 1920,
        height: 1080,
        label: "16:9",
    },
    "9:16": {
        name: "9:16",
        width: 1080,
        height: 1920,
        label: "9:16",
    },
    "4:3": {
        name: "4:3",
        width: 1440,
        height: 1920,
        label: "4:3",
    },
    "1:1": {
        name: "1:1",
        width: 1920,
        height: 1920,
        label: "1:1",
    },
    "vertical": {
        name: "vertical",
        width: 720,
        height: 1280,
        label: "9:16 Vertical (720x1280)",
    },
    "horizontal": {
        name: "horizontal",
        width: 1920,
        height: 1080,
        label: "16:9 Horizontal (1920x1080)",
    },
    // Issue #30: 4K UHD presets
    "4k": {
        name: "4k",
        width: 3840,
        height: 2160,
        label: "4K UHD 16:9 (3840x2160)",
    },
    "4k-vertical": {
        name: "4k-vertical",
        width: 2160,
        height: 3840,
        label: "4K Vertical 9:16 (2160x3840)",
    },
};

export function resolveResolution(aspectRatio?: string, format?: "vertical" | "horizontal"): videoPreset {
    if (format === "vertical") {
        return videoPreset["vertical"];
    }
    if (format === "horizontal") {
        return videoPreset["horizontal"];
    }
    if (aspectRatio && videoPreset[aspectRatio]) {
        return videoPreset[aspectRatio];
    }
    return videoPreset["16:9"];
}