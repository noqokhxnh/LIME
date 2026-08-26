# VidTML API Reference

Base URL: `http://localhost:3000` (see `PORT` in [README](../README.md#server--storage))

The API server is a Fastify app in `src/index.ts`. All endpoints are JSON unless noted. The web UI at `/` talks to this same API.

## Conventions

- **Content-Type:** `application/json` for request/response bodies (file endpoints return the file)
- **Errors:** non-2xx responses use `{"error": "..."}`, optionally with `details` (e.g. zod validation issues)
- **CORS:** enabled for any origin (`origin: true`) — fine for local dev, tighten for production
- **Job IDs:** UUID v4
- **Auth:** endpoints marked 🔒 require a valid session cookie (`vidtml_session`). Unauthenticated requests receive `401`. See [Authentication](#authentication) below.

## Endpoint index

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/register` | — | Create a new account |
| POST | `/api/auth/login` | — | Log in (sets session cookie) |
| POST | `/api/auth/logout` | — | Log out (clears session cookie) |
| GET | `/api/auth/me` | 🔒 | Current user profile |
| GET | `/api/auth/config` | — | Auth configuration (Google OAuth status) |
| GET | `/api/auth/google` | — | Start Google OAuth sign-in flow (redirects to Google) |
| GET | `/api/auth/google/callback` | — | Google OAuth callback handler |
| GET | `/api/health` | — | Health + DB/Redis diagnostics |
| GET | `/api/settings` | 🔒 | Provider list + user's current selection |
| PUT | `/api/settings` | 🔒 | Switch LLM/TTS provider at runtime (scoped to current user) |
| POST | `/api/script/draft` | 🔒 | Generate or regenerate a video script draft (Phase 1) |
| POST | `/api/generate` | 🔒 | Create a video generation job (direct or from confirmed draft) |
| GET | `/api/jobs` | 🔒 | List recent jobs (scoped to current user) |
| GET | `/api/jobs/:jobId` | 🔒 | Job status + progress logs + result + script |
| GET | `/api/jobs/:jobId/events` | 🔒 | Realtime SSE progress stream |
| GET | `/api/jobs/:jobId/video` | 🔒 | Stream the MP4 (HTTP range supported) |
| GET | `/api/jobs/:jobId/download` | 🔒 | Download the MP4 as attachment |
| GET | `/api/jobs/:jobId/preview/:sceneId` | 🔒 | Scene preview thumbnail (WebP) |
| DELETE | `/api/jobs/:jobId` | 🔒 | Cancel and delete a job + remove its files |
| GET | `/api/usage` | 🔒 | LLM token usage & cost report |

## Authentication

Session-based auth using HttpOnly cookies. Tokens are 32 random bytes; only the SHA-256 hash is stored in SQLite. The raw token lives in the `vidtml_session` cookie.

- **Session TTL:** 7 days
- **Cookie flags:** `HttpOnly`, `SameSite=Lax`, `Secure` in production
- **Password hashing:** bcryptjs (10 rounds)
- **Session cleanup:** expired sessions are pruned hourly by the API server
- **Google OAuth 2.0 & Account Linking:** Google 1-click SSO is supported via OpenID Connect (ID token verification with `jose`). When a user signs in with Google using an email that matches an existing password-based account, the Google account (`google_id`, `avatar_url`) is automatically linked to the existing user row (single unified user). Accounts created via Google have `password_hash = NULL` (password login disabled unless a password is set). The `avatarUrl` field appears in user profile responses (`GET /api/auth/me`, register, login) when an avatar is present.

### `POST /api/auth/register`

Create a new user account. Rate-limited to **20 registrations per hour per IP**.

Request body:

| Field | Type | Constraints |
|---|---|---|
| `username` | string | 3–30 chars, alphanumeric + underscore only (`/^[a-zA-Z0-9_]{3,30}$/`) |
| `email` | string | Valid email (optional, can be empty string) |
| `password` | string | 8–128 chars |

Example:

```json
{ "username": "user1", "email": "user@example.com", "password": "mypassword123" }
```

Responses:

- `201` → `{ "id": "...", "username": "user1", "email": "user@example.com", "avatarUrl": null, "createdAt": "..." }` + sets `vidtml_session` cookie
- `400` → `{ "error": "Invalid registration data", "details": [...] }`
- `409` → `{ "error": "Tên đăng nhập hoặc email đã tồn tại." }`
- `429` → `{ "error": "Too many registrations. Try again later." }`

### `POST /api/auth/login`

Authenticate and receive a session cookie. Rate-limited to **10 failed attempts per 15 minutes per IP+username**.

Request body:

```json
{ "username": "user1", "password": "mypassword123" }
```

Responses:

- `200` → `{ "id": "...", "username": "user1", "email": "...", "avatarUrl": null, "createdAt": "..." }` + sets `vidtml_session` cookie
- `400` → invalid request body
- `401` → `{ "error": "Invalid username or password" }` (generic — does not reveal whether the username exists)
- `429` → `{ "error": "Too many attempts. Try again in a few minutes." }`

### `POST /api/auth/logout`

Clears the session cookie and deletes the session row from SQLite. Works even without a valid session (idempotent).

- `200` → `{ "ok": true }`

### `GET /api/auth/me` 🔒

Returns the current authenticated user's profile.

```json
{ "id": "...", "username": "user1", "email": "user@example.com", "avatarUrl": null, "createdAt": "..." }
```

- `401` → session missing or expired (cookie is cleared)

### `GET /api/auth/config`

Returns public authentication configuration, indicating whether Google OAuth is configured and enabled.

Response `200`:

```json
{ "googleAuthEnabled": true }
```

### `GET /api/auth/google`

Initiates the Google OAuth 2.0 sign-in flow and redirects to the Google consent screen.

Query parameters:

| Parameter | Type | Description |
|---|---|---|
| `redirect` | string | Optional internal path to return to after login (default `/`). Whitelisted: must start with `/`, cannot start with `//` or contain `\`, max 512 characters. |

Responses:

- `302` → Sets a short-lived state cookie `vidtml_oauth_state` (`HttpOnly`, `SameSite=Lax`, TTL 10 minutes) and redirects to Google OAuth consent.
- `503` → `{ "error": "Google sign-in is not configured" }` when `GOOGLE_CLIENT_ID` or `GOOGLE_CLIENT_SECRET` is not set.

### `GET /api/auth/google/callback`

Google OAuth callback handler. Receives the authorization code and state parameter from Google, exchanges the code for an ID token, verifies the token claims with Google public keys (`jose`), creates or links the user account, sets the session cookie, and redirects to the stored target path. Rate-limited to **20 requests per minute per IP** (`rl:google_callback`).

Query parameters:

| Parameter | Type | Description |
|---|---|---|
| `code` | string | OAuth 2.0 authorization code from Google |
| `state` | string | Anti-CSRF state token |
| `error` | string | Present if the user denied consent or Google encountered an error |

Flow & behavior:
- Clears the `vidtml_oauth_state` cookie on all exit paths.
- Validates the `state` parameter against the cookie using timing-safe comparison (`timingSafeEqual`).
- Exchanges `code` for an ID token and verifies it using `jose` (checks issuer `https://accounts.google.com`, audience `GOOGLE_CLIENT_ID`, and algorithm `RS256`).
- Account linking (BR-05): if the verified Google email matches an existing account, links `google_id` and `avatar_url` to that user row (no duplicate account). If no account exists, creates a new user with `password_hash = NULL`.
- Sets session cookie `vidtml_session`.

Responses:

- `302` → Redirects to `stored.redirect` (sanitized internal path, default `/`) with active session.
- `302` (Fail path) → Redirects to `/?auth=open&error=google_auth_failed` when rate-limited, consent is rejected (`?error=`), parameters are missing, state mismatches, or Google ID token exchange/verification fails.

## Health

### `GET /api/health`

```json
{
  "status": "ok",
  "database": "sqlite_connected",
  "redis": "connected",
  "timestamp": "2026-08-21T10:00:00.000Z"
}
```

`redis` is `connected` or `disconnected` — the server still serves the UI and answers status queries without Redis; only queueing/SSE degrade.

## Settings

Provider selection is stored per user in the SQLite `settings` table (survives restarts) and takes precedence over env vars. API keys always come from `.env` — never sent over the wire.

### `GET /api/settings` 🔒

```json
{
  "llm": {
    "provider": "deepseek",
    "available": [
      { "id": "openai", "label": "OpenAI (GPT)", "keyConfigured": true, "model": "gpt-4o" },
      { "id": "gemini", "label": "Google Gemini", "keyConfigured": false, "model": "gemini-2.5-pro" },
      { "id": "claude", "label": "Anthropic Claude", "keyConfigured": false, "model": "claude-sonnet-4-20250514" },
      { "id": "deepseek", "label": "DeepSeek", "keyConfigured": true, "model": "deepseek-chat" }
    ]
  },
  "tts": {
    "provider": "edge",
    "available": [
      { "id": "edge", "label": "Edge TTS (miễn phí)", "keyConfigured": true, "model": null },
      { "id": "openai", "label": "OpenAI", "keyConfigured": true, "model": null },
      { "id": "google", "label": "Google", "keyConfigured": false, "model": null },
      { "id": "elevenlabs", "label": "ElevenLabs", "keyConfigured": false, "model": null }
    ]
  }
}
```

`keyConfigured` reflects whether the matching env var is set; `model` shows the configured env model (TTS has no model concept).

### `PUT /api/settings` 🔒

Request body (either or both fields):

```json
{ "llmProvider": "gemini", "ttsProvider": "edge" }
```

- `200` → `{ "ok": true }`
- `400` → `{ "error": "Unknown LLM provider: xyz" }` when the id isn't recognized
- `401` → not authenticated

## Jobs

### `POST /api/script/draft` 🔒

Generates or regenerates a video script draft (Phase 1) without initiating downstream rendering or allocating render quotas. Backed by the `script-draft` BullMQ queue.

This endpoint supports two modes:

#### 1. Create a new draft

Request body (`VideoRequestSchema`):

| Field | Type | Constraints | Default |
|---|---|---|---|
| `prompt` | string | 10–5000 chars | required |
| `aspectRatio` | string | `16:9` \| `9:16` \| `1:1` \| `4:3` | `16:9` |
| `targetDurationSec` | number | 10–300 | `60` |
| `language` | string | | `"vi"` |
| `style` | string | ≤ 200 chars | `"modern"` |

Example:

```json
{
  "prompt": "Giới thiệu về Hà Nội, 3 cảnh: Hồ Gươm, phố cổ, ẩm thực",
  "aspectRatio": "9:16",
  "targetDurationSec": 45,
  "language": "vi",
  "style": "cinematic"
}
```

Response `202 Accepted`:

```json
{
  "message": "Script draft queued",
  "jobId": "a1b2c3d4-...",
  "checkStatusUrl": "/api/jobs/a1b2c3d4-...",
  "eventsUrl": "/api/jobs/a1b2c3d4-.../events"
}
```

#### 2. Regenerate an existing draft with AI feedback

Request body:

| Field | Type | Constraints |
|---|---|---|
| `draftJobId` | string | UUID of existing draft job |
| `feedback` | string | ≥ 3 chars (guidance for AI revision) |

Example:

```json
{
  "draftJobId": "a1b2c3d4-...",
  "feedback": "Viết lời thoại hài hước và ngắn gọn hơn, thêm phần kêu gọi đăng ký ở cuối."
}
```

Response `202 Accepted`:

```json
{
  "message": "Draft regeneration queued",
  "jobId": "a1b2c3d4-...",
  "checkStatusUrl": "/api/jobs/a1b2c3d4-...",
  "eventsUrl": "/api/jobs/a1b2c3d4-.../events"
}
```

#### Draft behavior & status codes:
- **Rate limiting:** shares the `30 requests per minute per user` limit (`rl:generate`) with `/api/generate`. Returns `429` when exceeded.
- **Quota:** draft creation does **not** reserve video generation quota slots/budget.
- **Lifecycle:** `queued` → `running` → `draft` (or `failed`). Upon successful generation, the worker updates the status to `draft`, stores the script in SQLite, and emits the `draft_ready` SSE event.
- `202` → Draft creation or regeneration queued.
- `400` → Invalid request payload (e.g. prompt too short, or feedback < 3 chars).
- `401` → Not authenticated.
- `404` → `draftJobId` not found or not owned by the authenticated user.
- `409` → `{ "error": "Kịch bản đang được tạo hoặc không còn hiệu lực" }` (e.g. attempting regeneration while the draft is already in `running` or `queued` state).
- `429` → Rate limit exceeded.

---

### `POST /api/generate` 🔒

Creates and enqueues a full video rendering job. Supports two modes: confirmed draft rendering (the two-phase flow) or direct one-shot generation.

#### 1. Generate from confirmed draft (Two-Phase Flow)

Pass `draftJobId` and optional manual `scriptEdits`.

Request body:

| Field | Type | Constraints | Description |
|---|---|---|---|
| `draftJobId` | string | UUID of job in `draft` status | required |
| `scriptEdits` | object | Record of `sceneId` → `{ title?, voiceoverText? }` | optional manual edits to titles or voiceover text |

Example:

```json
{
  "draftJobId": "a1b2c3d4-...",
  "scriptEdits": {
    "scene_1": {
      "title": "Hồ Gươm Sáng Sớm",
      "voiceoverText": "Chào mừng bạn đến với thủ đô Hà Nội ngàn năm văn hiến."
    }
  }
}
```

Response `202 Accepted`:

```json
{
  "message": "Video generation queued from draft",
  "jobId": "e5f6g7h8-...",
  "checkStatusUrl": "/api/jobs/e5f6g7h8-...",
  "eventsUrl": "/api/jobs/e5f6g7h8-.../events"
}
```

When rendering from a confirmed draft:
- The pipeline skips Phase 1 (LLM script generation) entirely and proceeds directly to audio synthesis and downstream rendering using the confirmed script.
- Script edits are sanitized (control characters stripped) and merged into the script.
- Returns `400` if both `prompt` and `draftJobId` are supplied (`{ "error": "Cannot provide both prompt and draftJobId" }`).
- Returns `404` if `draftJobId` is not found or not owned by the user.
- Returns `409` if the draft job is not ready (`{ "error": "Kịch bản chưa sẵn sàng hoặc đã bị xóa" }`, status != `'draft'`).

#### 2. Direct one-shot generation

Request body (`VideoRequestSchema`):

```json
{
  "prompt": "Giới thiệu về Hà Nội, 3 cảnh: Hồ Gươm, phố cổ, ẩm thực",
  "aspectRatio": "9:16",
  "targetDurationSec": 45,
  "language": "vi",
  "style": "cinematic"
}
```

Response `202 Accepted`:

```json
{
  "message": "Video generation queued",
  "jobId": "a1b2c3d4-...",
  "checkStatusUrl": "/api/jobs/a1b2c3d4-...",
  "eventsUrl": "/api/jobs/a1b2c3d4-.../events"
}
```

#### Quotas & Rate Limits:
- Rate-limited to **30 requests per minute per user** (`429` rate limit).
- Per-user quotas (`QUOTA_MAX_CONCURRENT_JOBS` default 3, `QUOTA_MAX_DAILY_JOBS` default 20, `QUOTA_DAILY_BUDGET_USD` optional) are checked and reserved atomically before enqueueing. If exceeded, returns `429` with quota details.

---

### `GET /api/jobs` 🔒

Last 50 jobs **owned by the authenticated user**, newest first. Lightweight summaries for list views:

```json
{
  "jobs": [
    {
      "id": "a1b2c3d4-...",
      "status": "completed",
      "prompt": "Giới thiệu về Hà Nội...",
      "aspectRatio": "9:16",
      "style": "cinematic",
      "durationSec": 44.8,
      "scenes": 3,
      "createdAt": "2026-08-21T09:00:00.000Z",
      "updatedAt": "2026-08-21T09:03:00.000Z",
      "lastMessage": "[Pipeline] ✅ Pipeline complete in 182.4s"
    }
  ]
}
```

---

### `GET /api/jobs/:jobId` 🔒

Full job state: status, up to the last 15 progress logs, script (when present), draftJobId (when created from a draft), and the result when completed. Returns `404` for jobs owned by other users (no existence leak).

```json
{
  "id": "a1b2c3d4-...",
  "status": "completed",
  "progress": [
    { "phase": "script_generation", "progress": 0, "message": "[Pipeline] Phase 1: Generating script..." },
    { "phase": "render", "progress": 47, "message": "[Render] chunk scene_2: 1410/3000 frames" }
  ],
  "result": {
    "videoPath": "tmp/a1b2c3d4-.../Gioi_thieu_Ha_Noi.mp4",
    "durationSec": 44.8,
    "scenes": 3,
    "resolution": "1080x1920",
    "timing": { "scriptGeneration": 41.2, "audioSynthesis": 18.3, "imageGeneration": 12.1,
                "codeAssembly": 0.4, "preview": 3.1, "render": 96.5, "mux": 1.2 },
    "usage": { "requests": 1, "promptTokens": 2341, "completionTokens": 5120,
               "totalTokens": 7461, "estCostUsd": 0.012 },
    "videoUrl": "/api/jobs/a1b2c3d4-.../video",
    "downloadUrl": "/api/jobs/a1b2c3d4-.../download"
  },
  "error": null,
  "createdAt": "2026-08-21T09:00:00.000Z",
  "updatedAt": "2026-08-21T09:03:00.000Z",
  "script": {
    "title": "Hà Nội Ngàn Năm",
    "scenes": [
      {
        "id": "scene_1",
        "title": "Hồ Gươm",
        "voiceoverText": "Thủ đô Hà Nội...",
        "imagePrompt": "Hoan Kiem Lake Hanoi",
        "htmlCode": "...",
        "cssCode": "...",
        "jsCode": "..."
      }
    ],
    "colorPalette": { "primary": "#2f6bff", "secondary": "#ff6b4a", "background": "#0d1117", "text": "#ffffff", "accent": "#f59e0b" },
    "typography": { "headingFont": "Space Grotesk", "bodyFont": "Inter" }
  },
  "draftJobId": "d1e2f3a4-..."
}
```

- `status` — `queued` \| `running` \| `completed` \| `failed` \| `draft`
- `script` — present when a draft script has been generated (or attached to a render job)
- `draftJobId` — present on render jobs created from a confirmed draft
- `progress` — the `phase`/`progress`/`message` triple for each logged step (`script_generation`, `audio_synthesis`, `image_generation`, `code_assembly`, `preview`, `render`, `mux`)
- `result` — present only when `status === "completed"`; `usage` may be absent if no LLM usage was recorded for this job (e.g. render jobs created from confirmed drafts where Phase 1 was skipped)
- `error` — failure message when `status === "failed"`
- `404` → job not found or not owned by the current user

---

### `GET /api/jobs/:jobId/events` 🔒

Server-Sent Events stream. **Ownership check:** the handler verifies the job belongs to the authenticated user (returns `404` otherwise, no existence leak). On connect it replays the current state (one `status` event + up to 100 historical `progress` events from SQLite), then streams live events via Redis pub/sub. Heartbeat comments (`: heartbeat`) every 15 s. The stream closes 500 ms after `completed`/`failed`.

Event types:

```
event: status
data: {"status":"queued","jobId":"a1b2c3d4-..."}

event: progress
data: {"phase":"render","progress":47,"message":"[Render] chunk scene_2: 1410/3000 frames","createdAt":"..."}

event: draft_ready
data: {"jobId":"a1b2c3d4-..."}

event: completed
data: {"jobId":"a1b2c3d4-...","downloadUrl":"/api/jobs/a1b2c3d4-.../download",
       "result":{"videoPath":"...","durationSec":44.8,"scenes":3,"resolution":"1080x1920","timing":{...}}}

event: failed
data: {"error":"<failure message>"}
```

- `draft_ready` — emitted by `draftWorker` when Phase 1 script generation finishes and the draft is ready for review.
- `404` if the job doesn't exist or is not owned by the current user.
- If the job is already `completed`/`failed` when the client connects, the stream sends the terminal event and closes immediately.
- **Reconnection:** there is no `Last-Event-ID` support. On reconnect, the full history is replayed from SQLite (up to 100 events). If no heartbeat is received for >15 s, the client should reconnect.

---

### `GET /api/jobs/:jobId/video` 🔒

Streams the MP4 for inline playback (`<video>`). Supports HTTP range requests (`206 Partial Content` with `Content-Range`, `Accept-Ranges: bytes`).

- `404` — job not found, not owned, not completed, or has no video
- `410` — `{ "error": "Video file has been cleaned up" }` (job deleted or expired)

---

### `GET /api/jobs/:jobId/download` 🔒

Same file, but with `Content-Disposition: attachment; filename="vidtml_<jobId>.mp4"` for direct download. Same `404`/`410` semantics.

---

### `GET /api/jobs/:jobId/preview/:sceneId` 🔒

Scene preview thumbnail (WebP), generated in phase 4 for each scene at its timeline midpoint.

- `404` — job/scene has no preview, or not owned by current user
- `410` — preview file cleaned up

---

### `DELETE /api/jobs/:jobId` 🔒

Cancels the job in BullMQ (removes from queue if queued, sets a cancellation flag in Redis), deletes the job row (plus `job_logs`, via FK cascade), and recursively removes the workdir `tmp/<jobId>`. Only the job owner can delete.

For a job already running, cancellation is **cooperative**: the worker polls the Redis flag (~0.4 s) and aborts an `AbortSignal` threaded through every pipeline phase — LLM/TTS fetches, image searches/downloads, Playwright preview/render, and ffmpeg — so in-flight work stops within ~0.5 s instead of waiting for a phase boundary.

- `200` → `{ "message" }`, status-dependent:
  - running → `"Cancellation requested — the job will stop shortly"`
  - queued → `"Job removed from queue"`
  - otherwise → `"Job deleted"`
- `404` → job not found or not owned by the current user

---

## Usage

### `GET /api/usage` 🔒

LLM token usage & cost estimate. Aggregate totals, per provider+model breakdown (sorted by cost), and the 20 most recent records. Sourced from the JSONL log (when `USAGE_LOG_ENABLED`) or the in-memory ring buffer.

```json
{
  "totals": { "requests": 12, "promptTokens": 28100, "completionTokens": 61400, "estCostUsd": 0.152 },
  "byProviderModel": [
    { "provider": "deepseek", "model": "deepseek-chat", "requests": 12,
      "promptTokens": 28100, "completionTokens": 61400, "estCostUsd": 0.152 }
  ],
  "recent": [
    { "id": "...", "provider": "deepseek", "model": "deepseek-chat",
      "promptTokens": 2341, "completionTokens": 5120, "jobId": "a1b2c3d4-...",
      "timestamp": "2026-08-21T09:00:00.000Z" }
  ]
}
```

> **Note:** the usage report is scoped to the authenticated user. It aggregates only token usage and cost estimations for jobs initiated by the current user.

---

## Status codes summary

| Code | Meaning |
|---|---|
| 200 | OK (GET/PUT/DELETE success) |
| 201 | Account created (`POST /api/auth/register`) |
| 202 | Job or draft accepted and queued (`POST /api/generate`, `POST /api/script/draft`) |
| 206 | Partial content (range request on `/video`) |
| 400 | Invalid request body, conflicting parameters (prompt + draftJobId), or unknown provider |
| 401 | Not authenticated or session expired |
| 404 | Job, draft, video, or preview not found / not ready / not owned |
| 409 | Username/email already exists (`register`), draft already generating / invalid for regeneration (`POST /api/script/draft`), or draft not ready for render (`POST /api/generate`) |
| 410 | Files were cleaned up (deleted or expired) |
| 429 | Rate limit exceeded (login / registration / Google OAuth callback / draft / generate) or per-user quota exceeded (generate) |
| 503 | Google OAuth chưa cấu hình (`GET /api/auth/google`) |

---

## Example flow

### Two-Phase Flow (Draft → Edit/Confirm → Render)

```bash
# 0. Register / Login
curl -s -X POST localhost:3000/api/auth/register -H 'Content-Type: application/json' \
  -d '{"username":"demo","password":"password123"}' -c cookies.txt

# 1. Create a script draft (Phase 1)
DRAFT_RESP=$(curl -s -X POST localhost:3000/api/script/draft -H 'Content-Type: application/json' \
  -d '{"prompt":"Giới thiệu về Hà Nội","aspectRatio":"9:16","targetDurationSec":30}' \
  -b cookies.txt)
DRAFT_ID=$(echo $DRAFT_RESP | jq -r .jobId)

# 2. Follow draft generation in realtime (wait for "draft_ready" event)
curl -N localhost:3000/api/jobs/$DRAFT_ID/events -b cookies.txt

# 3. (Optional) Review draft script from SQLite
curl -s localhost:3000/api/jobs/$DRAFT_ID -b cookies.txt | jq .script

# 4. (Optional) Regenerate draft with AI feedback
# curl -s -X POST localhost:3000/api/script/draft -H 'Content-Type: application/json' \
#   -d "{\"draftJobId\":\"$DRAFT_ID\",\"feedback\":\"Lời thoại ngắn gọn hơn\"}" -b cookies.txt

# 5. Confirm draft & queue video rendering (with optional scene edits)
RENDER_RESP=$(curl -s -X POST localhost:3000/api/generate -H 'Content-Type: application/json' \
  -d "{\"draftJobId\":\"$DRAFT_ID\",\"scriptEdits\":{\"scene_1\":{\"title\":\"Mở đầu Hồ Gươm\"}}}" \
  -b cookies.txt)
JOB_ID=$(echo $RENDER_RESP | jq -r .jobId)

# 6. Follow render progress in realtime
curl -N localhost:3000/api/jobs/$JOB_ID/events -b cookies.txt

# 7. Play/download the result
curl -s localhost:3000/api/jobs/$JOB_ID/video -b cookies.txt -o video.mp4
curl -s -X DELETE localhost:3000/api/jobs/$JOB_ID -b cookies.txt   # free disk space
```

### Direct One-Shot Generation Flow

```bash
# Direct one-shot generation without draft review
curl -s -X POST localhost:3000/api/generate -H 'Content-Type: application/json' \
  -d '{"prompt":"Giới thiệu về Hà Nội","aspectRatio":"16:9","targetDurationSec":30}' \
  -b cookies.txt
```
