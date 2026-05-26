# Phase 19: Execution Performance - Research

**Researched:** 2026-03-30
**Domain:** Solana transaction fee optimization, compute budget management, balance guards
**Confidence:** HIGH

## Summary

Phase 19 optimizes transaction execution across three axes: dynamic priority fees via Helius getPriorityFeeEstimate replacing static fee values (EXE-10), precise compute unit limits on self-built transactions (EXE-11), and a wallet balance guard preventing buys below operational minimums (EXE-12). The codebase has four buyer/seller paths that consume priority fees: Jupiter buyer, PumpPortal buyer, Jupiter standard-seller (used for STANDARD/HIGH_FEE/EMERGENCY), and PumpPortal seller. Additionally, the Jito seller builds its own swap+tip bundle. All paths currently use static `priorityFeeBaseLamports * multiplier` calculations.

The critical nuance discovered during research is the **unit mismatch** between Helius and Jupiter: Helius returns microlamports per compute unit, while Jupiter's `maxLamports` is total lamports. The fee estimator must handle this conversion. For PumpPortal, the fee is in SOL (lamports / 1e9). A centralized fee estimation service with short-TTL caching is the right approach to avoid redundant API calls while keeping fees current.

**Primary recommendation:** Build a `FeeEstimator` service in `src/core/fee-estimator.ts` that wraps the Helius getPriorityFeeEstimate RPC call with caching, fallback to static config, and conversion helpers for both Jupiter (total lamports) and PumpPortal (SOL) consumption patterns. Insert balance guard as the first check in the detection handler before safety pipeline evaluation.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Use Helius getPriorityFeeEstimate as a dynamic cap for Jupiter paths -- Helius sets a network-aware maxLamports ceiling, Jupiter picks optimal fee within that cap via priorityLevelWithMaxLamports
- **D-02:** For PumpPortal paths (buy and sell), use Helius estimate directly as the priority fee -- PumpPortal has no built-in fee estimation
- **D-03:** Request veryHigh priority level from Helius -- matches current Jupiter setting, targets top-of-block inclusion
- **D-04:** If Helius call fails or times out, fall back to existing static config values (priorityFeeBaseLamports * priorityFeeMultiplier) -- never block a transaction due to fee estimation failure
- **D-05:** Add new config field maxPriorityFeeCapLamports as absolute ceiling -- even if Helius returns extreme estimate during congestion, never exceed this cap
- **D-06:** Cache Helius fee estimate with short TTL (5-10 seconds) -- multiple transactions in a burst reuse the same estimate
- **D-07:** Log fee details per transaction: Helius estimate, cap applied, whether fallback was used
- **D-08:** Keep existing static config fields (priorityFeeBaseLamports, priorityFeeMultiplier) as fallback values -- no breaking config change
- **D-09:** Jupiter paths already use dynamicComputeUnitLimit: true -- do NOT override Jupiter's CU handling
- **D-10:** PumpPortal API builds transactions server-side -- leave CU to PumpPortal
- **D-11:** For Jito bundle sell path: simulate first, then set CU limit to consumed + 10-20% buffer via ComputeBudgetProgram.setComputeUnitLimit()
- **D-12:** CU simulation only on sell transactions -- buy path is speed-critical
- **D-13:** No extra CU logging -- keep logs lean
- **D-14:** Check wallet SOL balance before safety pipeline -- saves wasted safety check work
- **D-15:** When balance is below threshold: skip buy + emit BotEventBus event for dashboard-visible low-balance alert
- **D-16:** Threshold = buyAmountSol + minBalanceBufferSol
- **D-17:** New config field: minBalanceBufferSol (default 0.01 SOL)
- **D-18:** Cache getBalance result with short TTL (5-10 seconds)
- **D-19:** Balance guard applies to buys only -- sells must always attempt
- **D-20:** PumpPortal sell path uses dynamic Helius fee estimate (same as buy path)
- **D-21:** Keep Jito bundle tips fixed -- dynamic Jito tips are EXE-14 scope (deferred to v1.2)
- **D-22:** Same maxPriorityFeeCapLamports applies to both buys and sells

