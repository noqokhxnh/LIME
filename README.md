**Báo cáo tiến độ & nghiên cứu dự án (04/10):** [README_4_10.md](README_4_10.md).

<p align="center">
  <picture>
    <img alt="LIME / LIME" src="public/logo.png" width="240">
  </picture>
</p>



<p align="center">
  <b>Write HTML. Render video. Built for AI agents and human creators.</b>
</p>
<p align="center">
  <img src="public/logo-motion.webp" alt="LIME / LIME Motion" width="560">
</p>
<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-PolyForm_Noncommercial_1.0.0-blue.svg" alt="License: PolyForm Noncommercial 1.0.0"></a>
  <img src="https://img.shields.io/badge/Node.js-%3E%3D20-green.svg" alt="Node.js Version">
  <img src="https://img.shields.io/badge/TypeScript-5.x-3178c6.svg" alt="TypeScript">
  <img src="https://img.shields.io/badge/Renderer-Playwright%20Chromium-45ba4b.svg" alt="Playwright">
  <img src="https://img.shields.io/badge/Motion-GSAP%203.x-88ce02.svg" alt="GSAP">
</p>

---

## Overview

**LIME** is an open-source, production-ready AI video generation platform. Given a single text prompt, LIME orchestrates Large Language Models (LLMs) to write structured modular video scenes using **HTML5, CSS3, SVG, Canvas2D/Three.js, and GSAP animations**, synthesizes voiceover audio via state-of-the-art TTS providers, renders the animated scenes frame-by-frame inside headless Chromium instances with deterministic seek precision, and muxes everything into high-definition MP4 videos via `ffmpeg`.

### Why HTML/CSS/JS for Video?

- **Unmatched Precision & Expressiveness**: Leverage the entire modern web platform (Flexbox, Grid, SVG paths, WebGL shaders, Canvas2D, Three.js 3D models, Google Fonts, MathJax/KaTeX).
- **100% Deterministic Rendering**: Zero dropped frames or rendering jitter. The GSAP master timeline is scrubbed deterministically via `window.__seekTo(time)` at exact 30/60 fps intervals.
- **Built for AI Agents**: LLMs excel at generating structured HTML and GSAP code far better than opaque binary video formats or complex 3D engine scripts.
- **Instant Previews & Web-First**: Edit scenes in real time in the browser before invoking GPU/CPU-heavy render passes.

---
## Architecture & Pipeline

```text
User Prompt (Web UI / REST API / CLI)
                  │
                  ▼
  ┌─────────────────────────────────┐
  │  Phase 1: Script Generator      │ ◄── LLM (OpenAI / Claude / Gemini / DeepSeek)
  │  - JSON schema validation (Zod) │
  │  - AST syntax & contract check  │
  └───────────────┬─────────────────┘
                  │
        ┌─────────┴─────────┐
        ▼                   ▼
  ┌───────────┐       ┌───────────┐
  │ Phase 2a: │       │ Phase 2b: │
  │ Audio TTS │       │ Image Gen │ ◄── Wikimedia Commons & Local Assets
  │ & BeatSync│       │ & Charts  │
  └─────┬─────┘       └─────┬─────┘
        └─────────┬─────────┘
                  ▼
  ┌─────────────────────────────────┐
  │  Phase 3: Code Assembler        │
  │  - Injects real durations & imgs│
  │  - Assembles standalone HTML    │
  └───────────────┬─────────────────┘
                  ▼
  ┌─────────────────────────────────┐
  │  Phase 4: Scene Previewer       │ ◄── WebP scene snapshots
  └───────────────┬─────────────────┘
                  ▼
  ┌─────────────────────────────────┐
  │  Phase 5: Parallel Renderer     │ ◄── Playwright (Chromium instances)
  │  - Scrub GSAP with __seekTo()   │
  │  - Pipe PNG frames to ffmpeg    │
  └───────────────┬─────────────────┘
                  ▼
  ┌─────────────────────────────────┐
  │  Phase 6: Audio/Video Muxer     │ ◄── ffmpeg muxing (-shortest, AAC, +faststart)
  └───────────────┬─────────────────┘
                  │
                  ▼
        Final Rendered MP4 Video
```

---

## QuickStart

### Option A: Docker Compose (Recommended)

Run everything (Fastify API Server, Worker, Redis, PostgreSQL, VieNeu-TTS) in one command:

```bash
git clone https://github.com/noqokhxnh/LIME.git
cd LIME

cp .env.example .env

docker compose up --build
```

Access the Web Studio at: **`http://localhost:3000`**

---

### Option B: Local Development Setup

#### Prerequisites
- **Node.js**: v20.x or higher
- **PostgreSQL**: v13 or higher (or `DATABASE_URL` pointing to an existing instance)
- **Redis**: v7.x or higher (for job queue & SSE pub/sub)
- **ffmpeg & ffprobe**: Installed on your system `PATH`
- **Chromium**: Installed via Playwright

#### Step-by-Step Installation

```bash
npm install

npx playwright install chromium

cp .env.example .env


# Start Redis (if not already running)
# docker run -d -p 6379:6379 redis:7-alpine

# Run API Server and Video Worker in separate terminals:
# Terminal 1: API Server
npm run dev

# Terminal 2: Background Video Worker
npm run worker
```

---

## CLI Usage

You can generate videos directly from the command line without opening the web interface:

```bash
# Quick generation with defaults
npm run cli -- --prompt "Giải thích cách hoạt động của Trí Tuệ Nhân Tạo"

# Full options
npm run cli -- \
  --prompt "5 thói quen giúp lập trình viên năng suất hơn mỗi ngày" \
  --style stickman \
  --duration 20 \
  --aspect 16:9 \
  --lang vi \
  --sync
```

