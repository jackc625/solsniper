# Phase 18: Safety Pipeline Audit & Enhancement - Research

**Researched:** 2026-03-28
**Domain:** Solana safety pipeline -- audit analysis, scoring calibration, on-chain liquidity/LP/metadata checks
**Confidence:** HIGH

## Summary

Phase 18 adds three new safety checks (liquidity depth, LP lock/burn, metadata mutability) to an existing well-structured tier-based pipeline, calibrates scoring weights based on audit findings, and enriches trade persistence for ongoing monitoring. The codebase is highly consistent: every existing check follows the `CheckResult` interface, tiers use `Promise.all` / `Promise.allSettled` patterns, config uses Zod schemas, and tests use vitest with module-level `vi.mock`. New checks slot directly into this structure.

The three new on-chain checks require no additional npm dependencies. Bonding curve deserialization for pump.fun uses known byte offsets (documented in community gists). Metaplex metadata PDA derivation uses standard seeds (`"metadata"`, program ID, mint) with `PublicKey.findProgramAddressSync`. RugCheck API already returns `lpLockedPct` in its `/report/summary` response, so LP lock scoring piggybacks on the existing API call with zero additional cost. The on-chain LP lock fallback uses known burn/locker addresses.

The audit script (SAF-10) is a standalone Node.js tool that reads pino JSON logs and queries the SQLite trades table. It does not touch the runtime bot code. Schema migration for the trades table adds three TEXT columns via the existing `MIGRATION_SQL` array pattern.

**Primary recommendation:** Implement in order: (1) audit script + schema migration, (2) three new checks as individual files following existing patterns, (3) wire into pipeline + config, (4) calibrate weights based on audit output.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Build a Node.js log analysis script that parses pino JSON safety logs + queries SQLite trades table to correlate safety pass/fail decisions with actual trade P&L outcomes
- **D-02:** Enrich trades table with new columns (safety_score, safety_rejection_reasons, safety_checks_detail) for structured ongoing monitoring
- **D-03:** For rejected tokens (false positive analysis), sample-check ~50 random rejected mints from logs by fetching their current price/status
- **D-04:** Audit report output as a Markdown file (committed to repo) with summary stats, per-check accuracy tables, score distributions, and recommended weight/threshold changes
- **D-05:** New checks use a "separate gate + score" model: liquidity depth is a hard gate (reject below threshold, like Tier 1). LP lock and metadata mutability are scoring signals that apply configurable score penalties
- **D-06:** Audit script produces data + recommendations for new weight/threshold values. User reviews and applies manually -- no auto-apply
- **D-07:** Dry-run validation: after applying new weights, run bot in dry-run mode and compare safety pass/fail rates in logs against the audit baseline. Manual comparison
- **D-08:** Read on-chain pool reserves directly via getAccountInfo -- Raydium pool SOL reserves for Raydium tokens, bonding curve contract SOL balance for pump.fun tokens
- **D-09:** Hard gate: reject if SOL reserves below configurable minLiquiditySol threshold
- **D-10:** Runs in Tier 1 parallel alongside mint auth, freeze auth, and sell route checks
- **D-11:** Primary source: extract LP lock/burn risk signals from existing RugCheck API response (piggyback on tier2-rugcheck.ts call -- no additional API call)
- **D-12:** Fallback: on-chain LP token check -- verify if LP tokens are sent to known burn address (1nc1nerator) or locked in known locker contracts
- **D-13:** Scoring signal: unlocked LP applies configurable lpLockScorePenalty (e.g., -30) to aggregate score
- **D-14:** Runs in Tier 2 parallel alongside rugCheck, holder, creator checks
- **D-15:** On-chain Metaplex check: derive metadata PDA from mint, fetch via getAccountInfo, check isMutable flag
- **D-16:** Scoring signal: mutable metadata applies configurable metadataMutablePenalty (e.g., -15) to aggregate score
- **D-17:** Runs in Tier 2 parallel alongside other scoring checks
- **D-18:** Applies to ALL sources (both pump.fun and Raydium) -- Metaplex metadata exists regardless of DEX
- **D-19:** Tier 1 (hard gates, parallel): mint auth + freeze auth + sell route + liquidity depth -- all run via Promise.all, any failure = immediate reject
- **D-20:** Tier 2+3 (scoring, parallel): rugCheck + holder + creator + LP lock/burn + metadata mutability -- all run via Promise.allSettled with timeouts
- **D-21:** No new tiers -- new checks slot into existing tier structure
- **D-22:** Liquidity depth: for pumpportal source, read bonding curve contract SOL balance (PDA already derived in tier2-holder.ts) instead of Raydium pool reserves
- **D-23:** LP lock/burn: skip for pumpportal source (no LP tokens during bonding curve phase) -- return pass=true with neutral score
- **D-24:** Metadata mutability: run normally for all sources including pumpportal
- **D-25:** Add to safety config in trading.json: minLiquiditySol (hard gate threshold), lpLockScorePenalty (score deduction if unlocked), metadataMutablePenalty (score deduction if mutable)
- **D-26:** All new config values hot-reloadable via existing dashboard PATCH /api/config endpoint

