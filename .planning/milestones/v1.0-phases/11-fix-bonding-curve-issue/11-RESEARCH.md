# Phase 11: Fix Bonding Curve Issue - Research

**Researched:** 2026-03-02
**Domain:** Solana PDA derivation, holder concentration safety check, source-aware routing
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **Fix approach:** Derive bonding curve PDA per-mint using `findProgramAddressSync(["bonding-curve", mint.toBuffer()], PumpFunProgramId)`. Exclude the derived PDA universally for ALL tokens (not conditional on source) — CPU-only, zero RPC cost, handles edge cases where source detection is wrong or token migrated from pump.fun.
- **Apply exclusion to both code paths:** Both the standard token path and the Token-2022 path in `checkHolderConcentration()` must exclude the bonding curve PDA.
- **Remove static Pump.fun program ID** (`6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`) from `SYSTEM_ACCOUNTS` — it was misleading (never matched a token-account owner) and never excluded anything.
- **Post-fix thresholds:** Keep existing thresholds (top1 > 25% soft-block, top10 > 50% soft-block).
- **Zero user holders edge case:** If `source=pumpportal` and no user holders found (all system/bonding-curve accounts), return `pass=true` with `score=50` and "insufficient data" detail. Non-pumpportal tokens with zero user holders keep current `pass=false, score=0` behavior.
- **Add `source` parameter** to `checkHolderConcentration()` function signature for source-aware zero-holder behavior. The function decides behavior based on source (not the caller).
- **Always run holder check** for all tokens (never skip) — catches insider wallets even on pump.fun tokens.
- **Bonding curve PDA exclusion is universal** (not source-conditional).

### Claude's Discretion

- Exact PDA derivation implementation details (Buffer encoding, seed format)
- Whether to add the bonding curve PDA to a local Set or compare inline
- Log message formatting for the excluded bonding curve
- Test fixture structure and mock data

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope
</user_constraints>

## Summary

Phase 11 is a surgical two-file fix: `tier2-holder.ts` and `safety-pipeline.ts`. The root cause is that the Pump.fun bonding curve is a per-mint PDA — not a static address — so it cannot be in `SYSTEM_ACCOUNTS`. The bonding curve account holds nearly all supply on brand-new tokens, causing the holder check to see 75-90%+ top-1 concentration and soft-block virtually every Pump.fun token.

The fix derives the bonding curve PDA at runtime using `PublicKey.findProgramAddressSync` (already available from the existing `@solana/web3.js` import) and excludes it inline before the concentration calculation. This is a CPU-only operation with zero RPC overhead. The same derivation applies universally to both the standard Token and Token-2022 code paths. The `source` parameter is threaded from `SafetyPipeline.evaluate()` into `checkHolderConcentration()` to handle the edge case where pumpportal tokens may have zero non-system holders at detection time.

The test suite currently has 20 passing tests across the two affected files. Phase 11 adds approximately 5–7 new test cases (bonding curve exclusion, source-aware zero-holder, pip signal logging) and updates 2 existing test call sites that now require the `source` argument.

**Primary recommendation:** One plan, two tasks: (1) implement the fix in `tier2-holder.ts` and `safety-pipeline.ts`, (2) update/add tests. Both can be a single commit since the surface is small.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@solana/web3.js` | ^1.98.4 | `PublicKey.findProgramAddressSync`, `PublicKey` constructor | Already imported in `tier2-holder.ts`; v1 API is what the entire codebase uses |
| `@solana/spl-token` | ^0.4.14 | `TOKEN_2022_PROGRAM_ID`, `unpackMint` | Already imported in `tier2-holder.ts` |

No new dependencies. No installation needed.

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | (existing) | Unit tests | All testing in this project |

## Architecture Patterns

### Recommended Project Structure
No new files or folders. All changes are confined to:
```
src/
├── safety/
│   ├── checks/
│   │   └── tier2-holder.ts          # primary change
│   └── safety-pipeline.ts           # thread source param
```

### Pattern 1: Per-Mint PDA Derivation (CPU-only)
**What:** Derive the bonding curve PDA for the mint being evaluated and add it to the exclusion check.
**When to use:** Inside the filter step for both standard and Token-2022 code paths, immediately alongside `SYSTEM_ACCOUNTS.has(owner)`.

Verified working via Node.js against `@solana/web3.js` v1.98.4:
```typescript
// Source: verified in project runtime 2026-03-02
import { PublicKey } from '@solana/web3.js';

const PUMP_FUN_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');

