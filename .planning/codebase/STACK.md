# Technology Stack

**Analysis Date:** 2026-02-20

## Overview

This is a **planning-stage project** for a Solana sniping bot. No implementation code exists yet; this stack reflects the recommended technology choices from `solana-sniper-bot-research.md`.

## Languages

**Primary:**
- TypeScript 5.5+ - Core bot implementation (Node.js 20+)
- JavaScript (ES2022+) - Runtime execution

**Secondary:**
- Rust (Phase 3 optimization) - For latency-critical execution paths (optional)

## Runtime

**Environment:**
- Node.js 20+ - Primary runtime for TypeScript execution
- Native `fetch` API available (Node 20+) — no external HTTP client required

**Package Manager:**
- npm or pnpm recommended
- Lockfile: Not yet present (to be created during implementation)

## Frameworks & Core Libraries

**Solana Integration:**
- `@solana/web3.js` v1.98 - Solana SDK, transactions, RPC client
  - v1.x is battle-tested with most community examples
  - Alternative: `@solana/kit` v2.x (newer but fewer examples available)

**DEX & Swap Execution:**
- Jupiter Swap API (REST) - Primary route aggregation and swap execution
  - Recommended over SDK (`@jup-ag/api`) for simplicity
  - Handles dynamic slippage, compute budget, priority fee configuration
- PumpPortal trade-local API (REST) - Pump.fun bonding curve token trading
  - Single HTTP call returns ready-to-sign transaction
  - 0.5% fee per trade (Phase 3 optimization: direct pump.fun program CPI to eliminate fee)

**Process Management (Production):**
- PM2 - Process manager for restart, logging, monitoring

**Database:**
- `better-sqlite3` v11.0 - SQLite client for trade journal persistence
  - Zero-config, fast for single-process bot
  - Alternative: PostgreSQL if scaling to multi-instance deployment

**Logging:**
- `pino` v9.0 - JSON-native structured logging (faster than winston)
- Alternative: `winston` for more flexible format options

**HTTP & Networking:**
- Native `fetch` (Node 20+) - Primary HTTP client
- `ws` v8.18 - WebSocket client for event subscriptions
  - PumpPortal WebSocket for token detection
  - Solana RPC WebSocket for logsSubscribe

**Utilities:**
- `bs58` v6.0 - Base58 encoding/decoding for Solana addresses
- `dotenv` v16.4 - Environment variable management (.env files)

## Testing & Development

**No testing framework configured yet.** Planned for Phase 1 implementation:
- **Test framework:** vitest or jest (recommended vitest for faster iteration)
- **Test mode:**
  - Simulation mode (shadow portfolio, no real transactions)
  - Mainnet simulation-only (build, sign, simulate without sending)
  - Tiny-wallet sacrificial trades (0.005 SOL position size for validation)

## Configuration

**Environment Variables:**
- `SOLANA_RPC_URL` - Primary RPC endpoint (Helius, QuickNode, or Chainstack)
- `SOLANA_RPC_BACKUP_URLS` - Comma-separated list of backup RPC endpoints
- `WALLET_PRIVATE_KEY` - Bot wallet keypair (base58 format)
- `MAX_BUY_AMOUNT_SOL` - Position size limit per trade
- `MAX_CONCURRENT_POSITIONS` - Max positions to hold simultaneously
- `STOP_LOSS_PCT` - Stop-loss threshold (e.g., -30)
- `TAKE_PROFIT_PCT` - Take-profit threshold (e.g., +100)
- `MIN_SAFETY_SCORE` - Minimum safety score to buy (0-100)
- `RPC_COMMITMENT` - 'processed', 'confirmed', or 'finalized'

**Secrets Management:**
- Local development: `.env` file (never commit)
- Production VPS: Environment variables + encrypted secrets file, or HashiCorp Vault (overkill for solo dev)
- **Critical:** Wallet private key is the most sensitive secret; consider hardware wallet for large balances

## Build & Compilation

**No build configuration yet.** Planned setup:
- `typescript` v5.5+ - TypeScript compiler
- `tsx` v4.0 - TypeScript execution runner (faster iteration than tsc + node)
- Output target: ES2022 module syntax

**Development Workflow:**
```bash
tsx watch src/index.ts  # Development with hot reload
tsx src/index.ts       # Direct execution
npm run build          # Compile to dist/
npm start              # Run compiled output
```

## RPC Providers

