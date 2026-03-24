# Phase 3: Safety Pipeline - Research

**Researched:** 2026-02-22
**Domain:** Solana token safety verification — on-chain authority checks, Jupiter route validation, RugCheck API, holder concentration analysis, creator history via Helius
**Confidence:** HIGH (Tier 1 checks), MEDIUM (Tier 2 RugCheck/holder), MEDIUM (Tier 3 Helius creator history)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **Score scale**: Claude's discretion (pick most practical internal representation)
- **Check weights (Tier 2 vs Tier 3 relative importance)**: Claude's discretion
- **Default minimum safety score threshold**: moderate (60+) — catch obvious rugs but allow tokens with some yellow flags
- **Per-check soft blocks**: individual Tier 2/3 checks CAN independently reject tokens regardless of aggregate score (e.g., extreme holder concentration auto-rejects even if aggregate is fine)
- **Rejection logging**: detailed — log exactly which check(s) caused rejection and by how much it missed (e.g., "REJECTED: holder_concentration=0.25 (threshold 0.40), aggregate=52 (threshold 60)")
- **Config location**: all scoring config (weights, thresholds, per-check soft blocks) lives in main config.json, not a separate file
- **API failure handling**: pessimistic — treat failed/timed-out checks as negative signal ("if we can't verify, assume the worst")
- **Safety result caching**: cache with TTL — if same token mint detected again, skip re-running checks within cache window
- **Holder metrics**: check both top-1 holder % AND top-10 holders combined %
- **System account exclusion**: exclude bonding curve, LP pool, burn addresses from concentration calculations — only count real wallets
- **Top-1 soft block threshold**: 25%+ of supply held by single non-system wallet triggers auto-rejection
- **Top-10 soft block threshold**: 50%+ combined supply held by top 10 non-system wallets triggers auto-rejection
- **Both thresholds configurable** in config.json
- **Known rug creator enforcement**: hard reject — if creator has clear rug history, auto-reject regardless of other scores. Zero tolerance.
- **Local blocklist**: yes, persist known-bad creator addresses locally. Instant reject on repeat encounters without API calls. Grows over time.

### Claude's Discretion

- Score scale representation (0-100, 0-1, etc.)
- Tier 2/3 check weights in aggregate
- Async timing strategy (wait/timeout/proceed)
- Tier 2 vs Tier 3 parallelism approach
- Creator history pattern detection specifics and lookback depth
- Event-driven vs direct return for pipeline results
- Logging verbosity for passing tokens
- Safety result cache TTL duration

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SAF-01 | Bot checks mint authority is null (revoked) before buying — hard block if present | `getMint()` from `@solana/spl-token` returns `mintAuthority: null | PublicKey` — null check is trivial |
| SAF-02 | Bot checks freeze authority is null before buying — hard block if present | Same `getMint()` call returns `freezeAuthority: null | PublicKey` — parallel with SAF-01 |
| SAF-03 | Bot validates sell route exists via Jupiter quote simulation — hard block if no route | GET `https://api.jup.ag/swap/v1/quote?inputMint={mint}&outputMint={SOL_MINT}&amount=1000000&slippageBps=500` — 400 error or error body means no route |
| SAF-04 | All Tier 1 checks run in parallel via Promise.all, completing in <300ms typical case | `Promise.all([checkMintAuthority(), checkFreezeAuthority(), checkSellRoute()])` — all three are independent RPC/API calls |
| SAF-05 | Bot queries RugCheck.xyz API for token safety scoring (Tier 2, non-blocking) | GET `https://api.rugcheck.xyz/v1/tokens/{mint}/report/summary` — returns `score`, `score_normalised`, `risks[]` |
| SAF-06 | Bot checks top holder concentration via getTokenLargestAccounts (Tier 2, async) | `connection.getTokenLargestAccounts(mintPubkey)` returns 20 largest accounts — resolve owners via getParsedAccountInfo or Helius getTokenAccounts |
| SAF-07 | Bot analyzes creator wallet history for prior rugs via Helius parsed TX API (Tier 3, async) | Helius Enhanced Transactions `GET /v0/addresses/{creator}/transactions?type=TOKEN_MINT` — requires Developer plan |
| SAF-08 | Bot computes aggregate safety score from all check results | Weighted sum of Tier 1 (hard block eliminates), Tier 2 (RugCheck score + holder score), Tier 3 (creator score) |
| SAF-09 | Bot enforces configurable minimum safety score threshold before buying | Compare `aggregateScore >= tradingConfig.safety.minSafetyScore` — reject with detailed log if below |
</phase_requirements>

---

## Summary

The Phase 3 safety pipeline has three tiers: hard-block authority/route checks (Tier 1), quantitative scoring signals (Tier 2), and deep creator history analysis (Tier 3). All Tier 1 checks can be done in parallel using standard `@solana/spl-token` and a Jupiter quote simulation. Tier 2 adds RugCheck API and on-chain holder concentration analysis. Tier 3 uses Helius Enhanced Transactions to detect serial token creators with rug histories. The architecture must handle pessimistic API failures (treat as negative signal), a TTL cache for re-detected mints, and per-check soft blocks that can reject independently of aggregate score.

The primary complexity areas are: (1) holder concentration — `getTokenLargestAccounts` returns token account addresses, not wallet owners, so a second resolution step is needed; (2) the RugCheck API requires an API key (free tier available) and is a third-party service with rate limits; (3) Helius Enhanced Transactions for creator history requires a Developer plan ($49/month) and costs 100 credits per request — this is a significant cost consideration. An alternative using standard `getSignaturesForAddress` + `getTransaction` avoids the paid plan but requires more work.

