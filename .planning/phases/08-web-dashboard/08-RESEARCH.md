# Phase 8: Web Dashboard - Research

**Researched:** 2026-02-27
**Domain:** In-process HTTP server, SSE event streaming, Preact/Vite SPA, runtime config mutation
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Frontend approach:** Preact or React SPA built with Vite. Production: serve pre-built `dist/` folder from the in-process HTTP server. Dev: Vite dev server proxies API/SSE to the bot process.
- **Dashboard layout:** Tabbed navigation: Live Feed | Performance | Settings. Persistent header bar showing total P&L, win rate, open positions count. Dark theme, monospace/terminal aesthetic — dark background, green/red for P&L.
- **Trade feed & events:** SSE stream surfaces all lifecycle events (detected, buy sent, buy confirmed, sell triggered, sell confirmed, errors). Feed rows: `[HH:MM:SS] EVENT_TYPE_BADGE  ABC...XYZ  brief description`. Auto-scroll to latest, pauses on manual scroll, "Resume live" button. Browser retains last 200 events, older entries trimmed from DOM.
- **Config editing UX:** Edit-then-Save pattern. Single POST applies all changes atomically. Changes are in-memory only — restart reverts to config file values. Forward-only: in-flight trades never forcibly closed by config change.
- **Adjustable via Settings tab:** safety score threshold and scoring weights, buy amount (SOL), max concurrent positions, stop-loss %, take-profit tiers (amounts and targets), slippage tolerance.

### Claude's Discretion
- Authentication implementation (recommend simple configurable API key in .env)
- HTTP server library choice (Fastify / Express / Node built-in)
- SSE event schema and wire format
- Exact tab layout and spacing within the dark theme
- How take-profit tiers are represented in the Settings UI (table rows vs separate fields)
- Error display / toast notifications for save failures

### Deferred Ideas (OUT OF SCOPE)
- None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DASH-01 | Web dashboard displays real-time trade feed (snipes, buys, sells) via SSE | SSE with @fastify/sse; EventSource client-side; fan-out via in-memory Set of reply objects |
| DASH-02 | Web dashboard shows per-trade P&L (entry price, current price, profit/loss) | Trade.amountSol (entry) + live Jupiter quote (current price) from PositionManager; computed in API endpoint |
| DASH-03 | Web dashboard shows overall portfolio performance (total P&L, win rate, trade count) | Derived from TradeStore queries (COMPLETED, FAILED trades) + current MONITORING values |
| DASH-04 | Web dashboard provides UI to adjust safety filter thresholds without bot restart | Mutable config singleton pattern; POST /api/config applies partial updates to in-memory TradingConfig |
| DASH-05 | Web dashboard provides UI to adjust buy amount and position limits without bot restart | Same mutable config pattern as DASH-04; same endpoint |
| DASH-06 | Dashboard runs as in-process HTTP server (Express/Fastify), not a separate service | Fastify instance created in main(), started after positionManager.start(), closed in shutdown() |
</phase_requirements>

## Summary

Phase 8 adds a read-write web UI layered on the already-running bot process. The implementation splits into three concerns: (1) an in-process Fastify HTTP server serving REST endpoints and an SSE stream, (2) a frontend SPA (Preact + Vite) that consumes SSE and calls REST endpoints, and (3) an event bus inside the bot that pipes lifecycle events to all connected SSE clients.

The critical architectural insight is that the dashboard must **not own any trading logic**. It is a read-write observer: it reads bot state from TradeStore, reads live P&L by calling Jupiter quotes, and mutates config by writing to a shared mutable config object that the rest of the bot already reads. The SSE stream is the only push mechanism — all other data is pulled via REST.

The project is a Node16-module-resolution ESM codebase (`"type": "module"`, `"moduleResolution": "Node16"`). Fastify is a natural fit because it ships ESM-first and is the only HTTP library with first-party SSE plugin support (`@fastify/sse`), first-party static file serving (`@fastify/static`), and first-party CORS (`@fastify/cors`). The frontend lives in a separate `dashboard/` directory with its own `vite.config.ts`, built to `dashboard/dist/`, and served from Fastify in production. During development, `vite --config dashboard/vite.config.ts` runs separately and proxies `/api/*` and `/events` to the bot's Fastify port.