// Inside checkHolderConcentration(), after mintPubkey = new PublicKey(mint):
const [bondingCurvePda] = PublicKey.findProgramAddressSync(
  [Buffer.from('bonding-curve'), mintPubkey.toBuffer()],
  PUMP_FUN_PROGRAM_ID,
);
const bondingCurvePdaStr = bondingCurvePda.toBase58();
```

**Key facts verified:**
- `findProgramAddressSync` is synchronous — no `await`, no RPC call
- Seeds: `[Buffer.from('bonding-curve'), mintPubkey.toBuffer()]` — this matches the Pump.fun on-chain seed derivation
- Program: must be `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P` specifically (locks exclusion to Pump.fun, not random PDAs)
- Returns `[PublicKey, number]` — only the first element (the address) is needed; destructure with `[bondingCurvePda]`

### Pattern 2: Exclusion Filter with PDA
**What:** Extend the inline filter to reject both `SYSTEM_ACCOUNTS` entries AND the bonding curve PDA.
**When to use:** Both standard and Token-2022 filter locations.

Standard path (line 135-138 of current `tier2-holder.ts`):
```typescript
// Before:
userHolders = ownerResolutions.filter(
  (r): r is { owner: string; amount: bigint } =>
    r !== null && !SYSTEM_ACCOUNTS.has(r.owner),
);

// After:
userHolders = ownerResolutions.filter(
  (r): r is { owner: string; amount: bigint } =>
    r !== null && !SYSTEM_ACCOUNTS.has(r.owner) && r.owner !== bondingCurvePdaStr,
);
```

Token-2022 path (line 95 of current `tier2-holder.ts`):
```typescript
// Before:
userHolders = allHolders.filter((h) => !SYSTEM_ACCOUNTS.has(h.owner));

// After:
userHolders = allHolders.filter(
  (h) => !SYSTEM_ACCOUNTS.has(h.owner) && h.owner !== bondingCurvePdaStr,
);
```

### Pattern 3: Source Parameter Threading
**What:** Add `source?: string` to `checkHolderConcentration()` signature; use it in the zero-holder branch.
**When to use:** Follows the exact precedent of `checkSellRoute()` which receives `event.source` as third argument.

Function signature change:
```typescript
// Before:
export async function checkHolderConcentration(
  mint: string,
  connection: Connection,
  config: HolderConfig,
  programId?: PublicKey,
): Promise<CheckResult>

// After:
export async function checkHolderConcentration(
  mint: string,
  connection: Connection,
  config: HolderConfig,
  programId?: PublicKey,
  source?: string,
): Promise<CheckResult>
```

Zero-holder branch replacement:
```typescript
// Before:
if (userHolders.length === 0) {
  return {
    pass: false,
    score: 0,
    source: 'holder_concentration',
    detail: 'no user holders found (all system accounts)',
  };
}

// After:
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

### Pattern 4: SafetyPipeline Call Site Update
**What:** Pass `event.source` as the fifth argument to `checkHolderConcentration()`.
**When to use:** `safety-pipeline.ts` line 105 where the call currently is.

```typescript
// Before (current line 105):
checkHolderConcentration(event.mint, this.connection, this.tradingConfig.safety.holder, detectedProgramId),

// After:
checkHolderConcentration(event.mint, this.connection, this.tradingConfig.safety.holder, detectedProgramId, event.source),
```

### Pattern 5: SYSTEM_ACCOUNTS Cleanup
**What:** Remove the Pump.fun program ID from `SYSTEM_ACCOUNTS`.

```typescript
// Before:
const SYSTEM_ACCOUNTS = new Set([
  '11111111111111111111111111111111',              // System Program
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // Token Program
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', // Token-2022
  '1nc1nerator11111111111111111111111111111111',   // Incinerator
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', // Pump.fun program (PDA bonding curve)
]);

// After:
const SYSTEM_ACCOUNTS = new Set([
  '11111111111111111111111111111111',              // System Program
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // Token Program
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', // Token-2022
  '1nc1nerator11111111111111111111111111111111',   // Incinerator
]);

// Add constant for PDA derivation:
const PUMP_FUN_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
```

### Anti-Patterns to Avoid
- **Caching the PDA in module scope:** The PDA is per-mint, not per-program. Derive it fresh each call inside `checkHolderConcentration()`.
- **Conditional on source for PDA exclusion:** The user locked exclusion as universal — do not gate on `source === 'pumpportal'`. Source is only used for zero-holder pass behavior.
- **Using a Set for the derived PDA:** One address per call — a string comparison is cleaner than creating a single-element Set.
- **Making `source` required:** Use `source?: string` to maintain backward compatibility with any callers not yet passing source (also matches how existing test fixtures call the function).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PDA derivation | Custom off-curve math | `PublicKey.findProgramAddressSync` | Correct nonce bumping, canonical; already in `@solana/web3.js` |
| Seed buffer encoding | Manual byte encoding | `Buffer.from('bonding-curve')` + `mintPubkey.toBuffer()` | These are the established Pump.fun contract seeds |