### Claude's Discretion
- Exact bonding curve deserialization approach (read SOL balance from account data)
- Known locker program IDs for on-chain LP lock fallback check
- Metaplex metadata PDA derivation and account parsing implementation
- Audit script internal structure and query design
- Default values for new config thresholds (minLiquiditySol, penalty amounts)
- Schema migration strategy for new trades table columns

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SAF-10 | Current safety pipeline pass/fail rates audited against real trade outcomes to identify false positives and false negatives | Audit script reads pino JSON logs + SQLite trades; schema migration adds safety columns for structured correlation; code examples for log parsing and SQLite queries provided |
| SAF-11 | Safety scoring weights and thresholds calibrated based on audit findings | Audit report outputs recommendations; dry-run validation compares pre/post rates; aggregate score formula documented with penalty integration points |
| SAF-12 | Bot checks liquidity depth before buying -- rejects tokens with insufficient sell-side liquidity | On-chain getAccountInfo for bonding curve (pump.fun) and pool quoteVault (Raydium/pumpswap); byte offsets documented; Tier 1 hard gate pattern matches existing checks |
| SAF-13 | Bot checks whether liquidity pool is locked or burned -- unlocked LP scored as rug risk | RugCheck API returns lpLockedPct field; on-chain fallback uses known burn address (1nc1nerator) and UNCX locker program ID; scoring penalty pattern documented |
| SAF-14 | Bot checks token metadata mutability -- mutable metadata scored as soft rug signal | Metaplex metadata PDA derivation (3 seeds), Borsh deserialization of isMutable flag, scoring penalty pattern documented |
</phase_requirements>

## Standard Stack

### Core (already installed -- no new dependencies needed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @solana/web3.js | ^1.98.4 | RPC calls (getAccountInfo, getBalance, getTokenAccountBalance) | Already used for all on-chain reads |
| @solana/spl-token | ^0.4.14 | unpackMint, TOKEN_PROGRAM_ID constants | Already used in tier1-authority.ts |
| better-sqlite3 | ^12.6.2 | Trade store queries, schema migration | Already used for persistence |
| pino | ^10.3.1 | JSON structured logging (audit script reads these) | Already used for all bot logging |
| zod | ^4.3.6 | Config schema validation for new safety fields | Already used for all config |
| vitest | ^4.0.18 | Test framework | Already used for all 322 tests |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Raw Metaplex PDA derivation | @metaplex-foundation/mpl-token-metadata SDK | Adds ~500KB dependency for a single PDA derivation + 1 boolean read; raw approach is 15 lines of code |
| Raw bonding curve deserialization | pumpfun Rust crate (N/A for TS) | No TS SDK exists; raw Buffer.readBigUint64LE is standard pattern already used in community gists |
| Raw Raydium quoteVault read | @raydium-io/raydium-sdk | Massive SDK dependency for a single getTokenAccountBalance call; overkill |

**No new npm packages needed.** All three new checks use `getAccountInfo` / `getBalance` / `getTokenAccountBalance` from already-installed `@solana/web3.js`.

## Architecture Patterns

