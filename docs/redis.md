# Redis Architecture & Operations in VidTML

Tài liệu này mô tả chi tiết kiến trúc, cấu hình, cách thức vận hành và chiến lược xử lý sự cố khi tích hợp **Redis** (cùng **BullMQ**) vào hệ sinh thái VidTML (`html-to-vid`).

---

## 1. Tổng quan vai trò của Redis

Trong VidTML, việc sinh video đòi hỏi tài nguyên CPU, RAM rất lớn (gọi LLM, chạy Chromium headless để chụp từng frame, chạy FFmpeg để mux âm thanh và hình ảnh). Redis đóng vai trò là **Distributed Backbone** (xương sống phân tán) với 4 nhiệm vụ cốt lõi:

```
┌─────────────────┐       ┌───────────────────────────────────────┐
│   Web Client    │       │                 Redis                 │
│  (UI / Browser) │       │  ├─ BullMQ: "script-draft"            │
└────────┬────────┘       │  ├─ BullMQ: "video-generation"        │
         │ REST / SSE     │  ├─ Pub/Sub: "job-events:<jobId>"     │
┌────────▼────────┐       │  └─ Flags: "job-cancelled:<jobId>"    │
│   Fastify API   │──────►└──────────────────┬────────────────────┘
│  (src/index.ts) │                          │
└─────────────────┘                          ▼
                                 ┌───────────────────────┐
                                 │   Worker Pool         │
                                 │   (src/worker.ts)     │
                                 │   ├─ draftWorker      │
                                 │   └─ videoWorker      │
                                 └───────────────────────┘
```

1. **Task Queue (Hàng đợi tác vụ - BullMQ):** Tách rời API Server khỏi Worker xử lý nặng. API trả về `jobId` tức thì; Worker kéo job về xử lý tuần tự/song song có kiểm soát.
2. **Real-time Pub/Sub (Truyền tin thời gian thực):** Worker bắn các sự kiện tiến độ (% render, log từng phase) qua kênh Pub/Sub; API Server subscribe và stream xuống client qua SSE (Server-Sent Events).
3. **Cooperative Cancellation (Cơ chế huỷ tác vụ):** Lưu cờ huỷ (`job-cancelled:<jobId>`) có TTL; Worker liên tục kiểm tra để ngắt Chromium/FFmpeg kịp thời khi người dùng bấm Huỷ.
4. **Rate Limiting & Quotas (Kiểm soát hạn mức):** Dùng Redis atomic counters / Lua scripts để giới hạn số job đồng thời per user, số request per minute, tránh quá tải và lạm dụng chi phí LLM/TTS.

---

## 2. Kiến trúc Hàng đợi (BullMQ Queues)

Hệ thống phân tách thành 2 hàng đợi độc lập để tối ưu hoá tài nguyên:

### 2.1. Queue `script-draft`
* **Mục đích:** Xử lý yêu cầu tạo bản thảo kịch bản (gọi LLM, parse kịch bản theo schema Zod).
* **Đặc tính:** Nhẹ về CPU/RAM, chủ yếu chờ I/O mạng từ LLM API.
* **Worker:** `draftWorker`
* **Concurrency:** Cao (ví dụ: 5 - 10 jobs đồng thời).
* **Kết quả:** Lưu kịch bản vào SQLite/Store, bắn event `draft_ready`.

### 2.2. Queue `video-generation`
* **Mục đích:** Chạy full pipeline tạo video (TTS, tải hình ảnh, render Playwright Chromium, ghép nhạc nền, mux FFmpeg).
* **Đặc tính:** Cực kỳ nặng về CPU, GPU và RAM.
* **Worker:** `videoWorker`
* **Concurrency:** Giới hạn nghiêm ngặt (mặc định 1 - 2 jobs per worker node, tuỳ số lượng core CPU).
* **Cơ chế:** Có thể nhận trực tiếp kịch bản đã duyệt từ phase draft (bỏ qua Phase 1 LLM) hoặc chạy từ prompt thô.

---

## 3. Cấu hình Redis Khuyến nghị (Production Setup)

File cấu hình Redis (`redis.conf`) cần tuân thủ các quy tắc bắt buộc sau:

```ini
# Giới hạn bộ nhớ RAM tối đa (ví dụ cấp phát 2GB)
maxmemory 2gb

# BẮT BUỘC dùng noeviction cho BullMQ.
# Tránh trường hợp Redis tự tiện xoá key của Queue khi đầy RAM làm hỏng cấu trúc hàng đợi.
maxmemory-policy noeviction

# Bật cơ chế Persistence (AOF) để không mất hàng đợi khi khởi động lại
appendonly yes
appendfsync everysec

# Cấu hình lưu trữ
dir /data
```

### Cấu hình Dọn dẹp Job trong BullMQ (Queue Retention)
Để tránh phình to RAM trong Redis, bắt buộc cấu hình tự dọn dẹp job:

```ts
const defaultJobOptions = {
    // Chỉ giữ tối đa 100 job thành công gần nhất hoặc xoá sau 24h
    removeOnComplete: { count: 100, age: 24 * 3600 },
    // Giữ 50 job thất bại để phục vụ debug trong 7 ngày
    removeOnFail: { count: 50, age: 7 * 24 * 3600 },
    // Số lần tự động thử lại khi gặp lỗi đột ngột
    attempts: 3,
    backoff: {
        type: 'exponential',
        delay: 5000,
    }
};
```

---