### Claude's Discretion
- Where exactly CU limits add value beyond Jito sells -- investigate which self-built transaction paths exist
- Whether to use a generous fixed CU limit for buy-path self-built transactions instead of simulation
- Whether sell ladder STANDARD step uses Helius dynamic base with multiplier escalation on top, or keeps existing static approach
- Whether HIGH_FEE escalation step can exceed maxPriorityFeeCap or stays capped
- Whether to pass specific account keys to getPriorityFeeEstimate for per-transaction accuracy, or use global network estimate

### Deferred Ideas (OUT OF SCOPE)
- Dynamic Jito tip amounts -- EXE-14, explicitly deferred to v1.2
- Per-transaction account-based fee estimation -- deferred to see if global estimates are sufficient first
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| EXE-10 | Bot uses dynamic priority fees via Helius getPriorityFeeEstimate instead of static fees | Helius API research (endpoint, auth, response format, unit conversion), Jupiter maxLamports integration, PumpPortal SOL fee conversion, caching strategy, fallback pattern |
| EXE-11 | Bot sets precise compute unit limits via ComputeBudgetProgram to reduce per-transaction cost | ComputeBudgetProgram.setComputeUnitLimit() API, simulateTransaction for CU estimation, only applies to Jito sell path (only self-built tx) |
| EXE-12 | Bot checks wallet SOL balance before buying -- skips buy if below configurable minimum | Connection.getBalance() API, caching with TTL, BotEventBus LOW_BALANCE event, insertion point in index.ts before safety pipeline |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @solana/web3.js | ^1.98.4 | ComputeBudgetProgram, Connection.getBalance(), simulateTransaction | Already in project; provides all needed Solana primitives |
| zod | ^4.3.6 | Config schema validation for new fields | Already in project; all config uses Zod schemas |
| pino | ^10.3.1 | Structured logging for fee/balance events | Already in project; all modules use createModuleLogger |
| eventemitter3 | ^5.0.4 | BotEventBus for LOW_BALANCE events | Already in project; singleton event bus pattern |

### Supporting
No new dependencies needed. All functionality is achievable with existing packages plus raw `fetch()` for the Helius RPC call.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Raw fetch to Helius RPC | helius-sdk npm package | Adds dependency for a single API call; raw fetch is simpler and matches existing tier3-creator.ts pattern |
| Manual CU simulation | @solana-developers/helpers getSimulationComputeUnits | Adds dependency for a thin wrapper; simulateTransaction is straightforward |

**Installation:** No new packages required.

## Architecture Patterns

### Recommended Project Structure
```
src/
  core/
    fee-estimator.ts         # NEW: Helius fee estimation + caching + fallback
    balance-guard.ts         # NEW: Wallet balance check + caching + threshold logic
    rpc-manager.ts           # EXISTING: provides Connection instances
  config/
    trading.ts               # MODIFIED: add maxPriorityFeeCapLamports, minBalanceBufferSol
  execution/
    buy/
      jupiter-buyer.ts       # MODIFIED: use FeeEstimator for maxLamports
      pump-portal-buyer.ts   # MODIFIED: use FeeEstimator for priorityFee SOL
    sell/
      standard-seller.ts     # MODIFIED: use FeeEstimator for maxLamports
      pump-portal-seller.ts  # MODIFIED: use FeeEstimator for priorityFee SOL
      jito-seller.ts         # MODIFIED: CU simulation + setComputeUnitLimit on swap tx
    sell-ladder.ts            # READ-ONLY: no changes (multipliers apply at caller level)
  dashboard/
    bot-event-bus.ts          # MODIFIED: add LOW_BALANCE event type
  index.ts                    # MODIFIED: insert balance guard before safety pipeline
```

### Pattern 1: Centralized Fee Estimation Service
**What:** A singleton `FeeEstimator` class that wraps Helius getPriorityFeeEstimate with in-memory TTL cache, absolute cap enforcement, and fallback to static config values.
**When to use:** Every buyer/seller function calls `feeEstimator.getEstimate()` instead of computing static fees locally.
**Why centralized:** Avoids duplicating Helius API calls, caching logic, and fallback handling across 4+ files. Single place to tune TTL, cap, and logging.

