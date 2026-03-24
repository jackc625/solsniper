# Phase 5: Execution Engine - Research

**Researched:** 2026-02-26
**Domain:** Solana transaction execution — Jupiter Swap API, PumpPortal trade-local API, Jito bundles, multi-RPC broadcast, sell escalation ladder
**Confidence:** HIGH (core APIs verified via official docs; Jito internals MEDIUM)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Sell escalation ladder
- Steps in order: Standard → Higher fees → Jito bundle → Chunked sell → Emergency slippage
- Advancement trigger: Timeout per step (not failure count — time-based only)
- Timeouts are configurable per-step in config.json with sensible defaults
- Chunked sell: split position into 3 equal tranches, sent sequentially
- Emergency slippage is the final step (last resort before SELL_FAILED)

#### Slippage configuration
- Buy slippage: configurable in config.json, default 10%
- Standard sell slippage: configurable in config.json, default 5%
- Emergency sell slippage: configurable in config.json, default 49%
- Each ladder step uses the appropriate slippage for that step

#### Priority fee escalation
- Configurable multiplier per ladder step (e.g., 1x → 3x → 10x base fee)
- Jito bundle step uses a separate configurable Jito tip amount (not a multiplier)
- All fee values configurable in config.json

#### Multi-RPC broadcast
- Parallel broadcast: fire to all available RPCs simultaneously on every transaction
- Applies to both buys and sells (not sells-only)
- Required confirmation level: `confirmed` (2/3 supermajority)
- Confirmation polling strategy: Claude's discretion

#### Buy failure behavior
- No retry on buy — single attempt only (speed over resilience, miss and move on)
- Failed buy recorded as BUY_FAILED terminal state in SQLite
- BUY_FAILED entry cleaned from in-memory duplicate guard so future buys of that token are allowed

#### Sell exhaustion behavior
- When escalation ladder fully exhausts without confirmed sell: record as SELL_FAILED terminal state
- SELL_FAILED is terminal for this phase — no further retry attempts
- Alerting: structured ERROR log only, no external alerting or event emission

### Claude's Discretion
- Confirmation polling interval and retry strategy
- Exact config.json key naming and structure
- Jito bundle construction internals
- Error classification logic (which errors trigger step timeout vs explicit failure)

### Deferred Ideas (OUT OF SCOPE)
- None — discussion stayed within phase scope

### Specific Ideas (Locked implementation details)
- Blockhash must be fetched as the absolute last step before signing (never before safety checks), and refreshed on every retry attempt
- Chunked sell tranches are sequential (not parallel) — wait for each to confirm before sending next
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| EXE-01 | Bot executes buy via Jupiter Swap API with dynamic slippage | Jupiter quote + swap API documented; VersionedTransaction flow verified |
| EXE-02 | Bot executes buy via PumpPortal trade-local API for bonding curve tokens | PumpPortal endpoint and request params verified; raw bytes response confirmed |
| EXE-03 | Bot automatically selects Jupiter or PumpPortal based on token state (bonding curve vs migrated) | TokenEvent.source field (`pumpportal` vs `raydium`/`pumpswap`) is the routing signal — already in codebase |
| EXE-04 | Bot fetches blockhash as the last step before signing (never before safety checks) | Blockhash validity ~60-90s; fetching late is the correct pattern per Solana docs |
| EXE-05 | Bot sends transactions to multiple RPC providers simultaneously for better landing rate | Promise.allSettled pattern against all RPC connections; existing RpcManager needs extension |
| EXE-06 | Sell escalation ladder retries with increasing aggression: standard → high fee → Jito bundle → chunked sell → emergency | Full ladder architecture documented; each step's configuration pattern identified |
| EXE-07 | Bot constructs and submits Jito bundles for MEV-protected sell execution | Jito sendBundle API, tip accounts, bs58 encoding pattern documented |
| EXE-08 | Bot refreshes blockhash on every retry attempt | Standard pattern: `getLatestBlockhash('processed')` before each ladder step |
| EXE-09 | Emergency sell mode uses maximum slippage (49%) for capital recovery | 49% = 4900 bps; within Jupiter's accepted range (max ~5000 bps) |
</phase_requirements>

---

## Summary

Phase 5 builds the execution engine on top of the existing detection + safety + persistence stack. The codebase already has the routing signal baked in: `TokenEvent.source === 'pumpportal'` means the token is on the bonding curve (use PumpPortal trade-local API), while `source === 'raydium'` or `source === 'pumpswap'` means it has migrated to an AMM (use Jupiter Swap API). This keeps EXE-03 routing logic dead-simple.

The buy path is straightforward: PumpPortal returns raw bytes that deserialize directly into a `VersionedTransaction`; Jupiter returns a base64-encoded unsigned transaction that must be decoded and signed. Both paths share the same terminal pattern: fetch blockhash last, sign, broadcast to all RPCs in parallel via `Promise.allSettled`, poll for `confirmed` status. Single attempt only on buy — speed over resilience.