**Primary recommendation:** Use Fastify + @fastify/sse for the server, Preact + @preact/preset-vite for the SPA, @preact/signals for reactive state, and a simple in-memory EventEmitter-based fan-out to push events to all SSE clients.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| fastify | ^5.x | In-process HTTP server | ESM-native, lowest overhead Node.js framework, first-party plugin ecosystem, TypeScript-first |
| @fastify/sse | latest | SSE route support | Official Fastify plugin, supports async generators, typed SSEMessage, built-in heartbeat |
| @fastify/static | ^8.x | Serve pre-built `dashboard/dist/` | Official plugin, SPA-aware cache-control patterns, `reply.sendFile()` |
| @fastify/cors | ^11.x | CORS for Vite dev server proxy | Official plugin, needed so `localhost:5173` (Vite) can call `localhost:PORT` (Fastify) in dev |
| preact | ^10.x | Frontend UI library | 3kB alternative to React, same Hooks API, lower bundle size — ideal for a local dashboard |
| @preact/preset-vite | latest | Vite plugin for Preact | Handles JSX transform, HMR (prefresh), React alias automatically |
| @preact/signals | latest | Reactive state for SSE feed | Fine-grained reactivity: only the DOM node using a signal re-renders — perfect for a live feed |
| vite | ^7.x | Frontend build + dev server | Already likely in use; handles TypeScript, proxy, production bundle |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @types/node | (already installed) | Node type defs | Already devDep |
| eventemitter3 | (already installed) | Internal event bus for SSE fan-out | Already a project dep — use it for BotEventBus rather than adding a new dep |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Fastify | Express | Express is more familiar but has no first-party SSE plugin; manual SSE implementation is more code |
| Fastify | Node built-in `http` | Node http requires manual routing, header management; much more boilerplate for no gain |
| @fastify/sse | Manual SSE (reply.raw) | Manual works but requires tracking connections, handling heartbeats, cleanup on disconnect manually |
| Preact + @preact/signals | React + useState | React adds ~40KB gzip; for a local VPS dashboard Preact's smaller bundle is meaningfully better |
| @preact/signals | useState/useReducer | Signals avoid full component re-renders on every SSE event — important for a high-frequency feed |

**Installation (new packages only — all go to root package.json):**
```bash
pnpm add fastify @fastify/sse @fastify/static @fastify/cors
pnpm add -D vite @preact/preset-vite preact @preact/signals
```

Note: The dashboard frontend has its own `package.json` OR shares the root one with separate build script. The simpler approach is a single `package.json` with a `build:dashboard` script (`vite build --config dashboard/vite.config.ts`).

## Architecture Patterns

### Recommended Project Structure
```
src/
├── dashboard/              # In-process server (bot side)
│   ├── dashboard-server.ts # Fastify instance creation + plugin registration
│   ├── bot-event-bus.ts    # EventEmitter3-based bus — bot emits, SSE handler listens
│   ├── routes/
│   │   ├── events.ts       # GET /events — SSE stream
│   │   ├── trades.ts       # GET /api/trades, GET /api/stats
│   │   └── config.ts       # GET /api/config, POST /api/config
│   └── auth.ts             # onRequest hook: API key validation
dashboard/                  # Frontend SPA (separate from src/)
├── vite.config.ts          # Preact preset, proxy to bot port
├── tsconfig.json           # Frontend tsconfig (separate target/lib from bot)
├── index.html              # SPA entry
└── src/
    ├── main.tsx            # Preact render root
    ├── app.tsx             # Tab routing: LiveFeed | Performance | Settings
    ├── components/
    │   ├── Header.tsx      # Persistent stats bar (total P&L, win rate, positions)
    │   ├── LiveFeed.tsx    # SSE event list, auto-scroll, resume button
    │   ├── Performance.tsx # Per-trade P&L table
    │   └── Settings.tsx    # Config form — edit-then-save
    └── store/
        ├── feed.ts         # @preact/signals: signal<FeedEvent[]> — trimmed to 200
        └── config.ts       # @preact/signals: signal<DashboardConfig>
```

