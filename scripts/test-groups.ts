/**
 * Sổ đăng ký nhóm test — nguồn sự thật DUY NHẤT cho mọi cách chạy test.
 *
 * Vì sao cần file này: trước đây `tests/integration/billing_vietqr.test.ts` (19 test),
 * `watermark.test.ts` và `pipeline.test.ts` nằm trong repo nhưng KHÔNG script nào chạy
 * chúng — viết test rồi mà không ai gọi thì bằng không. `assertNoOrphanTests()` bên dưới
 * chặn đúng kiểu sai sót đó: mọi file `*.test.ts` phải được khai báo ở đây (hoặc nằm
 * trong một thư mục `GLOB_DIRS`), nếu không thì runner dừng ngay với lỗi rõ ràng.
 *
 * Quy ước đặt nhóm:
 *   - `fast`        : không mở trình duyệt thật, không render video thật ⇒ chạy được ở mọi PR.
 *   - `heavy`       : mở Chromium / gọi ffmpeg / chạy trọn pipeline ⇒ chạy theo lát (heavy:N).
 *   - `integration` : test tích hợp nhưng rẻ, chạy được in-memory (không cần hạ tầng).
 *   - `frontend`    : test giao diện bằng Playwright + stub API (cần Chromium).
 *   - `redis`       : cần Redis thật ⇒ chỉ chạy khi có REDIS_URL.
 *   - `e2e`         : chạy trọn pipeline 6 giai đoạn, rất nặng (thủ công / đêm).
 * File test thủ công (không phải test tự động) dùng đuôi `*.manual.ts` để không bị coi
 * là test mồ côi và không nằm trong bất kỳ nhóm tự động nào.
 */
