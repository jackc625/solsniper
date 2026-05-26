# External Integrations

**Analysis Date:** 2026-02-20

## Overview

This document describes external APIs, services, and data providers that the Solana sniping bot will integrate with. This is a **planning-stage project**; no implementation code exists yet. References are based on `solana-sniper-bot-research.md`.

## RPC Providers & Blockchain Access

**Primary RPC (Helius):**
- **Endpoint:** `https://mainnet-rpc.helius.dev/?api-key={API_KEY}`
- **Auth:** API key in environment variable `SOLANA_RPC_URL`
- **Plan:** Developer ($49/mo) or Business ($199/mo)
- **Features:**
  - Staked connections for transaction landing
  - Sender priority for confirmed transactions
  - Webhooks for account/transaction monitoring
  - getLatestBlockhash support with 'processed' commitment

**Backup RPC (Optional, Phase 2):**
- **Provider:** QuickNode or Chainstack
- **Endpoint:** `https://quick-rpc.com/` or Chainstack equivalent
- **Auth:** API key in environment variable `SOLANA_RPC_BACKUP_URLS` (comma-separated)
- **Multi-RPC Strategy:**
  - Send transactions to ALL providers simultaneously for best landing chance
  - Read operations use round-robin failover
  - See: `RpcManager` pattern in research doc (Section 10)

## DEX & Swap Execution

### Jupiter Swap API (Primary)

**Endpoints:**
- Quote: `GET https://api.jup.ag/swap/v1/quote`
- Swap Transaction: `POST https://api.jup.ag/swap/v1/swap`

**Usage:**
- Input: `inputMint`, `outputMint`, `amount` (in lamports), `slippageBps`, `maxAccounts`
- Output: Serialized base64 transaction ready to sign
- Response includes: `routePlan`, `priceImpactPct`, `outAmount`

**Key Parameters:**
```
slippageBps: Dynamic (set dynamicSlippage=true)
maxAccounts: 64 (limit route complexity, avoid tx size issues)
dynamicComputeUnitLimit: true (Jupiter simulates compute units)
dynamicSlippage: true (Jupiter estimates optimal slippage)
priorityLevel: 'veryHigh' (critical for congestion landing)
maxLamports: 1000000 (priority fee cap ~0.001 SOL)
```

**Flow:**
1. Get quote: Returns routable paths and expected output
2. Build swap tx: Returns serialized VersionedTransaction (V0)
3. Sign and send: Send via RPC with skipPreflight=true, maxRetries=0

**Failure Modes Handled:**
- `BlockhashNotFound` → Fetch fresh blockhash immediately before signing
- `SlippageToleranceExceeded` → Increase slippage on retry (escalate to 15-30%)
- `ComputationalBudgetExceeded` → Set higher compute units (400k-1.4M)
- `AccountNotFound` → Jupiter's `wrapAndUnwrapSol: true` creates ATA automatically
- No route returned → Token has no liquidity or is not tradable

**Rate Limits:** No documented limit; free to use

### PumpPortal Trade-Local API (Pump.fun Tokens)

**Endpoint:** `POST https://pumpportal.fun/api/trade-local`

**Request Format:**
```json
{
  "publicKey": "{USER_WALLET_ADDRESS}",
  "action": "buy",                    // or "sell"
  "mint": "{TOKEN_MINT}",
  "denominatedInSol": "true",
  "amount": 0.01,                     // SOL amount
  "slippage": 15,                     // percent
  "priorityFee": 0.0005,              // SOL (500 microlamports)
  "pool": "pump"                      // "pump" for bonding curve, "raydium" for migrated
}
```

**Response:**
- Returns `Uint8Array` binary transaction (ready to sign)
- Deserialize: `VersionedTransaction.deserialize(txBytes)`
- Sign: `tx.sign([wallet])`
- Send: `connection.sendRawTransaction(tx.serialize())`

**Fee Structure:**
- 0.5% per trade (both buy and sell)
- Example: 0.01 SOL buy = 0.00005 SOL fee
- Negligible for small positions; Phase 3 optimization: eliminate via direct program calls

**Use Cases:**
- **Best for:** Pump.fun tokens on bonding curve (pre-migration to Raydium)
- **Secondary:** Post-migration tokens that moved to Raydium
- **Advantage:** Single HTTP call vs Jupiter's quote + swap sequence

**Rate Limits:** Not documented; free tier available

### Direct Pump.fun Program Calls (Phase 3 Optional)

**Purpose:** Eliminate 0.5% PumpPortal fee via direct on-chain instruction building

**Complexity:** High — requires IDL parsing, manual instruction building, account lookups

**When to Implement:** After validating bot profitability and execution reliability