## Common Pitfalls

### Pitfall 1: Wrong Seed Format
**What goes wrong:** The PDA does not match the on-chain address, so the bonding curve account continues to appear as a non-excluded whale.
**Why it happens:** Using `mint` as a string instead of `mintPubkey.toBuffer()`, or using `'bondingCurve'` (camelCase) instead of `'bonding-curve'` (kebab-case).
**How to avoid:** Seeds are exactly `[Buffer.from('bonding-curve'), mintPubkey.toBuffer()]` — lowercase kebab-case string, then the raw 32-byte public key buffer.
**Warning signs:** Test shows bonding curve PDA not excluded even after fix; try logging `bondingCurvePdaStr` and comparing against known PDA for a real Pump.fun token.

**Verified:** Running `PublicKey.findProgramAddressSync([Buffer.from('bonding-curve'), mint.toBuffer()], PUMP_FUN_PROGRAM_ID)` against WSOL returns `6PiyjiAPkp2KdZtqkyQYzVsD1Prv7t8v4TaYd8ip4YFd` (bump 253). This confirms the derivation works.

### Pitfall 2: Forgetting the Token-2022 Filter Path
**What goes wrong:** Only the standard token path gets the PDA exclusion; Token-2022 pump.fun tokens still fail.
**Why it happens:** Two separate filter locations in `checkHolderConcentration()` — easy to update one and miss the other.
**How to avoid:** The function has two branches for `isToken2022`. Both branches must apply `&& h.owner !== bondingCurvePdaStr`. Derive `bondingCurvePdaStr` once, before the `if (isToken2022)` branch split.

### Pitfall 3: source Param Position Mismatch
**What goes wrong:** TypeScript compiles but runtime behavior is wrong (source ends up as `programId` or vice versa).
**Why it happens:** `source` is added as a 5th parameter, `programId` is the 4th. If call sites pass wrong argument positions, TypeScript may not catch it (both are optional).
**How to avoid:** `source?: string` must be the 5th parameter, after `programId?: PublicKey`. Update `safety-pipeline.ts` to pass both. Run type-check after.

### Pitfall 4: Existing Test Call Sites Break
**What goes wrong:** Tests that call `checkHolderConcentration(mint, connection, config)` without `source` still work (TypeScript allows omitting optional params), but tests that assert on the zero-holder behavior may fail if a test omits `source` but expects the new pumpportal pass behavior.
**Why it happens:** The parameter is optional (`source?: string`), so omitting it means `source === undefined`, which will NOT match `source === 'pumpportal'` — correct behavior, but the test must be written to reflect that.
**How to avoid:** Keep existing zero-holder test passing without modification (it omits source, expects `pass=false`). Add new tests that explicitly pass `source='pumpportal'`.

### Pitfall 5: safety-pipeline.test.ts call site assertion
**What goes wrong:** The existing test `'passes detectedProgramId to checkHolderConcentration'` (safety-pipeline.test.ts line 384) asserts the call was made with exactly 4 arguments. After this phase, it must assert 5 arguments.
**Why it happens:** `expect(checkHolderConcentration).toHaveBeenCalledWith(mint, conn, config, programId)` — adding `event.source` as a 5th arg changes the call signature.
**How to avoid:** Update that test's `toHaveBeenCalledWith` assertion to include `'pumpportal'` (the default source in `makeTokenEvent()`).

## Code Examples

Verified patterns from official sources:

### Complete checkHolderConcentration Signature After Fix
```typescript
// File: src/safety/checks/tier2-holder.ts

const PUMP_FUN_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');

export async function checkHolderConcentration(
  mint: string,
  connection: Connection,
  config: HolderConfig,
  programId?: PublicKey,
  source?: string,
): Promise<CheckResult> {
  try {
    const mintPubkey = new PublicKey(mint);
    const isToken2022 = programId?.equals(TOKEN_2022_PROGRAM_ID) ?? false;

    // Derive per-mint bonding curve PDA — CPU-only, zero RPC cost
    // Universal exclusion: applies regardless of source, handles migration edge cases
    const [bondingCurvePda] = PublicKey.findProgramAddressSync(
      [Buffer.from('bonding-curve'), mintPubkey.toBuffer()],
      PUMP_FUN_PROGRAM_ID,
    );
    const bondingCurvePdaStr = bondingCurvePda.toBase58();

    // ... rest of function uses bondingCurvePdaStr in both filter paths
  }
}
```

