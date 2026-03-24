# Phase 09 Deferred Items

## Pre-existing Test Failures (out of scope for 09-02)

**Issue:** 12 test files fail at import time with "Configuration validation failed: [SOLSNIPER_JUPITER_API_KEY] Invalid input: expected string, received undefined"

**Root cause:** Plan 09-01 added `SOLSNIPER_JUPITER_API_KEY` as a required field in `env.ts`. These test files import modules that transitively import `logger.ts` → `env.ts`, but they don't mock `env.js`. This was an existing issue before 09-02.

**Affected files:**
- src/core/resilient-ws.test.ts
- src/core/rpc-manager.test.ts
- src/execution/broadcaster.test.ts
- src/execution/execution-engine.test.ts
- src/detection/detection-manager.test.ts
- src/persistence/trade-store.test.ts
- src/recovery/recovery-manager.test.ts
- src/safety/safety-pipeline.test.ts
- src/execution/buy/pump-portal-buyer.test.ts
- src/execution/sell/sell-ladder.test.ts
- src/safety/checks/tier2-rugcheck.test.ts
- src/safety/checks/tier3-creator.test.ts

**Fix required:** Add `vi.mock('../config/env.js', () => ({ env: { SOLSNIPER_JUPITER_API_KEY: 'test-api-key', LOG_LEVEL: 'error', NODE_ENV: 'development', ... } }))` to each affected test file, OR add `SOLSNIPER_JUPITER_API_KEY=<key>` to `.env` (user action).

**Also:** `src/detection/detection-manager.test.ts` has a TypeScript error: mock env type has `SOLSNIPER_JUPITER_API_KEY: string | undefined` but env type requires `string`. Needs updating to use `string` in mock.