### Pattern 1: BotEventBus — Decoupled Bot-to-SSE Pipeline
**What:** An EventEmitter3 instance shared between the bot's core modules (ExecutionEngine, SellLadder, SafetyPipeline) and the Fastify SSE route handler. The bot emits lifecycle events; the SSE handler fans out to all connected clients.

**When to use:** Required to avoid coupling the bot's core trading logic to HTTP concerns. The bus is optional — if no dashboard clients are connected, events are emitted and dropped.

**Example:**
```typescript
// Source: EventEmitter3 pattern (already in project as core/resilient-ws.ts pattern)
// src/dashboard/bot-event-bus.ts
import { EventEmitter } from 'eventemitter3';

export type BotEventType =
  | 'TOKEN_DETECTED'
  | 'BUY_SENT'
  | 'BUY_CONFIRMED'
  | 'BUY_FAILED'
  | 'SELL_TRIGGERED'
  | 'SELL_CONFIRMED'
  | 'SELL_FAILED'
  | 'ERROR';

export interface BotEvent {
  type: BotEventType;
  mint: string;
  ts: number;          // Unix ms
  detail?: string;     // Brief human-readable description
}

interface BotEventBusEvents {
  event: (e: BotEvent) => void;
}

class BotEventBus extends EventEmitter<BotEventBusEvents> {}

// Singleton — imported by dashboard server AND core modules
export const botEventBus = new BotEventBus();
```

### Pattern 2: SSE Fan-Out Route
**What:** The SSE route maintains a `Set<reply>` of all connected clients. On each `BotEvent`, it iterates the Set and sends to each. When a client disconnects, it removes itself.

**When to use:** Always — this is the only supported pattern for multi-client SSE without a message broker.

**Example:**
```typescript
// Source: @fastify/sse docs + fan-out pattern verified via WebSearch
// src/dashboard/routes/events.ts
import type { FastifyInstance } from 'fastify';
import { botEventBus } from '../bot-event-bus.js';

export async function eventsRoute(fastify: FastifyInstance): Promise<void> {
  fastify.get('/events', { sse: true }, async (request, reply) => {
    // Register this client
    const sendEvent = (event: BotEvent) => {
      if (reply.sse.isConnected) {
        void reply.sse.send({ event: event.type, data: JSON.stringify(event) });
      }
    };

    botEventBus.on('event', sendEvent);

    // Clean up on client disconnect
    reply.sse.onClose(() => {
      botEventBus.off('event', sendEvent);
    });

    // Keep the SSE connection open (don't return)
    await reply.sse.keepAlive();
  });
}
```

### Pattern 3: Mutable Config Singleton
**What:** `tradingConfig` is currently a `const` exported from `src/config/trading.ts`. For runtime mutation, the dashboard POST endpoint needs a mutable handle. The cleanest approach is exporting a mutable wrapper with a `get()` / `patch()` API, used by all bot modules.

**When to use:** Required for DASH-04 and DASH-05. The existing `tradingConfig` is read at module import time by SafetyPipeline, ExecutionEngine, PositionManager, etc. A mutable singleton ensures all modules see updates without restart.

**Important constraint (from CONTEXT.md):** Config changes are in-memory only. Restart reverts to config file values. New limits apply forward-only: in-flight trades are never forcibly closed.

**Example:**
```typescript
// src/config/trading.ts — add below existing const tradingConfig
// Mutable reference — dashboard can patch at runtime
let _runtimeConfig: TradingConfig = configResult.data;

export const tradingConfig = {
  get(): TradingConfig { return _runtimeConfig; },
  patch(partial: Partial<TradingConfig>): TradingConfig {
    _runtimeConfig = { ..._runtimeConfig, ...partial };
    return _runtimeConfig;
  }
};
```

**Breaking change warning:** This changes `tradingConfig` from a plain object to an object with `get()`. All existing call sites (`tradingConfig.buyAmountSol`) become `tradingConfig.get().buyAmountSol`. This is the main refactoring work of the config endpoint plan. Alternatively, use a simpler module-level `let` and a separate `patchRuntimeConfig()` export.