**Recommended Primary:**
- **Helius** - Best balance for trading bots
  - Free tier: 10 RPS, sufficient for dev/testing
  - Developer plan: $49/mo, 50 RPS, staked connections, webhooks
  - Business plan: $199/mo, 200 RPS, higher rate limits
  - Features: Sender for tx landing, parsed APIs, webhooks

**Recommended Backup:**
- **QuickNode** - Multi-chain support, Jupiter API integration
  - Starting: $49/mo
  - Features: Metis (Jupiter API add-on), multi-chain support

**Alternative:**
- **Chainstack** - Budget-friendly with gRPC support
  - Starting: $29/mo
  - Features: Multi-cloud, Geyser gRPC support
- **Triton One** - Professional option for lowest latency
  - Premium pricing (contact sales)
  - Features: Lowest latency, Yellowstone gRPC, staked connections

## External APIs

**Detection & Monitoring:**
- PumpPortal WebSocket (`wss://pumpportal.fun/api/data`) - Free
  - Token creation events, migration events (bonding curve → Raydium)
- Solana logsSubscribe RPC - Subscription cost included in RPC plan
  - Raydium pool creation monitoring

**Safety & Analysis:**
- RugCheck.xyz API (`https://api.rugcheck.xyz/v1/tokens/{mint}/report`) - Free tier available
  - Comprehensive token safety scoring and risk analysis
  - Tier 2 (recommended): Run in parallel, don't block buys if slow

**Price & Analytics (optional, Phase 2+):**
- Birdeye API - Token price and analytics (too slow for sniping, good for monitoring)
- DexScreener API - Dashboard display of holdings (not trading signals)

## MEV & Execution Enhancement

**Jito Bundles (Phase 2):**
- Endpoint: `https://mainnet.block-engine.jito.wtf/api/v1/bundles`
- Atomic execution (all-or-nothing)
- ~95% of Solana stake runs Jito validator client
- Use for critical sell transactions and guaranteed execution

## Database Schema (SQLite)

**trades table (persistent trade journal):**
```sql
CREATE TABLE trades (
  id TEXT PRIMARY KEY,
  mint TEXT NOT NULL,
  state TEXT NOT NULL,
  entry_price REAL,
  entry_amount REAL,
  entry_sol REAL,
  entry_signature TEXT,
  exit_price REAL,
  exit_amount REAL,
  exit_sol REAL,
  exit_signature TEXT,
  pnl_sol REAL,
  pnl_pct REAL,
  safety_score INTEGER,
  safety_flags TEXT,       -- JSON array
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  error_log TEXT          -- JSON array of errors
);
```

## Deployment

**Development:**
- Local machine with .env file containing secrets

**Production:**
- VPS options:
  - **Basic:** Hetzner/Vultr CX21 (2vCPU, 4GB RAM) - $5-15/mo
  - **Standard:** CX31 (4vCPU, 8GB RAM) - $15-40/mo
  - **Professional:** Co-located with RPC provider for lowest latency
- Process manager: PM2 for restart, log management, monitoring
- VPS location: US-East datacenter preferred (proximity to Solana validators)

## Cost Breakdown (Tier 1: Minimum Viable)

| Item | Cost | Notes |
|------|------|-------|
| Helius RPC | $49/mo | Developer plan, 50 RPS |
| VPS | $5-10/mo | Hetzner CX21, 2vCPU, 4GB RAM |
| PumpPortal Trading | 0.5% per trade | ~$0.005 per 0.01 SOL trade |
| Trading capital | 0.5-2 SOL | Sacrificial wallet for testing |
| **Total** | **~$55-60/mo + capital** | |

## Technology Decision Rationale

| Decision | Why Not Alternative |
|----------|---------------------|
| TypeScript over Rust | Matches developer skill level; ample ecosystem; later Rust optimization if needed |
| @solana/web3.js v1 over v2 | v1 is battle-tested; v2 is newer but fewer examples |
| Jupiter REST API over SDK | Simpler integration; no SDK version management needed; same underlying API |
| PumpPortal trade-local over direct CPI | Easier to implement; 0.5% fee negligible initially; Phase 3 optimization available |
| SQLite over PostgreSQL | Single-process bot; zero configuration; fast; scales to VPS easily later |
| better-sqlite3 over pg | Synchronous API simpler for journaling; no connection pool needed |
| pino over winston | Faster; JSON-native; structured logging preferred for operational insights |

---

*Stack analysis: 2026-02-20*
*Source: solana-sniper-bot-research.md (Section 12: Tech Stack Recommendation)*
