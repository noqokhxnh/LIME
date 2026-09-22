# VidTML

AI-powered video generation from HTML animations. Describe a video in natural language → an LLM writes a structured "video script" (HTML/CSS/GSAP per scene + voiceover text) → TTS voices each scene → the assembled HTML is rendered frame-by-frame in headless Chromium → ffmpeg muxes the frames with the audio into an MP4.

The web UI (Vietnamese) is served by the same Fastify server.

## Features

- Natural-language prompt → full video (script, voiceover, images, animation, final MP4)
- Two-phase workflow: generate & edit script drafts before rendering, with AI revision support
- 4 LLM providers: OpenAI, Google Gemini, Anthropic Claude, DeepSeek
- 4 TTS providers: Edge TTS (free, high-quality Vietnamese voices), OpenAI, Google, ElevenLabs
- Per-scene photos from Wikimedia Commons (no API key required), cached in SQLite
- Aspect ratios: 16:9, 9:16, 1:1, 4:3
- User accounts & session-based auth (register/login, HttpOnly cookies, bcryptjs)
- Google OAuth 2.0 sign-in (one-click login/register, tài khoản password + Google link theo email)
- Async job pipeline: Redis (BullMQ) queues + background workers, status persisted in SQLite
- Realtime progress via Server-Sent Events (SSE)
- Token usage tracking & cost estimation
- 3-panel Studio Web UI (Vietnamese): project sidebar, video player & editable script tabs, live progress monitoring

## Requirements

You can run VidTML via **Docker** (recommended for quick setup without installing host dependencies) or **Local Node.js environment**.

### Local Prerequisites (if not using Docker)
| Dependency | Notes |
|---|---|
| Node.js 18+ | Runtime environment |
| Redis | queue + pub/sub (`redis-server`) |
| ffmpeg + ffprobe | on `PATH`; audio duration probing, concat, BGM mix, muxing |
| Chromium | one-time: `npx playwright install chromium` |

---

## Quick start

### Option A: Using Docker (Recommended)