**Simpler alternative (less invasive):**
```typescript
// Keep existing: export const tradingConfig: TradingConfig = configResult.data;
// Add mutable shadow:
let _runtimeConfig: TradingConfig = configResult.data;
export function getRuntimeConfig(): TradingConfig { return _runtimeConfig; }
export function patchRuntimeConfig(updates: Partial<TradingConfig>): void {
  _runtimeConfig = { ..._runtimeConfig, ...updates };
}
```
Then all existing call sites continue using `tradingConfig` for the initial value, while new dashboard-aware code calls `getRuntimeConfig()`.

**Recommendation:** The simpler alternative is less invasive and avoids touching all existing modules. PositionManager already receives config at constructor time — it would need to call `getRuntimeConfig()` on each tick if config changes should apply to polling interval. For safety score threshold, SafetyPipeline reads it on each evaluate() call — use `getRuntimeConfig()` there.

### Pattern 4: Fastify In-Process Integration
**What:** Fastify instance is created as part of `main()` in `index.ts` and passed through to `shutdown()`. It does not own process signals — the existing shutdown handler calls `fastify.close()`.

**Example:**
```typescript
// Source: Fastify ESM TypeScript docs + Context7
import Fastify from 'fastify';
import fastifySSE from '@fastify/sse';
import fastifyStatic from '@fastify/static';
import fastifyCors from '@fastify/cors';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export async function createDashboardServer(): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: false }); // Use bot's pino logger instead

  // CORS: allow Vite dev server origin in development
  await fastify.register(fastifyCors, {
    origin: process.env.NODE_ENV === 'development' ? 'http://localhost:5173' : false,
  });

  await fastify.register(fastifySSE);

  // Serve pre-built SPA from dashboard/dist/
  const distPath = join(dirname(fileURLToPath(import.meta.url)), '../../dashboard/dist');
  await fastify.register(fastifyStatic, {
    root: distPath,
    prefix: '/',
  });

  // Register API routes
  await fastify.register(eventsRoute);
  await fastify.register(tradesRoute, { prefix: '/api' });
  await fastify.register(configRoute, { prefix: '/api' });

  return fastify;
}
```

In `main()`:
```typescript
const dashboardServer = await createDashboardServer();
await dashboardServer.listen({ port: env.DASHBOARD_PORT ?? 3001, host: '127.0.0.1' });
```

In `shutdown()`:
```typescript
await dashboardServer.close(); // returns 503 on closing, drains connections
```

### Pattern 5: Vite Dev Proxy
**What:** During development, Vite dev server runs on port 5173 and proxies `/api/*` and `/events` to the bot's Fastify port, enabling HMR while hitting the live bot.

**Example:**
```typescript
// dashboard/vite.config.ts
// Source: Vite proxy docs via Context7
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

const BOT_PORT = process.env.BOT_PORT ?? 3001;

export default defineConfig({
  plugins: [preact()],
  root: './dashboard',
  build: {
    outDir: './dashboard/dist',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': { target: `http://localhost:${BOT_PORT}`, changeOrigin: true },
      '/events': { target: `http://localhost:${BOT_PORT}`, changeOrigin: true },
    },
  },
});
```

### Pattern 6: Browser EventSource + @preact/signals Feed
**What:** The frontend opens a single `EventSource('/events')` connection. Each message appends to a `signal<FeedEvent[]>`. A computed or effect trims the array to 200 entries.

**Example:**
```typescript
// dashboard/src/store/feed.ts
// Source: EventSource MDN + @preact/signals docs (Context7)
import { signal } from '@preact/signals';

export interface FeedEvent {
  type: string;
  mint: string;
  ts: number;
  detail?: string;
}

export const feedEvents = signal<FeedEvent[]>([]);

const MAX_FEED_SIZE = 200;