### Recommended Project Structure (new/modified files)
```
src/
├── safety/
│   ├── checks/
│   │   ├── tier1-liquidity.ts       # NEW: SAF-12 liquidity depth hard gate
│   │   ├── tier2-lp-lock.ts         # NEW: SAF-13 LP lock/burn scoring
│   │   └── tier2-metadata.ts        # NEW: SAF-14 metadata mutability scoring
│   └── safety-pipeline.ts           # MODIFIED: wire new checks into tiers
├── config/
│   └── trading.ts                   # MODIFIED: add new Zod schema fields
├── persistence/
│   ├── schema.ts                    # MODIFIED: add migration SQL for safety columns
│   └── trade-store.ts               # MODIFIED: store SafetyResult data on insert/transition
├── types/
│   └── index.ts                     # MODIFIED: extend TokenEvent with poolQuoteVault
scripts/
└── audit-safety.ts                  # NEW: standalone audit script (SAF-10)
```

### Pattern 1: Tier 1 Hard Gate Check (follow tier1-authority.ts)
**What:** New check file that returns `CheckResult` with `pass: boolean` and no `score`.
**When to use:** For liquidity depth (SAF-12) which is a hard gate.
**Example:**
```typescript
// Source: existing tier1-authority.ts pattern
export async function checkLiquidityDepth(
  mint: string,
  connection: Connection,
  minLiquiditySol: number,
  source?: DetectionSource,
  poolQuoteVault?: string,
): Promise<CheckResult> {
  // Source-aware: pumpportal reads bonding curve SOL balance,
  // raydium/pumpswap reads pool quoteVault balance
  if (source === 'pumpportal') {
    // Derive bonding curve PDA, getAccountInfo, read realSolReserves
    // Return pass: lamports >= minLiquiditySol * LAMPORTS_PER_SOL
  } else {
    // getTokenAccountBalance(quoteVault) for Raydium/PumpSwap
    // Return pass: balance >= minLiquiditySol
  }
}
```

### Pattern 2: Tier 2 Scoring Signal (follow tier2-rugcheck.ts)
**What:** New check file that returns `CheckResult` with `pass: true` always and `score: 0-100`.
**When to use:** For LP lock (SAF-13) and metadata mutability (SAF-14).
**Example:**
```typescript
// Source: existing tier2-rugcheck.ts pattern
export async function checkMetadataMutability(
  mint: string,
  connection: Connection,
  signal: AbortSignal,
): Promise<CheckResult> {
  try {
    // Derive metadata PDA, getAccountInfo, parse isMutable from Borsh data
    const isMutable = /* parsed from account data */;
    return {
      pass: true,
      score: isMutable ? 0 : 100,  // Penalty applied in pipeline
      source: 'metadata_mutability',
      detail: `isMutable=${isMutable}`,
    };
  } catch {
    return { pass: true, score: 0, source: 'metadata_mutability', detail: 'timeout_or_error' };
  }
}
```

### Pattern 3: Aggregate Score with Penalties (extend safety-pipeline.ts)
**What:** After computing the weighted average, subtract flat penalties for LP lock and metadata mutability.
**When to use:** When new scoring signals need to reduce the aggregate score without participating in the weighted average.
**Example:**
```typescript
// After computing weighted average of rugCheck + holder + creator
let adjustedScore = aggregateScore;

// Apply LP lock penalty (if check returned that LP is unlocked)
if (lpLockResult.score === 0) {
  adjustedScore = Math.max(0, adjustedScore - cfg.safety.lpLockScorePenalty);
}

// Apply metadata mutability penalty
if (metadataResult.score === 0) {
  adjustedScore = Math.max(0, adjustedScore - cfg.safety.metadataMutablePenalty);
}

// Threshold check uses adjustedScore
```

### Pattern 4: Source-Aware Skip (follow tier1-sell-route.ts)
**What:** Early return with neutral result when check is not applicable for a detection source.
**When to use:** LP lock check skipping for pumpportal (no LP tokens during bonding curve phase).
**Example:**
```typescript
// Source: tier1-sell-route.ts pattern
if (source === 'pumpportal') {
  return {
    pass: true,
    score: 50,  // Neutral -- neither penalizes nor rewards
    source: 'lp_lock',
    detail: 'skipped for pumpportal (bonding curve phase)',
  };
}
```