Requires only [Docker](https://docs.docker.com/get-docker/) & Docker Compose. All dependencies (Node.js, Redis, FFmpeg, Playwright Chromium, Vietnamese fonts) are pre-packaged.

```bash
# 1. Setup environment file
cp .env.example .env     # fill in your API keys (DEEPSEEK_API_KEY / GEMINI_API_KEY, ...)

# 2. Build & run all services (Redis + API Server + Worker)
docker compose up --build

# 3→ Web UI & API ready at http://localhost:3000

# 4. After pulling, run this to install the dependencies
npm ci
```

Run in detached/background mode:

```bash
docker compose up -d --build
docker compose ps                 # status of redis / server / worker
docker compose logs -f            # follow logs of all services
docker compose logs -f worker     # follow worker video rendering logs
docker compose down               # stop all containers (data is kept)
docker compose down -v            # stop AND delete Redis data + generated videos/DB
```

Notes:

- **Rebuild after code changes:** the Dockerfile copies sources at build time — run `docker compose up --build` (or `docker compose build && docker compose up -d`) whenever you change code or dependencies.
- **`.env` is mandatory:** the compose file loads it via `env_file` on the server & worker services; `docker compose up` fails if it's missing.
- **Persistence:** the SQLite DB, generated videos and Redis data live in named volumes (`vidtml_data`, `redis_data`) — they survive `docker compose down` and are only wiped by `docker compose down -v`.
- **Sandbox:** containers run render/preview Chromium with `RENDER_ALLOW_NO_SANDBOX=1` set automatically (there's no OS sandbox inside a container). Keep it unset (`0`) for local non-Docker runs.
- **Low-RAM machines:** the worker runs with `shm_size: 2gb` for headless Chromium; if it crashes, lower `RENDER_MAX_CONCURRENCY` in `.env` (e.g. `2`).

---

### Option B: Local Setup

```bash
npm install
npx playwright install chromium          # one-time
cp .env.example .env                      # fill in your API keys (DEEPSEEK_API_KEY, ...)

npm run dev:all                           # starts Redis + API server + worker
# → Web UI & API at http://localhost:3000
```

`npm run dev:all` runs `start.sh`, which starts Redis if it isn't running, then launches the dev server and the worker together. For manual control, use three terminals:

```bash
redis-server
npm run dev          # API server (hot reload)
npm run worker       # background video worker
```

## Commands

| Command | Description |
|---|---|
| `docker compose up --build` | Build & run full stack (Redis + Server + Worker) in Docker |
| `docker compose down` | Stop all containers (data volumes kept) |
| `docker compose down -v` | Stop and delete Redis data + generated videos/DB |
| `npm run dev` | API server with hot reload (`tsx watch src/index.ts`) |
| `npm run worker` | Background video worker (`tsx watch src/worker.ts`) |
| `npm run dev:all` | `start.sh` — Redis + server + worker |
| `npm start` | Run API server without watch |
| `npm run build` | Typecheck and emit to `dist/` (`tsc`) |
| `npm test` | Runs unit tests via tsx (`tests/unit/*.test.ts`) |


## Configuration

All configuration is environment-driven, validated by zod in `src/config.ts` (`.env` supported). See `.env.example` for a commented template.

### Server & storage

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `NODE_ENV` | `development` | `development` \| `production` |
| `DB_PATH` | `tmp/vidtml.sqlite` | SQLite database file |

### Google OAuth (optional)

| Variable | Default | Description |
|---|---|---|
| `GOOGLE_CLIENT_ID` | — | Google OAuth 2.0 Client ID (leave empty to disable Google sign-in) |
| `GOOGLE_CLIENT_SECRET` | — | Google OAuth 2.0 Client Secret |
| `GOOGLE_REDIRECT_URI` | — | OAuth callback URL (optional; defaults to `${protocol}://${host}/api/auth/google/callback`) |

### LLM

| Variable | Default | Description |
|---|---|---|
| `LLM_PROVIDER` | `openai` | `openai` \| `gemini` \| `claude` \| `deepseek` |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | — / `gpt-4o` | |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | — / `gemini-2.5-pro` | |
| `ANTHROPIC_API_KEY` / `CLAUDE_MODEL` | — / `claude-sonnet-4-20250514` | |
| `DEEPSEEK_API_KEY` / `DEEPSEEK_MODEL` | — / `deepseek-chat` | Use `deepseek-chat`/`deepseek-reasoner` on the OpenAI-compatible endpoint |

### TTS

| Variable | Default | Description |
|---|---|---|
| `TTS_PROVIDER` | `edge` | `edge` \| `openai` \| `google` \| `elevenlabs` |
| `TTS_VOICE` | `vi-VN-HoaiMyNeural` | e.g. `vi-VN-HoaiMyNeural` (female), `vi-VN-NamMinhNeural` (male) |
| `GOOGLE_TTS_API_KEY` | — | Google TTS |
| `ELEVENLABS_API_KEY` / `ELEVENLABS_VOICE_ID` | — | ElevenLabs |

### Image search (Wikimedia Commons, no key)

| Variable | Default | Description |
|---|---|---|
| `IMAGE_CACHE_TTL_DAYS` | `7` | Cache search results to avoid repeat queries |
| `IMAGE_MAX_QUERIES_PER_JOB` | `10` | Per-video query cap (cache hits don't count) |

### Usage tracking & cost estimation

| Variable | Default | Description |
|---|---|---|
| `USAGE_LOG_ENABLED` | `true` | Append usage records to a JSONL log |
| `USAGE_LOG_PATH` | `tmp/usage.jsonl` | JSONL log file |
| `USAGE_PRICE_OVERRIDES` | — | JSON object overriding per-model prices, e.g. `{"deepseek":{"deepseek-reasoner":{"inputPer1M":0.55,"outputPer1M":2.19}}}` |

### Redis & queue

| Variable | Default | Description |
|---|---|---|
| `REDIS_HOST` / `REDIS_PORT` | `127.0.0.1` / `6379` | |
| `REDIS_PASSWORD` | — | |
| `WORKER_CONCURRENCY` | `2` | Jobs processed in parallel by one worker |
| `RENDER_MAX_CONCURRENCY` | `4` | Parallel Chromium/ffmpeg render processes per job |

### Video

| Variable | Default | Description |
|---|---|---|
| `DEFAULT_FPS` | `30` | Not wired into the pipeline yet (render is currently hardcoded to 30 fps) |
| `DEFAULT_WIDTH` / `DEFAULT_HEIGHT` | `1920` / `1080` | Not wired into the pipeline yet; dimensions come from `VIDEO_PRESETS` in `src/config.ts` (16:9 → 1920×1080, 9:16 → 1080×1920, 1:1 → 1080×1080, 4:3 → 1440×1080) |

### Runtime provider switching

LLM and TTS providers can be switched at runtime from the web UI (Công Cụ → Nhà cung cấp AI / Nhà cung cấp giọng đọc). The selection is stored per user in the SQLite `settings` table and **takes precedence over the env vars**. API keys always stay in `.env`.

## Project structure

```
vidtml/
├── src/
│   ├── index.ts               # Fastify API server (REST + SSE + serves web/)
│   ├── worker.ts              # BullMQ background worker (consumes the queue)
│   ├── config.ts              # zod-validated env config + VIDEO_PRESETS
│   ├── sse.ts                 # Server-Sent Events handler (Redis pub/sub)
│   ├── auth/                  # session-based auth (register/login/logout/me)
│   │   ├── routes.ts          #   auth endpoints + requireAuth preHandler
│   │   ├── password.ts        #   bcryptjs hashing
│   │   └── rateLimit.ts       #   in-memory sliding-window rate limiter
│   ├── db/                    # SQLite: connection, schema, repositories
│   │   ├── jobsRepository.ts  #   jobs CRUD + progress logs
│   │   ├── usersRepository.ts #   user accounts CRUD
│   │   ├── sessionsRepository.ts # session token management
│   │   ├── settings.ts        #   user-scoped runtime settings store
│   │   ├── imageCache.ts      #   Wikimedia search-result cache
│   │   └── schema.ts          #   DDL (jobs, users, sessions, settings, cache)
│   ├── queue/                 # BullMQ queue + Redis pub/sub client
│   ├── llm/                   # LLM clients, system prompt, zod schemas
│   ├── pipeline/              # the 6 pipeline phases (see architecture doc)
│   ├── image/                 # Wikimedia Commons search client
│   └── usage/                 # token usage recording & cost estimation
├── web/                       # vanilla JS frontend (Vietnamese UI)
├── tests/
│   ├── unit/                  # codeAssembler.test.ts, db.test.ts
│   └── integration/           # (planned)
├── tmp/                       # job workdirs + SQLite DB (gitignored)
├── start.sh                   # dev:all launcher (Redis + server + worker)
└── .env.example               # commented env template
```

## Documentation

- [docs/architecture.md](docs/architecture.md) — system architecture, auth, pipeline phases, the HTML↔renderer contract, extension points
- [docs/api.md](docs/api.md) — REST API + SSE + auth reference
- [docs/styles.md](docs/styles.md) — visual style system audit & comparison results
- [CONTRIBUTING.md](CONTRIBUTING.md) — hướng dẫn đóng góp mã nguồn & quy trình phát triển

## Related

- `CLAUDE.md` — guidance for Claude Code (AI-assisted development) contributors

