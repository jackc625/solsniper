---
phase: quick-3
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/config/trading.ts
  - config.jsonc
  - src/safety/checks/tier2-holder.ts
  - src/safety/checks/tier2-holder.test.ts
autonomous: true
requirements: [QUICK-3]
must_haves:
  truths:
    - "Pump.fun tokens with fewer than minUserHolders are rejected (pass=false)"
    - "Pump.fun tokens with exactly minUserHolders or more pass the holder check as before"
    - "Non-pumpportal sources still hard-block on zero holders (unchanged behavior)"
    - "minUserHolders is configurable via config.jsonc under safety.holder"
  artifacts:
    - path: "src/config/trading.ts"
      provides: "minUserHolders field in HolderConfigSchema"
      contains: "minUserHolders"
    - path: "config.jsonc"
      provides: "minUserHolders config value"
      contains: "minUserHolders"
    - path: "src/safety/checks/tier2-holder.ts"
      provides: "Threshold check replacing zero-holder pass-through"
      contains: "config.minUserHolders"
    - path: "src/safety/checks/tier2-holder.test.ts"
      provides: "Tests for minUserHolders threshold behavior"
      contains: "minUserHolders"
  key_links:
    - from: "config.jsonc"
      to: "src/config/trading.ts"
      via: "Zod schema parse"
      pattern: "minUserHolders.*z\\.number"
    - from: "src/safety/safety-pipeline.ts"
      to: "src/safety/checks/tier2-holder.ts"
      via: "this.tradingConfig.safety.holder passed as config param"
      pattern: "tradingConfig\\.safety\\.holder"
---

<objective>
Add a configurable minimum user holder threshold for pump.fun tokens.

Purpose: Currently, pump.fun tokens with zero user holders pass the holder concentration check with a neutral score of 50. This should be configurable so the operator can require a minimum number of real holders before a token passes safety checks, reducing exposure to tokens still entirely in the bonding curve with no organic demand.

Output: Updated config schema, config file, holder check logic, and tests.
</objective>

<execution_context>
@C:/Users/jackc/.claude/get-shit-done/workflows/execute-plan.md
@C:/Users/jackc/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/config/trading.ts
@src/safety/checks/tier2-holder.ts
@src/safety/checks/tier2-holder.test.ts
@config.jsonc

<interfaces>
<!-- The HolderConfig interface consumed by checkHolderConcentration -->
From src/safety/checks/tier2-holder.ts:
```typescript
interface HolderConfig {
  top1SoftBlockThreshold: number;  // e.g. 0.25 = 25%
  top10SoftBlockThreshold: number; // e.g. 0.50 = 50%
}
```

From src/config/trading.ts (line 6-9):
```typescript
const HolderConfigSchema = z.object({
  top1SoftBlockThreshold: z.number().min(0).max(1).default(0.25),
  top10SoftBlockThreshold: z.number().min(0).max(1).default(0.50),
});
```

