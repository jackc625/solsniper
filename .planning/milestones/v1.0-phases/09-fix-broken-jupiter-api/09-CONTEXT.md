# Phase 9: Fix Broken Jupiter API - Context

**Gathered:** 2026-03-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix the Jupiter API integration that is completely broken due to missing `x-api-key` header. Jupiter deprecated unauthenticated access on January 31, 2026. All 5 files making Jupiter requests return HTTP 401 — the bot cannot buy, sell, check safety, or monitor positions. Add API key auth to all Jupiter requests and implement production-grade rate limit handling.

</domain>

<decisions>
## Implementation Decisions

### Root Cause & Scope
- Every Jupiter fetch() call returns HTTP 401 because no `x-api-key` header is sent
- Base URL `https://api.jup.ag/swap/v1/` is correct — only the auth header is missing
- 5 files affected:
  - `src/safety/checks/tier1-sell-route.ts:23` — GET /swap/v1/quote (401 → pass:false → Tier 1 hard reject, all tokens blocked)
  - `src/execution/buy/jupiter-buyer.ts:35` — GET quote + POST swap (throws on 401)
  - `src/execution/sell/standard-seller.ts:52` — GET quote + POST swap (throws on 401)
  - `src/execution/sell/jito-seller.ts:61` — GET quote + POST swap (throws on 401)
  - `src/position/position-manager.ts:303` — GET quote (returns null silently, monitoring never works)
- NOT affected: Jito bundle submission, on-chain RPC, RugCheck, Helius, PumpPortal

### API Key Configuration
- Add `SOLSNIPER_JUPITER_API_KEY` to `src/config/env.ts` schema as **required** (not optional — bot is useless without it)
- Add to `.env.example` with comment pointing to https://portal.jup.ag
- Bot must fail fast at startup if key is missing
- Free tier: 60 req/min. Pro I ($200/mo, 600 req/min) for production scale

### API Approach
- Stay on Standard Swap API (not Ultra) — keep existing quote→swap→sign→broadcast flow
- Keep existing multi-RPC broadcaster infrastructure intact
- Just add `x-api-key` header to all Jupiter fetch calls

### Centralization
- Claude's Discretion: choose between Option A (helper function exporting `jupiterHeaders()`) or Option B (centralized client with `jupiterQuote()`/`jupiterSwap()`)
- Either way, all 5 files must use the centralized approach

### Rate Limit Handling (full implementation)
- **Global cooldown on 429:** When any Jupiter request gets 429, pause ALL Jupiter requests (rate limit is per-key, so if one is limited all will be)
- **Cooldown duration:** Respect `Retry-After` header from Jupiter response; fall back to 10 seconds if no header
- **Dynamic poll interval:** Position monitoring adapts its poll interval based on request budget — stretches when approaching limit, uses configured interval when well under limit
- **Trade priority:** Claude's Discretion — decide whether safety checks and buy/sell get priority over monitoring when rate budget is tight
- **429 detection:** All Jupiter fetch calls must check for 429 status and trigger the global cooldown

</decisions>

<specifics>
## Specific Ideas

- Free API key from https://portal.jup.ag (email signup, instant)
- Migration reference: https://dev.jup.ag/portal/migrate-from-lite-api
- Rate limit math: position monitoring at 5s poll × N positions = 12N req/min. With 5 positions = 60 req/min (maxes free tier alone)
- Safety checks add ~1 req per new token (burst), buy/sell add 2 req per trade (quote + swap)

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/execution/broadcaster.ts`: Multi-RPC broadcast + blockhash-last signing — stays as-is, Jupiter client feeds into it
- `src/config/env.ts`: Zod-based env validation with existing optional API keys (RUGCHECK, HELIUS, DASHBOARD) — pattern to follow for Jupiter key (but required, not optional)
- `src/core/logger.ts`: Module logger pattern (`createModuleLogger`) — use for jupiter-client and rate limiter

### Established Patterns
- All Jupiter files use the same fetch pattern: `fetch(url).then(r => { if (!r.ok) throw/return; return r.json() })`
- Env vars prefixed with `SOLSNIPER_`
- Module logger per file
- bigint for token amounts throughout sell path

### Integration Points
- `src/config/env.ts` — add required JUPITER_API_KEY
- All 5 Jupiter-calling files — inject auth header
- `src/position/position-manager.ts` — integrate dynamic poll interval with rate limiter
- `.env.example` — document new required key

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 09-fix-broken-jupiter-api*
*Context gathered: 2026-03-02*
