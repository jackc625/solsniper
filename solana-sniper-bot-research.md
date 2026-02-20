# Deep Research: Solana Sniping Bot + Autonomous Trader

> **Research Date:** February 19, 2026  
> **Target Audience:** TypeScript/Node.js developer building a mainnet Solana trading bot  
> **Scope:** Detection → Safety → Execution → PnL/Exits → Testing → Operations

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Market Landscape & Competitor Analysis](#2-market-landscape--competitor-analysis)
3. [Execution Approach (Buy/Sell)](#3-execution-approach-buysell)
4. [Transaction Reliability](#4-transaction-reliability)
5. [Route Selection & Slippage Strategy](#5-route-selection--slippage-strategy)
6. [Detection Pipeline](#6-detection-pipeline)
7. [Safety Checks & Scoring Matrix](#7-safety-checks--scoring-matrix)
8. [PnL & Exit System Design](#8-pnl--exit-system-design)
9. [Test Mode Design](#9-test-mode-design)
10. [Reliability & Operations](#10-reliability--operations)
11. [Feature Matrix — MVP Prioritization](#11-feature-matrix--mvp-prioritization)
12. [Tech Stack Recommendation](#12-tech-stack-recommendation)
13. [AI Tool Guide](#13-ai-tool-guide)
14. [Development Roadmap](#14-development-roadmap)
15. [Learning Resources](#15-learning-resources)
16. [Budget Forecast](#16-budget-forecast)

---

## 1. Executive Summary

Building a profitable Solana sniping bot requires mastering five subsystems: **detection** (finding new tokens fast), **safety** (filtering scams), **execution** (landing buy/sell transactions reliably), **PnL management** (knowing when to exit), and **operations** (keeping it all running). Only ~10% of sniper bots achieve sustainable profitability — the difference comes down to infrastructure quality, safety filtering, and sell reliability rather than pure speed alone.

**Your biggest blocker — buy/sell execution — is the most common failure point.** The recommended approach is: Jupiter Swap API for routing + Jito bundles for MEV protection and atomic execution + a staked RPC provider (Helius or Triton One) for transaction landing. For pump.fun tokens specifically, PumpPortal's trade-local API gives you the fastest path since it skips aggregator overhead for tokens still on the bonding curve.

**Key strategic insight:** Speed matters, but safety matters more. A bot that's 200ms slower but filters out 90% of rugs will vastly outperform a bot that's fastest-to-buy but eats losses on honeypots. Design your pipeline to run safety checks *in parallel* with execution preparation, not sequentially.

---

## 2. Market Landscape & Competitor Analysis

### What Existing Sniping Bots Do

The Solana sniping ecosystem is split into three tiers:

| Tier | Examples | Architecture | Typical Latency |
|------|----------|-------------|----------------|
| **Consumer Telegram bots** | GMGN, BonkBot, Trojan | Cloud-hosted, public RPC, UI-driven | 500ms–2s |
| **Open-source self-hosted** | fdundjer/solana-sniper-bot, tjazerzen/sol-sniper-bot | TypeScript/Node.js, configurable, single RPC | 200ms–1s |
| **Pro/institutional** | Custom in-house bots | Rust or TS + dedicated infra, Geyser/gRPC, co-located | <100ms |

### Common Architectures

Most open-source bots follow this pattern:
1. **Listener** — WebSocket subscription to Raydium pool creation logs or PumpPortal new-token events
2. **Filter** — Check mint/freeze authority, pool size, optional RugCheck API call
3. **Buyer** — Jupiter or PumpPortal swap, with retry logic
4. **Monitor** — Poll price at intervals, compare to entry price
5. **Seller** — Triggered by stop-loss, take-profit, or max-hold-time

### Known Pitfalls from Existing Bots

- **Over-reliance on public RPCs** — Rate-limited and deprioritized during congestion. This alone causes most execution failures.
- **No sell reliability** — Bots that buy reliably but can't sell reliably are a recipe for losses. Sells on low-liquidity tokens require different slippage and fee strategies than buys.
- **No duplicate prevention** — Without idempotency, crash-and-restart can cause double buys.
- **Blocking safety checks** — Running checks sequentially before buying means missing the entry window. Parallel execution is essential.
- **Single-threaded monitoring** — Watching 50+ positions with `setInterval` doesn't scale.

---

## 3. Execution Approach (Buy/Sell)

This is your most important subsystem. Here's the comparison:

### Jupiter vs Raydium vs PumpPortal vs Direct Program Calls

| Approach | Best For | Latency | Complexity | Sell Support | Notes |
|----------|---------|---------|-----------|-------------|-------|
| **Jupiter Swap API** | Post-migration tokens with Raydium/Orca pools | Medium (200–500ms for quote+swap) | Low — REST API returns serialized tx | Excellent — best route finding | Industry standard aggregator. Handles route-finding, slippage, and tx building. Dynamic slippage and priority fees built-in. |
| **PumpPortal trade-local** | Pump.fun bonding curve tokens | Low (single HTTP call) | Very low — returns ready-to-sign tx | Good for pump.fun tokens | 0.5% fee per trade. Handles both bonding curve and post-migration Raydium pools. No separate quote step needed. |
| **Raydium SDK v2 (direct)** | Raydium CLMM/AMM pools specifically | Low (no aggregator overhead) | High — must manage pool state, compute swap amounts | Works but no route optimization | Faster than Jupiter for known Raydium pools. Must handle pool discovery yourself. |
| **Direct Pump.fun program CPI** | Zero-overhead bonding curve trades | Lowest possible | Very high — manual instruction building, IDL parsing | Yes but manual | Avoids PumpPortal's 0.5% fee. Requires understanding pump.fun's on-chain program. Used by pro-level bots. |

### Recommended Hybrid Strategy

```
Token detected on pump.fun bonding curve
  → Use PumpPortal trade-local API (fastest for new tokens)
  → Fall back to direct pump.fun program call (saves 0.5% fee once you've built it)

Token migrated to Raydium/PumpSwap
  → Use Jupiter Swap API (best route aggregation across all DEXs)
  → Fall back to Raydium SDK direct (if Jupiter is slow/down)
```

### Jupiter Swap API — The Practical Path

Jupiter is the right starting point for your TypeScript skill level. Here's the actual flow:

**Step 1: Get a quote**
```
GET https://api.jup.ag/swap/v1/quote
  ?inputMint=So11111111111111111111111111111111111111112
  &outputMint={TOKEN_MINT}
  &amount={LAMPORTS}
  &slippageBps=500
  &maxAccounts=64
```

**Step 2: Build swap transaction**
```
POST https://api.jup.ag/swap/v1/swap
{
  "userPublicKey": "{YOUR_WALLET}",
  "quoteResponse": {quote from step 1},
  "dynamicComputeUnitLimit": true,
  "dynamicSlippage": true,
  "prioritizationFeeLamports": {
    "priorityLevelWithMaxLamports": {
      "priorityLevel": "veryHigh",
      "maxLamports": 1000000
    }
  }
}
```

**Step 3: Deserialize, sign, send**
```typescript
const swapTxBuf = Buffer.from(swapResponse.swapTransaction, 'base64');
const tx = VersionedTransaction.deserialize(swapTxBuf);
tx.sign([wallet]);
const sig = await connection.sendRawTransaction(tx.serialize(), {
  skipPreflight: true,
  maxRetries: 0  // handle retries yourself
});
```

**Key Jupiter parameters for sniping:**
- `dynamicSlippage: true` — Jupiter estimates optimal slippage. Far better than a fixed value for volatile tokens.
- `dynamicComputeUnitLimit: true` — Jupiter simulates and sets the right compute budget.
- `priorityLevel: "veryHigh"` — Critical for landing during congestion. Jupiter caps at 5M lamports (~0.005 SOL).
- `maxAccounts: 64` — Limits route complexity to avoid tx size issues. Lower = simpler routes = faster.

### PumpPortal — For Pump.fun Tokens

PumpPortal gives you a ready-to-sign transaction in a single HTTP call:

```typescript
const response = await fetch('https://pumpportal.fun/api/trade-local', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    publicKey: wallet.publicKey.toBase58(),
    action: 'buy',       // or 'sell'
    mint: tokenMint,
    denominatedInSol: 'true',
    amount: 0.01,         // SOL amount
    slippage: 15,          // percent
    priorityFee: 0.0005,   // SOL
    pool: 'pump'           // 'pump' or 'raydium'
  })
});
const txBytes = new Uint8Array(await response.arrayBuffer());
const tx = VersionedTransaction.deserialize(txBytes);
tx.sign([wallet]);
await connection.sendRawTransaction(tx.serialize());
```

**Trade-off:** PumpPortal charges 0.5% per trade. For a 0.01 SOL buy, that's 0.00005 SOL — negligible. For larger positions, building direct pump.fun program calls eliminates this cost.

### Why Sells Fail — Common Failure Modes

Sells fail far more often than buys. Understanding why is critical:

| Failure Mode | Cause | Detection | Mitigation |
|-------------|-------|-----------|-----------|
| **Insufficient liquidity** | Pool drained or token dumped | Jupiter returns no route or extreme price impact | Set max price impact threshold (e.g., 30%). Chunk large sells. |
| **Stale blockhash** | Transaction built too slowly | `BlockhashNotFound` error | Fetch fresh blockhash immediately before signing. Use `processed` commitment for speed. |
| **Compute budget exceeded** | Complex route or token-2022 extensions | `ComputationalBudgetExceeded` | Set compute units higher (400k–1.4M). Use `dynamicComputeUnitLimit`. |
| **Slippage exceeded** | Price moved between quote and execution | `SlippageToleranceExceeded` or custom program error | Use dynamic slippage. Start at 5%, escalate to 15–30% on retry. |
| **Honeypot / freeze** | Token has active freeze authority or transfer hooks | Transaction simulation fails | Pre-check freeze authority. Simulate sell before buying. |
| **Account not found** | Associated token account closed or never created | `AccountNotFound` | Ensure ATA exists before sell. Jupiter handles this with `wrapAndUnwrapSol`. |
| **Priority fee too low** | Congested network drops your tx | Transaction never confirms | Escalate priority fee on each retry. Use Jito bundles as fallback. |

---

## 4. Transaction Reliability

### Building Reliable Transactions

Every transaction must handle:

1. **Versioned Transactions** — All Jupiter swaps use V0 transactions with Address Lookup Tables (ALTs). Use `VersionedTransaction`, not legacy `Transaction`.

2. **Compute Budget** — Set explicitly:
   ```typescript
   import { ComputeBudgetProgram } from '@solana/web3.js';
   // Add as first instructions if building your own tx:
   ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 });
   ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 });
   ```
   Jupiter's `dynamicComputeUnitLimit` handles this for you when using their API.

3. **Priority Fees** — Essential for landing during congestion. Strategy:
   - **Normal conditions:** 10,000–50,000 micro-lamports
   - **High congestion:** 100,000–500,000 micro-lamports  
   - **Critical (must-land sell):** 1,000,000+ micro-lamports (0.001 SOL)
   - Jupiter's `priorityLevelWithMaxLamports` with `"veryHigh"` is the easiest approach.

4. **Blockhash Management** — Blockhashes expire after ~60 seconds (~150 slots):
   ```typescript
   // Fetch with 'processed' for speed (vs 'confirmed' which is safer but slower)
   const { blockhash, lastValidBlockHeight } = 
     await connection.getLatestBlockhash('processed');
   ```
   **Critical:** Fetch the blockhash as close to signing as possible. If your safety checks take 5 seconds, fetch the blockhash *after* the checks, not before.

### Confirmation Strategy

| Level | Meaning | Use When |
|-------|---------|---------|
| `processed` | Seen by connected RPC node | Fetching blockhash for speed |
| `confirmed` | Confirmed by supermajority of cluster | Treating a buy as "landed" — this is the sweet spot |
| `finalized` | Rooted (irreversible) | Final accounting, PnL calculation |

**Pattern for confirming trades:**
```typescript
const sig = await connection.sendRawTransaction(tx.serialize(), {
  skipPreflight: true,  // Already simulated; skip for speed
  maxRetries: 0          // Handle retries yourself
});

// Poll for confirmation with timeout
const confirmation = await connection.confirmTransaction(
  { signature: sig, blockhash, lastValidBlockHeight },
  'confirmed'
);

if (confirmation.value.err) {
  // Transaction landed but failed — check the error
  handleTransactionError(confirmation.value.err);
} else {
  // Success — record trade
}
```

### Jito Bundles for Critical Transactions

Jito bundles provide atomic execution (all-or-nothing) and MEV protection. About 95% of Solana stake runs the Jito validator client as of early 2026, so bundles will be processed in most slots.

**When to use Jito bundles:**
- Sell transactions where you need guaranteed execution
- Buy + sell in the same block (sandwich yourself for protection)
- Any transaction where you need atomicity

**Bundle structure:**
```typescript
import { Connection, Keypair, VersionedTransaction, SystemProgram } from '@solana/web3.js';

// Build your swap transaction normally
const swapTx = /* ... your Jupiter/PumpPortal swap tx ... */;

// Build tip transaction (minimum 1000 lamports, competitive = 10k-100k+)
const tipAccounts = [
  "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
  "HFqU5x63VTqvQss8hp11i4bPg4W3Dn1iBASQ7XQHAHAH",
  // ... 8 Jito tip accounts total
];
const tipIx = SystemProgram.transfer({
  fromPubkey: wallet.publicKey,
  toPubkey: new PublicKey(tipAccounts[Math.floor(Math.random() * tipAccounts.length)]),
  lamports: 50_000  // tip amount
});

// Send as bundle via Jito block engine
const bundleResponse = await fetch('https://mainnet.block-engine.jito.wtf/api/v1/bundles', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'sendBundle',
    params: [[base64SwapTx, base64TipTx], { encoding: 'base64' }]
  })
});
```

**Key bundle facts:**
- Max 5 transactions per bundle
- Executed sequentially and atomically
- Tip must be in the last transaction
- Auctions happen every ~200ms
- No on-chain record if bundle is dropped — you must poll `getBundleStatuses`

### Retry Logic & Idempotency

**Retry strategy for buys:**
```
Attempt 1: Standard priority fee, standard slippage
Attempt 2: 2x priority fee, same slippage (fresh blockhash)
Attempt 3: 3x priority fee, 1.5x slippage (fresh blockhash)
Attempt 4: Jito bundle with tip (fresh blockhash)
Attempt 5: Abort — token may have moved too much
```

**Retry strategy for sells (more aggressive):**
```
Attempt 1: Standard priority fee, 10% slippage
Attempt 2: 2x priority fee, 20% slippage
Attempt 3: Jito bundle with 50k lamport tip, 30% slippage
Attempt 4: Jito bundle with 100k tip, 40% slippage
Attempt 5: Chunk sell (sell 50% at a time), max slippage
Attempt 6: Emergency — max priority fee, 49% slippage
```

**Duplicate Prevention:**
- Track `(tokenMint, direction)` in an in-memory Set
- Before sending any transaction, check if you already have a pending or confirmed trade for this token+direction
- Use a trade journal (SQLite or JSON file) that persists across restarts
- On restart, check which trades are pending and resolve them before accepting new signals

---

## 5. Route Selection & Slippage Strategy

### Slippage for Volatile/Low-Liquidity Tokens

Fixed slippage doesn't work for meme tokens. Here's a practical framework:

| Token State | Recommended Slippage | Rationale |
|------------|---------------------|-----------|
| Pump.fun bonding curve (pre-migration) | 10–20% | High volatility, thin bonding curve |
| Just migrated to Raydium (first 5 min) | 5–15% | Rapidly changing liquidity |
| Established pool (1hr+) | 1–5% | Enough liquidity for reasonable fills |
| Sell in panic (dump in progress) | 20–49% | Getting *anything* back is better than zero |

**Jupiter's `dynamicSlippage`** feature is strongly recommended. It simulates the trade and estimates realistic slippage, then applies it automatically. This removes the guessing game.

### Detecting Bad Routes

Before executing, check the quote response:

```typescript
function isRouteAcceptable(quote: QuoteResponse): boolean {
  // 1. Price impact check
  const priceImpact = parseFloat(quote.priceImpactPct);
  if (priceImpact > 10) return false;  // >10% price impact = avoid
  
  // 2. Route complexity check
  if (quote.routePlan.length > 3) return false;  // Too many hops = risky
  
  // 3. Output sanity check — is output amount reasonable?
  const inUsd = parseFloat(quote.inAmount) / 1e9 * solPrice;
  const outUsd = parseFloat(quote.outAmount) * tokenPrice;
  if (outUsd < inUsd * 0.5) return false;  // Losing >50% immediately
  
  return true;
}
```

**When to abort:**
- Jupiter returns no route → Token has no liquidity or is not tradable
- Price impact > 10% on a buy → Liquidity too thin, you'll move the price significantly
- Route uses >3 hops → Increased failure risk and MEV exposure
- Output amount is nonsensical → Stale pool state or manipulated reserves

---

## 6. Detection Pipeline

### Sources Ranked by Latency

| Source | Latency | Cost | Detection Method | Best For |
|--------|---------|------|-----------------|---------|
| **Geyser gRPC (Yellowstone)** | ~0–50ms | $300–1000+/mo (dedicated node) | Stream program account changes directly from validator | Pro-level, lowest latency |
| **On-chain `logsSubscribe`** | ~50–200ms | RPC subscription cost | WebSocket subscription to pump.fun program logs | Good balance of speed and simplicity |
| **PumpPortal WebSocket** | ~100–300ms | Free (data API) | `subscribeNewToken` event | Easiest for pump.fun specifically |
| **`blockSubscribe`** | ~100–200ms | May require paid RPC tier | Full block stream, parse for pool creation | Comprehensive but noisy |
| **Birdeye/DexScreener APIs** | ~1–5s | Free tier available | REST polling or webhooks | Too slow for sniping, good for monitoring |
| **Bitquery Streaming** | ~500ms–2s | Paid plans | GraphQL subscriptions | Analytics, not sniping |

### Recommended: PumpPortal WebSocket + logsSubscribe Hybrid

**Primary — PumpPortal (easiest, pump.fun-specific):**
```typescript
import WebSocket from 'ws';

const ws = new WebSocket('wss://pumpportal.fun/api/data');

ws.on('open', () => {
  // Subscribe to new token creation events
  ws.send(JSON.stringify({ method: 'subscribeNewToken' }));
  
  // Subscribe to migration events (bonding curve → Raydium)
  ws.send(JSON.stringify({ method: 'subscribeMigration' }));
});

ws.on('message', (data) => {
  const event = JSON.parse(data.toString());
  if (event.txType === 'create') {
    // New token detected!
    handleNewToken(event);
  }
  if (event.txType === 'migrate') {
    // Token migrated to Raydium
    handleMigration(event);
  }
});
```

**Secondary — logsSubscribe (for non-pump.fun tokens, Raydium pool creation):**
```typescript
connection.onLogs(
  RAYDIUM_PROGRAM_ID,  // e.g., '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8'
  (logs) => {
    if (logs.logs.some(log => log.includes('InitializePool') || log.includes('initialize2'))) {
      // New Raydium pool created
      parseAndHandleNewPool(logs);
    }
  },
  'processed'
);
```

### Validating a Mint is Tradable

Detection is useless if the token can't actually be traded. After detection, validate:

1. **Route exists** — Call Jupiter quote API. If it returns a route, the token has a swap path.
2. **Liquidity exists** — Check pool reserves. For Raydium: fetch pool account data and verify SOL side > minimum threshold (e.g., 1 SOL).
3. **Token account is valid** — Verify the mint account exists and is initialized (`connection.getAccountInfo(mintPubkey)`).
4. **Not just metadata** — Some tokens exist as mint accounts with metadata but no pool. The Jupiter quote check handles this.

---

## 7. Safety Checks & Scoring Matrix

### Ranked Check List

#### Tier 1: MUST-HAVE (Block trade if failed)

| Check | What It Detects | How to Implement | Speed |
|-------|----------------|-----------------|-------|
| **Mint authority = null** | Creator can mint unlimited tokens, dilute supply | `connection.getAccountInfo(mintPubkey)` → parse `mintAuthority` field from SPL Token account data | <50ms |
| **Freeze authority = null** | Creator can freeze your account, making it a honeypot | Same as above → parse `freezeAuthority` field | <50ms |
| **Sell simulation** | Token is a honeypot (can buy, can't sell) | Call Jupiter `/quote` for a simulated sell (token → SOL). If no route or simulation fails, it's a honeypot | 100–300ms |
| **Minimum liquidity** | Pool has enough SOL to exit | Check pool reserves via RPC or Jupiter quote price impact | <100ms |

#### Tier 2: RECOMMENDED (Score penalty, but don't necessarily block)

| Check | What It Detects | How to Implement | Speed |
|-------|----------------|-----------------|-------|
| **Top 10 holder concentration** | Whale risk / insider supply | `connection.getTokenLargestAccounts(mintPubkey)` → if top 10 hold >30% (excluding pool accounts), flag | 100–500ms |
| **Metadata mutability** | Creator can change token name/links to phish | Fetch metadata account → check `isMutable` flag | <100ms |
| **RugCheck.xyz API score** | Comprehensive automated safety analysis | `GET https://api.rugcheck.xyz/v1/tokens/{mint}/report` → check `score` and `risks` array | 200–500ms |
| **LP token status** | Liquidity can be pulled | Check if LP tokens are burned (sent to 1111...1111 address) or held by deployer | 100–300ms |
| **Dev wallet behavior** | Creator dumping or suspicious transfers | Track creator wallet's recent transactions | 200–500ms |

#### Tier 3: OPTIONAL (Nice-to-have, risk of false positives)

| Check | What It Detects | Caveat |
|-------|----------------|-------|
| **Token age** | Very new tokens are riskier | Filters out all new tokens, which is your target — use as a score modifier, not a blocker |
| **Social media links** | Legitimacy signal | Many legit meme tokens have no socials; many scams have fake ones |
| **Creator history** | Repeat rug-puller | Requires indexing; Bitquery/Helius can help. High false-positive rate for new wallets |
| **Transfer hooks (Token-2022)** | Advanced honeypot via extensions | Only relevant for Token-2022 tokens; most pump.fun tokens use standard SPL |
| **Buy/sell ratio** | Honeypot signal (many buys, zero sells) | Requires watching trades for a few minutes — delays entry |

### Implementing the Scoring Matrix

```typescript
interface SafetyScore {
  score: number;        // 0-100, higher = safer
  mustPass: boolean;    // false = hard block
  flags: string[];      // list of concerns
}

async function runSafetyChecks(mint: string): Promise<SafetyScore> {
  const flags: string[] = [];
  let score = 100;
  
  // Tier 1 — Run in parallel
  const [mintInfo, sellQuote, rugReport] = await Promise.all([
    getMintInfo(mint),
    getJupiterQuote(mint, SOL_MINT, testAmount),
    fetchRugCheckReport(mint).catch(() => null)  // optional, don't block on failure
  ]);
  
  // Hard blocks
  if (mintInfo.mintAuthority !== null) return { score: 0, mustPass: false, flags: ['MINT_AUTHORITY_ACTIVE'] };
  if (mintInfo.freezeAuthority !== null) return { score: 0, mustPass: false, flags: ['FREEZE_AUTHORITY_ACTIVE'] };
  if (!sellQuote || !sellQuote.routePlan?.length) return { score: 0, mustPass: false, flags: ['NO_SELL_ROUTE'] };
  
  // Tier 2 — Score deductions
  if (mintInfo.isMutable) { score -= 10; flags.push('METADATA_MUTABLE'); }
  if (sellQuote.priceImpactPct > 15) { score -= 20; flags.push('HIGH_SELL_IMPACT'); }
  
  if (rugReport) {
    if (rugReport.score > 500) { score -= 30; flags.push('RUGCHECK_HIGH_RISK'); }
    // Integrate RugCheck risks
    for (const risk of rugReport.risks || []) {
      if (risk.level === 'error') { score -= 15; flags.push(risk.name); }
      if (risk.level === 'warn') { score -= 5; flags.push(risk.name); }
    }
  }
  
  return { score: Math.max(0, score), mustPass: true, flags };
}
```

### Speed vs Safety Trade-off

**Critical insight:** Don't run checks sequentially. Use `Promise.all` to run Tier 1 checks in parallel. Target < 300ms for the full safety pipeline. If RugCheck API is slow, don't wait for it — treat it as Tier 2 and proceed with Tier 1 results.

**Pipeline timing target:**
```
Token detected                    T+0ms
Mint/freeze authority check       T+50ms   (parallel)
Sell simulation (Jupiter quote)   T+200ms  (parallel)
RugCheck API                      T+300ms  (parallel, optional wait)
Decision made                     T+200–300ms
Buy tx sent                       T+300–500ms
```

---

## 8. PnL & Exit System Design

### Price Sources for New Tokens

| Source | Speed | Accuracy | Best For |
|--------|-------|----------|---------|
| **Jupiter Quote API** | 200–500ms per call | High — reflects actual executable price | Primary price source. Call `/quote` with your position size to get real exit price. |
| **Pool reserves calculation** | <100ms if cached | Medium — doesn't account for multi-hop | Fast estimation between quote calls |
| **Birdeye/DexScreener API** | 1–5s | Medium — may lag | Dashboard display, not trading decisions |
| **PumpPortal trade data** | Real-time (WebSocket) | Good for pump.fun tokens | Subscribe to token trades for real-time price updates |

**Recommended approach:** Use PumpPortal WebSocket `subscribeTokenTrade` for real-time price streaming, and Jupiter quotes for actionable exit pricing.

### Stop-Loss / Take-Profit Patterns

#### Polling-Based (simpler, good starting point):

```typescript
class PositionMonitor {
  private positions: Map<string, Position> = new Map();
  private pollInterval: NodeJS.Timer;
  
  start(intervalMs = 3000) {
    this.pollInterval = setInterval(() => this.checkAll(), intervalMs);
  }
  
  async checkAll() {
    for (const [mint, position] of this.positions) {
      const currentPrice = await getJupiterExitPrice(mint, position.amount);
      const pnlPct = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
      
      if (pnlPct <= position.stopLoss) {
        await this.executeSell(mint, 'STOP_LOSS', 1.0);  // sell 100%
      } else if (pnlPct >= position.takeProfit1) {
        await this.executeSell(mint, 'TAKE_PROFIT_1', 0.5);  // sell 50%
      } else if (pnlPct >= position.takeProfit2) {
        await this.executeSell(mint, 'TAKE_PROFIT_2', 1.0);  // sell remaining
      }
    }
  }
}
```

#### Event-Driven (advanced, lower latency):

Subscribe to pool account changes via WebSocket and recalculate price on every trade:

```typescript
connection.onAccountChange(
  poolPublicKey,
  (accountInfo) => {
    const reserves = parsePoolReserves(accountInfo.data);
    const currentPrice = reserves.solReserve / reserves.tokenReserve;
    evaluateExitConditions(mint, currentPrice);
  },
  'processed'
);
```

### Exit Strategy Templates

| Strategy | Params | Behavior |
|----------|--------|---------|
| **Simple stop/take** | SL: -30%, TP: +100% | Sell 100% at either threshold |
| **Tiered take-profit** | TP1: +50% sell 33%, TP2: +100% sell 33%, TP3: +200% sell remaining | Lock in profits gradually |
| **Trailing stop** | Trail: 20% from peak | Track highest price seen, sell when price drops 20% from peak |
| **Time-based exit** | Max hold: 10 minutes | Sell regardless of PnL after time limit — prevents bag-holding |
| **Combined** | SL: -30%, Trailing: 15%, Max hold: 30min | Most robust for meme tokens |

### Sell Reliability Ladder

When a sell fails, escalate through this sequence:

```
Level 1: Standard Jupiter swap, dynamic slippage, veryHigh priority
  ↓ (if fails)
Level 2: Jupiter swap, 20% manual slippage, max priority fee (1M lamports)
  ↓ (if fails)
Level 3: Jito bundle with 50k lamport tip, 30% slippage
  ↓ (if fails)
Level 4: Chunk sell — split into 2-3 smaller sells
  ↓ (if fails)
Level 5: PumpPortal sell (for pump.fun tokens), max slippage
  ↓ (if fails)
Level 6: Emergency — 49% slippage, Jito bundle with 200k tip
  ↓ (if fails after 5min of retrying)
Level 7: Log as stuck position, alert operator
```

---

## 9. Test Mode Design

### Comparison of Approaches

| Approach | Validates Execution? | Cost | Risk | Realism |
|----------|---------------------|------|------|---------|
| **Devnet end-to-end** | Partially — devnet has different DEXs and behavior | Free | Zero | Low — devnet tokens don't behave like mainnet meme tokens |
| **Mainnet simulation-only** | Yes for tx building/signing, not for landing | RPC costs only | Zero | Medium-high — uses real quotes, real pool state |
| **Shadow portfolio (paper trading)** | No real execution | Minimal | Zero | Medium — tracks what *would* have happened |
| **Tiny-size sacrificial wallet** | Yes — full end-to-end | 0.01–0.05 SOL per trade | Very low | Highest — real money, real behavior |

### Recommended: Layered Test Mode

**Phase 1 — Simulation Mode (Week 1-2):**
```typescript
class SimulationMode {
  async processBuy(mint: string, amountSol: number) {
    // 1. Run full safety checks (real)
    const safety = await runSafetyChecks(mint);
    
    // 2. Get real Jupiter quote (real)
    const quote = await getJupiterQuote(SOL_MINT, mint, amountSol);
    
    // 3. Build transaction (real)
    const tx = await buildSwapTransaction(quote);
    
    // 4. Simulate transaction (real - uses simulateTransaction RPC call)
    const simResult = await connection.simulateTransaction(tx);
    
    // 5. DON'T SEND — log the result
    logger.info({
      action: 'SIMULATED_BUY',
      mint, amountSol,
      wouldHaveReceived: quote.outAmount,
      simulationSuccess: !simResult.value.err,
      safetyScore: safety.score
    });
    
    // 6. Track in shadow portfolio
    shadowPortfolio.addPosition(mint, quote.outAmount, currentPrice);
  }
}
```

**Phase 2 — Tiny Real Trades (Week 3-4):**
- Fund a separate wallet with 0.1 SOL
- Set `MAX_BUY_AMOUNT = 0.005` SOL per trade
- Set `MAX_CONCURRENT_POSITIONS = 3`
- Set `MAX_DAILY_LOSS = 0.03 SOL`
- Run with all safety checks enabled
- This validates the entire pipeline including sell execution

**Phase 3 — Graduated Real Trading:**
- Increase position size in steps: 0.01 → 0.05 → 0.1 → target size
- Increase only after demonstrating positive PnL or acceptable win rate
- Keep detailed logs of every decision point

### Deterministic Test Cases

Create a test harness with known token scenarios:

```typescript
const testCases = [
  {
    name: 'Known good token — already traded',
    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
    expectedSafetyScore: '>90',
    expectedBuyResult: 'success',
    expectedSellResult: 'success'
  },
  {
    name: 'Known honeypot — freeze authority active',
    // Use a token with known freeze authority
    expectedSafetyScore: '0',
    expectedAction: 'BLOCKED'
  },
  {
    name: 'Low liquidity token',
    expectedPriceImpact: '>10%',
    expectedAction: 'SCORE_PENALTY'
  }
];
```

---

## 10. Reliability & Operations

### RPC Strategy

#### Provider Selection

| Provider | Strength | Price (starting) | Best For |
|----------|----------|-----------------|---------|
| **Helius** | Solana-native, staked connections, Sender for tx landing, parsed APIs | Free tier: 10 RPS; Paid: $49+/mo | Primary RPC — best balance of features and reliability for trading bots |
| **Triton One** | Lowest latency, Yellowstone gRPC | Premium pricing (contact) | If you need absolute lowest latency (pro tier) |
| **QuickNode** | Multi-chain, Jupiter API add-on (Metis) | $49+/mo | Good if you want Jupiter API bundled with RPC |
| **Chainstack** | Multi-cloud, Geyser gRPC, good uptime | $29+/mo | Budget-friendly alternative with gRPC support |

#### Multi-RPC Failover

```typescript
class RpcManager {
  private providers: Connection[];
  private currentIndex = 0;
  
  constructor(endpoints: string[]) {
    this.providers = endpoints.map(e => new Connection(e, 'confirmed'));
  }
  
  async sendTransaction(tx: VersionedTransaction): Promise<string> {
    // Send to ALL providers simultaneously for best landing chance
    const promises = this.providers.map(conn => 
      conn.sendRawTransaction(tx.serialize(), { 
        skipPreflight: true, 
        maxRetries: 0 
      }).catch(e => null)
    );
    
    const results = await Promise.allSettled(promises);
    const firstSuccess = results.find(r => r.status === 'fulfilled' && r.value);
    if (firstSuccess && firstSuccess.status === 'fulfilled') {
      return firstSuccess.value!;
    }
    throw new Error('All RPC providers failed to send transaction');
  }
  
  // For reads, use round-robin with failover
  async getAccountInfo(pubkey: PublicKey) {
    for (let i = 0; i < this.providers.length; i++) {
      try {
        const idx = (this.currentIndex + i) % this.providers.length;
        return await this.providers[idx].getAccountInfo(pubkey);
      } catch (e) {
        continue;
      }
    }
    throw new Error('All RPC providers failed');
  }
}
```

#### WebSocket Stability

WebSocket connections drop frequently on Solana. Handle this:

```typescript
function createResilientWebSocket(url: string, onMessage: (data: any) => void) {
  let ws: WebSocket;
  let reconnectDelay = 1000;
  
  function connect() {
    ws = new WebSocket(url);
    ws.on('open', () => { reconnectDelay = 1000; /* reset backoff */ });
    ws.on('message', onMessage);
    ws.on('close', () => setTimeout(connect, reconnectDelay));
    ws.on('error', () => {
      reconnectDelay = Math.min(reconnectDelay * 2, 30000); // exponential backoff, max 30s
      ws.close();
    });
    
    // Heartbeat — if no message for 30s, assume dead
    const heartbeat = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        clearInterval(heartbeat);
        return;
      }
      ws.ping();
    }, 30000);
  }
  
  connect();
  return { close: () => ws?.close() };
}
```

### Bot State Machine

```
IDLE → DETECTING → EVALUATING → BUYING → HOLDING → SELLING → IDLE
                      ↓                      ↓
                   REJECTED              FAILED_SELL → RETRY_SELL → STUCK
```

Each position should track its state independently. Use an enum:

```typescript
enum TradeState {
  DETECTED = 'DETECTED',
  SAFETY_CHECK = 'SAFETY_CHECK',
  BUYING = 'BUYING',
  BUY_CONFIRMED = 'BUY_CONFIRMED',
  MONITORING = 'MONITORING',
  SELLING = 'SELLING',
  SELL_CONFIRMED = 'SELL_CONFIRMED',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  STUCK = 'STUCK'  // needs manual intervention
}
```

### Persistence (Trade Journal)

Use SQLite for simplicity. Schema:

```sql
CREATE TABLE trades (
  id TEXT PRIMARY KEY,
  mint TEXT NOT NULL,
  state TEXT NOT NULL,
  entry_price REAL,
  entry_amount REAL,
  entry_sol REAL,
  entry_signature TEXT,
  exit_price REAL,
  exit_amount REAL,
  exit_sol REAL,
  exit_signature TEXT,
  pnl_sol REAL,
  pnl_pct REAL,
  safety_score INTEGER,
  safety_flags TEXT,  -- JSON array
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  error_log TEXT     -- JSON array of errors encountered
);
```

On startup, query for trades in non-terminal states (`BUYING`, `SELLING`, `MONITORING`) and resolve them.

### Observability

**Minimum viable monitoring:**

1. **Structured logging** — Use `pino` or `winston` with JSON output:
   ```typescript
   logger.info({ event: 'BUY_EXECUTED', mint, sol: 0.01, sig: '5abc...', latencyMs: 340 });
   ```

2. **Metrics to track:**
   - Trades per hour (buys, sells, rejections)
   - Win rate (% of trades with positive PnL)
   - Average PnL per trade
   - Safety check pass rate
   - Transaction success rate
   - Average latency (detection → buy confirmation)
   - RPC error rate

3. **Alerts:**
   - Bot crashed / not running
   - Position stuck in SELLING state > 5 minutes
   - Daily loss exceeds threshold
   - RPC provider returning errors > 10% of calls

**Simple approach:** Log everything to files, use a cron job or separate script to parse logs and send alerts via Telegram bot or Discord webhook.

### Deployment Path

**Local → VPS progression:**

| Stage | Setup | Cost |
|-------|-------|------|
| **Local dev** | Your machine, .env file with secrets | $0 |
| **Local production** | PM2 process manager, SQLite, logs to file | $0 |
| **VPS (basic)** | Hetzner/Vultr 2vCPU, 4GB RAM, Ubuntu | $5–15/mo |
| **VPS (production)** | 4vCPU, 8GB RAM, SSD, US-East datacenter (close to Solana validators) | $20–40/mo |

**Secrets management:**
- Local: `.env` file (never commit to git)
- VPS: Environment variables + encrypted file, or HashiCorp Vault (overkill for solo dev)
- **Critical:** Your wallet private key is the most sensitive secret. Consider using a hardware wallet for large balances and only keeping a small operational balance in the bot wallet.

---

## 11. Feature Matrix — MVP Prioritization

### Phase 1: MVP (Must-Have)

| Feature | Component | Priority |
|---------|-----------|----------|
| PumpPortal WebSocket token detection | Detection | P0 |
| Mint/freeze authority check | Safety | P0 |
| Sell simulation (Jupiter quote) | Safety | P0 |
| Jupiter Swap API buy execution | Execution | P0 |
| Jupiter Swap API sell execution | Execution | P0 |
| Simple stop-loss / take-profit | PnL | P0 |
| Basic retry logic (3 attempts) | Reliability | P0 |
| SQLite trade journal | Persistence | P0 |
| Console logging | Observability | P0 |
| Simulation mode | Testing | P0 |

### Phase 2: Robust (Recommended)

| Feature | Component | Priority |
|---------|-----------|----------|
| RugCheck API integration | Safety | P1 |
| Holder concentration check | Safety | P1 |
| Jito bundles for sells | Execution | P1 |
| Multi-RPC failover | Reliability | P1 |
| Sell reliability ladder (fee escalation) | Execution | P1 |
| Tiered take-profit + trailing stop | PnL | P1 |
| WebSocket reconnection handling | Reliability | P1 |
| Structured JSON logging | Observability | P1 |
| Position state machine | Architecture | P1 |
| Crash recovery (resume from journal) | Reliability | P1 |

### Phase 3: Optimized (Nice-to-Have)

| Feature | Component | Priority |
|---------|-----------|----------|
| Geyser gRPC detection (replace WebSocket) | Detection | P2 |
| Direct pump.fun program calls (skip PumpPortal fee) | Execution | P2 |
| Dev wallet tracking | Safety | P2 |
| LP burn/lock verification | Safety | P2 |
| Dashboard UI (web) | Observability | P2 |
| Telegram alerts | Observability | P2 |
| Multi-token portfolio management | PnL | P2 |
| Historical backtesting | Testing | P2 |
| Chunked sells for large positions | Execution | P2 |
| VPS deployment with PM2 | Operations | P2 |

---

## 12. Tech Stack Recommendation

### Core Stack

| Component | Recommended | Alternative | Rationale |
|-----------|------------|-------------|-----------|
| **Language** | TypeScript + Node.js 20+ | Rust (for latency-critical paths) | Matches your skills. Vast Solana SDK ecosystem. |
| **Solana SDK** | `@solana/web3.js` v1.x | `@solana/kit` v2.x (newer, functional API) | v1.x is battle-tested with most examples. v2 is more modern but has fewer community examples. |
| **DEX Aggregator** | Jupiter Swap API (REST) | `@jup-ag/api` SDK | REST is simpler and doesn't require SDK updates. SDK wraps the same API. |
| **Pump.fun Trading** | PumpPortal trade-local API | Direct program CPI | Start with PumpPortal. Build direct calls in Phase 3. |
| **Detection** | PumpPortal WebSocket + `logsSubscribe` | Geyser gRPC (Phase 3) | WebSocket is free and easy. Geyser is faster but requires paid infra. |
| **Database** | `better-sqlite3` | PostgreSQL (if scaling to VPS) | SQLite is zero-config, fast for single-process bots. |
| **Logging** | `pino` | `winston` | pino is faster, JSON-native. |
| **Process Manager** | PM2 | systemd | PM2 handles restart, logs, and monitoring in one tool. |
| **HTTP Client** | Native `fetch` (Node 20+) | `axios` | No dependency needed in Node 20+. |
| **WebSocket** | `ws` library | Native WebSocket (Bun) | `ws` is the standard for Node.js. |

### Key npm Packages

```json
{
  "dependencies": {
    "@solana/web3.js": "^1.98",
    "@jup-ag/api": "^6.0",
    "bs58": "^6.0",
    "better-sqlite3": "^11.0",
    "ws": "^8.18",
    "pino": "^9.0",
    "dotenv": "^16.4"
  },
  "devDependencies": {
    "typescript": "^5.5",
    "@types/ws": "^8.5",
    "@types/better-sqlite3": "^7.6",
    "tsx": "^4.0"
  }
}
```

---

## 13. AI Tool Guide

| Task | AI Tool | How to Use |
|------|---------|-----------|
| **Debugging failed transactions** | Claude / GPT-4 | Paste the transaction signature and error message. Ask for Solana-specific interpretation. |
| **Code review** | Claude Code / Cursor | Review execution and retry logic for edge cases. Ask: "What happens if the RPC returns a timeout during step X?" |
| **Generating test cases** | Claude | Describe your safety check function and ask for edge cases and adversarial inputs. |
| **Understanding Solana program errors** | Claude | Paste hex error codes from transaction logs. These map to program-specific errors (e.g., Jupiter's custom errors). |
| **Log analysis** | Claude | Paste structured logs and ask for pattern analysis: "Why are my sells failing between 2-3 AM UTC?" |
| **Architecture decisions** | Claude / Deep Research | Describe your current pipeline and ask for bottleneck analysis and optimization suggestions. |
| **Transaction building** | Claude Code | Generate Solana transaction construction code with compute budget, priority fees, and proper serialization. |
| **Solana SDK docs** | Claude | Ask about specific `@solana/web3.js` methods, account data layout parsing, or VersionedTransaction construction. |

**Specific workflow for debugging swaps:**
1. Get the failed transaction signature
2. Look it up on Solscan or Solana Explorer
3. Copy the error logs and account state
4. Ask Claude: "This Jupiter swap transaction failed with error [X]. Here are the logs: [paste]. What went wrong and how do I fix it?"

---

## 14. Development Roadmap

### Week 1-2: Foundation
- [ ] Set up TypeScript project with proper config
- [ ] Integrate `@solana/web3.js`, configure Helius RPC
- [ ] Implement wallet management (load keypair, check balance)
- [ ] Build PumpPortal WebSocket listener for new tokens
- [ ] Implement Tier 1 safety checks (mint auth, freeze auth, sell simulation)
- [ ] Build Jupiter quote fetching and swap execution
- [ ] **Milestone:** Can detect a new token and simulate a buy

### Week 3-4: Execution & Testing
- [ ] Implement full buy flow (Jupiter + PumpPortal)
- [ ] Implement full sell flow with basic retry (3 attempts)
- [ ] Build simulation mode (shadow portfolio)
- [ ] Set up SQLite trade journal
- [ ] Run simulation mode for 3+ days, analyze results
- [ ] **Milestone:** Simulation mode running, logging would-be trades

### Week 5-6: PnL & Sells
- [ ] Implement position monitor (polling-based)
- [ ] Add stop-loss and take-profit execution
- [ ] Build sell reliability ladder (fee escalation, slippage increase)
- [ ] Add Jito bundle support for critical sells
- [ ] Begin tiny-wallet real trading (0.005 SOL/trade)
- [ ] **Milestone:** First real trades executed and closed

### Week 7-8: Hardening
- [ ] Add RugCheck API integration
- [ ] Implement holder concentration checks
- [ ] Add multi-RPC failover
- [ ] Build WebSocket reconnection handling
- [ ] Add crash recovery (resume from trade journal)
- [ ] Implement structured logging with pino
- [ ] **Milestone:** Bot can survive RPC drops, restarts, and edge cases

### Week 9-10: Optimization
- [ ] Add tiered take-profit and trailing stop
- [ ] Tune safety check thresholds based on real data
- [ ] Add Telegram/Discord alerts
- [ ] Deploy to VPS with PM2
- [ ] Increase position sizes gradually
- [ ] **Milestone:** Production-ready bot on VPS

---

## 15. Learning Resources

### Essential (Read First)

| Resource | Topic | URL |
|----------|-------|-----|
| Solana Developer Docs — Transaction Structure | How Solana transactions work | https://solana.com/docs/core/transactions |
| Solana Cookbook — Retrying Transactions | Why transactions fail and how to retry | https://solanacookbook.com/guides/retrying-transactions.html |
| Jupiter Swap API Docs | Primary swap integration | https://dev.jup.ag/docs/swap-api/build-swap-transaction |
| Helius — Sending Transactions on Solana | Best practices for tx landing | https://www.helius.dev/blog/how-to-land-transactions-on-solana |
| PumpPortal API Docs | Pump.fun detection + trading | https://pumpportal.fun/data-api/real-time/ |
| QuickNode — Jito Bundles Guide | Atomic execution and MEV protection | https://www.quicknode.com/guides/solana-development/transactions/jito-bundles |

### Recommended (Deep Dives)

| Resource | Topic | URL |
|----------|-------|-----|
| CoinGecko — Build a Honeypot Checker | Full TS tutorial for safety checks | https://www.coingecko.com/learn/build-honeypot-checker |
| Helius — Find Mint/Freeze Authority | Understanding token authorities | https://www.helius.dev/docs/orb/explore-authorities |
| Jito Documentation | Bundle submission, tips, MEV | https://docs.jito.wtf/ |
| RugCheck.xyz API (Swagger) | Safety scoring API | https://api.rugcheck.xyz/swagger/index.html |
| builderby/solana-swap-tutorial (GitHub) | Jupiter + Jito swap tutorial | https://github.com/builderby/solana-swap-tutorial |

### Reference Repositories

| Repo | Description | URL |
|------|-------------|-----|
| fdundjer/solana-sniper-bot | Most-starred TS sniper bot (learning reference) | https://github.com/fdundjer/solana-sniper-bot |
| tjazerzen/sol-sniper-bot | Feature-rich fork with RugCheck, tiered TP | https://github.com/tjazerzen/sol-sniper-bot |
| thetateman/Trading-API | PumpPortal API examples (TS + Python) | https://github.com/thetateman/Pump-Fun-API |
| degenfrends/solana-rugchecker | TS library for rug pull detection | https://github.com/degenfrends/solana-rugchecker |
| jup-ag/jupiter-quote-api-node | Official Jupiter API examples | https://github.com/jup-ag/jupiter-quote-api-node |

---

## 16. Budget Forecast

### Tier 1: Minimum Viable ($50–100/month)

| Item | Cost | Notes |
|------|------|-------|
| Helius free tier | $0 | 10 RPS, sufficient for dev/testing |
| Helius Developer plan | $49/mo | 50 RPS, staked connections, webhooks |
| PumpPortal Data API | $0 | Free WebSocket for token detection |
| PumpPortal Trading API | 0.5% per trade | ~$0.005 per 0.01 SOL trade |
| VPS (Hetzner CX21) | $5–10/mo | 2 vCPU, 4GB RAM |
| Trading capital | 0.5–2 SOL | Sacrificial wallet for testing + early trading |
| **Total** | **~$55–60/mo + trading capital** | |

### Tier 2: Competitive ($150–300/month)

| Item | Cost | Notes |
|------|------|-------|
| Helius Business plan | $199/mo | 200 RPS, higher rate limits, priority support |
| QuickNode (backup RPC) | $49/mo | Multi-RPC failover |
| RugCheck API | Free (basic) | Paid tier for higher rate limits if needed |
| VPS (Hetzner CX31) | $15–30/mo | 4 vCPU, 8GB RAM, US datacenter |
| PumpPortal Trading | Variable | 0.5% per trade |
| Trading capital | 5–20 SOL | Larger positions, more concurrent trades |
| **Total** | **~$265–280/mo + trading capital** | |

### Tier 3: Professional ($500+/month)

| Item | Cost | Notes |
|------|------|-------|
| Triton One or Helius dedicated node | $500–1000+/mo | Lowest latency, Geyser gRPC, full control |
| Multiple backup RPCs | $100+/mo | True multi-provider failover |
| Co-located VPS | $50–100/mo | Same datacenter as RPC provider |
| Custom monitoring (Grafana Cloud) | $15–50/mo | Full observability stack |
| Trading capital | 50+ SOL | Production-scale |
| **Total** | **~$700–1200/mo + trading capital** | |

### Cost Optimization Tips

- Start at Tier 1. Don't overspend on infrastructure before you've validated your strategy.
- Helius's free tier is genuinely usable for development and simulation mode.
- PumpPortal's 0.5% trading fee is worth it initially — removing it (via direct program calls) is a Phase 3 optimization.
- RPC costs are your biggest operational expense. Monitor your actual RPS usage and right-size your plan monthly.
- Trading capital is not a "cost" — it's risk capital. Only risk what you can afford to lose entirely.

---

## Appendix: Key Gotchas & Failure Modes

These are the practical issues that cause real bots to fail in production:

1. **WebSocket drops silently.** PumpPortal and Solana RPC WebSockets drop without error events. Implement heartbeat checks and automatic reconnection.

2. **`getLatestBlockhash` can return stale data.** Under load, some RPCs return cached blockhashes. Use `'processed'` commitment and fetch from your fastest RPC.

3. **Jupiter quotes expire quickly.** A quote is valid for only a few seconds. Don't cache quotes — fetch, build, sign, and send in one tight sequence.

4. **Associated Token Accounts (ATAs) cost SOL to create.** First buy of any new token costs an extra ~0.002 SOL for ATA creation. Jupiter handles this automatically with `wrapAndUnwrapSol: true`.

5. **Token-2022 extensions can break assumptions.** Transfer hooks, confidential transfers, and other extensions can make tokens behave unexpectedly. Most pump.fun tokens use standard SPL, but verify.

6. **RugCheck API can be slow or down.** Never make it a blocking dependency for buys. Use it as a Tier 2 check — nice to have, not required.

7. **Solana transactions have a 1232-byte size limit.** Complex Jupiter routes with many hops can hit this. Use `maxAccounts` parameter to constrain route complexity.

8. **Priority fees are burned, not refunded.** Even if your transaction fails, you pay the priority fee. Don't over-bid on exploratory transactions.

9. **Pump.fun tokens transition through states.** Bonding curve → migration → Raydium/PumpSwap pool. Your bot needs to handle the token being in different states and route through the appropriate exchange.

10. **Time-of-day matters.** Network congestion varies dramatically. Asian/European market opens can cause RPC slowdowns. Your fee and retry strategies should adapt.
