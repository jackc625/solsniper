# RugCheck API Wiring Audit — Research

**Researched:** 2026-05-26
**Mode:** quick-task (audit)
**Audit target:** `src/safety/checks/tier2-rugcheck.ts`
**Confidence:** HIGH (findings backed by live OpenAPI spec + live HTTP probes of the production API)

---

## Summary Verdict

**Is the wiring correct? PARTIALLY — the endpoint, schema, and score handling are correct, but the authentication wiring is the bug.**

The current code targets the **right host, right path, and right response schema** — all three are confirmed correct against the live RugCheck OpenAPI spec and live API responses. The score inversion math is also correct.

**Most likely root cause (HIGH confidence):**
`GET /v1/tokens/{mint}/report/summary` is a **PUBLIC endpoint that requires NO authentication**. Verified live: with *no* credential it returns `HTTP 200` with valid data. **The moment you attach a credential that the server rejects, it returns `HTTP 401 {"error":"invalid api key"}` instead of serving the public data.**

The code *unconditionally* sends an `X-API-KEY` header on every request. So if the configured `RUGCHECK_API_KEY` was wrong, expired, or simply not accepted via the `X-API-KEY` header for this endpoint, **every call returned 401**, which the code swallows into its pessimistic path: `pass: true, score: 0, detail: "HTTP 401"`. Because `pass` is always `true` and the failure is silent (only a `log.warn`), the RugCheck signal silently contributed `score=0` to every token forever — exactly the reported symptom of "did not seem to be working."

There is a second, subtle aggravator: an **empty** `X-API-KEY` header (`''`, sent when `RUGCHECK_API_KEY` is undefined) is treated as *absent* → `HTTP 200`. So the check **works when no key is set** but **breaks when a bad key is set**. Issuing a new key and configuring it will only fix the bug *if* RugCheck accepts that key via the `X-API-KEY` header (see Gap 1 — this is the one item I could not fully verify without the live key, and it carries real risk).

> Verbatim live evidence (wrapped SOL mint, `So111...112`):
> ```
> [no X-API-KEY header at all]          HTTP 200  {"score":1,"score_normalised":1,"lpLockedPct":0,...}
> [X-API-KEY: '' (empty string)]        HTTP 200  {"score":1,...}
> [X-API-KEY: bogus]                    HTTP 401  {"error":"invalid api key"}
> [X-API-KEY: well-formed-fake-UUID]    HTTP 401  {"error":"invalid api key"}
> [Authorization: <fake>]               HTTP 401  {"error":"invalid api key"}
> [Authorization: Bearer <fake>]        HTTP 401  {"error":"invalid api key"}
> [?key=<fake> query param]             HTTP 401  {"error":"invalid api key"}
> ```
> Source: live probe of `https://api.rugcheck.xyz/v1/tokens/{mint}/report/summary`, 2026-05-26.

---

## 5-Point Gap Analysis

### 1. Authentication mechanism — **MISMATCH (root cause)**

- **(a) What the code does:** Unconditionally sends an `X-API-KEY: <apiKey>` request header (line 89, 101). When `apiKey` is `undefined` it sends `X-API-KEY: ''`. No query param, no `Authorization` header.
- **(b) What the real API requires:**
  - The `GET /v1/tokens/{id}/report/summary` endpoint has **`security: undefined` in the OpenAPI spec — it is PUBLIC and requires NO auth.** `[VERIFIED: https://api.rugcheck.xyz/swagger/doc.json — path security block]`
  - The **only** auth scheme defined in the entire spec is `ApiKeyAuth = { type: apiKey, in: header, name: "Authorization", description: "JWT token for authentication" }`. It is **`Authorization` (a JWT), NOT `X-API-KEY`.** This scheme is attached only to *write/POST* endpoints (`POST /v1/tokens/verify`, `/vote`, `/report`, `/bulk/*`, and `GET .../lockers`). `[VERIFIED: https://api.rugcheck.xyz/swagger/doc.json — securityDefinitions]`
  - Live behavior: presenting **any** credential value (`X-API-KEY`, `Authorization`, bare or `Bearer`, or `?key=`) that the server cannot validate returns `HTTP 401 {"error":"invalid api key"}`. Presenting **no** credential returns `HTTP 200`. `[VERIFIED: live probe, 2026-05-26]`
