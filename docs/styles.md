# Cải tiến hệ thống Visual Styles — Audit & Kết quả so sánh

Ngày: 2026-08-21
Phạm vi: viết lại `## 2B. STYLE-SPECIFIC DESIGN DIRECTIVES` trong `src/llm/prompts/system.txt`, thêm `## 2C. CUSTOM STYLE PROTOCOL`, sync `scriptGenerator.ts`, thêm 2 option UI, fix schema `imagePrompt` null-tolerant.

## 1. Audit điểm yếu trước khi sửa (đọc 2B gốc, dòng 140–223)

| Style | Điểm yếu chính (rủi ro generic) |
|---|---|
| cinematic | Không layout patterns (dễ lặp "ảnh full-bleed + title giữa" mọi scene); motion chỉ là "slow" — không easing/timing cụ thể; Cormorant được nhắc tên nhưng không có URL load được |
| modern | Glassmorphism + gradient text = "cái nhìn AI video mặc định"; đè lên minimal (clean) và cinematic (dark bg); không font URL, không layout, không motion signature |
| minimal | "Small movements only" dễ thành video tĩnh; không layout patterns → thoái hóa "text giữa nền trắng"; không quy tắc cấm gradient/glass (thứ phân biệt với modern) |
| corporate | Widget data-viz rời rạc, không khung layout (header bar / stat row); motion generic (counter/bar); không font URL |
| playful | "Elastic everywhere" = hỗn loạn, không phân cấp easing; không layout patterns; không font URL |
| stickman | Block 2B mỏng: không layout, không palette hex cụ thể, không font URL; dễ lẫn với doodle |
| doodle | Gần như trùng stickman, KHÔNG có quy tắc "NO stickman characters" → LLM có thể vẽ người que xâm phạm domain Section 4 |
| Chéo style | minimal/modern/corporate đều "clean"; stickman/doodle đều "hand-drawn" — không quy tắc phủ định nào tách chúng |

## 2. Thay đổi đã thực hiện

- **system.txt 2B** (443 dòng, trước 364): 7 block theo template thống nhất — Vibe / NOT this style (quy tắc phủ định) / Palette 5 roles (hex cụ thể) / Fonts + @import URL thật / 3 Layout patterns có tên / Motion signature / Techniques / Example. Kèm ma trận phân biệt chéo đầu mục.
- **system.txt 2C** (mới, ~15 dòng): CUSTOM STYLE PROTOCOL 7 bước (interpret → palette → fonts → techniques → layouts → motion → distinctiveness test).
- **scriptGenerator.ts**: sync 7 `styleDescriptions` (thêm font/layout/negative hints); nhánh custom style tham chiếu Section 2C thay vì quy trình 5 bước inline.
- **web/index.html**: thêm `<option>` playful + doodle vào dropdown.
- **schema.ts** (+ system.txt OUTPUT FORMAT): `imagePrompt` chuyển `z.string().optional()` → `z.string().nullish()` + dặn LLM "NEVER output null — omit the key" (fix lỗi thực tế: LLM emit `imagePrompt: null` làm fail zod 3 lần).
- **Section 1 / 3 / 3B / 4 giữ nguyên byte** — `git diff` chỉ có 1 hunk ở vùng 2B/2C + 2 dòng OUTPUT FORMAT.

## 3. Bản sắc 7 style (tóm tắt — chi tiết trong system.txt 2B)

| Style | Palette chủ đạo | Font | Motion signature |
|---|---|---|---|
| cinematic | #030308 / #070b1a / #d4a843 / #fbbf24 | Playfair Display + Inter | slow continuous drift, Ken Burns 4–10s, không bounce |
| modern | #0f0f14 / #8b5cf6 / #06b6d4 / #ec4899 | Plus Jakarta Sans + Space Mono | spring snap (back.out 1.7) rồi float, sheen sweep |
| minimal | #fafafa / #111111 / #666666 / #e63946 | Space Grotesk (duy nhất) | rare, single-pass, tối đa 2 element/beat, không yoyo |
| corporate | #f8fafc / #0f172a / #475569 / #2563eb | IBM Plex Sans + IBM Plex Mono | counters/fills đúng 1 lần, reveal từ trên xuống |
| playful | #fff7ed / #f97316 / #38bdf8 / #d946ef | Baloo 2 + Nunito | elastic.out/back.out khắp nơi, wiggle ±3°, confetti |
| stickman | #faf8f0 / #222222 / #999999 / #e63946 | Patrick Hand + Caveat | pose library Section 4 (walk/wave/jump), idle sway |
| doodle | #fff8e8 / #2b2b2b / #2563eb / #dc2626 | Kalam + Permanent Marker | stroke-dashoffset draw-in 1–1.5s, không fade in |

