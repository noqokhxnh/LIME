# Issue #108: Timeout lượt gọi LLM — upstream treo/chậm làm UI spin vĩnh viễn

## 1. Vấn đề

Report thực tế: user bấm sinh 3 phương án ở workspace — UI đứng ở "Đang viết 3 phương án khác nhau…", log server cho thấy `POST /api/script/draft` **treo >4 phút không response** (không có dòng res). Nguyên nhân chuỗi:

- Route draft chạy song song 3 × `generateScript`, mỗi lượt gồm 1 lượt `pickStyleSlug` + 1 lượt sinh kịch bản.
- Board 9router xác nhận 3 lượt pick (dạng `~1.5k↑ / vài↓`) xong nhanh, nhưng **3 lượt sinh kịch bản khôngtoken nào về** — upstream (gemini-3.8 qua 9router) treo hoặc chậm cực (probe: output 6KB mất ~31s; kịch bản thật 50–150KB).
- **Không một chỗ nào trong code đặt timeout/abort cho lượt gọi LLM** — `generateScript` gọi `llm.generate()` không signal, route không có deadline ⇒ treo vô hạn, admin jobs cũng trống (draft không tạo job — đúng thiết kế nhưng càng không có dấu vết để quan sát).

## 2. Tài liệu liên quan

- `src/pipeline/scriptGenerator.ts` — `pickStyleSlug()` (line ~183), `generateScript()` vòng retry 3 attempts.
- `src/pipeline/clarify.ts` — `inferAnswers()` đã nhận `signal?` nhưng caller không truyền.
- `src/llm/client.ts` — `LLMClient.generate(system, user, signal?)` có sẵn installed slot signal — chưa ai dùng.
- `docs/issues/105-wire-opuscar-styles-into-llm.md` — nguyên tắc mọi lỗi phụ về null, không hỏng job.
- `docs/issues/107-url-source-fetch.md` (GitHub #105) — xu hướng observability: draft chạy lâu mà không có job/trace.

## 3. Thiết kế

Nguyên tắc: **mỗi lượt gọi LLM đều có bến thời gian; timeout không retry, báo lỗi ngay**.

1. Hằng số `STYLE_PICK_TIMEOUT_MS = 45s` (output vài token), `SCRIPT_GENERATE_TIMEOUT_MS = 420s` (output 50–150KB trên upstream chậm cần dư).
2. Helper `llmGenerateWithTimeout(llm, sys, user, ms)` — bọc `AbortSignal.timeout(ms)`: fetch thật tự hủy kết nối (không giữ socket treo); `TimeoutError/AbortError` quy về `LLMTimedOutError` dễ phân biệt lỗi mạng thường.
3. `generateScript` nhận `opts?: { scriptTimeoutMs?, pickTimeoutMs? }` (để test inject giá trị nhỏ); vòng retry **ném LLMTimedOutError ngay thay vì retry 3 lần** — upstream vẫn chậm thì retry chỉ đốt ~20 phút; caller tự quyết định (route draft báo lỗi người dùng, orchestrator đánh job failed).
4. `inferAnswers` — caller không truyền signal thì tự `AbortSignal.timeout(180s)`; lỗi về fallback heuristic như cũ (đã graceful sẵn).
5. `pickStyleSlug` — timeout 45s; hết bến → null, pipeline chạy tiếp không style layer (giữ nguyên tắc #105).

## 4. Kế hoạch test

- `tests/unit/llm_call_timeout.test.ts` (nhóm FAST, offline):
  - Hằng số hợp lý: pick < script, pick ≤ 60s, script ≥ 300s.
  - LLM giả treo chỉ reject khi signal abort: pick hết 50ms → null, đúng 1 lượt gọi.
  - `generateScript` timeout 30/40ms → ném `LLMTimedOutError`, **đúng 2 lượt LLM** (pick + script), không đốt attempt nào.
- Regression: `npm run test:unit` nguyên bộ + `tsc --noEmit` sạch — không đụng lá cờ test cũ (stub LLM trả ngay nên không chạm timeout).

## 5. Tiêu chí nghiệm thu

- [x] Không lượt gọi LLM nào có thể treo vĩnh viễn: pick 45s, script 420s, classify 180s.
- [x] Timeout KHÔNG được retry — fail ngay để route/pipeline phản hồi người dùng thay vì spin.
- [x] `pickStyleSlug` hết bến → null (vẫn đúng triết lý #105), job không hỏng.
- [x] Unit test FAST offline 3/3 + nguyên bộ 731+ pass; `tsc --noEmit` sạch.
- [x] Có ghi chú cải tiến tiếp theo: draft nên tạo "job preview" vào queue/admin để quan sát/hủy khỏi admin (liên hệ #107/GitHub #105).