The Tier 1 hard checks (mint authority, freeze authority, Jupiter route) are the most critical and must always complete. Tiers 2 and 3 can time out and fail pessimistically without blocking the hard checks. The <300ms requirement for Tier 1 is achievable since all three are independent calls that can be parallelized.

**Primary recommendation:** Build the pipeline as `SafetyPipeline` class that accepts a `TokenEvent`, runs all tiers with `Promise.all` at each tier boundary, applies soft blocks and aggregate scoring, and emits a structured `SafetyResult`. Use `AbortSignal.timeout()` for Tier 2/3 calls. Cache results by mint with TTL. Write blocklist to a local JSON file that persists across restarts.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@solana/spl-token` | `^0.4.x` | `getMint()` for authority checks | Official SPL library — standard for all Solana token interactions |
| `@solana/web3.js` | `^1.98.4` (already installed) | `connection.getTokenLargestAccounts()`, `connection.getParsedAccountInfo()` | Already in project, standard Solana RPC |
| `node:fetch` / native fetch | Node 18+ built-in | Jupiter quote API, RugCheck API, Helius Enhanced TX | No extra dep — Node 18+ has native fetch |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@solana/spl-token` | `^0.4.x` | Must be added to package.json | Needed for `getMint()` — not currently installed |
| Helius Enhanced Transactions | REST API (no SDK needed) | Creator wallet history — Tier 3 | Only when `HELIUS_API_KEY` is configured; skip Tier 3 otherwise |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Helius Enhanced Transactions (paid) | Standard `getSignaturesForAddress` + `getTransaction` | Standard is free but requires N+1 RPC calls per transaction; parsing is manual; slower and more complex but avoids $49/month plan |
| RugCheck API | GoPlus Security API, on-chain metadata parsing | RugCheck is Solana-native and specifically known for memecoin analysis; GoPlus covers more chains but less specialized |
| `connection.getTokenLargestAccounts` | Helius `getTokenAccounts` DAS API | `getTokenLargestAccounts` is free/standard RPC but returns token account addresses (need second lookup for owners); Helius DAS returns owners directly but requires API key |

**Installation:**
```bash
pnpm add @solana/spl-token
```

---

## Architecture Patterns

### Recommended Project Structure
```
src/
├── safety/
│   ├── safety-pipeline.ts          # Main orchestrator — SafetyPipeline class
│   ├── safety-pipeline.test.ts     # Unit tests
│   ├── checks/
│   │   ├── tier1-authority.ts      # getMint() authority checks (SAF-01, SAF-02)
│   │   ├── tier1-sell-route.ts     # Jupiter quote simulation (SAF-03)
│   │   ├── tier2-rugcheck.ts       # RugCheck API call (SAF-05)
│   │   ├── tier2-holder.ts         # getTokenLargestAccounts + concentration (SAF-06)
│   │   └── tier3-creator.ts        # Helius Enhanced TX creator history (SAF-07)
│   ├── blocklist.ts                # Local persistent creator blocklist
│   └── safety-cache.ts             # In-memory TTL cache for SafetyResult
├── config/
│   └── trading.ts                  # Extended with SafetyConfig schema (SAF-08, SAF-09)
└── types/
    └── index.ts                    # SafetyResult, CheckResult, SafetyConfig types
```

### Pattern 1: Tiered Parallel Pipeline with Pessimistic Failure
**What:** Run Tier 1 checks first via `Promise.all` (hard blocks). If any fails, immediately reject. If all pass, run Tier 2 and Tier 3 in parallel with timeouts. Aggregate scores from whatever completed within timeout. Reject if below threshold or any per-check soft block triggered.
**When to use:** This is the only pattern — it satisfies SAF-04 (<300ms for Tier 1) and the pessimistic failure requirement.

```typescript
// Source: derived from Node.js AbortSignal.timeout() pattern + Promise.all
async function runSafetyPipeline(event: TokenEvent, config: SafetyConfig): Promise<SafetyResult> {
  // Tier 1: hard blocks — all three in parallel, must complete
  const [mintAuth, freezeAuth, sellRoute] = await Promise.all([
    checkMintAuthority(event.mint, connection),
    checkFreezeAuthority(event.mint, connection),
    checkSellRoute(event.mint),
  ]);

  if (!mintAuth.pass || !freezeAuth.pass || !sellRoute.pass) {
    return buildRejected([mintAuth, freezeAuth, sellRoute], 'tier1_hard_block');
  }

  // Tier 2 + Tier 3 in parallel with timeouts (pessimistic on failure)
  const tier2Timeout = AbortSignal.timeout(config.tier2TimeoutMs);
  const tier3Timeout = AbortSignal.timeout(config.tier3TimeoutMs);

  const [rugCheck, holderConc, creatorHistory] = await Promise.allSettled([
    runWithTimeout(checkRugCheck(event.mint), tier2Timeout),
    runWithTimeout(checkHolderConcentration(event.mint, connection), tier2Timeout),
    runWithTimeout(checkCreatorHistory(event.creator, heliusKey), tier3Timeout),
  ]);

  // Aggregate scores — treat rejected promises as worst-case scores
  const aggregateScore = computeAggregateScore([rugCheck, holderConc, creatorHistory], config.weights);

  // Per-check soft blocks (independent of aggregate)
  const softBlocks = checkSoftBlocks([rugCheck, holderConc, creatorHistory], config);

  if (softBlocks.length > 0 || aggregateScore < config.minSafetyScore) {
    return buildRejected(softBlocks, 'score_or_soft_block', aggregateScore, config.minSafetyScore);
  }

  return buildPassed(aggregateScore);
}
```

