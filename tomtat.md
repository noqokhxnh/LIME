# BÁO CÁO PHÂN TÍCH KIẾN TRÚC VÀ MÃ NGUỒN DỰ ÁN LIME (HTML-TO-VID)
*Dành cho AI Assistant và Kỹ sư Phần mềm mới gia nhập dự án*
tuan123
---

## 1. TỔNG QUAN DỰ ÁN

- **Dự án LIME (`html-to-vid`) là gì:** LIME là một hệ thống tự động tạo video chất lượng cao từ các phân cảnh hoạt họa (animation) viết bằng HTML/CSS/JS, được điều khiển bởi trí tuệ nhân tạo (LLM) và kết hợp với giọng đọc tổng hợp (TTS).
- **Các chức năng chính:**
  - **Sinh kịch bản tự động:** Chuyển đổi yêu cầu văn bản (prompt) của người dùng thành kịch bản phân cảnh cấu trúc chi tiết (dạng JSON `videoScript` bao gồm tiêu đề, lời thoại voiceOver, mã HTML, CSS và mã GSAP animation cho từng scene).
  - **Catalog Template & Motion Blocks:** Tích hợp bộ danh mục các Blueprint điện ảnh (như *Faceless Explainer*, *SaaS Launch*, *Developer Story*, *Comic Explainer*...) và các Motion Block tái sử dụng (`window.__block` như *Kinetic Type*, *Code Diff*, *Bar Chart*, *Device Showcase*, *Chat Exchange*...).
  - **Tổng hợp giọng đọc đa dạng (TTS):** Hỗ trợ nhiều nhà cung cấp TTS bao gồm Edge TTS (miễn phí), VieNeu TTS (Local AI Tiếng Việt siêu nhẹ dựa trên mô hình ONNX v3nano), OpenAI TTS, Google TTS, và ElevenLabs.
  - **Đóng gói HTML & GSAP Master Timeline:** Đóng gói toàn bộ các phân cảnh thành 1 trang HTML độc lập, tự động điều phối thứ tự xuất hiện các scene thông qua GSAP Master Timeline (`window.__masterTimeline`), hỗ trợ hàm tua thời gian `window.__seekTo(time)` và tín hiệu sẵn sàng `window.__ready`.
  - **Chụp ảnh xem trước (Preview):** Tự động chụp ảnh WebP xem trước tại mốc giữa của từng scene bằng Playwright Chromium headless.
  - **Render video xác định (Deterministic Video Rendering):** Sử dụng Playwright Chromium tua chính xác từng mốc thời gian theo số khung hình/giây (FPS), chụp ảnh JPEG từng frame và đẩy qua đường ống `stdin` (`image2pipe`) trực tiếp vào FFmpeg để ghép với âm thanh mp3 và xuất file video `final_video.mp4`.
- **Công nghệ, framework, thư viện & công cụ chính:**
  - **Ngôn ngữ & Runtime:** Node.js 22 (ES Modules), TypeScript (`tsx`).
  - **Web Framework:** Fastify v5 (`fastify`, `@fastify/cors`, `@fastify/static`, `@fastify/cookie`).
  - **Queue & Database:** BullMQ, `ioredis` (Redis 7), PostgreSQL (`pg` pool connection), In-Memory Queue fallback cho môi trường local.
  - **LLM Integrations:** Support đa nhà cung cấp qua OpenAI API, DeepSeek API, Google Gemini API, Anthropic Claude API, và 9router API Gateway.
  - **TTS & Audio Engines:** Edge TTS (WebSocket Sec-MS-GEC token generator), VieNeu TTS (Python FastAPI ONNX service), OpenAI TTS, Google Text-to-Speech, ElevenLabs API, FFmpeg / FFprobe (`fluent-ffmpeg` & raw `child_process`).
  - **Animation & Browser Automation:** Playwright Chromium (`playwright`), GSAP 3.12 (kèm `TextPlugin`, `MotionPathPlugin`).
  - **Authentication & Security:** JWT (`jose`), `bcryptjs`, RateLimiter (RPM, Quota ngày, Concurrency limit), PromptGuard.
  - **Frontend Studio UI:** Vanilla JavaScript (ES6+), HTML5, CSS3 Glassmorphism UI.

---

## 2. SƠ ĐỒ KIẾN TRÚC TỔNG THỂ (MERMAID)

```mermaid
graph TD
    Client["Client / Browser Studio UI\n(frontend/app.js)"]
    API["Fastify API Server\n(src/index.ts)"]
    QueueManager["Queue Abstraction\n(src/queue/index.ts)"]
    
    subgraph "Queue System"
        RedisQ["BullMQ Queue (Redis)\n(src/queue/bullQueue.ts)"]
        MemQ["Memory Queue (Fallback)\n(src/queue/memoryQueue.ts)"]
    end

    Worker["Worker / Pipeline Orchestrator\n(src/pipeline/orchestrator.ts)"]
    
    LLMService["LLM Provider Client\n(src/llm/client.ts)\n(OpenAI / DeepSeek / Gemini / Claude / 9router)"]
    TTSService["TTS Provider Client\n(src/pipeline/audioSysnthesis.ts)\n(Edge / VieNeu Python / OpenAI / Google / ElevenLabs)"]
    HTMLAssembler["HTML/GSAP Assembler\n(src/pipeline/assembleHtml.ts)"]
    Previewer["Preview Screenshot Generator\n(src/pipeline/preview.ts)"]
    Renderer["Chromium Frame Renderer\n(src/pipeline/renderer.ts)"]
    FFmpegMux["FFmpeg Muxer & Encoder\n(image2pipe -> final_video.mp4)"]
    
    DB[(PostgreSQL DB\nAuth Users & Sessions)]

    Client -->|REST API / SSE| API
    API -->|Prompt & Quota Check| Security["PromptGuard & RateLimiter"]
    API -->|Auth & Session| DB
    API -->|Add Job| QueueManager
    QueueManager -->|QUEUE_TYPE=redis| RedisQ
    QueueManager -->|QUEUE_TYPE=memory| MemQ
    RedisQ --> Worker
    MemQ --> Worker
    
    Worker -->|1. Generate Script| LLMService
    Worker -->|2. Estimate & Synthesize Audio| TTSService
    Worker -->|3. Assemble HTML Bundle| HTMLAssembler
    Worker -->|4. Generate Previews| Previewer
    Worker -->|5. Frame-by-Frame Render| Renderer
    Renderer -->|6. Pipe Frames to MP4| FFmpegMux
```

