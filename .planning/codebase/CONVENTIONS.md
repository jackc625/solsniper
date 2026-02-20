# Coding Conventions

**Analysis Date:** 2026-02-20

## Naming Patterns

**Files:**
- Modules: `kebab-case` (e.g., `safety-checker.ts`, `position-monitor.ts`, `trade-logger.ts`)
- Classes and types: exported in PascalCase from files
- Utility modules: descriptive kebab-case (e.g., `jupiter-client.ts`, `pumpportal-listener.ts`)
- Test files: `[module].test.ts` or `[module].spec.ts` (co-located with source)

**Functions:**
- Regular functions: `camelCase` (e.g., `runSafetyChecks()`, `buildSwapTransaction()`, `executeOrder()`)
- Async functions: `camelCase` with semantic naming (e.g., `getJupiterQuote()`, `fetchLatestBlockhash()`, `simulateTransaction()`)
- Private methods: prefix with `#` or `private` keyword (e.g., `private async checkMintAuthority()`)
- Event handlers: prefix with `on` or `handle` (e.g., `onAccountChange()`, `handleWebSocketMessage()`)

**Variables:**
- Constants: `SCREAMING_SNAKE_CASE` for configuration and magic numbers (e.g., `MAX_BUY_AMOUNT`, `SAFETY_CHECK_TIMEOUT_MS`, `MIN_LIQUIDITY_THRESHOLD`)
- State variables (class properties): `camelCase` (e.g., `shadowPortfolio`, `pollInterval`, `positionMap`)
- Loop/temporary variables: concise `camelCase` (e.g., `mint`, `position`, `quote`)
- Configuration objects: `camelCase` keys (e.g., `{ stopLoss: -30, takeProfit1: 100 }`)

**Types and Interfaces:**
- Interfaces/types: `PascalCase` (e.g., `SafetyCheckResult`, `Position`, `SwapQuote`, `TokenMetadata`)
- Union/discriminated types: `PascalCase` with semantic suffixes (e.g., `ExitReason = 'STOP_LOSS' | 'TAKE_PROFIT_1' | 'TIME_BASED'`)
- Enum members: `SCREAMING_SNAKE_CASE` (e.g., `enum ExitStrategy { TIERED_PROFIT, TRAILING_STOP, TIME_BASED }`)

## Code Style

**Formatting:**
- Indent: 2 spaces (not tabs)
- Line length: 100 characters (soft limit, 120 hard limit)
- Quotes: double quotes for strings, single quotes for object keys when necessary
- Semicolons: required at end of statements

**Linting:**
- ESLint configuration recommended for consistency
- Rules focus: no unused variables, no implicit `any`, require explicit type annotations
- Async/await preferred over `.then()` chains
- Null checking: use optional chaining (`?.`) and nullish coalescing (`??`)

**Code organization (within files):**
```typescript
// 1. Imports (external, then internal, then type imports)
import { Connection, PublicKey } from '@solana/web3.js';
import { getRoutes } from '@jup-ag/api';

import { logger } from './logger';
import type { Position, SafetyCheckResult } from './types';

// 2. Type definitions
interface PositionManagerConfig {
  pollIntervalMs: number;
  maxPositions: number;
}

// 3. Constants
const DEFAULT_POLL_INTERVAL_MS = 3000;
const MAX_CONCURRENT_POSITIONS = 10;

// 4. Class or main function export
export class PositionMonitor {
  private positions: Map<string, Position> = new Map();
  private pollInterval: NodeJS.Timer | null = null;

  constructor(private config: PositionManagerConfig) {}

  // Public methods first
  public start() { /* ... */ }

  public async checkAll() { /* ... */ }

  // Private methods last
  private async evaluatePosition(mint: string) { /* ... */ }
}

// 5. Helper functions (if any)
function calculatePnlPercentage(entryPrice: number, currentPrice: number): number {
  return ((currentPrice - entryPrice) / entryPrice) * 100;
}
```

## Import Organization

**Order:**
1. External packages (`@solana/web3.js`, `ws`, `pino`, etc.)
2. Type imports from external packages (`import type { ... } from '@solana/web3.js'`)
3. Internal absolute imports (using path aliases if configured)
4. Internal relative imports (e.g., `./logger`)
5. Type imports from internal modules (`import type { ... } from './types'`)

**Path Aliases:**
- Recommended setup in `tsconfig.json`:
  ```json
  {
    "compilerOptions": {
      "baseUrl": ".",
      "paths": {
        "@/*": ["src/*"],
        "@types/*": ["src/types/*"],
        "@utils/*": ["src/utils/*"],
        "@services/*": ["src/services/*"]
      }
    }
  }
  ```
- Use aliases for deep imports to avoid relative path chains: `import { logger } from '@/logger'` instead of `import { logger } from '../../../logger'`

## Error Handling

**Patterns:**

1. **Custom Error Classes:**
```typescript
export class SafetyCheckFailedError extends Error {
  constructor(public reason: string, public flags: string[]) {
    super(`Safety check failed: ${reason}`);
    this.name = 'SafetyCheckFailedError';
  }
}

export class TransactionFailedError extends Error {
  constructor(public signature: string, public rpcError: unknown) {
    super(`Transaction failed: ${signature}`);
    this.name = 'TransactionFailedError';
  }
}
```

2. **Async Error Handling:**
```typescript
// Use try-catch for async operations
async function executeSwap(quote: SwapQuote): Promise<string> {
  try {
    const tx = await buildSwapTransaction(quote);
    const signature = await connection.sendTransaction(tx);
    return signature;
  } catch (error) {
    logger.error({ error, quote }, 'Swap execution failed');
    throw new TransactionFailedError('', error);
  }
}

// For operations that should not throw, use Result pattern
async function safeGetBalance(wallet: PublicKey): Promise<number | null> {
  try {
    return await connection.getBalance(wallet);
  } catch (error) {
    logger.warn({ error, wallet }, 'Failed to fetch balance');
    return null;
  }
}
```