### Pattern 2: AbortSignal.timeout() for Tier 2/3 API Calls
**What:** Use Node.js 18+ built-in `AbortSignal.timeout(ms)` to enforce timeouts on fetch calls.
**When to use:** Every external API call in Tier 2 and Tier 3.

```typescript
// Source: Node.js 18+ built-in AbortSignal API
async function checkRugCheck(mint: string, signal: AbortSignal): Promise<CheckResult> {
  try {
    const response = await fetch(
      `https://api.rugcheck.xyz/v1/tokens/${mint}/report/summary`,
      { signal }
    );
    if (!response.ok) {
      // Pessimistic: API error = negative signal
      return { pass: true, score: 0, source: 'rugcheck', detail: `HTTP ${response.status}` };
    }
    const data = await response.json() as RugCheckSummary;
    return interpretRugCheckResult(data);
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      log.warn({ mint }, 'RugCheck timed out — pessimistic score applied');
    }
    // Pessimistic: timeout/error = worst-case score contribution
    return { pass: true, score: 0, source: 'rugcheck', detail: 'timeout_or_error' };
  }
}
```

### Pattern 3: getMint() for Authority Checks (Tier 1)
**What:** Single RPC call that returns both `mintAuthority` and `freezeAuthority`. Can split into two logical checks that share one RPC call.

```typescript
// Source: @solana/spl-token official API
import { getMint } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';

async function checkAuthorities(mintAddress: string, connection: Connection): Promise<[CheckResult, CheckResult]> {
  const mintPubkey = new PublicKey(mintAddress);
  const mint = await getMint(connection, mintPubkey);

  const mintAuthCheck: CheckResult = {
    pass: mint.mintAuthority === null,
    source: 'mint_authority',
    detail: mint.mintAuthority !== null ? `mint authority: ${mint.mintAuthority.toBase58()}` : 'revoked',
  };

  const freezeAuthCheck: CheckResult = {
    pass: mint.freezeAuthority === null,
    source: 'freeze_authority',
    detail: mint.freezeAuthority !== null ? `freeze authority: ${mint.freezeAuthority.toBase58()}` : 'revoked',
  };

  return [mintAuthCheck, freezeAuthCheck];
}
```

**Note:** This optimization (1 RPC call for 2 checks) satisfies SAF-04's <300ms requirement. However, for code clarity the planner may choose to keep them as separate functions that both call `getMint` — the RPC will likely serve from cache on the second call within the same event loop tick.

### Pattern 4: Jupiter Quote Simulation for Sell Route (SAF-03)
**What:** GET request to Jupiter Quote API with the token as `inputMint` and SOL as `outputMint`. A successful 200 response means a sell route exists. A 400 or error body means no route.

```typescript
// Source: https://dev.jup.ag/docs/swap/get-quote
const SOL_MINT = 'So11111111111111111111111111111111111111112';

async function checkSellRoute(mint: string, signal: AbortSignal): Promise<CheckResult> {
  try {
    const url = `https://api.jup.ag/swap/v1/quote?inputMint=${mint}&outputMint=${SOL_MINT}&amount=1000000&slippageBps=500`;
    const response = await fetch(url, { signal });

    if (response.status === 400) {
      const body = await response.json().catch(() => ({}));
      return { pass: false, source: 'jupiter_sell_route', detail: `no route: ${JSON.stringify(body)}` };
    }
    if (!response.ok) {
      // Pessimistic: unexpected error = block
      return { pass: false, source: 'jupiter_sell_route', detail: `HTTP ${response.status}` };
    }
    return { pass: true, source: 'jupiter_sell_route', detail: 'route exists' };
  } catch (err) {
    // Pessimistic: network error = block
    return { pass: false, source: 'jupiter_sell_route', detail: 'fetch_error' };
  }
}
```

**Key details:**
- Jupiter Quote API endpoint: `https://api.jup.ag/swap/v1/quote`
- SOL mint: `So11111111111111111111111111111111111111112`
- Error codes: `NO_ROUTES_FOUND`, `COULD_NOT_FIND_ANY_ROUTE` returned as 400 responses
- Amount: any non-zero amount works for route existence check (1000000 = 0.001 SOL equivalent in lamports)
- Jupiter lists tokens only if they have minimum liquidity of $250 and buy/sell price impact below 30% — new tokens may temporarily fail this check

### Pattern 5: Holder Concentration Check (SAF-06)
**What:** `getTokenLargestAccounts` returns the 20 largest SPL token accounts. Each entry has a `address` (token account, not wallet) and `uiAmountString`. Must resolve token accounts to owner wallets for exclusion of system accounts. Then compute top-1% and top-10% concentration.