- **(c) Verdict: MISMATCH.** For this endpoint, the correct number of auth headers is **zero**. Sending an unvalidated `X-API-KEY` converts a working public call into a 401. The endpoint does **not** require auth; auth (per the user's account page `?key=`) exists to *raise rate limits*, not to gate access.

**Is the endpoint public, so the symptom is rate-limiting not auth-rejection?** The endpoint *is* public, but the symptom is **auth-rejection (401), not rate-limiting.** A 15-call rapid burst against the public endpoint returned `200 ×15` with **no** `x-ratelimit-*` headers and no 429. `[VERIFIED: live burst probe, 2026-05-26]` Rate limiting demonstrably exists on RugCheck historically (their own announcement: *"We have implemented a rate limit on token checks due to users & unauthorised services abusing the system"* `[CITED: https://x.com/Rugcheckxyz/status/1724408835446595911]`), so it is a *secondary* possible cause under heavy load — but the primary, reproducible failure here is the 401 from the rejected `X-API-KEY`.

> ⚠️ **The one thing I could NOT verify (and it matters):** whether RugCheck accepts the user's *valid* new key via the **`X-API-KEY`** header for this endpoint. The spec only documents the key going in the **`Authorization`** header (and the account page shows a **`?key=`** query param). I tested only *invalid* keys (all 401). It is therefore possible that even the correct new key in `X-API-KEY` will still 401, and the integration must move the key to `?key=` or `Authorization`. This is flagged as `[ASSUMED-RISK]` in Recommended Fixes.

---

### 2. Endpoint / path — **MATCH**

- **(a) What the code does:** `GET https://api.rugcheck.xyz/v1/tokens/{mint}/report/summary` (lines 7, 81).
- **(b) What the real API requires:** `GET /v1/tokens/{id}/report/summary` — "Get token report summary" — exists and is the correct path on host `api.rugcheck.xyz`. `[VERIFIED: https://api.rugcheck.xyz/swagger/doc.json — paths]` Live call returns 200 with the expected body. `[VERIFIED: live probe]`
- **(c) Verdict: MATCH.** Host, version prefix (`/v1`), and path are all correct.

**Summary vs full `/report`:** The full `GET /v1/tokens/{id}/report` returns a large object (`markets`, `lockers`, `lockerOwners`, `topHolders`, `totalMarketLiquidity`, `creator`, `events`, `rugged`, etc.) and **does NOT contain a top-level `lpLockedPct`.** The **summary** endpoint returns a compact `dto.TokenCheckSummary` that **does** include top-level `lpLockedPct`, `score`, `score_normalised`, `risks`. `[VERIFIED: live probe of both endpoints + doc.json schemas]` **The code's choice of `/summary` is correct precisely because that is the only variant exposing `lpLockedPct` at the top level** — switching to `/report` would silently break the LP-lock override in `safety-pipeline.ts` (lines 142–153).

---

### 3. Response schema — **MATCH**

Live `dto.TokenCheckSummary` fields (from spec and confirmed in live 200 response):

| Code expects (`RugCheckResponse`) | Real API field | Verdict |
|-----------------------------------|----------------|---------|
| `score: number` | `score` (integer) | ✅ MATCH |
| `score_normalised: number` | `score_normalised` (integer) — **British spelling** | ✅ MATCH |
| `lpLockedPct: number` | `lpLockedPct` (number, **top-level**) | ✅ MATCH |
| `risks: Array<{name, level, description, score}>` | `risks: []` of `{ name, level, description, score, value }` | ✅ MATCH (real has an extra `value: string` the code ignores — harmless) |

`[VERIFIED: https://api.rugcheck.xyz/swagger/doc.json — dto.TokenCheckSummary + rugcheck_api.Risk]` and `[VERIFIED: live 200 response top-level keys: tokenProgram, tokenType, risks, score, score_normalised, lpLockedPct]`

- **Spelling:** It is `score_normalised` (British "s"), **not** `score_normalized`. The code uses `score_normalised` — **correct.** A mismatch here would have made `data.score_normalised` be `undefined` → `100 - undefined = NaN` → `Math.round(NaN)` clamps to... actually `Math.max(0, Math.min(100, NaN))` = `NaN`, a separate silent-corruption bug that the code happily avoids.
- **`lpLockedPct` location:** Confirmed **top-level on the summary endpoint** (not nested under `markets[].lp`). The code reads `data.lpLockedPct` at top level — **correct.** Note: it is nested/absent on the *full* `/report` endpoint, reinforcing Gap 2.
- **Verdict: MATCH.** Field names, types, and nesting all line up. The extra `value` field on risks is ignored safely.

---

### 4. Shield Key (`shield.rugcheck.xyz`) — **OUT OF SCOPE**

`shield.rugcheck.xyz` is a **separate, fully-authenticated host** that 401s `{"error":"invalid api key"}` on *every* request including its root and the token-summary path — i.e., it has **no public access at all**, unlike `api.rugcheck.xyz`. `[VERIFIED: live probe of shield.rugcheck.xyz root + /v1/tokens/.../report/summary, 2026-05-26]` It is the gated/premium mirror of the same API surface, keyed by the distinct "Shield Key" on the account page.

**One line: OUT OF SCOPE.** Our use case is a single public token-safety summary read; the public `api.rugcheck.xyz` endpoint serves that for free without any key. Shield is only relevant if we later need authenticated/higher-rate-limit access or Shield-exclusive features — not needed now. Do not wire the Shield Key into `tier2-rugcheck.ts`.

---

### 5. Pitfalls — silent-failure mechanics

- **#1 — Sending a credential to a public endpoint flips 200 → 401.** This is the headline bug. Any non-empty, server-rejected `X-API-KEY`/`Authorization`/`?key=` value yields `401 {"error":"invalid api key"}` *instead of* the public 200 data. `[VERIFIED: live probe]`
- **#2 — Empty-string header is treated as absent.** `X-API-KEY: ''` → 200. This is why the check appears to "work" in environments where `RUGCHECK_API_KEY` is unset, and "break" once a (bad) key is configured. Counter-intuitive and easy to misdiagnose. `[VERIFIED: live probe]`
- **#3 — 401 is NOT in the code's retry set.** The retry logic (line 94) only retries on `429` or `>=500`. A `401` falls straight through to the pessimistic `HTTP 401` return — *correct* not to retry (retrying a bad key won't help), but it means a misconfigured key produces an instant, permanent `score=0` with only a `log.warn`. **No alert is raised for 401** (the `onApiAlert` callback fires only for `429` rate-limit and the consecutive-failure circuit breaker). A persistent 401 *will* eventually trip the consecutive-failure circuit breaker after `threshold` (default 5) failures → `circuit_breaker_open`, which at least surfaces an alert — but only after silently zero-scoring 5 tokens first. `[VERIFIED: code review lines 94–160]`
- **#4 — `pass: true` on every failure path.** Because RugCheck is a scoring signal (not a hard block), all error paths return `pass: true, score: 0`. Combined with the silent 401, a fully-broken RugCheck integration is **invisible at the pass/fail level** and only shows up as uniformly low aggregate scores / `detail` strings in the pipeline logs. `[VERIFIED: code review]`
- **#5 — No `Accept`/`User-Agent` required.** Live calls with no `Accept` and Node's default UA returned 200; `Accept: application/json` also 200. Response is always `content-type: application/json; charset=utf-8`. No special headers needed. `[VERIFIED: live probe]`
- **#6 — Rate limits exist but weren't triggered.** No `x-ratelimit-*` headers exposed; 15 rapid calls all 200. Under real first-block burst load this could change, and RugCheck has publicly stated token-check rate limits exist (holding 1,000 $FLUXB or using an authenticated key raises them). `[VERIFIED: live burst]` `[CITED: https://x.com/Rugcheckxyz/status/1724408835446595911]` The code's 429 handling (retry + `retry-after` respect + alert) is already correct for this.
- **#7 — Third-party guides describe a DIFFERENT product.** Several guides (qodex.ai, apidog.com) document a multi-chain RugCheck API with `/tokens/scan/{chain}/{address}`, `trustScore`/`riskLevel` fields, and a mandatory `X-API-KEY` header. **Those endpoints do not exist on the live `api.rugcheck.xyz` Solana spec** (which uses `/v1/tokens/{id}/report/summary` and `score_normalised`). Do not trust those guides for this integration — they led to the plausible-but-wrong "X-API-KEY is mandatory" assumption. `[VERIFIED: live spec lacks /tokens/scan]` `[CITED (contradicted): https://qodex.ai/blog/how-to-get-a-rugcheck-api-key-and-start-using-the-api, https://apidog.com/blog/rugcheck-api/]`

---

## Recommended Fixes (ranked by confidence)

1. **[HIGHEST CONFIDENCE] Only send a credential when a non-empty key is present, AND make the public endpoint the reliable default.**
   Build the `headers`/`fetch` options conditionally: if `RUGCHECK_API_KEY` is set, attach the credential; if not, send **no** auth header at all. This guarantees the integration *always at least works in public mode* and can never be broken by an empty/whitespace key. (Today it works by accident with `''` but would break on a stray space.) `[VERIFIED rationale: empty→200, present-but-bad→401]`

2. **[HIGH CONFIDENCE — but verify with the real key first] Move the key out of `X-API-KEY` to the format the API actually accepts.**
   The user's account page shows `https://api.rugcheck.xyz?key=<UUID>` and the spec documents `Authorization` (JWT) — **neither is `X-API-KEY`.** Before shipping, run a one-line live test with the **real new key** against `GET /v1/tokens/{mint}/report/summary` in three variants and keep whichever returns 200 with higher/clearer rate limits:
   - `?key=<KEY>` query param (matches the account page — most likely intended), **or**
   - `Authorization: <KEY>` header (matches the spec's `ApiKeyAuth`), **or**
   - `X-API-KEY: <KEY>` (current code — may already work, may not).
   `[ASSUMED-RISK]` I could not test the valid key. If the valid key 401s in `X-API-KEY`, fix #1 alone still restores function (public mode); this fix is what *also* unlocks the higher rate limits the key was issued for. **Do not write the key value into any committed file** — read it from `env.RUGCHECK_API_KEY` only.

3. **[HIGH CONFIDENCE] Add explicit auth-failure observability.**
   Treat `401`/`403` as a distinct, alertable condition (fire `onApiAlert('rugcheck:report', 'auth_failure', ...)`) rather than letting it hide behind the generic `HTTP {status}` pessimistic path until the circuit breaker trips 5 tokens later. This turns "silently not working" into an immediate, visible alert — directly addressing the reported symptom. `[VERIFIED: no 401 alert exists today, lines 108–121]`

4. **[MEDIUM CONFIDENCE] Add a startup/health probe for the RugCheck key.**
   On boot (or in the existing health endpoint), make one call with the configured key against the wrapped-SOL mint and log whether it returns 200 vs 401. A wrong key would then be caught at startup, not silently degrade live trading. `[VERIFIED: endpoint is safe to probe with a known mint]`

5. **[LOW PRIORITY] Keep `/report/summary`; do NOT switch to `/report`.**
   No change needed — just a guardrail: the full `/report` endpoint lacks top-level `lpLockedPct`, so a future "let's get more data" refactor to `/report` would silently break the LP-lock override in `safety-pipeline.ts`. Document this. `[VERIFIED: schema diff]`

6. **[NO CHANGE] Schema, path, host, score-inversion, 429-retry, Shield-exclusion are all already correct.** Leave them as-is.

---

## Sources

### Primary (HIGH confidence — authoritative live sources)
- **`https://api.rugcheck.xyz/swagger/doc.json`** (live OpenAPI 2.0 spec, fetched 2026-05-26) — `securityDefinitions` (`ApiKeyAuth` = `Authorization` header / JWT), per-path `security` blocks (summary + full report = no security), `dto.TokenCheckSummary` and `rugcheck_api.Risk` schemas.
- **Live HTTP probes of `https://api.rugcheck.xyz/v1/tokens/{mint}/report/summary` and `/report`** (2026-05-26, wrapped-SOL mint) — confirmed public 200, 401-on-any-bad-credential, empty-header=200, no rate-limit headers, 200×15 burst, schema field names.
- **Live probe of `https://shield.rugcheck.xyz`** (2026-05-26) — 401 on all paths (fully gated).

### Secondary (MEDIUM confidence)
- [Rugcheck official X/Twitter — rate-limit announcement](https://x.com/Rugcheckxyz/status/1724408835446595911) — confirms token-check rate limits exist; $FLUXB/auth raises them.
- [Swagger UI (human-readable)](https://api.rugcheck.xyz/swagger/index.html) — same spec as doc.json (JS-rendered).

### Tertiary (LOW confidence / CONTRADICTED — do not trust for this endpoint)
- [qodex.ai RugCheck API guide](https://qodex.ai/blog/how-to-get-a-rugcheck-api-key-and-start-using-the-api) — claims mandatory `X-API-KEY`; describes a different `/tokens/scan/{chain}` product not present in the live Solana spec.
- [apidog.com RugCheck guide](https://apidog.com/blog/rugcheck-api/) — same divergent `/tokens/scan` product, `trustScore`/`riskLevel` fields; does not match this code's endpoint.
- [degenfrends/solana-rugchecker](https://github.com/degenfrends/solana-rugchecker), [ccan23/rugcheck](https://github.com/ccan23/rugcheck) — wrappers; did not expose usable auth detail for this endpoint.

## Assumptions Log

| # | Claim | Risk if Wrong |
|---|-------|---------------|
| A1 `[ASSUMED-RISK]` | The user's *valid* new key, placed in `X-API-KEY`, will be accepted (return 200). I could only test invalid keys (all 401) and the official spec documents `Authorization`/`?key=`, not `X-API-KEY`. | If wrong, configuring the new key in the current `X-API-KEY` slot still yields 401 and the bug persists. Mitigated by Fix #1 (public-mode fallback) + Fix #2 (live-test the real key across `?key=`/`Authorization`/`X-API-KEY` before shipping). |
