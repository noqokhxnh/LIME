# Issue #106: GET /api/jobs 500 vì job BullMQ legacy thiếu `request`

## 1. Vấn đề

Người dùng báo "chạy tạo video thử mà không được". Điều tra log `lime_server` cho thấy mỗi lần UI poll danh sách job:

```
GET /api/jobs → 500 "Cannot read properties of undefined (reading 'prompt')"
    tại src/index.ts:785  (topic: j.request.prompt)
```

Nguyên nhân: trong Redis còn tồn lại nhiều job BullMQ **legacy** (job test cũ của trang admin, job chỉ chứa `{script:...}`, job chỉ chứa `{enableStoryboard, skipPreview, ...}`) mà trường `data.request` không tồn tại. `bullQueue.getJobs()` map thẳng `request: job.data.request` ⇒ record có `request === undefined`, và route `/api/jobs` lại đọc `j.request.prompt` không phòng thủ ⇒ **mọi lượt liệt kê job của UI chết vĩnh viễn** cho tới khi job hỏng bị xoá. Endpoint `/api/admin/*` đã dùng optional chaining nên chỉ đúng route `/api/jobs` này là crash.

Do danh sách job ở workspace dashboard & bảng tiến độ đều poll `/api/jobs`, trải nghiệm người dùng là "bấm tạo video xong không thấy gì" dù clarify (POST `/api/script/clarify`) vẫn chạy bình thường.

## 2. Tài liệu liên quan

- `src/index.ts` — route `GET /api/jobs` (điểm crash duy nhất, dòng ~785).
- `src/queue/interfaces.ts` — `JobRecord` (trước đây khai báo `request: videoRequest` bắt buộc — sai so với thực tế dữ liệu Redis).
- `src/queue/bullQueue.ts` / `src/queue/memoryQueue.ts` —`getJobs()`, `requeueJob()`, `updateJob()` đọc/ghi `record.request`.
- `src/admin/analytics.ts` — `AnalyticsJob.request` đã optional sẵn (chứng minh kiểu chuẩn xác là optional).
- Redis: key `bull:video-generation:*` — nhiều job failed thiếu `request`.

## 3. Thiết kế

Nguyên tắc: **defensive ở lớp đọc, không xoá dữ liệu của user**.

1. `JobRecord.request` chuyển thành optional (`request?: videoRequest`) kèm comment giải thích job legacy; bổ sung `topic?: string` cho job admin cũ.
2. `GET /api/jobs` (src/index.ts): `topic: j.request?.prompt ?? j.topic ?? '(job cũ thiếu thông tin yêu cầu)'` — job hỏng hiển thị nguyên văn thay vì làm sập cả danh sách.
3. `memoryQueue.requeueJob()`: từ chối chạy lại job không có `request` (`if (!record.request) return false;`) — job hỏng đi vào handler chắc chắn crash ở `inferAnswers(request.prompt)`.
4. `memoryQueue.updateJob()`: guard `record.request` khi patch `targetDurationSec` và khi đồng bộ `data.request`.
5. Các endpoint admin (`routes.ts`, `analytics.ts`) kiểm tra lại — đã optional chaining sẵn, không cần sửa.

Không mutate dữ liệu Redis, không đụng nhánh worker.

## 4. Kế hoạch test

- **Kiểu thật**: reproduce bằng curl trước fix (`500`), sau fix (`200` + job hỏng hiện topic dự phòng) — đã thực hiện trên server Docker đang chạy (bind mount, tsx watch tự reload).
- Unit hiện hữu: `tests/unit/api.test.ts`, `tests/unit/admin_jobs.test.ts`, `tests/unit/queue.test.ts` — pass nguyên bộ.
- Typecheck `tsc --noEmit` — bắt được mọi chỗ gán `record.request` (undefined) vào `JobData.request` bắt buộc, trả về đúng 2 điểm `memoryQueue` đã guard.
- Toàn bộ `npm run test:unit` — 728/728 pass.

## 5. Tiêu chí nghiệm thu

- [x] `GET /api/jobs` trả 200 kể cả khi queue chứa job thiếu `request`.
- [x] Job hỏng hiển thị topic dự phòng rõ ràng (không white-screen, không 500).
- [x] Không cho phép chạy lại job thiếu `request` (guard ở queue layer).
- [x] `tsc --noEmit` sạch; `npm run test:unit` 728/728 pass.
- [x] Fix có hiệu lực ngay trên server Docker đang chạy mà không cần rebuild image (bind-mount + tsx watch).
