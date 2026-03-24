# Phase 1: Foundation & Operations - Research

**Researched:** 2026-02-20
**Domain:** Node.js infrastructure — structured logging, config validation, RPC failover, wallet security, graceful shutdown
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- Environment variables use flat naming with `SOLSNIPER_` prefix (e.g., `SOLSNIPER_RPC_URL`, `SOLSNIPER_PRIVATE_KEY`)
- Fail-fast strict validation at startup — missing or invalid config causes immediate exit with **all errors listed at once** (no partial startup)
- Secrets (private key, RPC URLs/API keys) live in `.env`; trading parameters (buy amount, slippage, position limits, thresholds) live in a separate `config.json`
- Config loads once at startup — restart required to pick up changes
- Helius as primary RPC provider + one backup provider
- Failover triggers after 2-3 consecutive failures (not single failure)
- While on backup, periodic health check pings primary and switches back when it responds
- RPC manager emits events (`failover`, `recovered`, `degraded`) so other modules can observe connection health
- Default pino-pretty output in development — no custom prettifier config needed
- Standard pino structured JSON in production
- Package manager: pnpm
- Runtime: Node.js with tsx (no build step in dev)
- Testing: Vitest
- Zod for config/env validation (per OPS-06)

### Claude's Discretion

- Log destination strategy (stdout only vs stdout + file)
- Default dev log level (debug vs trace)
- Latency logging approach (always vs threshold-based)
- Source code module organization pattern
- Exact health check interval and consecutive failure count for RPC failover

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| OPS-01 | Bot uses structured JSON logging via pino with trade IDs threading all related log entries | Pino child logger pattern binds `tradeId` to all log lines for a trade context; verified via Context7 |
| OPS-02 | Bot logs latency for every significant operation (detection, safety checks, transaction send, confirmation) | `Date.now()` differential before/after each operation passed as `latencyMs` field in structured log; no external library needed |
| OPS-03 | RPC manager supports primary + backup providers with automatic failover | Custom `RpcManager` class with consecutive-failure counter, health-check polling, and EventEmitter events; no off-the-shelf library does exactly this for Solana |
| OPS-04 | Bot loads wallet private key from environment variable, never logs it | `Keypair.fromSecretKey(bs58.decode(process.env.SOLSNIPER_PRIVATE_KEY))` at startup; custom Zod serializer strips key from any log serialization |
| OPS-05 | Bot handles graceful shutdown on SIGTERM/SIGINT (close WebSockets, flush logs, persist state, exit within 5 seconds) | Standard `process.on('SIGTERM')` / `process.on('SIGINT')` pattern with `Promise.race` against a 5-second timeout; pino transport flush required before exit |
| OPS-06 | Configuration loaded from .env file with validation via Zod at startup | dotenv + Zod `safeParse` with `process.exit(1)` on failure; collect all errors before exiting so operator sees everything at once |
</phase_requirements>

---

## Summary

Phase 1 establishes the cross-cutting infrastructure that every subsequent phase depends on. The six requirements map cleanly to five implementation areas: project scaffolding, configuration loading and validation, structured logging, RPC management with failover, and graceful shutdown. All five areas have well-understood, stable patterns in the Node.js/TypeScript ecosystem with specific library choices already locked by prior research.

The critical insight for this phase is **initialization order**: dotenv must load before Zod validation, Zod must validate before the logger is configured (because log level comes from config), and the RPC manager must be initialized before any Solana calls. The graceful shutdown handler must be registered after all subsystems are initialized so it can reference them.

The trickiest requirement is OPS-03 (RPC failover with events). There is no drop-in library that implements exactly what is needed — a consecutive-failure-triggered failover with automatic recovery polling and EventEmitter events. This must be custom-built, but the pattern is straightforward: a class that wraps two `Connection` instances, tracks failures per provider, and emits events on state transitions.

