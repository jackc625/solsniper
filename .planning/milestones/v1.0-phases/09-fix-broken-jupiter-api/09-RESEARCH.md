# Phase 9: Fix Broken Jupiter API - Research

**Researched:** 2026-03-02
**Domain:** Jupiter Swap API authentication, rate-limit handling, TypeScript centralization
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- Every Jupiter fetch() call returns HTTP 401 because no `x-api-key` header is sent
- Base URL `https://api.jup.ag/swap/v1/` is correct — only the auth header is missing
- 5 files affected:
  - `src/safety/checks/tier1-sell-route.ts:23` — GET /swap/v1/quote (401 → pass:false → Tier 1 hard reject, all tokens blocked)
  - `src/execution/buy/jupiter-buyer.ts:35` — GET quote + POST swap (throws on 401)
  - `src/execution/sell/standard-seller.ts:52` — GET quote + POST swap (throws on 401)
  - `src/execution/sell/jito-seller.ts:61` — GET quote + POST swap (throws on 401)
  - `src/position/position-manager.ts:303` — GET quote (returns null silently, monitoring never works)
- NOT affected: Jito bundle submission, on-chain RPC, RugCheck, Helius, PumpPortal
- Add `SOLSNIPER_JUPITER_API_KEY` to `src/config/env.ts` schema as **required** (not optional)
- Add to `.env.example` with comment pointing to https://portal.jup.ag
- Bot must fail fast at startup if key is missing
- Free tier: 60 req/min. Pro I ($200/mo, 600 req/min) for production scale
- Stay on Standard Swap API (not Ultra) — keep existing quote→swap→sign→broadcast flow
- Keep existing multi-RPC broadcaster infrastructure intact
- Just add `x-api-key` header to all Jupiter fetch calls
- Claude's Discretion: choose between Option A (helper function exporting `jupiterHeaders()`) or Option B (centralized client with `jupiterQuote()`/`jupiterSwap()`)
- Either way, all 5 files must use the centralized approach
- **Global cooldown on 429:** When any Jupiter request gets 429, pause ALL Jupiter requests
- **Cooldown duration:** Respect `Retry-After` header from Jupiter response; fall back to 10 seconds if no header
- **Dynamic poll interval:** Position monitoring adapts its poll interval based on request budget
- **Trade priority:** Claude's Discretion — decide whether safety checks and buy/sell get priority over monitoring when rate budget is tight
- **429 detection:** All Jupiter fetch calls must check for 429 status and trigger the global cooldown

### Claude's Discretion

- Choose between Option A (helper function exporting `jupiterHeaders()`) or Option B (centralized client with `jupiterQuote()`/`jupiterSwap()`)
- Decide whether safety checks and buy/sell get priority over monitoring when rate budget is tight

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope
</user_constraints>

---

## Summary

Jupiter deprecated unauthenticated API access (lite-api.jup.ag) on January 31, 2026. All requests to `https://api.jup.ag/` now require an `x-api-key` header. The existing codebase uses the correct base URL but sends zero authentication, causing HTTP 401 on every call. The bot is completely non-functional: safety checks hard-block all tokens, all buys and sells throw, and position monitoring silently skips every tick.

The fix is architecturally straightforward: add `SOLSNIPER_JUPITER_API_KEY` as a required env var, create a centralized Jupiter client module, and update all 5 affected files to use it. The recommended approach (Option B — centralized client) eliminates 5 copies of fetch-with-error-check boilerplate, centralizes rate-limit handling, and puts 429 global cooldown logic in one place. The centralized client becomes the single point where the `x-api-key` header is injected.

The rate-limit component requires more care: Jupiter's free tier is 60 req/min with a sliding window, returning HTTP 429 with no documented `Retry-After` header. The global cooldown strategy (freeze all Jupiter calls for 10 seconds on any 429) is the correct approach because the rate limit is per-API-key, not per-endpoint. Dynamic poll interval stretching in `PositionManager` prevents the monitoring loop from exhausting the budget at scale.