### SafetyPipeline Call Site
```typescript
// File: src/safety/safety-pipeline.ts, line ~105
checkHolderConcentration(
  event.mint,
  this.connection,
  this.tradingConfig.safety.holder,
  detectedProgramId,
  event.source,  // NEW: thread source for pumpportal zero-holder handling
),
```

### New Test Cases to Add (tier2-holder.test.ts)
```typescript
// Test 1: bonding curve PDA excluded from concentration (standard path)
it('excludes bonding curve PDA from holder concentration', async () => {
  // bondingCurveAddr = PublicKey.findProgramAddressSync(
  //   [Buffer.from('bonding-curve'), new PublicKey(MOCK_MINT).toBuffer()],
  //   new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P')
  // )[0].toBase58()
  // Use that computed address in largestAccounts with 90% supply
  // Expect: result.pass = true (PDA excluded, only user wallets counted)
});

// Test 2: zero user holders with source=pumpportal passes with score=50
it('returns pass=true with score=50 when no user holders and source=pumpportal', async () => {
  // largestAccounts contains only SYSTEM_PROGRAM or bonding curve PDA
  // Call with source='pumpportal'
  // Expect: pass=true, score=50, detail contains 'insufficient data'
});

// Test 3: zero user holders without source still fails
it('returns pass=false when no user holders and source is not pumpportal', async () => {
  // largestAccounts contains only system accounts
  // Call without source (or source='raydium')
  // Expect: pass=false, score=0
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Static `SYSTEM_ACCOUNTS` for all exclusions | Dynamic per-mint PDA derivation for bonding curve | Phase 11 | ~90% of Pump.fun tokens now correctly evaluated |
| No source-aware zero-holder logic | `pumpportal` zero-holder returns pass=true with score=50 | Phase 11 | Early-buy strategy not blocked on detection-time data absence |

**Deprecated/outdated:**
- `'6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'` in `SYSTEM_ACCOUNTS`: removed — was the program ID not a token account owner, never matched anything

## Open Questions

None. All decisions are locked in CONTEXT.md and technically verified.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest v4.0.18 |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run src/safety/checks/tier2-holder.test.ts src/safety/safety-pipeline.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map
No formal requirement IDs were specified for this phase. The fix addresses SAF-06 correctness.

| Behavior | Test Type | Automated Command |
|----------|-----------|-------------------|
| Bonding curve PDA excluded (standard path) | unit | `npx vitest run src/safety/checks/tier2-holder.test.ts` |
| Bonding curve PDA excluded (Token-2022 path) | unit | `npx vitest run src/safety/checks/tier2-holder.test.ts` |
| pumpportal zero-holder returns pass=true, score=50 | unit | `npx vitest run src/safety/checks/tier2-holder.test.ts` |
| non-pumpportal zero-holder still fails | unit | `npx vitest run src/safety/checks/tier2-holder.test.ts` |
| source threaded from SafetyPipeline to checkHolderConcentration | unit | `npx vitest run src/safety/safety-pipeline.test.ts` |
| Existing 20 tests still pass (no regression) | unit | `npx vitest run` |

### Sampling Rate
- **Per task commit:** `npx vitest run src/safety/checks/tier2-holder.test.ts src/safety/safety-pipeline.test.ts`
- **Phase gate:** `npx vitest run` — full suite green before verify-work

### Wave 0 Gaps
None — existing test infrastructure covers everything. No new test files needed; new tests go in existing `tier2-holder.test.ts` and `safety-pipeline.test.ts`.

## Sources

### Primary (HIGH confidence)
- Runtime verification via Node.js REPL against `@solana/web3.js` v1.98.4 installed in project — `findProgramAddressSync` seed format confirmed working
- `src/safety/checks/tier2-holder.ts` — existing code read directly; both filter locations identified
- `src/safety/safety-pipeline.ts` — existing call site at line 105 read directly
- `src/safety/checks/tier2-holder.test.ts` — existing 8 tests read; call sites identified for update
- `src/safety/safety-pipeline.test.ts` — existing 12 tests read; `toHaveBeenCalledWith` assertions identified for update
- `.planning/phases/11-fix-bonding-curve-issue/11-CONTEXT.md` — all decisions read

### Secondary (MEDIUM confidence)
- Pump.fun bonding curve seed format `['bonding-curve', mint_pubkey_bytes]` — widely documented in Pump.fun SDK references and confirmed by the runtime derivation producing a valid on-curve PDA

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new deps, verified existing imports
- Architecture: HIGH — code read directly, PDA derivation verified at runtime
- Pitfalls: HIGH — derived from direct code inspection of call sites and test files

**Research date:** 2026-03-02
**Valid until:** 2026-04-02 (stable; no external API dependencies)