```typescript
// src/core/fee-estimator.ts
export interface FeeEstimate {
  maxLamports: number;       // For Jupiter paths: total lamports cap
  priorityFeeSol: number;    // For PumpPortal paths: fee in SOL
  source: 'helius' | 'fallback';
}

export class FeeEstimator {
  private cache: { estimate: number; expiry: number } | null = null;
  private readonly ttlMs: number;
  private readonly rpcUrl: string;

  constructor(rpcUrl: string, ttlMs = 5000) { /* ... */ }

  /**
   * Returns fee estimate. Uses cache if fresh, otherwise fetches from Helius.
   * Falls back to static config on any error.
   *
   * Helius returns: microlamports per CU (e.g., 120000)
   * Jupiter maxLamports: total lamports (e.g., 200000)
   * Conversion: microlamportsPerCU * estimatedCU / 1_000_000
   * PumpPortal SOL: maxLamports / 1e9
   */
  async getEstimate(config: TradingConfig): Promise<FeeEstimate> { /* ... */ }
}
```

### Pattern 2: Balance Guard with Cached getBalance
**What:** A standalone function (or small class) that checks `connection.getBalance()` against a threshold, caching the result for 5-10 seconds to avoid per-token RPC load.
**When to use:** Called in index.ts token handler before safety pipeline evaluation.
**Integration point:** Between the max-concurrent-positions check (line 168-173 of index.ts) and the safety pipeline call (line 175).

```typescript
// src/core/balance-guard.ts
export class BalanceGuard {
  private cachedBalance: { lamports: number; expiry: number } | null = null;

  async hasSufficientBalance(
    connection: Connection,
    wallet: PublicKey,
    buyAmountSol: number,
    minBufferSol: number,
  ): Promise<boolean> { /* ... */ }
}
```

### Pattern 3: Jito CU Simulation-then-Set
**What:** Before building the Jito bundle, simulate the swap transaction to get actual CU consumed, then add `ComputeBudgetProgram.setComputeUnitLimit({ units: consumed * 1.15 })` to the transaction.
**When to use:** Only for Jito sell path where we build the transaction ourselves.
**Key constraint:** The swap transaction from Jupiter already includes CU instructions via `dynamicComputeUnitLimit: true`. For Jito, we sign the tx ourselves, so we can modify it. However, since Jupiter already sets CU limits with `dynamicComputeUnitLimit: true`, the Jito swap tx already has a CU limit set by Jupiter. The simulation confirms if it is tight enough.

### Claude's Discretion Recommendations

**Self-built transaction paths for CU optimization:**
Investigated: The codebase has exactly ONE self-built transaction: the Jito tip transaction (`jito-seller.ts` line 102). All swap transactions come from Jupiter (CU handled internally) or PumpPortal (built server-side). The tip transaction is a simple SOL transfer (SystemProgram.transfer) which uses minimal CU (~450 CU). Adding a CU limit instruction to the tip tx is technically possible but saves negligible cost (< 200 lamports). **Recommendation: Only apply CU simulation to the Jito SWAP transaction per D-11. Skip the tip transaction -- not worth the complexity.**

**Buy-path self-built transactions:**
There are none. Jupiter builds the tx server-side with `dynamicComputeUnitLimit: true`. PumpPortal builds the tx server-side. **No CU optimization possible or needed on buy paths.**

**Sell ladder STANDARD step fee handling:**
**Recommendation: Use Helius dynamic estimate as the base for STANDARD step, then apply multipliers for escalation steps.** Rationale: The STANDARD step (feeMultiplier=1) gets the raw Helius estimate as maxLamports. The HIGH_FEE step gets `heliusEstimate * highFeeMultiplier`. This naturally integrates with the existing escalation ladder since the multiplier pattern is already established. The sell-ladder.ts code passes `feeMultiplier` to `standardSell()`, which computes `priorityFeeBaseLamports * feeMultiplier`. Replace `priorityFeeBaseLamports` with the Helius estimate and the multiplier chain stays intact.

**HIGH_FEE exceeding maxPriorityFeeCap:**
**Recommendation: HIGH_FEE stays capped.** The cap exists to prevent wallet drain (D-05). If HIGH_FEE needs more urgency, the ladder escalates to Jito bundle (which uses tips, not priority fees) and then to EMERGENCY with extreme slippage. Allowing fee cap bypass creates the exact wallet-drain risk the cap prevents.

