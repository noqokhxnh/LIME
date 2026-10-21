# Issue #35 — Chunk Parallel Rendering (PR #57)

## 1. Vấn đề

`src/pipeline/renderer.ts` hiện tại chụp từng frame tuần tự từ 0 đến N trên một instance
Playwright duy nhất. Với video 1–2 phút (1800–3600 frames), thời gian render chiếm phần lớn
pipeline. PR #57 (duytrancoder, mở từ 2026-10-12, chưa review) triển khai chunked parallel
rendering kế thừa từ Remotion: chia timeline thành N chunk, render song song trên nhiều
Chromium page, ghép bằng FFmpeg concat demuxer (`-c copy`, không re-encode).

Thách thức khi merge vào `dev` (2026-10-17):
- PR #57 base trên `main` cũ; `dev` đã có Spec D (shutter blur với sub-frame sampling
  trong renderer.ts), Spec B (deterministic contract), Spec C (oracle QA).
- renderer.ts của dev khác nhiều so với bản PR #57 viết trên → cần rebase + resolve
  conflict cẩn thận, giữ được cả shutter blur và chunking.

## 2. Tài liệu liên quan

- Issue #35: [Render] Multi-Process Chunk Parallel Rendering with FFmpeg Concat Demuxer
- PR #57: `feature/chunked-parallel-rendering` → `main` (11 files, +6288/−1014 theo GitHub)
- Remotion renderer: https://github.com/remotion-dev/remotion/tree/main/packages/renderer
  (MIT) — kiến trúc chunk + concat demuxer mà PR #57 kế thừa.
- FFmpeg concat demuxer: https://ffmpeg.org/ffmpeg-formats.html#concat
  (`-f concat -safe 0 -i list.txt -c copy`).
- Liên quan: Issue #40 (CDP BeginFrame — tối ưu sâu hơn sau khi có chunking),
  Issue #38 (CDP determinism guards).

## 3. Thiết kế

1. Review PR #57: đọc diff renderer.ts, kiểm tra tính đúng đắn của chunk division,
   worker pool, concat, AbortSignal handling, và test đi kèm.
2. Rebase lên `dev`: `git rebase origin/dev` trên nhánh PR (hoặc cherry-pick),
   resolve conflict trong renderer.ts — ưu tiên giữ logic shutter blur (Spec D)
   và deterministic seek (Spec B).
3. Đảm bảo chunk boundaries không phá vỡ tính deterministic: mỗi chunk seek độc lập
   qua `window.__seekTo(t)` (pure function of t) nên việc chia chunk an toàn.
4. Chạy `npx tsc --noEmit` + unit tests của PR + integration test pipeline.
5. Merge vào `dev` (không PR vào main).

## 4. Kế hoạch test

- Unit: `tests/unit/chunkRenderer.test.ts`, `tests/unit/config.test.ts` (từ PR).
- Integration: `tests/integration/parallelRenderer.test.ts` (từ PR).
- Runtime: tạo video 10s qua `/api/generate`, verify mp4 có đủ frames, không drop
  frame tại điểm nối chunk (check bằng ffprobe frame count), duration khớp.

## 5. Tiêu chí nghiệm thu

- [ ] PR #57 được review, không còn blocker.
- [ ] Merge vào `dev` thành công, `tsc` sạch, tests xanh.
- [ ] Video render ra đầy đủ frames, liền mạch tại điểm nối chunk.
- [ ] Thời gian render cải thiện so với single-worker (kỳ vọng 2–3x trên máy đa nhân).
- [ ] AbortSignal hủy job vẫn dừng sạch các chunk workers.
