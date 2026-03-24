# Phase 15: Live Config Hot-Reload Fix - Research

**Researched:** 2026-03-22
**Domain:** Runtime config hot-reload / refactoring static config snapshots to dynamic reads
**Confidence:** HIGH

## Summary

Phase 15 is a focused refactoring phase -- no new libraries, no new infrastructure, no external dependencies. The goal is to replace static `this.config.X` and `this.tradingConfig.X` reads with `getRuntimeConfig().X` calls at every evaluation-time code path in SafetyPipeline, PositionManager, ExecutionEngine, SellLadder, and index.ts. The runtime config system (`getRuntimeConfig()` / `patchRuntimeConfig()`) already exists and is proven in production for the `dryRun` toggle (Phase 12). This phase extends that pattern uniformly.

The codebase is in excellent shape for this refactor: the `getRuntimeConfig()` function already exists in `src/config/trading.ts`, `patchRuntimeConfig()` handles 2-level deep merging, and the `ConfigPatchSchema` in the config route already validates most patchable fields. The proven pattern (`getRuntimeConfig().dryRun` in broadcaster.ts and jito-seller.ts) is the exact template to replicate.

The only new infrastructure is a `CONFIG_CHANGED` event type added to the `BotEvent` system so the dashboard Live Feed shows a confirmation card when settings are updated.

**Primary recommendation:** Systematically replace `this.config.*` / `this.tradingConfig.*` reads with `getRuntimeConfig().*` at each evaluation call site. Constructor signatures remain unchanged. Add CONFIG_CHANGED event emission in the config route POST handler.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** All patchable fields become hot-reloadable -- minSafetyScore, buyAmountSol, maxConcurrentPositions, safety.weights.*, positionManagement.* (stopLossPct, trailingStopPct, tieredTp, maxHoldTimeMs, pollIntervalMs), execution slippage. Full DASH-04/DASH-05 coverage.
- **D-02:** pollIntervalMs changes take effect on the next natural cycle (no timer restart). After the current tick completes, the next `setTimeout` uses the new interval value.
- **D-03:** Config changes apply to all open positions on their next evaluation tick. "Forward-only" means forward from the next evaluation, not forward from the next trade.
- **D-04:** Tiered TP changes re-evaluate remaining tiers against new config. Already-sold tiers are tracked by the trade record; PositionManager reads fresh tier config and checks which new tiers haven't been hit yet.
- **D-05:** Direct `getRuntimeConfig()` calls at each evaluation point -- extends the proven `dryRun` pattern from Phase 12. Replace `this.config.X` reads with `getRuntimeConfig().X` at safety check, position tick, and buy attempt call sites.
- **D-06:** Constructor signatures stay as-is. Constructors still accept `TradingConfig` for one-time setup values (e.g., SafetyCache TTL, blocklist path). Only evaluation-time reads switch to `getRuntimeConfig()`.
- **D-07:** Poll-based / read on each tick. No event-based notification system. Each module calls `getRuntimeConfig()` on every evaluation cycle. Zero new infrastructure.
- **D-08:** Emit a `CONFIG_CHANGED` BotEvent via `botEventBus` when `patchRuntimeConfig()` succeeds. Event includes the changed fields. Appears in the Live Feed so operator sees confirmation (e.g., "Settings updated: stopLossPct 15->20").

### Claude's Discretion
- Exact CONFIG_CHANGED event payload shape and feed card rendering
- Whether to log config changes via pino in addition to the SSE event
- Test strategy for verifying hot-reload (unit mocking of getRuntimeConfig vs integration)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DASH-04 | Web dashboard provides UI to adjust safety filter thresholds without bot restart | SafetyPipeline.evaluate() reads `getRuntimeConfig().minSafetyScore`, `.safety.weights`, `.safety.tier2TimeoutMs`, `.safety.tier3TimeoutMs` at evaluation time; ConfigPatchSchema already accepts safety.weights |
| DASH-05 | Web dashboard provides UI to adjust buy amount and position limits without bot restart | ExecutionEngine.buy() reads `getRuntimeConfig().buyAmountSol`; index.ts token handler reads `getRuntimeConfig().maxConcurrentPositions`; PositionManager reads all positionManagement fields dynamically |
</phase_requirements>

## Architecture Patterns

### Current Static Reads to Replace

Each module stores `this.config` or `this.tradingConfig` (a `TradingConfig` reference assigned in the constructor) and reads it throughout its methods. This creates a snapshot at construction time that never updates.