### CLI Arguments
| Argument | Alias | Default | Description |
|---|---|---|---|
| `--prompt` | `-p` | (required) | Video concept and narration instructions |
| `--style` | `-s` | `modern` | Visual style (`stickman`, `modern`, `editorial`, `brutalist`, etc.) |
| `--duration`| `-d` | `15` | Target duration in seconds |
| `--aspect` | `-a` | `16:9` | Aspect ratio (`16:9`, `9:16`, `1:1`, `4:3`) |
| `--lang` | `-l` | `vi` | Voiceover language (`vi`, `en`) |
| `--sync` | | `false` | Run synchronously and wait for the final MP4 path |

---

## Configuration Reference

Key settings configurable in `.env` (validated by Zod in `src/config.ts`):

```ini
# Server & Database
PORT=3000
NODE_ENV=development
DATABASE_URL="postgresql://lime:lime_secret_password@127.0.0.1:5432/lime_db"

# LLM Providers (Select one, or switch dynamically in the Web UI)
LLM_PROVIDER=deepseek
DEEPSEEK_API_KEY="sk-..."
DEEPSEEK_MODEL="deepseek-chat"

# TTS Providers (Edge TTS is free; VieNeu-TTS provides local Vietnamese neural voice)
TTS_PROVIDER=edge
TTS_VOICE=vi-VN-HoaiMyNeural
VIENEU_TTS_URL="http://127.0.0.1:7860"

# Redis Queue & Concurrency
REDIS_URL=redis://127.0.0.1:6379
WORKER_CONCURRENCY=2
RENDER_MAX_CONCURRENCY=4

# Media & Image Search
IMAGE_CACHE_TTL_DAYS=7
IMAGE_MAX_QUERIES_PER_JOB=10

# Quota & Rate Limits
QUOTA_MAX_CONCURRENT_JOBS=3
QUOTA_MAX_DAILY_JOBS=20
QUOTA_DAILY_BUDGET_USD=2.0
```

---

## REST API & SSE Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/auth/register` | Register new user account |
| `POST` | `/api/auth/login` | Log in and receive session cookie |
| `POST` | `/api/script/draft` | Phase 1: Generate an editable video script draft |
| `POST` | `/api/generate` | Phase 2: Enqueue full video rendering job |
| `GET` | `/api/jobs/:id` | Get job status, current phase, and execution logs |
| `GET` | `/api/jobs/:id/events` | Server-Sent Events (SSE) live progress stream |
| `GET` | `/api/jobs/:id/video` | Stream rendered MP4 video with HTTP range support |
| `GET` | `/api/jobs/:id/download` | Download final MP4 video file |
| `GET` | `/api/jobs/:id/preview/:sceneId`| Fetch WebP thumbnail for specific scene |
| `DELETE`| `/api/jobs/:id` | Cancel running job and clean up scratch storage |
| `GET` | `/api/settings` | Get current user's provider overrides |
| `PUT` | `/api/settings` | Save runtime provider preferences |
| `GET` | `/api/usage` | Inspect LLM token usage and estimated spend |
| `GET` | `/api/health` | Healthcheck (Redis, DB, system dependencies) |

---

## Testing

LIME is backed by extensive unit and integration test suites:

```bash
# Chạy nhóm test dùng ở mọi PR (fast + tích hợp rẻ) — nhanh, không cần PostgreSQL
npm run test:unit:pr

# Chạy test đơn vị (fast + heavy) và test tích hợp
npm run test:unit
npm run test:integration

# Đo độ phủ mã nguồn + kiểm tra cổng chất lượng (xem scripts/coverage-thresholds.json)
npm run test:coverage          # toàn bộ suite, ngưỡng 70% dòng
npm run test:coverage:pr       # nhóm PR, ngưỡng 68% dòng

# Các bộ riêng: E2E pipeline (nặng), giao diện (Playwright), cần Redis
npm run test:e2e
npm run test:frontend
npm run test:redis
```

Mọi file `*.test.ts` phải được khai báo trong `scripts/test-groups.ts`; nếu không,
`scripts/run-unit-tests.ts` sẽ dừng và chỉ ra file bị bỏ quên (trước đây từng có test
viết xong nhưng không script nào chạy). Kiểm tra tay đặt ở `tests/manual/*.manual.ts`.

CI: `pr-test.yml` chạy nhóm `pr` kèm cổng độ phủ ở mọi PR; `pipeline-tests.yml` chạy lại
nhóm đó trên PostgreSQL thật và chạy nhóm `redis` trên Redis thật theo lịch đêm; nhóm nặng
chạy hằng tuần ở `heavy-tests.yml` (không nằm trong đường chạy thường ngày vì
`security.test.ts` chạy pipeline thật 10 lần, mất hơn 30 phút trên runner CI).

Độ phủ hiện tại: **~77% dòng** cho toàn bộ suite, **~70%** cho nhóm chạy ở PR (cổng chất
lượng 68% đo trên nhóm đó; chạy toàn bộ suite tại chỗ thì ngưỡng là 70% — xem
`scripts/coverage-thresholds.json`).

Test coverage includes:
- GSAP timeline AST linter & contract safety
- Doodle stickman anatomy, IK, line-boil, and pose geometry
- Audio ducking, loudness normalization, and beat detection
- CDP frame capture deduplication
- Canvas2D & Three.js time-driver determinism
- Quota reservations & prompt injection security guards

---

## License

This project is licensed under the **PolyForm Noncommercial License 1.0.0**.

See the [LICENSE](LICENSE) file for the full license text. You may use, modify, and distribute this software for any noncommercial purpose.