**Account keys vs global estimate:**
**Recommendation: Use global estimate (no account keys).** Per CONTEXT.md this is deferred anyway. Global estimate avoids the latency of assembling and serializing the transaction before getting a fee estimate. For the buy path (speed-critical), global is the right choice. Can be revisited in v1.2 if global estimates prove inaccurate.

### Anti-Patterns to Avoid
- **Embedding Helius calls in each buyer/seller file:** Creates 4+ duplicate fetch+cache+fallback implementations. Use centralized FeeEstimator.
- **Blocking buy on fee estimation failure:** Per D-04, always fall back to static. Never let fee estimation delay or block a buy.
- **Using Helius microlamports directly as Jupiter maxLamports:** Unit mismatch -- microlamports/CU is not the same as total lamports. Must convert.
- **Simulating buy-path transactions for CU:** Adds 50-100ms latency that kills first-block targeting (D-12).
- **Letting escalation multipliers exceed the absolute cap unchecked:** `Math.min(computed, maxPriorityFeeCapLamports)` must be applied after multiplication.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Priority fee estimation | Custom fee percentile calculation | Helius getPriorityFeeEstimate API | Network-wide data, maintained by infrastructure team, handles edge cases (empty slots, voting txs) |
| CU estimation for Jito swap tx | Hardcoded CU values | connection.simulateTransaction() + unitsConsumed | Actual CU varies by swap route complexity; hardcoded values either waste fees or risk tx failure |
| Jupiter fee optimization | Manual ComputeBudgetProgram instructions | Jupiter's dynamicComputeUnitLimit: true + priorityLevelWithMaxLamports | Jupiter already handles CU and fee optimization internally for its swap transactions |

**Key insight:** Jupiter and PumpPortal handle their own transaction construction (CU limits, instruction ordering). Our job is to provide the RIGHT FEE AMOUNT, not rebuild transaction internals. The only exception is the Jito swap tx where we re-sign and could add a tighter CU limit.

## Common Pitfalls