**SafetyPipeline (`src/safety/safety-pipeline.ts`)**
- `this.tradingConfig.minSafetyScore` -- used in threshold comparison (line 88, 130, 154, 163, 182)
- `this.tradingConfig.safety.tier2TimeoutMs` -- AbortSignal timeout (line 100)
- `this.tradingConfig.safety.tier3TimeoutMs` -- AbortSignal timeout (line 101)
- `this.tradingConfig.safety.weights` -- aggregate score weights (line 142)
- `this.tradingConfig.safety.holder` -- passed to checkHolderConcentration (line 105)
- Constructor-only (keep static): `this.tradingConfig.safety.cacheTtlMs`, `this.tradingConfig.safety.blocklistPath`

**PositionManager (`src/position/position-manager.ts`)**
- `this.config.positionManagement.pollIntervalMs` -- setTimeout interval (line 124-125)
- `this.config.positionManagement.stopLossPct` -- stop-loss threshold (line 260, 331)
- `this.config.positionManagement.trailingStopPct` -- trailing stop percentage (line 260, 302-303)
- `this.config.positionManagement.tieredTp` -- tier config array (line 260, 264)
- `this.config.positionManagement.maxHoldTimeMs` -- max hold time (line 358)
- `this.config.maxConcurrentPositions` -- used only in start() rate-limit warning (line 79) -- keep static (one-time log)

**ExecutionEngine (`src/execution/execution-engine.ts`)**
- `this.config.buyAmountSol` -- buy amount (lines 62, 74-78, 85, 88, 92)
- `this.config.execution.buy.slippageBps` -- NOT directly read in execution-engine.ts; passed via `this.config` to `pumpPortalBuy()` and `jupiterBuy()` which read `config.execution.buy`
- Note: `getRuntimeConfig().dryRun` already used (line 62, 70, 92, 104, 112) -- proven pattern

**SellLadder (`src/execution/sell/sell-ladder.ts`)**
- `this.config.execution.sell` -- destructured at top of sell() method (line 65)
- Note: `getRuntimeConfig().dryRun` already used in multiple emit calls -- proven pattern

**index.ts (`src/index.ts`)**
- `tradingConfig.maxConcurrentPositions` -- position limit guard (line 168)
- Note: `getRuntimeConfig().dryRun` and `getRuntimeConfig().buyAmountSol` already used in some event emissions (line 176, 185)

### Proven Pattern (Reference Implementation)

```typescript
// Source: src/execution/broadcaster.ts line 60
// This is the exact pattern to replicate everywhere:
if (getRuntimeConfig().dryRun) {
  // ... use the live value
}
```

### Refactoring Pattern for Each Module

**Step 1:** Add `import { getRuntimeConfig } from '../config/trading.js';` (if not already imported)

**Step 2:** In each evaluation-time method, replace `this.config.X` or `this.tradingConfig.X` with `getRuntimeConfig().X`:

```typescript
// BEFORE (static snapshot):
const { tieredTp, stopLossPct, trailingStopPct } = this.config.positionManagement;

// AFTER (live read):
const { tieredTp, stopLossPct, trailingStopPct } = getRuntimeConfig().positionManagement;
```

**Step 3:** Keep constructor uses of config for one-time values (cache TTL, blocklist path, rate-limit warnings at start).

### CONFIG_CHANGED Event Pattern

```typescript
// In src/dashboard/routes/config.ts, after patchRuntimeConfig() succeeds:
import { botEventBus } from '../../dashboard/bot-event-bus.js';

// Inside POST handler, after successful patch:
const changedFields = Object.keys(result.data);
botEventBus.emit('event', {
  type: 'CONFIG_CHANGED',
  mint: '',  // Not trade-specific
  ts: Date.now(),
  detail: `Settings updated: ${changedFields.join(', ')}`,
});
```

### Anti-Patterns to Avoid
- **Caching getRuntimeConfig() result across ticks:** Each tick must call `getRuntimeConfig()` fresh. Do not destructure into class fields or cache between evaluation cycles.
- **Restarting timers on config change:** Per D-02, `pollIntervalMs` changes take effect on next natural `setTimeout` call -- do NOT add any timer-restart logic.
- **Event-based config propagation:** Per D-07, no pub/sub for config changes. Direct `getRuntimeConfig()` reads on each tick.
- **Breaking constructor signatures:** Per D-06, constructors stay as-is. The `config` parameter is still needed for one-time setup values.

## Specific Changes Inventory

### Module: SafetyPipeline