## Token Detection & Monitoring

### PumpPortal WebSocket (Primary Detection)

**Endpoint:** `wss://pumpportal.fun/api/data`

**Subscription Methods:**

1. **New Token Creation:**
   ```json
   { "method": "subscribeNewToken" }
   ```
   - Returns events with: `txType: 'create'`, `mint`, `name`, `symbol`, `creator`
   - Latency: ~100-300ms from token creation on-chain
   - Cost: Free

2. **Migration Events:**
   ```json
   { "method": "subscribeMigration" }
   ```
   - Triggered when pump.fun token migrates to Raydium
   - Returns: `txType: 'migrate'`, `mint`, new pool address
   - Cost: Free

3. **Trade Events (Real-time Price):**
   ```json
   { "method": "subscribeTokenTrade", "mint": "{TOKEN_MINT}" }
   ```
   - Real-time price updates (WebSocket stream)
   - Returns: `buyer`, `seller`, `amount`, `price`
   - Cost: Free

**Resilience:**
- WebSocket connections drop frequently
- Implement heartbeat every 30 seconds (`ws.ping()`)
- Exponential backoff reconnection (1s → 30s max)
- See: `createResilientWebSocket` pattern in research (Section 10)

### Solana logsSubscribe (Secondary Detection)

**Purpose:** Detect Raydium/other DEX pool creation (non-pump.fun tokens)

**RPC Call:**
```typescript
connection.onLogs(
  RAYDIUM_PROGRAM_ID,  // '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8'
  (logs) => {
    if (logs.logs.some(log => log.includes('InitializePool'))) {
      // New Raydium pool created
      parseAndHandleNewPool(logs);
    }
  },
  'processed'
);
```

**Latency:** ~50-200ms
**Cost:** Included in RPC subscription fee
**Commitment:** Use 'processed' for speed (vs 'confirmed')

## Safety & Risk Analysis

### RugCheck.xyz API (Token Risk Scoring)

**Endpoint:** `GET https://api.rugcheck.xyz/v1/tokens/{mint}/report`

**Response Format:**
```json
{
  "score": 450,           // 0-1000, higher = more risk
  "risks": [
    {
      "name": "MINT_AUTHORITY_ACTIVE",
      "level": "error|warn|info",
      "description": "..."
    }
  ]
}
```

**Key Risk Levels:**
- `level: "error"` → Score penalty -15
- `level: "warn"` → Score penalty -5
- Score > 500 → Safety penalty -30

**Integration (Phase 2):**
- Tier 2 check (recommended but non-blocking)
- Run in parallel with Tier 1 checks
- If slow (>500ms), don't wait — proceed with Tier 1 results
- Target: Incorporate within 300ms safety pipeline

**Rate Limits:** Free tier available; check Swagger docs for paid tiers

**URL:** https://api.rugcheck.xyz/swagger/index.html (API documentation)

## Token & Account Data

### Solana Chain Data (via RPC)

**Mint Account Information:**
```typescript
connection.getAccountInfo(mintPubkey)
// Parse SPL Token account data:
// - mintAuthority (null = immutable)
// - freezeAuthority (null = no freeze risk)
// - decimals
// - supply
// - isInitialized
```

**Associated Token Accounts (ATAs):**
```typescript
connection.getAssociatedTokenAccount(wallet, mint)
// Check if token account exists
// Cost: ~0.002 SOL to create if missing (Jupiter handles auto-creation)
```

**Largest Token Holders:**
```typescript
connection.getTokenLargestAccounts(mintPubkey)
// Check top 10 holder concentration
// Flag if top 10 > 30% of supply (excluding pool accounts)
```

**Pool Account Data:**
```typescript
connection.getAccountInfo(poolAddress)
// Parse Raydium pool state to calculate:
// - SOL reserves
// - Token reserves
// - Current price = SOL_reserve / Token_reserve
```

**Cost:** RPC call cost (included in RPC plan)

## External Data & Analytics (Optional, Phase 2+)

### Birdeye API

**Purpose:** Token price, volume, holder analytics (NOT for sniping signals)

**Endpoints:** Price, OHLCV, holders

**Latency:** 1-5 seconds (too slow for trading decisions)

**Use Cases:**
- Dashboard display of current holdings
- Historical PnL analysis
- Portfolio metrics

**Cost:** Free tier available

### DexScreener API

**Purpose:** Token metadata, price, trading data

**Latency:** 1-5 seconds

**Use Cases:** Dashboard, monitoring (not trading signals)

**Cost:** Free

## Webhook & Notification Services (Phase 2+)

### Telegram Bot Alerts

