# VidTML Architecture

## System overview

```
┌────────────────────────┐        ┌────────────────────────────────────┐
│  Browser (3-panel      │        │  Redis                             │
│  workspace UI, vanilla │        │  ├─ BullMQ "video-generation"      │
│  JS served by Fastify) │        │  ├─ BullMQ "script-draft"          │
└──────────┬─────────────┘        │  └─ pub/sub "job-events:*"         │
           │ REST + SSE           └──────────┬─────────────────────────┘
           │ (session cookie)                │
┌──────────▼─────────────┐        ┌──────────▼─────────────────────────┐
│  API server            │        │  Worker(s) (src/worker.ts, BullMQ) │
│  (src/index.ts,        │◄───────│  ├─ draftWorker (script-draft)     │
│  Fastify)              │  poll  │  │  └─ generateScript()            │
│  - Auth (register/     │        │  │     └─ finalizeDraft()          │
│    login, session      │        │  └─ worker (video-generation)      │
│    cookies, bcryptjs)  │        │     └─ runPipeline(...)            │
│  - REST endpoints 🔒   │        │        (skips Phase 1 if confirmed)│
│  - SSE streaming       │        │        ▼                           │
│  - static web/         │        │  pipeline phases 1–6               │
└──────────┬─────────────┘        │  (script → TTS/img → HTML          │
           │                      │   → preview → render → mux)        │
┌──────────▼─────────────┐        │     │                              │
│  SQLite (shared)       │◄───────┼──┌──▼──┐ ┌──▼──┐ ...              │
│  jobs, job_logs,       │        │  │Chrom│ │Chrom│   (≤ RENDER       │
│  users, sessions,      │        │  └──┬──┘ └──┬──┘    MAX_CON-       │
│  settings,             │        │     └───┬───┘       CURRENCY)      │
│  image_search_cache    │        └─────────┼──────────────────────────┘
└──────────┬─────────────┘                  │
           │                  ┌─────────────▼──────┐
           └──────────────────│  Filesystem: tmp/<jobId>/   │
                              │  html, images/, audio,      │
                              │  raw_video.mp4, final.mp4,  │
                              │  previews (WebP)            │
                              └─────────────────────────────┘
```

Two long-running processes, both stateless enough to run on the same host or separately:

- **API server** (`src/index.ts`, Fastify) — REST endpoints, SSE, serves `web/`, auth (register/login/logout/me via session cookies). Never executes heavy pipeline phases.
- **Worker** (`src/worker.ts`, BullMQ) — hosts two workers:
  - `draftWorker`: consumes from `script-draft`, executes Phase 1 LLM script generation, persists the draft script to SQLite, and emits `draft_ready`.
  - `worker`: consumes from `video-generation`, executes the full multi-process video rendering pipeline (skipping Phase 1 when a confirmed script is supplied), persists logs/status to SQLite, and emits progress events.

Jobs submitted while the server is down still get picked up once a worker starts; the queue survives restarts.

## Authentication & quotas