---

## 3. CẤU TRÚC THƯ MỤC VÀ BẢNG CÁC FILE QUAN TRỌNG

### Cây thư mục chính:
```
LIME/
├── .env.example
├── Dockerfile
├── docker-compose.yml
├── package.json
├── tsconfig.json
├── frontend/                     # Frontend Studio UI (Vanilla JS, HTML, CSS)
│   ├── app.js
│   ├── index.html
│   └── style.css
├── services/                     # Microservices độc lập
│   └── vieneu-tts/               # Python VieNeu-TTS FastAPI microservice
│       ├── Dockerfile
│       ├── requirements.txt
│       └── server.py
├── src/                          # Mã nguồn TypeScript chính
│   ├── index.ts                  # Entrypoint Fastify API Server
│   ├── worker.ts                 # Entrypoint Standalone BullMQ Worker
│   ├── cli.ts                    # Entrypoint Command Line Interface
│   ├── config.ts                 # Envs Zod Schema & Presets
│   ├── auth/                     # Authentication & User Management
│   │   ├── routes.ts
│   │   └── session.ts
│   ├── constants/                # Style prompts & tokens
│   │   └── style.ts
│   ├── database/                 # PostgreSQL Pool & DDL Schema
│   │   ├── base.ts
│   │   └── index.ts
│   ├── llm/                      # Multi-provider LLM Clients & Schemas
│   │   ├── client.ts
│   │   ├── schema.ts
│   │   └── system.txt
│   ├── pipeline/                 # Core Video Generation Pipeline
│   │   ├── assembleHtml.ts
│   │   ├── audioSysnthesis.ts    # Audio TTS & FFmpeg probe (chú ý chính tả file)
│   │   ├── estimateDuration.ts
│   │   ├── orchestrator.ts
│   │   ├── preview.ts
│   │   ├── renderer.ts
│   │   └── retry.ts
│   ├── queue/                    # Queue Layer (Memory / Redis BullMQ)
│   │   ├── bullQueue.ts
│   │   ├── handler.ts
│   │   ├── index.ts
│   │   ├── interfaces.ts
│   │   └── memoryQueue.ts
│   ├── security/                 # Security Guards & Limits
│   │   ├── promptGuard.ts
│   │   └── rateLimiter.ts
│   └── templates/                # Catalog Blueprints & Motion Blocks
│       ├── catalog.ts
│       ├── index.ts
│       ├── prompt.ts
│       ├── storySpine.ts
│       ├── types.ts
│       ├── blocks/core.ts
│       └── runtime/blockHelpers.ts
└── tests/                       # Test Suites
    ├── integration/
    └── unit/
```

### Bảng các file quan trọng và vai trò chi tiết:

