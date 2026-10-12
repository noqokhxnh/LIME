---
name: pr-review
description: "Review code on a GitHub pull request. Fetches the PR diff, analyzes it for bugs, security issues, performance, error handling, tests and repo conventions, then produces a structured review in chat. Posts the review to GitHub only on explicit user confirmation."
version: 1.0.0
---

# PR Review

## Purpose

Turn a GitHub PR (a URL or `owner/repo#number`) into a structured code review: one verdict plus findings grouped by severity. Read-only by default — nothing is ever posted to GitHub unless the user explicitly asks for it.

## Tooling

Uses the `github` CLI (GitHub's official MCP server). Requires the github skill's connection — run `github status` first; it must show `"authenticated": true`. Agents without this CLI can follow the same workflow with any GitHub API client (`gh`, REST).

Commands used, in workflow order:

```bash
# 1. PR metadata — no approval needed
github call-read-tool --name list_pull_requests \
  --arguments-json '{"owner":"<owner>","repo":"<repo>","state":"open"}'

# 2a. Full diff — triggers one approval
github call-tool --name pull_request_read \
  --arguments-json '{"method":"get_diff","owner":"<owner>","repo":"<repo>","pullNumber":<n>}'

# 2b. Changed-file list (for large diffs) — triggers one approval
github call-tool --name pull_request_read \
  --arguments-json '{"method":"get_files","owner":"<owner>","repo":"<repo>","pullNumber":<n>,"perPage":100}'

# 2c. Read any file at the PR head — no approval needed
github call-read-tool --name get_file_contents \
  --arguments-json '{"owner":"<owner>","repo":"<repo>","path":"<path>","sha":"<head-sha>"}'

# 3. Post the review — only after explicit user confirmation (triggers approval)
github call-tool --name pull_request_review_write \
  --arguments-json '{"method":"create","owner":"<owner>","repo":"<repo>","pullNumber":<n>,"body":"<review>","event":"COMMENT"}'
```

`event` can be `COMMENT` (default), `APPROVE`, or `REQUEST_CHANGES` — use whichever the user names; default to `COMMENT`.

## Workflow

1. **Resolve the PR.** Parse `owner`, `repo`, `pullNumber` from the user's message or URL. If ambiguous, ask — never guess.
2. **Gather context (no approval).** `list_pull_requests` for title, body, author, head/base branches and SHAs, draft status. If the repo is unfamiliar, skim its layout with `get_file_contents` (`path: ""`) and read key configs (package.json, README) at the base SHA.
3. **Get the changes.** Prefer `get_diff`. If the diff is truncated or very large (roughly >400 changed lines or >20 files), use `get_files` instead, then read the highest-risk files at the head SHA with `get_file_contents` — those reads need no extra approval. Also fetch `get_review_comments` when the user asks for a follow-up review, to avoid repeating resolved threads.
4. **Analyze** per `references/review-rubric.md`. Check correctness first, then security, error handling, performance, tests, and repo conventions — in that order of priority.
5. **Write the review** per the Output Contract, in the PR's language (e.g. a Vietnamese PR gets a Vietnamese review) or the user's chat language when they differ.
6. **Present in chat.** Then offer to post it as a GitHub review. Never post without the user explicitly confirming, and always show them the exact review text before posting — the approval prompt alone is not confirmation of *what* gets posted.

## Output Contract

- **Verdict line** — pick one, with a one-line reason:
  - ✅ Looks good — safe to merge
  - 💬 Comments — some issues worth addressing, merge is the author's call
  - 🔴 Request changes — blocking issues found
- **Summary** — 2–4 sentences on what the PR does and its overall shape (size, risk areas).
- **Findings**, grouped by severity (skip empty groups):
  - 🔴 Critical — bugs, security holes, data-loss risks
  - 🟡 Should fix — logic smells, missing tests, performance regressions, API inconsistencies
  - 🟢 Nit — naming, style, typos
  - Each finding: `file:line` + what's wrong + why it matters + concrete suggested fix.
- **Questions for the author** — max 3, only when intent is genuinely unclear.
- Keep it tight: at most ~10 findings, merge duplicates, no filler praise.

## Repo notes (LIME)

- PRs in this repo are often written in Vietnamese — write the review in Vietnamese in that case.
- Frontend is vanilla JS (`frontend/`), backend is TypeScript + Fastify (`src/`).
- Watch for XSS in `innerHTML` usage — the codebase uses an `esc()` helper; flag unescaped interpolations of dynamic data.
- Auth is session-based; new page routes follow the existing pattern of serving a public HTML shell with auth enforced at the API layer.

## Operating Rules

1. Never invent file contents or line numbers — cite only what the diff or fetched files actually show.
2. If the diff can't be fetched, say so and stop. Never review from the PR description alone.
3. Don't request changes over pure style nits.
4. Don't repeat findings from already-resolved review threads on a re-review — check `get_review_comments` first.
5. Match the review language to the PR.
6. The skill produces the review; posting, approving, or requesting changes on GitHub always needs the user's explicit go-ahead.