The sell path is more complex and is the core value of this phase. The escalation ladder runs on time-based step advancement (not failure count). Each step must independently: rebuild the quote/swap from scratch, fetch a fresh blockhash, sign, and broadcast. The Jito bundle step wraps the swap transaction with a tip instruction in the same transaction (not a separate tx for this single-swap case). Chunked sell splits the token balance into 3 equal tranches sent sequentially — each tranche must confirm before the next is sent. Emergency slippage (49% = 4900 bps) is the final ladder step. All of this plugs into the existing `TradeStore.transition()` state machine: `BUYING` → `MONITORING` (or `FAILED`), `SELLING` → `COMPLETED` (or `FAILED`).

**Primary recommendation:** Build `ExecutionEngine` as a single class that accepts a `TokenEvent` and runs the buy path, then exposes a `sell(mint, tradeId)` method that Phase 7 position management can call. Internally, the sell path uses a `SellLadder` class that encapsulates ladder step logic with configurable timeouts.

---

## Standard Stack

### Core (already installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@solana/web3.js` | ^1.98.4 | Transaction building, blockhash fetch, confirmTransaction, sendRawTransaction | The canonical Solana JS SDK; `VersionedTransaction` is required for Jupiter |
| `bs58` | ^6.0.0 | Base58 encode/decode for Jito bundle serialization | Already in project; Jito sendBundle expects bs58-encoded tx bytes |

### New Dependencies Required
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| None new | — | All required deps already installed | PumpPortal and Jupiter use `fetch`; Jito uses raw HTTP JSON-RPC |

**Installation:** No new packages required. All execution needs are covered by `@solana/web3.js`, `bs58`, and Node.js built-in `fetch`.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Raw `fetch` for Jito | `jito-js-rpc` npm package | jito-js-rpc is a thin wrapper; raw fetch is simpler, zero dependencies, fully documented. Use raw fetch. |
| Manual Jito HTTP calls | `jito-ts` SDK | jito-ts is heavier and ties to the older @solana/web3.js v1 patterns; raw fetch is more transparent and maintainable |
| Jupiter REST API | `@jup-ag/api` SDK | SDK adds overhead; REST API with raw fetch is sufficient and already proven in codebase (tier1-sell-route.ts does this) |

---

## Architecture Patterns

### Recommended Module Structure

```
src/
├── execution/
│   ├── execution-engine.ts       # Top-level: routes buy to PumpPortal or Jupiter
│   ├── execution-engine.test.ts  # Unit tests with mocked APIs
│   ├── buy/
│   │   ├── pump-portal-buyer.ts  # PumpPortal trade-local buy execution
│   │   ├── jupiter-buyer.ts      # Jupiter Swap API buy execution
│   │   └── broadcaster.ts        # Multi-RPC sendRawTransaction + confirmTransaction
│   └── sell/
│       ├── sell-ladder.ts        # Orchestrates escalation ladder with time-based steps
│       ├── sell-ladder.test.ts   # Tests for ladder step transitions
│       ├── standard-seller.ts    # Step 1 (standard) and Step 2 (higher fees)
│       ├── jito-seller.ts        # Step 3: Jito bundle construction and submission
│       ├── chunked-seller.ts     # Step 4: Split into 3 sequential tranches
│       └── emergency-seller.ts   # Step 5: 49% slippage sell
├── config/
│   └── trading.ts                # Add ExecutionConfigSchema here (extend existing)
└── types/
    └── index.ts                  # Add ExecutionResult, SellStep types
```

### Pattern 1: Route Selection (EXE-03)

**What:** Check `TokenEvent.source` to pick buy path.
**When to use:** Every buy — this is the entry point.

```typescript
// Source: existing src/types/index.ts + src/detection/{listeners}
// TokenEvent.source is set by detectors:
//   'pumpportal' → bonding curve (use PumpPortal)
//   'raydium'    → Raydium V4 migrated (use Jupiter)
//   'pumpswap'   → PumpSwap migrated (use Jupiter)

async function executeBuy(event: TokenEvent, config: ExecutionConfig): Promise<BuyResult> {
  if (event.source === 'pumpportal') {
    return pumpPortalBuy(event, config);
  } else {
    // 'raydium' | 'pumpswap' — both use Jupiter
    return jupiterBuy(event, config);
  }
}
```

### Pattern 2: Blockhash-Last Pattern (EXE-04, EXE-08)

**What:** Fetch blockhash immediately before `tx.sign()`. Never cache it. Refresh on every retry.
**When to use:** Every transaction send — buy and every sell ladder step.

