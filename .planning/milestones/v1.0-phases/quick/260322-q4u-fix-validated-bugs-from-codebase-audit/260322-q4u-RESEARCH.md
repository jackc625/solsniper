# Quick Task 260322-q4u: Fix Validated Bugs from Codebase Audit - Research

**Researched:** 2026-03-22
**Domain:** Bug fixes across sell-ladder, recovery, config, position-manager, safety checks
**Confidence:** HIGH

## Summary

Seven validated bugs and one security issue from BUGS.md. All are localized code fixes -- no new dependencies, no architectural changes. The hardest fix is BUG 1 (Jito polling loop) which requires understanding Jito's getBundleStatuses timing; the rest are straightforward edits (remove a line, reorder statements, add Map.delete calls, apply regex masking).

**Primary recommendation:** Fix all 7 issues in source order, test where existing tests exist. No new libraries needed.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- BUG 2: Don't increment any counter on RPC failure -- let summary totals speak for themselves. No new sellingFailed field added to RecoverySummary.
- BUG 3: Deep merge ALL nested objects: positionManagement, safety (+ safety.weights), execution (+ execution.buy, execution.sell), detection. Future-proof.
- D1/D2: Skip both -- deliberate design choices, not bugs.

### Claude's Discretion
- BUG 1 polling loop: interval/max attempts for Jito polling
- BUG 4: whether to emit SELL_CONFIRMED or skip SELL_TRIGGERED on zero-balance path
- BUG 6: cleanup timing (fireSell .finally vs explicit cleanup method)
- S1: URL sanitization approach

### Deferred Ideas (OUT OF SCOPE)
- BUG 7 (BigInt precision loss) -- skipped per CONTEXT.md
- D1 (as any cast) -- deliberate Phase 8 shortcut
- D2 (dead config fields) -- deliberate Phase 7 backward-compat
</user_constraints>

## BUG 1: Jito pollBundleStatus Polling Loop

**Confidence: HIGH** (verified against Jito docs and community patterns)

### Current Problem
`pollBundleStatus` (jito-seller.ts:152-165) makes exactly ONE HTTP request and returns. Bundles take 400ms-2s to land. The single check almost always returns 'Pending', causing the function to throw every time. The Jito sell step is effectively non-functional.

