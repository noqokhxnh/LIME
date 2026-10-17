/**
 * Gộp nhiều báo cáo lcov thành một và kiểm tra cổng chất lượng.
 *
 *   tsx scripts/merge-coverage.ts <thư mục hoặc file .info...> [--threshold=<n>]
 *
 * Vì sao cần file này: `node --test --experimental-test-coverage` chỉ tổng hợp số liệu
 * trong MỘT tiến trình. Chạy cả bộ test trong một tiến trình kèm đo độ phủ mất hơn 10
 * phút trên máy phát triển (và lâu hơn rất nhiều trên runner CI), trong khi các lát test
 * vẫn phải chạy song song mới kịp. Cách làm ở đây: mỗi lát chạy kèm coverage và xuất
 * một file lcov riêng, rồi gộp theo nguyên tắc "dòng nào được chạm ở bất kỳ lát nào thì
 * coi như đã phủ" — con số nhận được đúng bằng hợp của các lát, tức bằng toàn bộ suite.
 *
 * Ngưỡng lấy từ `scripts/coverage-thresholds.json` (khoá `all`) nếu không truyền
 * `--threshold`; đặt dưới ngưỡng thì script thoát với mã 1 để CI đỏ.
 */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MERGED_LCOV = join(REPO_ROOT, 'coverage', 'lcov.info');
const THRESHOLDS_FILE = join(REPO_ROOT, 'scripts', 'coverage-thresholds.json');

/** line -> số lần chạm, gộp từ mọi file lcov. */
type LineHits = Map<number, number>;

interface FileCoverage {
    /** Số dòng vật lý của file (Node lấy từ chính file nguồn, không đổi giữa các lát). */
    physicalLines: number;
    hits: LineHits;
}

function collectInfoFiles(paths: string[]): string[] {
    const found: string[] = [];
    for (const path of paths) {
        const abs = join(REPO_ROOT, path);
        let stat;
        try {
            stat = statSync(abs);
        } catch {
            continue;
        }
        if (stat.isDirectory()) {
            for (const name of readdirSync(abs).sort()) {
                if (name.endsWith('.info')) found.push(join(abs, name));
            }
        } else if (path.endsWith('.info')) {
            found.push(abs);
        }
    }
    return found;
}

/**
 * Đọc lcov và cộng dồn số lần chạm theo (file nguồn, số dòng).
 * `SF:` mở một hồ sơ file, `DA:<dòng>,<số lần>` là một dòng được đo.
 *
 * Định nghĩa "dòng đã phủ" của Node (dùng cho LF/LH trong lcov và cột line% trên bảng):
 *   LH = (số dòng vật lý) - (số dòng ĐO ĐƯỢC mà không lần nào chạm)
 * tức dòng trống/ghi chú vẫn tính là đã phủ. Ta gộp đúng theo định nghĩa đó để con số
 * sau khi gộp khớp với con số của một lần chạy nguyên khối.
 */
function mergeLcov(files: string[]): Map<string, FileCoverage> {
    const merged = new Map<string, FileCoverage>();
    let current: FileCoverage | null = null;

    for (const file of files) {
        current = null;
        for (const rawLine of readFileSync(file, 'utf8').split('\n')) {
            const line = rawLine.trim();
            if (line.startsWith('SF:')) {
                const source = line.slice(3).trim();
                let record = merged.get(source);
                if (!record) {
                    record = { physicalLines: 0, hits: new Map<number, number>() };
                    merged.set(source, record);
                }
                current = record;
                continue;
            }
            if (!current) continue;
            if (line.startsWith('DA:')) {
                const [lineNumber, hits] = line.slice(3).split(',');
                const parsedLine = Number(lineNumber);
                const parsedHits = Number(hits);
                if (!Number.isFinite(parsedLine) || !Number.isFinite(parsedHits)) continue;
                current.hits.set(parsedLine, (current.hits.get(parsedLine) ?? 0) + parsedHits);
            } else if (line.startsWith('LF:')) {
                const value = Number(line.slice(3));
                if (Number.isFinite(value) && value > current.physicalLines) {
                    current.physicalLines = value;
                }
            }
        }
    }
    return merged;
}