### Pattern 5: Schema Migration (follow schema.ts MIGRATION_SQL)
**What:** Add new columns via ALTER TABLE in the existing MIGRATION_SQL array.
**When to use:** Adding safety_score, safety_rejection_reasons, safety_checks_detail columns.
**Example:**
```typescript
// Source: existing schema.ts pattern
export const MIGRATION_SQL = [
  `ALTER TABLE trades ADD COLUMN source TEXT`,
  `ALTER TABLE trades ADD COLUMN token_program_id TEXT`,
  `ALTER TABLE trades ADD COLUMN dry_run INTEGER`,
  // Phase 18: safety audit columns
  `ALTER TABLE trades ADD COLUMN safety_score INTEGER`,
  `ALTER TABLE trades ADD COLUMN safety_rejection_reasons TEXT`,
  `ALTER TABLE trades ADD COLUMN safety_checks_detail TEXT`,
];
```

### Anti-Patterns to Avoid
- **Adding Raydium SDK dependency for a single balance read:** Use `connection.getTokenAccountBalance(quoteVault)` directly -- no SDK needed for a single RPC call
- **Adding Metaplex SDK for a single boolean read:** Derive PDA with `findProgramAddressSync` and parse raw bytes -- 15 lines vs 500KB dependency
- **Modifying the weighted average formula to include LP/metadata:** D-05 specifies these are flat penalties subtracted AFTER the weighted average, not new weighted components. Changing the formula breaks backwards compatibility of the weights config
- **Auto-applying audit recommendations:** D-06 explicitly says user reviews and applies manually

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Bonding curve PDA derivation | Custom seed guessing | `PublicKey.findProgramAddressSync([Buffer.from('bonding-curve'), mint.toBuffer()], PUMP_FUN_PROGRAM_ID)` | Already proven in tier2-holder.ts |
| Metadata PDA derivation | Custom seed guessing | `PublicKey.findProgramAddressSync([Buffer.from('metadata'), METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()], METADATA_PROGRAM_ID)` | Standard Metaplex convention |
| JSON log parsing | Line-by-line regex | `readline` + `JSON.parse` per line | Pino outputs newline-delimited JSON; native Node.js handles it |
| SQLite querying in audit script | Custom file reader | `better-sqlite3` (already installed) | Synchronous queries, same lib as trade-store |

## Common Pitfalls

### Pitfall 1: Bonding Curve IDL Signature Validation
**What goes wrong:** Reading bonding curve account data without validating the 8-byte IDL signature prefix leads to garbage data parsing on empty or migrated accounts.
**Why it happens:** The bonding curve account uses an Anchor-style 8-byte discriminator. If the account is closed or the bonding curve has migrated to Raydium, the data structure changes.
**How to avoid:** Validate the first 8 bytes match `[0x17, 0xb7, 0xf8, 0x37, 0x60, 0xd8, 0xac, 0x60]` before parsing. If mismatch, return pessimistic result (pass=false for hard gate).
**Warning signs:** Getting nonsensical SOL reserve values (very large or zero).

### Pitfall 2: Metaplex Metadata Variable-Length Borsh Fields
**What goes wrong:** Attempting to read `isMutable` at a fixed byte offset fails because the `Data` field contains variable-length strings (name, symbol, URI, creators array).
**Why it happens:** Borsh serialization of strings uses a 4-byte length prefix + variable content. The byte position of `isMutable` depends on the actual content of all preceding string fields.
**How to avoid:** Parse sequentially: skip key (1 byte) + updateAuthority (32) + mint (32), then read each Borsh string (4-byte len + content), read sellerFeeBasisPoints (2), skip creators Option (1-byte flag + if present: 4-byte len + 34 bytes per creator), read primarySaleHappened (1), then read isMutable (1).
**Warning signs:** `isMutable` returning incorrect values that don't match RugCheck or Solscan data.