| Current Code | Line(s) | Replace With |
|-------------|---------|--------------|
| `this.tradingConfig.minSafetyScore` | 88, 130, 154, 163, 182 | `getRuntimeConfig().minSafetyScore` |
| `this.tradingConfig.safety.tier2TimeoutMs` | 100 | `getRuntimeConfig().safety.tier2TimeoutMs` |
| `this.tradingConfig.safety.tier3TimeoutMs` | 101 | `getRuntimeConfig().safety.tier3TimeoutMs` |
| `this.tradingConfig.safety.weights` | 142 | `getRuntimeConfig().safety.weights` |
| `this.tradingConfig.safety.holder` | 105 | `getRuntimeConfig().safety.holder` |
| Keep static: `cacheTtlMs` (constructor), `blocklistPath` (constructor) | 46-48 | No change |

Import needed: `import { getRuntimeConfig } from '../config/trading.js';`

### Module: PositionManager

| Current Code | Line(s) | Replace With |
|-------------|---------|--------------|
| `this.config.positionManagement.pollIntervalMs` | 124-125 | `getRuntimeConfig().positionManagement.pollIntervalMs` |
| `this.config.positionManagement` destructure in evaluatePosition | 260 | `getRuntimeConfig().positionManagement` |
| `this.config.positionManagement.maxHoldTimeMs` | 358 | (covered by above destructure) |
| Keep static: `this.config.maxConcurrentPositions` in start() log | 79-80 | No change (one-time log) |
| Keep static: `this.config.positionManagement.pollIntervalMs` in start() log | 92 | No change (one-time log) |

Import needed: `import { getRuntimeConfig } from '../config/trading.js';` (add alongside existing type import)

### Module: ExecutionEngine

| Current Code | Line(s) | Replace With |
|-------------|---------|--------------|
| `this.config.buyAmountSol` (in buy()) | 62, 74-78, 85, 88, 92 | `getRuntimeConfig().buyAmountSol` |
| `this.config` passed to `pumpPortalBuy()` / `jupiterBuy()` | 65-66 | `getRuntimeConfig()` (passes live config to buyer functions) |

Import: already has `import { getRuntimeConfig } from '../config/trading.js';`

### Module: SellLadder

| Current Code | Line(s) | Replace With |
|-------------|---------|--------------|
| `this.config.execution.sell` destructure | 65 | `getRuntimeConfig().execution.sell` |
| `this.config` passed to `standardSell()`, `jitoSell()`, `chunkedSell()`, `pumpPortalSell()` | 117-168 | `getRuntimeConfig()` (live config to seller functions) |

Import: already has `import { getRuntimeConfig } from '../../config/trading.js';`

### Module: index.ts

| Current Code | Line(s) | Replace With |
|-------------|---------|--------------|
| `tradingConfig.maxConcurrentPositions` | 168 | `getRuntimeConfig().maxConcurrentPositions` |

Import: already has `import { getRuntimeConfig } from './config/trading.js';`

### Config Route: config.ts

| Addition | Location |
|----------|----------|
| Import `botEventBus` | Top of file |
| Emit CONFIG_CHANGED event | After `patchRuntimeConfig()` succeeds in POST handler |

### Bot Event Bus: bot-event-bus.ts

| Addition |
|----------|
| Add `'CONFIG_CHANGED'` to `BotEventType` union |

### Dashboard Frontend

| File | Change |
|------|--------|
| `dashboard/src/store/feed.ts` | Add `'CONFIG_CHANGED'` to eventTypes array for SSE listener |
| `dashboard/src/components/FeedCard.tsx` | Add CONFIG_CHANGED to BADGE_COLORS and EVENT_LABELS |

### ConfigPatchSchema Extensions

D-01 specifies `pollIntervalMs` and execution slippage as patchable. Currently:
- `positionManagement.pollIntervalMs` is NOT in ConfigPatchSchema -- must add
- `execution.buy.slippageBps` is NOT directly in ConfigPatchSchema (there is a top-level `maxSlippageBps` but that is a different field) -- the buy functions read from `config.execution.buy.slippageBps`, not from `config.maxSlippageBps`

Adding to ConfigPatchSchema:
```typescript
positionManagement: z.object({
  // ... existing fields ...
  pollIntervalMs: z.number().int().positive().optional(),  // ADD
}).optional(),
execution: z.object({                                       // ADD section
  buy: z.object({
    slippageBps: z.number().int().min(50).max(4900).optional(),
  }).optional(),
}).optional(),
```

The Settings.tsx frontend component should also add UI controls for `pollIntervalMs` and buy slippage.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Config change notification | Event bus for config propagation | Direct `getRuntimeConfig()` reads on each tick | Zero infrastructure; proven pattern; per D-07 locked decision |
| Timer restart on poll interval change | Timer management system | Next `setTimeout` naturally picks up new value | Per D-02 locked decision; simpler and race-free |
| Deep comparison for changed fields | Custom deep-diff library | `Object.keys(result.data)` on the validated patch | Patch schema already constrains what can change; top-level keys sufficient for display |