function thresholdFromConfig(key = 'all'): number | undefined {
    try {
        const table = JSON.parse(readFileSync(THRESHOLDS_FILE, 'utf8')) as Record<string, number>;
        return typeof table[key] === 'number' ? table[key] : undefined;
    } catch {
        return undefined;
    }
}

function percentage(covered: number, total: number): string {
    return total === 0 ? '0.00' : ((covered / total) * 100).toFixed(2);
}

function main(): number {
    const argv = process.argv.slice(2);
    const targets = argv.filter((arg) => !arg.startsWith('--'));
    const rawThreshold = argv.find((arg) => arg.startsWith('--threshold='))?.split('=')[1];
    const threshold = rawThreshold === undefined ? thresholdFromConfig() : Number(rawThreshold);
    const rawExpect = argv.find((arg) => arg.startsWith('--expect-parts='))?.split('=')[1];
    const expectParts = rawExpect === undefined ? undefined : Number(rawExpect);

    const infoFiles = collectInfoFiles(targets.length > 0 ? targets : ['coverage']);
    if (infoFiles.length === 0) {
        console.error(`[coverage] Không tìm thấy file lcov nào trong: ${(targets.length > 0 ? targets : ['coverage']).join(', ')}`);
        return 1;
    }

    // Chốt an toàn cho CI: nếu thiếu lát (job nào đó lỗi trước khi kịp upload) thì con số
    // gộp sẽ thiếu và "đạt ngưỡng" trở thành kết luận sai — thà báo lỗi còn hơn.
    if (expectParts !== undefined && infoFiles.length !== expectParts) {
        console.error(
            `[coverage] Cần gộp ${expectParts} lát nhưng chỉ thấy ${infoFiles.length} file lcov — báo cáo không đầy đủ, không kết luận đạt/không đạt.`,
        );
        return 1;
    }

    const merged = mergeLcov(infoFiles);
    if (merged.size === 0) {
        console.error('[coverage] Các file lcov rỗng — không có dữ liệu để gộp.');
        return 1;
    }

    const rows: { source: string; covered: number; total: number }[] = [];
    let totalCovered = 0;
    let totalLines = 0;

    const output: string[] = [];
    for (const source of [...merged.keys()].sort()) {
        const record = merged.get(source)!;
        // Dòng "đo được" mà không lần nào chạm ⇒ bị coi là chưa phủ; mọi dòng còn lại
        // (kể cả dòng trống/ghi chú) tính là đã phủ, đúng như Node làm.
        let measuredUncovered = 0;
        for (const count of record.hits.values()) {
            if (count === 0) measuredUncovered++;
        }
        const total = record.physicalLines > 0 ? record.physicalLines : record.hits.size;
        const covered = Math.max(total - measuredUncovered, 0);
        rows.push({ source, covered, total });
        totalCovered += covered;
        totalLines += total;

        output.push(`SF:${source}`);
        for (const line of [...record.hits.keys()].sort((a, b) => a - b)) {
            output.push(`DA:${line},${record.hits.get(line)! > 0 ? 1 : 0}`);
        }
        output.push(`LF:${total}`, `LH:${covered}`, 'end_of_record');
    }

    mkdirSync(dirname(MERGED_LCOV), { recursive: true });
    writeFileSync(MERGED_LCOV, output.join('\n') + '\n');

    console.log(`[coverage] Gộp ${infoFiles.length} báo cáo lcov (${merged.size} file nguồn).`);
    console.log('[coverage] 10 file phủ thấp nhất:');
    for (const row of [...rows].sort((a, b) => a.covered / a.total - b.covered / b.total).slice(0, 10)) {
        console.log(`  ${percentage(row.covered, row.total).padStart(6)}%  ${row.source}`);
    }
    console.log(`[coverage] Đã ghi báo cáo gộp: coverage/lcov.info`);

    const overall = percentage(totalCovered, totalLines);
    console.log(`[coverage] TỔNG: ${overall}% dòng (${totalCovered}/${totalLines})`);

    if (threshold !== undefined && Number.isFinite(threshold)) {
        console.log(`[coverage] Cổng chất lượng: dòng ≥ ${threshold}%`);
        if (Number(overall) < threshold) {
            console.error(`[coverage] KHÔNG ĐẠT: ${overall}% < ${threshold}%.`);
            return 1;
        }
    }
    return 0;
}

process.exit(main());
