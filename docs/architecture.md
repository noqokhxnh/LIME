# LIME Architecture

## System overview

```
┌────────────────────────┐        ┌────────────────────────────────────┐
│  Browser (3-panel      │        │  Redis                             │
│  workspace UI, vanilla │        │  ├─ BullMQ "video-generation"      │
│  JS served by Fastify) │        │  ├─ BullMQ "script-draft"          │
└──────────┬─────────────┘        │  ├─ BullMQ "sepay-webhooks"        │
           │ REST + SSE           │  └─ pub/sub "job-events:*"         │
           │ (session cookie)     └──────────┬─────────────────────────┘
┌──────────▼─────────────┐                   │
│  API server            │                   │
│  (src/index.ts,        │◄──────────────────┤
│  Fastify)              │        poll       │
│  - Auth (register/     │                   │
│    login, session      │        ┌──────────▼─────────────────────────┐
│    cookies, bcryptjs)  │        │  Worker(s) (src/worker.ts, BullMQ) │
│  - REST endpoints 🔒   │        │  ├─ draftWorker (script-draft)     │
│  - SSE streaming       │        │  ├─ worker (video-generation)      │
│  - static frontend/    │        │  │  └─ runPipeline(...)            │
│  - VietQR billing &    │        │  │     (skips Phase 1 if confirmed)│
│    brand kit APIs      │        │  │     ▼                           │
└──────────┬─────────────┘        │  │  pipeline phases 1–6            │
           │                      │  │  (script → TTS/img → HTML       │
┌──────────▼─────────────┐        │  │   → preview → render → mux)     │
│  PostgreSQL (shared)   │◄───────┤  ├─ billingQueue (sepay-webhooks)  │
│  users, sessions,      │        │  │  └─ fulfill order / reconcile   │
│  system_settings,      │        │  │                                 │
│  audit_logs, brand_kit,│        │  │Chrom│ │Chrom│   (≤ RENDER       │
│  plans, orders,        │        │  └──┬──┘ └──┬──┘    MAX_CON-       │
│  payments, refunds     │        │     └───┬───┘       CURRENCY)      │
└────────────────────────┘        └─────────┼──────────────────────────┘
                                            │
                                  ┌─────────▼──────────────────────────┐
┌────────────────────────┐        │  Filesystem: tmp/<jobId>/          │
│  VieNeu-TTS Service    │◄───────┤  html, images/, audio,             │
│  (port 7860, Python    │        │  raw_video.mp4, final.mp4,         │
│  Vietnamese neural TTS)│        │  previews (WebP)                   │
└────────────────────────┘        └────────────────────────────────────┘
```

Long-running services in the architecture:

- **API server** (`src/index.ts`, Fastify) — REST endpoints, SSE, static assets & views served from `frontend/` (`index.html`, `workspace.html`, `profile.html`, `settings.html`, `admin.html`, `legal.html`), session-based auth, Brand Kit uploads, and VietQR billing APIs. Never executes heavy video rendering phases.
- **Worker** (`src/worker.ts`, BullMQ) — hosts background queues:
  - `draftWorker`: consumes from `script-draft`, executes Phase 1 LLM script generation, persists the draft script, and emits `draft_ready`.
  - `worker`: consumes from `video-generation`, executes the full multi-process video rendering pipeline (skipping Phase 1 when a confirmed script is supplied), and publishes progress events.
  - `billingQueue`: consumes from `sepay-webhooks`, validates bank transaction records, and atomically fulfills subscription orders.
- **VieNeu-TTS microservice** (`services/vieneu-tts/`, port 7860) — dedicated Vietnamese neural speech synthesis service providing high-fidelity Vietnamese voiceovers.
- **PostgreSQL 13+** — persistent relational storage for user accounts, sessions, subscription billing, brand kits, and system configurations.
- **Redis 7+** — distributed message broker for BullMQ queues, realtime SSE pub/sub events, cooperative cancellation flags, and atomic rate-limiting counters.

Jobs submitted while the server is down still get picked up once a worker starts; queues and relational data survive process restarts.