### Pitfall 1: Microlamports vs Lamports Unit Mismatch
**What goes wrong:** Helius returns fee estimates in microlamports per compute unit. Jupiter maxLamports expects total lamports. Passing Helius value directly to Jupiter means paying 1,000,000x less than intended (or 1,000,000x more if reversed).
**Why it happens:** Both values are numbers without type safety. "Lamports" appears in both names.
**How to avoid:** Conversion formula: `totalLamports = Math.ceil(microlamportsPerCU * estimatedCU / 1_000_000)`. Use an estimated CU of ~200,000 for typical swaps (Jupiter's default). Apply `Math.min(totalLamports, maxPriorityFeeCapLamports)` as the final step.
**Warning signs:** Priority fees that are astronomically high or negligibly small compared to typical values (100,000-500,000 lamports).

### Pitfall 2: Helius RPC Auth vs Enhanced API Auth
**What goes wrong:** Using X-Api-Key header for the RPC endpoint, or ?api-key= for the Enhanced API.
**Why it happens:** Helius has two auth mechanisms: query parameter for standard RPC (`mainnet.helius-rpc.com/?api-key=KEY`) and X-Api-Key header for Enhanced API (`api-mainnet.helius-rpc.com`).
**How to avoid:** The getPriorityFeeEstimate is a Helius-specific RPC method that goes through the standard RPC endpoint. Use the same SOLSNIPER_RPC_URL (which already has `?api-key=` embedded) for the fee estimation fetch. No separate Helius API key handling needed -- reuse the RPC URL.
**Warning signs:** 401/403 errors from Helius on fee estimation calls.

### Pitfall 3: Cache Staleness During Network Congestion Spikes
**What goes wrong:** A 10-second TTL cache returns a stale estimate during a sudden congestion spike. Transaction lands with too-low fee.
**Why it happens:** Solana congestion can change within seconds during popular launches.
**How to avoid:** Use 5-second TTL (lower end of D-06 range). For buy path (speed-critical), the tradeoff of slightly stale data is acceptable vs. the latency of always-fresh calls. The maxPriorityFeeCapLamports prevents overpaying even with stale high estimates.
**Warning signs:** Increased transaction failures clustered in time, followed by successful retries with fresh estimates.

### Pitfall 4: Balance Guard Racing with Concurrent Buys
**What goes wrong:** Two tokens detected simultaneously. Both pass balance guard. Both attempt buy. Only one has enough SOL.
**Why it happens:** maxConcurrentPositions=1 prevents this in practice (second token is rejected at the positions check before reaching balance guard). But if maxConcurrentPositions > 1, the cached balance from the first check may not reflect the pending first buy.
**How to avoid:** The existing max-concurrent-positions check (index.ts line 168-173) runs before balance guard. Combined with cached balance (which updates after each buy attempt settles), this is sufficient for maxConcurrentPositions=1. For higher concurrency, the balance guard cache should be invalidated after each buy attempt. Given current config (maxConcurrentPositions=1), this is not a practical concern.
**Warning signs:** BUY_FAILED errors citing insufficient balance despite balance guard passing.

### Pitfall 5: VersionedTransaction CU Instruction Injection for Jito
**What goes wrong:** Attempting to add ComputeBudgetProgram.setComputeUnitLimit() to a VersionedTransaction by modifying its instruction array directly.
**Why it happens:** VersionedTransaction uses MessageV0 which is immutable after creation. You cannot add instructions to an existing VersionedTransaction.
**How to avoid:** The Jupiter swap response is a pre-built VersionedTransaction that ALREADY includes CU instructions (from `dynamicComputeUnitLimit: true`). For the Jito path, Jupiter already sets the CU limit. The simulation verifies the CU limit is adequate. If you need to override, you must deserialize the MessageV0, modify the instructions, rebuild, and re-sign. However, per D-11, since Jupiter already sets CU limits, simulation is primarily to verify adequacy rather than inject new instructions. If Jupiter's CU limit is already tight, no modification is needed.
**Warning signs:** Errors about immutable message fields, or "invalid instruction data" after manual modification.

### Pitfall 6: PumpPortal Fee in SOL, Not Lamports
**What goes wrong:** Passing lamports to PumpPortal's `priorityFee` field.
**Why it happens:** The field name doesn't specify units. PumpPortal expects SOL (e.g., 0.0001), not lamports (e.g., 100000).
**How to avoid:** Conversion: `priorityFeeSol = lamports / 1e9`. The FeeEstimator should return both `maxLamports` (for Jupiter) and `priorityFeeSol` (for PumpPortal) to prevent caller mistakes.
**Warning signs:** PumpPortal transactions with absurdly high fees (100,000 SOL instead of 0.0001 SOL).

## Code Examples

### Helius getPriorityFeeEstimate API Call
```typescript
// Source: https://www.helius.dev/docs/api-reference/priority-fee/getpriorityfeeestimate
// Returns microlamports per compute unit
const response = await fetch(rpcUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 'fee-estimate',
    method: 'getPriorityFeeEstimate',
    params: [{
      options: {
        priorityLevel: 'VeryHigh',  // D-03: matches Jupiter setting
      },
    }],
  }),
});
const json = await response.json();
// json.result.priorityFeeEstimate = number (microlamports per CU)
```

### Converting Helius Estimate to Jupiter maxLamports
```typescript
// Helius returns: microlamports per CU (e.g., 120000)
// Jupiter maxLamports: total lamports (cap on total priority fee)
// Formula: microlamportsPerCU * estimatedCU / 1_000_000
// Use 200_000 CU as default estimate (standard swap)
const ESTIMATED_CU = 200_000;
const microlamportsPerCU = heliusResult.priorityFeeEstimate;
const totalLamports = Math.ceil(microlamportsPerCU * ESTIMATED_CU / 1_000_000);
const capped = Math.min(totalLamports, config.maxPriorityFeeCapLamports);
// Pass `capped` as maxLamports to Jupiter priorityLevelWithMaxLamports
```

### Converting to PumpPortal SOL Fee
```typescript
// PumpPortal priorityFee field is in SOL
// Same conversion to total lamports, then lamports -> SOL
const priorityFeeSol = capped / 1e9;
```

### ComputeBudgetProgram.setComputeUnitLimit (for Jito swap tx)
```typescript
// Source: https://solana-foundation.github.io/solana-web3.js/classes/ComputeBudgetProgram.html
import { ComputeBudgetProgram } from '@solana/web3.js';

// Step 1: Simulate to get actual CU consumed
const simulation = await connection.simulateTransaction(swapTx, {
  replaceRecentBlockhash: true,  // Use a valid blockhash for simulation
  sigVerify: false,               // Skip signature verification
});
const cuConsumed = simulation.value.unitsConsumed ?? 200_000;

// Step 2: Set CU limit with buffer
const cuLimit = Math.ceil(cuConsumed * 1.15);  // 15% buffer per D-11
const cuInstruction = ComputeBudgetProgram.setComputeUnitLimit({ units: cuLimit });
// Note: For VersionedTransaction, must rebuild message to inject instruction
```

### Balance Guard (Connection.getBalance)
```typescript
// Source: @solana/web3.js Connection.getBalance
// Returns lamports (number)
const balanceLamports = await connection.getBalance(walletPublicKey, 'processed');
const balanceSol = balanceLamports / 1e9;
const threshold = buyAmountSol + minBalanceBufferSol;
if (balanceSol < threshold) {
  // Skip buy, emit LOW_BALANCE event
  botEventBus.emit('event', {
    type: 'LOW_BALANCE',
    mint,
    ts: Date.now(),
    detail: `balance ${balanceSol.toFixed(4)} SOL < threshold ${threshold.toFixed(4)} SOL`,
  });
  return; // Skip safety pipeline and buy
}
```

### BotEventBus LOW_BALANCE Event Type
```typescript
// Add to BotEventType union in src/dashboard/bot-event-bus.ts
export type BotEventType =
  | 'TOKEN_DETECTED'
  | 'BUY_SENT'
  | 'BUY_CONFIRMED'
  | 'BUY_FAILED'
  | 'SELL_TRIGGERED'
  | 'SELL_PARTIAL'
  | 'SELL_CONFIRMED'
  | 'SELL_FAILED'
  | 'ERROR'
  | 'CONFIG_CHANGED'
  | 'LOW_BALANCE';    // NEW: EXE-12
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Static priority fees | Dynamic fees via Helius getPriorityFeeEstimate | Helius API stable since 2024 | 20-80% fee savings during low congestion, better landing during high congestion |
| Default 200K CU limit | Simulation-based CU limits | Solana runtime always supported simulation | Reduces per-tx cost by requesting only needed CU |
| Jupiter `jitoTipLamports` | Jupiter `priorityLevelWithMaxLamports` | Jupiter API v6 2024 | Jupiter handles fee optimization internally when given a cap |

**Deprecated/outdated:**
- `ComputeBudgetProgram.requestUnits()`: Deprecated. Use `setComputeUnitLimit()` + `setComputeUnitPrice()` instead.

## Open Questions

1. **Jito Swap TX CU Modification Feasibility**
   - What we know: Jupiter builds the swap VersionedTransaction with `dynamicComputeUnitLimit: true`, which already sets a CU limit. For Jito, we deserialize, re-sign, and bundle it.
   - What's unclear: Whether Jupiter's CU limit is already tight enough that simulation + override provides meaningful savings. The CU limit Jupiter sets may already be close to optimal.
   - Recommendation: Implement simulation and log `jupitersSetCU` vs `simulatedCU` in debug logs during initial deployment. If Jupiter is consistently within 10-15% of actual, the simulation can be removed later as unnecessary overhead.

2. **Helius getPriorityFeeEstimate Rate Limits**
   - What we know: Helius documentation does not specify rate limits for this endpoint. It goes through the standard RPC URL which has plan-based rate limits.
   - What's unclear: Whether rapid fee estimation calls count against the same rate limit as other RPC calls (getBalance, getAccountInfo, etc.).
   - Recommendation: Cache aggressively (5s TTL per D-06). Even at peak detection rate (multiple tokens/second), cache ensures at most 12 Helius fee calls/minute.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^4.0.18 |
| Config file | vitest.config.ts |
| Quick run command | `pnpm vitest run --reporter=verbose` |
| Full suite command | `pnpm vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EXE-10a | FeeEstimator fetches from Helius and returns correct lamports conversion | unit | `pnpm vitest run src/core/fee-estimator.test.ts -t "fetches"` | Wave 0 |
| EXE-10b | FeeEstimator falls back to static config on Helius failure | unit | `pnpm vitest run src/core/fee-estimator.test.ts -t "fallback"` | Wave 0 |
| EXE-10c | FeeEstimator caches result within TTL | unit | `pnpm vitest run src/core/fee-estimator.test.ts -t "cache"` | Wave 0 |
| EXE-10d | FeeEstimator enforces maxPriorityFeeCapLamports | unit | `pnpm vitest run src/core/fee-estimator.test.ts -t "cap"` | Wave 0 |
| EXE-10e | Jupiter buyer uses dynamic fee from FeeEstimator | unit | `pnpm vitest run src/execution/buy/jupiter-buyer.test.ts -t "dynamic"` | Existing file, new test |
| EXE-10f | PumpPortal buyer uses dynamic fee from FeeEstimator | unit | `pnpm vitest run src/execution/buy/pump-portal-buyer.test.ts -t "dynamic"` | Existing file, new test |
| EXE-10g | Standard seller uses dynamic fee from FeeEstimator | unit | `pnpm vitest run src/execution/sell/standard-seller.test.ts -t "dynamic"` | Existing file, new test |
| EXE-10h | PumpPortal seller uses dynamic fee from FeeEstimator | unit | `pnpm vitest run src/execution/sell/pump-portal-seller.test.ts -t "dynamic"` | Existing file, new test |
| EXE-11a | Jito seller simulates CU and sets limit with buffer | unit | `pnpm vitest run src/execution/sell/jito-seller.test.ts -t "compute"` | Existing file, new test |
| EXE-12a | BalanceGuard passes when balance sufficient | unit | `pnpm vitest run src/core/balance-guard.test.ts -t "sufficient"` | Wave 0 |
| EXE-12b | BalanceGuard rejects when balance insufficient | unit | `pnpm vitest run src/core/balance-guard.test.ts -t "insufficient"` | Wave 0 |
| EXE-12c | BalanceGuard caches getBalance within TTL | unit | `pnpm vitest run src/core/balance-guard.test.ts -t "cache"` | Wave 0 |
| EXE-12d | LOW_BALANCE event emitted when balance insufficient | unit | `pnpm vitest run src/core/balance-guard.test.ts -t "event"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm vitest run src/core/fee-estimator.test.ts src/core/balance-guard.test.ts`
- **Per wave merge:** `pnpm vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/core/fee-estimator.test.ts` -- covers EXE-10a through EXE-10d
- [ ] `src/core/balance-guard.test.ts` -- covers EXE-12a through EXE-12d

## Sources

### Primary (HIGH confidence)
- [Helius getPriorityFeeEstimate API Reference](https://www.helius.dev/docs/api-reference/priority-fee/getpriorityfeeestimate) -- endpoint format, request/response schema, auth method (query param), priority levels, microlamports units
- [Helius Priority Fee API Overview](https://www.helius.dev/docs/priority-fee-api) -- percentile mappings (min=0th, low=25th, medium=50th, high=75th, veryHigh=95th, unsafeMax=100th), serialized tx vs account keys tradeoffs
- [Solana ComputeBudgetProgram docs](https://solana-foundation.github.io/solana-web3.js/classes/ComputeBudgetProgram.html) -- setComputeUnitLimit, setComputeUnitPrice method signatures
- [Solana Compute Optimization Guide](https://solana.com/developers/cookbook/transactions/optimize-compute) -- simulation-based CU estimation pattern
- Project source code: all 6 execution files, config/trading.ts, index.ts, bot-event-bus.ts -- current fee patterns, integration points, BotEventBus types

### Secondary (MEDIUM confidence)
- [Jupiter Swap API docs](https://dev.jup.ag/api-reference/swap/swap) -- priorityLevelWithMaxLamports format, maxLamports units (total lamports), dynamicComputeUnitLimit behavior
- [Helius priority fee blog](https://www.helius.dev/blog/priority-fees-understanding-solanas-transaction-fee-mechanics) -- fee calculation: Total priority fee = Price per CU (microlamports) * CU consumed / 1,000,000

### Tertiary (LOW confidence)
- Helius rate limits for getPriorityFeeEstimate -- not documented; assumed to share RPC plan limits

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all existing packages
- Architecture: HIGH -- clear integration points, well-understood codebase patterns
- Pitfalls: HIGH -- unit mismatch thoroughly documented, auth patterns verified in existing code
- CU optimization for Jito: MEDIUM -- Jupiter may already set tight CU limits; simulation benefit unverified

**Research date:** 2026-03-30
**Valid until:** 2026-04-30 (Helius API stable; no breaking changes expected)