**Primary recommendation:** Use Option B (centralized `JupiterClient` class with `quote()` and `swap()` methods) because it collocates auth injection, 429 detection, and global cooldown in one place, and the rate-limit state needs to be shared across all callers.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js `fetch` (built-in) | Node 18+ | HTTP calls to Jupiter API | Already used throughout codebase; no new dependency |
| Zod | Already installed | Env var validation | Existing pattern in `src/config/env.ts` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `src/core/logger.ts` (project-internal) | N/A | Module-scoped logging | Required per project convention (`createModuleLogger`) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Option B centralized client | Option A helper function | Option A is simpler but 429/cooldown state must still be global singleton; ends up being Option B anyway |
| Manual 429 backoff | `p-retry` / `axios-retry` | Extra dependency not warranted for this simple case |

**Installation:** No new packages required.

---

## Architecture Patterns

### Recommended Project Structure

```
src/
├── execution/
│   ├── jupiter-client.ts    # NEW: centralized Jupiter API client + rate limiter
│   ├── buy/
│   │   └── jupiter-buyer.ts    # update: use JupiterClient
│   ├── sell/
│   │   ├── standard-seller.ts  # update: use JupiterClient
│   │   └── jito-seller.ts      # update: use JupiterClient
├── safety/checks/
│   └── tier1-sell-route.ts     # update: use JupiterClient
├── position/
│   └── position-manager.ts     # update: use JupiterClient + dynamic interval
└── config/
    └── env.ts                  # update: add SOLSNIPER_JUPITER_API_KEY (required)
```

### Pattern 1: Centralized JupiterClient (Option B — Recommended)

**What:** A singleton class instantiated once (in index.ts or wherever it is wired) and injected into all 5 callers. Holds the API key from env, wraps `quote()` and `swap()` calls, and manages the 429 global cooldown state.

**When to use:** When rate-limit state (cooldown flag + timestamp) must be shared across multiple callers with different call frequencies — exactly this situation.

**Example:**

```typescript
// src/execution/jupiter-client.ts
import { env } from '../config/env.js';
import { createModuleLogger } from '../core/logger.js';

const log = createModuleLogger('jupiter-client');

const JUPITER_QUOTE = 'https://api.jup.ag/swap/v1/quote';
const JUPITER_SWAP  = 'https://api.jup.ag/swap/v1/swap';
const DEFAULT_COOLDOWN_MS = 10_000;

export class JupiterClient {
  private cooldownUntil = 0;  // epoch ms; 0 = not in cooldown

  private headers(): Record<string, string> {
    return { 'x-api-key': env.SOLSNIPER_JUPITER_API_KEY };
  }

  private isCoolingDown(): boolean {
    return Date.now() < this.cooldownUntil;
  }

  private triggerCooldown(retryAfterMs?: number): void {
    const duration = retryAfterMs ?? DEFAULT_COOLDOWN_MS;
    this.cooldownUntil = Date.now() + duration;
    log.warn({ cooldownMs: duration }, 'Jupiter rate limit hit — global cooldown active');
  }

  /** GET /swap/v1/quote — returns parsed JSON or throws */
  async quote(params: URLSearchParams): Promise<unknown> {
    if (this.isCoolingDown()) {
      throw new Error(`Jupiter rate limited — cooldown active until ${new Date(this.cooldownUntil).toISOString()}`);
    }
    const url = `${JUPITER_QUOTE}?${params.toString()}`;
    const resp = await fetch(url, { headers: this.headers() });
    if (resp.status === 429) {
      const retryAfter = resp.headers.get('Retry-After');
      this.triggerCooldown(retryAfter ? Number(retryAfter) * 1000 : undefined);
      throw new Error('Jupiter rate limited (429)');
    }
    if (!resp.ok) throw new Error(`Jupiter quote HTTP ${resp.status}`);
    return resp.json();
  }

  /** POST /swap/v1/swap — returns parsed JSON or throws */
  async swap(body: Record<string, unknown>): Promise<{ swapTransaction: string }> {
    if (this.isCoolingDown()) {
      throw new Error(`Jupiter rate limited — cooldown active until ${new Date(this.cooldownUntil).toISOString()}`);
    }
    const resp = await fetch(JUPITER_SWAP, {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (resp.status === 429) {
      const retryAfter = resp.headers.get('Retry-After');
      this.triggerCooldown(retryAfter ? Number(retryAfter) * 1000 : undefined);
      throw new Error('Jupiter rate limited (429)');
    }
    if (!resp.ok) throw new Error(`Jupiter swap HTTP ${resp.status}`);
    return resp.json() as Promise<{ swapTransaction: string }>;
  }

  /** Returns true if currently in 429 cooldown — used by PositionManager for interval stretching */
  isRateLimited(): boolean {
    return this.isCoolingDown();
  }

  /** Remaining cooldown in ms (0 if not in cooldown) — used by PositionManager */
  cooldownRemainingMs(): number {
    return Math.max(0, this.cooldownUntil - Date.now());
  }
}

// Export singleton — all callers share the same rate-limit state
export const jupiterClient = new JupiterClient();
```

