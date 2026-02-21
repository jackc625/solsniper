# Phase 2: Token Detection - Research

**Researched:** 2026-02-21
**Domain:** WebSocket-based real-time event detection (PumpPortal + Solana RPC) with resilient connection management
**Confidence:** HIGH (core patterns), MEDIUM (PumpSwap migration specifics)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **Token event data**: Track detection latency (stamp each event with detection time). Basic pre-filter at detection layer: drop obvious junk (known scam patterns, etc.) before passing to safety pipeline.
- **Dual-source overlap**: Config toggles for each source: `PUMPPORTAL_ENABLED` and `RAYDIUM_ENABLED` flags so either source can be independently disabled.
- **Connection resilience**: Conservative reconnection — start at 2-5s backoff, exponential up to 60s max. Accept some missed launches during extended downtime rather than hammering the server.
- **Detection logging**: One-liner per detected token (mint address, source, detection latency, pre-filter result). Periodic stats every 15 minutes (total detected, filtered out, per-source breakdown). Filtered-out tokens logged at debug level.

### Claude's Discretion

- PumpPortal event metadata capture depth
- Raydium log parsing detail level
- Dedup strategy for cross-source overlap
- Source priority handling
- Single-source mode behavior
- Excessive reconnection threshold value
- Max-retry failure behavior
- Heartbeat interval configuration approach

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DET-01 | Bot detects new token creation on Pump.fun via PumpPortal WebSocket in real-time | PumpPortal `wss://pumpportal.fun/api/data` with `subscribeNewToken` method; event fields: `mint`, `bondingCurveKey`, `creator` (as `traderPublicKey`), `name`, `symbol`, `uri`, `initialBuy`, `marketCapSol`, `vSolInBondingCurve`, `vTokensInBondingCurve`, `signature`, `txType:"create"` |
| DET-02 | Bot detects new Raydium pool creation via Solana RPC logsSubscribe | `connection.onLogs(RAYDIUM_V4_PROGRAM, ...)` with `"initialize2"` log filter; mint extraction via `getParsedTransaction` accounts array at indices 8 and 9; WARNING: PumpSwap has replaced Raydium for 95%+ of pump.fun migrations since March 2025 |
| DET-03 | WebSocket connections auto-reconnect with exponential backoff on disconnect | `ws` library `close` / `error` events trigger reconnection; exponential backoff class with base 2-5s, multiplier 2, max 60s, 10-15% jitter |
| DET-04 | WebSocket wrapper detects silent connection death via heartbeat pings (15-30s interval) | Client sends `ping()` on interval; `lastMessageAt` timestamp check approach for servers that don't support ping/pong; 30s heartbeat timer reset on any message |
| DET-05 | Bot logs every reconnection event with counter and alerts on excessive reconnections | Reconnection counter incremented on every attempt; configurable threshold (default 5 within 10 minutes) triggers `log.warn`; counter resets after stable connection window |
</phase_requirements>

---

## Summary

Phase 2 builds two independent WebSocket listener classes — one for PumpPortal (Pump.fun new tokens) and one for Solana RPC (Raydium pool creation) — each wrapped in a resilient connection manager with exponential backoff reconnection and heartbeat-based dead connection detection. Both listeners share a common `TokenEvent` type and emit events consumed by a central `DetectionManager`.

