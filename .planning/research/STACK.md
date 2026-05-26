# Stack Research: v1.1 Hardening Additions

**Domain:** Solana token sniper bot -- hardening & polish
**Researched:** 2026-03-27
**Confidence:** HIGH (most recommendations are zero-dependency or use established Fastify ecosystem plugins with verified versions)

## Scope

This document covers ONLY new libraries/changes needed for v1.1 hardening. The existing v1.0 stack is validated and unchanged:
- TypeScript ES2022, Node.js, @solana/web3.js v1, Jupiter Swap API, PumpPortal APIs
- better-sqlite3, pino, Fastify 5 + @fastify/sse, Preact + Vite, lightweight-charts
- vitest, Zod 4, eventemitter3, ws, bs58, dotenv

## Recommended Additions

### Security Hardening

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `@fastify/rate-limit` | ^10.3 | API rate limiting | Prevent brute-force and abuse on dashboard endpoints. In-memory store is sufficient (single-process bot, no Redis needed). Low overhead onRequest hook. Official Fastify plugin, maintained by the Fastify team. |
| `@fastify/helmet` | ^13.0 | Security headers | Sets X-Content-Type-Options, X-Frame-Options, CSP headers on dashboard responses. Wraps helmet.js for Fastify 5. Prevents clickjacking and XSS on the dashboard. One-line registration. |

**What NOT to add for security:**
- No WAF/reverse proxy library -- the dashboard is localhost-only on a VPS. Network-level security is handled by firewall rules, not application middleware.
- No CSRF library -- single-user bot with API key auth. CSRF protection adds complexity with zero value when there's no session/cookie auth.
- No `express-validator` or similar -- already using Zod for all validation. Adding a second validation library would be redundant.

### Safety Pipeline Improvements

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| *No new dependencies* | -- | Rug pattern detection improvements | All safety improvements use existing on-chain data via @solana/web3.js + @solana/spl-token. LP burn detection, liquidity lock verification, and metadata analysis use getAccountInfo/getParsedProgramAccounts calls. No new libraries needed. |

**Key insight:** The safety pipeline's accuracy gaps are algorithmic, not library-related. The existing stack already provides all the RPC methods needed:
- **LP burn detection**: Check if LP tokens are held by the incinerator address (`1nc1nerator11111111111111111111111111111111`) using `getTokenLargestAccounts` -- already available via @solana/web3.js.
- **Liquidity pool size verification**: `getTokenAccountBalance` on the pool's SOL vault -- already available.
- **Token metadata inspection**: `getAccountInfo` on the metadata PDA -- already available. No `@metaplex-foundation/mpl-token-metadata` needed; raw account data parsing is lighter and avoids a heavy dependency tree.
- **Creator wallet SOL balance check**: `getBalance` -- already available.

### Trading Performance Optimization

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| *No new dependencies* | -- | Dynamic priority fees | Helius already provides `getPriorityFeeEstimate` as a JSON-RPC extension on the existing RPC endpoint. No SDK needed -- it's a single fetch call to the same RPC URL already configured. |
| *No new dependencies* | -- | Compute budget optimization | `ComputeBudgetProgram.setComputeUnitPrice()` and `ComputeBudgetProgram.setComputeUnitLimit()` are built into @solana/web3.js. Already available, just not yet used in the buy/sell paths. |

**Why NOT add Helius SDK (`helius-sdk`):** The SDK wraps REST endpoints we're already calling directly. It would add a dependency that duplicates existing functionality. The `getPriorityFeeEstimate` call is a single JSON-RPC POST to the existing RPC URL -- adding a full SDK for one function call is unjustified.

### Dashboard Enhancements

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| *No new dependencies* | -- | Analytics, pipeline visibility, controls | The existing Preact + @preact/signals + lightweight-charts stack handles all planned dashboard improvements. Pipeline visibility is an SSE event type addition, not a library addition. Analytics are computed from existing SQLite data. Operational controls (pause/resume, force-sell) are new Fastify route handlers. |

### Reliability & Monitoring

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `@fastify/under-pressure` | ^9.0 | Event loop + heap monitoring | Monitors event loop delay, heap usage, RSS. Returns 503 when thresholds are exceeded. Exposes `memoryUsage()` for dashboard health display. Official Fastify plugin, zero-config defaults are sensible. Critical for a long-running bot that must not silently degrade. |
| `pino-roll` | ^4.0 | Log file rotation | Rotates log files by size (e.g., 50MB) and time (daily). Without this, logs grow unbounded on the VPS. pino-roll is the official pino transport for rotation -- lighter than system-level logrotate for a single-process app. |

