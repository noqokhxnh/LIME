# Review Rubric

Check in priority order. Stop at the first level that yields blocking findings only if time is short; otherwise cover all levels and rank findings by severity.

## 1. Correctness

- Does the code do what the PR description claims? Trace the main path mentally.
- Off-by-one errors, wrong conditionals (`&&` vs `||`, `<` vs `<=`), inverted booleans.
- Null/undefined handling on every external input (API responses, user input, file reads, env vars).
- Async bugs: unawaited promises, race conditions, missing error propagation in promise chains.
- State management: stale closures, unintended shared mutable state, incorrect dependency arrays.

## 2. Security

- Injection: SQL, shell, XSS (unescaped HTML), template injection, log injection.
- AuthN/AuthZ: missing checks on new endpoints, IDOR (user A accessing user B's resource), privilege escalation.
- Secrets: hardcoded keys/tokens, secrets logged or returned in API responses.
- File handling: path traversal on uploads, unrestricted file types/sizes, SVG/XML bomb or XXE via parsers, unsanitized filenames.
- Dependencies: newly added packages — are they well-maintained, do they duplicate existing deps?
- CORS, CSRF, rate limiting on new public endpoints.

## 3. Error handling & edge cases

- Every fallible operation (network, disk, DB, subprocess) has a failure path — no silent swallowing.
- Error messages: useful to the caller, no stack traces or internals leaked to end users.
- Timeouts and retries on outbound calls; no unbounded waits.
- Resource cleanup: file handles, DB connections, browser pages closed in `finally`.

## 4. Performance

- N+1 queries, unbounded pagination, loading full tables into memory.
- Hot paths: repeated serialization, regex in loops, sync I/O in request handlers.
- Caching: missing where obviously beneficial, or stale-cache invalidation bugs.
- Frontend: unnecessary re-renders, large unoptimized assets, blocking the main thread.

## 5. Tests

- Are the changed behaviors covered? New branches need new tests, not just the happy path.
- Tests that can't fail (no assertions), tests coupled to implementation details, flaky timing-based tests.
- If the repo has CI, note when new code arrives with zero tests.

## 6. Conventions & maintainability

- Follow the repo's existing patterns (naming, structure, error types) — flag deviations, don't impose outside styles.
- Dead code, commented-out blocks, leftover TODOs/debug logs.
- Public API/docs: new endpoints, env vars, or config options must be documented (README, .env.example, API docs).
- Migration/back-compat: breaking changes to stored data, APIs, or config should be called out explicitly.

## Severity guide

- 🔴 Critical: wrong behavior in production, exploitable security issue, data loss/corruption.
- 🟡 Should fix: likely bug under edge conditions, missing test for new logic, clear perf regression, undocumented breaking change.
- 🟢 Nit: style, naming, typo — mention only if cheap to fix, never block on these.
