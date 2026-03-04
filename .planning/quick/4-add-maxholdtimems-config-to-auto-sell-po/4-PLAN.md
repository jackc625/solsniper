---
phase: quick-4
plan: 1
type: execute
wave: 1
depends_on: []
files_modified:
  - src/config/trading.ts
  - config.jsonc
  - src/position/position-manager.ts
  - src/position/position-manager.test.ts
  - src/dashboard/routes/config.ts
autonomous: true
requirements: [QUICK-4]

must_haves:
  truths:
    - "Positions held longer than maxHoldTimeMs are auto-sold"
    - "maxHoldTimeMs defaults to 120000 (2 minutes)"
    - "maxHoldTimeMs=0 disables the max hold time check"
    - "Max hold time check fires sell (real) or transitions to COMPLETED (dry-run)"
    - "Max hold time check has lowest priority (after TP, trailing stop, SL)"
  artifacts:
    - path: "src/config/trading.ts"
      provides: "maxHoldTimeMs field in PositionManagementConfigSchema"
      contains: "maxHoldTimeMs"
    - path: "src/position/position-manager.ts"
      provides: "Max hold time exit trigger in evaluatePosition()"
      contains: "maxHoldTimeMs"
    - path: "src/position/position-manager.test.ts"
      provides: "Tests for max hold time trigger"
      contains: "max hold time"
    - path: "config.jsonc"
      provides: "maxHoldTimeMs config entry with comment"
      contains: "maxHoldTimeMs"
  key_links:
    - from: "src/position/position-manager.ts"
      to: "src/config/trading.ts"
      via: "this.config.positionManagement.maxHoldTimeMs"
      pattern: "maxHoldTimeMs"
---

<objective>
Add a `maxHoldTimeMs` configuration option to PositionManager that auto-sells positions held longer than N milliseconds, preventing indefinite bag-holding on sideways tokens that never trigger TP or SL.

Purpose: Tokens that trade sideways never trigger existing exit conditions (TP, SL, trailing stop). This creates stuck positions that tie up capital. A max hold time acts as a final safety net.
Output: Working max hold time exit trigger with 2-minute default, tests, config, and dashboard patchability.
</objective>

<execution_context>
@C:/Users/jackc/.claude/get-shit-done/workflows/execute-plan.md
@C:/Users/jackc/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/config/trading.ts
@src/position/position-manager.ts
@src/position/position-manager.test.ts
@config.jsonc
@src/dashboard/routes/config.ts

<interfaces>
<!-- Key types and contracts the executor needs -->

From src/config/trading.ts:
```typescript
const PositionManagementConfigSchema = z.object({
  pollIntervalMs: z.number().int().positive().default(5000),
  stopLossPct: z.number().negative().default(-50),
  tieredTp: z.array(TierSchema).default([...]),
  trailingStopPct: z.number().min(0).max(100).default(0),
});
export type PositionManagementConfig = z.infer<typeof PositionManagementConfigSchema>;
```

From src/types/index.ts:
```typescript
export interface Trade {
  id: number;
  mint: string;
  state: TradeState;
  createdAt: number;      // Unix ms (INTEGER column)
  // ...
  dryRun?: boolean;
}
```

From src/position/position-manager.ts evaluatePosition():
- Exit evaluation order: tiered TP > trailing stop > stop-loss
- Each trigger: if dryRun -> transition MONITORING->COMPLETED with DRY_RUN_TRIGGER message, else -> fireSell()
- trade.createdAt is Unix ms timestamp