```typescript
// Source: https://solana.com/docs/core/transactions/confirmation
// Blockhash valid for ~151 slots (~60-90 seconds). Fetch with 'processed' for speed.
// The 'processed' commitment is faster than 'confirmed'; acceptable for blockhash fetching
// because we only need a fresh blockhash, not a confirmed state.

async function signAndSend(
  tx: VersionedTransaction,
  wallet: Keypair,
  connection: Connection
): Promise<string> {
  // ALWAYS last step before sign
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('processed');
  tx.message.recentBlockhash = blockhash;
  tx.sign([wallet]);
  // ... broadcast
  return { signature, blockhash, lastValidBlockHeight };
}
```

**Critical:** `lastValidBlockHeight` is returned alongside `blockhash` and is used to know when the tx expires. Pass both to `confirmTransaction`.

### Pattern 3: Multi-RPC Parallel Broadcast (EXE-05)

**What:** Send to all RPC endpoints simultaneously. First success wins for the signature. Confirm using any single connection.
**When to use:** Every transaction send — buy and every sell ladder step.

```typescript
// Source: solana-sniper-bot-research.md section 10, verified pattern
// RpcManager currently has primary + backup Connection objects.
// For broadcast, we need both connections directly.

async function broadcastToAllRpcs(
  serializedTx: Uint8Array,
  connections: Connection[]
): Promise<string> {
  const results = await Promise.allSettled(
    connections.map(conn =>
      conn.sendRawTransaction(serializedTx, {
        skipPreflight: true,  // already simulated by Jupiter; skip for speed
        maxRetries: 0,        // we handle retries ourselves
      })
    )
  );

  // All signatures are the same transaction — pick any fulfilled result
  const success = results.find(r => r.status === 'fulfilled');
  if (!success || success.status !== 'fulfilled') {
    throw new Error('All RPC endpoints failed to accept transaction');
  }
  return success.value;
}
```

**Note:** All RPCs receive the same signed transaction and will return the same signature (tx signatures are deterministic). Use any confirmed signature for polling.

### Pattern 4: Transaction Confirmation Polling (Claude's Discretion)

**What:** Poll `confirmTransaction` with `lastValidBlockHeight` expiry guard.
**When to use:** After every broadcast for both buys and sells.

```typescript
// Source: https://solana.com/docs/core/transactions/confirmation
// Use blockhashWithExpiryBlockHeight form of confirmTransaction.
// 'confirmed' = 2/3 supermajority (per locked decision).

async function confirmWithExpiry(
  signature: string,
  blockhash: string,
  lastValidBlockHeight: number,
  connection: Connection
): Promise<boolean> {
  try {
    const result = await connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      'confirmed'
    );
    return result.value.err === null;
  } catch (err) {
    // TransactionExpiredBlockheightExceededError → tx expired, not confirmed
    return false;
  }
}
```

**Polling interval recommendation (Claude's discretion):** `confirmTransaction` with `lastValidBlockHeight` handles timeout natively — it returns when either confirmed or the block height is exceeded. No manual polling interval needed for this form.

### Pattern 5: Jupiter Buy Flow (EXE-01)

**What:** Quote → Swap → Deserialize base64 → Blockhash → Sign → Broadcast.
**When to use:** Tokens with `source === 'raydium'` or `source === 'pumpswap'`.

```typescript
// Source: dev.jup.ag/api-reference/swap/swap + solana-sniper-bot-research.md section 3
// Endpoints: https://api.jup.ag/swap/v1/quote and https://api.jup.ag/swap/v1/swap
// Note: api.jup.ag/swap/v1 is the current endpoint (not quote-api.jup.ag/v6 which is old)

const SOL_MINT = 'So11111111111111111111111111111111111111112';

// Step 1: Quote
const quoteResponse = await fetch(
  `https://api.jup.ag/swap/v1/quote?inputMint=${SOL_MINT}&outputMint=${mint}` +
  `&amount=${lamports}&slippageBps=${slippageBps}&maxAccounts=64`
).then(r => r.json());

// Step 2: Build swap transaction
const swapResponse = await fetch('https://api.jup.ag/swap/v1/swap', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    userPublicKey: wallet.publicKey.toBase58(),
    quoteResponse,
    dynamicComputeUnitLimit: true,
    dynamicSlippage: false,       // We control slippage explicitly per step
    prioritizationFeeLamports: {
      priorityLevelWithMaxLamports: {
        priorityLevel: 'veryHigh',
        maxLamports: basePriorityFee * multiplier,
      }
    },
    wrapAndUnwrapSol: true,
  }),
}).then(r => r.json());

// Step 3: Deserialize (base64)
const txBytes = Buffer.from(swapResponse.swapTransaction, 'base64');
const tx = VersionedTransaction.deserialize(txBytes);