### Pitfall 3: Raydium quoteVault Is Not Always SOL
**What goes wrong:** Assuming accounts[11] (pcVault/quoteVault) always holds WSOL. In rare cases, the quote token could be USDC or another token.
**Why it happens:** Raydium V4 supports arbitrary token pairs, not just X/SOL.
**How to avoid:** Verify that accounts[9] (pcMint/quoteMint) equals WSOL mint before treating quoteVault balance as SOL liquidity. If not WSOL, skip the check with a neutral result.
**Warning signs:** Incorrectly rejecting tokens paired with USDC for "low SOL liquidity."

### Pitfall 4: RugCheck lpLockedPct May Be Absent or Zero for New Tokens
**What goes wrong:** Treating lpLockedPct=0 as "LP unlocked" when the field might be 0 because the token just launched and RugCheck hasn't indexed the pool yet.
**Why it happens:** RugCheck API updates asynchronously; brand-new tokens may have incomplete data.
**How to avoid:** Treat lpLockedPct=0 AND risks array empty as "data unavailable" (neutral score), not as "confirmed unlocked." Only penalize when risks array explicitly contains LP-related warnings.
**Warning signs:** All new tokens getting LP lock penalties regardless of actual LP status.

### Pitfall 5: TokenEvent Missing poolQuoteVault for Raydium
**What goes wrong:** Liquidity depth check for Raydium tokens cannot proceed because TokenEvent doesn't carry pool vault info.
**Why it happens:** Current RaydiumListener only extracts mint from accounts[8]/[9] but not quoteVault from accounts[11].
**How to avoid:** Extend TokenEvent to include optional `poolQuoteVault?: string` field. Update RaydiumListener to extract accounts[11].toBase58() and pass it through.
**Warning signs:** Liquidity check always returning "no pool data" for Raydium tokens.

### Pitfall 6: PumpSwap Tokens Also Need Liquidity Check
**What goes wrong:** Only handling pumpportal and raydium sources, forgetting pumpswap.
**Why it happens:** PumpSwap is a third detection source that creates pools similarly to Raydium.
**How to avoid:** Handle all three sources: pumpportal (bonding curve PDA), raydium (quoteVault from accounts[11]), pumpswap (similar vault extraction from PumpSwap CreatePool accounts). Or for pumpswap, skip with neutral result if account layout is uncertain.
**Warning signs:** PumpSwap tokens always passing/failing liquidity checks incorrectly.

## Code Examples

### Bonding Curve SOL Reserve Reading (pump.fun)
```typescript
// Source: community gist (https://gist.github.com/rubpy/6c57e9d12acd4b6ed84e9f205372631d)
// Verified against BondingCurveAccount struct in pumpfun Rust crate

const PUMP_CURVE_SIGNATURE = Buffer.from([0x17, 0xb7, 0xf8, 0x37, 0x60, 0xd8, 0xac, 0x60]);

// Offsets within bonding curve account data:
// 0x00-0x07: IDL signature (8 bytes)
// 0x08-0x0F: virtualTokenReserves (u64 LE)
// 0x10-0x17: virtualSolReserves (u64 LE)
// 0x18-0x1F: realTokenReserves (u64 LE)
// 0x20-0x27: realSolReserves (u64 LE)  <-- THIS IS WHAT WE NEED
// 0x28-0x2F: tokenTotalSupply (u64 LE)
// 0x30:      complete (bool)

function readBondingCurveSolReserves(data: Buffer): bigint | null {
  if (data.length < 0x28) return null;
  const sig = data.subarray(0, 8);
  if (!sig.equals(PUMP_CURVE_SIGNATURE)) return null;
  return data.readBigUInt64LE(0x20); // realSolReserves in lamports
}
```

### Bonding Curve PDA Derivation (reuse from tier2-holder.ts)
```typescript
// Source: existing tier2-holder.ts line 19, 59
const PUMP_FUN_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');

const [bondingCurvePda] = PublicKey.findProgramAddressSync(
  [Buffer.from('bonding-curve'), new PublicKey(mint).toBuffer()],
  PUMP_FUN_PROGRAM_ID,
);
// Then: connection.getAccountInfo(bondingCurvePda)
```

### Metaplex Metadata PDA Derivation
```typescript
// Source: Metaplex docs (https://developers.metaplex.com/token-metadata)
// Program ID: metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s

const METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

function getMetadataPda(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('metadata'), METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    METADATA_PROGRAM_ID,
  );
  return pda;
}
```

