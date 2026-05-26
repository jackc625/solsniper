# Quick Task 260526-krq: audit RugCheck API wiring - Context

**Gathered:** 2026-05-26
**Status:** Ready for planning

<domain>
## Task Boundary

Audit the RugCheck API integration (`src/safety/checks/tier2-rugcheck.ts`) end-to-end because the RugCheck safety check "did not seem to be working" in production. A new API key was issued. Confirm the wiring is correct and fix the genuine defects the audit surfaced. **Scope is RugCheck only.**
</domain>

<audit_findings>
## Audit Findings (verified this session — treat as fact)

**Plumbing — all correct:**
- `.env` has `RUGCHECK_API_KEY` set to a clean bare UUID (36 chars, no quotes/URL/whitespace), added 2026-05-26 14:55.
- `env.ts:14` loads it via `dotenv/config` + Zod `.optional()`.
- `safety-pipeline.ts:120` passes it: `checkRugCheck(event.mint, this.env.RUGCHECK_API_KEY, tier2Signal)`.
- `index.ts:168` wires `setRugCheckMonitoring(metricsTracker, onApiAlert, apiFailureThreshold)`.
- Endpoint path `/v1/tokens/{mint}/report/summary`, response schema (`score_normalised`, top-level `lpLockedPct`, `risks[]`), and score math (`100 - score_normalised`) all verified correct against the live RugCheck OpenAPI spec (see RESEARCH.md).

**Live HTTP probe with the user's REAL key (BONK mint):**
- No credential -> HTTP 200 (endpoint is PUBLIC)
- `?key=<key>` query param -> HTTP 200 + valid body
- `X-API-KEY: <key>` header (current code) -> HTTP 200 + valid body
- `Authorization: <key>` / `Bearer` -> HTTP 200 + valid body
- => The valid key is accepted in every position. The auth MECHANISM was a red herring.

**Root cause of the original "not working":**
- The old key was almost certainly invalid/expired -> RugCheck returns HTTP 401 `invalid api key` -> the code SILENTLY swallows it as `{ pass: true, score: 0, detail: 'HTTP 401' }` with only a `warn` log. An auth failure is indistinguishable from a genuinely maximally-risky token. This silent-swallow is why the breakage was invisible. The new valid key resolves the immediate symptom.
- Secondary suspect: rate-limiting on the unauthenticated/public tier under sustained load ("running for a while").
</audit_findings>

<decisions>
## Implementation Decisions (LOCKED — do not revisit)

### 1. Auth form: switch to documented `?key=` query parameter
- Change `checkRugCheck` from sending an `X-API-KEY` header to appending `?key=<apiKey>` to the request URL.
- Rationale: (a) RugCheck's account page documents the key as `https://api.rugcheck.xyz?key=<key>`; (b) the endpoint is public, so a 200 on the header form does NOT prove the key is honored for the account's rate-limit tier — the documented query-param form is the one most likely associated with the account; (c) rate-limiting under load is the secondary suspect, so getting the authenticated tier matters.
- **MIRROR the existing in-repo fix for Helius in `tier3-creator.ts` (committed 74c0f72)**, which switched from `X-Api-Key` header to `?api-key=` query param with the comment "requires api-key as a query parameter, not header". Follow that precedent for consistency. Note the retry path also re-fetches the same URL — keep the key on both fetches.

### 2. Public fallback: send NO credential when no key is set
- When `apiKey` is undefined/empty, build the URL WITHOUT any `?key=` param (clean public mode). Do not append `?key=` with an empty value.

### 3. Secret hygiene: scrub the key from error logs
- The key now lives in the URL. The catch-block log at `tier2-rugcheck.ts:138` currently logs `{ mint, err }`. Ensure neither the raw URL nor the key can leak. Mirror tier3-creator's pattern: `const safeUrl = url.replace(/key=[^&]+/, 'key=***')` and log only sanitized fields. Do NOT log a raw `err` object if it could carry the URL — prefer `err instanceof Error ? err.message : String(err)`.

### 4. Make auth failures LOUD (the real defect fix)
- On HTTP 401/403, in addition to the existing pessimistic return, emit an alert via the existing `onApiAlert` callback with a NEW alert type `'auth_failure'`, message naming `RUGCHECK_API_KEY` (e.g. "RugCheck API key rejected (HTTP 401) -- check RUGCHECK_API_KEY"). Log at `error` level (not `warn`) for 401/403.
- Extend the `ApiAlertCallback` type union in `fee-estimator.ts` to add `'auth_failure'`.
- Update the consumer in `index.ts:129-131` so `'auth_failure'` maps to `severity='error'` (treat like `rate_limit` for severity/source).
- **Keep the safety semantics unchanged:** still return `{ pass: true, score: 0 }` on failure (do NOT hard-block on auth failure). The goal is DIAGNOSABILITY, not changing trade behavior.

### Out of scope
- RugCheck "Shield Key" / `shield.rugcheck.xyz` (separate gated product).
- tier3-creator / fee-estimator beyond the `auth_failure` union addition (their D-10 work is already committed at 74c0f72).
- Score math, endpoint path, response parsing (all verified correct — do not touch).

### Tests
- Update `tier2-rugcheck.test.ts`: the two assertions on the `X-API-KEY` header (~lines 91-115) become assertions on the `?key=` query param in the fetched URL (present when key provided, absent when not). Add a test for the 401 -> `auth_failure` alert emission. Keep existing circuit-breaker/retry tests passing.
- Run with `npx vitest run src/safety/checks/tier2-rugcheck.test.ts` — **NO `rtk` prefix** (user instruction this session).
</decisions>

<specifics>
## Specific References

- `src/safety/checks/tier3-creator.ts` (committed 74c0f72) — canonical in-repo precedent for query-param auth + log scrubbing. Mirror it.
- `260526-krq-RESEARCH.md` — live RugCheck API contract verification. NOTE: its "401 root cause via X-API-KEY" framing was REFINED by this session's live probe — the valid key works in all positions; the real defect is the silent-swallow of auth failures.
</specifics>

<canonical_refs>
## Canonical References

- RugCheck account page (user screenshot): API key documented as `?key=` query param; Shield Key is a separate product.
- RugCheck live OpenAPI spec: `https://api.rugcheck.xyz/swagger/doc.json` (per RESEARCH.md).
</canonical_refs>