import { readdirSync, statSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Test nhanh — chạy ở mọi PR (xem chú thích đầu file). */
export const FAST: string[] = [
    'tests/unit/admin.test.ts',
    'tests/unit/admin_analytics.test.ts',
    'tests/unit/admin_announcements.test.ts',
    'tests/unit/admin_audit_logs.test.ts',
    'tests/unit/admin_docker_logs.test.ts',
    'tests/unit/admin_failed_payments.test.ts',
    'tests/unit/admin_jobs.test.ts',
    'tests/unit/admin_orders.test.ts',
    'tests/unit/admin_payments_lists.test.ts',
    'tests/unit/admin_tickets.test.ts',
    'tests/unit/admin_refunds_list.test.ts',
    'tests/unit/admin_settings.test.ts',
    'tests/unit/admin_users.test.ts',
    'tests/unit/assembler.test.ts',
    'tests/unit/audio.test.ts',
    'tests/unit/autoDirect.test.ts',
    'tests/unit/billing_cron.test.ts',
    'tests/unit/billing_queue_memory.test.ts',
    'tests/unit/billing_reconciler.test.ts',
    'tests/unit/billing_refunds.test.ts',
    'tests/unit/billing_vietqr_service.test.ts',
    'tests/unit/chunk_renderer.test.ts',
    'tests/unit/clarify.test.ts',
    'tests/unit/gsap_linter.test.ts',
    'tests/unit/beat_detector.test.ts',
    'tests/unit/cdp_capture.test.ts',
    'tests/unit/config.test.ts',
    'tests/unit/captionBand.test.ts',
    'tests/unit/duration.test.ts',
    'tests/unit/durationBudget.test.ts',
    'tests/unit/draftVariants.test.ts',
    'tests/unit/footage.test.ts',
    'tests/unit/llm.test.ts',
    'tests/unit/retry.test.ts',
    'tests/unit/schema.test.ts',
    'tests/unit/scriptGenerator.test.ts',
    'tests/unit/scriptVariants.test.ts',
    'tests/unit/spec_a_motion_constitution.test.ts',
    'tests/unit/spec_b_deterministic_contract.test.ts',
    'tests/unit/spec_e_event_sound.test.ts',
    'tests/unit/spec_f_procedural_character.test.ts',
    'tests/unit/support_tickets.test.ts',
    'tests/unit/refund_requests.test.ts',
    'tests/unit/templates.test.ts',
    'tests/unit/styles_presets.test.ts',
    'tests/unit/style_preset_wiring.test.ts',
    'tests/unit/llm_call_timeout.test.ts',
    'tests/unit/uploadGuard.test.ts',
    'tests/unit/vieneuVoice.test.ts',
    'tests/unit/watermarkFilter.test.ts',
];

/**
 * Test nặng, chia thành các lát chạy song song trên CI (mỗi lát một runner).
 * Cân theo thời lượng đo trên máy phát triển: orchestrator.test.ts một mình đã ~190s,
 * gần bằng tổng các file còn lại.
 */
export const HEAVY_SHARDS: string[][] = [
    // Lát 1 — nặng nhất, gần như quyết định thời gian chạy.
    ['tests/unit/orchestrator.test.ts'],
    // Lát 2 — gọi pipeline thật qua HTTP/API.
    [
        'tests/unit/security.test.ts',
        'tests/unit/api.test.ts',
        'tests/unit/queue.test.ts',
        'tests/unit/spec_d_shutter_blur.test.ts',
    ],
    // Lát 3 — mở Chromium/pyftsubset và Oracle QA.
    [
        'tests/unit/spec_c_oracle_qa.test.ts',
        'tests/unit/preview.test.ts',
        'tests/unit/spec_g_karaoke_vertical.test.ts',
        'tests/unit/spec_h_font_subset.test.ts',
    ],
];

/** Test tích hợp rẻ, chạy được in-memory nên dùng được ở job PR. */
export const INTEGRATION: string[] = [
    'tests/integration/billing_vietqr.test.ts',
    'tests/integration/watermark.test.ts',
];

/** E2E rất nặng — hiện chỉ chạy thủ công (`npm run test:integration`). */
export const E2E: string[] = ['tests/integration/pipeline.test.ts'];

/**
 * Nhóm theo thư mục: file test thêm vào đây tự động thuộc nhóm, không cần khai báo
 * từng file (dùng cho các nhóm sẽ mọc dần như frontend/redis).
 */
export const GLOB_DIRS: Record<string, string> = {
    frontend: 'tests/frontend',
    redis: 'tests/redis',
};

/** Mô tả ngắn để runner in ra log/CI cho dễ đọc. */
export const GROUP_DESCRIPTION: Record<string, string> = {
    fast: 'test nhanh (không Chromium, không render thật)',
    heavy: 'test nặng (Chromium/ffmpeg/pipeline thật)',
    unit: 'toàn bộ test đơn vị (fast + heavy)',
    integration: 'test tích hợp rẻ, chạy được in-memory',
    frontend: 'test giao diện Playwright + stub API',
    redis: 'test cần Redis thật',
    e2e: 'chạy trọn pipeline 6 giai đoạn (rất nặng)',
    pr: 'nhóm chạy ở mọi PR (fast + integration + frontend)',
    all: 'toàn bộ test tự động (unit + integration + frontend)',
};

export interface ResolvedGroup {
    name: string;
    label: string;
    description: string;
    files: string[];
    /** Xem `FORCE_EXIT_GROUPS`. */
    forceExit: boolean;
}

/**
 * Nhóm cần ép tiến trình thoát ngay khi test xong (`--test-force-exit`).
 *
 * `redis`: BullMQ 6.3.10 có race ở `Worker` — nó hẹn timer kiểm job treo (mặc định 30
 * giây) NGAY SAU khi `close()` đã chạy xong, nên không còn ai huỷ timer đó; tiến trình test
 * treo thêm đúng 30 giây dù mọi test đã xong (đo được: test xong ở 32ms, thoát ở 30059ms).
 * Đây là race trong thư viện, không phải kết nối mình quên đóng — `close()` vẫn có test
 * riêng kiểm nó đóng worker/bộ nghe sự kiện/hàng đợi.
 */
export const FORCE_EXIT_GROUPS = new Set(['redis']);

function globDirFiles(dir: string): string[] {
    const abs = join(REPO_ROOT, dir);
    let entries: string[];
    try {
        entries = readdirSync(abs);
    } catch {
        return [];
    }
    return entries
        .filter((name) => name.endsWith('.test.ts'))
        .sort()
        .map((name) => `${dir}/${name}`);
}

function unique(files: string[]): string[] {
    return [...new Set(files)].sort();
}

/** Mọi file test đã được khai báo (không tính file thủ công `*.manual.ts`). */
export function declaredFiles(): string[] {
    return unique([
        ...FAST,
        ...HEAVY_SHARDS.flat(),
        ...INTEGRATION,
        ...E2E,
        ...Object.values(GLOB_DIRS).flatMap(globDirFiles),
    ]);
}

function walkTestFiles(dir: string, acc: string[] = []): string[] {
    const abs = join(REPO_ROOT, dir);
    let entries: string[];
    try {
        entries = readdirSync(abs);
    } catch {
        return acc;
    }
    for (const name of entries) {
        const rel = `${dir}/${name}`;
        if (statSync(join(REPO_ROOT, rel)).isDirectory()) {
            walkTestFiles(rel, acc);
        } else if (name.endsWith('.test.ts')) {
            acc.push(rel.split(sep).join('/'));
        }
    }
    return acc;
}

/**
 * Tìm file test bị bỏ quên (nằm trong repo nhưng không nhóm nào chạy).
 * Đây là chốt chống tái diễn lỗi "test mồ côi" đã xảy ra với billing_vietqr.test.ts.
 */
export function findOrphanTests(): string[] {
    const declared = new Set(declaredFiles());
    return walkTestFiles('tests').filter((file) => !declared.has(file));
}

export const GROUP_NAMES = [
    'fast',
    'heavy',
    'heavy:N',
    'unit',
    'integration',
    'frontend',
    'redis',
    'e2e',
    'pr',
    'all',
];

export function resolveGroup(name: string): ResolvedGroup {
    const heavyAll = HEAVY_SHARDS.flat();
    const shard = /^heavy:(\d+)$/.exec(name);

    let files: string[];
    let label = name;

    if (name === 'fast') {
        files = FAST;
    } else if (name === 'heavy') {
        files = heavyAll;
    } else if (shard) {
        const index = Number(shard[1]) - 1;
        const group = HEAVY_SHARDS[index];
        if (!group) {
            throw new Error(`Không có lát heavy số ${index + 1} (chỉ có 1..${HEAVY_SHARDS.length}).`);
        }
        files = group;
        label = `heavy:${index + 1}/${HEAVY_SHARDS.length}`;
    } else if (name === 'unit') {
        files = [...FAST, ...heavyAll];
    } else if (name === 'integration') {
        files = INTEGRATION;
    } else if (name === 'e2e') {
        files = E2E;
    } else if (name in GLOB_DIRS) {
        files = globDirFiles(GLOB_DIRS[name]);
    } else if (name === 'pr') {
        files = [...FAST, ...INTEGRATION, ...globDirFiles(GLOB_DIRS.frontend)];
    } else if (name === 'all') {
        files = [...FAST, ...heavyAll, ...INTEGRATION, ...globDirFiles(GLOB_DIRS.frontend)];
    } else {
        throw new Error(`Nhóm test không hợp lệ: "${name}". Nhóm hợp lệ: ${GROUP_NAMES.join(', ')}.`);
    }

    return {
        name,
        label,
        description: GROUP_DESCRIPTION[name] ?? label,
        files: unique(files),
        forceExit: FORCE_EXIT_GROUPS.has(name),
    };
}