Call site in src/safety/safety-pipeline.ts (line 105):
```typescript
checkHolderConcentration(event.mint, this.connection, this.tradingConfig.safety.holder, detectedProgramId, event.source),
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add minUserHolders to config schema and config file</name>
  <files>src/config/trading.ts, config.jsonc</files>
  <behavior>
    - HolderConfigSchema accepts minUserHolders as optional integer with default 2
    - Existing config.jsonc without minUserHolders parses successfully (default applied)
    - Config with explicit minUserHolders value parses successfully
    - minUserHolders must be >= 0 (validated by Zod)
  </behavior>
  <action>
    1. In `src/config/trading.ts`, add `minUserHolders` to `HolderConfigSchema`:
       ```typescript
       const HolderConfigSchema = z.object({
         top1SoftBlockThreshold: z.number().min(0).max(1).default(0.25),
         top10SoftBlockThreshold: z.number().min(0).max(1).default(0.50),
         minUserHolders: z.number().int().min(0).default(2),
       });
       ```
    2. In `config.jsonc`, add `minUserHolders` to the `safety.holder` section with an inline comment:
       ```jsonc
       "holder": {
         "top1SoftBlockThreshold": 0.25,
         "top10SoftBlockThreshold": 0.50,
         // Minimum number of real user holders required for pumpportal tokens to pass.
         // Tokens with fewer user holders are rejected. 0 = accept tokens with no holders.
         "minUserHolders": 2
       }
       ```
    3. In `src/safety/checks/tier2-holder.ts`, add `minUserHolders` to the `HolderConfig` interface:
       ```typescript
       interface HolderConfig {
         top1SoftBlockThreshold: number;
         top10SoftBlockThreshold: number;
         minUserHolders: number;
       }
       ```
  </action>
  <verify>
    <automated>rtk vitest run src/config src/safety/checks/tier2-holder</automated>
  </verify>
  <done>HolderConfigSchema and HolderConfig interface both include minUserHolders, config.jsonc has the field with value 2, all existing tests still pass</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Replace zero-holder pass-through with minUserHolders threshold check</name>
  <files>src/safety/checks/tier2-holder.ts, src/safety/checks/tier2-holder.test.ts</files>
  <behavior>
    - pumpportal source with 0 user holders and minUserHolders=2: pass=false, score=0, detail mentions "below minimum"
    - pumpportal source with 1 user holder and minUserHolders=2: pass=false, score=0, detail mentions "below minimum"
    - pumpportal source with 2 user holders and minUserHolders=2: proceeds to normal concentration check (pass depends on concentration)
    - pumpportal source with 0 user holders and minUserHolders=0: pass=true, score=50 (original behavior preserved when threshold is 0)
    - non-pumpportal source with 0 user holders: still pass=false, score=0 (unchanged)
    - existing concentration tests continue to pass unchanged
  </behavior>
  <action>
    1. In `src/safety/checks/tier2-holder.ts`, replace the zero-holder pumpportal block (lines ~156-173) with a threshold check against `config.minUserHolders`:

       Replace:
       ```typescript
       if (userHolders.length === 0) {
         if (source === 'pumpportal') {
           return {
             pass: true,
             score: 50,
             source: 'holder_concentration',
             detail: 'insufficient data: no user holders found (bonding curve or system accounts only)',
           };
         }
         return {
           pass: false,
           score: 0,
           source: 'holder_concentration',
           detail: 'no user holders found (all system accounts)',
         };
       }
       ```

       With:
       ```typescript
       if (userHolders.length === 0) {
         if (source === 'pumpportal' && config.minUserHolders === 0) {
           // Config allows zero holders — pump.fun bonding curve phase tokens pass with neutral score
           return {
             pass: true,
             score: 50,
             source: 'holder_concentration',
             detail: 'insufficient data: no user holders found (bonding curve or system accounts only)',
           };
         }
         return {
           pass: false,
           score: 0,
           source: 'holder_concentration',
           detail: source === 'pumpportal'
             ? `below minimum holders: 0 < ${config.minUserHolders} required`
             : 'no user holders found (all system accounts)',
         };
       }

       if (source === 'pumpportal' && userHolders.length < config.minUserHolders) {
         return {
           pass: false,
           score: 0,
           source: 'holder_concentration',
           detail: `below minimum holders: ${userHolders.length} < ${config.minUserHolders} required`,
         };
       }
       ```

    2. In `src/safety/checks/tier2-holder.test.ts`:
       - Update `DEFAULT_CONFIG` to include `minUserHolders: 2`
       - Update the existing "zero user holders with source=pumpportal returns pass=true, score=50" test: change expected `pass` to `false` and `score` to `0`, update detail assertion to match "below minimum holders"
       - Add test: "pumpportal with 1 holder and minUserHolders=2 returns pass=false" -- one user wallet in largest accounts, verify pass=false with detail "below minimum holders: 1 < 2 required"
       - Add test: "pumpportal with 2 holders and minUserHolders=2 proceeds to concentration check" -- two user wallets each with 10% of supply, verify pass=true (under thresholds)
       - Add test: "pumpportal with 0 holders and minUserHolders=0 returns pass=true, score=50" -- config with minUserHolders=0, verify original neutral behavior
       - Verify existing "zero user holders with source=raydium still returns pass=false" test passes unchanged
  </action>
  <verify>
    <automated>rtk vitest run src/safety/checks/tier2-holder</automated>
  </verify>
  <done>Pumpportal tokens with fewer than minUserHolders user holders are rejected. Tokens meeting or exceeding the threshold proceed to normal concentration analysis. Non-pumpportal sources unchanged. All tests pass.</done>
</task>

</tasks>

<verification>
1. `rtk vitest run` -- all project tests pass (no regressions)
2. `rtk tsc` -- no type errors
</verification>

<success_criteria>
- minUserHolders field exists in HolderConfigSchema with default 2 and Zod validation (int, min 0)
- config.jsonc includes minUserHolders: 2 under safety.holder with inline comment
- Pumpportal tokens with < minUserHolders user holders return pass=false
- Pumpportal tokens with >= minUserHolders user holders continue to normal concentration check
- Setting minUserHolders=0 preserves original pass-through behavior
- Non-pumpportal zero-holder behavior unchanged (pass=false)
- All existing + new tests pass
</success_criteria>

<output>
After completion, create `.planning/quick/3-add-configurable-minimum-holder-threshol/3-SUMMARY.md`
</output>
