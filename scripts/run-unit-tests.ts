/**
 * Chạy bộ test đơn vị theo nhóm, để CI không phải "đốt" 15–30 phút cho mỗi PR.
 *
 *   fast  — mọi test KHÔNG mở trình duyệt thật và không render pipeline thật.
 *           Dùng cho mọi PR vào main/dev (phản hồi nhanh).
 *   heavy — các test mở Chromium, ghép video bằng ffmpeg hoặc chạy trọn pipeline
 *           nhiều lần. Dùng cho lịch chạy đêm, chạy thủ công, hoặc PR đụng vào
 *           pipeline/queue/renderer.
 *
 * File mới thêm mặc định rơi vào nhóm `fast`; muốn xếp vào `heavy` thì khai báo
 * thêm ở HEAVY kèm lý do.
 */
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/** Các file chỉ chạy ở nhóm heavy (kèm thời lượng đo trên máy phát triển). */
const HEAVY = new Set([
    "orchestrator.test.ts", // ~190s — chạy runFullPipeline nhiều lần
    "security.test.ts", // ~78s — 20 request + 10 job qua pipeline thật
    "spec_c_oracle_qa.test.ts", // ~20s — runFullPipeline + Oracle QA
    "queue.test.ts", // ~15s — pipeline thật qua API (Playwright + ffmpeg)
    "api.test.ts", // ~9s — các endpoint pipeline
    "preview.test.ts", // ~6s — launchPreviewBrowser (Chromium)
    "spec_g_karaoke_vertical.test.ts", // ~5s — Chromium
    "spec_h_font_subset.test.ts", // ~5s — Chromium + pyftsubset
    "spec_d_shutter_blur.test.ts", // ~3s — Chromium + renderVideo
]);

const group = process.argv[2];
if (group !== "fast" && group !== "heavy") {
    console.error("Cách dùng: tsx scripts/run-unit-tests.ts <fast|heavy>");
    process.exit(2);
}

const unitDir = join(dirname(fileURLToPath(import.meta.url)), "..", "tests", "unit");
const all = readdirSync(unitDir)
    .filter((name) => name.endsWith(".test.ts"))
    .sort();

const selected = all.filter((name) => (group === "heavy" ? HEAVY.has(name) : !HEAVY.has(name)));

if (selected.length === 0) {
    console.error(`[unit-tests] Không tìm thấy file test nào cho nhóm "${group}".`);
    process.exit(1);
}

console.log(`[unit-tests] nhóm ${group}: ${selected.length}/${all.length} file`);

const args = ["--test", ...selected.map((name) => join("tests", "unit", name))];
const result = spawnSync("npx", ["tsx", ...args], { stdio: "inherit", shell: process.platform === "win32" });

if (result.error) {
    console.error(`[unit-tests] Không chạy được bộ test: ${result.error.message}`);
    process.exit(1);
}
process.exit(result.status ?? 1);
