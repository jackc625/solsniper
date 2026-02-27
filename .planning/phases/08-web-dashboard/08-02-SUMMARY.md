---
phase: 08-web-dashboard
plan: 02
subsystem: api
tags: [fastify, sse, rest, dashboard, typescript]

# Dependency graph
requires:
  - phase: 08-01
    provides: botEventBus singleton, getRuntimeConfig/patchRuntimeConfig, env.DASHBOARD_PORT/DASHBOARD_API_KEY
provides:
  - createDashboardServer(tradeStore) Fastify factory with all plugins and routes registered
  - GET /events SSE stream wired to botEventBus with client disconnect cleanup
  - GET /api/trades returns MONITORING positions enriched with stop-loss/take-profit targets
  - GET /api/stats returns openPositions, winRate, totalPnlSol via raw SQLite query
  - GET /api/config and POST /api/config with Zod ConfigPatchSchema validation
  - apiKeyAuth onRequest hook (opt-in — disabled if DASHBOARD_API_KEY absent)
affects: [08-03, 08-04]

# Tech tracking
tech-stack:
  added: [fastify@5.7.4, "@fastify/sse@0.4.0", "@fastify/static@9.0.0", "@fastify/cors@11.2.0", "vite@7.3.1", "@preact/preset-vite@2.10.3", "preact@10.28.4", "@preact/signals@2.8.1"]
  patterns: [Fastify plugin pattern (async function + opts), SSE fan-out with botEventBus.on/off for clean client lifecycle, raw DB access via type-cast for read-only stats]

key-files:
  created:
    - src/dashboard/auth.ts
    - src/dashboard/dashboard-server.ts
    - src/dashboard/routes/events.ts
    - src/dashboard/routes/trades.ts
    - src/dashboard/routes/config.ts
  modified:
    - package.json
    - pnpm-lock.yaml

key-decisions:
  - "createRequire() used for @fastify/sse CJS module load in dashboard-server.ts — prevents TS2769 type overload mismatch with Fastify 5 plugin registry"
  - "import type {} from '@fastify/sse' added in events.ts to trigger module augmentation (reply.sse + sse route option) without loading runtime code"
  - "Raw DB cast (tradeStore as any).db for /api/stats completed trade counts — avoids adding getCompletedTrades() to TradeStore in this plan"
  - "tieredTp[0]?.at ?? 2 fallback in takeProfitTarget calc — guards against empty tieredTp array"
  - "keepAlive() called without await — SSEReplyInterface.keepAlive() returns void, not Promise"

patterns-established:
  - "Fastify plugin: async function accepting FastifyInstance + typed options extending FastifyPluginOptions"
  - "SSE client lifecycle: botEventBus.on in handler, botEventBus.off in reply.sse.onClose callback"
  - "Zod validation in POST routes: safeParse + flatten() error details on 400"

requirements-completed: [DASH-01, DASH-02, DASH-03, DASH-04, DASH-05, DASH-06]

# Metrics
duration: 6min
completed: 2026-02-27
---

# Phase 8 Plan 02: Web Dashboard Backend Summary

**Fastify 5 HTTP server with SSE event stream, trades/stats REST API, and runtime config GET/PATCH using @fastify/sse, @fastify/static, and @fastify/cors**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-27T21:48:23Z
- **Completed:** 2026-02-27T21:54:31Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- Fastify 5 server factory with CORS (dev-only), SSE plugin, static file serving for SPA, and API key auth hook
- GET /events SSE endpoint that fans out BotEvent objects to connected clients with clean disconnect handling via botEventBus.off
- GET /api/trades and GET /api/stats REST routes: trades returns MONITORING positions enriched with stop-loss/take-profit targets; stats returns win rate and total realized P&L via raw SQLite query
- GET /api/config and POST /api/config with ConfigPatchSchema Zod validation and patchRuntimeConfig integration
- tsc --noEmit exits 0; all 178 existing tests continue to pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Install dependencies and create auth hook + dashboard server factory** - `cd6b354` (feat)
2. **Task 2: Create SSE events route, trades/stats route, and config route** - `ce3423f` (feat)

## Files Created/Modified