**What NOT to add for monitoring:**
- No Prometheus/Grafana -- overkill for a single-process personal bot. The dashboard's `/api/health` endpoint plus pino logs are sufficient. Prometheus adds operational burden (separate process, scrape config, dashboard setup) with minimal benefit at this scale.
- No OpenTelemetry -- same reasoning. Distributed tracing is for multi-service architectures. This bot is a single Node.js process.
- No `opossum` circuit breaker -- the existing `RpcManager` already implements circuit-breaker-like failover (3 consecutive failures triggers switch to backup, with recovery polling). Adding opossum would duplicate existing behavior with a different API. The RpcManager pattern is simpler and already tested.

### Bug Fixes (BUGS.md)

| Issue | Solution | New Dependency? |
|-------|----------|-----------------|
| SQL injection risk (trade-store.ts:100) | **Already safe.** The template literal generates `?` placeholders from a constant array (`NON_TERMINAL_STATES`), not user input. The `ship-safe-ignore` comment documents this. No code change needed. | No |
| API key in URL (tier3-creator.ts:112) | Move Helius API key from query parameter to `Authorization: Bearer` header. Helius documents support for header-based auth. Code change only -- the key is already masked in error logs (line 146). | No |
| Unvalidated config endpoint (config.ts:42) | **Already fixed.** The config route uses `ConfigPatchSchema` (Zod) with `.safeParse()` and returns 400 on validation failure. This was resolved during v1.0 development. | No |
| Dependency vulnerabilities (3) | Run `pnpm audit` to identify specific packages. Fix with `pnpm update` for semver-compatible fixes or `pnpm.overrides` for transitive dependency pinning. | No |

## Installation

```bash
# New v1.1 dependencies (production)
pnpm add @fastify/rate-limit@^10.3 @fastify/helmet@^13.0 @fastify/under-pressure@^9.0

# New v1.1 dependencies (log rotation -- production transport)
pnpm add pino-roll@^4.0

# Fix known vulnerabilities
pnpm audit --fix
```

## Alternatives Considered

| Recommended | Alternative | Why Not Alternative |
|-------------|-------------|---------------------|
| `@fastify/rate-limit` (in-memory) | `@fastify/rate-limit` + Redis | Single-process bot. Redis adds an external dependency and operational burden for zero benefit at this scale. |
| `@fastify/helmet` | Manual header setting | Helmet covers 11+ security headers with tested defaults. Manual headers are error-prone and harder to maintain. |
| `@fastify/under-pressure` | Custom `setInterval` health check | under-pressure uses `monitorEventLoopDelay` API which is more accurate than periodic sampling. Also integrates with Fastify's request lifecycle for automatic 503 responses. |
| `pino-roll` | System `logrotate` | pino-roll is cross-platform (works on Windows dev + Linux VPS). logrotate requires Linux-specific configuration and doesn't work during Windows development. |
| No circuit breaker library | `opossum` | Existing `RpcManager` already handles RPC failover with configurable thresholds and auto-recovery. Adding opossum would create parallel failover logic. |
| Raw `getAccountInfo` for metadata | `@metaplex-foundation/mpl-token-metadata` | Metaplex SDK adds ~15 transitive dependencies. Raw account data parsing for the 3-4 fields we need (name, symbol, uri, update authority) is 20 lines of code. |
| Helius `getPriorityFeeEstimate` | `getRecentPrioritizationFees` (standard RPC) | Helius endpoint analyzes the actual transaction for accuracy. The standard RPC method returns recent block-level data that oversimplifies the fee market and tends to overestimate. |
| Header-based Helius auth | Keep query param auth | API keys in URLs leak in access logs, error traces, and browser history. Header auth prevents this class of leak entirely. Helius supports `Authorization: Bearer` headers. |

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `helius-sdk` | Wraps REST endpoints we call directly. Adds dependency for one function (`getPriorityFeeEstimate`). | Direct JSON-RPC POST to existing RPC URL. |
| `@metaplex-foundation/mpl-token-metadata` | Heavy dependency tree (~15 packages). Only need 3-4 fields from token metadata. | Raw `getAccountInfo` + manual buffer parsing (20 lines). |
| `opossum` (circuit breaker) | Duplicates existing `RpcManager` failover logic that's already tested and working. | Enhance existing `RpcManager` if needed. |
| `prometheus-client` / `prom-client` | Overkill for single-process personal bot. Requires Prometheus server + Grafana setup. | `@fastify/under-pressure` for health + custom `/api/health` endpoint. |
| `@opentelemetry/*` | Distributed tracing for a single-process app adds complexity with no value. | Pino structured logs with trace IDs (mint as correlation key). |
| `node-cron` / `cron` | No scheduled jobs needed. Position monitoring is interval-based (already uses `setInterval`). | Continue using `setInterval` / `setTimeout` for periodic tasks. |
| `helmet` (standalone) | Express middleware, not Fastify-compatible. | `@fastify/helmet` (the Fastify wrapper). |
| `express-rate-limit` | Express middleware, not Fastify-compatible. | `@fastify/rate-limit` (native Fastify plugin). |
| `better-sqlite3-multiple-ciphers` | Encryption at rest is unnecessary for a personal bot on a private VPS. Adds complexity and performance overhead. | File system permissions + full-disk encryption at the OS level if needed. |

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `@fastify/rate-limit@^10.3` | `fastify@^5.0` | v10.x targets Fastify 5. Earlier v9.x was for Fastify 4. |
| `@fastify/helmet@^13.0` | `fastify@^5.0` | v13.x targets Fastify 5. Wraps helmet@^8. |
| `@fastify/under-pressure@^9.0` | `fastify@^5.0` | v9.x targets Fastify 5. Uses Node.js `monitorEventLoopDelay`. |
| `pino-roll@^4.0` | `pino@^9.0+` | Uses pino transport protocol. Works with any pino version that supports `transport` option. |
| All above | Node.js 22 LTS | All packages support Node.js 22. |

