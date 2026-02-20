# Technology Stack

**Project:** SolSniper - Solana Token Sniper Bot
**Researched:** 2026-02-20
**Overall Confidence:** MEDIUM (versions from project research doc + training data; could not verify live npm registry)

## Recommended Stack

### Runtime & Language

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Node.js | 22 LTS | Runtime | Native `fetch`, stable LTS with performance improvements over 20. If 22 LTS is unavailable, 20 LTS is the floor. | HIGH |
| TypeScript | ^5.7 | Type safety | Strict mode catches entire classes of bugs at compile time. Solana ecosystem has excellent TS typings. TS 5.7 adds `--noUncheckedSideEffectImports` which helps with tree-shaking. | MEDIUM |
| tsx | ^4.19 | Dev runner | Zero-config TS execution. Faster than `tsc && node` for development iteration. Use `tsx watch` for hot reload during dev. | MEDIUM |

**Why TypeScript over Rust:** Developer velocity. The Solana TypeScript SDK ecosystem (`@solana/web3.js`, Jupiter API, PumpPortal) is mature and well-documented. Rust would add weeks of learning time for marginal latency gains. The bot's critical path bottleneck is network I/O (RPC calls, WebSocket latency), not CPU -- TypeScript is fast enough. Defer Rust optimization to Phase 3+ only if profiling proves CPU-bound bottlenecks.

### Solana Integration

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| `@solana/web3.js` | ^1.98 | Solana SDK | Battle-tested, vast community examples, stable API. Every open-source sniper bot uses v1.x. The v2 rewrite (`@solana/kit`) is architecturally superior but has fewer real-world usage examples for trading bots. | HIGH |
| `bs58` | ^6.0 | Base58 encode/decode | Required for Solana address and keypair handling. Lightweight, no alternatives needed. | HIGH |

**Why `@solana/web3.js` v1.x over `@solana/kit` v2.x:** The v2 kit has a functional, tree-shakeable API design, but as of early 2026, the vast majority of community tutorials, Stack Overflow answers, and reference bot implementations target v1.x. For a sniper bot where you need to move fast and debug quickly, community coverage matters more than API elegance. Migration to v2 can happen later when the ecosystem catches up.

### DEX & Swap Execution

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Jupiter Swap API (REST) | v1 endpoints | Primary swap routing | Industry-standard aggregator. Returns serialized transactions ready to sign. Dynamic slippage, compute budget, and priority fees built in. No SDK version management. | HIGH |
| PumpPortal trade-local API (REST) | Current | Pump.fun bonding curve trades | Single HTTP call returns ready-to-sign transaction. Fastest path for pre-migration tokens. 0.5% fee is acceptable for v1. | HIGH |
| Jito Block Engine API (REST) | Current | MEV-protected bundle execution | ~95% validator coverage. Atomic execution for critical sells. Direct HTTP to `mainnet.block-engine.jito.wtf`. No SDK required. | HIGH |

**Why Jupiter REST over `@jup-ag/api` SDK:** The SDK wraps the same REST endpoints but adds dependency management overhead. When Jupiter updates their API, the SDK lags behind. Direct REST calls give you immediate access to new features (like `dynamicSlippage`) without waiting for SDK releases. The HTTP overhead is negligible compared to quote computation time.

**Why NOT use `jito-ts` npm package:** The Jito block engine API is a simple JSON-RPC interface. The `jito-ts` package adds unnecessary abstraction over what amounts to a single `fetch` call. Build a thin wrapper (~30 lines) instead of taking on a dependency.

### Database

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| `better-sqlite3` | ^11.0 | Trade journal persistence | Synchronous API is simpler for journaling (no async/await overhead for writes). Zero-config, no separate process. Single-process bot means no concurrency issues. WAL mode gives good read performance during writes. | HIGH |

**Why SQLite over PostgreSQL:** This is a single-process, single-user bot. PostgreSQL would add operational complexity (separate process, connection pooling, migrations) with zero benefit. SQLite's synchronous writes are actually an advantage here -- when you write a trade state to the journal, it is guaranteed persisted before the next line executes. No "fire and forget" write that might be lost on crash.

**Why `better-sqlite3` over `sql.js` or `sqlite3`:** `better-sqlite3` is the fastest Node.js SQLite binding. It provides a synchronous API (which is correct for SQLite -- SQLite itself is synchronous). The `sqlite3` package uses an async callback API that adds unnecessary complexity. `sql.js` uses WASM and is slower.

### WebSocket & Networking

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| `ws` | ^8.18 | WebSocket client | Standard Node.js WebSocket library. Used for PumpPortal data stream and Solana RPC subscriptions. Mature, well-tested, supports ping/pong for heartbeats. | HIGH |
| Native `fetch` | Built-in (Node 22) | HTTP client | No external dependency needed. Used for Jupiter API, PumpPortal trade API, Jito bundle submission, RugCheck API. | HIGH |