// Step 4: Blockhash LAST (EXE-04)
const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('processed');
tx.message.recentBlockhash = blockhash;
tx.sign([wallet]);
```

**Important:** `dynamicSlippage: false` — we pass explicit `slippageBps` in the quote because ladder steps need predictable slippage values. `dynamicSlippage` overwrites the quote's slippageBps, which breaks per-step control.

### Pattern 6: PumpPortal Buy Flow (EXE-02)

**What:** Single HTTP call → raw bytes response → Deserialize → Blockhash → Sign → Broadcast.
**When to use:** Tokens with `source === 'pumpportal'` (bonding curve tokens).

```typescript
// Source: https://pumpportal.fun/local-trading-api/trading-api/
// pool: 'pump' for bonding curve tokens
// Response: raw bytes (NOT base64) — use arrayBuffer()

const response = await fetch('https://pumpportal.fun/api/trade-local', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    publicKey: wallet.publicKey.toBase58(),
    action: 'buy',
    mint: event.mint,
    denominatedInSol: 'true',
    amount: config.buyAmountSol,
    slippage: config.buySlippagePct,         // percent (not bps)
    priorityFee: config.basePriorityFeeSol,  // SOL amount
    pool: 'pump',                            // bonding curve
  }),
});

if (!response.ok) throw new Error(`PumpPortal HTTP ${response.status}`);

// Raw bytes (NOT JSON) — use arrayBuffer
const txBytes = new Uint8Array(await response.arrayBuffer());
const tx = VersionedTransaction.deserialize(txBytes);

// Blockhash LAST (EXE-04)
const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('processed');
tx.message.recentBlockhash = blockhash;
tx.sign([wallet]);
```

**Critical difference from Jupiter:** PumpPortal returns raw `arrayBuffer()` bytes, not a JSON body with a base64 string. Jupiter returns `JSON.swapTransaction` as base64.

### Pattern 7: Sell Escalation Ladder Architecture (EXE-06)

**What:** Time-based step advancement. Each step has a configurable timeout. When timeout expires, advance to next step regardless of pending state.
**When to use:** Every sell triggered by Phase 7 position management.

```typescript
// Ladder step order and config keys (Claude's discretion for naming)
const LADDER_STEPS = [
  { name: 'STANDARD',          timeoutMs: config.sell.standardTimeoutMs,   slippageBps: config.sell.standardSlippageBps,   feeMultiplier: 1 },
  { name: 'HIGH_FEE',          timeoutMs: config.sell.highFeeTimeoutMs,     slippageBps: config.sell.standardSlippageBps,   feeMultiplier: config.sell.highFeeMultiplier },
  { name: 'JITO_BUNDLE',       timeoutMs: config.sell.jitoTimeoutMs,        slippageBps: config.sell.jitoSlippageBps,       jitoTipLamports: config.sell.jitoTipLamports },
  { name: 'CHUNKED',           timeoutMs: config.sell.chunkedTimeoutMs,     slippageBps: config.sell.jitoSlippageBps,       feeMultiplier: config.sell.highFeeMultiplier },
  { name: 'EMERGENCY',         timeoutMs: config.sell.emergencyTimeoutMs,   slippageBps: 4900 },  // 49% = hardcoded max
] as const;

async function runSellLadder(mint: string, tradeId: number): Promise<SellResult> {
  for (const step of LADDER_STEPS) {
    const result = await runStepWithTimeout(step, mint, tradeId);
    if (result.confirmed) return { success: true, step: step.name, signature: result.signature };
    // Timeout expired or step failed — advance to next
    log.warn({ mint, step: step.name }, 'Sell step timed out — advancing to next step');
  }
  return { success: false };  // All steps exhausted → SELL_FAILED
}
```

### Pattern 8: Jito Bundle Construction (EXE-07)

**What:** Wrap a sell transaction with a tip transfer. The tip instruction is added to the SAME transaction (not a separate tx) when there is only one swap. Send via Jito block engine JSON-RPC.
**When to use:** Step 3 of the sell ladder (JITO_BUNDLE step).

```typescript
// Source: https://docs.jito.wtf/lowlatencytxnsend/
// Jito block engine: https://mainnet.block-engine.jito.wtf/api/v1/bundles
// Tip accounts — fetch dynamically via getTipAccounts, or use static known list.
// The 8 known Jito tip accounts (stable as of 2026):

const JITO_TIP_ACCOUNTS = [
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
  'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',  // Note: differs slightly from other sources
  'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
  'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
  'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
  'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
  '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
];

// For a single-tx bundle (our sell case), include tip instruction IN the same tx.
// The existing Jupiter-built tx cannot be modified after signing; instead, build
// the sell instruction set manually with an additional SystemProgram.transfer tip,
// OR send swap tx + separate tip tx as a 2-tx bundle.
// Recommended: 2-tx bundle — swap tx + tip tx — simpler than modifying Jupiter tx.