## Stack Patterns by Area

**If adding a new safety check:**
- Use existing `CheckResult` interface from `types/index.ts`
- Use `connection.getAccountInfo()` / `connection.getParsedProgramAccounts()` for on-chain data
- Return pessimistic defaults on error (pass=false for hard checks, score=0 for scoring signals)
- No new dependencies needed -- all on-chain queries use @solana/web3.js

**If adding a new dashboard endpoint:**
- Use existing Fastify route registration pattern (see `src/dashboard/routes/config.ts`)
- Validate request body with Zod schema + `.safeParse()`
- Emit events via `botEventBus` for SSE propagation
- New dependencies: none (covered by existing Fastify + Zod stack)

**If adding priority fee estimation:**
- POST to existing Helius RPC URL with `getPriorityFeeEstimate` JSON-RPC method
- Pass the serialized transaction for per-transaction fee estimation
- Use `ComputeBudgetProgram.setComputeUnitPrice()` from @solana/web3.js
- New dependencies: none

**If improving sell timing:**
- Use existing `getTokenAccountBalance` for on-chain balance checks
- Use existing Jupiter `quote` endpoint for price discovery
- Adjustments are to sell-ladder strategy logic, not library additions
- New dependencies: none

## Helius API Key Migration (Security Fix)

The tier3-creator.ts currently passes the Helius API key as a query parameter:
```
https://api-mainnet.helius-rpc.com/v0/addresses/{addr}/transactions?api-key={key}
```

Helius supports header-based authentication. The fix is to move the key to a header:
```typescript
const url = `${HELIUS_TX_URL}/${creator}/transactions?type=TOKEN_MINT&limit=10`;
const response = await fetch(url, {
  signal,
  headers: { 'Authorization': `Bearer ${heliusApiKey}` },
});
```

Note: The RPC URL (`SOLSNIPER_RPC_URL`) also contains the API key as a query parameter. This is standard for Solana RPC providers and is not a security concern since the URL is constructed from environment variables, never logged in full, and never exposed to users. The RPC connection is established once at startup and reused.

## Sources

- [@fastify/rate-limit npm](https://www.npmjs.com/package/@fastify/rate-limit) -- v10.3.0, Fastify 5 compatible
- [@fastify/helmet npm](https://www.npmjs.com/package/@fastify/helmet) -- v13.0.2, Fastify 5 compatible
- [@fastify/under-pressure GitHub](https://github.com/fastify/under-pressure) -- process load measurement plugin
- [pino-roll npm](https://www.npmjs.com/package/pino-roll) -- pino transport for file rotation
- [Helius Authentication Docs](https://www.helius.dev/docs/api-reference/authentication) -- API key via query param or header
- [Helius Priority Fee API](https://www.helius.dev/docs/priority-fee-api) -- getPriorityFeeEstimate JSON-RPC method
- [Solana Priority Fees Cookbook](https://solana.com/developers/cookbook/transactions/add-priority-fees) -- ComputeBudgetProgram usage
- [Solana Fee Structure](https://solana.com/docs/core/fees/fee-structure) -- priority fee calculation
- [SolRugDetector paper](https://arxiv.org/html/2603.24625) -- Solana rug pull detection patterns (freeze authority abuse, liquidity withdrawal, pump-and-dump)
- [How to Find Authorities - Helius Docs](https://www.helius.dev/docs/orb/explore-authorities) -- mint/freeze/update authority detection
- [better-sqlite3 SQL injection analysis](https://www.atdatabases.org/blog/2019/07/29/sql-injection-in-node) -- parameterized queries prevent injection; template literal with constant array is safe

---
*Stack research for: SolSniper v1.1 Hardening & Polish*
*Researched: 2026-03-27*
*Net new production dependencies: 4 (rate-limit, helmet, under-pressure, pino-roll)*
*Net new dev dependencies: 0*