**Why NOT `axios`:** Node 22 has a mature, spec-compliant `fetch` implementation. Adding `axios` would be an unnecessary dependency for functionality the runtime already provides.

### Logging & Observability

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| `pino` | ^9.0 | Structured JSON logging | Fastest Node.js logger (benchmarks show 5-10x faster than winston). JSON-native output is essential for parsing trade events programmatically. Child loggers enable per-trade context without global state. | HIGH |
| `pino-pretty` | ^13.0 | Dev log formatting | Human-readable log output during development. Production uses raw JSON piped to file. | MEDIUM |

**Why `pino` over `winston`:** Speed. In a latency-sensitive bot, logging should never be a bottleneck. Pino's design (async, JSON-native, minimal allocations) ensures logging adds <1ms overhead per call. Winston's transport system and format flexibility come at a measurable performance cost.

### Configuration

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| `dotenv` | ^16.4 | Environment variable loading | Simple, standard, loads `.env` file into `process.env`. Used for local development; production VPS uses real env vars. | HIGH |

### Process Management (Production)

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| PM2 | ^5.4 | Process manager | Auto-restart on crash, log rotation, memory monitoring, cluster mode (if needed later). Industry standard for Node.js production deployments. | HIGH |

### Testing

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| `vitest` | ^3.0 | Test framework | Fastest TypeScript test runner. Native ESM support, built-in mocking, watch mode. Same config format as Vite. Significantly faster than Jest for TypeScript projects (no separate transform step). | MEDIUM |

**Why `vitest` over `jest`:** Vitest runs TypeScript natively without needing `ts-jest` or `babel-jest` transformers. This means faster startup, no configuration headaches, and accurate source maps. For a bot that needs mock-heavy integration tests (mocking RPC responses, WebSocket events), Vitest's built-in mocking is cleaner than Jest's.

### Web Dashboard

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Next.js | ^15.0 | Dashboard framework | React-based, SSR for initial load, API routes for bot communication. Well-documented, strong TypeScript support. | MEDIUM |
| React | ^19.0 | UI library | Comes with Next.js. Component model is natural for a dashboard with live-updating trade feeds. | MEDIUM |
| Tailwind CSS | ^4.0 | Styling | Utility-first CSS. Fast to build dashboards without writing custom CSS. Built-in dark mode. | MEDIUM |
| Socket.IO or native SSE | Latest | Real-time updates | Push trade events, P&L updates, and alert notifications to the dashboard in real time. SSE is simpler if one-way server-to-client is sufficient. | LOW |

**Dashboard is Phase 2+.** The bot core (detection, safety, execution, position management) should be fully functional and profitable before investing in a dashboard. Use structured logs and SQLite queries for monitoring in Phase 1.

**Alternative considered: plain Express + vanilla HTML.** This would be lighter, but Next.js provides a much better developer experience for building interactive dashboards with real-time data. The overhead is justified by the P&L visualization, filter configuration UI, and trade feed requirements.

## Supporting Libraries (As Needed)

| Library | Version | Purpose | When to Add | Confidence |
|---------|---------|---------|-------------|------------|
| `@solana/spl-token` | ^0.4 | SPL token account parsing | Phase 1 -- needed for mint/freeze authority checks and ATA management | HIGH |
| `zod` | ^3.24 | Runtime validation | Phase 1 -- validate config, API responses, WebSocket messages at boundaries | HIGH |
| `eventemitter3` | ^5.0 | Typed event emitter | Phase 1 -- internal event bus for detection -> safety -> execution pipeline | MEDIUM |
| `uuid` | ^11.0 | Trade ID generation | Phase 1 -- unique IDs for trade journal entries | HIGH |
| `@types/ws` | ^8.5 | WebSocket type definitions | Phase 1 -- dev dependency | HIGH |
| `@types/better-sqlite3` | ^7.6 | SQLite type definitions | Phase 1 -- dev dependency | HIGH |

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Language | TypeScript/Node.js | Rust | Slower development velocity; network I/O is the bottleneck, not CPU; Rust Solana SDK has fewer trading bot examples |
| Language | TypeScript/Node.js | Python | Worse async performance; GIL limits concurrency; weaker typing for complex state machines |
| Solana SDK | `@solana/web3.js` v1.x | `@solana/kit` v2.x | Fewer community examples; ecosystem hasn't caught up; migration possible later |
| DEX SDK | Jupiter REST API | `@jup-ag/api` SDK | SDK lags behind REST API features; adds version management burden |
| DEX SDK | Jupiter REST API | Raydium SDK v2 | Only works for Raydium pools; Jupiter aggregates across all DEXs including Raydium |
| Jito | Direct HTTP | `jito-ts` npm package | Unnecessary abstraction; the API is a single JSON-RPC call |
| Database | SQLite (`better-sqlite3`) | PostgreSQL | Overkill for single-process bot; adds operational complexity with no benefit |
| Database | SQLite (`better-sqlite3`) | LevelDB/RocksDB | Less query flexibility; no SQL for ad-hoc analysis; harder to inspect state |
| Database | SQLite (`better-sqlite3`) | JSON file | No crash safety; no transactional writes; no query capability |
| Logging | `pino` | `winston` | Slower; format flexibility isn't needed (JSON is the only format) |
| HTTP | Native `fetch` | `axios` | Unnecessary dependency; Node 22 `fetch` is spec-compliant and sufficient |
| Testing | `vitest` | `jest` | Slower TS execution; requires transform configuration; no native ESM |
| Dashboard | Next.js | Express + EJS | Worse DX for interactive dashboards; no React component model; harder real-time updates |
| Dashboard | Next.js | SvelteKit | Smaller ecosystem; fewer UI component libraries; team has React experience assumed |
| Process Mgr | PM2 | systemd | PM2 is Node-aware; built-in log management; easier to configure than systemd units |
| Runtime | Node.js 22 | Bun | Bun's Solana ecosystem compatibility is untested; `better-sqlite3` native bindings may have issues |
| Runtime | Node.js 22 | Deno | Smaller npm compatibility surface; `better-sqlite3` native bindings require Node-API |

