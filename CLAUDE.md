# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

VidTML is an AI-powered video generator: a user prompt → LLM generates a structured "video script" (HTML/CSS/GSAP per scene + voiceover text) → TTS voices each scene → the assembled HTML is rendered frame-by-frame in headless Chromium → ffmpeg muxes the frames with the audio into an MP4. The web UI (Vietnamese) is served by the same Fastify server.

The system is actively developed and still missing planned features (tests, BGM UI). See `docs/architecture.md` (roadmap section) and `docs/api.md` for the full picture; this file is the working summary.

## Github

- Each pull request must focus on a single feature or change; do not bundle multiple features into one PR.
- Whenever you commit code, never add Claude or any another LLM Agents as a co-author; just list me as the sole author.


## Commands

- `npm run dev` — API server with hot reload (`tsx watch src/index.ts`)
- `npm run worker` — background video worker (`tsx watch src/worker.ts`)
- `npm run dev:all` — `start.sh`: starts Redis if needed, then server + worker together
- `npm start` — run server without watch
- `npm run build` — typecheck and emit to `dist/` (`tsc`)
- `npm test` — runs `tests/integration/pipeline.test.ts` via tsx (note: `tests/` is currently empty; unit/integration suites don't exist yet)

System dependencies (not in package.json): Redis (queue + pub/sub), `ffmpeg`/`ffprobe` on PATH (audio probing, concat, BGM mix, muxing), and `npx playwright install chromium` once (renderer/previewer).

## Configuration

All config is env-driven via `src/config.ts` (zod-validated, `.env` supported). Provider selection is a single env var each, but the web UI can override it at runtime — the selection stored per user in the SQLite `settings` table (`src/db/settings.ts`) **takes precedence over the env vars**; API keys always stay in `.env`. Endpoints: `GET /api/settings`, `PUT /api/settings`.

- LLM: `LLM_PROVIDER=openai|gemini|claude|deepseek` (+ matching `*_API_KEY`, `*_MODEL`)
- TTS: `TTS_PROVIDER=edge|openai|google|elevenlabs` (+ keys; edge is free, `TTS_VOICE` picks the voice)
- Google OAuth: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` (optional, leave empty to disable Google sign-in)
- Redis/queue: `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `WORKER_CONCURRENCY` (2, jobs per worker), `RENDER_MAX_CONCURRENCY` (4, Chromium/ffmpeg processes per job), `RENDER_ALLOW_NO_SANDBOX` (`1` = run render/preview Chromium without OS sandbox — default sandboxed, see `docs/architecture.md` "Security model")
- Storage: `DB_PATH` (`tmp/vidtml.sqlite`)
- Usage tracking: `USAGE_LOG_ENABLED`, `USAGE_LOG_PATH` (`tmp/usage.jsonl`), `USAGE_PRICE_OVERRIDES`
- Quotas & rate limiting: `QUOTA_MAX_CONCURRENT_JOBS` (3, active concurrent jobs), `QUOTA_MAX_DAILY_JOBS` (20, per UTC day), `QUOTA_DAILY_BUDGET_USD` (optional daily cost cap enforced via atomic credit hold/reconcile), `TRUST_PROXY` (`'1'` = trust `X-Forwarded-For`, required behind a reverse proxy; keep `0` when exposed directly to the internet — also enables Fastify's `trustProxy`)
- Images: `IMAGE_CACHE_TTL_DAYS` (7), `IMAGE_MAX_QUERIES_PER_JOB` (10) — per-scene photos from Wikimedia Commons (`src/image/client.ts`, no key required)
- `VIDEO_PRESETS` in `src/config.ts` maps aspect-ratio keys (`16:9`, `9:16`, `1:1`, `4:3`) to pixel dimensions
- Gotcha: `DEFAULT_FPS`/`DEFAULT_WIDTH`/`DEFAULT_HEIGHT` are validated but **not wired into the pipeline** — render is hardcoded to 30 fps and dimensions come from `VIDEO_PRESETS`

## Process architecture

Two processes, both stateless enough to run separately; `start.sh` runs both:

1. **API server** (`src/index.ts`, Fastify) — REST endpoints, SSE, serves `web/`. Never runs the pipeline.
2. **Worker** (`src/worker.ts`, BullMQ) — polls the Redis queue `video-generation`, runs the pipeline, persists status/logs to SQLite, publishes progress to Redis pub/sub (`job-events:<jobId>`), which the SSE handler (`src/sse.ts`) streams to browsers. Also runs a TTL cleaner every 30 min (deletes jobs + workdirs older than 24 h).

Jobs are persisted in SQLite (`src/db/jobsRepository.ts`, tables `jobs` + `job_logs`, schema applied idempotently in `src/db/schema.ts`), so the queue survives server restarts. Job lifecycle: `queued → running → completed | failed` (`attempts: 1`, no auto-retry).

## Pipeline architecture

`src/pipeline/orchestrator.ts` (`runPipeline`) drives the pipeline phases, each writing artifacts into a per-job workdir under `tmp/<uuid>` and reporting progress through an `onProgress` callback (persisted to `job_logs` + published to Redis):

1. **scriptGenerator.ts** — calls the LLM with the system prompt in `src/llm/prompts/system.txt`, validates output against `VideoScriptSchema` (zod) and enforces the full HTML↔renderer contract fail-fast via `src/pipeline/scriptValidator.ts` (unique scene IDs, DOM IDs, `globalSetupJs` runtime globals, JS syntax, `{{SCENE_DURATION}}` placeholders, `__registerScene` calls, timers, security); retries up to 3× with the exact validation error appended to the prompt for LLM self-correction.
2a. **audioSynth.ts** — TTS per scene (sequential, to avoid rate limits), probes each file with ffprobe for duration, concatenates, optionally mixes BGM at low volume. Produces `sceneDurations` map — the source of truth for animation timing. Runs in parallel with 2b.
2b. **imageGenerator.ts** — Wikimedia Commons image search (`src/image/client.ts`) for every photo the LLM requested: 0–3 per scene, total across the video unconstrained. Downloads into `html/images/`, returns a sceneId → path-array map (index = token order). Scenes without an `imagePrompt` are skipped (no query spent); failures fall back to a transparent GIF data URI so layouts hold. Search results are cached in SQLite (`image_search_cache`, `src/db/imageCache.ts`; empty results are never cached); per-job query cap `IMAGE_MAX_QUERIES_PER_JOB`. Commons search is strict — queries with no results retry with trailing words dropped ("Hồ Gươm cổ kính" → "Hồ Gươm").
3. **codeAssembler.ts** — replaces `{{SCENE_DURATION}}` placeholders in each scene's `jsCode` with the real TTS-measured duration (sec) and the numbered `{{SCENE_IMAGE}}`/`{{SCENE_IMAGE_2}}`/`{{SCENE_IMAGE_3}}` tokens in htmlCode/cssCode with the downloaded photo paths in index order (missing index → transparent GIF), performs final fail-closed contract & JS syntax validation with real durations (`src/pipeline/scriptValidator.ts`), and assembles one self-contained HTML file (fails closed on syntax/contract errors).
4. **previewer.ts** — Playwright: seeks the GSAP timeline to each scene's midpoint, saves WebP thumbnails.
5. **parallelRenderer.ts** — the active render path: splits the timeline into per-scene chunks, renders them in parallel across isolated Chromium instances (≤ `RENDER_MAX_CONCURRENCY`; browsers launch OS-sandboxed via `src/pipeline/browser.ts` — untrusted LLM code runs in a sandbox by default, see "Security model" in docs), each chunk piping PNGs into an ffmpeg `image2pipe` (libx264), then concatenates chunks with the ffmpeg concat demuxer without re-encoding. (`renderer.ts` is the old single-process renderer, no longer imported — delete when confident.)
6. **muxer.ts** — ffmpeg: muxes raw video + mixed audio (`-shortest`, AAC, `+faststart`) into the final MP4.

Cancellation is cooperative: every phase takes an optional `AbortSignal` (worker wires it to the Redis `job-cancelled:<jobId>` flag via `watchJobCancellation`, polling ~0.4 s) and uses `src/pipeline/cancel.ts` (`throwIfAborted`/`raceWithAbort`) so LLM/TTS fetches, image downloads, Playwright, and ffmpeg subprocesses stop in-flight — `DELETE /api/jobs/:id` on a running job reports "cancellation requested", not a synchronous stop.

LLM token usage is recorded per job with userId (`src/usage/`, JSONL log + in-memory ring) and exposed via `GET /api/usage` (scoped to current user) and the job result's `usage` field.

## The HTML↔renderer contract (critical)

The LLM-generated HTML must expose specific globals that phases 4–5 rely on. This contract is enforced by the system prompt (`src/llm/prompts/system.txt`) — the schema, prompt, and renderer must stay in sync:

- `window.__ready = true` — page signals renderer that setup is complete (set after scene JS runs, in codeAssembler's assembly)
- `window.__seekTo(time)` — seeks the paused master GSAP timeline to an arbitrary time; the renderer calls this once per frame
- `window.__masterTimeline`, `window.__registerScene(sceneId, tl, duration)`, `window.__getTotalDuration()` — master timeline plumbing defined in `globalSetupJs`
- Scene `jsCode` must use `{{SCENE_DURATION}}` placeholder (not hardcoded durations) since the actual per-scene duration is only known after TTS
- Scene `htmlCode`/`cssCode` may reference web-searched photos via the numbered `{{SCENE_IMAGE}}`, `{{SCENE_IMAGE_2}}`, `{{SCENE_IMAGE_3}}` placeholders (at most 3 per scene; the LLM decides the count per scene and the total across the video — it may exceed or fall below the scene count — via a matching `imagePrompt` array field, one query per photo) — the assembler swaps each token for a local path in index order
- GSAP only: no `setTimeout`/`setInterval`/`requestAnimationFrame`/CSS `@keyframes` (seek-based rendering can't capture those). The assembler preloads GSAP core + TextPlugin + MotionPathPlugin and injects global helpers `__splitTextChars` / `__splitTextWords` / `__pathLength` / `__rand` — the system prompt teaches the LLM to use them (Section 2C)

## LLM / TTS provider adapters

`src/llm/client.ts` and the TTS section of `audioSynth.ts` use the same pattern: an interface, one class per provider (plain `fetch` calls, no SDKs), and a factory singleton selected by config (LLM clients cached per provider so a runtime UI switch is picked up without a process restart). Add a provider by implementing the interface and wiring it into the factory + `config.ts` + `.env.example`.

Gotcha: DeepSeek model names from the Anthropic-compatible endpoint (`deepseek-v4-flash`, etc.) return empty/truncated responses on the OpenAI-compatible `chat/completions` endpoint — use `deepseek-chat`/`deepseek-reasoner` there.

## Server / API

`src/index.ts` is a Fastify app that also statically serves `web/` (vanilla JS, Vietnamese UI). Endpoints: auth (`POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `GET /api/auth/config`, `GET /api/auth/google`, `GET /api/auth/google/callback`), `POST /api/script/draft`, `POST /api/generate` (validates with zod, rate-limits 30/min per user, atomically reserves per-user quotas — concurrent/daily/budget, see config — with `429`, then persists to SQLite and enqueues; returns the real UUID immediately with `202`), `GET /api/jobs`, `GET /api/jobs/:id` (status + last 15 logs + result), `GET /api/jobs/:id/events` (SSE), `GET /api/jobs/:id/video` (range-supported stream), `GET /api/jobs/:id/download`, `GET /api/jobs/:id/preview/:sceneId`, `DELETE /api/jobs/:id` (also removes the workdir and reconciles quota reservation), `GET /api/settings`, `PUT /api/settings`, `GET /api/usage`, `GET /api/health` (DB + Redis diagnostics). Full reference in `docs/api.md`. The download/video/preview endpoints return 410 when the file has been cleaned up (job deleted or TTL-expired).

## Conventions

- ESM throughout (`"type": "module"`); source files import with `.js` extension (e.g. `from './config.js'`). Path alias `@/*` exists in tsconfig but the code uses relative imports.
- `tests/` is split into `unit/` and `integration/`; both are empty. The test script references `tests/integration/pipeline.test.ts`, which doesn't exist yet.
- `tmp/` holds job workdirs (gitignored); `npm test`/integration runs create artifacts there.
- Docs live in `README.md`, `docs/architecture.md`, `docs/api.md` — keep them in sync when architecture or endpoints change.
