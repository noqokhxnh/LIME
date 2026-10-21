# Issue #107: Fetch nội dung URL trong brief làm nguồn tham khảo cho pipeline

## 1. Vấn đề

Hiện tại pipeline **không có bất kỳ bước nào truy cập ra web** — giao diện `LLMClient.generate(systemPrompt, userPrompt)` là text-in/text-out một lượt, không có native tool calling (rà soát `src/llm/client.ts`: cả 5 provider đều gửi đúng 1 cặp message, không trường `tools`, không xử lý `tool_use`). Khi user dán một URL vào brief:

- URL chỉ đi vào prompt như **chuỗi ký tự chết** — không ai `fetch` nó.
- LLM chỉ đoán nội dung trang qua *tên miền + path* (URL "mạnh về chữ" thì output trông ổn, path tối nghĩa thì bị bỏ qua), mọi số liệu/trích dẫn trong kịch bản **gần như chắc chắn là chế** (hallucination) — chưa từng đọc byte nào từ trang web.
- Oracle QA (`src/pipeline/oracleQa.ts`) chỉ rà logic kịch bản, không có nguồn để đối chiếu nên không phát hiện sai.

Cần cơ chế **RAG kiểu nhà trường học — LLM làm đầu óc, ứng dụng làm chân tay**: server tự fetch URL, trích text, nhét vào ngữ cảnh prompt. LLM không cần biết gọi công cụ, interface `generate()` giữ nguyên.

## 2. Tài liệu liên quan

- `src/llm/client.ts` — interface `LLMClient.generate()` (giữ nguyên, không nâng cấp agent loop).
- `src/pipeline/orchestrator.ts` — `runPipelineToResult`: chỗ gọi `inferAnswers` và `generateScript`, nơi chèn bước fetch + truyền `sourceContext`.
- `src/pipeline/scriptGenerator.ts` — `buildUserPrompt()` (khối `Topic/Prompt`): chèn section nguồn tham khảo.
- `src/pipeline/clarify.ts` — `inferAnswers()`, `buildAnswerDirectives()`: câu hỏi clarify cần biết chủ đề thật của trang để hỏi đúng thay vì đoán theo tên miền.
- `src/pipeline/oracleQa.ts` — `runOracleQa`, `QAReport`: thêm check đối chiếu nguồn (nếu có).
- `src/queue/interfaces.ts` — `JobRecord.request?: videoRequest` (issue #106): schema request thêm trường nguồn.
- `docs/issues/106-jobs-list-500-legacy-job-request.md` — bài học: mọi dữ liệu phụ phải graceful, không throw làm hỏng job.

## 3. Thiết kế

### 3.1. Bước fetch mới trước clarify

Module mới `src/pipeline/urlContext.ts` với `fetchUrlContext(prompt)`, chạy một lần đầu pipeline:

1. **Phát hiện**: regex tìm tối đa 3 URL `http(s)://` đầu brief (vượt 3 URL thì bỏ qua phần dư, không fail).
2. **Fetch tuần tự** mỗi URL, timeout 10s (`AbortSignal.timeout`), `redirect: follow`, `User-Agent` chuẩn; `Accept` cả HTML lẫn text.
3. **Trích text**: strip `<script>`/`<style>`/`<nav>`/`<header>`/`<footer>`/comment trước, rồi decode HTML entity → gộp whitespace. Chỉ dùng regex nội bộ — **không thêm dependency** (`cheerio` không cần cho mục đích này).
4. **Giới hạn**: 20 000 ký tự/URL, tổng 45 000 ký tự (kế thừa pattern cắt gọn sẵn có của prompt). Charset đọc từ header `content-type`, fallback UTF-8; lỗi decode chỉ bỏ trang lỗi đó.
5. **Graceful tuyệt đối**: mạng lỗi / 4xx / 5xx / content-type binary / text rỗng → bỏ URL đó, trả `null` — **không throw, không hỏng job** (nguyên tắc giống `pickStyleSlug` của issue #105: mọi lỗi về null).

### 3.2. Inject vào prompts

- **Clarify**: section `REFERENCE SOURCE — nội dung thật của trang user đưa` (kèm 1 dòng metadata: URL + trạng thái đọc được/hỏng) vào user prompt của `inferAnswers` để câu hỏi hỏi đúng chủ đề trang.
- **Script**: `buildUserPrompt` chèn cùng section, truyền từ orchestrator qua `effectiveRequest` (giống cách wiring style của #105 — **không mutate** `request` đầu vào).
- Kèm hướng dẫn cho LLM: *"Chỉ dùng số liệu/chi tiết có trong REFERENCE SOURCE hoặc kiến thức chung; không 'trích' thông tin không có trong nguồn."*

### 3.3. Schema & QA

- `videoRequestSchema` (src/llm/schema.ts): thêm `sourceUrls?: string[]` — server điền từ bước phát hiện để job record lại nguồn đã dùng (optional, job cũ không dính — kế thừa bài học #106).
- Oracle QA: khi có `sourceContext`, thêm kiểm tra warn nhẹ nếu kịch bản chứa con số phần trăm / mốc thời gian mà nguồn không chứa ký tự số tương ứng — chỉ `warn` không `fail` (tránh false-positive chặn job).

## 4. Kế hoạch test

- Unit offline (`tests/unit/url_context.test.ts`, đăng ký nhóm FAST như #105): fetch giả qua injection (thêm `setUrlFetcher`, pattern giống `setLLMClient`) cho các case:
  - HTML đầy đủ → trích đúng text, đã strip script/style/nav.
  - Trang lỗi / timeout mạng / text rỗng / content-type binary → `null`, không throw.
  - Giới hạn 20k/45k ký tự cắt đúng.
  - Không có URL trong brief → bước bỏ qua hoàn toàn (fetch 0 lần).
- `tests/unit/llm.test.ts`: khi có source context, prompt clarify/script sinh ra phải chứa section `REFERENCE SOURCE`; không có context thì prompt giữ nguyên như baseline cũ.
- `tests/unit/api.test.ts` / validation: `sourceUrls` optional không chặn request cũ.
- Regression: `npm run test:unit` nguyên bộ xanh từng commit, `tsc --noEmit` sạch.

## 5. Tiêu chí nghiệm thu

- [ ] Brief chứa URL → nội dung text thật của trang (đã strip chrome) xuất hiện trong prompt clarify + script; không có URL → pipeline hoạt động như cũ.
- [ ] Mọi lỗi fetch (mạng, 4xx/5xx, trang rỗng, binary) về `null`, không hỏng job, không tăng thêm lượt gọi LLM.
- [ ] Không thêm dependency mới; interface `LLMClient.generate()` không đổi.
- [ ] `sourceUrls` được ghi vào job record để audit được nguồn nào đã dùng cho job nào.
- [ ] Unit test nhóm FAST + regression toàn bộ pass.