## Common Pitfalls

### Pitfall 1: Destructuring Config at Class Level
**What goes wrong:** Destructuring `getRuntimeConfig()` into a variable at the top of a class method and then reusing that variable across an async boundary (e.g., after an `await`) could miss a config change that happened during the await.
**Why it happens:** `const cfg = getRuntimeConfig()` captures a reference to the current config object. If `patchRuntimeConfig()` replaces the object between awaits, `cfg` is stale.
**How to avoid:** This is actually fine in practice because `patchRuntimeConfig()` replaces `_runtimeConfig` atomically. A single tick that destructured before the patch uses the old values consistently for that tick. Per D-03, changes apply on the NEXT tick, not mid-tick. Destructuring at the top of each evaluation method is the correct pattern.
**Warning signs:** If you see code that calls `getRuntimeConfig()` multiple times within one tick, it could get inconsistent values if a patch happens between calls. Prefer one destructure per tick.

### Pitfall 2: Forgetting to Update ConfigPatchSchema
**What goes wrong:** Making a field hot-reloadable in the backend (reading from `getRuntimeConfig()`) but not adding it to ConfigPatchSchema means the dashboard can't actually change that field.
**How to avoid:** Every field listed in D-01 must be patchable via ConfigPatchSchema AND readable via `getRuntimeConfig()`.

### Pitfall 3: Stale Constructor Config for One-Time Values
**What goes wrong:** Accidentally switching a one-time setup value (like SafetyCache TTL) to `getRuntimeConfig()` reads. The cache was constructed with a specific TTL; changing it at runtime would have no effect since the cache object is already created.
**How to avoid:** Per D-06, constructor-time values stay static. Only evaluation-time reads switch. Identify which values are one-time setup (cache TTL, blocklist path) vs evaluation-time (thresholds, weights, amounts).

### Pitfall 4: Breaking Existing Tests
**What goes wrong:** Tests that mock the entire `trading.js` module (like execution-engine.test.ts does with `vi.mock('../config/trading.js')`) will need their mock to include both `getRuntimeConfig` and the other exports. Tests that construct modules with a config object may need their `getRuntimeConfig` mock to return matching values.
**How to avoid:** Follow the existing test pattern from execution-engine.test.ts which already mocks `getRuntimeConfig`. For modules that now call `getRuntimeConfig()` internally, the test must mock it to return the expected config.

### Pitfall 5: CONFIG_CHANGED Event Missing mint Field
**What goes wrong:** `BotEvent` requires a `mint` field. CONFIG_CHANGED is not trade-specific, so `mint` must be empty string or a sentinel value.
**How to avoid:** Use `mint: ''` (empty string) for CONFIG_CHANGED events. The FeedCard component already handles display via `event.mint` which will show as empty -- the detail field carries the meaningful info.

### Pitfall 6: SafetyPipeline Test Mocking
**What goes wrong:** SafetyPipeline tests currently construct the pipeline with a full `TradingConfig` and read from `this.tradingConfig`. After the refactor, evaluate() reads from `getRuntimeConfig()`. Tests must mock `getRuntimeConfig` to return the expected config values.
**How to avoid:** Add `vi.mock('../config/trading.js')` in safety-pipeline.test.ts with a `getRuntimeConfig` mock, similar to execution-engine.test.ts pattern.

## Code Examples

### Example 1: SafetyPipeline evaluate() refactor

```typescript
// Source: Current code pattern + CONTEXT.md D-05
async evaluate(event: TokenEvent): Promise<SafetyResult> {
  const cached = this.cache.get(event.mint);
  if (cached !== null) return cached;

  const startTime = Date.now();
  // Read LIVE config for this evaluation cycle
  const cfg = getRuntimeConfig();

  try {
    // Tier 1 unchanged (no config reads)
    const [authResults, sellRouteResult] = await Promise.all([
      checkAuthorities(event.mint, this.connection),
      checkSellRoute(event.mint, undefined, event.source),
    ]);
    // ...

    // Tier 2+3: use live timeouts
    const tier2Signal = AbortSignal.timeout(cfg.safety.tier2TimeoutMs);
    const tier3Signal = AbortSignal.timeout(cfg.safety.tier3TimeoutMs);

    // Use live holder config
    const [rugCheckSettled, holderSettled, creatorSettled] = await Promise.allSettled([
      checkRugCheck(event.mint, this.env.RUGCHECK_API_KEY, tier2Signal),
      checkHolderConcentration(event.mint, this.connection, cfg.safety.holder, detectedProgramId, event.source),
      checkCreatorHistory(event.creator, this.env.HELIUS_API_KEY, this.blocklist, tier3Signal),
    ]);
    // ...

    // Use live weights
    const weights = cfg.safety.weights;
    // ...

    // Use live threshold
    if (aggregateScore < cfg.minSafetyScore) {
      // reject
    }
  }
}
```