export function connectFeed(): () => void {
  const es = new EventSource('/events');

  es.onmessage = (e) => {
    const event: FeedEvent = JSON.parse(e.data as string);
    const current = feedEvents.value;
    const next = [...current, event];
    feedEvents.value = next.length > MAX_FEED_SIZE
      ? next.slice(next.length - MAX_FEED_SIZE)
      : next;
  };

  es.onerror = () => {
    // EventSource auto-reconnects after 3s (browser default)
  };

  return () => es.close();
}
```

### Anti-Patterns to Avoid
- **Storing trade history in the SSE stream:** SSE does not replay events to new connections. Performance tab data must come from a REST endpoint querying TradeStore directly.
- **Making SafetyPipeline/ExecutionEngine import from dashboard:** Dependency must flow bot→dashboard (bus publish), never dashboard→bot. Use the singleton bus.
- **Using `setInterval` for SSE heartbeat:** `@fastify/sse` handles heartbeat automatically (configurable, default 30s). Do not add manual timers.
- **Mutating `tradingConfig` directly from multiple modules:** Only one code path should write runtime config — the dashboard POST handler. All reads go through the same exported function.
- **Running Fastify listen() on 0.0.0.0 in production:** Bind to `127.0.0.1` by default. The operator's VPS operator handles external exposure (nginx/SSH tunnel). This matches the "no additional deployment" requirement.
- **Separate tsconfig for frontend in same src/ tree:** Keep frontend code in `dashboard/` outside `src/`. The bot's `tsconfig.json` includes only `src/**/*` — mixing frontend JSX into the bot's TS compilation breaks this.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SSE connection management | Custom `Set<Response>` + manual headers | `@fastify/sse` | Heartbeat, Last-Event-ID, reconnection handling, backpressure — all covered |
| SPA static file serving | Custom `readFile` + MIME mapping | `@fastify/static` | Cache-control headers, ETag, Range requests, correct MIME types |
| CORS preflight | Manual OPTIONS handler | `@fastify/cors` | Handles all preflight edge cases, wildcard methods, origin reflection |
| Frontend build | Webpack or rollup from scratch | Vite + @preact/preset-vite | One command, HMR, TypeScript, tree-shaking, optimized output |
| Reactive feed state | Manual `useState` + event listener cleanup | `@preact/signals` | Signals update only the exact DOM node reading them — no unnecessary component re-renders |

**Key insight:** SSE connection lifecycle (client disconnect, network interruption, heartbeat to prevent proxy timeouts) has many edge cases. The `@fastify/sse` plugin handles all of them with `reply.sse.isConnected`, `reply.sse.onClose()`, and configurable heartbeat. Never reimplement this.

## Common Pitfalls

### Pitfall 1: ESM `__dirname` not available in Node16 module mode
**What goes wrong:** `@fastify/static` examples use `path.join(__dirname, 'dist')` — this throws `ReferenceError: __dirname is not defined in ES module scope`.
**Why it happens:** The project uses `"type": "module"` and `"module": "Node16"` in tsconfig. `__dirname` does not exist in ESM.
**How to avoid:** Use `import.meta.dirname` (Node.js 20.11.0+, which this project's `@types/node@^25.3.0` targets) or the `fileURLToPath(import.meta.url)` + `dirname()` pattern.
**Warning signs:** TypeScript error `Cannot find name '__dirname'` or runtime ReferenceError.

```typescript
// Correct ESM pattern (Node.js 20+):
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
// Or: import.meta.dirname (Node 20.11.0+)
```

### Pitfall 2: Fastify logger conflicts with pino
**What goes wrong:** Passing `{ logger: true }` to `Fastify()` creates a second pino instance that outputs its own JSON logs, interleaving with the bot's structured logs.
**Why it happens:** Fastify has its own logger by default.
**How to avoid:** Pass the existing bot logger instance: `Fastify({ loggerInstance: logger })` where `logger` is imported from `src/core/logger.ts`, OR disable it with `{ logger: false }` and use the module logger manually for dashboard events.
**Warning signs:** Duplicate log entries, unexpected `reqId` fields in output.

### Pitfall 3: SSE client leak on client disconnect
**What goes wrong:** If `reply.sse.onClose()` cleanup is not registered, dead connections remain in the fan-out Set. Over time, `reply.sse.send()` throws or accumulates.
**Why it happens:** HTTP connection closes without the server side noticing if cleanup is omitted.
**How to avoid:** Always call `botEventBus.off('event', sendEvent)` inside `reply.sse.onClose()` callback.
**Warning signs:** Memory grows monotonically with each browser refresh.

### Pitfall 4: Runtime config mutation doesn't reach PositionManager
**What goes wrong:** PositionManager receives `config: TradingConfig` in its constructor and stores it as `private readonly config`. If the dashboard patches the runtime config object reference, PositionManager still holds the old reference.
**Why it happens:** JavaScript objects are passed by reference, but if `patchRuntimeConfig` creates a new object (`{ ..._runtimeConfig, ...partial }`), the old reference held by PositionManager is stale.
**How to avoid:** Two options: (a) PositionManager calls `getRuntimeConfig()` on each tick instead of using `this.config`, or (b) patch the existing object in-place (`Object.assign(_runtimeConfig, partial)` — mutates in-place, all holders see changes). Option (b) is simpler but makes config immutability harder to reason about. Option (a) is cleaner and consistent with the forward-only guarantee.
**Warning signs:** Stop-loss threshold change in dashboard has no effect until restart.

### Pitfall 5: Vite SPA routing — 404 on direct URL access
**What goes wrong:** Navigating directly to `http://localhost:3001/settings` returns 404 because Fastify tries to serve `settings/index.html` as a static file, which doesn't exist.
**Why it happens:** SPA routing is client-side. The server must serve `index.html` for all non-asset, non-API paths.
**How to avoid:** Register a wildcard route AFTER static plugin and API routes that serves `index.html`. The CONTEXT.md uses tabbed navigation (not URL routing), so this may be a non-issue if all tabs use hash routing or no routing at all. If only one URL (`/`) is needed, this pitfall is avoided entirely.
**Warning signs:** 404 errors when sharing/bookmarking dashboard URLs.