**Primary recommendation:** Build the five infrastructure modules in strict order (config → logger → RPC manager → wallet → shutdown handler), wire them at startup in `src/index.ts`, and test each in isolation with Vitest before moving to Phase 2.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `pino` | ^9.6 | Structured JSON logging | Fastest Node.js logger; JSON-native; child loggers for trade ID threading; widely used in production Node.js services |
| `pino-pretty` | ^13.0 | Dev log formatting | Official pino transport for human-readable output; devDependency only |
| `zod` | ^3.24 | Config/env schema validation | TypeScript-first; infers types from schema; `safeParse` collects all errors without throwing; locked by OPS-06 |
| `dotenv` | ^16.4 | .env file loading | Zero-dependency; standard pattern for 12-factor app config; loads before validation |
| `@solana/web3.js` | ^1.98 | Solana RPC `Connection`, `Keypair` | Battle-tested v1.x; extensive community examples; stable API for bot use cases |
| `bs58` | ^6.0 | Base58 decode for private key | Required to decode the private key from env var to `Uint8Array` for `Keypair.fromSecretKey` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `eventemitter3` | ^5.0 | Typed EventEmitter for RPC events | Lighter and faster than Node built-in `EventEmitter`; used for `failover`/`recovered`/`degraded` events from RPC manager |
| `vitest` | ^3.0 | Unit testing | Locked by user decisions; native TypeScript; fast startup |
| `tsx` | ^4.19 | Dev runtime (no build step) | Locked by user decisions |
| `typescript` | ^5.7 | Type safety | Locked by existing stack docs |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `dotenv` | `@t3-oss/env-core` | env-core bundles dotenv + zod together but adds a framework opinion not needed here |
| `pino` | `winston` | winston is slower and more configurable; speed matters more here than transport flexibility |
| `eventemitter3` | Node built-in `EventEmitter` | Built-in works; eventemitter3 is faster and supports typed events out of box |
| Custom `RpcManager` | `@switchboard-xyz/on-demand` or similar | No off-the-shelf Solana failover library matches the exact event-emitting, recovery-checking pattern required |

**Installation:**
```bash
pnpm add pino dotenv zod @solana/web3.js bs58 eventemitter3
pnpm add -D pino-pretty vitest tsx typescript @types/node
```

---

## Architecture Patterns

### Recommended Project Structure (Phase 1 scope)

```
src/
├── index.ts              # Entry point: wires all subsystems, registers shutdown handler
├── config/
│   ├── env.ts            # dotenv load + Zod schema + export typed Config
│   └── config.json       # Trading parameters (buy amount, slippage, thresholds)
├── core/
│   ├── logger.ts         # Pino instance factory, child logger helper
│   └── rpc-manager.ts    # Primary/backup Connection, failover logic, event emitter
├── utils/
│   └── wallet.ts         # Keypair load from env, never logs key
└── types/
    └── index.ts          # Shared TypeScript types (Config, RpcManagerEvents, etc.)
```

This maps directly to the planned `src/` structure in `.planning/codebase/STRUCTURE.md`. Phase 1 only creates what it needs and leaves `detection/`, `safety/`, `execution/` empty.

### Pattern 1: Fail-Fast Config Validation (OPS-06)

**What:** Load `.env` with dotenv, validate `process.env` with a Zod schema, collect all errors, exit with full error list if any fail.

**When to use:** First thing in `src/config/env.ts`, before any other module imports.

**Key insight:** Use `safeParse` (not `parse`) so Zod collects all validation errors instead of stopping at the first. Then format them for operator readability before calling `process.exit(1)`.

```typescript
// Source: Context7 /colinhacks/zod + dotenv pattern
import 'dotenv/config';  // load .env into process.env immediately
import { z } from 'zod';

const EnvSchema = z.object({
  SOLSNIPER_RPC_URL: z.string().url('Must be a valid URL'),
  SOLSNIPER_RPC_BACKUP_URL: z.string().url('Must be a valid URL'),
  SOLSNIPER_PRIVATE_KEY: z.string().min(32, 'Private key too short'),
  NODE_ENV: z.enum(['development', 'production']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('debug'),
});

export type Env = z.infer<typeof EnvSchema>;

const result = EnvSchema.safeParse(process.env);

if (!result.success) {
  console.error('Configuration validation failed:');
  result.error.issues.forEach(issue => {
    console.error(`  [${issue.path.join('.')}] ${issue.message}`);
  });
  process.exit(1);
}

export const env: Env = result.data;
```

**Trading parameters** (buy amount, slippage, etc.) come from `config.json`, not `.env`:

```typescript
// src/config/env.ts (continued)
import configJson from '../../config.json';
import { z } from 'zod';

const ConfigSchema = z.object({
  buyAmountSol: z.number().positive().max(10),
  maxSlippageBps: z.number().int().min(50).max(4900),
  maxConcurrentPositions: z.number().int().min(1).max(50),
  stopLossPct: z.number().negative(),
  takeProfitPct: z.number().positive(),
  minSafetyScore: z.number().int().min(0).max(100),
});

export type BotConfig = z.infer<typeof ConfigSchema>;

const configResult = ConfigSchema.safeParse(configJson);
if (!configResult.success) {
  console.error('config.json validation failed:');
  configResult.error.issues.forEach(issue => {
    console.error(`  [${issue.path.join('.')}] ${issue.message}`);
  });
  process.exit(1);
}

export const config: BotConfig = configResult.data;
```

### Pattern 2: Pino Logger with Child Loggers for Trade ID Threading (OPS-01, OPS-02)

**What:** Create a singleton logger with environment-appropriate transport. Export a `createTradeLogger(tradeId)` helper that creates a child logger binding the trade ID to all log lines for that trade.

**When to use:** Everywhere. Every log call goes through pino or a child of it.

```typescript
// Source: Context7 /pinojs/pino
// src/core/logger.ts
import pino from 'pino';
import { env } from '../config/env.js';

const isDev = env.NODE_ENV === 'development';

export const logger = pino({
  level: env.LOG_LEVEL,
  // Development: pino-pretty transport for human-readable output
  // Production: raw JSON to stdout (pipe to file or log aggregator externally)
  transport: isDev
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
    : undefined,
});

// Module logger — adds persistent module context
export function createModuleLogger(module: string) {
  return logger.child({ module });
}

// Trade logger — adds tradeId to every log line for this trade
// Usage: const tradeLog = createTradeLogger(tradeId); tradeLog.info({ mint }, 'Trade opened');
export function createTradeLogger(tradeId: string, module?: string) {
  return logger.child({ tradeId, ...(module ? { module } : {}) });
}

// Latency helper — logs an operation with its duration
// Usage: await withLatency(tradeLog, 'safety_check', () => runSafetyChecks(mint))
export async function withLatency<T>(
  log: pino.Logger,
  operation: string,
  fn: () => Promise<T>
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    log.debug({ operation, latencyMs: Date.now() - start }, `${operation} completed`);
    return result;
  } catch (err) {
    log.error({ operation, latencyMs: Date.now() - start, err }, `${operation} failed`);
    throw err;
  }
}
```

**Structured log format** (every significant event):
```typescript
// Good: structured context object, descriptive message
log.info({ mint, score: 85, flags: ['high_liquidity'], latencyMs: 187 }, 'Safety check passed');
log.error({ mint, error, retryCount: 2 }, 'Buy transaction failed');

// Never: string concatenation, unstructured
log.info(`Safety check passed for ${mint}`);  // BAD
```

