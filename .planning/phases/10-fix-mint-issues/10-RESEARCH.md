# Phase 10: Fix Mint Issues - Research

**Researched:** 2026-03-02
**Domain:** Token-2022 compatibility, Jupiter error handling, PumpPortal sell fallback
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Sell-route safety check for new tokens:**
- Skip the Jupiter sell-route check at detection time for pump.fun-sourced tokens (indexing delay of 10-20s causes permanent false rejections)
- After buy confirms, run a delayed sell-route verification with retry/backoff against Jupiter
- If post-buy retries still show no route: log + alert, block any adds/scales to the position, but keep monitoring — sells will retry Jupiter when exit triggers fire
- Do NOT attempt to force-sell if Jupiter can't route (you can't if Jupiter is the only seller)
- Raydium/other-sourced tokens keep the existing detection-time Jupiter sell-route check as-is

**PumpPortal sell fallback in sell ladder:**
- Add a PumpPortal sell adapter as a new step in the sell ladder
- Placement: between CHUNKED (step 4) and EMERGENCY (step 5) — Jupiter gets full chance first
- Trigger: Only activate on route/tradability failures (TOKEN_NOT_TRADABLE, NO_ROUTES_FOUND, ROUTE_NOT_FOUND) — NOT on 429, 5xx, or timeout errors
- Uses PumpPortal trade-local API with `action: "sell"`, `pool: "auto"` (PumpPortal picks best venue)
- Only applies to pump.fun-sourced tokens (PumpPortal can't sell arbitrary Raydium tokens)

**getMint Token-2022 fix (Pattern A):**
- Use Pattern A (1 RPC call): call `connection.getAccountInfo(mintPubkey)`, inspect `info.owner` to detect TOKEN_PROGRAM_ID vs TOKEN_2022_PROGRAM_ID, then call `unpackMint(address, info, detectedProgramId)` synchronously
- Pattern A chosen over try-catch Pattern B because pump.fun create_v2 is the common case now — Pattern B would double RPC calls for the majority of detected tokens
- The detected `programId` should be returned/stored for downstream use (ATA derivation in chunked-seller, etc.)

**Error detection fix:**
- Replace `isAccountNotFoundError()` string matching (`err.message.includes(...)`) with `instanceof` checks
- Import `TokenAccountNotFoundError` and `TokenInvalidAccountOwnerError` from `@solana/spl-token`
- These error classes have empty `.message` strings (the constructors never pass a message to `super()`) — which is why the current string matching never works

**Chunked-seller Token-2022 ATA fix:**
- Pass correct `programId` to both `getAssociatedTokenAddress(mint, owner, false, programId)` and `getAccount(connection, ata, undefined, programId)`
- The `programId` should flow from the trade record (detected during safety checks) rather than re-querying the mint account

**Jupiter 400 error body parsing:**
- Read the response body on HTTP 400 errors, extract the error code (e.g., TOKEN_NOT_TRADABLE, NO_ROUTES_FOUND, ROUTE_NOT_FOUND)
- Include the parsed error code in structured logs
- Pass the error code back to callers so the sell ladder can distinguish route failures from other errors (needed for PumpPortal fallback trigger logic)

**Token-2022 audit scope:**
- Full codebase audit completed during research — only 2 files need fixes:
  - `src/safety/checks/tier1-authority.ts` (getMint + error detection)
  - `src/execution/sell/chunked-seller.ts` (ATA derivation + getAccount)
- Already dual-program aware: recovery-manager.ts, position-manager.ts
- Not applicable: all Jupiter/PumpPortal API callers (APIs handle Token-2022 internally), all Solana RPC methods (program-agnostic), all detection layer files (string-level, no token program interaction)

### Claude's Discretion
- PumpPortal sell adapter timeout value within the sell ladder
- Retry count and backoff timing for post-buy sell-route verification
- Whether to store detected `programId` in the SQLite trade record or thread it through in-memory
- Exact structured log format for Jupiter error codes

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

---

## Summary

Phase 10 fixes five known bugs that collectively block all pump.fun create_v2 (Token-2022) tokens from passing the safety pipeline and executing cleanly through the sell ladder. The root cause is that `getMint()` in `@solana/spl-token` defaults to `TOKEN_PROGRAM_ID` — it cannot auto-detect Token-2022 mints. Since Pump.fun switched to `create_v2` (Token-2022) on November 12, 2025, every pump.fun token detected since then fails at Tier 1 safety checks with an empty error message, which compounds into a second bug where the string-matching retry logic also silently fails.

The fix plan is surgical: two source files need Token-2022 fixes (tier1-authority.ts and chunked-seller.ts), one file needs error body parsing (jupiter-client.ts), one file needs source-awareness (tier1-sell-route.ts), and the sell ladder gains a new PumpPortal fallback step plus a post-buy sell-route verification mechanism. A new file (`pump-portal-seller.ts`) is needed for the PumpPortal sell adapter.

**Primary recommendation:** Fix tier1-authority.ts first (Pattern A: single getAccountInfo + unpackMint). This unblocks all pump.fun token flow. Then thread the detected programId through to chunked-seller. Add PumpPortal sell fallback and Jupiter error body parsing as independent improvements. Handle the sell-route detection-time skip separately so pump.fun tokens no longer get false-rejected.

---

## Standard Stack

### Core (No New Dependencies)
| Library | Version (installed) | Purpose | Why Standard |
|---------|--------------------|---------|-----------   |
| `@solana/spl-token` | 0.4.14 (installed) | Token-2022: `unpackMint`, `TOKEN_2022_PROGRAM_ID`, `TokenAccountNotFoundError`, `TokenInvalidAccountOwnerError`, `getAssociatedTokenAddress`, `getAccount` | Already installed, exports all needed symbols |
| `@solana/web3.js` | installed | `connection.getAccountInfo()`, `PublicKey` | Already installed |

No new `npm install` needed — all required APIs are already available in the installed version of `@solana/spl-token`.

### Key Exports Verified from Installed Source
From `node_modules/@solana/spl-token/src/state/mint.ts`:
```typescript
// unpackMint is synchronous, takes nullable AccountInfo
export function unpackMint(
  address: PublicKey,
  info: AccountInfo<Buffer> | null,
  programId = TOKEN_PROGRAM_ID   // <-- pass TOKEN_2022_PROGRAM_ID for new tokens
): Mint
```

From `node_modules/@solana/spl-token/src/constants.ts`:
```typescript
export const TOKEN_PROGRAM_ID     = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
```

From `node_modules/@solana/spl-token/src/errors.ts`:
```typescript
// Both extend TokenError extends Error with no constructor args — .message is always ""
export class TokenAccountNotFoundError extends TokenError { name = 'TokenAccountNotFoundError'; }
export class TokenInvalidAccountOwnerError extends TokenError { name = 'TokenInvalidAccountOwnerError'; }
```

From `node_modules/@solana/spl-token/src/state/account.ts`:
```typescript
export async function getAccount(
  connection: Connection,
  address: PublicKey,
  commitment?: Commitment,
  programId = TOKEN_PROGRAM_ID   // <-- pass programId for Token-2022 ATAs
): Promise<Account>

export async function getAssociatedTokenAddress(
  mint: PublicKey,
  owner: PublicKey,
  allowOwnerOffCurve = false,
  programId = TOKEN_PROGRAM_ID,  // <-- pass programId for Token-2022 ATAs
  associatedTokenProgramId = ASSOCIATED_TOKEN_PROGRAM_ID,
): Promise<PublicKey>
```

**Confidence:** HIGH — verified directly from installed source files.

---

## Architecture Patterns

### Pattern A: getAccountInfo + unpackMint (1 RPC call)
**What:** Call `connection.getAccountInfo()` once, inspect `info.owner` to distinguish legacy SPL vs Token-2022, then call `unpackMint()` synchronously with the detected program ID.
**Why:** The common case is now Token-2022 (pump.fun create_v2 since Nov 2025). Pattern B (try TOKEN_PROGRAM_ID, catch, retry with TOKEN_2022_PROGRAM_ID) would double RPC calls for the majority of detected tokens.

```typescript
// Source: node_modules/@solana/spl-token/src/state/mint.ts (verified)
import {
  unpackMint,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TokenAccountNotFoundError,
  TokenInvalidAccountOwnerError,
} from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';

const mintPubkey = new PublicKey(mint);
const info = await connection.getAccountInfo(mintPubkey);

// info is null if account doesn't exist (TokenAccountNotFoundError equivalent)
if (!info) throw new TokenAccountNotFoundError();

// Detect program from account owner
const programId = info.owner.equals(TOKEN_2022_PROGRAM_ID)
  ? TOKEN_2022_PROGRAM_ID
  : TOKEN_PROGRAM_ID;

// unpackMint is synchronous — no additional RPC call
const mintInfo = unpackMint(mintPubkey, info, programId);
// mintInfo.mintAuthority, mintInfo.freezeAuthority are correctly parsed
```

**Returns:** Both `mintInfo` (for authority checks) and `programId` (for downstream chunked-seller use).

### Pattern: instanceof Error Detection
**What:** Replace `.message.includes('...')` string matching with `instanceof` checks.
**Why:** `TokenAccountNotFoundError` and `TokenInvalidAccountOwnerError` both extend `TokenError extends Error` with no message argument — their `.message` is always `""`.

```typescript
// BEFORE (broken — message is "" for spl-token errors)
function isAccountNotFoundError(err: unknown): boolean {
  const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return message.includes('could not find') || message.includes('account not found');
}

// AFTER (correct)
import { TokenAccountNotFoundError } from '@solana/spl-token';
function isAccountNotFoundError(err: unknown): boolean {
  return err instanceof TokenAccountNotFoundError;
}
```

### Pattern: Sell Ladder Step
The existing sell ladder step interface (from sell-ladder.ts):
```typescript
const steps: Array<{
  name: SellStep;
  timeoutMs: number;
  fn: () => Promise<string | number>;
}> = [
  { name: 'STANDARD', timeoutMs: ..., fn: () => standardSell(...) },
  { name: 'HIGH_FEE', timeoutMs: ..., fn: () => standardSell(...) },
  { name: 'JITO_BUNDLE', timeoutMs: ..., fn: () => jitoSell(...) },
  { name: 'CHUNKED', timeoutMs: ..., fn: () => chunkedSell(...) },
  // NEW: PUMPPORTAL goes here, before EMERGENCY
  { name: 'PUMPPORTAL', timeoutMs: ..., fn: () => pumpPortalSell(...) },  // returns string (signature)
  { name: 'EMERGENCY', timeoutMs: ..., fn: () => standardSell(...) },
];
```

The `SellStep` type in `src/types/index.ts` needs `'PUMPPORTAL'` added:
```typescript
export type SellStep = 'STANDARD' | 'HIGH_FEE' | 'JITO_BUNDLE' | 'CHUNKED' | 'PUMPPORTAL' | 'EMERGENCY';
```

### Pattern: PumpPortal Sell (mirroring pump-portal-buyer.ts)
PumpPortal trade-local API returns raw transaction bytes (same as buy path). The sell adapter mirrors the buyer exactly:

```typescript
// Source: src/execution/buy/pump-portal-buyer.ts (existing, verified)
const response = await fetch('https://pumpportal.fun/api/trade-local', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    publicKey: wallet.publicKey.toBase58(),
    action: 'sell',          // changed from 'buy'
    mint,
    amount: tokenAmount.toString(), // raw token units, or "100%" string
    slippage: slippagePct,  // percent, not bps
    priorityFee: priorityFeeSol,
    pool: 'auto',            // PumpPortal picks best venue (bonding curve or PumpSwap)
  }),
});
// Response: raw bytes (arrayBuffer), NOT JSON
const txBytes = new Uint8Array(await response.arrayBuffer());
const tx = VersionedTransaction.deserialize(txBytes);
const result = await broadcastAndConfirm(tx, wallet, connections);
return result.signature;
```

**Key differences from buy:**
- `action: 'sell'` (not 'buy')
- `pool: 'auto'` (not 'pump') — allows PumpPortal to route through PumpSwap for graduated tokens
- `amount` is token units (bigint as string), not SOL amount
- `denominatedInSol` param NOT used for sells

### Pattern: Jupiter 400 Error Body Parsing
Current `jupiter-client.ts` discards the response body on HTTP 400. Fix:

```typescript
// BEFORE (in jupiter-client.ts):
if (!response.ok) {
  throw new Error(`Jupiter quote HTTP ${response.status}`);
}

// AFTER:
if (response.status === 400) {
  let errorCode: string | undefined;
  try {
    const body = await response.json() as Record<string, unknown>;
    errorCode = body['errorCode'] as string | undefined;
  } catch { /* ignore JSON parse failure */ }
  const message = errorCode
    ? `Jupiter quote HTTP 400: ${errorCode}`
    : 'Jupiter quote HTTP 400';
  log.warn({ errorCode }, 'Jupiter quote 400 — error code parsed');
  throw new JupiterRouteError(message, errorCode);  // or Error with attached code
}
```

**Callers need the error code** to decide whether to attempt PumpPortal fallback. Options:
1. Custom error class `JupiterRouteError` with `.code` property
2. Structured error message with prefix `Jupiter quote HTTP 400: TOKEN_NOT_TRADABLE` that callers parse

Custom error class is cleaner for the sell ladder to inspect:
```typescript
export class JupiterRouteError extends Error {
  constructor(message: string, public readonly code: string | undefined) {
    super(message);
    this.name = 'JupiterRouteError';
  }
}
```

### Pattern: Token Source Threading
The token source (`'pumpportal' | 'raydium' | 'pumpswap'`) is available on `TokenEvent` and stored in the trade record during the safety pipeline. The sell ladder currently receives only `mint` and `tokenAmount`. To enable source-aware PumpPortal fallback, source must reach the sell ladder.

**Options (Claude's discretion):**
1. Store `source` in the SQLite `trades` table — persistent, survives restart, solves crash recovery case
2. Pass `source` through in-memory as a parameter to `SellLadder.sell()`
3. Look up source at sell time from a separate in-memory map

Option 1 (store in SQLite) is recommended because:
- Crash recovery restores positions in MONITORING state — if source is only in-memory, it's lost on crash
- The `programId` also benefits from being stored (for chunked-seller ATA derivation post-crash)
- Schema migration adds two nullable columns: `source TEXT` and `token_program_id TEXT`

**SQLite migration approach:** Add columns with `ALTER TABLE ... ADD COLUMN` in schema.ts using `IF NOT EXISTS` semantics, or use `CREATE TABLE IF NOT EXISTS` with new columns and handle existing DBs. The safer pattern is `ALTER TABLE` guarded by a try-catch (or checking if column exists first).

### Pattern: Post-Buy Sell-Route Verification
After buy confirms (in ExecutionEngine.buy), schedule a deferred sell-route check for pump.fun tokens:

```typescript
// In execution-engine.ts, after MONITORING transition:
if (source === 'pumpportal') {
  void schedulePostBuySellRouteCheck(mint, jupiterClient);
}
```

The deferred check runs with retry/backoff (Claude's discretion on counts — suggested: 3 retries, 5s/10s/20s backoff). If all retries fail, log a warning and set a flag. The flag prevents future position scaling but does NOT force-sell.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Token-2022 mint deserialization | Custom layout parser | `unpackMint()` from `@solana/spl-token` | Already handles extensions, TLV data, account type byte |
| Token program detection | Byte-level inspection | `info.owner.equals(TOKEN_2022_PROGRAM_ID)` | `getAccountInfo` returns `AccountInfo` with `.owner` as `PublicKey` |
| PumpPortal sell transaction | Custom instruction builder | PumpPortal trade-local API (same as buy path) | API already handles bonding curve vs PumpSwap routing |

---

## Common Pitfalls

### Pitfall 1: Error Class Empty Messages
**What goes wrong:** Code checks `err.message.includes('could not find')` but never matches, so retries never fire and Token-2022 tokens get hard-rejected on first try.
**Why it happens:** `TokenAccountNotFoundError` and `TokenInvalidAccountOwnerError` extend `TokenError extends Error` with no message passed to `super()`. The `.message` is always `""`.
**How to avoid:** Use `instanceof TokenAccountNotFoundError` checks. The `name` property (`'TokenAccountNotFoundError'`) is also reliable but `instanceof` is the idiomatic TypeScript approach.
**Warning signs:** Log lines showing `error: ` (empty string after colon) — exactly what ISSUES.md reported.

### Pitfall 2: Incorrect ATA for Token-2022
**What goes wrong:** `getAssociatedTokenAddress(mint, owner)` uses the default `TOKEN_PROGRAM_ID`. The derived ATA address is different from the actual Token-2022 ATA address — the account won't be found, or a wrong account is queried.
**Why it happens:** ATA addresses are program-derived — the program ID is part of the seed. A legacy SPL ATA address differs from a Token-2022 ATA address for the same mint/owner pair.
**How to avoid:** Always pass the detected `programId` to both `getAssociatedTokenAddress` and `getAccount`. The `programId` must come from the same source (getAccountInfo on mint) to be authoritative.

### Pitfall 3: PumpPortal Sell on Non-PumpPortal Tokens
**What goes wrong:** PumpPortal sell is attempted on a Raydium/PumpSwap token — PumpPortal returns an error because it only knows about bonding curve and PumpSwap tokens.
**Why it happens:** The sell ladder step is added without source-awareness.
**How to avoid:** PumpPortal sell step must check token source before executing. If source is not `'pumpportal'`, skip the step entirely (return immediately, treat as "step failed", let EMERGENCY run).

### Pitfall 4: Sell-Route Check Blocking Pump.fun Tokens
**What goes wrong:** New pump.fun tokens are rejected by `checkSellRoute()` because Jupiter hasn't indexed the bonding curve market yet (10-20s delay). The token gets permanently cached as "failed" by SafetyCache.
**Why it happens:** `SafetyPipeline.evaluate()` caches results. A detection-time rejection caches the fail result, blocking the token even after Jupiter indexes it.
**How to avoid:** Skip `checkSellRoute()` for pump.fun tokens at detection time. Run it post-buy with retries instead. The cache TTL means a cached failure persists, so skipping at detection time is the only reliable fix.

### Pitfall 5: SellLadder.sell() Signature Change Breaking Tests
**What goes wrong:** Adding `source` to `SellLadder.sell(mint, tokenAmount, source)` breaks all existing sell ladder tests, PositionManager callers, and RecoveryManager callers.
**Why it happens:** `SellLadder.sell()` is called from PositionManager (`fireSell()`) and RecoveryManager. Both would need updating.
**How to avoid:** Store `source` in the trade record (SQLite) so `SellLadder.sell()` can look it up from `tradeStore` using only `mint`. This avoids changing the method signature at all call sites.

### Pitfall 6: unpackMint on Token-2022 Extensions
**What goes wrong:** Token-2022 mints have extra TLV data beyond the base mint layout. Calling `unpackMint` with `TOKEN_PROGRAM_ID` on a Token-2022 mint throws `TokenInvalidAccountOwnerError`. Calling it with the wrong program ID always throws.
**Why it happens:** `unpackMint` checks `info.owner.equals(programId)` on line 96 of the installed source. Getting the programId wrong = immediate throw.
**How to avoid:** Always detect the programId from `info.owner` before calling `unpackMint`. The Pattern A approach above is exactly correct.

---

## Code Examples

### getMint Fix: Pattern A (Verified from installed source)
```typescript
// Source: node_modules/@solana/spl-token/src/state/mint.ts
import {
  unpackMint,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TokenAccountNotFoundError,
} from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';
import type { Connection } from '@solana/web3.js';

async function getMintDualProgram(mint: string, connection: Connection) {
  const mintPubkey = new PublicKey(mint);
  const info = await connection.getAccountInfo(mintPubkey);
  // null info = account doesn't exist
  if (!info) throw new TokenAccountNotFoundError();
  // Detect program from account owner field
  const programId = info.owner.equals(TOKEN_2022_PROGRAM_ID)
    ? TOKEN_2022_PROGRAM_ID
    : TOKEN_PROGRAM_ID;
  // unpackMint is synchronous — no extra RPC needed
  const mintInfo = unpackMint(mintPubkey, info, programId);
  return { mintInfo, programId };
}
```

### instanceof-Based Error Detection (Verified from installed source)
```typescript
// Source: node_modules/@solana/spl-token/src/errors.ts
import { TokenAccountNotFoundError } from '@solana/spl-token';

// Replaces string-matching isAccountNotFoundError()
function isAccountNotFoundError(err: unknown): boolean {
  return err instanceof TokenAccountNotFoundError;
  // Note: TokenInvalidAccountOwnerError (wrong program) should NOT be retried —
  // it means we passed the wrong programId, which is a logic error
}
```

### Chunked-Seller ATA Fix (Verified from installed source)
```typescript
// Source: node_modules/@solana/spl-token/src/state/mint.ts
import { getAssociatedTokenAddress, getAccount } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';

// programId comes from trade record (stored during safety check)
const programId = /* TOKEN_PROGRAM_ID or TOKEN_2022_PROGRAM_ID from trade record */;
const mintPubkey = new PublicKey(mint);

// allowOwnerOffCurve=false (wallets are on-curve), pass detected programId
const ata = await getAssociatedTokenAddress(mintPubkey, wallet.publicKey, false, programId);
const accountInfo = await getAccount(connections[0], ata, undefined, programId);
const balance = accountInfo.amount;  // bigint — unchanged
```

### PumpPortal Sell Adapter (Pattern matches pump-portal-buyer.ts)
```typescript
// Source: src/execution/buy/pump-portal-buyer.ts (existing pattern)
import { VersionedTransaction } from '@solana/web3.js';
import type { Connection, Keypair } from '@solana/web3.js';
import { broadcastAndConfirm } from '../broadcaster.js';
import type { TradingConfig } from '../../config/trading.js';
import { createModuleLogger } from '../../core/logger.js';

const log = createModuleLogger('pump-portal-seller');
const PUMPPORTAL_API = 'https://pumpportal.fun/api/trade-local';

export async function pumpPortalSell(
  mint: string,
  tokenAmount: bigint,
  config: TradingConfig,
  wallet: Keypair,
  connections: Connection[]
): Promise<string> {  // returns signature, throws on failure
  const { sell } = config.execution;
  // PumpPortal slippage is PERCENT not bps (same critical note as buyer)
  const slippagePct = sell.standardSlippageBps / 100;
  const priorityFeeSol = (config.execution.buy.priorityFeeBaseLamports) / 1e9;

  const response = await fetch(PUMPPORTAL_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publicKey: wallet.publicKey.toBase58(),
      action: 'sell',
      mint,
      amount: tokenAmount.toString(),  // raw token units as string
      slippage: slippagePct,
      priorityFee: priorityFeeSol,
      pool: 'auto',  // PumpPortal picks: bonding curve or PumpSwap
    }),
  });

  if (!response.ok) {
    throw new Error(`PumpPortal sell HTTP ${response.status}`);
  }

  const txBytes = new Uint8Array(await response.arrayBuffer());
  const tx = VersionedTransaction.deserialize(txBytes);
  const result = await broadcastAndConfirm(tx, wallet, connections);
  log.info({ mint, signature: result.signature }, 'PumpPortal sell confirmed');
  return result.signature;
}
```

### Jupiter 400 Error Code Extraction
```typescript
// New error class in jupiter-client.ts (or types/index.ts)
export class JupiterRouteError extends Error {
  constructor(message: string, public readonly code: string | undefined) {
    super(message);
    this.name = 'JupiterRouteError';
  }
}

// In JupiterClient.quote():
if (response.status === 400) {
  let errorCode: string | undefined;
  try {
    const body = await response.json() as { errorCode?: string };
    errorCode = body.errorCode;
  } catch { /* body not JSON */ }
  log.warn({ errorCode }, 'Jupiter quote 400');
  throw new JupiterRouteError(`Jupiter quote HTTP 400${errorCode ? `: ${errorCode}` : ''}`, errorCode);
}
```

### Sell Ladder PumpPortal Trigger Logic
```typescript
// In sell-ladder.ts — determining whether to trigger PumpPortal fallback:
const PUMPPORTAL_TRIGGER_CODES = new Set([
  'TOKEN_NOT_TRADABLE',
  'NO_ROUTES_FOUND',
  'ROUTE_NOT_FOUND',
]);

function isPumpPortalTriggerError(err: unknown): boolean {
  if (err instanceof JupiterRouteError) {
    return err.code !== undefined && PUMPPORTAL_TRIGGER_CODES.has(err.code);
  }
  return false;
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Pump.fun create (Token legacy SPL) | Pump.fun create_v2 (Token-2022) | November 12, 2025 | All new pump.fun tokens use Token-2022; getMint with default programId now fails on majority of tokens |
| Graduation to Raydium | Graduation to PumpSwap | March 2025 | PumpPortal `pool: "auto"` handles this; Jupiter also routes through PumpSwap |

**Deprecated/outdated:**
- `getMint(connection, address)` without explicit `programId`: Broken for Token-2022 mints. Always detect and pass programId for pump.fun tokens.
- String-matching on spl-token error messages: Never worked — error classes have empty messages. Use `instanceof`.

---

## Integration Points (Files Requiring Changes)

### Issue 1: tier1-authority.ts
**File:** `src/safety/checks/tier1-authority.ts`
**Changes:**
1. Replace `getMint()` call with Pattern A: `getAccountInfo` + `unpackMint` with detected programId
2. Return `programId` alongside mint info (for downstream use)
3. Replace `isAccountNotFoundError()` string matching with `instanceof TokenAccountNotFoundError`
4. Update retry logic to only retry on `TokenAccountNotFoundError`, not on `TokenInvalidAccountOwnerError` (wrong program = logic error, not transient)

**Return type change:** `checkAuthorities` must return programId for downstream use. Options:
- Return `[CheckResult, CheckResult, PublicKey]` (tuple extended)
- Return `{ mintAuth: CheckResult, freezeAuth: CheckResult, programId: PublicKey }`
- Have safety pipeline store programId separately

The programId needs to reach `chunkedSell` which is called from `SellLadder`. Storing it in SQLite (via `trade_store.ts`) is the cleanest path.

### Issue 2: chunked-seller.ts
**File:** `src/execution/sell/chunked-seller.ts`
**Changes:**
1. Accept `tokenProgramId: PublicKey` parameter (from trade record)
2. Pass `tokenProgramId` to `getAssociatedTokenAddress()` and `getAccount()`

**Caller update:** `SellLadder` must retrieve `tokenProgramId` from trade store and pass to `chunkedSell`.

### Issue 3: jupiter-client.ts
**File:** `src/execution/jupiter-client.ts`
**Changes:**
1. Add `JupiterRouteError` class with `.code` property
2. In `quote()`, parse response body on HTTP 400 and throw `JupiterRouteError` with extracted code
3. Same fix in `swap()` if applicable (lower priority — route errors primarily come from quote)

### Issue 4: tier1-sell-route.ts + safety-pipeline.ts
**File:** `src/safety/checks/tier1-sell-route.ts` and `src/safety/safety-pipeline.ts`
**Changes:**
1. `checkSellRoute` needs token source to skip for pump.fun tokens — accept `source?: DetectionSource`
2. `SafetyPipeline.evaluate()` passes `event.source` to `checkSellRoute`
3. Post-buy sell-route verification: schedule in `ExecutionEngine.buy()` after MONITORING transition

### Issue 5: sell-ladder.ts
**File:** `src/execution/sell/sell-ladder.ts`
**Changes:**
1. Add `PUMPPORTAL` to steps array (between CHUNKED and EMERGENCY)
2. PumpPortal step only executes for pump.fun source tokens — check from trade store
3. PumpPortal step only triggers when last error was a route failure (`JupiterRouteError` with appropriate code)

### New File: pump-portal-seller.ts
**File:** `src/execution/sell/pump-portal-seller.ts`
**Exports:** `pumpPortalSell(mint, tokenAmount, config, wallet, connections): Promise<string>`

### Schema Changes (if storing programId in SQLite)
**File:** `src/persistence/schema.ts`
**Changes:**
1. Add `source TEXT` column to trades table
2. Add `token_program_id TEXT` column to trades table
3. Schema uses `CREATE TABLE IF NOT EXISTS` — existing DBs need `ALTER TABLE` migration

**Migration strategy:** Check if column exists before ALTER TABLE, or wrap in try-catch. SQLite ALTER TABLE only supports adding columns — safe to add with `ALTER TABLE trades ADD COLUMN source TEXT`.

---

## Open Questions

1. **Storing programId in SQLite vs in-memory**
   - What we know: Source is needed at sell time (for PumpPortal fallback). programId is needed in chunked-seller. Both are lost on crash if only in-memory.
   - What's unclear: Whether crash recovery currently re-derives programId (it doesn't — RecoveryManager uses getParsedTokenAccountsByOwner which is program-agnostic)
   - Recommendation: Store both `source` and `token_program_id` in SQLite. Add to `TradeStore.transition()` extra fields and `createBuyingRecord()` / schema.

2. **Post-buy sell-route verification location**
   - What we know: Must run after buy confirms (MONITORING state). Must not block the main event flow.
   - What's unclear: Whether this belongs in ExecutionEngine.buy() or as a separate scheduler
   - Recommendation: Add a simple `void schedulePostBuySellRouteVerification(mint)` call in ExecutionEngine.buy() after the MONITORING transition. Implement as async IIFE with 3 retries and exponential backoff.

3. **PumpPortal sell timeout value**
   - What we know: Claude's discretion. PumpPortal sell is similar to PumpPortal buy in latency profile.
   - Recommendation: 30s timeout (same as STANDARD and JITO_BUNDLE steps). This is shorter than CHUNKED (60s) which is appropriate given PumpPortal is a single atomic transaction.

4. **Retry count/backoff for post-buy sell-route verification**
   - What we know: Jupiter indexing delay is 10-20s for new tokens. Recommendation: 3 retries at 10s, 15s, 20s delays (covering 0-45s post-buy window).

---

## Sources

### Primary (HIGH confidence)
- `node_modules/@solana/spl-token/src/state/mint.ts` — `unpackMint`, `getMint`, `getAssociatedTokenAddress` signatures verified
- `node_modules/@solana/spl-token/src/errors.ts` — Error classes confirmed to have empty `.message` (no args passed to `super()`)
- `node_modules/@solana/spl-token/src/constants.ts` — `TOKEN_2022_PROGRAM_ID` address confirmed
- `node_modules/@solana/spl-token/src/state/account.ts` — `getAccount` signature with `programId` parameter verified
- `ISSUES.md` — Root causes confirmed by direct code inspection
- `src/safety/checks/tier1-authority.ts` — Current broken implementation read directly
- `src/execution/sell/chunked-seller.ts` — Current broken ATA derivation read directly
- `src/execution/sell/sell-ladder.ts` — Step interface and structure verified
- `src/execution/buy/pump-portal-buyer.ts` — PumpPortal buy pattern verified for sell reuse
- `src/execution/jupiter-client.ts` — Current 400 handling (discards body) verified
- `src/safety/safety-pipeline.ts` — Token source available at evaluation time, confirmed
- `src/types/index.ts` — `TokenEvent.source`, `SellStep` type, all type definitions

### Secondary (MEDIUM confidence)
- Context7 `/websites/spl_solana` — Confirmed Token-2022 instruction compatibility and program ID usage
- `ISSUES.md` research section — PumpPortal API shape for sell (action, pool, amount params)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — verified from installed source files in node_modules
- Architecture: HIGH — verified all API signatures, existing patterns read directly from codebase
- Pitfalls: HIGH — root causes confirmed from error class source (empty message constructors), ATA derivation math (programId is part of PDA seed)
- Integration points: HIGH — all files read, function signatures verified

**Research date:** 2026-03-02
**Valid until:** 2026-04-02 (stable — @solana/spl-token 0.4.x API is stable; PumpPortal API shape may drift but not within 30 days)