async function sendJitoBundle(
  swapTxBytes: Uint8Array,
  wallet: Keypair,
  tipLamports: number,
  connection: Connection
): Promise<string | null> {
  // Pick a random tip account
  const tipAccount = JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)];

  // Build tip transaction
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('processed');
  const tipTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: new PublicKey(tipAccount),
      lamports: tipLamports,
    })
  );
  tipTx.recentBlockhash = blockhash;
  tipTx.feePayer = wallet.publicKey;
  tipTx.sign(wallet);

  // bs58 encode both transactions for the bundle
  const encodedSwap = bs58.encode(swapTxBytes);
  const encodedTip = bs58.encode(tipTx.serialize());

  const response = await fetch('https://mainnet.block-engine.jito.wtf/api/v1/bundles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'sendBundle',
      params: [[encodedSwap, encodedTip]],  // swap first, tip last
    }),
  });

  const json = await response.json() as { result?: string; error?: { message: string } };
  if (json.error) {
    log.error({ error: json.error }, 'Jito sendBundle error');
    return null;
  }
  return json.result ?? null;  // Returns bundle ID
}
```

**Jito confirmation strategy:** `sendBundle` returns immediately with a bundle ID — it does NOT confirm the tx is landed. Poll `getBundleStatuses` with the bundle ID. If the step timeout expires before bundle status shows `Landed`, advance to the next ladder step.

```typescript
// Poll Jito bundle status
async function pollBundleStatus(bundleId: string): Promise<'Landed' | 'Failed' | 'Pending'> {
  const response = await fetch('https://mainnet.block-engine.jito.wtf/api/v1/bundles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getBundleStatuses',
      params: [[bundleId]],
    }),
  });
  const json = await response.json();
  return json?.result?.value?.[0]?.confirmation_status ?? 'Pending';
}
```

### Pattern 9: Chunked Sell (Step 4) (EXE-06)

**What:** Fetch full token balance, split into 3 equal tranches, send sequentially (each must confirm before next is sent).
**When to use:** Step 4 of sell ladder.

```typescript
// Sequential — wait for each tranche to confirm before next
// Use 'denominatedInSol: false' for token-amount sells

async function chunkedSell(
  mint: string,
  wallet: Keypair,
  config: SellConfig,
  connections: Connection[]
): Promise<boolean> {
  const balance = await getTokenBalance(mint, wallet, connections[0]);
  const tranche = Math.floor(balance / 3);

  for (let i = 0; i < 3; i++) {
    const amount = i === 2 ? balance - tranche * 2 : tranche;  // Last tranche gets remainder
    const confirmed = await sellTranche(mint, amount, config, wallet, connections);
    if (!confirmed) {
      log.warn({ mint, tranche: i + 1 }, 'Chunked sell tranche failed to confirm');
      // Continue to next tranche — partial recovery is better than none
    }
  }
  return true;
}
```

### Pattern 10: BUY_FAILED State Cleanup (EXE-03 buy path)

**What:** On buy failure, transition to terminal state AND remove from activeMints so the token can be bought again in the future.
**When to use:** Any time the buy attempt fails or times out.

```typescript
// TradeStore.transition() automatically removes from activeMints when transitioning
// to a terminal state (FAILED, COMPLETED, ABANDONED) — this is already implemented.
// Just call transition() with correct states:

tradeStore.transition(
  event.mint,
  'BUYING',  // from
  'FAILED',  // to — triggers activeMints.delete() in TradeStore
  { errorMessage: err.message }
);
```

Note: Per the locked decision, the state should be recorded as `FAILED` (existing schema terminal state), not a new `BUY_FAILED` state. The `errorMessage` field distinguishes buy failures from sell failures in the DB.

### Anti-Patterns to Avoid

- **Pre-fetching blockhash:** Never fetch the blockhash before safety checks or before building the transaction body. Fetch it as the absolute last step before `tx.sign()`. Stale blockhashes cause `BlockhashNotFound` errors.
- **Using `maxRetries > 0` on sendRawTransaction:** The node's built-in retry broadcasts with the same (possibly stale) blockhash. Set `maxRetries: 0` and handle retries yourself by rebuilding the tx with a fresh blockhash.
- **Sequential RPC broadcast:** Sending to primary first then backup adds latency. Always broadcast to all RPCs simultaneously via `Promise.allSettled`.
- **Modifying Jupiter's VersionedTransaction after deserialization:** The `swapTransaction` from Jupiter may have ALT references that break if you try to add instructions. For Jito, use a separate tip transaction in the bundle rather than modifying the swap tx.
- **Caching the Jupiter quote across retries:** Token price moves between ladder steps. Always fetch a fresh quote for each sell attempt.
- **Using `confirmed` commitment for blockhash fetch:** Using `processed` for blockhash fetching is correct — it gives a fresher blockhash. Use `confirmed` only for transaction confirmation polling.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Swap routing | Custom DEX integration | Jupiter Swap API | Route optimization, ALT handling, compute budget estimation — all handled |
| Bonding curve math | Manual pump.fun curve calculations | PumpPortal trade-local API | PumpPortal builds the correct tx including bonding curve mechanics |
| Priority fee calculation | Heuristic fee estimator | Jupiter `priorityLevelWithMaxLamports` + `dynamicComputeUnitLimit` | Jupiter simulates compute units and applies the right fee automatically |
| MEV protection | Custom co-location | Jito bundles via block engine | 95% of Solana stake runs Jito validator client; bundles land reliably |
| Token account creation | Manual ATA creation | Jupiter `wrapAndUnwrapSol: true` | Jupiter handles SOL wrapping/unwrapping and ATA creation automatically |
| tx serialization for Jito | Custom encoding | `bs58.encode(tx.serialize())` | Standard pattern; Jito block engine expects bs58 |

**Key insight:** In Solana execution, the hardest problems (routing, fee estimation, compute budgets, ATA management) are already solved by Jupiter. Build the orchestration layer around Jupiter, not a replacement for it.

---

## Common Pitfalls

### Pitfall 1: Blockhash Fetched Too Early
**What goes wrong:** Transaction rejected with `BlockhashNotFound` or lands but is already expired.
**Why it happens:** Safety checks take 200-500ms; if blockhash is fetched before them, it may expire during high-slot-rate periods.
**How to avoid:** The locked decision says "absolute last step before signing." In code, this means the `getLatestBlockhash()` call is immediately before `tx.sign()` with no async operations between them.
**Warning signs:** Intermittent `BlockhashNotFound` errors, especially during high-traffic periods.

### Pitfall 2: Jupiter `swapTransaction` Already Has Blockhash Set
**What goes wrong:** Jupiter pre-populates `recentBlockhash` in the returned `swapTransaction`. You must overwrite it with a fresh one before signing.
**Why it happens:** Jupiter builds the tx server-side and includes a blockhash at build time. By the time you receive and sign it, that blockhash may be near-expiry.
**How to avoid:** Always overwrite: `tx.message.recentBlockhash = freshBlockhash` after deserializing the Jupiter response.
**Warning signs:** Occasional `BlockhashNotFound` on Jupiter buys, especially with slow network connections.

### Pitfall 3: PumpPortal Returns Bytes, Jupiter Returns Base64
**What goes wrong:** `VersionedTransaction.deserialize()` fails with malformed input.
**Why it happens:** Developers treat both APIs the same way. PumpPortal: `new Uint8Array(await response.arrayBuffer())`. Jupiter: `Buffer.from(swapResponse.swapTransaction, 'base64')`.
**How to avoid:** Two separate deserialization paths — one per API. Never mix them.
**Warning signs:** `Buffer` decode errors at the deserialization step.

### Pitfall 4: Jito Bundle ID ≠ Transaction Signature
**What goes wrong:** Trying to use `confirmTransaction(bundleId)` fails — bundle ID is a SHA-256 hash, not a Solana signature.
**Why it happens:** Confusing the two identifier types.
**How to avoid:** Use `getBundleStatuses(bundleId)` to check bundle landing. For the actual transaction signature (to record in TradeStore), parse it from `getBundleStatuses` response's `transactions` array.
**Warning signs:** RPC errors when trying to use bundle ID as a transaction signature.

### Pitfall 5: Multi-RPC Broadcast Returns Multiple Promises — Signature is the Same
**What goes wrong:** Confusion about which signature to use when multiple RPCs return results.
**Why it happens:** Each RPC independently simulates and returns the signature, but since the transaction is identical, all signatures are the same.
**How to avoid:** Use `Promise.allSettled`, take the first fulfilled value's signature. All signatures are identical — pick any.
**Warning signs:** Not actually a bug, but unnecessary complexity if the code tries to deduplicate signatures.

### Pitfall 6: Chunked Sell Token Balance Precision
**What goes wrong:** Rounding errors in tranche calculation leave dust that creates a 4th transaction or fails due to insufficient balance.
**Why it happens:** Token amounts are large integers (u64). Integer division creates remainder.
**How to avoid:** `tranche = Math.floor(balance / 3)`. Last tranche = `balance - (tranche * 2)`. This pattern ensures the remainder goes to the last tranche and the total is exact.
**Warning signs:** "Insufficient balance" errors on the third tranche.

### Pitfall 7: Sell Ladder Not Recording State Transitions
**What goes wrong:** On crash mid-ladder, bot doesn't know where in the ladder it was.
**Why it happens:** Ladder state is purely in-memory.
**How to avoid:** At minimum, keep the trade in `SELLING` state throughout. When a step confirms, transition to `COMPLETED`. If all steps exhaust, transition to `FAILED`. The per-step ladder state does NOT need to be persisted — on restart, Phase 6 crash recovery will reconcile `SELLING` entries.
**Warning signs:** Trades stuck in `SELLING` state after restart with no recovery path.

### Pitfall 8: PumpPortal `slippage` is Percent, Not Basis Points
**What goes wrong:** Passing `1000` (bps) to PumpPortal results in 1000% slippage — transaction fails or trades at wildly wrong price.
**Why it happens:** Jupiter uses basis points; PumpPortal uses percent.
**How to avoid:** PumpPortal `slippage` field = percent (e.g., `10` for 10%). Jupiter `slippageBps` = basis points (e.g., `1000` for 10%). Convert when needed: `bps / 100 = percent`.
**Warning signs:** PumpPortal transactions failing with unexpected slippage errors.

---

## Code Examples

Verified patterns from official sources and existing codebase:

### PumpPortal Sell (for migrated tokens that were originally pump.fun)

```typescript
// Source: https://pumpportal.fun/local-trading-api/trading-api/
// For selling a pumpportal-origin token that is still on bonding curve

