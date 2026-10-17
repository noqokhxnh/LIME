/**
 * Chạy test theo nhóm, có thể kèm đo độ phủ mã nguồn.
 *
 *   tsx scripts/run-unit-tests.ts <nhóm> [--coverage] [--threshold=<n>] [--no-orphan-check]
 *
 * Nhóm: xem `scripts/test-groups.ts` (fast, heavy, heavy:N, unit, integration,
 *       frontend, redis, e2e, pr, all).
 *
 * Cờ:
 *   --coverage        bật đo độ phủ (Node built-in V8 coverage + source map, khớp đúng
 *                     số dòng trong file .ts), xuất `coverage/lcov.info` cho CI.
 *   --threshold=<n>   cổng chất lượng theo số % dòng; bỏ trống thì lấy từ
 *                     `scripts/coverage-thresholds.json` theo tên nhóm.
 *   --no-orphan-check bỏ qua chốt "không được có file test mồ côi".
 *
 * Ví dụ:
 *   npm run test:coverage:pr        # nhóm chạy ở PR + cổng chất lượng
 *   npm run test:coverage           # toàn bộ test tự động + cổng chất lượng
 *   npx tsx scripts/run-unit-tests.ts heavy:2
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { GROUP_NAMES, REPO_ROOT, findOrphanTests, resolveGroup } from './test-groups.js';

const COVERAGE_DIR = join(REPO_ROOT, 'coverage');
const THRESHOLDS_FILE = join(REPO_ROOT, 'scripts', 'coverage-thresholds.json');

interface Options {
    group: string;
    coverage: boolean;
    threshold?: number;
    orphanCheck: boolean;
    coverageOut?: string;
}

function parseArgs(argv: string[]): Options {
    const positional = argv.filter((arg) => !arg.startsWith('--'));
    const flags = new Map<string, string | true>();
    for (const arg of argv.filter((value) => value.startsWith('--'))) {
        const [key, value] = arg.replace(/^--/, '').split('=');
        flags.set(key, value ?? true);
    }

    const rawThreshold = flags.get('threshold');
    const threshold = rawThreshold === undefined || rawThreshold === true ? undefined : Number(rawThreshold);
    if (threshold !== undefined && (!Number.isFinite(threshold) || threshold < 0)) {
        throw new Error(`--threshold phải là một số ≥ 0, nhận được "${String(rawThreshold)}".`);
    }

    const rawOut = flags.get('coverage-out');

    return {
        group: positional[0] ?? '',
        coverage: flags.has('coverage'),
        threshold,
        orphanCheck: !flags.has('no-orphan-check'),
        coverageOut: rawOut === undefined || rawOut === true ? undefined : rawOut,
    };
}

/** Ngưỡng theo nhóm, để mỗi lần lấp thêm test chỉ cần sửa đúng một con số. */
function thresholdFor(group: string): number | undefined {
    let raw: string;
    try {
        raw = readFileSync(THRESHOLDS_FILE, 'utf8');
    } catch {
        return undefined;
    }
    let table: Record<string, number>;
    try {
        table = JSON.parse(raw) as Record<string, number>;
    } catch (error) {
        throw new Error(`Không đọc được ${THRESHOLDS_FILE}: ${(error as Error).message}`);
    }
    const value = table[group];
    return typeof value === 'number' ? value : undefined;
}

function coverageArgs(threshold?: number, out?: string): string[] {
    const lcovPath = out ? join(REPO_ROOT, out) : join(COVERAGE_DIR, 'lcov.info');
    mkdirSync(dirname(lcovPath), { recursive: true });
    const args = [
        '--experimental-test-coverage',
        // Chỉ tính mã sản phẩm; `include-all` để file chưa từng được import vẫn bị tính 0%
        // (nhờ vậy con số phản ánh đúng phần mã nằm ngoài tầm test).
        '--test-coverage-include=src/**',
        '--test-coverage-include-all',
        '--test-reporter=spec',
        '--test-reporter-destination=stdout',
        '--test-reporter=lcov',
        `--test-reporter-destination=${lcovPath}`,
    ];
    if (threshold !== undefined) {
        args.push(`--test-coverage-lines=${threshold}`);
    }
    return args;
}

function main(): number {
    let options: Options;
    try {
        options = parseArgs(process.argv.slice(2));
    } catch (error) {
        console.error(`[test] ${(error as Error).message}`);
        return 2;
    }

    if (!options.group) {
        console.error('Cách dùng: tsx scripts/run-unit-tests.ts <nhóm> [--coverage] [--threshold=<n>]');
        console.error('            [--coverage-out=<đường dẫn .info>] [--no-orphan-check]');
        console.error(`Nhóm hợp lệ: ${GROUP_NAMES.join(', ')}.`);
        return 2;
    }

    if (options.orphanCheck) {
        const orphans = findOrphanTests();
        if (orphans.length > 0) {
            console.error('[test] Có file test không thuộc nhóm nào (test mồ côi — sẽ không bao giờ chạy):');
            for (const file of orphans) console.error(`  - ${file}`);
            console.error('  Hãy khai báo trong scripts/test-groups.ts (hoặc chuyển vào tests/frontend, tests/redis).');
            return 1;
        }
    }

    let group;
    try {
        group = resolveGroup(options.group);
    } catch (error) {
        console.error(`[test] ${(error as Error).message}`);
        return 2;
    }

    if (group.files.length === 0) {
        console.error(`[test] Nhóm "${group.name}" chưa có file test nào.`);
        return 1;
    }

    const threshold = options.coverage ? options.threshold ?? thresholdFor(group.name) : undefined;

    console.log(`[test] nhóm ${group.label} — ${group.description}`);
    console.log(`[test] ${group.files.length} file: ${group.files.join(', ')}`);
    if (options.coverage) {
        console.log(
            threshold === undefined
                ? '[test] có đo độ phủ (không đặt cổng chất lượng)'
                : `[test] có đo độ phủ, cổng chất lượng: dòng ≥ ${threshold}%`,
        );
    }

    // LƯU Ý: mọi cờ của Node phải đứng TRƯỚC danh sách file test — Node coi những
    // gì nằm sau đối số vị trí đầu tiên là đối số của script, nên nếu đặt cờ ở cuối
    // thì cờ coverage (kể cả cổng chất lượng) bị bỏ qua trong im lặng.
    const args = ['--test'];
    if (options.coverage) {
        args.push(...coverageArgs(threshold, options.coverageOut));
    }
    args.push(...group.files);

    const result = spawnSync('npx', ['tsx', ...args], {
        cwd: REPO_ROOT,
        stdio: 'inherit',
        shell: process.platform === 'win32',
    });

    if (result.error) {
        console.error(`[test] Không chạy được bộ test: ${result.error.message}`);
        return 1;
    }
    return result.status ?? 1;
}

process.exit(main());