**Purpose:** Real-time alerts on trades, errors, stuck positions

**Implementation:**
- Telegram bot API: `https://api.telegram.org/bot{TOKEN}/sendMessage`
- Auth: Bot token in env var `TELEGRAM_BOT_TOKEN`
- Alert types:
  - Trade executed (buy/sell)
  - Safety check failed
  - Position stuck in SELLING state > 5 min
  - Daily loss exceeds threshold

**Cost:** Free (Telegram bot API)

### Discord Webhooks (Alternative)

**Purpose:** Same as Telegram (webhook-based)

**Implementation:**
- POST to Discord webhook URL
- Auth: Webhook URL in env var `DISCORD_WEBHOOK_URL`

**Cost:** Free

## Transaction Status & Monitoring

### Jito Block Engine (Phase 2)

**Endpoint:** `https://mainnet.block-engine.jito.wtf/api/v1/bundles`

**Purpose:** Atomic bundle execution, MEV protection

**Request Format:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "sendBundle",
  "params": [
    ["{base64_tx_1}", "{base64_tx_2}"],
    { "encoding": "base64" }
  ]
}
```

**Bundle Requirements:**
- Max 5 transactions per bundle
- Executed sequentially and atomically
- Last transaction must be a tip transaction
- Auction every ~200ms

**Tip Accounts (Random Selection):**
```
96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5
HFqU5x63VTqvQss8hp11i4bPg4W3Dn1iBASQ7XQHAHAH
... (8 total)
```

**Tip Amounts:**
- Minimum: 1,000 lamports
- Competitive: 10,000-100,000+ lamports (0.00001-0.0001 SOL)

**Cost:** Tip is paid directly to Jito (in lamports)

**Use Cases:**
- Critical sell transactions (guaranteed execution)
- Buy + sell sandwich (self-protect from MEV)
- Max retries when standard execution fails

**Adoption:** ~95% of Solana stake runs Jito validator (as of early 2026)

## Environment Configuration

**Required Environment Variables:**
```bash
# RPC Configuration
SOLANA_RPC_URL=https://mainnet-rpc.helius.dev/?api-key=YOUR_KEY
SOLANA_RPC_BACKUP_URLS=https://backup1.com,https://backup2.com

# Wallet
WALLET_PRIVATE_KEY=YOUR_BASE58_KEYPAIR

# Trading Parameters
MAX_BUY_AMOUNT_SOL=0.01
MAX_CONCURRENT_POSITIONS=5
STOP_LOSS_PCT=-30
TAKE_PROFIT_PCT=100
MIN_SAFETY_SCORE=50

# API Keys (Optional, Phase 2+)
RUGCHECK_API_KEY=optional
TELEGRAM_BOT_TOKEN=optional
DISCORD_WEBHOOK_URL=optional

# Database
DATABASE_PATH=./trades.db
```

**Secrets Storage:**
- **Local dev:** `.env` file (never commit)
- **Production VPS:** Environment variables set by deployment script, or encrypted secrets file
- **Sensitive:** Store wallet private key separately; consider hardware wallet for large balances

## Integration Sequence

### Phase 1 (MVP)
1. Helius RPC + PumpPortal WebSocket detection
2. Jupiter Swap API for buy/sell execution
3. RugCheck API (optional, Tier 2)
4. SQLite trade journal (local persistence)
5. Console logging

### Phase 2 (Robust)
1. Multi-RPC failover (add QuickNode/Chainstack)
2. Jito bundles for critical sells
3. Telegram/Discord alerts
4. Structured JSON logging (pino)
5. WebSocket reconnection resilience

### Phase 3 (Optimized)
1. Direct pump.fun program calls (eliminate 0.5% fee)
2. Geyser gRPC detection (replace WebSocket)
3. Birdeye/DexScreener for dashboard
4. Backtesting framework
5. Professional monitoring (Grafana Cloud)

## Data Flow Summary

```
PumpPortal WebSocket (detection)
  ↓
Run Tier 1 safety checks (in parallel):
  - Mint authority check (RPC)
  - Freeze authority check (RPC)
  - Sell simulation (Jupiter quote)
  ↓
Decision made (T+200-300ms)
  ↓
Build & sign transaction (Jupiter or PumpPortal API)
  ↓
Send via all RPC providers (multi-broadcast)
  ↓
Confirm transaction (RPC confirmTransaction)
  ↓
Record in SQLite journal
  ↓
Monitor position (PumpPortal trades or price polling)
  ↓
Exit on SL/TP (Jupiter sell or Jito bundle fallback)
```

---

*Integration audit: 2026-02-20*
*Source: solana-sniper-bot-research.md (Sections 3-6, 10, 12)*