const response = await fetch('https://pumpportal.fun/api/trade-local', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    publicKey: wallet.publicKey.toBase58(),
    action: 'sell',
    mint: tokenMint,
    denominatedInSol: 'false',     // selling in token amounts
    amount: tokenAmount.toString(), // or '100%' to sell all
    slippage: 15,                   // percent (not bps)
    priorityFee: 0.0005,            // SOL
    pool: 'pump',
  }),
});
const txBytes = new Uint8Array(await response.arrayBuffer());
const tx = VersionedTransaction.deserialize(txBytes);
// ... blockhash, sign, send
```

### Jupiter Sell (for raydium/pumpswap-sourced tokens)

```typescript
// Source: dev.jup.ag + existing src/safety/checks/tier1-sell-route.ts pattern
const SOL_MINT = 'So11111111111111111111111111111111111111112';

// Quote: token → SOL
const quote = await fetch(
  `https://api.jup.ag/swap/v1/quote?inputMint=${tokenMint}&outputMint=${SOL_MINT}` +
  `&amount=${tokenAmountLamports}&slippageBps=${slippageBps}&maxAccounts=64`
).then(r => r.json());

const swap = await fetch('https://api.jup.ag/swap/v1/swap', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    userPublicKey: wallet.publicKey.toBase58(),
    quoteResponse: quote,
    dynamicComputeUnitLimit: true,
    dynamicSlippage: false,
    prioritizationFeeLamports: {
      priorityLevelWithMaxLamports: {
        priorityLevel: 'veryHigh',
        maxLamports: Math.floor(baseFee * multiplier),
      }
    },
    wrapAndUnwrapSol: true,
  }),
}).then(r => r.json());

const txBytes = Buffer.from(swap.swapTransaction, 'base64');
const tx = VersionedTransaction.deserialize(txBytes);
```

### TradeStore Transitions for Execution Phase

```typescript
// Source: existing src/persistence/trade-store.ts

// After write-ahead record created (already done in index.ts):
// tradeStore.createBuyingRecord(mint) -- already called before execution

// On successful buy confirmation:
tradeStore.transition(mint, 'BUYING', 'MONITORING', {
  buySignature: signature,
  amountSol: config.buyAmountSol,
  amountTokens: tokenAmount,
  buyPriceSol: buyPriceEstimate,
});

// On buy failure (no retry per locked decision):
tradeStore.transition(mint, 'BUYING', 'FAILED', {
  errorMessage: `BUY_FAILED: ${err.message}`,
});
// activeMints.delete() happens automatically inside transition() for terminal states

// When position manager triggers sell:
tradeStore.transition(mint, 'MONITORING', 'SELLING');

// On successful sell (any ladder step):
tradeStore.transition(mint, 'SELLING', 'COMPLETED', {
  sellSignature: signature,
  sellPriceSol: sellPriceEstimate,
});