### Pattern 2: Required Env Var Registration

**What:** Follow the existing `src/config/env.ts` Zod schema pattern, but use `.string().min(1)` instead of `.optional()`.

**Example:**

```typescript
// In EnvSchema (src/config/env.ts):
SOLSNIPER_JUPITER_API_KEY: z.string().min(1, 'Jupiter API key is required — get one at https://portal.jup.ag'),
```

The existing startup `process.exit(1)` on `safeParse` failure guarantees fail-fast behavior at boot — no extra guard needed.

### Pattern 3: Dynamic Poll Interval in PositionManager

**What:** PositionManager checks cooldown state at tick start. If in cooldown, skip the tick and reschedule at a stretched interval. When well under limit, use the configured interval.

**Example:**

```typescript
// In PositionManager.scheduleTick():
private scheduleTick(): void {
  // Stretch interval if rate limiter is cooling down
  const cooldownMs = this.jupiterClient.cooldownRemainingMs();
  const intervalMs = cooldownMs > 0
    ? cooldownMs + this.config.positionManagement.pollIntervalMs  // wait out cooldown + normal interval
    : this.config.positionManagement.pollIntervalMs;

  this.timer = setTimeout(async () => {
    try {
      await this.tick();
    } catch (err) {
      log.error({ err }, 'PositionManager tick threw unexpectedly');
    } finally {
      if (this.running) this.scheduleTick();
    }
  }, intervalMs);
}
```

### Pattern 4: Caller Migration (all 5 files)

**What:** Replace inline `fetch(url)` + `fetch(JUPITER_SWAP, {...})` with `jupiterClient.quote()` and `jupiterClient.swap()`.

**Example — jupiter-buyer.ts (before):**
```typescript
const quoteResponse = await fetch(quoteUrl).then((r) => {
  if (!r.ok) throw new Error(`Jupiter quote HTTP ${r.status}`);
  return r.json();
});
```

**Example — jupiter-buyer.ts (after):**
```typescript
const params = new URLSearchParams({
  inputMint: SOL_MINT, outputMint: mint,
  amount: String(lamports), slippageBps: String(buy.slippageBps), maxAccounts: '64',
});
const quoteResponse = await jupiterClient.quote(params);
```

**Example — tier1-sell-route.ts (before):**
```typescript
const response = await fetch(url, signal !== undefined ? { signal } : undefined);
if (response.status === 400) { /* ... */ }
if (!response.ok) { return { pass: false, ... }; }
```

**Example — tier1-sell-route.ts (after):**
```typescript
try {
  await jupiterClient.quote(params);
  return { pass: true, source: 'jupiter_sell_route', detail: 'route exists' };
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  // 400 = no route, 429 = rate limited, network = block
  const isNoRoute = msg.includes('HTTP 400');
  return {
    pass: false,
    source: 'jupiter_sell_route',
    detail: isNoRoute ? `no route: ${msg}` : msg,
  };
}
```

Note: `tier1-sell-route.ts` needs special handling for 400 (no route → pessimistic block) vs. other errors. The centralized client throws for all non-2xx, so the caller inspects the error message to distinguish 400 from 429/5xx.

### Anti-Patterns to Avoid