### Pitfall 6: Fastify plugin registration order
**What goes wrong:** Registering routes before registering plugins (cors, sse, static) causes "not decorated" errors at runtime.
**Why it happens:** Fastify's plugin system is scoped — decorators added in a plugin are only available after `await fastify.register(...)` resolves.
**How to avoid:** Always `await fastify.register(plugin)` before calling `fastify.get/post()` or `fastify.register(routePlugin)`.
**Warning signs:** TypeError: `reply.sse is not a function` or `reply.sendFile is not a function`.

### Pitfall 7: Large JSON payloads on /api/trades cause lag
**What goes wrong:** If the bot has run for weeks, `SELECT * FROM trades` returns thousands of rows. Serializing them on every dashboard poll causes noticeable bot latency (better-sqlite3 is synchronous — it blocks the event loop).
**Why it happens:** TradeStore queries are synchronous. A large result set blocks the Node.js event loop while serializing.
**How to avoid:** Limit queries: `LIMIT 100 ORDER BY updated_at DESC` for the performance tab. Add a `getRecentTrades(limit: number)` method to TradeStore rather than fetching all trades. The current TradeStore only queries non-terminal states — add a new query for recent completed/failed trades.
**Warning signs:** Bot latency spikes visible in pino logs when dashboard tab is open.

## Code Examples

Verified patterns from official sources:

### Fastify TypeScript ESM Server Setup
```typescript
// Source: Context7 /fastify/fastify — TypeScript ESM guide
import fastify, { type FastifyInstance } from 'fastify';

const server: FastifyInstance = fastify({ logger: false });

server.listen({ port: 3001, host: '127.0.0.1' }, (err, address) => {
  if (err) throw err;
  // Server listening at ${address}
});
```

### @fastify/static SPA Serving with Correct Cache Headers
```typescript
// Source: Context7 /fastify/fastify-static — SPA cache-control pattern
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

await fastify.register(fastifyStatic, {
  root: join(__dirname, '../../dashboard/dist'),
  maxAge: '30d',
  immutable: true,
});

// index.html must never be cached (SPA entry point)
fastify.get('/', async (req, reply) => {
  return reply.sendFile('index.html', { maxAge: 0, immutable: false });
});
```

### @fastify/sse Route
```typescript
// Source: @fastify/sse docs (WebFetch verified)
import fastifySSE from '@fastify/sse';
await fastify.register(fastifySSE);

fastify.get('/events', { sse: true }, async (request, reply) => {
  const sendEvent = (event: BotEvent) => {
    if (reply.sse.isConnected) {
      void reply.sse.send({ event: event.type, data: JSON.stringify(event) });
    }
  };
  botEventBus.on('event', sendEvent);
  reply.sse.onClose(() => botEventBus.off('event', sendEvent));
  await reply.sse.keepAlive();
});
```