```typescript
// Source: Solana RPC official docs + Helius blog "How to Get Token Holders"
async function checkHolderConcentration(
  mint: string,
  connection: Connection,
  config: SafetyConfig,
): Promise<CheckResult> {
  const mintPubkey = new PublicKey(mint);

  // Step 1: Get 20 largest token accounts
  const { value: largestAccounts } = await connection.getTokenLargestAccounts(mintPubkey);

  // Step 2: Get total supply
  const { value: supply } = await connection.getTokenSupply(mintPubkey);
  const totalSupply = parseFloat(supply.uiAmountString ?? '0');

  if (totalSupply === 0) {
    return { pass: false, source: 'holder_concentration', detail: 'zero total supply' };
  }

  // Step 3: Resolve token account addresses to owner wallets via getParsedAccountInfo
  const ownerAmounts: { owner: string; amount: number }[] = [];

  for (const account of largestAccounts) {
    const parsed = await connection.getParsedAccountInfo(account.address);
    const data = (parsed.value?.data as ParsedAccountData | undefined);
    const owner: string | undefined = data?.parsed?.info?.owner;
    const amount = parseFloat(account.uiAmountString ?? '0');

    if (owner && !SYSTEM_ACCOUNTS.has(owner)) {
      ownerAmounts.push({ owner, amount });
    }
  }

  // Step 4: Sort by amount and compute concentration
  ownerAmounts.sort((a, b) => b.amount - a.amount);

  const top1Pct = ownerAmounts[0] ? (ownerAmounts[0].amount / totalSupply) : 0;
  const top10Pct = ownerAmounts.slice(0, 10).reduce((sum, a) => sum + a.amount, 0) / totalSupply;

  if (top1Pct > config.safety.holder.top1SoftBlockThreshold) {
    return { pass: false, source: 'holder_concentration', detail: `top1=${top1Pct.toFixed(2)} exceeds ${config.safety.holder.top1SoftBlockThreshold}` };
  }
  if (top10Pct > config.safety.holder.top10SoftBlockThreshold) {
    return { pass: false, source: 'holder_concentration', detail: `top10=${top10Pct.toFixed(2)} exceeds ${config.safety.holder.top10SoftBlockThreshold}` };
  }

  // Score: inverse of concentration (lower concentration = higher score)
  const score = Math.max(0, 100 - Math.round(top10Pct * 100));
  return { pass: true, source: 'holder_concentration', score, detail: `top1=${top1Pct.toFixed(2)} top10=${top10Pct.toFixed(2)}` };
}
```

**Critical caveat:** `getTokenLargestAccounts` only returns token account addresses (not owner wallet addresses). A second `getParsedAccountInfo` call per account is needed to resolve the owner. This means up to 20 additional RPC calls for this check — batch them or use connection batching.

**Alternative:** Helius `getTokenAccounts` DAS API returns owners directly in one call (requires `HELIUS_API_KEY`). If the API key is available, this is much faster.

### Pattern 6: RugCheck API (SAF-05)
**What:** GET the summary endpoint which returns normalized score and risk array.

```typescript
// Source: https://api.rugcheck.xyz/swagger/doc.json (verified)
interface RugCheckSummary {
  score: number;               // raw score
  score_normalised: number;    // 0-100 normalized
  risks: RugCheckRisk[];
  lpLockedPct: number;
  tokenType: string;
  tokenProgram: string;
}

interface RugCheckRisk {
  name: string;
  level: string;       // e.g., "warn", "danger"
  description: string;
  score: number;
  value: string;
}

async function checkRugCheck(mint: string, signal: AbortSignal): Promise<CheckResult> {
  const url = `https://api.rugcheck.xyz/v1/tokens/${mint}/report/summary`;
  const response = await fetch(url, {
    signal,
    headers: {
      'X-API-KEY': process.env.RUGCHECK_API_KEY ?? '',  // free tier, key required
    },
  });
  // ...parse and return
}
```

**RugCheck score interpretation:**
- `score_normalised` is 0-100 (100 = highest risk, confusingly — verify this interpretation)
- `risks[]` contains individual risk factors with severity levels ("warn", "danger", "critical")
- High-severity risks in the array can be used for per-check soft blocks

**IMPORTANT:** The score direction may be inverted — research indicates RugCheck uses a "risk score" where higher = more risky (not safer). The pipeline must invert this when aggregating (e.g., `safetyContribution = 100 - rugCheckScore`).

### Pattern 7: Creator History (SAF-07)
**What:** Query Helius Enhanced Transactions for the creator wallet address, filtering for `TOKEN_MINT` type transactions to find prior token launches.

```typescript
// Source: https://www.helius.dev/docs/api-reference/enhanced-transactions/gettransactionsbyaddress
async function checkCreatorHistory(
  creator: string | undefined,
  heliusApiKey: string,
  signal: AbortSignal,
): Promise<CheckResult> {
  if (!creator) {
    // No creator in event — cannot check; return neutral score
    return { pass: true, source: 'creator_history', score: 50, detail: 'no_creator_in_event' };
  }

  // Check local blocklist first (fast path)
  if (isBlocklisted(creator)) {
    return { pass: false, source: 'creator_history', score: 0, detail: 'creator_blocklisted' };
  }

  const url = `https://api-mainnet.helius-rpc.com/v0/addresses/${creator}/transactions?api-key=${heliusApiKey}&type=TOKEN_MINT&limit=50`;
  const response = await fetch(url, { signal });

  if (!response.ok) {
    // Pessimistic: API error = assume worst
    return { pass: true, source: 'creator_history', score: 0, detail: `helius_error_${response.status}` };
  }

  const txs = await response.json() as HeliusEnhancedTransaction[];
  return analyzeCreatorHistory(creator, txs);
}
```

**Helius Enhanced Transactions API requirements:**
- Endpoint: `https://api-mainnet.helius-rpc.com/v0/addresses/{address}/transactions`
- Requires `api-key` query parameter
- Filter by `type=TOKEN_MINT` to find prior token creations
- **Requires Developer plan ($49/month) for full access; free tier is limited**
- Costs 100 credits per call; returns up to 100 transactions per request
- Free tier rate limit: 2 req/s on Enhanced APIs
- Developer tier: 10 req/s on Enhanced APIs