- **Passing `AbortSignal` through the centralized client:** The existing `checkSellRoute` accepts an AbortSignal for cancellation. The centralized `quote()` method can accept an optional `signal` parameter to preserve this behavior for the safety check caller.
- **Making `JupiterClient` a module-level function instead of class:** A function cannot hold mutable cooldown state. A class is the right primitive here.
- **Per-file cooldown state:** Defeats the "global cooldown" requirement — if position-manager triggers 429, standard-seller must also pause.
- **Sleeping inside `quote()` until cooldown expires:** Safer to throw immediately — the caller (PositionManager) already has skip-tick logic; execution callers propagate the error up the sell ladder.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP retry with exponential backoff | Custom retry loop | Not needed — simple 429 global cooldown is sufficient | Only 10s cooldown needed; complex retry adds latency in a time-sensitive bot |
| Rate counter with sliding window | Token-bucket / leaky-bucket counter | Simple epoch-based `cooldownUntil` timestamp | Avoids counting every request; 429 signal from server is the ground truth |
| JWT / OAuth flow | Custom auth middleware | Single `x-api-key` static header | Jupiter API key auth is a static header — no token refresh needed |

**Key insight:** Jupiter's rate limit signal (HTTP 429) is the authoritative source of truth. Counting requests locally to pre-empt 429s adds complexity without reliability — the server still enforces the limit. Reacting to 429 and cooling down is simpler and correct.

---

## Common Pitfalls

### Pitfall 1: Forgetting AbortSignal propagation in tier1-sell-route.ts

**What goes wrong:** The safety check times out Tier 1 checks via an AbortController. If the centralized `quote()` method does not accept and forward `AbortSignal`, the signal is silently dropped and the request runs until it either resolves or errors independently of the safety pipeline's timeout.

**Why it happens:** The other 4 Jupiter callers (buyer, sellers, position manager) don't use AbortSignal, so it's easy to design the client without it and miss the one caller that does.

**How to avoid:** Add `signal?: AbortSignal` as an optional parameter to `jupiterClient.quote()` and pass it to the inner `fetch()` call.

**Warning signs:** Safety check tests that verify AbortSignal propagation (existing: `tier1-sell-route.test.ts` line 80-88) will fail if signal is dropped.

### Pitfall 2: Retry-After header is seconds, not milliseconds

**What goes wrong:** Jupiter's 429 may include a `Retry-After` header. The HTTP spec defines this as an integer number of **seconds**, not milliseconds. Multiplying by 1 instead of 1000 causes a 1000x shorter cooldown (e.g., 10ms instead of 10s).

**Why it happens:** Node.js `Date.now()` returns milliseconds; the header is in seconds — unit mismatch.

**How to avoid:** `Number(retryAfter) * 1000` when converting to milliseconds. The docs for Jupiter do not confirm Retry-After is sent, but handle it defensively since the HTTP spec allows it and it costs nothing to read.

**Warning signs:** After a 429, the client immediately hits 429 again on the next request.

### Pitfall 3: Test isolation broken by singleton export

**What goes wrong:** `jupiterClient` is exported as a module-level singleton. If one test triggers a cooldown and does not reset it, the next test sees a "rate limited" state it didn't expect.

**Why it happens:** Shared mutable state across test cases.

**How to avoid:** Either (a) export the class too so tests can `new JupiterClient()` for isolation, or (b) add a `resetCooldown()` method (or expose `cooldownUntil`) for test teardown via `beforeEach`.

**Warning signs:** Tests pass in isolation but fail when run as a suite.

### Pitfall 4: tier1-sell-route.ts must block on 429, not pass

**What goes wrong:** If `checkSellRoute` treats a 429 (rate limited) as "route exists" instead of "cannot determine," it could allow unsafe tokens through the safety gate. The existing behavior on any non-200, non-400 response is `pass: false` (pessimistic). A 429 must also return `pass: false`.

**Why it happens:** The centralized client throws on 429. The catch block needs to return `{ pass: false }`, not re-throw in a way that the outer safety-pipeline treats as "passed."

**How to avoid:** The catch block in `checkSellRoute` should handle ALL exceptions as `pass: false` with a descriptive detail. No special-casing needed — the existing pessimistic behavior is already correct for 429.

**Warning signs:** Tokens pass safety check during rate-limited periods.

### Pitfall 5: PositionManager constructor signature change must be wired in index.ts

**What goes wrong:** If `PositionManager` needs `jupiterClient` injected but the constructor change is not reflected in `index.ts` (or wherever `PositionManager` is instantiated), TypeScript compilation fails — but it's easy to miss if only the class file is updated.

**Why it happens:** Constructor injection requires updating both the class definition and all instantiation sites.

**How to avoid:** Search for all `new PositionManager(` calls when updating the constructor.