### Metaplex Metadata isMutable Parsing (Borsh sequential)
```typescript
// Source: Metaplex account layout (https://www.sec3.dev/blog/solana-programs-part-3)
// Layout: key(1) + updateAuth(32) + mint(32) + Data{...variable...} + primarySaleHappened(1) + isMutable(1)

function parseIsMutable(data: Buffer): boolean | null {
  let offset = 0;
  if (data.length < 66) return null; // Minimum: key + updateAuth + mint

  offset += 1;   // key (enum discriminator)
  offset += 32;  // updateAuthority
  offset += 32;  // mint

  // Data struct: name(4+len) + symbol(4+len) + uri(4+len) + sellerFeeBasisPoints(2) + creators(Option)
  // Read name
  if (offset + 4 > data.length) return null;
  const nameLen = data.readUInt32LE(offset); offset += 4 + nameLen;
  // Read symbol
  if (offset + 4 > data.length) return null;
  const symbolLen = data.readUInt32LE(offset); offset += 4 + symbolLen;
  // Read uri
  if (offset + 4 > data.length) return null;
  const uriLen = data.readUInt32LE(offset); offset += 4 + uriLen;
  // Read sellerFeeBasisPoints
  offset += 2;
  // Read creators Option<Vec<Creator>>
  if (offset >= data.length) return null;
  const hasCreators = data.readUInt8(offset); offset += 1;
  if (hasCreators === 1) {
    if (offset + 4 > data.length) return null;
    const creatorsLen = data.readUInt32LE(offset); offset += 4;
    // Each Creator: address(32) + verified(1) + share(1) = 34 bytes
    offset += creatorsLen * 34;
  }

  // primarySaleHappened
  if (offset >= data.length) return null;
  offset += 1;

  // isMutable
  if (offset >= data.length) return null;
  return data.readUInt8(offset) === 1;
}
```

### RugCheck API lpLockedPct Extraction
```typescript
// Source: RugCheck Swagger (https://api.rugcheck.xyz/swagger/doc.json)
// Verified against live API response

interface RugCheckSummary {
  score: number;
  score_normalised: number;
  lpLockedPct: number;        // 0-100, percentage of LP locked
  tokenProgram: string;
  tokenType: string;
  risks: Array<{
    name: string;
    description: string;
    level: string;             // "danger", "warn", "info"
    score: number;
    value: string;
  }>;
}

// In tier2-rugcheck.ts, extend the response type to include lpLockedPct
// Pass lpLockedPct through CheckResult.detail or a new field
```

### Known Locker/Burn Addresses for On-Chain LP Fallback
```typescript
// Source: community research, verified via Solscan
// Burn address: https://learn.backpack.exchange/articles/solana-burn-address-explained
// UNCX locker: https://github.com/uncx-network/raydium-amm-lp-locker

const KNOWN_BURN_ADDRESSES = new Set([
  '1nc1nerator11111111111111111111111111111111',  // Solana incinerator
]);

const KNOWN_LOCKER_PROGRAMS = new Set([
  'GsSCS3vPWrtJ5Y9aEVVT65fmrex5P5RGHXdZvsdbWgfo',  // UNCX Raydium AMM LP Locker (mainnet)
]);
```

### Raydium V4 initialize2 Account Indices
```typescript
// Source: raydium-amm program instruction.rs
// https://github.com/raydium-io/raydium-amm/blob/master/program/src/instruction.rs

// Key indices for liquidity depth check:
// accounts[4]  = AMM pool account (pool state)
// accounts[8]  = coinMint (base token mint)
// accounts[9]  = pcMint (quote token mint -- usually WSOL)
// accounts[10] = coinVault (base token vault)
// accounts[11] = pcVault (quote token vault -- SOL reserves live here)

// In RaydiumListener.handleRaydiumPool(), extract:
const poolQuoteVault = accounts[11].toBase58();
const quoteMint = accounts[9].toBase58();
// Only pass to liquidity check if quoteMint === WRAPPED_SOL_MINT
```