3. **Retry Logic:**
```typescript
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  baseDelayMs: number = 1000
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      const delayMs = baseDelayMs * Math.pow(2, attempt);
      logger.warn({ attempt, delayMs, error }, 'Retry attempt');
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  throw lastError || new Error('Max retries exceeded');
}
```

4. **Null/Undefined Handling:**
```typescript
// Use optional chaining and nullish coalescing
const safeMint = quote?.outMint ?? null;
const amount = position?.amount ?? 0;

// For type narrowing, use explicit checks
if (!mint || !position) {
  logger.error({ mint, position }, 'Invalid position');
  return null;
}
```

## Logging

**Framework:** `pino` for structured JSON logging

**Patterns:**

1. **Module Setup:**
```typescript
import pino from 'pino';

// Use child logger per module
const logger = pino().child({ module: 'safety-checker' });
```

2. **Log Levels and Usage:**
```typescript
// error: actionable failures (transaction failed, API error)
logger.error({ error, mint }, 'Safety check failed');

// warn: degraded behavior (retry triggered, suboptimal path taken)
logger.warn({ attempt: 2, delayMs: 2000 }, 'Retrying transaction');

// info: significant business events (token detected, position opened, exit triggered)
logger.info({ mint, buyPrice: 0.0001, amount: 1000000 }, 'Position opened');

// debug: detailed execution flow (trade simulation, quota check)
logger.debug({ stage: 'simulation', result: true }, 'Transaction simulated');
```

3. **Structured Logging (include context objects):**
```typescript
// Good: structured context
logger.info(
  { mint, score: 85, flags: ['high_liquidity'], riskLevel: 'low' },
  'Safety check passed'
);

// Avoid: unstructured string concatenation
logger.info(`Safety check passed for ${mint} with score ${score}`);
```

4. **Sensitive Data:**
```typescript
// Never log private keys, wallet secrets, or full signatures
// Log transaction signature (last 8 chars only for sensitive contexts)
logger.info({ txSig: signature.slice(-8) }, 'Transaction confirmed');

// Log public info only
logger.info({ mint, amount, price }, 'Quote received');
```

## Comments

**When to Comment:**
- Complex algorithmic logic (e.g., price impact calculations, safety scoring)
- Non-obvious Solana SDK patterns (e.g., account data parsing, versioned transaction building)
- Trade-offs or temporary workarounds (TODO/FIXME tags)
- Business logic that's not self-evident from code

**JSDoc/TSDoc:**
```typescript
/**
 * Runs Tier 1 safety checks in parallel.
 *
 * @param mint - Token mint address
 * @param timeoutMs - Maximum time to wait for checks (default: 300)
 * @returns SafetyCheckResult with score (0-100) and blocking flags
 *
 * @example
 * const result = await runSafetyChecks('EPjFWdd5...');
 * if (result.score < 50) console.log('Failed:', result.flags);
 */
export async function runSafetyChecks(
  mint: string,
  timeoutMs: number = 300
): Promise<SafetyCheckResult> {
  // ...
}
```

**Inline Comments (sparingly):**
```typescript
// Use comments only for why, not what
// Why: Solana returns stale blockhashes under high load on some RPCs
const blockhash = await connection.getLatestBlockhash('processed');

// Avoid: explaining obvious code
// const score = safety.score; // Get the safety score
```

## Function Design

**Size:** Keep functions small and focused
- Target: 20-50 lines for async functions
- Max: 100 lines before refactoring into smaller functions
- Single responsibility: one decision point or one async operation per function

**Parameters:**
```typescript
// Prefer named object parameters for clarity
async function executeSell(options: {
  mint: string;
  amount: number;
  exitReason: ExitReason;
  slippage: number;
}): Promise<string> {
  // ...
}

// Avoid: long parameter lists
// async function executeSell(mint: string, amount: number, reason: string, slippage: number)
```

**Return Values:**
```typescript
// For operations that may fail, return explicit success type
interface ExecutionResult {
  success: boolean;
  signature?: string;
  error?: Error;
  retryable: boolean;
}

// For side-effect functions that validate, return boolean
function isValidToken(mint: string): boolean {
  return /^[1-9A-HJ-NP-Z]{44}$/.test(mint); // Base58 validation
}

// For multiple return values, use object destructuring
function calculateMetrics(position: Position) {
  return {
    pnlPercent: ((currentPrice - entryPrice) / entryPrice) * 100,
    realizedGain: (exitPrice - entryPrice) * amount,
    holdTimeMs: Date.now() - position.enteredAt.getTime()
  };
}
```

## Module Design

**Exports:**
```typescript
// Prefer named exports over default exports
export class PositionMonitor { /* ... */ }
export async function getJupiterQuote() { /* ... */ }
export const DEFAULT_CONFIG = { /* ... */ };

// Use default export only for single-class modules
// export default class SafetyChecker { }
```

**Barrel Files:**
Use barrel files (`index.ts`) for cleaner imports in subdirectories:

```typescript
// src/services/index.ts
export { SafetyChecker } from './safety-checker';
export { PositionMonitor } from './position-monitor';
export { SwapExecutor } from './swap-executor';

export type { SafetyCheckResult, Position } from './types';
```

Then import cleanly:
```typescript
import { SafetyChecker, PositionMonitor } from '@/services';
```

**Avoid:**
- Circular dependencies (refactor to share types or create intermediate module)
- Deep re-exports (e.g., `export * from './nested/deep/module'`)

---

*Convention analysis: 2026-02-20*
