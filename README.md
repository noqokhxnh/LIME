<p align="center">
  <picture>
    <img alt="VidTML / LIME" src="public/logo.png" width="240">
  </picture>
</p>



<p align="center">
  <b>Write HTML. Render video. Built for AI agents and human creators.</b>
</p>
<p align="center">
  <img src="public/logo-motion.webp" alt="VidTML / LIME Motion" width="560">
</p>
<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL_v3-blue.svg" alt="License: AGPL-3.0"></a>
  <img src="https://img.shields.io/badge/Node.js-%3E%3D20-green.svg" alt="Node.js Version">
  <img src="https://img.shields.io/badge/TypeScript-5.x-3178c6.svg" alt="TypeScript">
  <img src="https://img.shields.io/badge/Renderer-Playwright%20Chromium-45ba4b.svg" alt="Playwright">
  <img src="https://img.shields.io/badge/Motion-GSAP%203.x-88ce02.svg" alt="GSAP">
</p>

---

## Overview

**VidTML** is an open-source, production-ready AI video generation platform. Given a single text prompt, VidTML orchestrates Large Language Models (LLMs) to write structured modular video scenes using **HTML5, CSS3, SVG, Canvas2D/Three.js, and GSAP animations**, synthesizes voiceover audio via state-of-the-art TTS providers, renders the animated scenes frame-by-frame inside headless Chromium instances with deterministic seek precision, and muxes everything into high-definition MP4 videos via `ffmpeg`.

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
git clone https://github.com/noqokhxnh/html-to-vid.git
cd html-to-vid

cp .env.example .env

docker compose up --build
```

Access the Web Studio at: **`http://localhost:3000`**

---

### Option B: Local Development Setup

#### Prerequisites
- **Node.js**: v20.x or higher
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
# Server
PORT=3000
NODE_ENV=development

# LLM Providers (Select one, or switch dynamically in the Web UI)
LLM_PROVIDER=deepseek
DEEPSEEK_API_KEY="sk-..."
DEEPSEEK_MODEL="deepseek-chat"

# TTS Providers (Edge TTS is free without any API key)
TTS_PROVIDER=edge
TTS_VOICE=vi-VN-HoaiMyNeural

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

VidTML is backed by extensive unit and integration test suites:

```bash
# Run all unit tests (over 690+ assertions across 40+ test suites)
npm run test:unit

# Run end-to-end pipeline integration tests
npm test
```

Test coverage includes:
- GSAP timeline AST linter & contract safety
- Doodle stickman anatomy, IK, line-boil, and pose geometry
- Audio ducking, loudness normalization, and beat detection
- CDP frame capture deduplication
- Canvas2D & Three.js time-driver determinism
- Quota reservations & prompt injection security guards

---

## License

This project is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**.

```text
VidTML (LIME) - AI HTML-to-Video Generation Platform
Copyright (C) 2026 noqokhxnh

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.
```

See the [LICENSE](LICENSE) file for the full license text. If you run a modified version of VidTML as a network service, you must make the corresponding source code available to your users.