### Audit Script SQLite Query Pattern
```typescript
// Source: existing trade-store.ts patterns
import Database from 'better-sqlite3';

const db = new Database('data/trades.db', { readonly: true });

// Completed trades with P&L data
const completedTrades = db.prepare(`
  SELECT mint, source, amount_sol, sell_price_sol,
         (sell_price_sol - amount_sol) AS pnl_sol,
         safety_score, safety_rejection_reasons, safety_checks_detail
  FROM trades
  WHERE state = 'COMPLETED' AND sell_price_sol IS NOT NULL
`).all();
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| RugCheck API without lpLockedPct | RugCheck /report/summary returns lpLockedPct directly | Available in current API | Can piggyback LP lock data on existing call (D-11) |
| Metaplex JS SDK for metadata reads | Raw PDA derivation + getAccountInfo | mpl-token-metadata v3 requires Umi framework | No SDK needed -- raw approach is simpler for a single boolean read |
| Raydium SDK V1 for pool data | Direct getTokenAccountBalance on vault | SDK V1 deprecated, V2 is heavy | getTokenAccountBalance is sufficient for reading SOL reserves |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest v4.0.18 |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run` |
| Full suite command | `npx vitest run --reporter=verbose` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SAF-10 | Audit script correlates safety decisions with trade outcomes | integration | `npx vitest run src/scripts/audit-safety.test.ts -t "audit"` | Wave 0 |
| SAF-11 | Scoring weights/threshold calibration reflected in aggregate score | unit | `npx vitest run src/safety/safety-pipeline.test.ts -t "penalty"` | Wave 0 (extend existing) |
| SAF-12 | Liquidity depth hard gate rejects below threshold | unit | `npx vitest run src/safety/checks/tier1-liquidity.test.ts` | Wave 0 |
| SAF-12 | Liquidity depth pumpportal reads bonding curve | unit | `npx vitest run src/safety/checks/tier1-liquidity.test.ts -t "pumpportal"` | Wave 0 |
| SAF-12 | Liquidity depth raydium reads quoteVault | unit | `npx vitest run src/safety/checks/tier1-liquidity.test.ts -t "raydium"` | Wave 0 |
| SAF-13 | LP lock scoring from RugCheck lpLockedPct | unit | `npx vitest run src/safety/checks/tier2-lp-lock.test.ts` | Wave 0 |
| SAF-13 | LP lock fallback on-chain check | unit | `npx vitest run src/safety/checks/tier2-lp-lock.test.ts -t "fallback"` | Wave 0 |
| SAF-13 | LP lock skip for pumpportal | unit | `npx vitest run src/safety/checks/tier2-lp-lock.test.ts -t "pumpportal"` | Wave 0 |
| SAF-14 | Metadata mutability scoring check | unit | `npx vitest run src/safety/checks/tier2-metadata.test.ts` | Wave 0 |
| SAF-14 | Metadata isMutable=true applies penalty | unit | `npx vitest run src/safety/checks/tier2-metadata.test.ts -t "mutable"` | Wave 0 |
| SAF-14 | Metadata isMutable=false gives full score | unit | `npx vitest run src/safety/checks/tier2-metadata.test.ts -t "immutable"` | Wave 0 |
| SAF-12+13+14 | Pipeline integration: new checks wired into tiers | unit | `npx vitest run src/safety/safety-pipeline.test.ts -t "liquidity\|lp_lock\|metadata"` | Wave 0 (extend existing) |

### Sampling Rate
- **Per task commit:** `npx vitest run`
- **Per wave merge:** `npx vitest run --reporter=verbose`
- **Phase gate:** Full suite green (322+ tests, all passing) before verify-work

### Wave 0 Gaps
- [ ] `src/safety/checks/tier1-liquidity.test.ts` -- covers SAF-12
- [ ] `src/safety/checks/tier2-lp-lock.test.ts` -- covers SAF-13
- [ ] `src/safety/checks/tier2-metadata.test.ts` -- covers SAF-14
- [ ] Extend `src/safety/safety-pipeline.test.ts` -- covers integration of new checks + penalty application
- [ ] `scripts/audit-safety.test.ts` or equivalent -- covers SAF-10 audit script logic

