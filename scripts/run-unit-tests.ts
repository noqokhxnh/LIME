/**
 * Chạy bộ test đơn vị theo nhóm, để CI không phải "đốt" hàng chục phút cho mỗi PR.
 *
 *   fast        — mọi test KHÔNG mở trình duyệt thật và không render pipeline thật.
 *                 Dùng cho mọi PR/push vào main|dev (phản hồi ~1 phút trên CI).
 *   heavy       — các test mở Chromium, ghép video bằng ffmpeg hoặc chạy trọn
 *                 pipeline nhiều lần (chạy hết, tuần tự như node quyết định).
 *   heavy:N     — chỉ chạy "lát" thứ N của nhóm heavy, để CI chia thành nhiều job
 *                 song song (mỗi job một runner) thay vì một job dài lê thê.
 *
 * File test mới thêm mặc định rơi vào nhóm `fast`; muốn xếp vào `heavy` thì khai
 * báo thêm ở HEAVY_SHARDS kèm lý do.
 */
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Nhóm heavy chia thành các lát chạy song song. Chia theo thời lượng đo trên máy
 * phát triển để các lát cân nhau (orchestrator.test.ts một mình đã ~190s, gần bằng
 * tổng các file còn lại).
 */
const HEAVY_SHARDS: string[][] = [
    // Lát 1 — nặng nhất, gần như quyết định thời gian chạy.
    ["orchestrator.test.ts"],
    // Lát 2 — gọi pipeline thật qua HTTP/API.
    ["security.test.ts", "api.test.ts", "queue.test.ts", "spec_d_shutter_blur.test.ts"],
    // Lát 3 — mở Chromium/pyftsubset và Oracle QA.
    [
        "spec_c_oracle_qa.test.ts",
        "preview.test.ts",
        "spec_g_karaoke_vertical.test.ts",
        "spec_h_font_subset.test.ts",
    ],
];

/** Tập hợp mọi file thuộc nhóm heavy (để nhóm fast biết cần loại trừ). */
const HEAVY = new Set(HEAVY_SHARDS.flat());

const group = process.argv[2] ?? "";
const shardMatch = /^heavy:(\d+)$/.exec(group);

if (group !== "fast" && group !== "heavy" && !shardMatch) {
    console.error("Cách dùng: tsx scripts/run-unit-tests.ts <fast|heavy|heavy:N>");
    process.exit(2);
}

const unitDir = join(dirname(fileURLToPath(import.meta.url)), "..", "tests", "unit");
const all = readdirSync(unitDir)
    .filter((name) => name.endsWith(".test.ts"))
    .sort();

// Chốt an toàn: mọi file khai báo trong HEAVY_SHARDS phải thật sự tồn tại.
const missing = [...HEAVY].filter((name) => !all.includes(name));
if (missing.length > 0) {
    console.error(`[unit-tests] File khai báo trong HEAVY_SHARDS không tồn tại: ${missing.join(", ")}`);
    process.exit(1);
}

let selected: string[];
let label = group;

if (group === "fast") {
    selected = all.filter((name) => !HEAVY.has(name));
} else if (group === "heavy") {
    selected = all.filter((name) => HEAVY.has(name));
} else {
    const shardNumber = Number(shardMatch![1]);
    const shard = HEAVY_SHARDS[shardNumber - 1];
    if (!shard) {
        console.error(`[unit-tests] Không có lát heavy số ${shardNumber} (chỉ có 1..${HEAVY_SHARDS.length}).`);
        process.exit(2);
    }
    selected = all.filter((name) => shard.includes(name));
    label = `heavy:${shardNumber}/${HEAVY_SHARDS.length}`;
}

if (selected.length === 0) {
    console.error(`[unit-tests] Không tìm thấy file test nào cho nhóm "${group}".`);
    process.exit(1);
}

console.log(`[unit-tests] nhóm ${label}: ${selected.length} file — ${selected.join(", ")}`);

const args = ["--test", ...selected.map((name) => join("tests", "unit", name))];
const result = spawnSync("npx", ["tsx", ...args], { stdio: "inherit", shell: process.platform === "win32" });

if (result.error) {
    console.error(`[unit-tests] Không chạy được bộ test: ${result.error.message}`);
    process.exit(1);
}
process.exit(result.status ?? 1);