### Fastify Graceful Close
```typescript
// Source: Context7 /fastify/fastify — graceful shutdown
// forceCloseConnections: 'idle' closes idle keep-alive connections on shutdown
// return503OnClosing: true returns 503 to new requests during drain
const server = fastify({
  logger: false,
  forceCloseConnections: 'idle',
  return503OnClosing: true,
});

// In existing shutdown() function in index.ts:
await server.close(); // Drains in-flight requests, triggers onClose hooks
```

### Preact + @preact/signals Vite Setup
```typescript
// dashboard/vite.config.ts
// Source: Context7 /vitejs/vite + @preact/preset-vite README
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
      '/events': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
  build: {
    outDir: '../dashboard-dist', // adjust path as needed
  },
});
```

### @preact/cors Dev Configuration
```typescript
// Source: Fastify cors docs (WebSearch verified, @fastify/cors v11.1.0)
import fastifyCors from '@fastify/cors';

await fastify.register(fastifyCors, {
  origin: env.NODE_ENV === 'development'
    ? ['http://localhost:5173', 'http://127.0.0.1:5173']
    : false,
  methods: ['GET', 'POST'],
});
```

### Simple API Key Auth (onRequest hook)
```typescript
// Source: Fastify hooks docs (Context7) — onRequest stage, no body parsing needed
// auth.ts
import type { FastifyRequest, FastifyReply } from 'fastify';

const DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY;

export async function apiKeyAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!DASHBOARD_API_KEY) return; // Auth disabled if key not configured
  const key = request.headers['x-dashboard-key'];
  if (key !== DASHBOARD_API_KEY) {
    await reply.code(401).send({ error: 'Unauthorized' });
  }
}

// Register globally:
fastify.addHook('onRequest', apiKeyAuth);
```