Existing infrastructure: vitest.config.ts configured with `include: ['src/**/*.test.ts', 'tests/**/*.test.ts']`, dotenv loaded for test env. 27 test files with 322 tests all passing. Test patterns well-established with `vi.mock`, `vi.hoisted`, module-level mocking.

## Open Questions

1. **PumpSwap Pool Account Layout**
   - What we know: PumpSwap uses program `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA` and its CreatePool instruction contains accounts, but the exact vault index is undocumented.
   - What's unclear: Which account index in the PumpSwap CreatePool instruction corresponds to the SOL vault.
   - Recommendation: For pumpswap source, fall back to a neutral "skipped" result initially. Can be refined later by logging account indices on first detection (already done in RaydiumListener). LOW priority since pumpswap is a minor source.

2. **Pino Log File Location**
   - What we know: Logger sends to stdout (pino-pretty in dev, JSON in production). No file destination configured.
   - What's unclear: Whether the user has been redirecting stdout to a file, or if there are log files from production runs.
   - Recommendation: Audit script should accept a log file path as CLI argument. If no logs exist, the script should document that and the audit report should note limited data. The schema migration and new checks can proceed regardless.

3. **Existing Trade Data Volume**
   - What we know: `data/trades.db` exists. Unknown how many completed trades have P&L data.
   - What's unclear: Whether there's enough historical data for meaningful audit analysis.
   - Recommendation: The audit script should report the data volume found and flag if sample size is too small for statistical significance.

## Sources

### Primary (HIGH confidence)
- Existing codebase: safety-pipeline.ts, tier1-authority.ts, tier1-sell-route.ts, tier2-rugcheck.ts, tier2-holder.ts, tier3-creator.ts, config/trading.ts, persistence/schema.ts, types/index.ts -- full source read
- RugCheck Swagger schema (https://api.rugcheck.xyz/swagger/doc.json) -- TokenCheckSummary response includes `lpLockedPct`, `risks` array with `{name, description, level, score, value}`
- Raydium AMM instruction.rs (https://github.com/raydium-io/raydium-amm/blob/master/program/src/instruction.rs) -- initialize2 account layout confirmed
- Bonding curve state gist (https://gist.github.com/rubpy/6c57e9d12acd4b6ed84e9f205372631d) -- byte offsets for pump.fun bonding curve account data
- UNCX LP Locker GitHub (https://github.com/uncx-network/raydium-amm-lp-locker) -- mainnet program ID `GsSCS3vPWrtJ5Y9aEVVT65fmrex5P5RGHXdZvsdbWgfo`
- Metaplex metadata docs (https://developers.metaplex.com/token-metadata) -- PDA seeds: "metadata" + program ID + mint
- RareSkills Metaplex deep dive (https://rareskills.io/post/metaplex-token-metadata) -- program ID `metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s`, account field order
- Sec3 Metaplex analysis (https://www.sec3.dev/blog/solana-programs-part-3) -- Borsh field order: key, updateAuthority, mint, Data, primarySaleHappened, isMutable
- Solana burn address guide (https://learn.backpack.exchange/articles/solana-burn-address-explained) -- incinerator address `1nc1nerator11111111111111111111111111111111`

### Secondary (MEDIUM confidence)
- QuickNode Raydium guide (https://www.quicknode.com/guides/solana-development/3rd-party-integrations/track-raydium-lps) -- getTokenAccountBalance approach for vault reads
- RugCheck Python wrapper (https://github.com/ccan23/rugcheck) -- response field names cross-verified with Swagger schema

### Tertiary (LOW confidence)
- PumpSwap account layout -- undocumented, only inferred from detection code's defensive scan approach

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all patterns verified in existing codebase
- Architecture: HIGH -- three new check files follow exact patterns of existing checks (6 existing check files reviewed)
- On-chain data formats: HIGH for bonding curve (verified gist + Rust crate), HIGH for Metaplex (official docs), MEDIUM for Raydium quoteVault (verified via instruction.rs but not tested)
- RugCheck API lpLockedPct: HIGH -- verified via live API call and Swagger schema
- Pitfalls: HIGH -- derived from actual account layout analysis, not speculation

**Research date:** 2026-03-28
**Valid until:** 2026-04-28 (stable patterns -- Solana program IDs don't change)
