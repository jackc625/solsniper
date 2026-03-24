# Phase 11: Fix Bonding Curve Issue - Context

**Gathered:** 2026-03-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix the holder concentration check (`tier2-holder.ts`) that incorrectly counts the Pump.fun bonding curve PDA as a whale holder. The bonding curve PDA is a per-token derived address (not the static Pump.fun program ID in SYSTEM_ACCOUNTS), so it never matches the exclusion set. This causes ~90% of new Pump.fun tokens to fail with 75-90%+ top-1 concentration. Fix by deriving the bonding curve PDA per-mint and excluding it dynamically.

</domain>

<decisions>
## Implementation Decisions

### Fix approach
- Derive bonding curve PDA per-mint using `findProgramAddressSync(["bonding-curve", mint.toBuffer()], PumpFunProgramId)`
- Exclude the derived PDA universally for ALL tokens (not conditional on source) — CPU-only, zero RPC cost, handles edge cases where source detection is wrong or token migrated from pump.fun
- Apply exclusion to BOTH standard token and Token-2022 code paths in `checkHolderConcentration()`
- Remove the static Pump.fun program ID (`6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`) from `SYSTEM_ACCOUNTS` — it was misleading and never matched
- PDA derivation uses specifically the Pump.fun program ID as the program — no random PDA exclusion

### Post-fix thresholds
- Keep existing thresholds: top1 > 25% soft-block, top10 > 50% soft-block — these are meaningful for real holder distribution after bonding curve exclusion
- Zero user holders edge case: if source=pumpportal and no user holders found (all system/bonding-curve accounts), return pass=true with score=50 and "insufficient data" detail — don't block the early-buy strategy
- Non-pumpportal tokens with zero user holders: keep current fail behavior (pass=false, score=0)

### Token source routing
- Add `source` parameter to `checkHolderConcentration()` function signature for source-aware zero-holder behavior
- The function itself decides behavior based on source (not the caller) — keeps logic self-contained
- Always run the holder check for all tokens (never skip) — catches insider wallets even on pump.fun tokens
- Bonding curve PDA exclusion is universal (not source-conditional) per fix approach decision

### Claude's Discretion
- Exact PDA derivation implementation details (Buffer encoding, seed format)
- Whether to add the bonding curve PDA to a local Set or compare inline
- Log message formatting for the excluded bonding curve
- Test fixture structure and mock data

</decisions>

<specifics>
## Specific Ideas

- User emphasized: "make sure the exclusion is keyed to the specific Pump.fun program ID, so you're not excluding random PDAs"
- Zero-holder pass for pumpportal should include an "insufficient data" flag/detail — signals to logging that this was a data-absent pass, not a data-confirmed pass

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `checkHolderConcentration()` already accepts `programId?: PublicKey` param — can also accept `source?: string`
- `SYSTEM_ACCOUNTS` Set is the static exclusion list — bonding curve PDA will be derived dynamically alongside it
- `TokenEvent.source` field already threaded through safety pipeline to `checkSellRoute()` — same pattern for holder check
- `findProgramAddressSync` available from `@solana/web3.js` (already imported)

### Established Patterns
- Source-conditional behavior: `checkSellRoute()` already skips Jupiter check for `source === 'pumpportal'` — same pattern for zero-holder pass
- `detectedProgramId` passed from `checkAuthorities()` return through `SafetyPipeline.evaluate()` to `checkHolderConcentration()` — add source alongside it
- BigInt arithmetic throughout holder check — maintain consistency

### Integration Points
- `SafetyPipeline.evaluate()` line 105: already passes `detectedProgramId` to `checkHolderConcentration()` — add `event.source` as additional param
- `SYSTEM_ACCOUNTS` Set at top of `tier2-holder.ts` — remove Pump.fun entry
- Both standard and Token-2022 filter paths use `SYSTEM_ACCOUNTS.has(owner)` — PDA exclusion must be added to both

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 11-fix-bonding-curve-issue*
*Context gathered: 2026-03-02*