## RPC Provider Stack

| Provider | Role | Plan | Cost | Why |
|----------|------|------|------|-----|
| **Helius** | Primary RPC | Developer | $49/mo | Best Solana-native RPC. Staked connections for tx landing. Sender API for optimized submission. Parsed APIs reduce client-side work. 50 RPS is sufficient for a single bot. |
| **QuickNode** | Backup RPC | Starter | $49/mo (Phase 2) | Independent infrastructure from Helius. Adds true failover capability. Metis add-on provides Jupiter API integration. |

**Phase 1:** Helius Developer only ($49/mo). Single RPC is sufficient for simulation mode and initial live trading.

**Phase 2:** Add QuickNode as backup. Send transactions to both simultaneously for best landing chance.

**Why NOT Triton One for Phase 1:** Premium pricing ($300-1000+/mo) is not justified until the bot demonstrates profitability. Helius Developer tier provides staked connections which already optimize transaction landing.

## External API Stack

| API | Purpose | Cost | Phase |
|-----|---------|------|-------|
| PumpPortal WebSocket | Token detection (new tokens, migrations) | Free | Phase 1 |
| PumpPortal trade-local | Pump.fun bonding curve trades | 0.5% per trade | Phase 1 |
| Jupiter Swap API | Quote + swap transaction building | Free | Phase 1 |
| Jito Block Engine | MEV-protected bundle execution | Tip only (lamports) | Phase 1 (sells), Phase 2 (buys) |
| RugCheck.xyz API | Token safety scoring | Free tier | Phase 2 |
| Solana RPC logsSubscribe | Raydium pool detection | Included in RPC plan | Phase 1 |
| Birdeye / DexScreener | Dashboard price display | Free tier | Phase 3 (dashboard) |

## Installation

```bash
# Core dependencies
npm install @solana/web3.js@^1.98 @solana/spl-token@^0.4 bs58@^6.0 better-sqlite3@^11.0 ws@^8.18 pino@^9.0 dotenv@^16.4 zod@^3.24 eventemitter3@^5.0 uuid@^11.0

# Dev dependencies
npm install -D typescript@^5.7 tsx@^4.19 vitest@^3.0 @types/ws@^8.5 @types/better-sqlite3@^7.6 @types/uuid@^10.0 pino-pretty@^13.0

# Production process manager (global)
npm install -g pm2
```

## Project Configuration

### tsconfig.json (key settings)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "sourceMap": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### package.json (key scripts)

```json
{
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "tsc --noEmit"
  }
}
```

## Version Confidence Notes

All version numbers come from the project's research document (dated 2026-02-19) and training data through May 2025. I was unable to verify live npm registry versions due to tool restrictions. The `^` semver ranges provide flexibility for minor updates. Before implementation, run `npm info <package> version` for each dependency to confirm the latest available versions.

**Packages most likely to have newer versions than listed:**
- `typescript` -- releases frequently; 5.7+ is a conservative floor
- `vitest` -- rapidly evolving; 3.0 may have incremented
- `tsx` -- follows esbuild updates; version may be higher than 4.19
- `pino` -- stable; 9.x is likely still current

## Sources

- Project research document: `solana-sniper-bot-research.md` (Section 12: Tech Stack Recommendation) -- PRIMARY
- Existing stack analysis: `.planning/codebase/STACK.md` -- SECONDARY
- Training data (Claude knowledge cutoff May 2025) -- TERTIARY, LOW confidence for exact versions
- Unable to verify: npm registry (WebFetch denied), Context7 (not available), WebSearch (denied)