**Warning signs:** `tsc` errors at build — `Expected N arguments, but got M.`

---

## Code Examples

Verified patterns from official sources and codebase review:

### API Key Header (Source: dev.jup.ag/portal/setup.md)

```typescript
// Every Jupiter request needs this header
{ 'x-api-key': env.SOLSNIPER_JUPITER_API_KEY }
```

### Quote Request with URLSearchParams

```typescript
// Source: dev.jup.ag/docs/swap/get-quote.md
const params = new URLSearchParams({
  inputMint: SOL_MINT,
  outputMint: mint,
  amount: String(lamports),
  slippageBps: String(buy.slippageBps),
  maxAccounts: '64',
});
const resp = await fetch(`https://api.jup.ag/swap/v1/quote?${params}`, {
  headers: { 'x-api-key': apiKey },
});
```

### Swap POST with x-api-key Header

```typescript
// Source: dev.jup.ag/docs/swap/build-swap-transaction.md
const resp = await fetch('https://api.jup.ag/swap/v1/swap', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
  },
  body: JSON.stringify({
    userPublicKey: wallet.publicKey.toBase58(),
    quoteResponse,
    dynamicComputeUnitLimit: true,
    dynamicSlippage: false,
    prioritizationFeeLamports: { priorityLevelWithMaxLamports: { ... } },
    wrapAndUnwrapSol: true,
  }),
});
```

### Zod Required String Pattern (matches existing env.ts convention)

```typescript
// Source: existing src/config/env.ts pattern
SOLSNIPER_JUPITER_API_KEY: z.string().min(1, 'Jupiter API key required — get one at https://portal.jup.ag'),
```

### 429 Global Cooldown Check Pattern

```typescript
// Before any Jupiter fetch:
if (Date.now() < cooldownUntil) {
  throw new Error('Jupiter rate limited — global cooldown active');
}

// On 429 response:
const retryAfterSec = resp.headers.get('Retry-After');
const cooldownMs = retryAfterSec ? Number(retryAfterSec) * 1000 : 10_000;
cooldownUntil = Date.now() + cooldownMs;
```

---

## Recommendation: Option B (Centralized Client) vs Option A (Helper Function)

### Why Option B wins

The decision between Option A (`jupiterHeaders()` helper) and Option B (`JupiterClient` class) hinges on where the 429 cooldown state lives:

- **Option A:** `jupiterHeaders()` returns `{ 'x-api-key': key }`. The 5 callers still call `fetch()` directly. The 429 global cooldown must be a module-level variable in the helper file, shared via a `checkCooldown()` and `triggerCooldown()` function pair. This is functionally equivalent to Option B but with worse encapsulation — the state is global module state, not encapsulated in a class instance.

- **Option B:** `JupiterClient` class holds `cooldownUntil` as instance state. `quote()` and `swap()` methods check and update it. The 5 callers have 90% less boilerplate per call. Test isolation is cleaner (instantiate fresh `JupiterClient` per test).

**Verdict: Option B.** The centralized client is the right tool when multiple callers share mutable rate-limit state. The refactor surface is contained: 5 files each lose ~10 lines of boilerplate and gain 1-2 lines of client method calls.

### Trade Priority: Safety Checks and Executions over Monitoring

When the rate budget is tight (approaching but not yet hitting 429), position monitoring should yield to safety checks and trade execution. The recommended implementation: PositionManager reads `jupiterClient.isRateLimited()` at each tick start. If true, skip the tick entirely and reschedule with a longer interval (`cooldownRemainingMs() + configuredPollInterval`). Safety checks and buy/sell callers propagate the 429 throw up to their error handlers — the sell ladder will treat it like any other sell failure and retry at the next step.

This gives implicit priority to safety checks and execution: they are called only when a trade event occurs (rare), while monitoring runs on a continuous poll cycle (high frequency). The monitoring loop is the primary consumer of rate budget, so pausing it on 429 restores capacity for trade-critical calls.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `https://lite-api.jup.ag/` unauthenticated | `https://api.jup.ag/` + `x-api-key` header | Jan 31, 2026 | All unauthenticated requests return HTTP 401 |
| No rate limit enforcement | 60 req/min (free), 600/min (Pro I) sliding window | Same cutover | Position monitoring at 5-position scale maxes free tier alone |