// On sell ladder exhaustion:
tradeStore.transition(mint, 'SELLING', 'FAILED', {
  errorMessage: 'SELL_FAILED: all ladder steps exhausted',
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Jupiter v6 (quote-api.jup.ag/v6) | Jupiter v1 (api.jup.ag/swap/v1) | Late 2024/early 2025 | New endpoint; both work but v1 is current |
| Fixed slippage on sells | Per-step configurable slippage in ladder | Phase 5 design | Better capital recovery in low-liquidity conditions |
| Single RPC submission | Multi-RPC parallel broadcast | 2024 best practice | Significantly improved landing rate during congestion |
| Sequential safety + execution | Write-ahead persistence before execution | Phase 4 completion | Crash-safe trade tracking; duplicate guard works |
| Raydium as primary migration target | PumpSwap (Pump.fun native AMM) | Early 2026 | STATE.md notes this; `pumpswap` source already supported in detection |

**Deprecated/outdated:**
- `quote-api.jup.ag/v6`: Still works but `api.jup.ag/swap/v1` is the current endpoint. Both are compatible with the same response format.
- Legacy `Transaction` class: Jupiter returns `VersionedTransaction` (V0) with Address Lookup Tables. Must use `VersionedTransaction.deserialize()` not `Transaction.from()`.

---

## Open Questions

1. **Which sell path for `pumpportal`-sourced tokens that have migrated?**
   - What we know: Detection emits `source: 'pumpportal'` for bonding curve tokens. When they migrate, a separate event from the Raydium/PumpSwap listener fires with `source: 'raydium'` or `source: 'pumpswap'`.
   - What's unclear: A token bought when `source === 'pumpportal'` (bonding curve) may later migrate. At sell time, should we check current token state to determine if it has migrated?
   - Recommendation: At sell time, the token's current state is known from which DEX has liquidity. Use Jupiter for all sells (Jupiter handles both bonding curve tokens via PumpSwap routes AND migrated tokens). This simplifies sell path: always use Jupiter for sells, regardless of original buy path. PumpPortal sell is only relevant if the token is still on bonding curve at sell time.

2. **Jito tip account list stability**
   - What we know: The 8 addresses have been stable for some time. `getTipAccounts` API exists to fetch them dynamically.
   - What's unclear: Whether addresses can change without notice.
   - Recommendation: Use `getTipAccounts` from `https://mainnet.block-engine.jito.wtf/api/v1/getTipAccounts` at startup to fetch dynamically. Fall back to hardcoded list if the API is unreachable. Cache the result for the session.

3. **Token balance query for chunked sell**
   - What we know: Need the exact token balance to split into 3 tranches. `connection.getTokenAccountsByOwner()` or `@solana/spl-token`'s `getAccount()` can fetch this.
   - What's unclear: Whether `@solana/spl-token` is the right tool or if raw RPC is better.
   - Recommendation: Use `@solana/spl-token`'s `getAssociatedTokenAddress()` + `connection.getTokenAccountBalance()` — cleaner than raw parsing and already installed in the project (`@solana/spl-token: ^0.4.14`).

4. **Config schema extension for execution settings**
   - What we know: `trading.ts` has `TradingConfigSchema` with detection + safety sections. Need to add an `execution` section.
   - What's unclear: Exact key naming (Claude's discretion per CONTEXT.md).
   - Recommendation: Add `execution` section to `config.json` and `TradingConfigSchema`. Keys should follow `camelCase` and the existing pattern. Example: `execution.buy.slippageBps`, `execution.buy.priorityFeeBaseLamports`, `execution.sell.steps[].timeoutMs`.

---

## Sources

### Primary (HIGH confidence)
- `solana-sniper-bot-research.md` (in project root) — Comprehensive Feb 2026 research, verified against official docs; sections 3, 4, 10 directly relevant
- https://pumpportal.fun/local-trading-api/trading-api/ — Official PumpPortal trade-local API docs; endpoint, params, response format confirmed
- https://docs.jito.wtf/lowlatencytxnsend/ — Official Jito docs; bundle structure, tip accounts, sendBundle API
- https://solana.com/docs/core/transactions/confirmation — Official Solana docs; blockhash validity (~151 slots), lastValidBlockHeight pattern
- Existing codebase (`src/types/index.ts`, `src/detection/`, `src/persistence/trade-store.ts`) — TokenEvent.source routing key, TradeStore.transition() API

### Secondary (MEDIUM confidence)
- https://dev.jup.ag/api-reference/swap/swap — Jupiter Swap v1 API reference; swapTransaction base64 field, dynamicSlippage, prioritizationFeeLamports structure confirmed (URL had 404 on redirect but content extracted via web search verification)
- https://gist.github.com/zhe-t/60938c69e29276b7a9f098e1b0672c79 — Jito sendBundle raw HTTP implementation with bs58 encoding; cross-verified with official docs
- https://www.quicknode.com/guides/solana-development/transactions/jito-bundles — Jito bundle guide with TypeScript patterns; consistent with official Jito docs

### Tertiary (LOW confidence)
- Jito tip account address list — Listed in multiple sources consistently, but `getTipAccounts` API is the authoritative source; hardcoded list should be treated as fallback only.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — All dependencies already installed; Jupiter and PumpPortal APIs verified via official docs and existing codebase patterns
- Architecture: HIGH — Routing via TokenEvent.source is definitive; TradeStore state transitions are confirmed in existing code
- Pitfalls: HIGH — Blockhash and serialization pitfalls verified via official docs; PumpPortal bytes vs Jupiter base64 confirmed via API docs
- Jito bundle internals: MEDIUM — Tip account list and polling strategy have some uncertainty; recommend dynamic fetch at startup

**Research date:** 2026-02-26
**Valid until:** 2026-03-26 (30 days — Jupiter and PumpPortal APIs are relatively stable; Jito tip accounts are stable)
