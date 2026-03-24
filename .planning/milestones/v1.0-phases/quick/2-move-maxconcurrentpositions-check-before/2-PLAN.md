---
phase: quick-2
plan: 01
type: execute
wave: 1
depends_on: []
files_modified: [src/index.ts]
autonomous: true
requirements: [QUICK-2]

must_haves:
  truths:
    - "maxConcurrentPositions check runs before safetyPipeline.evaluate()"
    - "Tokens detected at capacity are rejected without any RPC/API calls"
    - "All existing behavior (dedup, BUYING record, buy execution) is preserved"
  artifacts:
    - path: "src/index.ts"
      provides: "Reordered token handler with capacity check before safety pipeline"
      contains: "maxConcurrentPositions"
  key_links:
    - from: "detectionManager 'token' handler"
      to: "tradeStore.getMonitoringTrades()"
      via: "synchronous check before safetyPipeline.evaluate()"
      pattern: "getMonitoringTrades.*maxConcurrentPositions.*safetyPipeline"
---

<objective>
Move the maxConcurrentPositions guard in src/index.ts to execute BEFORE the safety pipeline evaluation, eliminating ~25 wasteful RPC/API calls per token when the bot is already at capacity.

Purpose: Reduce unnecessary RPC load and Jupiter 429 rate limit risk when at max positions.
Output: Updated src/index.ts with reordered token handler pipeline.
</objective>

<execution_context>
@C:/Users/jackc/.claude/get-shit-done/workflows/execute-plan.md
@C:/Users/jackc/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/index.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Move maxConcurrentPositions check before safety pipeline</name>
  <files>src/index.ts</files>
  <action>
In the `detectionManager.on('token', ...)` handler (line 164), reorder the pipeline steps so the maxConcurrentPositions check runs BEFORE `safetyPipeline.evaluate(event)`.

Current order inside the handler:
1. `safetyPipeline.evaluate(event)` -- expensive (~25 RPC/API calls)
2. `if (result.pass)` block containing:
   a. botEventBus TOKEN_DETECTED emit
   b. maxConcurrentPositions check (reject if at capacity)
   c. isActive duplicate guard
   d. createBuyingRecord
   e. buy execution

New order:
1. maxConcurrentPositions check (synchronous, zero cost) -- reject early if at capacity
2. `safetyPipeline.evaluate(event)` -- only runs if capacity available
3. `if (result.pass)` block containing:
   a. botEventBus TOKEN_DETECTED emit
   b. isActive duplicate guard
   c. createBuyingRecord
   d. buy execution

Specific changes to the handler body:

```typescript
detectionManager.on('token', async (event) => {
  try {
    // POS-06: Enforce max concurrent position limit (before safety pipeline to avoid wasted RPC calls)
    const activePositions = tradeStore.getMonitoringTrades().length;
    if (activePositions >= tradingConfig.maxConcurrentPositions) {
      log.info({ mint: event.mint, activePositions, limit: tradingConfig.maxConcurrentPositions },
        'Max concurrent positions reached — skipping safety checks');
      return;
    }

    const result = await safetyPipeline.evaluate(event);
    if (result.pass) {
      botEventBus.emit('event', { type: 'TOKEN_DETECTED', mint: event.mint, ts: Date.now(), detail: `from ${event.source}`, isDryRun: getRuntimeConfig().dryRun });
      // Duplicate guard: reject if a non-terminal trade already exists for this mint
      if (tradeStore.isActive(event.mint)) {
        log.debug({ mint: event.mint }, 'Duplicate buy blocked by active-mints guard');
        return;
      }
      // Write-ahead: record BUYING state before any on-chain action (PER-02)
      tradeStore.createBuyingRecord(event.mint, event.source, result.programId, getRuntimeConfig().dryRun);
      // Execute buy
      void executionEngine.buy(event);
    }
  } catch (err) {
    log.error({ err, mint: event.mint }, 'Safety pipeline error');
  }
});
```

Key details:
- The log message changes from "buy rejected" to "skipping safety checks" to reflect the new semantics (we skip the entire pipeline, not just the buy).
- The `activePositions` variable and the `tradingConfig.maxConcurrentPositions` comparison are identical -- only the placement changes.
- The TOKEN_DETECTED botEventBus emit stays inside `if (result.pass)` -- it should only fire for tokens that pass safety, not all detected tokens.
- The isActive duplicate guard stays inside `if (result.pass)` -- it only matters for tokens that would actually be bought.
- No other lines in the file change.
  </action>
  <verify>
    <automated>rtk vitest run</automated>
  </verify>
  <done>
- maxConcurrentPositions check is the first thing inside the token handler (before safetyPipeline.evaluate)
- All 235+ existing tests pass
- Log message updated to reflect "skipping safety checks" semantics
- No other behavioral changes to the pipeline
  </done>
</task>

</tasks>

<verification>
- Read src/index.ts and confirm maxConcurrentPositions check appears before safetyPipeline.evaluate() call
- Run full test suite: `rtk vitest run` -- all tests pass
- Run TypeScript check: `rtk tsc --noEmit` -- no type errors
</verification>

<success_criteria>
- The token handler in src/index.ts checks position capacity before invoking safetyPipeline.evaluate()
- When at max capacity, tokens are rejected immediately with zero RPC/API calls
- All existing tests continue to pass
- TypeScript compiles without errors
</success_criteria>

<output>
After completion, create `.planning/quick/2-move-maxconcurrentpositions-check-before/2-SUMMARY.md`
</output>