**Alternative if Helius Developer plan not available:** Use standard `connection.getSignaturesForAddress(new PublicKey(creator), { limit: 50 })` (free, but only returns signature + slot — no parsed type). Then batch fetch transactions with `connection.getParsedTransaction()` for each. Much slower but zero additional cost.

### Pattern 8: Local Creator Blocklist
**What:** Persist a Set of known-bad creator addresses to a local JSON file. Check this before any API calls (fast path). Update the file when a confirmed rug is detected.

```typescript
// blocklist.ts
import fs from 'node:fs';

const BLOCKLIST_PATH = './data/creator-blocklist.json';
let blocklist: Set<string> = new Set();

export function loadBlocklist(): void {
  try {
    const raw = fs.readFileSync(BLOCKLIST_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as string[];
    blocklist = new Set(parsed);
  } catch {
    // File doesn't exist yet — start empty
    blocklist = new Set();
  }
}

export function isBlocklisted(address: string): boolean {
  return blocklist.has(address);
}

export function addToBlocklist(address: string): void {
  blocklist.add(address);
  fs.writeFileSync(BLOCKLIST_PATH, JSON.stringify([...blocklist], null, 2));
}
```

### Pattern 9: Safety Result Cache with TTL
**What:** Map from mint address to `{ result: SafetyResult; expiresAt: number }`. Check on pipeline entry; skip all checks if valid cache hit.

```typescript
// safety-cache.ts
interface CacheEntry {
  result: SafetyResult;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export function getCached(mint: string): SafetyResult | null {
  const entry = cache.get(mint);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(mint);
    return null;
  }
  return entry.result;
}

export function setCached(mint: string, result: SafetyResult, ttlMs: number): void {
  cache.set(mint, { result, expiresAt: Date.now() + ttlMs });
}
```

### Pattern 10: Aggregate Scoring Model
**What:** Combine Tier 2 and Tier 3 scores into a 0-100 aggregate score. Tier 1 hard blocks bypass scoring entirely. Weights are configurable.

**Recommended score scale:** 0-100, integer. Higher = safer.