**Log level recommendation (Claude's Discretion):** Default to `debug` in development. `trace` is too verbose for day-to-day debugging. Production default is `info`.

**Log destination recommendation (Claude's Discretion):** stdout only. Redirect to file at the process/PM2 level (`pm2 start --log ./logs/bot.log`), not in application code. This keeps the logger simple and avoids file rotation complexity in the process.

**Latency logging recommendation (Claude's Discretion):** Log latency for every external call (RPC, API). Use the `withLatency` helper rather than manually tracking. Do not threshold-gate latency logging — latency data is only useful when you have it for all calls, not just slow ones.

### Pattern 3: RPC Manager with Failover and Events (OPS-03)

**What:** A class wrapping two `@solana/web3.js` `Connection` instances. Tracks consecutive failures on the primary. After N failures, switches to backup and emits `failover`. Periodically pings primary while on backup; when primary responds, switches back and emits `recovered`.

**When to use:** All Solana RPC reads and writes go through `RpcManager.getConnection()`, not through a raw `Connection`.

**Consecutive failure threshold recommendation (Claude's Discretion):** 3 consecutive failures. Single failures are too noisy (transient network blips). 5 is too slow to respond to real outages. 3 is the right balance.

**Health check interval recommendation (Claude's Discretion):** Ping primary every 10 seconds while on backup. Using `getSlot()` as the health check method — lightweight, always succeeds on a healthy RPC.

```typescript
// Source: Pattern derived from architecture research + @solana/web3.js Connection docs
// src/core/rpc-manager.ts
import { Connection, Commitment } from '@solana/web3.js';
import EventEmitter from 'eventemitter3';

type RpcState = 'primary' | 'backup';

interface RpcManagerEvents {
  failover: { from: string; to: string; reason: string; consecutiveFailures: number };
  recovered: { endpoint: string };
  degraded: { endpoint: string; consecutiveFailures: number };
}

export class RpcManager extends EventEmitter<RpcManagerEvents> {
  private primary: Connection;
  private backup: Connection;
  private state: RpcState = 'primary';
  private consecutiveFailures = 0;
  private readonly FAILURE_THRESHOLD = 3;
  private readonly RECOVERY_INTERVAL_MS = 10_000;
  private recoveryTimer: NodeJS.Timeout | null = null;

  constructor(
    primaryUrl: string,
    backupUrl: string,
    private commitment: Commitment = 'confirmed'
  ) {
    super();
    this.primary = new Connection(primaryUrl, { commitment });
    this.backup = new Connection(backupUrl, { commitment });
  }

  /** Get the currently active connection */
  getConnection(): Connection {
    return this.state === 'primary' ? this.primary : this.backup;
  }

  /** Record a successful RPC call — resets failure counter */
  recordSuccess(): void {
    this.consecutiveFailures = 0;
  }

  /** Record a failed RPC call — may trigger failover */
  recordFailure(reason: string): void {
    this.consecutiveFailures++;
    this.emit('degraded', {
      endpoint: this.state === 'primary' ? 'primary' : 'backup',
      consecutiveFailures: this.consecutiveFailures,
    });

    if (this.state === 'primary' && this.consecutiveFailures >= this.FAILURE_THRESHOLD) {
      this.switchToBackup(reason);
    }
  }

  private switchToBackup(reason: string): void {
    this.state = 'backup';
    this.consecutiveFailures = 0;
    this.emit('failover', {
      from: 'primary',
      to: 'backup',
      reason,
      consecutiveFailures: this.FAILURE_THRESHOLD,
    });
    this.startRecoveryPolling();
  }

  private startRecoveryPolling(): void {
    this.recoveryTimer = setInterval(async () => {
      try {
        await this.primary.getSlot();
        // Primary is healthy again
        this.state = 'primary';
        this.consecutiveFailures = 0;
        this.stopRecoveryPolling();
        this.emit('recovered', { endpoint: 'primary' });
      } catch {
        // Primary still down, stay on backup
      }
    }, this.RECOVERY_INTERVAL_MS);
  }

  private stopRecoveryPolling(): void {
    if (this.recoveryTimer) {
      clearInterval(this.recoveryTimer);
      this.recoveryTimer = null;
    }
  }

  /** Clean shutdown — stop polling timers */
  close(): void {
    this.stopRecoveryPolling();
  }
}
```

**Usage pattern in other modules:**
```typescript
// Wrap every RPC call with success/failure recording
async function getSomeData(rpcManager: RpcManager): Promise<Data> {
  try {
    const conn = rpcManager.getConnection();
    const result = await conn.getAccountInfo(pubkey);
    rpcManager.recordSuccess();
    return result;
  } catch (err) {
    rpcManager.recordFailure(err.message);
    throw err;
  }
}
```

### Pattern 4: Wallet Loading Without Key Leakage (OPS-04)

**What:** Load keypair from `SOLSNIPER_PRIVATE_KEY` at startup. Never pass the raw private key to any function that might log it. Only expose the public key in logs.

**When to use:** Single load in `src/utils/wallet.ts`, export the `Keypair` object. Never export or log the private key bytes.

```typescript
// src/utils/wallet.ts
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { env } from '../config/env.js';

// Load once at module initialization
let _keypair: Keypair | null = null;

export function getWallet(): Keypair {
  if (!_keypair) {
    try {
      const secretKey = bs58.decode(env.SOLSNIPER_PRIVATE_KEY);
      _keypair = Keypair.fromSecretKey(secretKey);
    } catch (err) {
      // Do NOT include env.SOLSNIPER_PRIVATE_KEY in the error message
      throw new Error('Failed to load wallet keypair: invalid private key format');
    }
  }
  return _keypair;
}

export function getWalletPublicKey(): string {
  return getWallet().publicKey.toBase58();
}
```

**Zod-level protection:** The Zod `EnvSchema` for `SOLSNIPER_PRIVATE_KEY` should use a custom error transform that never echoes the value back:
```typescript
SOLSNIPER_PRIVATE_KEY: z.string().min(32).transform(val => val),  // validated, not logged
```

**Pino serializer protection (belt-and-suspenders):**
```typescript
// In logger.ts — strip private key from any object accidentally passed to logger
const logger = pino({
  serializers: {
    // If anyone accidentally logs the env or config object, strip sensitive keys
    env: (env) => ({ NODE_ENV: env.NODE_ENV, LOG_LEVEL: env.LOG_LEVEL }),
  },
});
```

### Pattern 5: Graceful Shutdown Handler (OPS-05)

**What:** Register `SIGTERM` and `SIGINT` handlers that stop accepting new work, flush the pino logger, close RPC connections, and exit within 5 seconds.

**When to use:** Registered in `src/index.ts` after all subsystems are initialized.

**Key insight:** Pino in transport mode (pino-pretty or file) writes logs asynchronously. Calling `process.exit()` immediately can lose the last few log lines. Use `logger.flush()` or `pino.final()` before exit.

```typescript
// src/index.ts
import { logger } from './core/logger.js';
import { RpcManager } from './core/rpc-manager.js';

async function shutdown(signal: string, rpcManager: RpcManager): Promise<void> {
  logger.info({ signal }, 'Received shutdown signal — starting graceful shutdown');

  // Race: clean shutdown vs forced exit after 5 seconds
  const timeout = setTimeout(() => {
    logger.warn('Graceful shutdown timed out after 5s — forcing exit');
    process.exit(1);
  }, 5000);
  timeout.unref();  // Don't prevent process from exiting naturally

  try {
    // 1. Stop accepting new work (Phase 2+: stop WebSocket listeners)
    // 2. Close RPC health check timers
    rpcManager.close();
    // 3. Phase 2+: flush SQLite writes, close DB connection
    // 4. Flush pino logger (ensures all buffered logs are written)
    await new Promise<void>((resolve) => {
      logger.info('Shutdown complete');
      logger.flush(resolve);
    });
  } finally {
    clearTimeout(timeout);
    process.exit(0);
  }
}

// Register handlers (call after all subsystems initialized)
export function registerShutdownHandlers(rpcManager: RpcManager): void {
  const handler = (signal: string) => shutdown(signal, rpcManager);
  process.on('SIGTERM', () => handler('SIGTERM'));
  process.on('SIGINT', () => handler('SIGINT'));
}
```

### Anti-Patterns to Avoid

- **Initializing logger before config:** If config fails, the logger isn't configured yet. Use `console.error` for the config failure message, then exit. The real logger only starts after config is valid.
- **Logging `process.env` directly:** Even with caution, this will expose secrets. Never pass `process.env` or the raw `env` object to `logger.info()` or similar calls.
- **Creating a new `Connection` per request:** `Connection` maintains an internal HTTP agent and WebSocket subscription pool. Create once, reuse everywhere via `RpcManager.getConnection()`.
- **Not calling `logger.flush()` before exit:** Pino in transport mode buffers writes. Exiting without flushing loses the last N log lines — exactly the ones you need for debugging a crash.
- **Catching all errors in the shutdown handler without re-throwing:** If cleanup itself fails, the process can hang forever. The 5-second timeout is the safety net.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON structured logging | Custom logger with `JSON.stringify` | `pino` | pino handles serialization, levels, child contexts, transports, and async flushing correctly; hand-rolled loggers miss edge cases (circular refs, async buffering) |
| Env var loading | `fs.readFileSync('.env')` + manual parse | `dotenv` | dotenv handles multiline values, comments, quoted strings, encoding; hand-rolling is fragile |
| Config schema validation | Manual if/else type checks | `zod` | zod provides TypeScript inference, all-errors collection, and composable validators; manual checks miss edge cases and diverge from types |
| Base58 decode | Custom base58 decoder | `bs58` | cryptographic encoding is easy to get subtly wrong; use the battle-tested library |
| EventEmitter | Custom callback registry | `eventemitter3` | Node's built-in EventEmitter has memory leak warnings; eventemitter3 is typed and faster |

**Key insight:** Every item in this list looks simple. None of them are. The failure modes are subtle (encoding edge cases, GC pressure from frequent string parsing, async buffer not flushing) and only appear in production under load.

---

## Common Pitfalls

### Pitfall 1: Config Validation Runs After Logger Initialization

**What goes wrong:** Developer writes `const logger = createLogger()` at the top of `index.ts`, then validates config below. Config validation fails. The logger tries to emit the error but isn't fully configured yet (log level from config is undefined).

**Why it happens:** It seems natural to set up the logger first for debugging. But the logger needs config (log level, NODE_ENV) to be configured correctly.

**How to avoid:** Config module (`src/config/env.ts`) is a pure sync module that imports nothing from the application. It uses `console.error` for its own failures. The logger is created only after `import { env } from './config/env.js'` succeeds.

**Warning signs:** Logger emitting at wrong level, or crash during logger setup before config validation message appears.

### Pitfall 2: pino-pretty in Production

**What goes wrong:** `NODE_ENV` isn't set on the production VPS. Bot falls back to `development` mode. All logs come out as human-readable text instead of JSON. Log aggregation and parsing fails silently.

**How to avoid:** Always require `NODE_ENV` in the Zod schema with no default (or default to `'production'` as the safer choice). Make the `isDev` check explicit.

**Warning signs:** Log files contain ANSI color codes; log parsing scripts fail; disk usage higher than expected (pretty logs are larger than JSON).

### Pitfall 3: Private Key Logged During Error Handling

**What goes wrong:** An error handler catches a config validation error and logs `{ error, config }` or `{ error, env: process.env }`. The private key is now in the log file.

**Why it happens:** Developers add context to error logs without thinking about what objects contain. `process.env` looks like a safe debug object.

**How to avoid:** Never log `process.env`, `config`, or any object that might contain the private key. Log only specific safe fields. Add a pino serializer that strips `SOLSNIPER_PRIVATE_KEY` from any object.

**Warning signs:** `grep -r "PRIVATE_KEY" logs/` returns results. If it ever does, rotate the wallet key immediately.

### Pitfall 4: RpcManager Failover Triggers on First Transient Error

**What goes wrong:** Network has a 100ms blip. One RPC call times out. RPC manager immediately switches to backup. Backup is also slower (it's a backup for a reason). Bot runs degraded for the next 10 seconds until recovery polling reconnects to primary.

**Why it happens:** Threshold of 1 consecutive failure is too sensitive. Every Solana RPC has occasional transient timeouts under load.

**How to avoid:** Threshold of 3 consecutive failures before failover. This tolerates transient blips (which rarely happen 3 times in a row on the same call) while catching real outages within seconds.

**Warning signs:** `failover` events appearing in logs frequently during active trading periods; high rate of `recovered` events following immediately after `failover` (indicates the failover was unnecessary).

### Pitfall 5: Graceful Shutdown Takes More Than 5 Seconds

**What goes wrong:** In Phase 2+, the shutdown handler tries to wait for in-flight buy/sell transactions to confirm before exiting. A buy transaction has a 60-second expiry window. The shutdown hangs for 60 seconds, then times out and exits with open positions in an unknown state.

**Why it happens:** Shutdown logic tries to be "safe" by completing all work, but transaction confirmation is outside the 5-second window.

**How to avoid:** Phase 1 shutdown is simple: close timers, flush logs, exit. In Phase 2+, the rule is: persist current state to SQLite (fast, synchronous), then exit. Don't wait for blockchain confirmation. On next start, the crash recovery logic reconciles unresolved states.

**Warning signs:** PM2 logs showing shutdown taking >5 seconds before SIGKILL; trades in `BUYING` or `SELLING` state after restart that should have been resolved.

### Pitfall 6: RPC Connection Not Closed Before Exit

**What goes wrong:** `@solana/web3.js` `Connection` opens an HTTP agent and sometimes a WebSocket for subscriptions. If not explicitly released before `process.exit()`, the process hangs on exit waiting for the agent pool to drain (documented issue: `AgentManager holds process up until connection timeout`).

**Why it happens:** It's not obvious that `Connection` has cleanup requirements. There's no `connection.close()` in older documentation.

**How to avoid:** In Phase 1, `RpcManager.close()` does not need to explicitly destroy the HTTP agent for read-only connections. The key is that `process.exit()` is called explicitly at the end of the shutdown handler rather than letting the event loop drain naturally. In Phase 2+, when WebSocket subscriptions are added, they must be explicitly removed before exit.

**Warning signs:** Process doesn't exit after shutdown signal; PM2 shows process as running long after SIGTERM; `ps aux` shows zombie node processes.

---

## Code Examples

Verified patterns from Context7 and official sources:

### pino Child Logger (OPS-01)

```typescript
// Source: Context7 /pinojs/pino
const pino = require('pino');
const logger = pino();

// Create trade-scoped child logger — tradeId appears in every log line
const tradeLogger = logger.child({ tradeId: 'abc-123', module: 'execution' });

tradeLogger.info({ mint: 'EPjFWdd5...' }, 'Buy transaction sent');
// Output: {"level":30,"time":...,"tradeId":"abc-123","module":"execution","mint":"EPjFWdd5...","msg":"Buy transaction sent"}

// Nested child (add RPC provider context for debugging)
const rpcLogger = tradeLogger.child({ rpcProvider: 'helius' });
rpcLogger.debug({ latencyMs: 87 }, 'RPC call complete');
```

### pino-pretty Development Transport

```typescript
// Source: Context7 /pinojs/pino
const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: { colorize: true, translateTime: 'SYS:standard' },
  },
});
```

### Zod safeParse — Collect All Errors

```typescript
// Source: Context7 /colinhacks/zod
const result = EnvSchema.safeParse(process.env);
if (!result.success) {
  result.error.issues.forEach(issue => {
    console.error(`  [${issue.path.join('.')}] ${issue.message}`);
  });
  process.exit(1);
}
const env = result.data; // TypeScript knows this is Env type
```

### dotenv Config Loading

```typescript
// Source: Context7 /motdotla/dotenv
// ES module style — loads .env into process.env immediately on import
import 'dotenv/config';

// Or explicit with error check:
import dotenv from 'dotenv';
const result = dotenv.config();
if (result.error) {
  console.error('Failed to load .env file:', result.error.message);
  process.exit(1);
}
```

### Keypair from Base58 Private Key

```typescript
// Source: @solana/web3.js + bs58 — verified pattern from architecture research
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

// Decode base58 private key string to Uint8Array, create keypair
const secretKey = bs58.decode(process.env.SOLSNIPER_PRIVATE_KEY!);
const keypair = Keypair.fromSecretKey(secretKey);

// Log only public key
console.log('Wallet:', keypair.publicKey.toBase58());
// NEVER: console.log(keypair.secretKey) or console.log(process.env.SOLSNIPER_PRIVATE_KEY)
```

### SIGTERM/SIGINT Graceful Shutdown

```typescript
// Source: Pattern from web search verification (oneuptime.com/blog Jan 2026)
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received');

  const timeout = setTimeout(() => {
    logger.warn('Forced exit after 5s timeout');
    process.exit(1);
  }, 5000);
  timeout.unref();

  await cleanup();  // close connections, flush logs
  clearTimeout(timeout);
  process.exit(0);
});

process.on('SIGINT', async () => {
  // Same handler — Ctrl+C during development
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Winston for logging | Pino for high-throughput services | 2019-2022 | 5-10x faster; JSON-native eliminates format step |
| Manual env validation (`if (!process.env.X) throw`) | Zod schema with `safeParse` | 2021+ | All errors collected; TypeScript types inferred from schema |
| `dotenv` + manual process | `dotenv/config` import side effect | dotenv v16+ | Single line; loads before any other code |
| Pino `prettyPrint: true` option | `transport: { target: 'pino-pretty' }` | pino v7+ | Old `prettyPrint` option is removed in pino v7+; transport is the current API |
| `@solana/kit` v2 for new projects | `@solana/web3.js` v1.x still dominant | Ongoing 2024-2026 | v2 has better API design but v1 has the community/examples ecosystem |

**Deprecated/outdated:**
- `pino.pretty()` call-style: Removed in pino v7. Use `transport: { target: 'pino-pretty' }`.
- `prettyPrint: true` pino option: Removed in pino v7. Same replacement.
- `require('dotenv').config()` is still valid but `import 'dotenv/config'` is the cleaner ESM pattern.

---

## Open Questions

1. **Zod v4 compatibility**
   - What we know: Context7 shows zod v4.0.1 is available. The API has changed in some areas.
   - What's unclear: Whether `z.infer` and `safeParse` work identically in v4 (likely yes, but not verified).
   - Recommendation: Pin to `^3.24` as locked in existing stack docs. Zod v3 is stable and has 861 Context7 snippets. Migrate to v4 only when ecosystem catches up.

2. **pino flush behavior with tsx**
   - What we know: pino transports are worker threads; `logger.flush(cb)` should drain the buffer.
   - What's unclear: Whether `tsx` (which runs TypeScript directly without build) affects pino's worker thread transport behavior at process exit.
   - Recommendation: Test `logger.flush()` during shutdown in development before relying on it. If unreliable, fallback is to add a `setTimeout(process.exit, 100)` after flush.

3. **`@solana/web3.js` Connection cleanup on exit**
   - What we know: There's a known GitHub issue (`AgentManager holds process up until connection timeout`) where Connection's internal HTTP agent prevents clean process exit.
   - What's unclear: Whether this is fixed in v1.98.
   - Recommendation: Always call `process.exit(0)` explicitly in the shutdown handler (never rely on natural event loop drain). This bypasses the hanging agent issue.

---

## Sources

### Primary (HIGH confidence)
- Context7 `/pinojs/pino` — child loggers, transport configuration, pino-pretty setup
- Context7 `/colinhacks/zod` — safeParse, object schema, error handling
- Context7 `/motdotla/dotenv` — config loading, .env parsing
- `.planning/research/STACK.md` — library versions, rationale for stack choices
- `.planning/codebase/CONVENTIONS.md` — logging patterns, file naming, error handling conventions
- `.planning/codebase/STRUCTURE.md` — directory layout, module organization
- `.planning/research/ARCHITECTURE.md` — initialization order, component boundaries
- `.planning/research/PITFALLS.md` — Pitfall 13 (insufficient logging), Pitfall 18 (wallet key compromise)

### Secondary (MEDIUM confidence)
- WebSearch: "Node.js SIGTERM SIGINT graceful shutdown async cleanup 2025" — confirmed `process.on()` pattern, 5-second timeout with `timeout.unref()`, pino flush requirement. Source: oneuptime.com/blog 2026-01-06.
- WebSearch: "pino logger Node.js structured logging child logger" — confirmed child logger bindings, JSON output, pino-pretty transport. Source: signoz.io, betterstack.com.
- WebSearch: "zod v3 environment variable validation TypeScript startup fail fast 2025" — confirmed `safeParse` collect-all pattern, `process.exit(1)` after formatting errors. Multiple sources: jsdev.space, jfranciscosousa.com.
- WebSearch: "@solana/web3.js Connection failover RPC manager" — confirmed no built-in failover; custom implementation required; Chainstack docs show multi-connection pool pattern.

### Tertiary (LOW confidence)
- GitHub issue `solana-labs/solana #24970` (AgentManager holds process): Reported but fix status in v1.98 not verified. Treat as still present.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries verified via Context7 or multiple WebSearch sources
- Architecture: HIGH — initialization order and module patterns derived from project's own research + architecture docs
- Pitfalls: HIGH — sourced from project's own pitfall analysis + verified external sources for shutdown and logging
- Code examples: HIGH (pino, zod, dotenv) / MEDIUM (RpcManager, shutdown handler) — RPC manager is custom; shutdown handler pattern is standard but pino flush behavior with tsx is not verified

**Research date:** 2026-02-20
**Valid until:** 2026-03-20 (stable libraries; pino and zod rarely have breaking changes)