## Authentication & quotas

Session-based auth (`src/auth/`). See [api.md § Authentication](api.md#authentication) for endpoint details.

- **Registration & login** (`/api/auth/register`, `/api/auth/login`) — creates a user row in PostgreSQL (`users` table), issues a session cookie (`vidtml_session`).
- **Session tokens** — 32 random bytes; only the SHA-256 hash is stored in the `sessions` table. Cookie flags: `HttpOnly`, `SameSite=Lax`, `Secure` in production. TTL: 7 days.
- **Password hashing** — bcryptjs, 10 rounds.
- **Google OAuth 2.0 & Account Linking** — OpenID Connect verification via `jose`. Accounts created with Google have `password_hash = NULL`. Existing email accounts automatically link `google_id`.
- **Role-Based Access Control (RBAC)** — `role` (`user` | `admin`) and subscription `tier` (`free` | `creator` | `pro` | `max` | `enterprise`) governing access to `/admin` portal routes and generation quotas.
- **Rate limiting** — Redis fixed-window counters (shared across instances, fail-open in-memory fallback when Redis is down): 10 login failures / 15 min per IP+username, 20 registrations / hour per IP, 30 generate/draft requests / min per user (`rl:generate`). `X-Forwarded-For` is only trusted when `TRUST_PROXY=1`.
- **Per-user generation quotas & Two-Phase Atomic Reservation** — atomic hold & reconcile on `POST /api/generate`: concurrent active jobs ≤ `QUOTA_MAX_CONCURRENT_JOBS` (default 3), jobs per UTC day ≤ `QUOTA_MAX_DAILY_JOBS` (default 20), optional daily USD budget (`QUOTA_DAILY_BUDGET_USD`). Uses Redis Lua scripts (with in-memory fallback) to atomically verify and reserve concurrent slots and estimated budget before enqueueing (preventing race conditions and financial overrun on burst requests), with post-execution settlement upon job completion, failure, or cancellation.
- **Drafts vs. quotas:**
  - `POST /api/script/draft` does **not** reserve quota upfront (no `reserveJobQuota` call).
  - While generating (`queued` or `running`), draft jobs transiently count toward the user's active concurrent job limit.
  - Once in `'draft'` status, a draft job does not occupy an active concurrent slot.
  - Quota is reserved when the user confirms the draft and calls `POST /api/generate`.
  - LLM token usage and cost for draft generation are tracked and attributed to the draft `jobId` in `usage` records. When the confirmed render job runs, it skips Phase 1, incurring 0 LLM token cost.
- **Job ownership** — every job carries a `user_id` FK. All job endpoints verify ownership; non-owned jobs return `404` (no existence leak).
- **Cleanup** — expired sessions are pruned hourly by the API server (`deleteExpiredSessions`).

## Data stores

| Store | What it holds | Notes |
|---|---|---|
| PostgreSQL | `users`, `sessions`, `system_settings`, `audit_logs`, `brand_kits`, `plans`, `orders`, `payments`, `unmatched_payments`, `refunds` | Initialized via `src/database/index.ts` (`pg` Pool); schema applied idempotently on startup (`src/database/base.ts`); configured with `DATABASE_URL` |
| Redis | BullMQ queues (`video-generation`, `script-draft`, `sepay-webhooks`); pub/sub channels `job-events:<jobId>`; rate-limit counters & cancellation flags | Queues retain completed/failed job records per retention policy |
| Filesystem | Per-job workdir `tmp/<jobId>/`: `html/`, `images/`, TTS audio files, `raw_video.mp4`, final MP4, preview WebPs | Removed on `DELETE /api/jobs/:id` or by the worker's 24 h TTL cleaner |

## Job & draft lifecycle

LIME supports both a two-phase draft flow and a direct one-shot generation flow.

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

- Statuses: `queued | running | completed | failed | draft` — tracked in BullMQ / queue stores.
- `attempts: 1` — failed jobs and drafts are not retried automatically to prevent runaway LLM/render costs on transient issues. Users can trigger AI regeneration or resubmit manually.
- Every progress event is published to Redis pub/sub (realtime) and logged.
- The worker runs a TTL cleaner every 30 min: scratch workdirs older than 24 h are deleted.

## Background workers & queues

`src/worker.ts` runs BullMQ worker instances against Redis:

1. **`draftWorker` (`script-draft` queue):**
   - Consumes draft generation jobs (`enqueueScriptDraft`).
   - Marks status `running` and logs progress.
   - Calls `generateScript(...)` with cancellation signal propagation.
   - On success: transitions job status to `'draft'` and saves `script_json`. Publishes `draft_ready` event to Redis channel `job-events:<jobId>`.
   - On error: updates status to `'failed'` and publishes `failed` event.

2. **`worker` (`video-generation` queue):**
   - Consumes full video generation jobs (`enqueueVideoJob`).
   - If a confirmed `script` is passed in job data (from `POST /api/generate` with `draftJobId`), it passes it directly to `runPipeline()`.
   - On completion: saves result metadata, marks status `'completed'`, reconciles quota, and publishes `completed` event.

3. **`billingQueue` (`sepay-webhooks` queue, `src/billing/queue.ts`):**
   - Consumes incoming SePay payment webhook payloads asynchronously.
   - Ensures sub-50ms HTTP 200 responses to the banking webhook caller while processing reconciliation safely in the background.
   - Matches order pay codes (`LIME...`), updates orders to `'paid'`, and adds user credits.

Workers share cooperative cancellation (`watchJobCancellation` polling `job-cancelled:<jobId>` in Redis every ~0.4 s) and handle graceful shutdown on process termination signals.

## Database schema & idempotent migrations

PostgreSQL schemas are managed in `src/database/base.ts` and executed automatically during startup by `initDatabase()` (`src/database/index.ts`):

```sql
-- Core user accounts & roles
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY,
    username VARCHAR(30) NOT NULL,
    email VARCHAR(255) NOT NULL,
    password_hash TEXT,
    google_id VARCHAR(255),
    role VARCHAR(20) NOT NULL DEFAULT 'user',
    tier VARCHAR(20) NOT NULL DEFAULT 'free',
    credits INTEGER NOT NULL DEFAULT 20,
    total_credits INTEGER NOT NULL DEFAULT 20,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    deleted_at TIMESTAMPTZ,
    preferences JSONB DEFAULT '{}'::jsonb,
    plan_id VARCHAR(50),
    plan_expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Authentication sessions
CREATE TABLE IF NOT EXISTS sessions (
    token_hash CHAR(64) PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Brand kit & logo watermark configurations
CREATE TABLE IF NOT EXISTS brand_kits (
    user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    logo_url    TEXT NOT NULL,
    position    VARCHAR(20) NOT NULL DEFAULT 'top-right',
    scale_pct   NUMERIC(5,2) NOT NULL DEFAULT 15,
    opacity     NUMERIC(4,3) NOT NULL DEFAULT 0.8,
    x_pct       NUMERIC(5,2),
    y_pct       NUMERIC(5,2),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- VietQR Billing Plans, Orders, Payments, and Refunds
CREATE TABLE IF NOT EXISTS plans (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    price_vnd INTEGER NOT NULL CHECK (price_vnd > 0),
    quota_video INTEGER NOT NULL DEFAULT 0,
    days INTEGER NOT NULL DEFAULT 30,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_id VARCHAR(50) NOT NULL REFERENCES plans(id),
    amount_vnd INTEGER NOT NULL,
    pay_code VARCHAR(50) NOT NULL UNIQUE,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    expires_at TIMESTAMPTZ NOT NULL,
    claimed_at TIMESTAMPTZ,
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    sepay_ref VARCHAR(100) NOT NULL UNIQUE,
    amount_vnd INTEGER NOT NULL,
    raw JSONB NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    result VARCHAR(20) NOT NULL
);

CREATE TABLE IF NOT EXISTS unmatched_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sepay_ref VARCHAR(100) NOT NULL UNIQUE,
    amount_vnd INTEGER NOT NULL,
    content TEXT NOT NULL,
    raw JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    admin_note TEXT,
    resolved_by VARCHAR(100),
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS refunds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_type VARCHAR(20) NOT NULL,
    source_id VARCHAR(100) NOT NULL,
    sepay_ref VARCHAR(100) NOT NULL,
    amount_vnd INTEGER NOT NULL,
    bank_account VARCHAR(50) NOT NULL,
    bank_name VARCHAR(100) NOT NULL,
    admin_note TEXT,
    refunded_by VARCHAR(100),
    refunded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

All migrations are designed to run idempotently on database initialization using `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, and `CREATE UNIQUE INDEX IF NOT EXISTS`.

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

TTS per scene (sequential, to avoid rate limits), probes each file with ffprobe for duration, concatenates, optionally mixes BGM at low volume (`bgmPath`).
Supported voice providers:
- `vieneu` — local Vietnamese neural voice synthesis via `VIENEU_TTS_URL` (high naturalness and native Vietnamese prosody)
- `edge` — Microsoft Edge Neural voices (free, no API key required)
- `openai`, `google`, `elevenlabs` — commercial cloud voice engines

Produces `sceneDurations` — a sceneId → seconds map that is the **source of truth for animation timing**. Runs in parallel with 2b.

### 2b. Image generation — `imageGenerator.ts`

Per-scene Wikimedia Commons photo search (`src/image/client.ts`), downloads candidate images into `html/images/`, returns a sceneId → relative-path map. Scenes without an `imagePrompt` field are skipped (no query spent); failures fall back to a transparent GIF data URI so layouts hold. Commons search query cap is `IMAGE_MAX_QUERIES_PER_JOB`. Commons full-text search is strict, so queries that return nothing have trailing words dropped and are retried ("Hồ Gươm cổ kính" → "Hồ Gươm"). Candidates are ranked by aspect-ratio fit.

### 3. Code assembly — `codeAssembler.ts`

Replaces `{{SCENE_DURATION}}` placeholders in each scene's `jsCode` with the real TTS-measured duration and `{{SCENE_IMAGE}}` in `htmlCode`/`cssCode` with the downloaded photo path (or transparent GIF), performs final fail-closed contract and JS syntax validation with actual durations (`scriptValidator.ts`), and assembles one self-contained HTML file. Any syntax or contract failure throws and aborts rather than attempting a broken render.

The assembler also injects helper globals (`window.__sm()` and `window.__fx()`) into every page — factory functions for the stickman character rig and comic FX (see [styles.md § Section 6](styles.md#6-cải-tiến-stickman-2026-08-22)).

### 4. Preview — `previewer.ts`

Optional (skipped when `skipPreview` is set). Playwright seeks the GSAP timeline to each scene's midpoint and saves WebP thumbnails.

### 5. Render — `parallelRenderer.ts`

Splits the timeline into per-scene chunks and renders them **in parallel** across isolated Playwright Chromium instances (≤ `RENDER_MAX_CONCURRENCY`, default 4). Each chunk screenshots every frame (`__seekTo(time)`), pipes PNGs into an ffmpeg `image2pipe` (libx264) to produce a silent chunk MP4; chunks are concatenated with the ffmpeg concat demuxer **without re-encoding**. Frame rate is currently hardcoded to 30 fps in the orchestrator.

### 6. Mux & Brand Kit Overlay — `muxer.ts` & `watermarkFilter.ts`

ffmpeg muxes the raw video + mixed audio (`-shortest`, AAC, `+faststart`) into the final MP4, named after the script title (sanitized). If the user has a configured brand kit (or passes watermark options), `watermarkFilter.ts` generates FFmpeg overlay filter configurations to place the logo at the chosen corner (`top-left`, `top-right`, `bottom-left`, `bottom-right`) or custom coordinates with configured opacity and scaling.

### Timing budget

`timing` (per-phase seconds) is collected in `FullPipelineResult.timing` and surfaced in the API — useful for spotting slow phases.

## The HTML↔renderer contract (critical)

The LLM-generated HTML must expose specific globals that phases 4–5 rely on. This contract is enforced by the system prompt — **the schema, prompt, and renderer must stay in sync:**

- `window.__ready = true` — page signals setup is complete (set after scene JS runs, in codeAssembler's assembly)
- `window.__seekTo(time)` — seeks the paused master GSAP timeline to an arbitrary time; the renderer calls this once per frame
- `window.__masterTimeline`, `window.__registerScene(sceneId, tl, duration)`, `window.__getTotalDuration()` — master timeline plumbing defined in `globalSetupJs`
- Scene `jsCode` must use the `{{SCENE_DURATION}}` placeholder (not hardcoded durations) — the real per-scene duration is only known after TTS
- Scene `htmlCode`/`cssCode` may reference web-searched photos via `{{SCENE_IMAGE}}`, `{{SCENE_IMAGE_2}}`, `{{SCENE_IMAGE_3}}` (the assembler swaps each token for a local path in index order)
- GSAP only: no `setTimeout`/`setInterval`/`requestAnimationFrame`/CSS `@keyframes` — seek-based rendering can't capture those
- `window.__sm(opts)` — stickman character factory (injected by codeAssembler); returns SVG string
- `window.__fx(type, opts)` — comic FX factory (injected by codeAssembler); returns positioned `<div>`

## Brand Kit & Watermark Subsystem

LIME includes an integrated Brand Kit engine for creator branding:
- **Logo Storage & Security** (`src/security/uploadGuard.ts`): supports PNG, JPEG, WebP, and SVG files (with comprehensive XML/SVG sanitization against XXE, XSS, foreign objects, and malicious event attributes).
- **Custom Positioning**: preset positions (`top-left`, `top-right`, `bottom-left`, `bottom-right`) and arbitrary coordinates (`x_pct`, `y_pct`), with customizable scaling (`5%` - `50%`) and opacity (`0.1` - `1.0`).
- **Video Overlay Filter** (`src/pipeline/watermarkFilter.ts`): constructs hardware-optimized FFmpeg video filter complexes to superimpose the sanitized brand logo into the rendered stream.

## VietQR & SePay Billing Subsystem

LIME integrates automated banking payment gateway support for the Vietnamese market:
- **Specification**: Complete technical specification in `docs/dac-ta-thanh-toan-vietqr.pdf`.
- **Plans**: `creator` (149k VND, 50 videos), `pro` (249k VND, 150 videos), `max` (499k VND, 500 videos).
- **Payment Lifecycle**: `pending` → `claimed` ("Tôi đã chuyển khoản") → `paid` (or `expired`/`cancelled`).
- **SePay Webhook Integration**: Sub-50ms immediate acknowledgment, queuing background verification into BullMQ (`sepay-webhooks`). HMAC-SHA256 signature verification, anti-replay timestamp validation, and IP allowlist enforcement.
- **Admin Reconciliation**: Admin portal views for unmatched bank transfers, duplicate payments, manual resolution, and bank refund recording.

## Frontend workspace architecture

The web frontend (`frontend/`) is organized as a 3-panel studio workspace (`workspace.html`, `workspace.js`):

1. **Panel 1: Workspace Sidebar (Project History):**
   - Displays previous jobs and drafts owned by the user (`Dự án` header with badge count).
   - Card items show thumbnail previews, status pill, aspect ratio, scene count, duration, and last status message.
   - Includes refresh button and empty/error states.

2. **Panel 2: Center Workspace (Tabs):**
   - **Tab *"Xem video"* (Monitor):** HTML5 video player, metadata spec cards (duration, scenes, resolution, status), direct MP4 download button, and copy-link button.
   - **Tab *"Kịch bản"* (Script Editor & Review):**
     - Stats bar: estimated duration, word count, scene count, visual style.
     - Color palette swatches: visual representation of LLM-chosen theme colors (`primary`, `secondary`, `background`, `text`, `accent`).
     - Scene cards: editable cards per scene with auto-growing textareas for `title` and `voiceoverText`.
     - Diff tracking: compares current textarea values against the original draft to send only modified fields.
     - Raw JSON viewer: collapsible JSON inspector and copy button.
     - Confirmation CTA: *"Duyệt kịch bản & Tạo video"* button triggers `POST /api/generate` with `draftJobId` and `scriptEdits`.
     - AI Revision Card: feedback textarea and *"Tạo lại theo phản hồi"* button triggers `POST /api/script/draft` with `{ draftJobId, feedback }`.

3. **Panel 3: Right Panel (Configuration & Progress):**
   - Input configuration form: prompt textarea with character counter, quick inspiration chips, technical selects (aspect ratio, duration, language, style).
   - Real-time progress box: phase-by-phase status bar and live log output connected via SSE.

**Draft-First UX Flow:** By default, submitting the form calls `POST /api/script/draft`. When the SSE stream receives `draft_ready`, the UI activates the *Kịch bản* tab for review and adjustment.

Additional frontend pages:
- `frontend/index.html` — Landing page and quick generation interface.
- `frontend/admin.html` — Super Admin portal for user management, order review, payment reconciliation, and system settings.
- `frontend/profile.html` — User profile, usage stats, and credit consumption history.
- `frontend/settings.html` — AI and TTS provider runtime configurations.
- `frontend/legal.html` — Terms of Service and Privacy Policy.

## Provider adapters

LLM (`src/llm/client.ts`) and TTS (`src/pipeline/audioSynth.ts`) use an interface with one class per provider (plain `fetch` calls, no SDKs) and factory singletons:

| Domain | Providers |
|---|---|
| LLM | `deepseek`, `gemini`, `claude`, `openai`, `9router` |
| TTS | `vieneu` (Vietnamese neural voice microservice, port 7860), `edge` (free), `openai`, `google`, `elevenlabs` |

**Precedence:** the provider selected at runtime in the web UI (stored per user in PostgreSQL `users.preferences` JSONB or `system_settings`) wins over the `*_PROVIDER` env var; API keys always come from `.env`. LLM clients are cached per provider so a UI switch is picked up without a process restart.

## Usage tracking & cost estimation

`src/usage/` records every LLM call (provider, model, prompt/completion tokens, jobId, userId, timestamp):

- In-memory ring buffer (last 200 records) + optional JSONL append log (`USAGE_LOG_ENABLED`, default `tmp/usage.jsonl`)
- Cost estimation via `src/usage/pricing.ts`, overridable per model with `USAGE_PRICE_OVERRIDES`
- Exposed via `GET /api/usage` 🔒 (aggregate report scoped per authenticated user) and per-job in the job result (`usage` field)

## Concurrency & scaling knobs

| Knob | Default | What it controls |
|---|---|---|
| `WORKER_CONCURRENCY` | 2 | Video jobs a single worker processes simultaneously |
| `RENDER_MAX_CONCURRENCY` | 4 | Chromium/ffmpeg processes spawned per video job |
| multiple workers | — | Run several `npm run worker` processes for more parallelism |

## Reliability & cleanup

- Queue survives restarts (Redis); user accounts and financial data persisted in PostgreSQL.
- SSE replays state for late-connecting clients (status + historical logs from the job log, then live Redis events).
- Jobs scratch directories are removed by `DELETE /api/jobs/:id` or by the 24 h TTL cleaner in the worker; video endpoints return 410 once files are pruned.
- **Cooperative cancellation** — `DELETE /api/jobs/:id` sets a Redis flag (`job-cancelled:<jobId>`, 1 h TTL). The worker polls it every ~0.4 s (`watchJobCancellation`) and aborts an `AbortSignal` threaded through every phase (`src/pipeline/cancel.ts`: `throwIfAborted`/`raceWithAbort`): LLM/TTS fetches, image downloads, Playwright previews, per-frame renders, and ffmpeg subprocesses all stop in-flight, throwing `JobCancelledError` which cleans scratch files without corrupting state.

## Security model (untrusted LLM code)

The LLM writes `globalSetupJs` and per-scene `htmlCode`/`cssCode`/`jsCode` that runs in a headless Chromium process. Defense is layered:

1. **OS sandbox (default on)** — render/preview Chromium launch with the Chromium sandbox enabled via `launchChromium()` (`src/pipeline/browser.ts`). Setting `RENDER_ALLOW_NO_SANDBOX=1` opts into unsandboxed mode with explicit logging.
2. **Fail-closed code gate** — `scriptValidator.ts` and `codeAssembler.ts` scan code against `SECURITY_PATTERNS` (eval, `Function` ctor, fetch, XHR, sendBeacon, WebSocket, dynamic import, Worker, `document.write`; HTML: event-handler attributes, embedded `<script>`) and non-deterministic timers (`setTimeout`, `setInterval`, `requestAnimationFrame`, `@keyframes`). Any match throws fail-fast in Phase 1 (for LLM retry) and Phase 3 (aborting assembly before render).
3. **CSP** — the assembled page carries a strict Content-Security-Policy: `default-src 'none'`, `script-src 'unsafe-inline'`, `connect-src 'none'`, images/fonts restricted to `file:`/`data:`.
4. **Network block** — the renderer's `page.route` aborts every non-`file://`/`data:` request.

## Tests

LIME has a comprehensive automated test suite:
- **Unit tests** (`tests/unit/`, 19+ test suites with 690+ assertions across 40+ suites):
  - GSAP timeline AST linter & contract safety (`schema.test.ts`, `scriptGenerator.test.ts`, `assembler.test.ts`)
  - Stickman character rig, IK geometry, and line-boil motion
  - Audio ducking, loudness normalization, and BeatSync
  - CDP frame capture deduplication
  - Canvas2D & Three.js time-driver determinism
  - Brand Kit upload validation and Watermark FFmpeg filters (`uploadGuard.test.ts`, `watermarkFilter.test.ts`)
  - VietQR payment reconciliation and Admin refund operations (`admin.test.ts`, `admin_failed_payments.test.ts`, `billing_refunds.test.ts`)
  - Quota reservations and security guards
- **Integration tests** (`tests/integration/`):
  - `billing_vietqr.test.ts`: end-to-end VietQR order creation, claiming, and webhook reconciliation flow
  - `watermark.test.ts`: video watermark rendering and composition verification
  - `tests/manual/vieneu.manual.ts`: kiểm tra tay kết nối VieNeu-TTS (không phải test tự động — không có `assert`, cần service Docker)

Run tests:
```bash
npm run test:unit:pr     # nhóm chạy ở mọi PR (fast + tích hợp rẻ), nhanh
npm run test:unit        # test đơn vị: fast + heavy
npm run test:coverage    # đo độ phủ + cổng chất lượng 70% dòng (toàn bộ suite)
npm run test:e2e         # pipeline 6 giai đoạn (nặng)
```

## Deployment & containerization (Docker)

LIME is packaged as a multi-container Docker application orchestrated via Docker Compose (`docker-compose.yml`):

- **`redis`**: Standalone Redis 7 instance (`lime_redis`) with AOF persistence.
- **`postgres`**: PostgreSQL 13 database (`lime_postgres`) storing user accounts, sessions, system settings, brand kits, and billing records.
- **`vieneu-tts`**: Dedicated Python microservice (`lime_vieneu_tts`, port 7860) running the Vietnamese neural voice synthesis model.
- **`server`**: Fastify HTTP server (`lime_server`) serving the `frontend/` UI, handling authentication, REST APIs, and SSE streams (`npm run dev` / `npm start`).
- **`worker`**: BullMQ video processing and billing webhook worker (`lime_worker`) with Playwright Chromium, FFmpeg, and Unicode/Vietnamese fonts pre-installed (`npm run worker`). Configured with `shm_size: 2gb` to handle parallel Chromium headless rendering instances smoothly.
- **Volumes**:
  - `postgres_data` (`/var/lib/postgresql/data`): Persistent storage for PostgreSQL database.
  - `redis_data` (`/data`): Persistent storage for Redis queue jobs and metadata.
  - `lime_data` (`/app/tmp`): Shared volume between Server and Worker for video scratch files, previews, and usage logs.

Run with:
```bash
docker compose up --build
```