### Zod Validation for Config PATCH
```typescript
// Source: Zod v4 (already project dep) — safeParse pattern
import { z } from 'zod';

// Re-use or reference existing TradingConfigSchema
const ConfigPatchSchema = z.object({
  minSafetyScore:         z.number().int().min(0).max(100).optional(),
  buyAmountSol:           z.number().positive().max(10).optional(),
  maxConcurrentPositions: z.number().int().min(1).max(50).optional(),
  'positionManagement.stopLossPct': z.number().negative().optional(),
  // ... extend as needed
});

fastify.post('/api/config', async (req, reply) => {
  const result = ConfigPatchSchema.safeParse(req.body);
  if (!result.success) {
    return reply.code(400).send({ error: result.error.flatten() });
  }
  patchRuntimeConfig(result.data);
  return { ok: true, config: getRuntimeConfig() };
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Express (de facto standard) | Fastify v5 (faster, TypeScript-native, plugin ecosystem) | 2023-2024 | Fastify now recommended for new Node.js HTTP servers |
| `@types/node` `__dirname` polyfill | `import.meta.dirname` (Node 20.11.0+) | Node 20.11.0 (2024) | Cleaner ESM code; `@types/node@^25.3.0` already includes this |
| WebSockets for real-time push | SSE for server-to-browser push | Stable standard | SSE is unidirectional, simpler, auto-reconnects, no library needed on client |
| React + Redux for SPA state | Preact + @preact/signals | 2022–2023 | Signals avoid virtual DOM diffing overhead for high-frequency updates |
| `vite build` produces flat HTML | Vite + preset-vite produces optimized SPA bundle | Stable | @preact/preset-vite handles all JSX transform and HMR automatically |

**Deprecated/outdated:**
- `fastify-sse` (un-prefixed): Deprecated, replaced by `@fastify/sse` (official scoped package). Use `@fastify/sse` only.
- `fastify-cors` (un-prefixed): Deprecated, use `@fastify/cors`.
- `__dirname` in ESM: Not deprecated but unnecessary with `import.meta.dirname` on Node 20.11.0+.

## Open Questions

1. **Dashboard port — env var or config.jsonc?**
   - What we know: Other deployment-time switches (PUMPPORTAL_ENABLED, RAYDIUM_ENABLED) live in `.env`. Trading parameters live in `config.jsonc`.
   - What's unclear: Whether `DASHBOARD_PORT` belongs in `.env` (deployment-time) or `config.jsonc` (operator preference). API key for auth is clearly `.env`.
   - Recommendation: Put `DASHBOARD_PORT` (default 3001) and `DASHBOARD_API_KEY` (optional) in `.env` / `EnvSchema`. Consistent with existing pattern for deployment-time settings.

2. **Where does `patchRuntimeConfig` propagate to PositionManager?**
   - What we know: PositionManager stores `private readonly config: TradingConfig` at constructor time. Patching the config singleton creates a new object reference.
   - What's unclear: Whether PositionManager should be refactored to call `getRuntimeConfig()` on each tick vs. storing config by reference.
   - Recommendation: Refactor PositionManager to call `getRuntimeConfig()` on each tick. The change is localized to `position-manager.ts`. The forward-only guarantee (no forcible close of in-flight trades) is naturally satisfied because the tick only reads config for the next evaluation.

3. **How does Performance tab get per-trade current price?**
   - What we know: Per-trade P&L requires current price. The dashboard REST endpoint at `GET /api/trades` can return MONITORING trades. Current price requires a Jupiter quote — same call as PositionManager.
   - What's unclear: Whether the dashboard should make live Jupiter calls (adds API rate pressure) or use PositionManager's cached last-known price.
   - Recommendation: For the Performance tab, show entry price and last-known price from TradeStore (no extra Jupiter calls from dashboard). The SSE feed shows live events. A separate "refresh" button for current P&L is acceptable — avoids race with PositionManager's polling.

4. **Build script integration — monorepo or flat?**
   - What we know: Project is a single `package.json` with `pnpm`. Adding frontend deps to root is workable. Build output for the SPA needs to land somewhere Fastify can serve it.
   - Recommendation: Keep a single `package.json`. Add `build:dashboard` script: `vite build --config dashboard/vite.config.ts`. The `dist` output goes to `dashboard/dist/` (outside `src/`, excluded from tsc). Add `dashboard/dist/` to `.gitignore`. Pre-deployment: run `pnpm build:dashboard` before starting bot.

## Sources

### Primary (HIGH confidence)
- Context7 `/fastify/fastify` — ESM TypeScript setup, graceful shutdown, onClose hook, onRequest hook
- Context7 `/fastify/fastify-static` — SPA cache-control, reply.sendFile, static root configuration
- Context7 `/vitejs/vite` — proxy configuration, defineConfig, build outDir
- Context7 `/preactjs/preact-www` — useState, useEffect, signals, TypeScript hooks
- @preact/preset-vite GitHub README (WebFetch) — installation, vite.config.ts setup, what the preset handles
- @fastify/sse GitHub (WebFetch) — SSEMessage type, route setup, async generator support, `reply.sse.*` API

### Secondary (MEDIUM confidence)
- WebSearch "Fastify SSE server-sent events TypeScript 2025" — confirmed @fastify/sse as official plugin, identified alternative `fastify-sse-v2`
- WebSearch "Fastify onRequest hook API key authentication" — confirmed `onRequest` is correct hook for header-based auth (no body parse needed)
- WebSearch "Fastify ESM __dirname import.meta" — confirmed `import.meta.dirname` pattern for Node 20.11.0+
- WebSearch "@fastify/cors version 2025" — confirmed v11.1.0, current API

### Tertiary (LOW confidence)
- WebSearch "SSE fan-out multiple clients EventEmitter Set pattern" — pattern is well-established but not directly verified in Fastify-specific docs; cross-referenced with @fastify/sse `onClose` and `isConnected` APIs

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries verified via Context7 and official docs; versions current
- Architecture: HIGH — patterns derived from verified API shapes; integration points mapped to existing codebase
- Pitfalls: MEDIUM — ESM `__dirname` and Fastify plugin order are verified; config mutation propagation pitfall is HIGH (known JS reference semantics); SPA 404 routing is MEDIUM (avoidable via tab-based UI)

**Research date:** 2026-02-27
**Valid until:** 2026-03-27 (Fastify and Vite ecosystems are stable; @fastify/sse API unlikely to change in 30 days)