### Example 2: PositionManager scheduleTick() with live pollIntervalMs

```typescript
// Source: Current code pattern + CONTEXT.md D-02
private scheduleTick(): void {
  const cooldownMs = this.jupiterClient.cooldownRemainingMs();
  // Read LIVE pollIntervalMs -- next tick picks up any change
  const pollIntervalMs = getRuntimeConfig().positionManagement.pollIntervalMs;
  const intervalMs = cooldownMs > 0
    ? cooldownMs + pollIntervalMs
    : pollIntervalMs;

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

### Example 3: CONFIG_CHANGED event emission

```typescript
// Source: Extending current config.ts POST handler
// In POST /api/config handler, after successful patch:
const changedKeys = Object.keys(result.data);
botEventBus.emit('event', {
  type: 'CONFIG_CHANGED',
  mint: '',
  ts: Date.now(),
  detail: `Settings updated: ${changedKeys.join(', ')}`,
});
```

### Example 4: index.ts maxConcurrentPositions guard

```typescript
// Source: Current index.ts line 168
// BEFORE:
if (activePositions >= tradingConfig.maxConcurrentPositions) {

// AFTER:
if (activePositions >= getRuntimeConfig().maxConcurrentPositions) {
```

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (latest, via npx) |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run` |
| Full suite command | `npx vitest run --reporter=verbose` |

### Current Test Status
- 26 test files, 314 tests, all passing
- Relevant existing tests: `trading.test.ts` (patchRuntimeConfig), `safety-pipeline.test.ts`, `position-manager.test.ts`, `execution-engine.test.ts`, `sell-ladder.test.ts`

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DASH-04 | SafetyPipeline uses live minSafetyScore, weights, timeouts | unit | `npx vitest run src/safety/safety-pipeline.test.ts -x` | Exists (needs update) |
| DASH-04 | Config route emits CONFIG_CHANGED event | unit | `npx vitest run src/dashboard/routes/config.test.ts -x` | Wave 0 |
| DASH-05 | ExecutionEngine uses live buyAmountSol | unit | `npx vitest run src/execution/execution-engine.test.ts -x` | Exists (needs update) |
| DASH-05 | PositionManager uses live positionManagement config | unit | `npx vitest run src/position/position-manager.test.ts -x` | Exists (needs update) |
| DASH-05 | index.ts maxConcurrentPositions uses live config | integration | Manual verification (index.ts is the entrypoint) | N/A (manual) |

### Sampling Rate
- **Per task commit:** `npx vitest run`
- **Per wave merge:** `npx vitest run --reporter=verbose`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] Existing test files need mock updates for `getRuntimeConfig` where not already mocked
- [ ] `src/dashboard/routes/config.test.ts` -- covers CONFIG_CHANGED event emission (new test file)
- [ ] safety-pipeline.test.ts needs `vi.mock('../config/trading.js')` with `getRuntimeConfig` mock

## Sources

### Primary (HIGH confidence)
- Direct source code analysis of all 7 canonical files listed in CONTEXT.md
- Existing `getRuntimeConfig()` pattern verified in `broadcaster.ts` (line 60), `jito-seller.ts` (line 20)
- `patchRuntimeConfig()` deep merge behavior verified in `trading.ts` (lines 134-178) and `trading.test.ts`
- `ConfigPatchSchema` field coverage verified in `config.ts` (lines 7-31)
- `BotEvent` type system verified in `bot-event-bus.ts`
- Dashboard frontend SSE listener in `feed.ts` and `FeedCard.tsx` verified
- Test infrastructure verified: 26 files, 314 tests passing, vitest framework

### Secondary (MEDIUM confidence)
- None needed -- this is entirely an internal refactoring phase with no external dependencies

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new libraries needed, pure refactoring of existing code
- Architecture: HIGH - Proven pattern (dryRun) already exists and works
- Pitfalls: HIGH - Identified from direct source analysis and established project conventions

**Research date:** 2026-03-22
**Valid until:** Indefinite -- internal refactoring, not dependent on external APIs or versions
