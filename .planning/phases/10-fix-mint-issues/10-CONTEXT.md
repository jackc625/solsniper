# Phase 10: Fix Mint Issues - Context

**Gathered:** 2026-03-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix Token-2022 compatibility bugs blocking pump.fun create_v2 tokens from passing the safety pipeline, fix related error handling gaps, and add a PumpPortal sell fallback to eliminate the Jupiter-only exit dependency for pump.fun tokens.

Five known issues from ISSUES.md plus one new capability (PumpPortal sell adapter) identified during research as essential to making the fixes meaningful.

</domain>

<decisions>
## Implementation Decisions

### Sell-route safety check for new tokens
- Skip the Jupiter sell-route check at detection time for pump.fun-sourced tokens (indexing delay of 10-20s causes permanent false rejections)
- After buy confirms, run a delayed sell-route verification with retry/backoff against Jupiter
- If post-buy retries still show no route: log + alert, block any adds/scales to the position, but keep monitoring — sells will retry Jupiter when exit triggers fire
- Do NOT attempt to force-sell if Jupiter can't route (you can't if Jupiter is the only seller)
- Raydium/other-sourced tokens keep the existing detection-time Jupiter sell-route check as-is

### PumpPortal sell fallback in sell ladder
- Add a PumpPortal sell adapter as a new step in the sell ladder
- Placement: between CHUNKED (step 4) and EMERGENCY (step 5) — Jupiter gets full chance first
- Trigger: Only activate on route/tradability failures (TOKEN_NOT_TRADABLE, NO_ROUTES_FOUND, ROUTE_NOT_FOUND) — NOT on 429, 5xx, or timeout errors
- Uses PumpPortal trade-local API with `action: "sell"`, `pool: "auto"` (PumpPortal picks best venue)
- Only applies to pump.fun-sourced tokens (PumpPortal can't sell arbitrary Raydium tokens)

### getMint Token-2022 fix (Pattern A)
- Use Pattern A (1 RPC call): call `connection.getAccountInfo(mintPubkey)`, inspect `info.owner` to detect TOKEN_PROGRAM_ID vs TOKEN_2022_PROGRAM_ID, then call `unpackMint(address, info, detectedProgramId)` synchronously
- Pattern A chosen over try-catch Pattern B because pump.fun create_v2 is the common case now — Pattern B would double RPC calls for the majority of detected tokens
- The detected `programId` should be returned/stored for downstream use (ATA derivation in chunked-seller, etc.)

### Error detection fix
- Replace `isAccountNotFoundError()` string matching (`err.message.includes(...)`) with `instanceof` checks
- Import `TokenAccountNotFoundError` and `TokenInvalidAccountOwnerError` from `@solana/spl-token`
- These error classes have empty `.message` strings (the constructors never pass a message to `super()`) — which is why the current string matching never works

### Chunked-seller Token-2022 ATA fix
- Pass correct `programId` to both `getAssociatedTokenAddress(mint, owner, false, programId)` and `getAccount(connection, ata, undefined, programId)`
- The `programId` should flow from the trade record (detected during safety checks) rather than re-querying the mint account

### Jupiter 400 error body parsing
- Read the response body on HTTP 400 errors, extract the error code (e.g., TOKEN_NOT_TRADABLE, NO_ROUTES_FOUND, ROUTE_NOT_FOUND)
- Include the parsed error code in structured logs
- Pass the error code back to callers so the sell ladder can distinguish route failures from other errors (needed for PumpPortal fallback trigger logic)

### Token-2022 audit scope
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

</decisions>

<specifics>
## Specific Ideas

- PumpPortal sell API shape: POST `https://pumpportal.fun/api/trade-local` with `action: "sell"`, `pool: "auto"`, `mint`, `amount` (supports `"100%"` or raw amounts), `publicKey`, `slippage`, `priorityFee`
- PumpPortal returns raw transaction bytes (same as buy path) — deserialize VersionedTransaction, sign, broadcast
- Jupiter error codes to detect for PumpPortal fallback trigger: `TOKEN_NOT_TRADABLE`, `NO_ROUTES_FOUND`, `ROUTE_NOT_FOUND`
- Pattern A getMint: `connection.getAccountInfo()` returns `info.owner` as a PublicKey — compare against `TOKEN_PROGRAM_ID` and `TOKEN_2022_PROGRAM_ID` constants from `@solana/spl-token`
- `unpackMint(address, info, programId)` is synchronous — no additional RPC call needed after getAccountInfo

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/execution/buy/pump-portal-buyer.ts`: PumpPortal trade-local API integration already exists for buys — sell adapter can reuse the same endpoint, request shape, and transaction handling pattern
- `src/execution/broadcaster.ts`: `broadcastAndConfirm()` handles multi-RPC broadcast and confirmation — reusable for PumpPortal sell transactions
- `src/execution/jupiter-client.ts`: Centralized Jupiter client — error body parsing fix goes here
- Recovery Manager + Position Manager: Both have working dual-program `getParsedTokenAccountsByOwner` queries as reference implementations

### Established Patterns
- Sell ladder step pattern: each step has a `name`, `timeoutMs`, and `fn` returning `Promise<string | number>` — PumpPortal sell step follows this exactly
- PumpPortal buyer pattern: POST to trade-local, receive raw tx bytes, deserialize VersionedTransaction, sign with wallet, broadcast via broadcastAndConfirm
- Module logger pattern: `createModuleLogger('module-name')` for structured logging

### Integration Points
- `src/execution/sell/sell-ladder.ts`: New PumpPortal sell step inserted between CHUNKED and EMERGENCY in the `steps` array
- `src/safety/checks/tier1-sell-route.ts`: Needs source-awareness to skip for pump.fun tokens
- `src/safety/safety-pipeline.ts` (or equivalent orchestrator): Must pass token source to tier1-sell-route
- `src/persistence/trade-store.ts`: May need a `tokenProgramId` column to thread detected program through to chunked-seller
- `src/execution/jupiter-client.ts`: Quote method needs to parse and return error codes from 400 responses

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 10-fix-mint-issues*
*Context gathered: 2026-03-02*