From src/dashboard/routes/config.ts:
```typescript
const ConfigPatchSchema = z.object({
  // ...
  positionManagement: z.object({
    stopLossPct: z.number().negative().optional(),
    trailingStopPct: z.number().min(0).max(100).optional(),
    tieredTp: z.array(...).optional(),
  }).optional(),
});
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add maxHoldTimeMs to config schema and config.jsonc</name>
  <files>src/config/trading.ts, config.jsonc, src/dashboard/routes/config.ts</files>
  <behavior>
    - maxHoldTimeMs parses from config with default 120000
    - maxHoldTimeMs=0 is valid (means disabled)
    - maxHoldTimeMs is available via TradingConfig type at positionManagement.maxHoldTimeMs
    - Dashboard ConfigPatchSchema accepts optional maxHoldTimeMs for runtime patching
  </behavior>
  <action>
1. In `src/config/trading.ts`, add `maxHoldTimeMs` to `PositionManagementConfigSchema`:
   ```
   maxHoldTimeMs: z.number().int().min(0).default(120000), // 0 = disabled, default 2 min
   ```
   Place it after `trailingStopPct`.

2. In `config.jsonc`, add `maxHoldTimeMs` to the `positionManagement` block with an inline comment:
   ```
   // Maximum time (ms) to hold a position before auto-selling. 0 = disabled.
   // Default: 120000 (2 minutes). Prevents bag-holding sideways tokens.
   "maxHoldTimeMs": 120000
   ```
   Place it after the `trailingStopPct` entry.

3. In `src/dashboard/routes/config.ts`, add `maxHoldTimeMs` to the `positionManagement` object in `ConfigPatchSchema`:
   ```
   maxHoldTimeMs: z.number().int().min(0).optional(),
   ```

4. In `src/position/position-manager.ts`, add maxHoldTimeMs to the start() log info object so operators can see the configured value at startup.
  </action>
  <verify>
    <automated>cd C:/Users/jackc/Code/solsniper && rtk vitest run src/position/position-manager.test.ts</automated>
  </verify>
  <done>maxHoldTimeMs field exists in PositionManagementConfigSchema with default 120000, config.jsonc has the entry with comment, dashboard route accepts it for runtime patching, start() logs it. All existing tests still pass.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Implement max hold time exit trigger in evaluatePosition() with tests</name>
  <files>src/position/position-manager.ts, src/position/position-manager.test.ts</files>
  <behavior>
    - Test 1: Position held longer than maxHoldTimeMs triggers fireSell (full token amount)
    - Test 2: Position held shorter than maxHoldTimeMs does NOT trigger sell
    - Test 3: maxHoldTimeMs=0 disables the check entirely (no sell even if held forever)
    - Test 4: Dry-run trade held past maxHoldTimeMs transitions to COMPLETED with DRY_RUN_TRIGGER: MAX_HOLD_TIME message (no fireSell)
    - Test 5: Max hold time has lowest priority -- TP/trailing/SL trigger first if they match
  </behavior>
  <action>
1. In `src/position/position-manager.ts` `evaluatePosition()`, add a max hold time check AFTER the stop-loss block (lowest priority -- after all other exit evaluations). The check goes at the end of the method, after line 310 (the SL block's closing brace):

   ```typescript
   // --- Max hold time ---
   const { maxHoldTimeMs } = this.config.positionManagement;
   if (maxHoldTimeMs > 0) {
     const holdDurationMs = Date.now() - trade.createdAt;
     if (holdDurationMs >= maxHoldTimeMs) {
       log.info(
         {
           mint,
           holdDurationMs,
           maxHoldTimeMs,
           currentValueSol,
         },
         'PositionManager: max hold time exceeded',
       );
       if (trade.dryRun) {
         log.info(
           { dryRun: true, mint, trigger: 'MAX_HOLD_TIME', holdDurationMs, maxHoldTimeMs },
           '[DRY RUN] max hold time would have triggered',
         );
         this.tradeStore.transition(mint, 'MONITORING', 'COMPLETED', {
           errorMessage: `DRY_RUN_TRIGGER: MAX_HOLD_TIME`,
         });
         return;
       }
       this.fireSell(mint, tokenAmountRaw);
       return;
     }
   }
   ```

   Note: `tokenAmountRaw` (the full position bigint) is already in scope from the earlier conversion on ~line 184. The max hold time sells the ENTIRE position (not a fraction).

2. In `src/position/position-manager.test.ts`, add a new `describe('max hold time')` block with tests:

   - **Test 1 (fires sell):** Create trade with `createdAt: Date.now() - 130_000` (130s ago, > 120s default). Jupiter returns ratio=0.8 (no SL/TP). Config uses default `maxHoldTimeMs: 120000`. Assert `mockSellLadder.sell` called with full token amount.

   - **Test 2 (does not fire):** Create trade with `createdAt: Date.now() - 60_000` (60s ago, < 120s). Same ratio=0.8. Assert `mockSellLadder.sell` NOT called.

   - **Test 3 (disabled):** Create trade with `createdAt: Date.now() - 999_999_999` (very old). Config with `maxHoldTimeMs: 0`. Assert `mockSellLadder.sell` NOT called (and no other trigger fires since ratio=0.8).

   - **Test 4 (dry-run):** Create trade with `createdAt: Date.now() - 130_000`, `dryRun: true`. Assert `mockSellLadder.sell` NOT called, `mockTradeStore.transition` called with `DRY_RUN_TRIGGER: MAX_HOLD_TIME`.

   - **Test 5 (priority):** Create trade with `createdAt: Date.now() - 130_000` (exceeds maxHoldTimeMs). Jupiter returns ratio=0.3 (below SL -50% threshold). Assert SL fires (not max hold time) since SL is checked first. Verify `mockSellLadder.sell` called once (SL fires, max hold time never reached due to early return).

   Update the `makeConfig()` helper to include `maxHoldTimeMs` in the positionManagement defaults:
   ```typescript
   maxHoldTimeMs: 120000,
   ```
  </action>
  <verify>
    <automated>cd C:/Users/jackc/Code/solsniper && rtk vitest run src/position/position-manager.test.ts</automated>
  </verify>
  <done>Max hold time trigger fires sell when Date.now() - trade.createdAt >= maxHoldTimeMs, does not fire when disabled (0) or when hold time is under threshold, dry-run transitions to COMPLETED, and other triggers (SL/TP/trailing) take priority. All tests pass.</done>
</task>

</tasks>

<verification>
All position-manager tests pass including the new max hold time tests:
```bash
cd C:/Users/jackc/Code/solsniper && rtk vitest run src/position/position-manager.test.ts
```

TypeScript compiles without errors:
```bash
cd C:/Users/jackc/Code/solsniper && rtk tsc --noEmit
```
</verification>

<success_criteria>
- maxHoldTimeMs config field exists with default 120000 (2 minutes)
- maxHoldTimeMs=0 disables the feature
- Positions held longer than maxHoldTimeMs are auto-sold (full position)
- Dry-run trades transition to COMPLETED with DRY_RUN_TRIGGER: MAX_HOLD_TIME
- Max hold time is lowest priority exit (TP > trailing stop > SL > max hold time)
- Dashboard can patch maxHoldTimeMs at runtime
- All existing + new tests pass
- TypeScript compiles clean
</success_criteria>

<output>
After completion, create `.planning/quick/4-add-maxholdtimems-config-to-auto-sell-po/4-SUMMARY.md`
</output>