- `src/dashboard/auth.ts` - apiKeyAuth onRequest hook; no-op when DASHBOARD_API_KEY absent
- `src/dashboard/dashboard-server.ts` - createDashboardServer() Fastify factory; registers CORS, SSE, static plugins + all routes
- `src/dashboard/routes/events.ts` - GET /events SSE fan-out wired to botEventBus with disconnect cleanup
- `src/dashboard/routes/trades.ts` - GET /api/trades (MONITORING enriched) and GET /api/stats (portfolio summary with raw DB query)
- `src/dashboard/routes/config.ts` - GET /api/config and POST /api/config with ConfigPatchSchema Zod validation
- `package.json` - Added fastify, @fastify/sse, @fastify/static, @fastify/cors as deps; vite, preact, @preact/* as devDeps
- `pnpm-lock.yaml` - Updated lockfile

## Decisions Made

- **createRequire for @fastify/sse**: The ESM default import of `@fastify/sse` caused TS2769 type overload mismatch with Fastify 5's `register()` overloads. Using `createRequire()` bypasses this, matching the project's existing pattern for CJS-native modules (better-sqlite3).
- **Type-only `import type {} from '@fastify/sse'` in events.ts**: When @fastify/sse is loaded via createRequire in the server factory, its `declare module 'fastify'` augmentation (which adds `reply.sse` and the `sse` route option) isn't triggered automatically. A side-effect-free type import in events.ts applies the augmentation and resolves the TS2353/TS2339 errors.
- **Raw DB cast for /api/stats**: TradeStore has no `getCompletedTrades()` method. Rather than modifying TradeStore in this plan (which belongs in a later refactor), the route casts `(tradeStore as any).db` for a single read-only stats query. This is explicitly flagged with a comment.
- **tieredTp[0]?.at ?? 2 fallback**: Strict TypeScript with `noUncheckedIndexedAccess` would flag `[0]` access on the tieredTp array. Added optional chaining and null-coalescing fallback to handle the case of an empty tiered TP config.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed @fastify/sse ESM type registration causing TS2769**
- **Found during:** Task 1 (dashboard-server.ts creation)
- **Issue:** `import fastifySSE from '@fastify/sse'` produced TS2769 "No overload matches this call" on `fastify.register(fastifySSE)` due to CJS/ESM type mismatch with Fastify 5
- **Fix:** Used `createRequire(import.meta.url)` to load the module, matching the project's established pattern for CJS native modules
- **Files modified:** src/dashboard/dashboard-server.ts
- **Verification:** tsc --noEmit exits 0
- **Committed in:** cd6b354 (Task 1 commit)

**2. [Rule 1 - Bug] Fixed @fastify/sse module augmentation not applied in events.ts**
- **Found during:** Task 2 (events.ts creation)
- **Issue:** `reply.sse` and `{ sse: true }` route option were unknown types because the @fastify/sse module augmentation was never triggered (plugin loaded via createRequire in dashboard-server.ts, not imported as ESM)
- **Fix:** Added `import type {} from '@fastify/sse'` in events.ts to trigger the `declare module 'fastify'` augmentation without loading runtime code
- **Files modified:** src/dashboard/routes/events.ts
- **Verification:** tsc --noEmit exits 0
- **Committed in:** ce3423f (Task 2 commit)

**3. [Rule 1 - Bug] Fixed tieredTp array access — added ?? 2 fallback**
- **Found during:** Task 2 (trades.ts creation)
- **Issue:** `config.positionManagement.tieredTp[0]?.at` could be undefined if tieredTp is empty; calculation would produce NaN takeProfitTarget
- **Fix:** Added `?? 2` fallback (2x multiplier default, matching config default value)
- **Files modified:** src/dashboard/routes/trades.ts
- **Verification:** tsc --noEmit exits 0; logical correctness matches config.json default tieredTp[0].at = 2
- **Committed in:** ce3423f (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (Rule 1 - all TypeScript/correctness bugs)
**Impact on plan:** All fixes required for TypeScript clean compile. CJS interop patterns are consistent with established project conventions. No scope creep.

## Issues Encountered

- @fastify/sse has a CJS/ESM interop issue with Fastify 5's TypeScript overloads. Resolved via createRequire pattern (same as better-sqlite3 in trade-store.ts) plus a side-effect-free type import in the route file.

## User Setup Required

None — DASHBOARD_PORT defaults to 3001, DASHBOARD_API_KEY is optional. Both are already documented in env.ts from Plan 08-01.

## Next Phase Readiness

- Full backend HTTP API surface is complete and compiles clean
- Plan 08-03 (frontend Preact SPA) can be built against these route contracts
- Plan 08-04 (bot wiring) can import `createDashboardServer` from `src/dashboard/dashboard-server.ts`
- No blockers

---
*Phase: 08-web-dashboard*
*Completed: 2026-02-27*