### Correct Pattern
Per [Jito documentation](https://docs.jito.wtf/) and [QuickNode getBundleStatuses reference](https://www.quicknode.com/docs/solana/getBundleStatuses):

- Poll with gentle backoff: start at ~1s, increase to ~5s
- Total polling window: SellLadder already wraps jitoSell in a Promise.race timeout (jitoTimeoutMs = 30s default), so pollBundleStatus does NOT need its own max duration -- the SellLadder timeout is the upper bound
- Break on terminal states: 'Landed' (success) or 'Failed' (permanent failure)
- Continue polling on: 'Pending', 'Invalid' (transient), or no result yet

### Recommended Implementation

```typescript
async function pollBundleStatus(bundleId: string): Promise<'Landed' | 'Failed' | 'Pending'> {
  const INITIAL_DELAY_MS = 1000;
  const MAX_DELAY_MS = 5000;
  let delay = INITIAL_DELAY_MS;

  // Loop indefinitely -- SellLadder's Promise.race timeout is the outer bound
  while (true) {
    await new Promise(resolve => setTimeout(resolve, delay));

    const response = await fetch(JITO_BUNDLE_URL, {
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
    const status = (json?.result?.value?.[0]?.confirmation_status as string) ?? 'Pending';

    if (status === 'Landed' || status === 'Failed') {
      return status as 'Landed' | 'Failed';
    }

    // Backoff: 1s -> 2s -> 4s -> 5s (capped)
    delay = Math.min(delay * 2, MAX_DELAY_MS);
  }
}
```

**Key insight:** The function is already wrapped in `Promise.race` with `jitoTimeoutMs` by SellLadder (line 180-184). No need for an internal max-attempts counter -- the outer timeout handles it. If the timeout fires, the promise is rejected and the sell ladder advances to the next step. The `while(true)` is safe because the SellLadder timeout will always fire.

**Comment in existing code confirms intent:** Line 138-139 says "Poll for bundle landing (timedout by SellLadder via Promise.race)" -- the design always intended a loop here.

## BUG 2: Recovery Counter Fix

**Confidence: HIGH** (straightforward code deletion)

### Current Problem
recovery-manager.ts:158 -- in the catch block for SELLING trades, after transitioning to FAILED, it increments `sellingCompleted++`. This inflates the "sell assumed landed" counter.

### Fix
Per locked decision: remove the `sellingCompleted++` line entirely. Don't increment any counter on RPC failure. The summary totals already account for the trade via the FAILED transition in the DB.

```typescript
// recovery-manager.ts:151-159
} catch (err) {
  this.tradeStore.transition(trade.mint, 'SELLING', 'FAILED', {
    errorMessage: 'RECOVERY: RPC unavailable',
  });
  log.warn({ mint: trade.mint, tradeId: trade.id, err },
    'SELLING trade recovery failed -- RPC unavailable');
  // BUG FIX: removed sellingCompleted++ -- RPC failure is NOT a completed sell
}
```

### Test Update
The existing recovery-manager.test.ts likely has a test for the RPC timeout scenario. The assertion on `sellingCompleted` count must be updated to NOT include the RPC failure case.

## BUG 3: Deep Merge for patchRuntimeConfig

**Confidence: HIGH** (type structure fully known from TradingConfigSchema)

### Current Problem
trading.ts:134-136 uses shallow spread: `_runtimeConfig = { ..._runtimeConfig, ...updates }`. Patching a nested key like `{ positionManagement: { stopLossPct: -30 } }` replaces the entire `positionManagement` object, deleting all other fields.

### Nested Keys in TradingConfig

| Top-level Key | Nested Keys | Depth |
|---|---|---|
| `positionManagement` | `pollIntervalMs, stopLossPct, tieredTp, trailingStopPct, maxHoldTimeMs` | 1 level |
| `safety` | `tier2TimeoutMs, tier3TimeoutMs, cacheTtlMs, weights, holder, rugCheckScoreInverted, blocklistPath` | 1 level + `weights` (2 levels), `holder` (2 levels) |
| `execution` | `buy, sell` | 1 level + `buy` (2 levels), `sell` (2 levels) |
| `detection` | `wsHeartbeatIntervalMs, wsBaseBackoffMs, ...` | 1 level |

### Recommended Implementation

A generic approach using Object.keys avoids hardcoding every key and is future-proof per locked decision:

```typescript
export function patchRuntimeConfig(updates: Partial<TradingConfig>): TradingConfig {
  const merged = { ..._runtimeConfig };

  for (const key of Object.keys(updates) as Array<keyof TradingConfig>) {
    const updateVal = updates[key];
    const currentVal = _runtimeConfig[key];

    // Deep merge plain objects (1 level); primitives overwrite directly
    if (
      updateVal != null &&
      typeof updateVal === 'object' &&
      !Array.isArray(updateVal) &&
      currentVal != null &&
      typeof currentVal === 'object' &&
      !Array.isArray(currentVal)
    ) {
      // Level 1 merge
      const mergedObj = { ...currentVal } as Record<string, unknown>;
      for (const subKey of Object.keys(updateVal as Record<string, unknown>)) {
        const subUpdate = (updateVal as Record<string, unknown>)[subKey];
        const subCurrent = (currentVal as Record<string, unknown>)[subKey];

        // Level 2 merge (safety.weights, safety.holder, execution.buy, execution.sell)
        if (
          subUpdate != null &&
          typeof subUpdate === 'object' &&
          !Array.isArray(subUpdate) &&
          subCurrent != null &&
          typeof subCurrent === 'object' &&
          !Array.isArray(subCurrent)
        ) {
          mergedObj[subKey] = { ...subCurrent, ...subUpdate };
        } else {
          mergedObj[subKey] = subUpdate;
        }
      }
      (merged as Record<string, unknown>)[key] = mergedObj;
    } else {
      (merged as Record<string, unknown>)[key] = updateVal;
    }
  }

  _runtimeConfig = merged as TradingConfig;
  return _runtimeConfig;
}
```

**Why not lodash/deepmerge:** The codebase has zero utility library dependencies. The merge is exactly 2 levels deep (known from the schema). A targeted solution avoids adding a dependency for a 20-line function.

**Array handling:** `tieredTp` is an array -- it must be REPLACED, not merged element-by-element. The `!Array.isArray()` guard ensures arrays are treated as atomic values.

## BUG 4: Orphaned SELL_TRIGGERED Event

**Confidence: HIGH** (straightforward reorder)

### Current Problem
sell-ladder.ts:68 emits `SELL_TRIGGERED` before the zero-balance check at line 88. When `freshBalance === 0n`, the function exits with `COMPLETED` but never emits `SELL_CONFIRMED`. The dashboard shows a triggered sell that never resolves.

### Recommended Fix
Move the `SELL_TRIGGERED` emission to AFTER the zero-balance check (after line 93). This way, zero-balance exits never emit the event, and the dashboard only sees SELL_TRIGGERED for sells that actually proceed.

```typescript
// BEFORE (line 68): botEventBus.emit('event', { type: 'SELL_TRIGGERED', ... });
// ... balance check at line 88 ...

// AFTER: move emission here (after the zero-balance early return)
botEventBus.emit('event', { type: 'SELL_TRIGGERED', mint, ts: Date.now(), detail: `${verifiedAmount} tokens`, isDryRun: getRuntimeConfig().dryRun });
```

**Why not emit SELL_CONFIRMED on zero-balance path:** The zero-balance path means "nothing was sold now" -- emitting SELL_CONFIRMED would be misleading. Better to emit nothing (trade just silently completes). The user-suggested approach in CONTEXT.md aligns: "Move SELL_TRIGGERED emission after the zero-balance check."

## BUG 5: Double-Count solReceived Display

**Confidence: HIGH** (one-line fix)

### Current Problem
sell-ladder.ts:268: `const runningTotal = priorTrade.sellPriceSol! + solReceived`

After `addSellPrice(mint, solReceived)` at line 231, `priorTrade.sellPriceSol` (fetched at line 235) already includes the just-added `solReceived`. Adding `solReceived` again double-counts it in the SELL_PARTIAL event detail string.

### Fix
Use `priorTrade.sellPriceSol` directly -- it IS the running total:

```typescript
// Line 268 -- was: const runningTotal = priorTrade.sellPriceSol! + solReceived;
const runningTotal = priorTrade.sellPriceSol!;
```

Then update the detail string to use `runningTotal` (already does). This is a display-only fix -- no data integrity impact.

## BUG 6: PositionManager Maps Memory Leak

**Confidence: HIGH** (clean cleanup in fireSell .finally)

### Current Problem
`highWatermarks`, `tierIndices`, and `lastKnownQuoteSol` Maps in position-manager.ts:45-54 are never pruned. Entries accumulate indefinitely for completed/failed trades.

### Recommended Fix
Clean up in `fireSell`'s `.finally()` callback. The `.finally()` already exists (line 402-404) and runs after sellLadder.sell() settles, regardless of success/failure. This is the natural place because:

1. `.finally()` fires after the trade reaches a terminal state (COMPLETED or FAILED)
2. It already cleans up `sellsInFlight` -- adding Map cleanup is consistent
3. No timing risk -- the sell is done, so the entries are no longer needed

```typescript
private fireSell(mint: string, tokensToSell: bigint, partial = false): void {
  this.sellsInFlight.add(mint);
  const fallbackSolValue = this.lastKnownQuoteSol.get(mint);
  const p = this.sellLadder.sell(mint, tokensToSell, fallbackSolValue, partial);
  void p;
  p.finally(() => {
    this.sellsInFlight.delete(mint);
    // Clean up per-mint tracking Maps to prevent memory leak
    if (!partial) {
      this.highWatermarks.delete(mint);
      this.tierIndices.delete(mint);
      this.lastKnownQuoteSol.delete(mint);
    }
  });
}
```

**Critical: only clean up when `partial === false`.** For partial (tiered TP) sells, the position returns to MONITORING and needs its high watermark and tier index intact for the next tier. Only full sells (stop-loss, trailing stop, final tier, max hold time) should clean up.

## S1: Helius API Key in URL

**Confidence: HIGH** (existing pattern in codebase)

### Current Problem
tier3-creator.ts:112 puts the API key in the URL query string:
```typescript
const url = `${HELIUS_TX_URL}/${creator}/transactions?api-key=${heliusApiKey}&type=TOKEN_MINT&limit=10`;
```
If `fetch()` throws, the full URL (including key) appears in the error stack trace and gets logged by the catch block at line 145.

### Existing Pattern
rpc-manager.ts:26 already has the exact regex for this:
```typescript
const maskUrl = (url: string) => url.replace(/api-key=[^&]*/gi, 'api-key=***');
```

### Recommended Fix
Sanitize the URL in the catch block's log output. Don't change the URL construction (the Helius API requires the key in the query string -- it doesn't support Authorization headers for this endpoint).

```typescript
} catch (err: unknown) {
  // Mask API key in URL before logging to prevent key leakage in error traces
  const safeUrl = url.replace(/api-key=[^&]*/gi, 'api-key=***');
  log.warn({ creator, url: safeUrl, err }, 'Helius API fetch error or timeout');
  // ...
}
```

**Alternative considered:** Masking in the URL construction itself, then unmasking for the actual fetch. This is more complex and fragile. Better to mask only at log/error boundaries.

**Note:** The `err` object itself may contain the URL in its message or stack. For full protection, also consider wrapping the fetch in a try-catch that rethrows with a sanitized message. However, the Pino logger's serializer already strips PRIVATE_KEY/SECRET keys. The URL appears under the generic `err` field. For the `err` property, Pino serializes Error.message and Error.stack. The URL may appear in the stack trace of a fetch TypeError. A pragmatic approach: just mask when we log, and don't include the raw URL in the log properties.

## Common Pitfalls

### Pitfall 1: Partial sell cleanup
The BUG 6 fix must NOT clean up Maps for partial sells. If highWatermarks or tierIndices are deleted after a partial sell, the next tier evaluation will reset the tier index to 0 (re-triggering tier 1) and lose the high watermark.

### Pitfall 2: Deep merge array replacement
The BUG 3 fix must treat arrays (like `tieredTp`) as atomic replacements, not merge them element-by-element. `!Array.isArray()` guard is essential.

### Pitfall 3: Jito polling and SellLadder timeout interaction
The BUG 1 fix must NOT add its own timeout -- the SellLadder's Promise.race is the authoritative timeout. Adding a second timeout creates ambiguity about which fires first and may mask the actual bundle status.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run --reporter=verbose` |

### Bug-to-Test Map

| Bug | Existing Test File | Test Update Needed |
|-----|-------------------|-------------------|
| BUG 1 | jito-seller.test.ts | Add test for polling loop (mock fetch to return Pending then Landed) |
| BUG 2 | recovery-manager.test.ts | Update assertion on sellingCompleted count for RPC failure case |
| BUG 3 | (none for patchRuntimeConfig) | Add unit test for deep merge |
| BUG 4 | sell-ladder.test.ts | Verify SELL_TRIGGERED not emitted on zero-balance path |
| BUG 5 | sell-ladder.test.ts | Verify runningTotal in SELL_PARTIAL event is not double-counted |
| BUG 6 | position-manager.test.ts | Verify Maps cleaned up after full sell, preserved after partial |
| S1 | tier3-creator.test.ts | Verify API key not in logged output on fetch error |

## Sources

### Primary (HIGH confidence)
- Source code: jito-seller.ts, recovery-manager.ts, trading.ts, sell-ladder.ts, position-manager.ts, tier3-creator.ts, rpc-manager.ts, logger.ts
- Existing test files for all affected modules
- BUGS.md audit findings with line-level references

### Secondary (MEDIUM confidence)
- [Jito Labs Documentation](https://docs.jito.wtf/) -- polling best practices
- [QuickNode getBundleStatuses reference](https://www.quicknode.com/docs/solana/getBundleStatuses) -- API response format
- [Jito gitbook API reference](https://jito-labs.gitbook.io/mev/searcher-resources/json-rpc-api-reference/bundles/getbundlestatuses) -- bundle status values

## Metadata

**Confidence breakdown:**
- BUG 1 (Jito polling): HIGH -- Jito docs confirm polling pattern; SellLadder timeout design documented in code comments
- BUG 2 (recovery counter): HIGH -- obvious wrong increment, one-line deletion
- BUG 3 (deep merge): HIGH -- TradingConfig schema fully inspected, nesting is exactly 2 levels
- BUG 4 (orphaned event): HIGH -- straightforward statement reorder
- BUG 5 (double-count): HIGH -- trace through addSellPrice -> getTradeByMint confirms the double-add
- BUG 6 (Map cleanup): HIGH -- .finally() already exists, just add 3 delete calls with partial guard
- S1 (API key masking): HIGH -- exact regex pattern already exists in rpc-manager.ts

**Research date:** 2026-03-22
**Valid until:** No expiry -- these are codebase-specific findings, not library version dependent