Session-based auth (`src/auth/`). See [api.md § Authentication](api.md#authentication) for endpoint details.

- **Registration & login** (`/api/auth/register`, `/api/auth/login`) — creates a user row in SQLite, issues a session cookie (`vidtml_session`)
- **Session tokens** — 32 random bytes; only the SHA-256 hash is stored in the `sessions` table. Cookie flags: `HttpOnly`, `SameSite=Lax`, `Secure` in production. TTL: 7 days.
- **Password hashing** — bcryptjs, 10 rounds
- **Rate limiting** — Redis fixed-window counters (shared across instances, fail-open in-memory fallback when Redis is down): 10 login failures / 15 min per IP+username, 20 registrations / hour per IP, 30 generate/draft requests / min per user (`rl:generate`). `X-Forwarded-For` is only trusted when `TRUST_PROXY=1`.
- **Per-user generation quotas & Two-Phase Atomic Reservation** — atomic hold & reconcile on `POST /api/generate`: concurrent active jobs ≤ `QUOTA_MAX_CONCURRENT_JOBS` (default 3), jobs per UTC day ≤ `QUOTA_MAX_DAILY_JOBS` (default 20), optional daily USD budget (`QUOTA_DAILY_BUDGET_USD`). Uses Redis Lua scripts (with in-memory fallback) to atomically verify and reserve concurrent slots and estimated budget before enqueueing (preventing race conditions and financial overrun on burst requests), with post-execution settlement upon job completion, failure, or cancellation.
- **Drafts vs. quotas:**
  - `POST /api/script/draft` does **not** reserve quota upfront (no `reserveJobQuota` call).
  - While generating (`queued` or `running`), draft jobs transiently count toward the user's active concurrent job limit.
  - Once in `'draft'` status, a draft job does not occupy an active concurrent slot.
  - Quota is reserved when the user confirms the draft and calls `POST /api/generate`.
  - LLM token usage and cost for draft generation are tracked and attributed to the draft `jobId` in `usage` records. When the confirmed render job runs, it skips Phase 1, incurring 0 LLM token cost (its result usage records no LLM tokens, reflecting only downstream TTS/rendering execution).
- **Job ownership** — every job carries a `user_id` FK. All job endpoints verify ownership; non-owned jobs return `404` (no existence leak).
- **Cleanup** — expired sessions are pruned hourly by the API server (`deleteExpiredSessions`)

Most API endpoints require a valid session (`requireAuth` preHandler). Public endpoints: `GET /api/health` and the auth routes themselves.

## Data stores

| Store | What it holds | Notes |
|---|---|---|
| Redis | BullMQ queues `video-generation` and `script-draft`; pub/sub channels `job-events:<jobId>` | Queues keep last 100 completed/failed jobs (`removeOnComplete`/`removeOnFail`) |
| SQLite | `jobs` (status, request/result JSON, `script_json`, `draft_job_id`, `user_id` FK), `job_logs` (per-phase progress), `users` + `sessions` (auth), `settings` (user-scoped runtime provider selection), `image_search_cache` (Commons results) | WAL mode; schema applied idempotently on startup (`src/db/schema.ts`); DB at `DB_PATH` (default `tmp/vidtml.sqlite`) |
| Filesystem | Per-job workdir `tmp/<jobId>/`: `html/`, `images/`, TTS audio files, `raw_video.mp4`, final MP4, preview WebPs | Removed on `DELETE /api/jobs/:id` or by the worker's 24 h TTL cleaner |

## Job & draft lifecycle

VidTML supports both a two-phase draft flow and a direct one-shot generation flow.

### Two-Phase Flow (Draft → Edit/Confirm → Render)

```
Phase 1: Draft Generation / Revision
POST /api/script/draft 🔒
      │  (VideoRequestSchema OR {draftJobId, feedback})
      ▼
   queued ──► running ──► draft    (emits 'draft_ready' SSE event, stores script_json)
                 │
                 ▼
              failed

Phase 2: Confirmed Render
POST /api/generate 🔒
      │  ({draftJobId, scriptEdits?}) ──► reserveJobQuota() ──► createJob(status='queued', script)
      ▼
   queued ──► running ──► completed (skips Phase 1 LLM gen; renders video, previews, timing)
                 │            │
                 ▼            ▼
              failed       (SSE + polling reflect terminal state)
```

### Direct One-Shot Flow

```
POST /api/generate 🔒
      │  (VideoRequestSchema with prompt) ──► reserveJobQuota()
      ▼
   queued ──► running ──► completed (runs Phases 1–6 sequentially/in parallel)
                 │
                 ▼
              failed
```

- Statuses: `queued | running | completed | failed | draft` — persisted in SQLite by worker handlers (`updateJobStatus`, `finalizeDraft`).
- `attempts: 1` — failed jobs and drafts are not retried automatically to prevent runaway LLM/render costs on transient issues. Users can trigger AI regeneration or resubmit manually.
- Every progress event is both appended to `job_logs` (history) and published to Redis pub/sub (realtime).
- The worker runs a TTL cleaner every 30 min: jobs older than 24 h (and their workdirs) are deleted.

## Background workers & queues

`src/worker.ts` runs two BullMQ worker instances against Redis:

1. **`draftWorker` (`script-draft` queue):**
   - Consumes draft generation jobs (`enqueueScriptDraft`).
   - Marks status `running` and logs progress.
   - Calls `generateScript(...)` with cancellation signal propagation.
   - On success: calls `finalizeDraft(jobId, script)` in `jobsRepository.ts`, transitioning job status to `'draft'` and saving `script_json`. Publishes `draft_ready` event to Redis channel `job-events:<jobId>`.
   - On error: updates status to `'failed'` and publishes `failed` event.

2. **`worker` (`video-generation` queue):**
   - Consumes full video generation jobs (`enqueueVideoJob`).
   - If a confirmed `script` is passed in job data (from `POST /api/generate` with `draftJobId`), it passes it directly to `runPipeline()`.
   - On completion: saves `result_json`, marks status `'completed'`, reconciles quota, and publishes `completed` event.

Both workers share cooperative cancellation (`watchJobCancellation` polling `job-cancelled:<jobId>` in Redis every ~0.4 s) and handle graceful shutdown via `Promise.all([worker.close(), draftWorker.close()])`.

## Database schema & migrations

The SQLite schema (`src/db/schema.ts`) defines the `jobs` table:

```sql
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'completed', 'failed', 'draft')),
  request_json TEXT NOT NULL,
  result_json TEXT,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  script_json TEXT,
  draft_job_id TEXT
);
```

### Table-rebuild migration (`src/db/index.ts`)
SQLite does not permit altering an existing column's `CHECK` constraint via `ALTER TABLE`. To seamlessly upgrade existing databases that lack `script_json` or the `'draft'` status in the `CHECK` constraint:
1. The migration inspects `PRAGMA table_info(jobs)`.
2. If `script_json` is missing, it runs a table-rebuild inside an exclusive transaction (`BEGIN EXCLUSIVE`) with `PRAGMA foreign_keys=OFF`.
3. Renames `jobs` → `jobs_old` and `job_logs` → `job_logs_old`.
4. Creates the new `jobs` and `job_logs` tables with the updated schema and CHECK constraints.
5. Copies all existing data across (`INSERT INTO jobs ... SELECT ..., NULL, NULL FROM jobs_old`).
6. Drops temporary tables, recreates indices (`idx_jobs_status`, `idx_jobs_created_at`, `idx_job_logs_job_id`, `idx_jobs_user_id`), commits, re-enables foreign keys (`PRAGMA foreign_keys=ON`), and runs `PRAGMA foreign_key_check`.

## Pipeline phases

`runPipeline()` (`src/pipeline/orchestrator.ts`) drives the phases. Each phase reports progress via an `onProgress` callback (`phase`, `progress` 0–100, `message`) and writes artifacts consumed by the next phase.

### 1. Script generation — `scriptGenerator.ts`

When generating from scratch (one-shot or draft worker), calls the LLM with the system prompt in `src/llm/prompts/system.txt`, validates output against `VideoScriptSchema` (zod, `src/llm/schema.ts`), and retries up to 3× with the prior error appended to the prompt. The script contains per-scene HTML/CSS/GSAP JS, voiceover text, image prompts, transitions, palette, and fonts.

**Orchestrator script-skip behavior:** when `options.script` is provided to `runPipeline()` (i.e. rendering from a confirmed draft), Phase 1 LLM generation is **bypassed completely**:
- `timing.scriptGeneration = 0`
- Logs `[Pipeline] Phase 1: Using confirmed draft script (${script.scenes.length} scenes)`
- Proceeds immediately to Phase 2 with the user's confirmed/edited script.

**Fail-fast contract validation:** after zod validation, `scriptValidator.ts` checks the script against the full HTML↔renderer contract before any downstream phases execute. This includes:
- Unique scene IDs and matching DOM container elements (`<div class="scene" id="scene_id">`)
- `globalSetupJs` syntax and required runtime globals (`window.__seekTo`, `window.__registerScene`, `window.__masterTimeline`, `window.__getTotalDuration`)
- Per-scene `jsCode` syntax, `{{SCENE_DURATION}}` placeholder presence, and `window.__registerScene('scene_id', tl, dur)` invocation
- Determinism patterns (rejection of `setTimeout`, `setInterval`, `requestAnimationFrame`, CSS `@keyframes`)
- Security patterns (rejection of `eval`, `Function`, `fetch`, `<script>` tags, inline event handlers)

Any contract violation throws a descriptive error that is appended to the retry prompt (`⚠️ PREVIOUS ATTEMPT FAILED WITH ERROR:`), enabling the LLM to self-correct up to 3× *before* expensive audio synthesis or image fetching occurs.

### 2a. Audio synthesis — `audioSynth.ts`

TTS per scene (sequential, to avoid rate limits), probes each file with ffprobe for duration, concatenates, optionally mixes BGM at low volume (`bgmPath`). Produces `sceneDurations` — a sceneId → seconds map that is the **source of truth for animation timing**. Runs in parallel with 2b.

### 2b. Image generation — `imageGenerator.ts`

Per-scene Wikimedia Commons photo search (`src/image/client.ts`), downloads the top candidate into `html/images/`, returns a sceneId → relative-path map. Scenes without an `imagePrompt` field are skipped (no query spent); failures fall back to a transparent GIF data URI so layouts hold. Search results are cached in SQLite (`image_search_cache`) so repeat queries cost nothing; per-job query cap `IMAGE_MAX_QUERIES_PER_JOB` (cache hits don't count). Commons full-text search is strict, so queries that return nothing have trailing words dropped and are retried ("Hồ Gươm cổ kính" → "Hồ Gươm"). Candidates are ranked by aspect-ratio fit.

### 3. Code assembly — `codeAssembler.ts`

Replaces `{{SCENE_DURATION}}` placeholders in each scene's `jsCode` with the real TTS-measured duration and `{{SCENE_IMAGE}}` in `htmlCode`/`cssCode` with the downloaded photo path (or transparent GIF), performs final fail-closed contract and JS syntax validation with actual durations (`scriptValidator.ts`), and assembles one self-contained HTML file. Any syntax or contract failure throws and aborts rather than attempting a broken render.

The assembler also injects helper globals (`window.__sm()` and `window.__fx()`) into every page — these are factory functions for the stickman character rig and comic FX (see [styles.md § Section 6](styles.md#6-cải-tiến-stickman-2026-08-22)). The injection is unconditional (~5KB) because the LLM output schema has no `style` field to gate on.

### 4. Preview — `previewer.ts`

Optional (skipped when `skipPreview` is set). Playwright seeks the GSAP timeline to each scene's midpoint and saves WebP thumbnails.

### 5. Render — `parallelRenderer.ts`

Splits the timeline into per-scene chunks and renders them **in parallel** across isolated Playwright Chromium instances (≤ `RENDER_MAX_CONCURRENCY`, default 4). Each chunk screenshots every frame (`__seekTo(time)`), pipes PNGs into an ffmpeg `image2pipe` (libx264) to produce a silent chunk MP4; chunks are concatenated with the ffmpeg concat demuxer **without re-encoding**. Frame rate is currently hardcoded to 30 fps in the orchestrator.

### 6. Mux — `muxer.ts`

ffmpeg muxes the raw video + mixed audio (`-shortest`, AAC, `+faststart`) into the final MP4, named after the script title (sanitized). Returns duration and file size.

### Timing budget

`timing` (per-phase seconds) is collected in `FullPipelineResult.timing` and surfaced in the API — useful for spotting slow phases.

> **Caveat:** phases 2a (audio) and 2b (images) run in parallel via `Promise.all`, but both `timing.audioSynthesis` and `timing.imageGeneration` are measured from the same `phaseStart` to the same end point. They therefore both report `max(audio, image)` time, not the individual phase duration. Keep this in mind when profiling.

## The HTML↔renderer contract (critical)

The LLM-generated HTML must expose specific globals that phases 4–5 rely on. This contract is enforced by the system prompt — **the schema, prompt, and renderer must stay in sync:**

- `window.__ready = true` — page signals setup is complete (set after scene JS runs, in codeAssembler's assembly)
- `window.__seekTo(time)` — seeks the paused master GSAP timeline to an arbitrary time; the renderer calls this once per frame
- `window.__masterTimeline`, `window.__registerScene(sceneId, tl, duration)`, `window.__getTotalDuration()` — master timeline plumbing defined in `globalSetupJs`
- Scene `jsCode` must use the `{{SCENE_DURATION}}` placeholder (not hardcoded durations) — the real per-scene duration is only known after TTS
- Scene `htmlCode`/`cssCode` may reference a web-searched photo via `{{SCENE_IMAGE}}` (at most once per scene; the LLM decides which scenes get photos, via a matching `imagePrompt` field) — the assembler swaps it for a local path
- GSAP only: no `setTimeout`/`setInterval`/`requestAnimationFrame`/CSS `@keyframes` — seek-based rendering can't capture those
- `window.__sm(opts)` — stickman character factory (injected by codeAssembler); returns SVG string
- `window.__fx(type, opts)` — comic FX factory (injected by codeAssembler); returns positioned `<div>`

## Frontend workspace architecture

The web frontend (`web/`) is organized as a 3-panel studio workspace:

1. **Panel 1: Workspace Sidebar (Project History):**
   - Displays previous jobs and drafts owned by the user (`Dự án` header with badge count).
   - Card items show thumbnail previews, status pill, aspect ratio, scene count, duration, and last status message.
   - Includes refresh button and empty/error states.

2. **Panel 2: Center Workspace (Tabs):**
   - **Tab *"Xem video"* (Monitor):** HTML5 video player, metadata spec cards (duration, scenes, resolution, status), direct MP4 download button, and copy-link button.
   - **Tab *"Kịch bản"* (Script Editor & Review):** Managed by `web/js/scriptTab.js`.
     - Stats bar: estimated duration, word count, scene count, visual style.
     - Color palette swatches: visual representation of LLM-chosen theme colors (`primary`, `secondary`, `background`, `text`, `accent`).
     - Scene cards: editable cards per scene with auto-growing textareas for `title` and `voiceoverText`.
     - Diff tracking: `getScriptEdits()` compares current textarea values against the original draft to send only modified fields.
     - Raw JSON viewer: collapsible JSON inspector and copy button.
     - Confirmation CTA: *"Duyệt kịch bản & Tạo video"* button triggers `POST /api/generate` with `draftJobId` and `scriptEdits`.
     - AI Revision Card: feedback textarea and *"Tạo lại theo phản hồi"* button triggers `POST /api/script/draft` with `{ draftJobId, feedback }`.

3. **Panel 3: Right Panel (Configuration & Progress):**
   - Input configuration form: prompt textarea with character counter, quick inspiration chips, technical selects (aspect ratio, duration, language, style).
   - Real-time progress box: phase-by-phase status bar and live log output connected via SSE.

**Draft-First UX Flow:** By default, submitting the form calls `POST /api/script/draft`. When the SSE stream receives `draft_ready`, the UI activates the *Kịch bản* tab for review and adjustment.

## Provider adapters

LLM (`src/llm/client.ts`) and TTS (`src/pipeline/audioSynth.ts`) use the same pattern: an interface, one class per provider (plain `fetch` calls, no SDKs), and a factory singleton selected by config.

| Domain | Providers |
|---|---|
| LLM | `openai` (GPT), `gemini`, `claude` (Anthropic), `deepseek` |
| TTS | `edge` (msedge-tts, free, Vietnamese neural voices), `openai`, `google`, `elevenlabs` |

**Precedence:** the provider selected at runtime in the web UI (stored per user in the SQLite `settings` table) wins over the `*_PROVIDER` env var; API keys always come from `.env`. LLM clients are cached per provider so a UI switch is picked up without a process restart.

> Gotcha: DeepSeek model names from the Anthropic-compatible endpoint (`deepseek-v4-flash`, etc.) return empty/truncated responses on the OpenAI-compatible `chat/completions` endpoint — use `deepseek-chat`/`deepseek-reasoner` there.

## Usage tracking & cost estimation

`src/usage/` records every LLM call (provider, model, prompt/completion tokens, jobId, userId, timestamp):

- In-memory ring buffer (last 200 records) + optional JSONL append log (`USAGE_LOG_ENABLED`, default `tmp/usage.jsonl`)
- Cost estimation via `src/usage/pricing.ts`, overridable per model with `USAGE_PRICE_OVERRIDES`
- Exposed via `GET /api/usage` 🔒 (aggregate report scoped per authenticated user) and per-job in the job result (`usage` field)

## Concurrency & scaling knobs

| Knob | Default | What it controls |
|---|---|---|
| `WORKER_CONCURRENCY` | 2 | Jobs a single worker processes simultaneously |
| `RENDER_MAX_CONCURRENCY` | 4 | Chromium/ffmpeg processes spawned per job |
| multiple workers | — | Run several `npm run worker` processes for more parallelism |

## Reliability & cleanup

- Queue survives restarts (Redis); jobs persisted in SQLite with full progress history
- SSE replays state for late-connecting clients (status + last 100 logs from SQLite, then live Redis events); no `Last-Event-ID` support — reconnecting clients receive the full replay
- Jobs are never auto-cleaned immediately; workdirs are removed by `DELETE /api/jobs/:id` or by the 24 h TTL cleaner in the worker; the video endpoint returns 410 once files are gone
- **Cooperative cancellation** — `DELETE /api/jobs/:id` sets a Redis flag (`job-cancelled:<jobId>`, 1 h TTL). The worker polls it every ~0.4 s (`watchJobCancellation`) and aborts an `AbortSignal` threaded through every phase (`src/pipeline/cancel.ts`: `throwIfAborted`/`raceWithAbort`): LLM/TTS fetches, image searches/downloads, Playwright previews and per-frame renders, and ffmpeg subprocesses all stop in-flight (worst case ≈ one poll + one frame/TTS segment), throwing `JobCancelledError` which cleans the workdir without marking the job `failed`. The DELETE response message reflects this: running jobs get "cancellation requested", queued jobs "removed from queue".
- Failed jobs keep their error message in `error_message` for diagnosis
- `image_search_cache` rows are not cleaned by the job TTL cleaner; they grow independently (TTL controlled by `IMAGE_CACHE_TTL_DAYS` but no background pruner exists yet)

## Security model (untrusted LLM code)

The LLM writes `globalSetupJs` and per-scene `htmlCode`/`cssCode`/`jsCode` that runs almost directly in a headless Chromium process — prompt injection can become JavaScript executing on the render host. Defense is layered:

1. **OS sandbox (default on)** — render/preview Chromium launch with the Chromium sandbox enabled via the shared helper `launchChromium()` (`src/pipeline/browser.ts`). The old `--no-sandbox`/`--disable-setuid-sandbox` flags are gone. On hosts where the sandbox can't start (e.g. containers without unprivileged user namespaces) the job fails at launch with operator guidance; setting `RENDER_ALLOW_NO_SANDBOX=1` opts back into unsandboxed mode with a loud warning.
2. **Fail-closed code gate** — `scriptValidator.ts` and `codeAssembler.ts` scan every scene's `jsCode`, `htmlCode`, `cssCode` and `globalSetupJs` against `SECURITY_PATTERNS` (eval, `Function` ctor, fetch, XHR, sendBeacon, WebSocket, dynamic import, Worker, `document.write`; HTML additionally: curated event-handler attributes, embedded `<script>`) as well as non-deterministic timers (`setTimeout`, `setInterval`, `requestAnimationFrame`, `@keyframes`). Any match **throws** fail-fast in Phase 1 (for LLM retry) and Phase 3 (aborting assembly before render).
3. **CSP** — the assembled page carries a strict Content-Security-Policy: `default-src 'none'`, `script-src 'unsafe-inline'` (no `'unsafe-eval'`, so eval/`Function` are blocked natively), `connect-src 'none'` (network exfiltration dead at browser level), images/fonts restricted to `file:`/`data:`.
4. **Network block** — the renderer's `page.route` aborts every non-`file://`/`data:` request.

The OS sandbox is the load-bearing layer; layers 2–4 are defense in depth.

## Tests

- **Unit tests** (`tests/unit/`): `codeAssembler.test.ts` (HTML assembly, stickman helper injection, duration injection, `__ready` flag); `db.test.ts` (SQLite schema, jobs CRUD)
- **Integration tests** (`tests/integration/`): directory exists but no tests yet

## Deployment & containerization (Docker)

VidTML is packaged as a multi-container Docker application orchestrated via Docker Compose (`docker-compose.yml`):

- **`redis`**: Standalone Redis 7 instance with AOF persistence.
- **`server`**: Fastify HTTP server serving the Web UI, handling authentication, and streaming SSE events (`npm start`).
- **`worker`**: BullMQ video processing worker with Playwright Chromium, FFmpeg, and Unicode/Vietnamese fonts pre-installed (`npm run worker`). Configured with `shm_size: 2gb` to handle parallel Chromium headless rendering instances smoothly.
- **Shared volumes**:
  - `vidtml_data` (`/app/tmp`): Shared volume between Server and Worker for SQLite database (`vidtml.sqlite`), generated video files, previews, and usage JSONL logs.
  - `redis_data` (`/data`): Persistent storage for Redis queue jobs and metadata.

```bash
docker compose up --build
```

## Roadmap

The system is intentionally built in layers so new domains slot in without restructuring. Planned / under consideration:

- **Job history & re-generation** — replay a previous job's request with a modified prompt
- **Custom BGM** — `bgmPath` already flows through the queue (`VideoJobData`); only the UI wiring is missing
- **Config wiring** — `DEFAULT_FPS`/`DEFAULT_WIDTH`/`DEFAULT_HEIGHT` are validated in config but not yet consumed by the pipeline (fps is hardcoded to 30; dimensions come from `VIDEO_PRESETS`)
- **Image cache pruner** — `image_search_cache` rows are never cleaned; a periodic pruner based on `IMAGE_CACHE_TTL_DAYS` is planned