**Recommended weights (Claude's discretion):**
- Tier 2 RugCheck: 40 points contribution (0-40)
- Tier 2 Holder Concentration: 30 points contribution (0-30)
- Tier 3 Creator History: 30 points contribution (0-30)

**Pessimistic failure:** If a check times out or errors, its contribution is 0 (worst case for that tier).

**Soft blocks:** Applied independently of aggregate — extreme holder concentration OR confirmed rug creator rejects regardless of aggregate score.

```typescript
function computeAggregateScore(
  results: PromiseSettledResult<CheckResult>[],
  weights: SafetyWeights,
): number {
  const getScore = (r: PromiseSettledResult<CheckResult>): number =>
    r.status === 'fulfilled' ? (r.value.score ?? 0) : 0; // pessimistic

  const rugCheckScore = getScore(results[0]);  // 0-100, map to 0-40
  const holderScore = getScore(results[1]);     // 0-100, map to 0-30
  const creatorScore = getScore(results[2]);    // 0-100, map to 0-30

  return Math.round(
    (rugCheckScore / 100) * weights.rugCheck +
    (holderScore / 100) * weights.holder +
    (creatorScore / 100) * weights.creator,
  );
}
```

### Pattern 11: Detailed Rejection Logging
**What:** Rejection logs include which check failed, the actual value, and the threshold it missed. Matches user decision for "detailed" rejection logging.

```typescript
// Satisfies rejection logging requirement
log.info({
  mint: event.mint,
  source: event.source,
  decision: 'REJECTED',
  reason: 'holder_concentration',
  actualValue: 0.31,
  threshold: 0.25,
  aggregateScore: 52,
  minSafetyScore: 60,
}, 'Token rejected by safety pipeline');
```

### Anti-Patterns to Avoid
- **Sequential Tier 1 checks:** Running mint authority, then freeze authority, then sell route sequentially adds unnecessary latency. All three are independent — always use `Promise.all`.
- **Using `getTokenSupply` separately after `getMint`:** `getMint()` returns `supply` — no additional call needed for the supply field.
- **Blocking on Tier 2/3 indefinitely:** Tier 2 and Tier 3 checks are scoring signals, not blockers (except soft blocks). Always apply a timeout and proceed pessimistically.
- **Logging token account addresses as "holders":** `getTokenLargestAccounts` returns token accounts, not wallet addresses. Always resolve to owners before reporting.
- **Using RugCheck score directly as "safety" without inversion:** RugCheck `score`/`score_normalised` direction must be verified — if it represents "risk" (higher = worse), invert before aggregating.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Mint/freeze authority check | Custom account data parsing | `getMint()` from `@solana/spl-token` | `Mint` struct deserialization handles Token-2022 extensions correctly |
| Token sell route validation | On-chain pool lookups | Jupiter Quote API | Jupiter aggregates all DEXes — homegrown lookup misses routes |
| Token safety scoring | Custom rug heuristics | RugCheck API | Helius and RugCheck have trained models on thousands of rugs; custom heuristics are worse |
| HTTP timeout handling | `Promise.race()` with timer | `AbortSignal.timeout()` (Node 18+) | `Promise.race()` doesn't cancel the underlying fetch; `AbortSignal` does |
| Creator history parsing | Block explorer scraping | Helius Enhanced Transactions | Helius parses complex Solana instructions — scraping is fragile |

**Key insight:** Solana account data parsing has many edge cases (Token-2022 extensions, different program layouts). Don't write custom deserialization — `@solana/spl-token` handles all variants correctly.

---

## Common Pitfalls

### Pitfall 1: getTokenLargestAccounts Returns Token Accounts, Not Wallets
**What goes wrong:** Code logs the `.address` field from `getTokenLargestAccounts` as the "holder" address, but it's the token account (associated token account or vault), not the owner's wallet.
**Why it happens:** The RPC response field is named `address` which implies it's the holder's address, but it's actually the SPL token account.
**How to avoid:** Always call `connection.getParsedAccountInfo(tokenAccountAddress)` and extract `data.parsed.info.owner` to get the actual wallet. Or use Helius `getTokenAccounts` DAS API which returns `owner` directly.
**Warning signs:** "Holder" addresses that start with a PDA derivation pattern or are the same as known program addresses.

### Pitfall 2: RugCheck Score Direction May Be Inverted
**What goes wrong:** Treating RugCheck `score_normalised` as "higher = safer" when it may be "higher = riskier."
**Why it happens:** The API doc says "score" but doesn't clearly label the direction. Community use suggests RugCheck scores token risk (higher = more risky).
**How to avoid:** Verify the score direction against known safe and known risky tokens before going live. Apply `safetyScore = 100 - rugCheckScore` if score is risk-oriented.
**Warning signs:** All tokens passing even obvious rug pools, or all tokens being blocked with high scores on legitimate tokens.

### Pitfall 3: Jupiter Quote API Rate Limits on New Tokens
**What goes wrong:** Jupiter returns `COULD_NOT_FIND_ANY_ROUTE` for brand-new tokens because it hasn't indexed them yet, causing false-negative blocks on legitimate new tokens.
**Why it happens:** Jupiter only lists tokens with minimum $250 liquidity and <30% buy/sell price impact. Brand-new tokens may temporarily fail this.
**How to avoid:** Treat `NO_ROUTES_FOUND` as a hard block per SAF-03 (this is the correct behavior — no route = no guaranteed exit). This is expected and intentional, not a bug. The bot will miss some legitimate early-stage tokens, but this is the desired trade-off.
**Warning signs:** Very low buy rate on new token launches even when other checks pass.

### Pitfall 4: Helius Enhanced Transactions API Requires Paid Plan
**What goes wrong:** Tier 3 creator checks silently fail because the API returns 403 (unauthorized) on a free tier account.
**Why it happens:** `getTransactionsForAddress` with `type` filter requires Developer plan or higher.
**How to avoid:** Implement a graceful fallback: if `HELIUS_API_KEY` is not configured or returns 403, skip Tier 3 entirely or use a free-tier fallback (standard `getSignaturesForAddress` with manual parsing). Log a startup warning when Helius key is missing.
**Warning signs:** All Tier 3 checks returning pessimistic scores (0) consistently.

### Pitfall 5: Promise.allSettled vs Promise.all for Tier 2/3
**What goes wrong:** Using `Promise.all` for Tier 2/3 causes the entire Tier 2/3 evaluation to reject as soon as any one check throws, discarding partial results.
**Why it happens:** `Promise.all` short-circuits on first rejection. When a check times out and throws, the other checks' results are lost.
**How to avoid:** Use `Promise.allSettled` for Tier 2/3 checks. Check `status === 'fulfilled'` vs `status === 'rejected'` on each result and apply pessimistic scoring for rejected entries.
**Warning signs:** Tier 2 RugCheck score being applied but holder concentration never logged.

### Pitfall 6: getMint() throws on invalid/nonexistent mint
**What goes wrong:** If the `TokenEvent.mint` field contains an invalid address or the account doesn't exist yet (race condition), `getMint()` throws a connection error that propagates uncaught.
**Why it happens:** The token detection phase passes mint addresses immediately on creation. There's a small window where the account isn't finalized on all RPC nodes yet.
**How to avoid:** Wrap `getMint()` in try/catch. Treat account-not-found as a hard block (token doesn't exist = can't buy it). Add a short retry with backoff (1-2 retries, 100ms delay) before hard-blocking on not-found.
**Warning signs:** Frequent "account not found" errors in logs for legitimate new token events.

### Pitfall 7: Token-2022 Mints Have Extension Data
**What goes wrong:** Some tokens use the Token-2022 program (not Token program). `getMint()` from `@solana/spl-token` must be called with the correct program ID for Token-2022 tokens.
**Why it happens:** Token-2022 uses a different program ID (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`) than the standard Token program.
**How to avoid:** `getMint()` from `@solana/spl-token` v0.4+ handles both programs automatically. Ensure you're on a recent enough version. Or check `tokenProgram` field from RugCheck response to know which program to use.
**Warning signs:** "Invalid mint account data" errors for some tokens that are otherwise valid on-chain.

### Pitfall 8: Creator Address Not Present in All Events
**What goes wrong:** Tier 3 creator history check crashes because `event.creator` is undefined for Raydium events (which don't have a known creator).
**Why it happens:** The `TokenEvent` type has `creator?: string` — it's optional. Raydium pool events don't include a creator address in the detection phase.
**How to avoid:** Guard with `if (!event.creator) return neutralScore;` in Tier 3 checker. Log at debug level that creator check was skipped. The neutral score (50/100) means it doesn't help or hurt the aggregate.
**Warning signs:** Runtime errors in Tier 3 for Raydium-detected tokens.

---

## Code Examples

Verified patterns from official sources:

### getMint() for Authority Checks
```typescript
// Source: https://solana-labs.github.io/solana-program-library/token/js/functions/getMint.html
import { getMint } from '@solana/spl-token';
import { Connection, PublicKey } from '@solana/web3.js';

const mintInfo = await getMint(connection, new PublicKey(mintAddress));
// mintInfo.mintAuthority: null | PublicKey
// mintInfo.freezeAuthority: null | PublicKey
// mintInfo.supply: bigint
// mintInfo.decimals: number
// mintInfo.isInitialized: boolean
```

### getTokenLargestAccounts RPC
```typescript
// Source: https://solana.com/docs/rpc/http/gettokenlargestaccounts
const { value: accounts } = await connection.getTokenLargestAccounts(mintPubkey);
// accounts[n].address: PublicKey (TOKEN ACCOUNT, not wallet)
// accounts[n].amount: string (raw, no decimals)
// accounts[n].uiAmountString: string (with decimals applied)
// accounts[n].decimals: number
```

### Resolving Token Account to Owner
```typescript
// Source: derived from getParsedAccountInfo docs
const parsedInfo = await connection.getParsedAccountInfo(tokenAccountPubkey);
const owner = (parsedInfo.value?.data as ParsedAccountData)?.parsed?.info?.owner as string | undefined;
```

### Jupiter Quote API
```typescript
// Source: https://dev.jup.ag/docs/swap/get-quote
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const url = `https://api.jup.ag/swap/v1/quote?inputMint=${mint}&outputMint=${SOL_MINT}&amount=1000000&slippageBps=500`;
const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
// 200 = route exists
// 400 = no route (body contains error code: NO_ROUTES_FOUND, COULD_NOT_FIND_ANY_ROUTE)
```

### RugCheck Summary API
```typescript
// Source: https://api.rugcheck.xyz/swagger/doc.json (verified)
// GET /v1/tokens/{id}/report/summary
const res = await fetch(`https://api.rugcheck.xyz/v1/tokens/${mint}/report/summary`, {
  headers: { 'X-API-KEY': apiKey },
  signal: AbortSignal.timeout(5000),
});
// Response: { score: number, score_normalised: number, risks: Risk[], lpLockedPct: number, ... }
```

### Helius Enhanced Transactions for Creator
```typescript
// Source: https://www.helius.dev/docs/api-reference/enhanced-transactions/gettransactionsbyaddress
const url = `https://api-mainnet.helius-rpc.com/v0/addresses/${creator}/transactions?api-key=${apiKey}&type=TOKEN_MINT&limit=50`;
const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
// Returns array of EnhancedTransaction objects
// Each has: type, source, timestamp, tokenTransfers[], description
```

### System Accounts to Exclude from Holder Concentration
```typescript
// Known Pump.fun and Solana system addresses that hold tokens but aren't "real" holders
const SYSTEM_ACCOUNTS = new Set([
  '11111111111111111111111111111111',           // System Program
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // Token Program
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', // Token-2022 Program
  '1nc1nerator11111111111111111111111111111111',   // Incinerator (burn address)
  // Note: Pump.fun bonding curve is a PDA per-token — cannot hardcode it
  // Instead: check if owner is a PDA of the Pump.fun program ID
]);

// Pump.fun program ID (for PDA detection):
const PUMP_FUN_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
```

**Note on Pump.fun bonding curve exclusion:** The bonding curve for each token is a PDA derived from `["bonding-curve", mint]` using the Pump.fun program. Its address is unique per token. The practical approach is to check if the owner of a large token account is owned by the Pump.fun program (the PDA is owned by the Pump.fun program on-chain), then exclude it. Alternatively, skip accounts where the owner is any known program (not a user wallet).

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Polling for token info after detection | Immediate `getMint()` on detection event | Always current | No change needed |
| `Promise.race()` for timeouts | `AbortSignal.timeout()` (Node 18+) | Node 18 (2022) | Cleaner cancellation, no dangling promises |
| Separate `getAccountInfo` + manual deserialization | `getMint()` from `@solana/spl-token` | SPL library v0.3+ | Handles Token-2022 extensions automatically |
| Checking only top-10 holders | Top-1 AND top-10 separate thresholds | Community practice | Top-1 whale check catches single-party control |
| Jupiter v4 API (`jup.ag/v4/quote`) | Jupiter v6+ (`api.jup.ag/swap/v1/quote`) | 2024 | v4 deprecated — use v6 endpoint |

**Deprecated/outdated:**
- `jup.ag/v4/quote`: Deprecated — use `api.jup.ag/swap/v1/quote`
- Manual mint account data parsing with `getAccountInfo`: Replaced by `getMint()` from `@solana/spl-token`
- `getTokenAccountsByOwner` for holder lookup: For large-scale holder analysis, Helius `getTokenAccounts` DAS is more efficient

---

## Open Questions

1. **RugCheck score direction — risk or safety?**
   - What we know: API returns `score` and `score_normalised`; community sources describe it as a "risk score" or "safety score" inconsistently
   - What's unclear: Whether higher `score_normalised` means safer or riskier
   - Recommendation: At implementation time, test against a known safe token (e.g., BONK, WIF) and a known rug. Verify empirically before shipping. Implement with an inversion flag in config in case the interpretation needs to change.

2. **Helius Developer Plan requirement for Tier 3**
   - What we know: `getTransactionsForAddress` with type filter requires Developer plan ($49/month, 100 credits/call)
   - What's unclear: Whether the standard `getSignaturesForAddress` + manual transaction fetch can provide equivalent signal at acceptable latency
   - Recommendation: Implement Tier 3 with a conditional: if `HELIUS_API_KEY` is set, use Enhanced Transactions; otherwise fall back to `getSignaturesForAddress` + batch `getTransaction` calls (free but slower). Make Tier 3 opt-in via config.

3. **Pump.fun bonding curve holder exclusion**
   - What we know: Bonding curve is a PDA of Pump.fun program; its address is unique per token
   - What's unclear: The exact PDA derivation seeds for the current Pump.fun program post-PumpSwap migration
   - Recommendation: Exclude any token account whose owner is a known on-chain program (not a user wallet — user wallets are system-owned accounts). This is a generalized rule that handles bonding curves, LP vaults, and other program-controlled accounts without needing specific addresses.

4. **Token-2022 program compatibility**
   - What we know: `getMint()` from `@solana/spl-token` v0.4+ handles both Token and Token-2022 programs
   - What's unclear: Whether any Pump.fun or Raydium tokens use Token-2022 in practice (most memecoins use the standard Token program)
   - Recommendation: Use `getMint()` and let the library handle it. Add error logging if program ID mismatch errors appear.

5. **Safety pipeline timing budget**
   - What we know: Tier 1 must complete in <300ms (SAF-04); Tiers 2/3 are "non-blocking" (SAF-05, SAF-06, SAF-07)
   - What's unclear: Whether "non-blocking" means we proceed to buy while Tier 2/3 run async, or we still wait for them with a generous timeout
   - Recommendation: Based on user context ("Tier 2/3 timing strategy: Claude's discretion"), recommend waiting for Tier 2/3 with a generous timeout (2000ms Tier 2, 5000ms Tier 3) before making the final decision. This avoids buying tokens that would fail Tier 2/3 checks. The time cost (2-5 seconds) is acceptable since we're waiting for safety signals, not racing to buy.

---

## Sources

### Primary (HIGH confidence)
- `@solana/spl-token` official API — `getMint()`, `Mint` interface with `mintAuthority: null | PublicKey`, `freezeAuthority: null | PublicKey`
- https://solana.com/docs/rpc/http/gettokenlargestaccounts — official `getTokenLargestAccounts` RPC docs
- https://api.rugcheck.xyz/swagger/doc.json — verified RugCheck API spec, confirmed `GET /v1/tokens/{id}/report/summary` endpoint and `TokenCheckSummary` response schema
- https://dev.jup.ag/docs/swap/get-quote — Jupiter Quote API endpoint and parameters
- https://www.helius.dev/docs/api-reference/enhanced-transactions/gettransactionsbyaddress — Helius Enhanced TX endpoint, auth requirements, response schema

### Secondary (MEDIUM confidence)
- https://www.helius.dev/blog/how-to-get-token-holders-on-solana — confirmed `getTokenAccounts` returns owner field directly; verified `getParsedAccountInfo` approach for resolving token account owners
- https://www.helius.dev/docs/billing/plans-and-rate-limits — confirmed Developer plan required for Enhanced APIs at 2 req/s (free), 10 req/s (Developer)
- https://github.com/jup-ag/jupiter-swap-api/issues/71 — confirmed `COULD_NOT_FIND_ANY_ROUTE` error code and 400 response for no-route case
- https://qodex.ai/blog/how-to-get-a-rugcheck-api-key-and-start-using-the-api — RugCheck API key requirement and `X-API-KEY` header
- AbortSignal.timeout() — MDN Web APIs (standard Node 18+ built-in, no library needed)

### Tertiary (LOW confidence)
- RugCheck score direction (risk vs safety orientation) — community sources are inconsistent; requires empirical verification at implementation time
- Pump.fun program ID for bonding curve PDA detection — cited from community docs but should be verified on-chain before hardcoding
- Helius Enhanced TX `type=TOKEN_MINT` filter behavior with Pump.fun-created tokens — confirmed TOKEN_MINT type exists; unclear if Pump.fun-created tokens are classified as TOKEN_MINT or a different source

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — `@solana/spl-token` is the canonical library; Jupiter and RugCheck APIs verified against official docs
- Architecture: HIGH — tiered pipeline pattern is well-established; all Tier 1 approaches verified
- Tier 2 checks: MEDIUM — RugCheck API endpoint and response schema verified; score direction requires empirical check
- Tier 3 checks: MEDIUM — Helius endpoint verified; paid plan requirement confirmed; creator history interpretation is heuristic
- Pitfalls: HIGH — token account vs wallet address confusion is a well-documented Solana gotcha

**Research date:** 2026-02-22
**Valid until:** 2026-03-22 (stable APIs; RugCheck and Helius may evolve)