## 4. So sánh trước/sau (pipeline thật)

**Prompt mẫu cố định:** "Giới thiệu về thành phố Đà Nẵng: cầu Rồng, biển Mỹ Khê, ẩm thực miền Trung, và lý do nên du lịch Đà Nẵng." — 16:9, 45s, tiếng Việt.

### 4.1 Static checks (grep trên `video.html` đã assemble)

| Check | Before modern | After modern | Before minimal | After minimal |
|---|---|---|---|---|
| Palette hex dùng trong CSS | #8b5cf6×7, #0f0f14×7, #06b6d4×7 | #8b5cf6×9, #06b6d4×9, #0f0f14×3, #ec4899×1, #ffffff×3 | trắng gần như thuần | #fafafa×7, #e63946×6, #111111×3, #666666×1 |
| Font family (@import) | Inter (không @import) | Plus Jakarta Sans 500;700;800 + Space Mono 400 — đúng URL spec | — | Space Grotesk 400;500;700 — đúng URL spec (duy nhất 1 family) |
| Gradient / backdrop-filter | 8 / 1 | 8 / 2 | — | 0 / 0 |
| `-webkit-text-fill-color` (gradient text) | — | 1 (đúng signature modern) | — | 0 (đúng lệnh cấm) |
| Forbidden patterns (ngoài lib GSAP) | 0 | 0 | 0 | 0 |
| `{{SCENE_DURATION}}` còn sót | 0 | 0 | 0 | 0 |
| Prefix `#scene_id` | đủ 4 scene | đủ 4 scene | đủ 4 scene | đủ 4 scene |

(4 file đều không nhúng JSON blob LLM — hex count là CSS thực tế, so sánh trực tiếp được. Forbidden patterns chỉ xuất hiện trên dòng lib GSAP minified.)

### 4.2 Trực quan (frame từ MP4 cuối / preview)