**Deprecated/outdated:**
- `lite-api.jup.ag`: Fully deprecated as of Jan 31, 2026. Returns 401. Do not use.
- Unauthenticated `fetch()` to `api.jup.ag`: Returns 401 as of Jan 31, 2026.

---

## Open Questions

1. **Does Jupiter's 429 include a `Retry-After` header?**
   - What we know: The official rate-limit docs (dev.jup.ag/portal/rate-limit.md, dev.jup.ag/portal/responses.md) do not mention `Retry-After`. The HTTP 429 spec allows it but does not require it.
   - What's unclear: Whether Jupiter sends it in practice.
   - Recommendation: Implement `Retry-After` parsing defensively (read it if present, fall back to 10s if absent). Zero cost, handles both cases.

2. **Does `checkSellRoute` need to handle 400 (no route) differently from 429 (rate limited)?**
   - What we know: Currently, both return `pass: false`. The existing behavior is correct — a rate-limited check should not allow a token through.
   - What's unclear: Whether the error detail logged to pino matters for operator diagnostics.
   - Recommendation: Include the HTTP status in the `detail` field so operators can distinguish "no route" from "rate limited" in logs. Both remain `pass: false`.

3. **Where is `JupiterClient` instantiated and injected?**
   - What we know: The project wires dependencies in `src/index.ts`. `PositionManager`, `JupiterBuyer`, `StandardSeller`, `JitoSeller` are all instantiated there or in adjacent factory code.
   - What's unclear: Whether `tier1-sell-route.ts` can import the singleton directly (it currently has no constructor injection) or needs a dependency parameter added.
   - Recommendation: Export `jupiterClient` as a module singleton from `src/execution/jupiter-client.ts`. The 4 execution/position files can import it directly (they already hold references to config and connections as constructor params). `tier1-sell-route.ts` is a pure function — it can import the singleton directly, same as it currently imports nothing beyond its own URL constants. This avoids adding a parameter to `checkSellRoute` and changing the safety-pipeline call sites.

---

## Sources

### Primary (HIGH confidence)
- `https://dev.jup.ag/portal/migrate-from-lite-api.md` — confirmed x-api-key requirement, base URL stays `https://api.jup.ag/`
- `https://dev.jup.ag/portal/setup.md` — confirmed header name `x-api-key`, portal.jup.ag for key generation
- `https://dev.jup.ag/portal/rate-limit.md` — confirmed tier limits: Free=60 req/min, Pro I=600/min, Pro II=3000/min, Pro III=6000/min, Pro IV=30000/min; 429 on breach
- `https://dev.jup.ag/portal/responses.md` — confirmed 429 meaning, no Retry-After documented
- `https://dev.jup.ag/docs/swap/get-quote.md` — confirmed GET /swap/v1/quote params and response shape
- `https://dev.jup.ag/docs/swap/build-swap-transaction.md` — confirmed POST /swap/v1/swap body schema, x-api-key required

### Secondary (MEDIUM confidence)
- Codebase read: `src/safety/checks/tier1-sell-route.ts`, `src/execution/buy/jupiter-buyer.ts`, `src/execution/sell/standard-seller.ts`, `src/execution/sell/jito-seller.ts`, `src/position/position-manager.ts` — all 5 affected files read; fetch patterns confirmed
- Codebase read: `src/config/env.ts` — Zod schema pattern confirmed for required key addition
- Codebase read: `src/safety/checks/tier1-sell-route.test.ts`, `src/execution/buy/jupiter-buyer.test.ts`, `src/position/position-manager.test.ts` — existing test patterns documented

---

## Metadata

**Confidence breakdown:**
- Jupiter auth requirement: HIGH — official migration docs confirmed, JUPITER_ISSUE.md cross-confirms
- Rate limit tiers: HIGH — official rate-limit.md directly fetched and parsed
- Retry-After header: LOW — not documented by Jupiter; implementing defensively is costless
- Option B recommendation: HIGH — architectural reasoning based on shared mutable state requirement
- Test isolation patterns: HIGH — read from existing project tests (vi.stubGlobal, vi.hoisted patterns)

**Research date:** 2026-03-02
**Valid until:** 2026-04-02 (Jupiter API stable; rate limit tiers less likely to change)