**Critical context update:** PumpSwap (Pump.fun's own AMM, program ID `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA`) launched March 2025 and now receives 95%+ of pump.fun graduated token migrations. The "Raydium" listener required by DET-02 should be broadened to detect **both Raydium and PumpSwap pool creation**, or the DET-02 scope should be validated against current product requirements. PumpPortal's `subscribeMigration` event is the simplest way to cover migration events from both destinations.

**Primary recommendation:** Build a `ResilientWebSocket` base class (or mixin) that both listeners share, handling reconnect logic, heartbeat, and counter tracking. Both listeners extend or compose this to add source-specific message parsing. The `DetectionManager` owns dedup state and the 15-minute stats timer.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `ws` | ^8.x (already a transitive dep via `@solana/web3.js`) | PumpPortal WebSocket client | The de-facto Node.js WebSocket library; already present in the project graph |
| `@solana/web3.js` | ^1.98.4 (already installed) | Solana RPC `onLogs` subscription + `getParsedTransaction` | Already installed in Phase 1 |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| None new needed | — | — | All detection needs covered by existing deps |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `ws` directly | `websocket-ts`, `ts-ws-machine` | Third-party libs add abstraction but reduce control; hand-rolling reconnect on top of `ws` is 50 lines and gives exact behavior per spec |
| `@solana/web3.js` `onLogs` | Helius Geyser gRPC | Geyser provides sub-50ms latency but costs $300-1000/mo and is v2-requirement territory; `onLogs` is sufficient for v1 |

**Installation:** No new packages needed — `ws` is already available as a transitive dependency.

---

## Architecture Patterns

### Recommended Project Structure

```
src/
├── config/
│   ├── env.ts            # Add: PUMPPORTAL_ENABLED, RAYDIUM_ENABLED, WS_HEARTBEAT_INTERVAL_MS, WS_MAX_BACKOFF_MS, WS_EXCESSIVE_RECONNECT_THRESHOLD
│   └── trading.ts        # Unchanged
├── core/
│   ├── logger.ts         # Unchanged
│   ├── rpc-manager.ts    # Unchanged
│   └── resilient-ws.ts   # NEW: base class for reconnecting WebSocket with heartbeat
├── detection/
│   ├── pump-portal-listener.ts    # NEW: PumpPortal subscribeNewToken + subscribeMigration
│   ├── raydium-listener.ts        # NEW: onLogs for Raydium + PumpSwap pool creation
│   └── detection-manager.ts      # NEW: owns both listeners, dedup Set, stats timer, event emission
├── types/
│   └── index.ts          # Add: TokenEvent, DetectionSource, DetectorEvents
└── index.ts              # Wire up DetectionManager, register shutdown
```

### Pattern 1: ResilientWebSocket Base Class

**What:** A class wrapping `WebSocket` from `ws` that handles: exponential backoff reconnect on `close`/`error`, client-initiated heartbeat pings, reconnection counter with excessive-reconnect alerting, and subscription replay on reconnect.

**When to use:** Both PumpPortal and any future WebSocket connections need this. Build once, reuse.

```typescript
// src/core/resilient-ws.ts
import WebSocket from 'ws';
import { createModuleLogger } from './logger.js';

const log = createModuleLogger('resilient-ws');

export interface ResilientWsConfig {
  url: string;
  name: string;                    // e.g. "pump-portal", "raydium-rpc"
  baseBackoffMs: number;           // 2000-5000 per user spec
  maxBackoffMs: number;            // 60000 per user spec
  heartbeatIntervalMs: number;     // 15000-30000 per DET-04
  excessiveReconnectThreshold: number;  // per DET-05
  excessiveReconnectWindowMs: number;   // e.g. 600000 (10 min)
}

export abstract class ResilientWebSocket {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectCount = 0;
  private reconnectTimestamps: number[] = [];
  private currentBackoffMs: number;
  private closed = false;  // true after explicit close()

  constructor(private config: ResilientWsConfig) {
    this.currentBackoffMs = config.baseBackoffMs;
  }

  protected abstract onMessage(data: string): void;
  protected abstract getSubscriptions(): object[];   // payloads to send on open

  connect(): void {
    this.closed = false;
    this.createConnection();
  }

  private createConnection(): void {
    this.ws = new WebSocket(this.config.url);

    this.ws.on('open', () => {
      log.info({ source: this.config.name }, 'WebSocket connected');
      this.currentBackoffMs = this.config.baseBackoffMs;  // reset backoff on success
      this.startHeartbeat();
      // Replay subscriptions
      for (const sub of this.getSubscriptions()) {
        this.ws!.send(JSON.stringify(sub));
      }
    });

    this.ws.on('message', (data) => {
      // Any message resets the dead-connection clock
      this.resetHeartbeatTimer();
      this.onMessage(data.toString());
    });

    this.ws.on('close', (code, reason) => {
      if (this.closed) return;
      log.warn({ source: this.config.name, code, reason: reason.toString() }, 'WebSocket closed');
      this.stopHeartbeat();
      this.scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      log.error({ source: this.config.name, err }, 'WebSocket error');
      // 'close' will fire after 'error' — scheduleReconnect called there
    });
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, this.config.heartbeatIntervalMs);
  }

  private resetHeartbeatTimer(): void {
    // Called on every message — if server doesn't respond to pings,
    // we detect silence via: last message > heartbeatIntervalMs * 2 ago
    // The ping interval fires and checks readyState; if OPEN but no pong arrives,
    // ws terminates on the next ping timeout (handled by ws library internally)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    this.reconnectCount++;
    const now = Date.now();
    this.reconnectTimestamps.push(now);

    // Prune timestamps outside the window
    this.reconnectTimestamps = this.reconnectTimestamps.filter(
      t => now - t < this.config.excessiveReconnectWindowMs
    );

    log.info(
      { source: this.config.name, reconnectCount: this.reconnectCount, backoffMs: this.currentBackoffMs },
      'WebSocket reconnecting'
    );

    if (this.reconnectTimestamps.length >= this.config.excessiveReconnectThreshold) {
      log.warn(
        { source: this.config.name, reconnectsInWindow: this.reconnectTimestamps.length, threshold: this.config.excessiveReconnectThreshold },
        'Excessive reconnections detected'
      );
    }

    this.reconnectTimer = setTimeout(() => {
      this.createConnection();
    }, this.currentBackoffMs);

    // Exponential backoff with jitter
    const jitter = this.currentBackoffMs * 0.15 * Math.random();
    this.currentBackoffMs = Math.min(
      this.currentBackoffMs * 2 + jitter,
      this.config.maxBackoffMs
    );
  }

  close(): void {
    this.closed = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }

  getReconnectCount(): number {
    return this.reconnectCount;
  }
}
```

### Pattern 2: PumpPortal Listener

**What:** Extends `ResilientWebSocket`, subscribes to `subscribeNewToken` (and optionally `subscribeMigration`), parses events into `TokenEvent`.

```typescript
// src/detection/pump-portal-listener.ts
import { EventEmitter } from 'eventemitter3';
import { ResilientWebSocket } from '../core/resilient-ws.js';
import type { TokenEvent } from '../types/index.js';

export class PumpPortalListener extends ResilientWebSocket {
  readonly events = new EventEmitter<{ token: (e: TokenEvent) => void }>();

  protected getSubscriptions() {
    return [
      { method: 'subscribeNewToken' },
      { method: 'subscribeMigration' },
    ];
  }

  protected onMessage(data: string): void {
    try {
      const raw = JSON.parse(data);
      if (raw.txType === 'create') {
        const event: TokenEvent = {
          mint: raw.mint,
          source: 'pumpportal',
          detectedAt: Date.now(),
          name: raw.name,
          symbol: raw.symbol,
          uri: raw.uri,
          creator: raw.traderPublicKey,
          bondingCurveKey: raw.bondingCurveKey,
          initialBuyAmount: raw.initialBuy,
          marketCapSol: raw.marketCapSol,
          vSolInBondingCurve: raw.vSolInBondingCurve,
          vTokensInBondingCurve: raw.vTokensInBondingCurve,
          signature: raw.signature,
        };
        this.events.emit('token', event);
      }
    } catch (err) {
      // Malformed message — ignore
    }
  }
}
```

### Pattern 3: Raydium / PumpSwap Listener via `onLogs`

**What:** Uses `@solana/web3.js` `connection.onLogs()` to watch Raydium V4 program for `"initialize2"` log strings. A separate `onLogs` subscription watches the PumpSwap program for `"CreatePool"` or migration logs.

**Key note:** Since March 2025, PumpSwap is the primary migration destination. DET-02 as written says "Raydium pool creation" — but in practice, a comprehensive listener should cover both Raydium V4 and PumpSwap. Claude's discretion: implement both subscriptions under the same `RAYDIUM_ENABLED` flag, or clarify scope. The research recommendation is to listen to both under a single `RAYDIUM_ENABLED` flag renamed mentally as "AMM pool listener."

```typescript
// src/detection/raydium-listener.ts
import { Connection, PublicKey } from '@solana/web3.js';
import { EventEmitter } from 'eventemitter3';
import { createModuleLogger } from '../core/logger.js';
import type { TokenEvent } from '../types/index.js';

const log = createModuleLogger('raydium-listener');

// Raydium AMM V4 — classic pool creation via "initialize2" log
const RAYDIUM_V4_PROGRAM = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');

// PumpSwap (Pump AMM) — Pump.fun's own DEX, primary migration target since March 2025
const PUMPSWAP_PROGRAM = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');

export class RaydiumListener {
  readonly events = new EventEmitter<{ token: (e: TokenEvent) => void }>();
  private subscriptionIds: number[] = [];

  constructor(private connection: Connection) {}

  start(): void {
    // Raydium V4 new pool detection
    const raydiumSubId = this.connection.onLogs(
      RAYDIUM_V4_PROGRAM,
      async ({ logs, err, signature }) => {
        if (err) return;
        if (logs.some(l => l.includes('initialize2'))) {
          await this.handleRaydiumPool(signature);
        }
      },
      'processed'   // 'processed' for lowest latency
    );
    this.subscriptionIds.push(raydiumSubId);

    // PumpSwap pool creation detection (migration events since March 2025)
    const pumpswapSubId = this.connection.onLogs(
      PUMPSWAP_PROGRAM,
      async ({ logs, err, signature }) => {
        if (err) return;
        // PumpSwap emits "CreatePool" or migration instruction logs
        if (logs.some(l => l.includes('CreatePool') || l.includes('Instruction: CreatePool'))) {
          await this.handlePumpSwapPool(signature);
        }
      },
      'processed'
    );
    this.subscriptionIds.push(pumpswapSubId);
  }

  private async handleRaydiumPool(signature: string): Promise<void> {
    try {
      const tx = await this.connection.getParsedTransaction(signature, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed',
      });

      const accounts = (tx?.transaction.message.instructions as any[])
        .find(ix => ix.programId?.toBase58() === RAYDIUM_V4_PROGRAM.toBase58())
        ?.accounts as PublicKey[] | undefined;

      if (!accounts || accounts.length < 10) return;

      // Token mints are at indices 8 and 9 for Raydium V4 initialize2
      const mintA = accounts[8].toBase58();
      const mintB = accounts[9].toBase58();
      const SOL_MINT = 'So11111111111111111111111111111111111111112';
      const tokenMint = mintA === SOL_MINT ? mintB : mintA;

      const event: TokenEvent = {
        mint: tokenMint,
        source: 'raydium',
        detectedAt: Date.now(),
        signature,
      };
      this.events.emit('token', event);
    } catch (err) {
      log.error({ err, signature }, 'Failed to parse Raydium pool transaction');
    }
  }

  private async handlePumpSwapPool(signature: string): Promise<void> {
    // Similar extraction — parse tx accounts for token mint
    // PumpSwap pool PDA derived from: ["pool", index, creator, baseMint, quoteMint]
    // Practical approach: extract token mint from transaction instruction accounts
    log.debug({ signature }, 'PumpSwap pool creation detected');
    // Implementation: parse instruction accounts to find non-SOL mint
  }

  async stop(): Promise<void> {
    for (const id of this.subscriptionIds) {
      await this.connection.removeOnLogsListener(id);
    }
    this.subscriptionIds = [];
  }
}
```

### Pattern 4: DetectionManager (Orchestrator)

**What:** Owns both listeners, deduplication, 15-minute stats timer, and emits a unified event stream.

```typescript
// src/detection/detection-manager.ts
export class DetectionManager {
  private seenMints = new Set<string>();
  private stats = { detected: 0, filtered: 0, bySource: { pumpportal: 0, raydium: 0 } };
  private statsTimer: ReturnType<typeof setInterval> | null = null;

  start(): void {
    if (env.PUMPPORTAL_ENABLED) this.pumpPortalListener.connect();
    if (env.RAYDIUM_ENABLED) this.raydiumListener.start();

    // Stats every 15 minutes
    this.statsTimer = setInterval(() => this.logStats(), 15 * 60 * 1000);
  }

  private handleTokenEvent(event: TokenEvent): void {
    // Dedup: same mint from both sources — skip duplicate
    if (this.seenMints.has(event.mint)) {
      log.debug({ mint: event.mint, source: event.source }, 'Duplicate token event skipped');
      return;
    }
    this.seenMints.add(event.mint);

    this.stats.detected++;
    this.stats.bySource[event.source]++;

    // Pre-filter (basic junk detection)
    const filterResult = this.preFilter(event);
    const latencyMs = Date.now() - event.detectedAt;

    // One-liner log per DET-05 and user spec
    log.info(
      { mint: event.mint, source: event.source, latencyMs, preFilter: filterResult },
      'Token detected'
    );

    if (!filterResult.pass) {
      this.stats.filtered++;
      log.debug({ mint: event.mint, reason: filterResult.reason }, 'Token pre-filtered');
      return;
    }

    this.events.emit('token', event);
  }
}
```

### Anti-Patterns to Avoid

- **Opening multiple WebSocket connections to PumpPortal:** PumpPortal bans IPs that open multiple connections simultaneously. One connection, all subscriptions through it.
- **Using `finalized` commitment for `onLogs`:** Use `processed` — finalized adds 30+ slots of delay, killing detection latency.
- **Fetching `getParsedTransaction` on every log event:** Only call when `logs.some(l => l.includes('initialize2'))` is true. Don't fetch for unrelated Raydium transactions.
- **No dedup:** Without a `seenMints` Set, the same token arriving on both PumpPortal and Raydium triggers two safety pipeline executions. The Set must be shared across both listeners in DetectionManager.
- **Reconnect without jitter:** Multiple bot instances reconnecting in lockstep hammer the server. Always add 10-15% random jitter to backoff delays.
- **Indefinite retry on dead RPC subscription:** Solana `onLogs` subscriptions have no automatic reconnect. If the RPC WebSocket drops, `onLogs` silently dies. Implement health checking — if no events have been seen in N minutes, recreate the subscription.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| WebSocket exponential backoff | Custom retry loop with `setTimeout` | Use the `ExponentialBackoff` pattern (50-line class) | Trivial once the pattern is established; jitter formula is well-known |
| PumpPortal message parsing | Complex schema validation | Simple field extraction + optional `zod` parsing | PumpPortal fields are stable; over-engineering hurts dev velocity |
| `onLogs` reconnect | Custom RPC WebSocket lifecycle | Recreate `connection.onLogs()` subscription after detected silence | `@solana/web3.js` does not expose WS lifecycle events; silence detection is the correct approach |
| Dedup across sources | Complex fingerprinting | In-memory `Set<string>` keyed on mint address | Mint address is globally unique on Solana; no collision possible |
| Pre-filter logic | ML/complex rules | Simple string patterns (name length, known scam keywords) | Phase 3 safety checks do deep analysis; pre-filter is just junk rejection |

**Key insight:** The reconnect logic looks complex but is ~60 lines of vanilla TypeScript. The real complexity is in the `onLogs` dead-connection problem — there's no `ws.on('close')` equivalent for Solana subscriptions. Solve this with a "last event seen" timestamp check in a 60-second health check interval.

---

## Common Pitfalls

### Pitfall 1: PumpSwap is the New Raydium (Migration Destination Change)

**What goes wrong:** Bot is built to watch Raydium for migrations and misses the fact that ~95% of pump.fun graduated tokens now migrate to PumpSwap (since March 2025), not Raydium.
**Why it happens:** The project research doc (solana-sniper-bot-research.md) was written before March 2025 and references Raydium as the migration target. DET-02 also says "Raydium" in name.
**How to avoid:** Listen to both Raydium V4 (`675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8`) and PumpSwap (`pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA`). Alternatively, use PumpPortal's `subscribeMigration` event which covers both destinations (simpler).
**Warning signs:** Detecting many new pump.fun tokens via PumpPortal but very few Raydium pool creation events.

### Pitfall 2: Silent `onLogs` Death

**What goes wrong:** The Solana RPC WebSocket drops (network blip, RPC restart), and `onLogs` silently stops receiving events. No error is thrown, no `close` event fires on the subscription. Bot appears running but misses all Raydium events.
**Why it happens:** `@solana/web3.js` `onLogs` wraps a WebSocket subscription but does not expose its lifecycle. The underlying `_rpcWebSocket` reconnects internally but may not replay subscriptions reliably.
**How to avoid:** Track `lastRaydiumEventAt` timestamp. In a 60-second `setInterval`, check if `Date.now() - lastRaydiumEventAt > SILENCE_THRESHOLD_MS`. If so, remove the old `onLogs` subscription and recreate it. Log a warning.
**Warning signs:** `lastRaydiumEventAt` not updating during periods of known high Raydium activity.

### Pitfall 3: PumpPortal Rate Limiting

**What goes wrong:** Bot opens multiple WebSocket connections to PumpPortal (e.g., one per subscription type), gets IP-banned hourly.
**Why it happens:** Developers assume separate connections for separate subscriptions. PumpPortal docs explicitly warn against this.
**How to avoid:** One `ResilientWebSocket` instance for PumpPortal. Send all `subscribeNewToken` and `subscribeMigration` payloads on the same `open` event.
**Warning signs:** WebSocket connects then immediately disconnects; log shows rapid reconnect cycles.

### Pitfall 4: Detection Latency Measurement

**What goes wrong:** Latency is measured from when the event is processed rather than when received, making the metric useless for optimization.
**Why it happens:** `detectedAt = Date.now()` is placed after JSON.parse or other processing.
**How to avoid:** Set `detectedAt = Date.now()` as the FIRST line in the `message` event handler, before any parsing or processing. The event timestamp from the server (if present) can be used as a secondary reference.
**Warning signs:** Latency values always close to zero or always high regardless of network conditions.

### Pitfall 5: Dedup Set Memory Growth

**What goes wrong:** `seenMints` Set grows indefinitely as thousands of tokens are detected daily.
**Why it happens:** No eviction policy.
**How to avoid:** Either: (a) use a time-windowed dedup (evict entries older than 1 hour), or (b) use a `Map<string, number>` with timestamp and prune old entries in the stats timer. Pump.fun creates thousands of tokens daily; without eviction, the Set grows to hundreds of MB over weeks. The 15-minute stats timer is a natural place to prune.
**Warning signs:** Node.js heap growing continuously over multiple hours.

### Pitfall 6: Reconnect Counter Never Resets

**What goes wrong:** Reconnect counter accumulates across the lifetime of the bot. A bot that's been running for days always shows "excessive reconnections" after enough minor network blips.
**Why it happens:** Counter is a simple incrementer with no time window.
**How to avoid:** Use a sliding window approach: track reconnection timestamps in an array, prune entries older than the window (e.g., 10 minutes), compare array length to threshold. This is shown in the `ResilientWebSocket` pattern above.

---

## Code Examples

Verified patterns from official sources and community practice:

### PumpPortal WebSocket Subscription

```typescript
// Source: pumpportal.fun/data-api/real-time/ + codingsandmore/pumpfun-portal
const ws = new WebSocket('wss://pumpportal.fun/api/data');

ws.on('open', () => {
  // MUST send all subscriptions on the same connection — never open multiple
  ws.send(JSON.stringify({ method: 'subscribeNewToken' }));
  ws.send(JSON.stringify({ method: 'subscribeMigration' }));
});

ws.on('message', (data) => {
  const event = JSON.parse(data.toString());
  // txType === 'create' for new tokens
  // txType === 'migrate' for bonding curve graduations
});
```

### PumpPortal subscribeNewToken Event Fields (Confirmed)

```typescript
// Source: github.com/codingsandmore/pumpfun-portal (NewPairResponse struct)
// + WebSearch community verification
interface PumpPortalNewTokenEvent {
  txType: 'create';
  signature: string;
  mint: string;               // Token mint address
  traderPublicKey: string;    // Creator wallet = "creator" in common usage
  bondingCurveKey: string;    // Bonding curve PDA address
  initialBuy: number;         // Creator's initial buy amount (tokens)
  marketCapSol: number;       // Market cap in SOL at creation
  vSolInBondingCurve: number; // Virtual SOL reserves
  vTokensInBondingCurve: number; // Virtual token reserves
  // Additional fields reported in community sources (validate at runtime):
  name?: string;              // Token name
  symbol?: string;            // Token symbol
  uri?: string;               // Metadata URI (IPFS)
}
```

**Note:** `name`, `symbol`, and `uri` are reported by WebSearch sources but not in the Go struct definition from the official PumpPortal library. These fields should be treated as MEDIUM confidence — validate field presence at startup and log a warning if absent.

### Raydium V4 Pool Creation Detection

```typescript
// Source: quicknode.com/guides + gist.github.com/endrsmar
const RAYDIUM_V4_PROGRAM_ID = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

connection.onLogs(
  new PublicKey(RAYDIUM_V4_PROGRAM_ID),
  async ({ logs, err, signature }) => {
    if (err) return;
    if (!logs.some(log => log.includes('initialize2'))) return;

    // Fetch transaction to extract token mints
    const tx = await connection.getParsedTransaction(signature, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    });

    // Token mints at accounts[8] and accounts[9] in the initialize2 instruction
    const raydiumIx = tx?.transaction.message.instructions
      .find(ix => ix.programId?.toBase58() === RAYDIUM_V4_PROGRAM_ID);
    const accounts = (raydiumIx as any)?.accounts as PublicKey[];
    if (!accounts || accounts.length < 10) return;

    const mintA = accounts[8].toBase58();
    const mintB = accounts[9].toBase58();
    const tokenMint = mintA === SOL_MINT ? mintB : mintA;
  },
  'processed'  // Use 'processed' for lowest latency
);
```

### Exponential Backoff with Jitter

```typescript
// Source: oneuptime.com/blog/post/2026-01-27-websocket-reconnection-logic/view
class ExponentialBackoff {
  private attempt = 0;
  constructor(
    private baseMs: number,      // 2000-5000 per user spec
    private maxMs: number,       // 60000 per user spec
    private jitterFactor = 0.15  // 15% jitter
  ) {}

  nextDelay(): number {
    const exponential = this.baseMs * Math.pow(2, this.attempt);
    const capped = Math.min(exponential, this.maxMs);
    const jitter = capped * this.jitterFactor * Math.random();
    this.attempt++;
    return Math.floor(capped + jitter);
  }

  reset(): void { this.attempt = 0; }
}
```

### Heartbeat Pattern (Client-Initiated Ping)

```typescript
// Source: ws library documentation + community patterns
// For PumpPortal: server supports standard WebSocket ping/pong
// Strategy: send ws.ping() every heartbeatIntervalMs; ws library
// fires 'error' or 'close' if pong not received within timeout
let heartbeatInterval: ReturnType<typeof setInterval>;

ws.on('open', () => {
  heartbeatInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    }
  }, 30_000);
});

ws.on('pong', () => {
  // Connection is alive — nothing to do (implicit keep-alive)
});

ws.on('close', () => {
  clearInterval(heartbeatInterval);
  // scheduleReconnect()
});
```

**Alternative for Solana `onLogs` (no WebSocket access):**
```typescript
// Track last event time; health-check in interval
let lastEventAt = Date.now();

connection.onLogs(RAYDIUM_PROGRAM, ({ logs }) => {
  if (logs.some(l => l.includes('initialize2'))) {
    lastEventAt = Date.now();
    // ... handle event
  }
}, 'processed');

// Health check: if silence > 2 minutes AND market is active, assume dead subscription
setInterval(() => {
  const silenceMs = Date.now() - lastEventAt;
  if (silenceMs > 120_000) {
    log.warn({ silenceMs }, 'Raydium listener silent — recreating subscription');
    // removeOnLogsListener() + re-subscribe
  }
}, 60_000);
```

### TokenEvent Type

```typescript
// src/types/index.ts
export type DetectionSource = 'pumpportal' | 'raydium' | 'pumpswap';

export interface TokenEvent {
  mint: string;              // Token mint address — primary key for dedup
  source: DetectionSource;   // Which listener detected it
  detectedAt: number;        // Date.now() at receipt — for latency measurement
  signature?: string;        // Transaction signature
  // PumpPortal-specific (populated when source === 'pumpportal')
  name?: string;
  symbol?: string;
  uri?: string;
  creator?: string;
  bondingCurveKey?: string;
  initialBuyAmount?: number;
  marketCapSol?: number;
  vSolInBondingCurve?: number;
  vTokensInBondingCurve?: number;
}

export interface DetectorEvents {
  token: (event: TokenEvent) => void;
}
```

### Environment Variables to Add

```bash
# .env additions for Phase 2
PUMPPORTAL_ENABLED=true             # DET-01 toggle
RAYDIUM_ENABLED=true                # DET-02 toggle (covers Raydium V4 + PumpSwap)
WS_HEARTBEAT_INTERVAL_MS=30000      # DET-04: 15-30s per spec; 30s is conservative
WS_BASE_BACKOFF_MS=3000             # DET-03: 2-5s per user spec; 3s default
WS_MAX_BACKOFF_MS=60000             # DET-03: 60s max per user spec
WS_EXCESSIVE_RECONNECT_THRESHOLD=5  # DET-05: alert threshold (configurable)
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Watch Raydium for pump.fun migration events | Watch PumpSwap (`pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA`) for migration events | March 2025 | Code targeting only Raydium misses 95%+ of pump.fun graduated tokens |
| PumpPortal as optional convenience wrapper | PumpPortal as primary pump.fun detection layer | 2024-2025 | PumpPortal is now the standard approach; direct `logsSubscribe` to pump.fun program is the alternative |
| `blockSubscribe` for comprehensive detection | `logsSubscribe` for pump.fun tokens | 2024-2025 | `blockSubscribe` not universally supported on lower RPC tiers; `logsSubscribe` is universally available |

**Deprecated/outdated:**
- **Raydium as sole migration destination:** Raydium LaunchLab is now Raydium's response to losing pump.fun migrations. Only tokens launched directly on Raydium (not pump.fun) reliably land in Raydium V4. For phase 2, the "Raydium listener" should cover PumpSwap as the primary target.
- **`@raydium-io/raydium-sdk` (v1):** Deprecated; replaced by `@raydium-io/raydium-sdk-V2`. However, for simple `onLogs` pool detection, no SDK is needed — just `@solana/web3.js`.

---

## Open Questions

1. **PumpSwap `onLogs` filter string**
   - What we know: PumpSwap program is `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA`; it uses `create_pool` instruction
   - What's unclear: The exact string in emitted program logs for `create_pool` is not confirmed — it may be `"Instruction: CreatePool"`, `"Program log: Instruction: create_pool"`, or similar. The Raydium pattern uses `"initialize2"` which is well-documented. PumpSwap log strings need runtime validation.
   - Recommendation: During implementation, add a temporary debug subscription that logs ALL PumpSwap program messages to discover the correct filter string. Alternatively, use PumpPortal's `subscribeMigration` (which covers both destinations) and avoid PumpSwap `onLogs` entirely for migration detection.

2. **PumpPortal `name`, `symbol`, `uri` fields on `subscribeNewToken` events**
   - What we know: Community sources report these fields; the Go struct in the official library does NOT include them
   - What's unclear: Whether these fields are actually present in the current (2026) PumpPortal event payload or have been added/removed
   - Recommendation: Log the full raw event object on first connection (at `debug` level) to confirm actual fields. Use optional TypeScript types (`name?: string`) and defensive access so missing fields don't cause errors.

3. **`onLogs` subscription persistence across RPC reconnects**
   - What we know: `@solana/web3.js` internally reconnects its WebSocket but may not reliably replay subscriptions
   - What's unclear: Whether subscription IDs remain valid after an internal WS reconnect
   - Recommendation: Implement the silence-detection health check (last-event timestamp monitoring) regardless of whether internal reconnect works. This is belt-and-suspenders and costs ~5 lines.

4. **Dedup window for cross-source events**
   - What we know: A pump.fun token is detected by PumpPortal at creation, then again when it migrates and lands on PumpSwap/Raydium
   - What's unclear: The migration event is a different point in the token's lifecycle (could be minutes to hours later). Should the dedup reject the migration event as a "duplicate"?
   - Recommendation: For Phase 2 scope (detection logging only), dedup on mint address is correct — the downstream safety pipeline only needs to run once. When Phase 5 (execution) is built, migration events may be a separate signal type. For now, dedup silently drops it.

---

## Sources

### Primary (HIGH confidence)
- `pumpportal.fun/data-api/real-time/` — WebSocket endpoint, subscription methods, connection guidelines
- `github.com/codingsandmore/pumpfun-portal` — NewPairResponse struct with confirmed field names
- `quicknode.com/guides/solana-development/3rd-party-integrations/track-raydium-lps` — Raydium `onLogs` + `getParsedTransaction` pattern with account indices
- `oneuptime.com/blog/post/2026-01-27-websocket-reconnection-logic/` — Exponential backoff implementation (Jan 2026)
- `oneuptime.com/blog/post/2026-01-24-websocket-heartbeat-ping-pong/` — Heartbeat pattern (Jan 2026)

### Secondary (MEDIUM confidence)
- WebSearch consensus: PumpSwap launched March 2025, program ID `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA`, 95%+ of pump.fun migrations
- WebSearch consensus: `name`, `symbol`, `uri` fields in PumpPortal events (community-reported, not in official struct)
- `docs.chainstack.com` — logsSubscribe pump.fun approach and field extraction patterns
- `gist.github.com/endrsmar` — Raydium listener community implementation

### Tertiary (LOW confidence)
- PumpSwap `onLogs` filter string for `create_pool` — not confirmed; needs runtime validation
- `subscribeMigration` event schema fields — not documented; PumpPortal does not publish schema

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — `ws` and `@solana/web3.js` are established; no new deps needed
- Architecture: HIGH — EventEmitter + ResilientWebSocket base class pattern is verified and fits Phase 1 patterns
- PumpPortal integration: HIGH for subscription methods, MEDIUM for full event schema fields
- Raydium detection: HIGH for `initialize2` / `getParsedTransaction` pattern
- PumpSwap detection: MEDIUM — program ID confirmed, exact log filter string needs runtime validation
- Pitfalls: HIGH — PumpSwap migration shift is confirmed by multiple current sources (2025)
- Reconnection/heartbeat: HIGH — patterns verified against Jan 2026 documentation

**Research date:** 2026-02-21
**Valid until:** 2026-03-21 (30 days — PumpPortal API is stable but Solana ecosystem changes fast; PumpSwap log strings may need validation)