| Đường dẫn File | Vai trò & Chức năng | Hàm / Class chính |
| :--- | :--- | :--- |
| [`src/index.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/index.ts) | Khởi chạy REST API Fastify, cấu hình CORS, static files, rate limit, SSE stream và các endpoints điều khiển công việc. | `buildApp()`, `startServer()`, `handlePipelineRequest()` |
| [`src/pipeline/orchestrator.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/pipeline/orchestrator.ts) | Trái tim của hệ thống: Điều phối toàn bộ luồng pipeline qua 8 giai đoạn từ prompt đến MP4 hoàn chỉnh. | `runFullPipeline()`, `orchestratorOptions`, `fullPipelineResult` |
| [`src/pipeline/scriptGenerator.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/pipeline/scriptGenerator.ts) | Xây dựng prompt từ catalog/style và gọi LLM client để sinh kịch bản JSON (`videoScript`). | `generateScript()`, `buildUserPrompt()`, `stripMarkdownJson()` |
| [`src/pipeline/audioSysnthesis.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/pipeline/audioSysnthesis.ts) | Tổng hợp giọng đọc (TTS), đo độ dài thực từng scene bằng `ffprobe`, nối track và mix BGM. | `synthesizeAudio()`, `createTTSClient()`, `probeDuration()`, `mixBgm()`, `EdgeTTSClient`, `VieNeuTTSClient` |
| [`src/pipeline/assembleHtml.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/pipeline/assembleHtml.ts) | Đóng gói mã nguồn HTML/CSS/JS, nhúng GSAP CDN, Master Timeline (`window.__masterTimeline`), `window.__seekTo` và `window.__ready`. | `assembleHTML()`, `processSceneCode()`, `BLOCK_HELPERS_JS`, `STICKMAN_HELPERS_JS` |
| [`src/pipeline/preview.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/pipeline/preview.ts) | Khởi tạo Playwright Chromium, điều khiển tua timeline và chụp ảnh WebP xem trước từng phân cảnh. | `generatePreviews()`, `launchPreviewBrowser()`, `loadAndPreparePage()`, `seekToTimestamp()` |
| [`src/pipeline/renderer.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/pipeline/renderer.ts) | Render từng khung hình qua Chromium headless và stream qua stdin `image2pipe` tới FFmpeg để mã hóa MP4. | `renderVideo()`, `RenderVideoOptions` |
| [`src/pipeline/estimateDuration.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/pipeline/estimateDuration.ts) | Ước tính thời lượng kịch bản dựa trên số từ, tốc độ đọc WPM theo ngôn ngữ và dấu câu. | `estimateDuration()`, `estimateTextDuration()`, `countEffectiveWords()` |
| [`src/llm/client.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/llm/client.ts) | Các client giao tiếp với LLM API (OpenAI, DeepSeek, Gemini, Claude, 9router). | `getLLMClient()`, `NineRouterClient`, `GeminiClient`, `OpenAIClient` |
| [`src/queue/index.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/queue/index.ts) | Lớp trừu tượng quản lý hàng đợi công việc, chuyển đổi giữa Redis BullMQ và In-Memory queue. | `getQueue()`, `BullQueue`, `MemoryQueue` |
| [`src/config.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/config.ts) | Đọc và kiểm tra tính hợp lệ của biến môi trường (.env) sử dụng Zod schema. | `getConfig()`, `envSchema`, `videoPreset` |
| [`src/templates/catalog.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/templates/catalog.ts) | Danh mục chứa các cinematic blueprints và motion blocks reusable. | `listMotionBlocks()`, `listBlueprints()`, `getBlocksForStyle()` |
| [`src/templates/runtime/blockHelpers.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/templates/runtime/blockHelpers.ts) | Đoạn mã JS inject vào trình duyệt hỗ trợ hàm `window.__block` sinh DOM phức tạp và GSAP animation. | `BLOCK_HELPERS_JS`, `window.__block`, `window.__block.animate` |
| [`services/vieneu-tts/server.py`](file:///c:/Users/ADMIN/Documents/LIME/services/vieneu-tts/server.py) | Microservice Python FastAPI bọc mô hình VieNeu ONNX v3nano để sinh TTS tiếng Việt siêu nhẹ. | `synthesize()`, `list_voices()`, `get_tts()` |

---

## 4. LUỒNG XỬ LÝ TOÀN HỆ THỐNG (END-TO-END FLOW)

### Sơ đồ chi tiết luồng xử lý 8 giai đoạn (Mermaid Sequence):

```mermaid
sequenceDiagram
    autonumber
    actor User as người dùng Studio UI
    participant Server as Fastify Server (src/index.ts)
    participant Queue as Job Queue (src/queue/*)
    participant Orchestrator as Orchestrator (src/pipeline/orchestrator.ts)
    participant LLM as LLM Client (src/llm/client.ts)
    participant TTS as Audio Synthesis (src/pipeline/audioSysnthesis.ts)
    participant Assembler as HTML Assembler (src/pipeline/assembleHtml.ts)
    participant Chromium as Playwright Chromium (src/pipeline/preview.ts & renderer.ts)
    participant FFmpeg as FFmpeg Encoder (src/pipeline/renderer.ts)

    User->>Server: POST /api/pipeline (prompt, style, voice, ratio)
    Server->>Server: RateLimiter & PromptGuard validate
    Server->>Queue: Enqueue Job (jobId)
    Server-->>User: Return 202 Accepted {jobId, checkStatusUrl, streamUrl}
    
    Queue->>Orchestrator: processVideoJob(data)
    
    Note over Orchestrator: Phase 1: Script Generation
    Orchestrator->>LLM: generateScript(request)
    LLM-->>Orchestrator: Return videoScript JSON (scenes, htmlCode, cssCode, jsCode)
    
    Note over Orchestrator: Phase 2: Duration Estimation
    Orchestrator->>Orchestrator: estimateDuration(script) (WPM + Punctuation)
    
    Note over Orchestrator: Phase 3: Temporary HTML Assembly
    Orchestrator->>Assembler: assembleHTML(script, estimatedDurations)
    Assembler-->>Orchestrator: Write tmp/job-id/index.html
    
    Note over Orchestrator: Phase 4: Preview Thumbnails
    Orchestrator->>Chromium: launchPreviewBrowser() & loadAndPreparePage()
    Chromium->>Chromium: seekToTimestamp(sceneMidpoint) via window.__seekTo()
    Chromium-->>Orchestrator: Save preview screenshots (.webp)
    
    Note over Orchestrator: Phase 5: Voice & Audio Synthesis (Ground Truth)
    Orchestrator->>TTS: synthesizeAudio(script, voice)
    loop Every Scene
        TTS->>TTS: Call TTS Provider (Edge/VieNeu/OpenAI)
        TTS->>TTS: Probe exact duration using ffprobe
    end
    TTS->>TTS: Concat scene audios & Mix background music (BGM)
    TTS-->>Orchestrator: Return AudioResult (actual durations, mixAudioPath)
    
    Note over Orchestrator: Phase 6: Final HTML Re-Assembly
    Orchestrator->>Assembler: assembleHTML(script, actualAudioDurations)
    Assembler-->>Orchestrator: Overwrite index.html with synced timings
    
    Note over Orchestrator: Phase 7 & 8: Video Render & Muxing
    Orchestrator->>Chromium: launchPreviewBrowser() & load index.html
    Orchestrator->>FFmpeg: Spawn ffmpeg -f image2pipe -i - -i mixAudioPath output.mp4
    
    loop Every Frame (totalFrames = durationSec * fps)
        Chromium->>Chromium: seekToTimestamp(frameTime)
        Chromium->>Chromium: page.screenshot({type: "jpeg"})
        Chromium->>FFmpeg: Write buffer to ffmpeg stdin
    end
    
    FFmpeg-->>Orchestrator: Close stream & save final_video.mp4
    Orchestrator-->>Queue: Mark Job Completed
    User->>Server: Poll GET /api/jobs/:jobId or SSE stream
    Server-->>User: Return video URL / HTML preview URL
```

### Phân tích chi tiết từng bước luồng thực tế:

1. **Frontend gửi yêu cầu:**
   - File: [`frontend/app.js`](file:///c:/Users/ADMIN/Documents/LIME/frontend/app.js#L362)
   - Hàm: Event Listener `generateBtn.addEventListener('click')`
   - Gửi yêu cầu HTTP `POST /api/pipeline` với payload JSON (`prompt`, `aspectRatio`, `targetDurationSec`, `language`, `style`, `ttsProvider`, `voice`, `blueprintId`, `motionBlockIds`, `async: true`).

2. **Backend tiếp nhận & Kiểm tra an ninh:**
   - File: [`src/index.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/index.ts#L42)
   - Pre-handler hook kiểm tra RPM bằng `rateLimiter.checkRpm(ip)` ([`src/security/rateLimiter.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/security/rateLimiter.ts#L31)), kiểm tra Prompt Injection bằng `validatePrompt(prompt)` ([`src/security/promptGuard.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/security/promptGuard.ts#L14)).
   - Kiểm tra quota ngày và giới hạn job đồng thời (`acquireConcurrentJob`).

3. **Queue & Worker xử lý:**
   - File: [`src/queue/index.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/queue/index.ts) & [`src/queue/handler.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/queue/handler.ts#L4)
   - Nếu `QUEUE_TYPE=redis`: Job gửi vào Redis BullMQ, worker process độc lập trong [`src/worker.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/worker.ts) nhặt job.
   - Nếu `QUEUE_TYPE=memory`: Job chạy bất đồng bộ trong cùng node process bằng `MemoryQueue`.
   - Hàm xử lý: `processVideoJob` gọi `runFullPipeline(options)`.

4. **Sinh kịch bản LLM (LLM Generation):**
   - File: [`src/pipeline/scriptGenerator.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/pipeline/scriptGenerator.ts#L84)
   - Hàm: `generateScript(request)`
   - Sử dụng `buildUserPrompt()` nạp các chỉ dẫn từ `system.txt`, style rules (`constants/style.ts`), blueprints & motion blocks (`templates/prompt.ts`).
   - Gọi LLM client (`getLLMClient()`). Kết quả trả về được làm sạch JSON markdown fence bằng `stripMarkdownJson()` và validate qua Zod `videoScriptSchema`.

5. **Ước tính thời lượng (Estimate Duration):**
   - File: [`src/pipeline/estimateDuration.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/pipeline/estimateDuration.ts#L117)
   - Hàm: `estimateDuration(script, options)`
   - Đếm số từ có hiệu lực (`countEffectiveWords`), áp dụng WPM theo ngôn ngữ (Tiếng Việt 165 WPM, Tiếng Anh 150 WPM) và tính thời gian nghỉ dựa trên dấu câu (`calculatePunctuationPauseSec`).

6. **Đóng gói mã nguồn HTML lần 1 (Temporary HTML Assembly):**
   - File: [`src/pipeline/assembleHtml.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/pipeline/assembleHtml.ts#L136)
   - Hàm: `assembleHTML(script, durations, width, height, workDir)`
   - Ghép `htmlCode`, `cssCode`, `jsCode` của từng scene. Nhúng thư viện GSAP, TextPlugin, MotionPathPlugin từ CDN. Inject plumbing script tạo `window.__masterTimeline`, `window.__seekTo`, `window.__registerScene`, `window.__block`, `window.__sm`, `window.__fx`.

7. **Tạo thumbnail xem trước (Preview Generation):**
   - File: [`src/pipeline/preview.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/pipeline/preview.ts#L240)
   - Hàm: `generatePreviews(options)`
   - Mở trình duyệt Chromium qua `launchPreviewBrowser()`, điều hướng tới file HTML local.
   - Chờ `window.__ready === true`. Tính mốc midpoint của từng scene, gọi `seekToTimestamp(page, targetTime)` (bên trong thực thi `window.__seekTo(timeInSec)`), chụp screenshot lưu thành WebP.

8. **Tổng hợp âm thanh giọng nói (TTS & Audio Synthesis):**
   - File: [`src/pipeline/audioSysnthesis.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/pipeline/audioSysnthesis.ts#L624) (lưu ý tên file chính xác)
   - Hàm: `synthesizeAudio(options)`
   - Duyệt qua từng scene, gọi client TTS tương ứng (`EdgeTTSClient`, `VieNeuTTSClient`, `OpenAITTSClient`, `GoogleTTSClient`, `ElevenLabsTTSClient`).
   - **Nguồn sự thật thời lượng:** Đo trực tiếp file audio vừa tạo bằng `probeDuration()` (gọi `ffprobe`).
   - Nối các file mp3 từng scene bằng `concatAudios()`. Trộn nhạc nền BGM bằng `mixBgm()` với hiệu ứng lặp nhạc `stream_loop -1`.

9. **Tái đóng gói HTML với thời lượng thực tế (Final HTML Re-Assembly):**
   - File: [`src/pipeline/assembleHtml.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/pipeline/assembleHtml.ts#L136)
   - Ghi đè file `index.html` trong thư mục làm việc bằng bảng `actualAudioDurations` thu được từ bước TTS.

10. **Render video từng khung hình & Ghép MP4 (Video Rendering & Muxing):**
    - File: [`src/pipeline/renderer.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/pipeline/renderer.ts#L23)
    - Hàm: `renderVideo(options)`
    - Khởi tạo Playwright Chromium và mở file HTML.
    - Gọi subprocess `spawn("ffmpeg", ffmpegArgs)` sử dụng định dạng đầu vào `-f image2pipe -vcodec mjpeg -r 30 -i -`.
    - Chạy vòng lặp từ frame 0 đến `totalFrames`:
      - `t = i / fps`
      - `await seekToTimestamp(page, t)`
      - `buf = await page.screenshot({ type: "jpeg", quality: 90 })`
      - Write `buf` vào `ff.stdin`.
    - Kết thúc stream `ff.stdin.end()` và chờ FFmpeg mã hóa H.264 / AAC hoàn tất file `final_video.mp4`.

---

## 5. PHÂN TÍCH TỪNG MODULE

### 5.1 Frontend và Giao diện Studio
- **Đường dẫn:** [`frontend/app.js`](file:///c:/Users/ADMIN/Documents/LIME/frontend/app.js), [`frontend/index.html`](file:///c:/Users/ADMIN/Documents/LIME/frontend/index.html), [`frontend/style.css`](file:///c:/Users/ADMIN/Documents/LIME/frontend/style.css)
- **Chức năng:** Giao diện người dùng cho Studio tạo video. Cho phép nhập prompt, chọn style (Modern, Classic, Stickman, Minimal), chọn Blueprint điện ảnh, lọc & chọn tối đa 8 Motion Blocks, chọn nhà cung cấp TTS & giọng đọc, đăng nhập/đăng ký người dùng.
- **Cơ chế:**
  - Tải danh mục catalog từ `/api/catalog` bằng `loadCatalog()`.
  - Tự động phát hiện từ khóa "người que/stickman" để đề xuất style nếu người dùng để mặc định.
  - Polling trạng thái job mỗi 1000ms qua `/api/jobs/:jobId`.
  - Nhúng trình phát video HTML5 và các nút tải MP4 / xem trước HTML.

### 5.2 Backend API & Server
- **Đường dẫn:** [`src/index.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/index.ts), [`src/config.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/config.ts), [`src/cli.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/cli.ts), [`src/worker.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/worker.ts)
- **Chức năng:** REST API server trên Fastify v5.
- **Điểm nổi bật:**
  - Định tuyến linh hoạt: hỗ trợ cả đồng bộ (`async: false`) và bất đồng bộ (`async: true`).
  - Cung cấp Server-Sent Events (SSE) endpoint tại `/api/jobs/:jobId/events` để push tiến độ thời gian thực cho client.
  - Đóng vai trò vừa là API Web Server, vừa hỗ trợ CLI mode (`npm run cli`) và standalone Worker mode (`npm run worker`).

### 5.3 LLM & Prompt Engineering
- **Đường dẫn:** [`src/llm/client.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/llm/client.ts), [`src/llm/schema.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/llm/schema.ts), [`src/llm/system.txt`](file:///c:/Users/ADMIN/Documents/LIME/src/llm/system.txt), [`src/pipeline/scriptGenerator.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/pipeline/scriptGenerator.ts)
- **Chức năng:** Quản lý giao tiếp đa mô hình LLM.
- **Cơ chế:**
  - Đóng gói giao diện chung `LLMClient` với hàm `generate(systemPrompt, userPrompt)`.
  - Hỗ trợ các provider: OpenAI, DeepSeek, Gemini, Claude, và 9router (tự động phát hiện API Key từ SQLite database local của 9router tại `~/.9router/db/data.sqlite` và tự động tìm Docker gateway IP).
  - Sử dụng Zod schema `videoScriptSchema` kiểm soát chặt chẽ đầu ra JSON của LLM.

### 5.4 Scene, Timeline & Animation
- **Đường dẫn:** [`src/pipeline/assembleHtml.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/pipeline/assembleHtml.ts), [`src/templates/runtime/blockHelpers.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/templates/runtime/blockHelpers.ts), [`src/templates/catalog.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/templates/catalog.ts)
- **Chức năng:** Chuyển đổi mã JSON từ LLM thành trang HTML hoàn chỉnh có thể phát animation.
- **Cơ chế:**
  - Xây dựng Master Timeline (`window.__masterTimeline = gsap.timeline({ paused: true })`).
  - Đăng ký từng scene qua `window.__registerScene(sceneId, timeline, duration)`.
  - Inject hàm helper `window.__block(name, container, opts)` và `window.__block.animate(...)` cho phép LLM chỉ cần tạo thẻ `<div class="block-mount"></div>` thay vì tự viết DOM phức tạp.
  - Inject bộ thư viện vẽ Stickman SVG (`window.__sm`) và các hiệu ứng comic (`window.__fx`).

### 5.5 TTS & Xử lý Âm thanh
- **Đường dẫn:** [`src/pipeline/audioSysnthesis.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/pipeline/audioSysnthesis.ts), [`services/vieneu-tts/server.py`](file:///c:/Users/ADMIN/Documents/LIME/services/vieneu-tts/server.py)
- **Chức năng:** Tổng hợp lời thoại thành file âm thanh mp3/wav và xử lý track nhạc.
- **Cơ chế:**
  - Hỗ trợ 5 nhà cung cấp TTS: Edge TTS, VieNeu TTS, OpenAI TTS, Google TTS, ElevenLabs.
  - **Edge TTS:** Xây dựng kết nối WebSocket chuẩn Microsoft Edge, tính toán token bảo mật `Sec-MS-GEC` theo thời gian Windows (ticks 100ns).
  - **VieNeu TTS:** Gửi request HTTP POST tới microservice Python FastAPI trên cổng 7860, sử dụng mô hình ONNX `v3nano` tối ưu cho tiếng Việt.
  - **Đồng bộ thời lượng:** Sử dụng `ffprobe` đo thời lượng file mp3 thực tế của từng scene.
  - Trộn BGM (Background Music) bằng FFmpeg complex filter `amix` với chế độ lặp `stream_loop -1`.

### 5.6 Preview & Video Renderer
- **Đường dẫn:** [`src/pipeline/preview.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/pipeline/preview.ts), [`src/pipeline/renderer.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/pipeline/renderer.ts)
- **Chức năng:** Render ảnh đại diện và xuất video MP4.
- **Cơ chế:**
  - Khởi tạo Playwright Chromium headless với các cờ tối ưu (`--no-sandbox`, `--disable-gpu`, `--disable-dev-shm-usage`).
  - Đợi tín hiệu `window.__ready === true` và đợi fonts nạp xong qua `document.fonts.ready`.
  - Chụp ảnh preview tại điểm giữa của mỗi scene (`targetTime`).
  - Vòng lặp render trong `renderer.ts`: Tua timeline qua `window.__seekTo(t)`, chụp screenshot JPEG quality 90, đẩy trực tiếp vào `stdin` của subprocess FFmpeg.

### 5.7 Database & Authentication
- **Đường dẫn:** [`src/database/base.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/database/base.ts), [`src/database/index.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/database/index.ts), [`src/auth/routes.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/auth/routes.ts), [`src/auth/session.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/auth/session.ts)
- **Chức năng:** Quản lý tài khoản người dùng và phiên đăng nhập.
- **Cơ chế:**
  - PostgreSQL DB với 2 bảng chính: `users` (id, username, email, password_hash, google_id) và `sessions` (token_hash, user_id, expires_at).
  - Hỗ trợ Đăng nhập/Đăng ký mật khẩu truyền thống (băm bằng `bcryptjs`) và Google OAuth2 (qua `jose` JWT). Cookie session HTTP-Only.

### 5.8 Security & Rate Limiting
- **Đường dẫn:** [`src/security/promptGuard.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/security/promptGuard.ts), [`src/security/rateLimiter.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/security/rateLimiter.ts)
- **Chức năng:** Bảo vệ hệ thống khỏi tấn công prompt injection và quá tải tài nguyên.
- **Cơ chế:**
  - `promptGuard.ts`: Giới hạn prompt tối đa 2000 ký tự và chặn các mẫu regex jailbreak (`ignore previous instructions`, `system prompt override`...).
  - `rateLimiter.ts`: Quản lý 20 RPM (Requests Per Minute), 10 lượt tạo video/ngày, và tối đa 2 công việc render đồng thời cho mỗi IP.

---

## 6. BẢN ĐỒ DỮ LIỆU VÀ GIAO TIẾP GỮA CÁC MODULE

### 6.1 Các cấu trúc dữ liệu cốt lõi (Zod Schemas):

1. **`videoRequest`** ([`src/llm/schema.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/llm/schema.ts#L40)):
   - `prompt`: string (10 - 5000 chars)
   - `aspectRatio`: `'16:9' | '9:16' | '1:1' | '4:3'`
   - `targetDurationSec`: number (10 - 300s)
   - `language`: string (default `'vi'`)
   - `style`: `'modern' | 'classic' | 'stickman' | 'minimal'`
   - `ttsProvider`: `'edge' | 'elevenlabs' | 'openai' | 'google' | 'vieneu'`
   - `voice`: string (optional)
   - `blueprintId`: string (optional)
   - `motionBlockIds`: string[] (optional, max 8)

2. **`scene`** ([`src/llm/schema.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/llm/schema.ts#L3)):
   - `id`: string (e.g. `scene-1`)
   - `title`: string
   - `voiceOverText`: string (lời thoại đọc TTS)
   - `visualDescription`: string
   - `htmlCode`: string (mã HTML phân cảnh)
   - `cssCode`: string (mã CSS)
   - `jsCode`: string (mã GSAP animation)
   - `transition`: `'fade' | 'slide-left' | 'slide-right' | 'slide-up' | 'zoom-in' | 'zoom-out' | 'none'`
   - `backgroundColor`: string

3. **`videoScript`** ([`src/llm/schema.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/llm/schema.ts#L18)):
   - `id`, `title`, `description`, `fontFamily`
   - `globalStyles`: string, `globalSetupJs`: string
   - `scenes`: `scene[]`
   - `colorPalette`: `{ primary, secondary, accent, background, text }`

4. **`AudioResult`** ([`src/llm/schema.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/llm/schema.ts#L66)):
   - `scencesDuration`: `Record<string, number>` (thời lượng thực của từng scene)
   - `audioFiles`: `Record<string, string>` (đường dẫn file audio mp3)
   - `totalDurationSec`: number
   - `mixAudioPath`: string (file mp3 đã mix giọng + BGM)

5. **`JobRecord`** ([`src/queue/interfaces.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/queue/interfaces.ts#L43)):
   - `jobId`: string, `status`: `'queued' | 'running' | 'completed' | 'failed'`
   - `progress`: `{ phase, progress, message }`
   - `result`: `fullPipelineResult`

---

## 7. CÁC CƠ CHẾ KỸ THUẬT QUAN TRỌNG CẦN HIỂU KHl LÀM ISSUE

### 7.1 Master Timeline & State Synchronization
- Hệ thống **KHÔNG** chạy animation theo thời gian thực (real-time playback) khi render video.
- Thay vào đó, toàn bộ animation được đóng gói vào một đối tượng GSAP duy nhất: `window.__masterTimeline = gsap.timeline({ paused: true })`.
- Hàm tua timeline: `window.__seekTo = function(timeInSec) { window.__masterTimeline.seek(timeInSec, false); }`.
- Điều này đảm bảo tính **xác định hoàn toàn (Deterministic Rendering)**: Dù máy render nhanh hay chậm, từng frame hình ảnh tại giây `t` luôn luôn chính xác 100% không bị rách hình hay đứt đoạn animation.

### 7.2 Nguồn sự thật thời lượng (Audio Ground Truth)
- Đừng bao giờ tin thời lượng do LLM dự đoán.
- Luôn quy định: **Thời lượng file âm thanh giọng đọc (TTS) đo bằng `ffprobe` là NGUỒN SỰ THẬT DUY NHẤT** cho thời gian tồn tại của phân cảnh.
- Thời lượng này được dùng để re-assemble HTML và tính mốc bắt đầu/kết thúc (`startTime`, `endTime`) của từng scene trên Master Timeline.

### 7.3 Runtime Motion Blocks (`window.__block`)
- LLM rất hay tạo mã DOM/CSS lỗi nếu phải tự viết từ đầu cho các UI phức tạp (như Terminal, Code Diff, Bar Chart, Phone Showcase, Chat UI).
- Dự án giải quyết bằng cơ chế `window.__block(name, container, opts)` ([`src/templates/runtime/blockHelpers.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/templates/runtime/blockHelpers.ts)):
  - LLM chỉ cần tạo một thẻ `<div class="block-mount"></div>` trong `htmlCode`.
  - Trong `jsCode`, LLM gọi: `window.__block('code-diff', '#scene-1 .block-mount', { ... })` và `window.__block.animate('code-diff', root, tl)`.
  - Hàm `__block` có cơ chế an toàn **bắt mọi lỗi silent error**, không bao giờ quăng exception làm dừng script, tránh gây treo Playwright.

### 7.4 Bắt lỗi & Chẩn đoán sự cố trình duyệt (Browser Diagnostics)
- Trong [`src/pipeline/preview.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/pipeline/preview.ts#L10) và [`src/pipeline/renderer.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/pipeline/renderer.ts#L52), hàm `setupBrowserDiagnostics(page)` sẽ bắt toàn bộ `console.error`, `pageerror` và `requestfailed` từ Chromium.
- Nếu Playwright bị timeout khi chờ `window.__ready`, hàm `dumpDiagnosticSnapshot()` sẽ chụp ngay 1 ảnh screenshot `error_dump.png` và dump file HTML `error_dom.html` vào thư mục job để lập trình viên dễ dàng debug.

---

## 8. CÁCH CHẠY VÀ KIỂM TRÁI DỰ ÁN

### 8.1 Điều kiện cần (Prerequisites)
- **Node.js**: v20+ hoặc v22+.
- **FFmpeg & FFprobe**: Đã cài đặt và có sẵn trong PATH hệ thống.
- **Trình duyệt Playwright Chromium**: Chạy `npx playwright install chromium`.
- **(Tùy chọn) PostgreSQL & Redis**: Dành cho môi trường production hoặc khi chạy full Docker Compose.
- **(Tùy chọn) Python 3.10+**: Nếu muốn chạy dịch vụ TTS local VieNeu.

### 8.2 Các lệnh chạy (Commands)

```bash
# 1. Cài đặt phụ thuộc
npm install

# 2. Khởi chạy ứng dụng ở chế độ Development (Fastify API Server + Frontend tại http://localhost:3000)
npm run dev

# 3. Khởi chạy CLI tạo video trực tiếp từ terminal
npm run cli -- --prompt "Giới thiệu nguyên lý hoạt động của trí tuệ nhân tạo AI" --duration 15 --aspectRatio 16:9

# 4. Khởi chạy standalone worker (chỉ dùng khi QUEUE_TYPE=redis)
npm run worker

# 5. Khởi chạy bộ kiểm thử Unit Test
npm run test:unit

# 6. Khởi chạy kiểm thử tích hợp (Pipeline Integration Test)
npm run test

# 7. Kiểm tra sức khỏe hệ thống (Healthcheck)
npm run healthcheck
```

### 8.3 Chạy bằng Docker Compose

```bash
# Khởi chạy toàn bộ hệ thống gồm Redis, Postgres, VieNeu-TTS, Server và Worker
docker-compose up --build
```

### 8.4 Các biến môi trường quan trọng (`.env`)

| Biến môi trường | Giá trị mặc định | Mô tả |
| :--- | :--- | :--- |
| `PORT` | `3000` | Cổng HTTP Server Fastify |
| `QUEUE_TYPE` | `memory` | Loại hàng đợi: `memory` (đơn giản, local) hoặc `redis` (hàng đợi distributed BullMQ) |
| `REDIS_URL` | `redis://localhost:6379` | Đường dẫn kết nối Redis |
| `DATABASE_URL` | `postgresql://vidtml:vidtml@localhost:5432/vidtml` | Đường dẫn kết nối PostgreSQL DB |
| `LLM_PROVIDER` | `gemini` | Nhà cung cấp LLM: `gemini`, `openai`, `deepseek`, `claude`, `9router` |
| `Gemini_APIKEY` | `""` | API Key cho Google Gemini |
| `OpenAI_APIKEY` | `""` | API Key cho OpenAI |
| `TTS_PROVIDER` | `edge` | Nhà cung cấp TTS: `edge` (miễn phí), `vieneu` (local AI), `openai`, `google`, `elevenlabs` |
| `VIENEU_TTS_URL` | `http://127.0.0.1:7860` | URL microservice VieNeu TTS |

---

## 9. ĐÁNH GIÁ MỨC ĐỘ HOÀN THIỆN VÀ RỦI RO

### 9.1 Các phần đã xác minh từ mã nguồn [Xác minh từ Code]
- Pipeline render từ prompt -> LLM -> GSAP HTML -> TTS -> Playwright Chromium -> FFmpeg MP4 hoạt động hoàn chỉnh và đã có unit/integration test bảo vệ.
- Cơ chế Master Timeline, seek khung hình, đóng gói `window.__block`, Stickman SVG hoạt động ổn định.
- Hỗ trợ đa LLM Provider và đa TTS Provider.
- Auth JWT + PostgreSQL, Rate Limiting và Prompt Guard đã được triển khai đầy đủ trên Fastify hooks.

### 9.2 Các điểm phụ thuộc chặt & Rủi ro khi sửa code (High Risk Areas)
1. **Lưu ý về tên file:** File [`src/pipeline/audioSysnthesis.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/pipeline/audioSysnthesis.ts) có chính tả là `audioSysnthesis.ts` (có chữ 's' thừa). Khi import file này cần giữ nguyên tên file hoặc đổi tên cẩn thận ở toàn bộ các file gọi tới.
2. **Quy trình Seek Frame:** Mọi thay đổi trong [`src/pipeline/assembleHtml.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/pipeline/assembleHtml.ts) liên quan đến `window.__masterTimeline` hoặc `window.__seekTo` có thể khiến Playwright không thể tua đúng frame, dẫn đến video bị đen hoặc đứng hình.
3. **Mã nguồn GSAP trong LLM Prompt:** LLM đôi khi sinh ra mã GSAP có thuộc tính lặp vô tận (`repeat: -1`). Điểm này cần lưu ý vì renderer render theo số frame cố định (`totalFrames`), lặp vô tận có thể làm sai lệch hiệu ứng.
4. **Việc cài đặt Playwright Chromium trong Docker:** Cần đảm bảo các cờ `--no-sandbox` và thư viện font hệ thống (`fonts-noto-core`, `fonts-liberation`) được cài đúng trong Dockerfile.

---

## 10. PROJECT KNOWLEDGE BASE (BẢNG TRA CỨU NHANH)

| Tên Module / Tính năng | File Khởi Đầu (Entry File) | Chức năng chính | Module Phụ thuộc | Lưu ý quan trọng khi sửa |
| :--- | :--- | :--- | :--- | :--- |
| **Full Pipeline Orchestrator** | [`src/pipeline/orchestrator.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/pipeline/orchestrator.ts) | Điều phối luồng 8 bước tạo video | All pipeline modules, LLM, TTS | Thay đổi thứ tự phase sẽ ảnh hưởng đến việc tính toán duration và render. |
| **LLM Generation** | [`src/pipeline/scriptGenerator.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/pipeline/scriptGenerator.ts) | Sinh kịch bản JSON từ prompt | [`src/llm/client.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/llm/client.ts), [`src/llm/schema.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/llm/schema.ts) | Đảm bảo kết quả từ LLM luôn đi qua `stripMarkdownJson` và Zod parse. |
| **TTS & Audio Muxing** | [`src/pipeline/audioSysnthesis.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/pipeline/audioSysnthesis.ts) | Tổng hợp giọng đọc & trộn BGM | FFmpeg / FFprobe | Độ dài file audio từ `ffprobe` là nguồn sự thật cho timing animation. |
| **HTML/GSAP Bundler** | [`src/pipeline/assembleHtml.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/pipeline/assembleHtml.ts) | Tạo file HTML độc lập chứa GSAP | [`src/templates/runtime/blockHelpers.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/templates/runtime/blockHelpers.ts) | Không sửa tên các window globals: `__masterTimeline`, `__seekTo`, `__ready`. |
| **Preview Screenshots** | [`src/pipeline/preview.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/pipeline/preview.ts) | Chụp WebP preview từng phân cảnh | Playwright Chromium | Cần đảm bảo gọi `loadAndPreparePage` chờ `window.__ready === true`. |
| **Video Frame Renderer** | [`src/pipeline/renderer.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/pipeline/renderer.ts) | Render JPEG frames & pipe vào FFmpeg | Playwright Chromium, FFmpeg CLI | Chú ý memory leak: phải đóng browser context trong khối `finally`. |
| **Studio Web Frontend** | [`frontend/app.js`](file:///c:/Users/ADMIN/Documents/LIME/frontend/app.js) | Giao diện điều khiển Studio | REST API Server | Kiểm tra bộ lọc motion blocks không vượt quá 8 items selected. |
| **Catalog & Blueprints** | [`src/templates/catalog.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/templates/catalog.ts) | Định nghĩa các bộ template & block | [`src/templates/blocks/core.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/templates/blocks/core.ts) | Khi thêm block mới, nhớ cập nhật cả `blockHelpers.ts` để trình duyệt có render logic. |
| **Queue Subsystem** | [`src/queue/index.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/queue/index.ts) | Quản lý công việc hàng đợi | BullMQ / Redis / Memory | Chú ý tương thích giữa 2 chế độ memory queue và redis queue. |
| **VieNeu Local TTS** | [`services/vieneu-tts/server.py`](file:///c:/Users/ADMIN/Documents/LIME/services/vieneu-tts/server.py) | Dịch vụ TTS tiếng Việt siêu nhẹ | Python FastAPI, Vieneu ONNX | Chạy trên cổng 7860, trả về WAV buffer cùng các HTTP response headers. |

---

### LỘ TRÌNH ĐỌC CODE CHO THÀNH VIÊN MỚI (RECOMMENDED READING PATH)
1. Đọc [`src/llm/schema.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/llm/schema.ts) để nắm vững các kiểu dữ liệu `videoRequest`, `videoScript`, `scene`.
2. Đọc [`src/pipeline/orchestrator.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/pipeline/orchestrator.ts) để hiểu bức tranh toàn cảnh về cách 8 giai đoạn liên kết với nhau.
3. Đọc [`src/pipeline/assembleHtml.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/pipeline/assembleHtml.ts) và [`src/templates/runtime/blockHelpers.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/templates/runtime/blockHelpers.ts) để hiểu cơ chế nhúng GSAP, `window.__masterTimeline` và `window.__block`.
4. Đọc [`src/pipeline/audioSysnthesis.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/pipeline/audioSysnthesis.ts) để biết cách TTS được gọi và cách `ffprobe` lấy độ dài audio thực.
5. Đọc [`src/pipeline/renderer.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/pipeline/renderer.ts) để hiểu luồng Playwright Chromium seek frame -> JPEG stream -> FFmpeg MP4.
6. Đọc [`src/index.ts`](file:///c:/Users/ADMIN/Documents/LIME/src/index.ts) và [`frontend/app.js`](file:///c:/Users/ADMIN/Documents/LIME/frontend/app.js) để xem cách API và giao diện Web giao tiếp với nhau.

---
*Báo cáo được tổng hợp tự động từ việc phân tích mã nguồn thực tế của dự án LIME.*