## 4. Chiến lược Xử lý Sự cố & Khả năng Chịu lỗi (Resilience Matrix)

| Kịch bản sự cố | Rủi ro tiềm ẩn | Chiến lược giải quyết |
| :--- | :--- | :--- |
| **1. Redis Crash / Restart** | Mất job đang xếp hàng; Job đang render bị mồ côi (orphaned). | • **AOF Persistence:** Dữ liệu hàng đợi được phục hồi lại ngay khi Redis khởi động.<br>• **Stalled Job Detection:** BullMQ tự động phát hiện job đang `active` bị mất kết nối và đẩy lại vào queue để retry.<br>• **SQLite as Single Source of Truth:** Mọi trạng thái job đều được ghi song song vào SQLite. Khi Redis mất sạch dữ liệu, có thể chạy migration script quét SQLite để nạp lại queue. |
| **2. Mất kết nối (Network Partition)** | API Server bị treo vô hạn; Render trùng lặp (Duplicate rendering). | • **Fast-Fail tại API:** Đặt `connectTimeout: 5000` và giới hạn retry. Nếu không kết nối được Redis, API lập tức trả về `HTTP 503 Service Unavailable`, không được treo request.<br>• **Worker Lock Timeout:** Mỗi job có lock timeout (`lockDuration: 30s`). Nếu worker mất kết nối quá thời gian lock, worker tự hủy tiến trình render để tránh chạy trùng với worker khác.<br>• **Fail-Open Fallback:** Với Rate Limiting, nếu Redis sập thì tự động fallback sang bộ đếm in-memory cục bộ để không chặn người dùng duyệt web. |
| **3. Redis hết RAM (OOM)** | Lỗi ghi dữ liệu mới; Queue bị corrupt nếu dùng sai policy. | • **Cấu hình `noeviction`:** Từ chối job mới nhưng bảo toàn dữ liệu hiện tại.<br>• **Không lưu payload nặng:** Tuyệt đối KHÔNG lưu file MP4, WAV, HTML frame, hay Base64 vào Redis. Chỉ lưu metadata nhỏ và đường dẫn file cục bộ.<br>• **Đặt TTL:** Mọi key tạm (`job-cancelled:*`, lock keys) bắt buộc phải có TTL. |

---

## 5. Danh sách Files cần Triển khai

Khi hiện thực hóa Redis vào codebase, kiến trúc mã nguồn bao gồm:

| Phân hệ | File | Nhiệm vụ |
| :--- | :--- | :--- |
| **Cấu hình & Môi trường** | `src/config.ts` | Khai báo `REDIS_URL`, `REDIS_MAX_CONCURRENCY`, `REDIS_CONNECT_TIMEOUT`. |
| | `docker-compose.yml` | Khai báo container `redis:7-alpine` với volume `redis_data` và persistence AOF. |
| | `.github/workflows/pr-test.yml` | Bổ sung Redis service container trong CI runner để chạy test không bị treo. |
| **Hàng đợi & Kết nối** | `src/queue.ts` (hoặc `jobsStore.ts`) | Khởi tạo client `ioredis`, các instance `Queue` của BullMQ, hàm `enqueueVideoJob()`. |
| | `src/events.ts` | Module quản lý Redis Pub/Sub phát/nhận tiến độ render thời gian thực (`job-events:*`). |
| | `src/pipeline/cancel.ts` | Thiết lập cờ `job-cancelled:*` (TTL 1h) và tạo `AbortSignal` truyền vào Chromium/FFmpeg. |
| **Xử lý nền (Workers)** | `src/worker.ts` | Entrypoint cho tiến trình worker riêng: chạy `draftWorker` và `videoWorker`, xử lý graceful shutdown. |
| **API Server** | `src/index.ts` | Cập nhật các endpoint `POST /api/generate`, `POST /api/script/draft` đẩy job vào queue thay vì chạy blocking. |
| **Kiểm thử** | `tests/mocks/redis.ts` | Mock client Redis/Queue để unit test chạy nhanh trong bộ nhớ mà không cần server Redis thật. |

---

## 6. Cạm bẫy cần tránh (Important Caveats)

1. **Không khởi tạo kết nối Redis ở Global Top-Level:**
   * Tránh viết `export const redis = new IORedis(...)` chạy ngay khi file được `import`.
   * *Hậu quả:* Khi unit test import file (ví dụ `api.test.ts` import `buildApp`), `ioredis` sẽ cố gắng kết nối ngầm. Nếu máy test / CI không có Redis, các kết nối retry sẽ giữ Node.js event loop sống mãi mãi, làm action chạy hàng giờ không dừng.
   * *Giải pháp:* Khởi tạo kết nối lười (Lazy initialization) hoặc đưa vào vòng đời khởi động của app/worker, có hàm `close()` rõ ràng.

2. **Dọn dẹp thư mục tạm (Idempotency):**
   * Khi BullMQ retry một job bị lỗi hoặc bị stalled, Worker trước khi bắt đầu render lại phải dọn sạch thư mục `tmp/job-<jobId>` để tránh đè file frame hoặc audio lỗi của lần chạy trước.

3. **Graceful Shutdown:**
   * Khi Worker nhận tín hiệu `SIGTERM` hoặc `SIGINT`, phải gọi `await Promise.all([videoWorker.close(), draftWorker.close()])` để hoàn thành nốt frame/job hiện tại hoặc nhả lock đúng cách trước khi tắt tiến trình.