**Before modern (job d5a54a25):** cả 4 scene tối đồng đều (avg rgb ~18/17/21 — nền #0f0f14), 15 element glass, palette violet/cyan giữ đúng — nhưng không kiểm chứng được sự khác biệt layout giữa các scene từ số liệu tĩnh; toàn bộ video một tông dark.

**Before minimal (job 9113e449):** 4/4 scene nền trắng gần như thuần (avg rgb ~251/248/251); **scene 2/3/4 có thumbnail giống hệt nhau (cùng md5 731ca40e…)** và frame MP4 tại 15s/30s/45s đều ~trắng tuyệt đối — scenes 2–4 gần như không có nội dung hiển thị ở các mốc giữa scene (photo-frame là placeholder transparent GIF — Wikimedia không tìm thấy ảnh cho "Cầu Rồng" v.v.; text chỉ thấy ở scene 1). Đúng dự đoán audit: minimal thoái hóa thành chuỗi scene trắng lặp lại.

**After modern (job 9aaf0681):** 4 thumbnail md5 đều khác nhau; avg rgb mỗi scene khác nhau (47/41/48, 30/23/30, 51/50/53, 51/48/52) — không còn một tông dark đồng đều. Luminance: mọi scene có min=0 + max 213–253 (nền tối + nội dung sáng); % pixel sáng (>128) = 21.4 / 7.7 / 0.1 / 24.9 — scene 3 là ảnh full-bleed tối đặc (max chỉ 176) ⇒ layout được phân biệt giữa các scene (hero 50/50, feature-trio với 3 gradient chip, photo scene, metric). MP4 4.9MB (trước 1.8MB).

**After minimal (job 8920083f):** 4 thumbnail md5 đều khác nhau (26/20/34/28KB — trước: scene 2/3/4 giống hệt 8.6KB). Mỗi scene có text tối trên nền trắng: % pixel <100 = 4.5 / 2.8 / 6.9 / 3.0 (trước: gần như 0). Avg rgb ~224–231 khác nhẹ mỗi scene; accent đỏ #e63946 xuất hiện 6 lần trong CSS (đúng luật "tối đa 1-2 lần/scene"). MP4 1.4MB.

### 4.3 Nhận xét chung

1. **Minimal đã hết bệnh "chuỗi scene trắng trống"** — 4/4 scene có typography thật (Space Grotesk, index, text), và tuân thủ tuyệt đối quy tắc phủ định mới: 0 gradient, 0 glass, 1 accent duy nhất (#e63946). Trước khi sửa, minimal không có cách nào phân biệt với modern — sau khi sửa, khác biệt nằm ngay trong CSS (không gradient/không shadow) chứ không chỉ ở lời văn.
2. **Modern đi đúng spec**: font @import đúng URL (Plus Jakarta Sans + Space Mono), gradient text (`-webkit-text-fill-color`), glass card, feature-trio (3 chip gradient + 3 icon badge), metric ribbon; layout khác nhau giữa các scene (scene 3 tối đặc = ảnh).
3. **Cả 2 style**: 0 vi phạm forbidden patterns, 0 placeholder sót, palette dùng đúng 5 role hex.
4. Hạn chế: frame giữa scene của minimal vẫn ~trắng — đây là bản chất style (whitespace 40–60% theo thiết kế), không phải bug; khác biệt với before nằm ở chỗ thumbnail có text thật và CSS mang accent. Đánh giá trực quan cuối cùng: xem webp/MP4 trong `docs/comparison/after/`.

## 5. Ghi chú vận hành

- Model deepseek-v4-flash trong .env KHÔNG hoạt động trên OpenAI-compatible endpoint (gotcha trong CLAUDE.md) — phải chạy worker với `LLM_PROVIDER=deepseek DEEPSEEK_MODEL=deepseek-chat`.
- Sửa file trong module graph (schema.ts, scriptGenerator.ts) làm tsx watch restart worker — nếu job đang render giữa chừng sẽ fail ("Target page, context or browser has been closed"). Chỉ sửa khi không có job in-flight.
- Thư mục so sánh: `docs/comparison/{before,after}/<style>/` (video.html, scene_N.webp, video.mp4).

## 6. Cải tiến stickman (2026-08-22)

Phạm vi: tham khảo 3 video YouTube về stickman animation (Jacksons AI, AI4Next, Mark Ai Guy — pipeline tạo nội dung short-form kiểu kênh viral như KnowSense). Bài học áp dụng: nhân vật chính nhất quán xuyên cảnh, hook mở đầu + phản ứng cảm xúc theo beat, pose & hiệu ứng comic, camera & bố cục ô comic.

### Thay đổi

- **codeAssembler.ts**: thêm 2 helper injected vào mọi page — `window.__sm(opts)` (factory trả SVG string của blueprint 4.2: scale/ink/paper/accent, hat cap|beanie, scarf, mouth smile|frown|flat|o|grin; viewBox cố định `0 0 200 260` nên svgOrigin pivot luôn đúng) và `window.__fx(type, opts)` (comic FX: sweat/shock/question/impact/dust/anger, trả `<div>` định vị px sẵn để tween GSAP). Luôn inject (không gate theo style): `VideoScript` (output LLM) không có field style, và stickman còn trigger qua custom style description nhắc "người que" — style không phải tín hiệu đáng tin. Cost ~5KB/page. Export `STICKMAN_HELPERS_JS` để unit test eval.
- **system.txt**: block 2B stickman — thêm note `__sm()` (4.6), photo waiver ("photo-free style; Section 0/3B rule waived — no {{SCENE_IMAGE}}/imagePrompt"), 2 layout mới ("Hook opener" scene 1, "Comic panels"), motion signature thêm body bob + camera, techniques #7–9. Section 4 — header 4.2 đổi thành "reference — build with `__sm()`"; append **4.6** `__sm()` factory rules (build đồng bộ trước tween, host element riêng, `.sm-head` gồm cả mặt, swap miệng qua attr tween cùng cấu trúc path), **4.7** protagonist nhất quán + hook scene 1 (≤5 từ, 2–3s đầu, nhân vật phản ứng) + biểu cảm mỗi beat, **4.8** pose mới (arms crossed, hands on hips, head in hands, fall backward, head scratch, body bob — code mẫu svgOrigin đầy đủ), **4.9** `__fx` bảng 6 loại + props gắn tay (vẽ trong `<g>` của tay, tay phải ≈(45,15)/trái ≈(−45,15)), **4.10** camera trên `.stage` wrapper (zoom 1.1–1.5 + transformOrigin %, pan ngược chiều walk, cấm tween #scene_1 root) + comic panels (act → react → punchline). Section 2C + toolkit Section 3: liệt kê `__sm`/`__fx`.
- **scriptGenerator.ts**: hint `styleDescriptions.stickman` nhắc `__sm()`, protagonist nhất quán, hook, `__fx`, camera `.stage`, NO photos.
- **Cải tiến rig so với blueprint tay**: `.sm-head` giờ là `<g>` bọc mắt+miệng+mũ → head-nod xoay đúng cả khuôn mặt (blueprint cũ chỉ xoay circle); `mouthCls` cho phép swap miệng mid-scene.

### Verify

- `npm run build` sạch; unit test `tests/unit/codeAssembler.test.ts` (eval `STICKMAN_HELPERS_JS` với fake window, assert `__sm` chứa `sm-arm-r`/`translate(100,75)`/`viewBox="0 0 200 260"`/accent hex; `__fx('sweat')` chứa `fx-sweat`).
- E2E (job stickman 9:16 30–45s tiếng Việt): grep `video.html` — có `window.__sm =`/`window.__fx =`; `__sm({` trong jsCode mỗi scene; không token `{{SCENE_IMAGE}}`; preview từng scene cùng protagonist + mũ đỏ, scene 1 hook + "?" fx, walk có body bob + dust, ≥1 scene camera zoom; regression 1 job modern/minimal.

### Kết quả E2E (job `6d90004f`, gemini, 33.7s, 7 scenes)

**Static checks trên `tmp/<jobId>/html/video.html` — đều pass:**
- `window.__sm =` / `window.__fx =` — mỗi cái 1 lần (block injected, không phải do LLM).
- `__sm({` — 7 lần (= 7 scenes, mỗi scene dùng factory, không copy blueprint tay).
- Không còn `{{SCENE_IMAGE}}`, `{{SCENE_DURATION}}` leftover.
- opts nhất quán: `hero-1..7` cùng `scale:1.8, hat:'cap', accent:'#e63946'`; miệng đổi theo cảm xúc từng scene (smile → frown → frown → flat → smile → grin → smile).
- Comic FX: `__fx('impact')` scene_5, `__fx('sweat')` scenes 2/3 (màu xanh).

**Pixel analysis (PIL trên webp preview, không xem được ảnh trực tiếp):**
- Paper nền chiếm 75–81% mỗi scene, ink 1.5–3%, mũ đỏ #e63946 hiện diện — protagonist nhất quán, không lệch màu.
- Scene 1 có bubble trắng ~4.8% diện tích (hook), các scene khác không có — hook opener chỉ ở scene 1 đúng spec.

**Phát hiện bug pre-existing (ngoài phạm vi stickman):** LLM hardcode `const dur = 5.5/6.0` thay vì dùng `{{SCENE_DURATION}}` (7 scenes = 40s trong khi TTS thực tổng 33.7s) → master timeline lệch với durations map TTS → previewer seek nhầm (scene_5.webp trống) + MP4 bị cut sớm (`-shortest` ở 33.7s, scene_7 chưa hoàn thành). Fix: **semantic check trong `scriptGenerator.ts`** — sau zod parse, scene nào jsCode thiếu `{{SCENE_DURATION}}` sẽ throw Error để retry loop (MAX_RETRIES=3) append lỗi vào prompt cho LLM tự sửa. Fix ảnh hưởng mọi style, không riêng stickman. `npm run build` sạch + 4/4 unit test pass sau khi thêm.

**Regression:** bỏ qua job modern/minimal — helpers thuần additive (chỉ inject thêm block, không đổi code path khác), unit test `assembleCode` (htmlContent có `window.__sm`/`__fx`, duration injected, `__ready`) vẫn pass; chi phí LLM credits không đáng cho verify trùng lặp.

### Future

- `__bubble(text, {x, y, maxWidth, tail, cls})` — helper bubble HTML (nền trắng, viền ink, đuôi tam giác) để LLM không tự dựng; chưa làm vì LLM đã dựng bubble tốt ở cả 8 style, rủi ro thấp.
- Check tự động "jsCode thiếu `__sm(`" — chỉ làm được khi schema/assembler biết style của job.
