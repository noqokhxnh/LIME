# Issue #105: Wire Opuscar Style Presets vào Pipeline Sinh Script

## 1. Vấn đề

Sau issue #104, 51 style preset opuscar đã được port vào `src/templates/styles/` (loader `listStyles()`, `getStylePrompt(slug)`) nhưng **pipeline chưa hề gọi loader** — toàn bộ file preset nằm chết trong thư viện, LLM sinh script không biết tới sự tồn tại của chúng. Cần "wiring" để:
- LLM tự chọn 1 slug style phù hợp với brief (triết lý đã chốt: AI tự quyết, giống narrationMode/voice casting).
- Nội dung STYLE.md đầy đủ của slug đã chọn được inject vào prompt sinh script để định hình typography, color logic, materials, motion quality và camera grammar của toàn bộ `htmlCode`/`cssCode` các scene.
- User vẫn có quyền ghim sẵn slug (HITL draft review) — ưu tiên cao hơn AI pick.

## 2. Tài liệu liên quan

- `docs/issues/104-opuscar-style-presets.md` — issue gốc port 51 presets + attribution MIT.
- `src/templates/styles/index.ts` — loader: `listStyles()`, `getStylePrompt(slug)`.
- `src/templates/styles/index.json` — 51 entries metadata (`slug`, `name_en`, `category_en`, `uses`).
- `src/pipeline/scriptGenerator.ts` — nơi build user prompt + gọi LLM sinh script.
- `src/llm/schema.ts` — `videoRequestSchema` (đầu vào request) và `videoScriptSchema` (kịch bản đầu ra).
- Repo nguồn: [lemomo-ai/lemo-opuscar](https://github.com/lemomo-ai/lemo-opuscar) (MIT).

## 3. Thiết kế

### 3.1. Luồng chọn style (2 nhánh, 1 lượt gọi LLM rẻ tiền)

```
request.styleSlug (user ghim, HITL)  →  dùng ngay, KHÔNG gọi lượt pick
        │ (không có / không hợp lệ)
        ▼
pickStyleSlug(brief, llm)  — 1 lượt gọi LLM chỉ trả về slug duy nhất
        │ menu metadata gọn: 51 dòng "slug — name_en (category) — uses"
        │ parse mọi token dạng slug trong phản hồi, đối chiếu index.json
        ▼
resolvedStyleSlug: string | null   (null ⇒ chạy pipeline như cũ, không throw)
```

- **pickStyleSlug** dùng system prompt riêng, output chỉ vài token ⇒ chi phí không đáng kể. Chịu được nhiễu phản hồi (`"dark-keynote".`, `slug: dataviz`, câu đầy đủ). LLM lỗi mạng/returns rác ⇒ trả `null` và bỏ qua style layer, tuyệt đối không hỏng job.
- **Không inject nội dung đầy đủ 51 STYLE.md vào prompt** (quá lớn cho context) — chỉ menu metadata; nội dung full chỉ inject cho slug đã chọn.

### 3.2. Inject vào user prompt

`buildUserPrompt` chèn section ngay sau khối STYLE & ART DIRECTION:

```
--- OPUSCAR VISUAL STYLE LAYER (slug: <slug> — <name_en>) ---
<nội dung STYLE.md nguyên văn>
NOTE: ... lớp veneer THỐNG TRỊ ...; JSON schema + ngân sách từ narration không đổi.
```

### 3.3. Trace & HITL

- `videoRequestSchema` thêm `styleSlug: z.string().max(80).optional()` — API request có thể ghim slug.
- `videoScriptSchema` thêm `styleSlug: z.string().optional()` — `generateScript` đóng dấu slug (AI pick hoặc user ghim) vào script đầu ra để UI draft review đọc/đổi.

## 4. Kế hoạch test

Bộ test `tests/unit/style_preset_wiring.test.ts` (đăng ký vào `FAST` trong `scripts/test-groups.ts`), chạy offline với LLM giả (`setLLMClient`):
1. Menu formatter: đủ 51 dòng, mỗi slug có category + use-case.
2. Spec formatter: slug hợp lệ trả spec chứa nguyên văn STYLE.md (`>500` ký tự) + NOTE veneer; slug không hợp lệ trả rỗng (không throw).
3. `pickStyleSlug`: slug sạch, chịu nhiễu (quotes/dấu chấm/câu đầy đủ), slug lạ trả `null`, LLM ném lỗi trả `null` (không throw).
4. `buildUserPrompt`: có `styleSlug` → prompt chứa opuscar layer; không có → prompt giữ nguyên bản cũ.
5. E2E `generateScript` (LLM giả): lượt pick trả `dark-keynote` → prompt gửi LLM thật sự chứa style layer + script đóng dấu `styleSlug`; user ghim `woodcut` → không gọi lượt pick, dùng đúng slug user.

## 5. Tiêu chí nghiệm thu

1. Pipeline sinh script thực dùng thư viện preset: prompt gửi LLM chứa `OPUSCAR VISUAL STYLE LAYER` khi xác định được slug.
2. User ghim `styleSlug` qua API request được tôn trọng (không tốn lượt gọi pick).
3. Mọi đường lỗi (LLM chết, slug sai) không làm pipeline fail — style layer bị bỏ qua một cách có kiểm soát.
4. Script đầu ra có `styleSlug` để trace và HITL draft review.
5. `tests/unit/style_preset_wiring.test.ts` pass 100%, toàn bộ `npm test` xanh, CI dev xanh.
