# Testing Patterns

**Analysis Date:** 2026-02-20

## Test Framework

**Runner:**
- Vitest (recommended) or Jest
- Config: `vitest.config.ts` or `jest.config.js`
- Use TypeScript with `@types/jest` or native Vitest support

**Assertion Library:**
- Vitest built-in assertions or `@testing-library/jest-dom` for additional matchers
- For async testing: use `assert.rejects()` for Promise rejection testing

**Run Commands:**
```bash
npm run test              # Run all tests once
npm run test:watch       # Watch mode (re-run on file changes)
npm run test:coverage    # Generate coverage report
npm run test:ui          # Vitest UI (if using Vitest)
```

## Test File Organization

**Location:**
- Co-located with source code: `[module].test.ts` next to `[module].ts`
- Example structure:
  ```
  src/
  ├── services/
  │   ├── safety-checker.ts
  │   ├── safety-checker.test.ts
  │   ├── position-monitor.ts
  │   └── position-monitor.test.ts
  └── utils/
      ├── token-validator.ts
      └── token-validator.test.ts
  ```

**Naming:**
- Test files: `[module].test.ts` (preferred) or `[module].spec.ts`
- Test groups: named with `.test.ts` extension
- Fixture files: `[module].fixtures.ts` (for shared test data)

**Structure:**
```
test/
├── fixtures/              # Shared test data and mocks
│   ├── token-fixtures.ts
│   ├── wallet-fixtures.ts
│   └── quote-fixtures.ts
├── integration/           # Integration tests (optional, separate from unit)
│   └── safety-checker.integration.test.ts
└── e2e/                  # End-to-end tests (optional, mainnet simulation)
    └── buy-sell-flow.e2e.test.ts
```

## Test Structure

**Suite Organization:**
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SafetyChecker } from './safety-checker';

describe('SafetyChecker', () => {
  let checker: SafetyChecker;

  beforeEach(() => {
    checker = new SafetyChecker(mockConnection);
  });

  afterEach(() => {
    // Cleanup
  });

  describe('runSafetyChecks', () => {
    it('should return high score for known good token', async () => {
      const result = await checker.runSafetyChecks(USDC_MINT);
      expect(result.score).toBeGreaterThan(80);
      expect(result.flags).not.toContain('mint_authority_active');
    });

    it('should block tokens with freeze authority', async () => {
      const result = await checker.runSafetyChecks(HONEYPOT_MINT);
      expect(result.score).toBe(0);
      expect(result.flags).toContain('freeze_authority_active');
    });

    it('should timeout gracefully after 300ms', async () => {
      const slowMint = 'slowtoken...';
      const result = await checker.runSafetyChecks(slowMint, 100);
      expect(result.timedOut).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should throw SafetyCheckFailedError on RPC failure', async () => {
      const badMint = 'invalidmint';
      await expect(checker.runSafetyChecks(badMint)).rejects.toThrow(
        SafetyCheckFailedError
      );
    });
  });
});
```

**Patterns:**

1. **Setup Pattern:**
```typescript
beforeEach(async () => {
  // Create fresh instances
  connection = new Connection('http://localhost:8899');
  checker = new SafetyChecker(connection);

  // Initialize mocks
  vi.mocked(fetch).mockClear();
});

afterEach(() => {
  // Clean up timers, subscriptions, etc.
  vi.clearAllTimers();
});
```

2. **Teardown Pattern:**
```typescript
afterEach(async () => {
  // Close connections
  await listener.close();

  // Reset mocks
  vi.resetAllMocks();

  // Clean up temporary data
  await db.clear();
});
```

3. **Assertion Pattern:**
```typescript
// Use specific matchers for clarity
expect(score).toBeGreaterThan(50);
expect(flags).toContain('mint_authority_active');
expect(result).toEqual({ success: true, signature: '...' });
expect(callback).toHaveBeenCalledWith(expectedValue);

// Use snapshots for complex objects (carefully)
expect(position).toMatchSnapshot();

// Avoid vague assertions
// expect(result).toBeTruthy();  // Too vague
```

## Mocking

**Framework:** `vitest` with native mocking (or `jest.mock()` if using Jest)

**Patterns:**

1. **Mocking External APIs:**
```typescript
import { vi, describe, it, expect, beforeEach } from 'vitest';
import * as jupiterApi from '@jup-ag/api';

vi.mock('@jup-ag/api', () => ({
  getRoutes: vi.fn(),
}));

describe('SwapExecutor', () => {
  beforeEach(() => {
    vi.mocked(jupiterApi.getRoutes).mockResolvedValue({
      routePlanWithMetrics: [
        {
          swapInfo: { label: 'Jupiter V4' },
          outAmount: '1000000',
          priceImpactPct: '2.5',
        }
      ]
    } as any);
  });

  it('should fetch routes from Jupiter', async () => {
    const executor = new SwapExecutor();
    const route = await executor.getBestRoute('mint1', 'mint2', 1000);

    expect(jupiterApi.getRoutes).toHaveBeenCalledWith({
      inputMint: 'mint1',
      outputMint: 'mint2',
      amount: 1000,
    });
    expect(route.outAmount).toBe('1000000');
  });
});
```

2. **Mocking Solana Connection:**
```typescript
import { Connection, PublicKey } from '@solana/web3.js';

// Mock the Connection class
const mockConnection = {
  simulateTransaction: vi.fn().mockResolvedValue({
    value: { err: null, logs: [...], unitsConsumed: 50000 }
  }),
  sendTransaction: vi.fn().mockResolvedValue('sig_...'),
  getBalance: vi.fn().mockResolvedValue(1000000),
  getLatestBlockhash: vi.fn().mockResolvedValue({
    blockhash: 'Bqu...', lastValidBlockHeight: 12345
  }),
} as Partial<Connection>;

describe('TransactionBuilder', () => {
  it('should simulate before sending', async () => {
    const builder = new TransactionBuilder(mockConnection as Connection);
    const result = await builder.simulate(mockTx);

    expect(mockConnection.simulateTransaction).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });
});
```

3. **Mocking WebSocket Listeners:**
```typescript
import { vi, describe, it, expect } from 'vitest';

describe('PumpPortalListener', () => {
  let mockWs: any;

  beforeEach(() => {
    mockWs = {
      on: vi.fn(),
      send: vi.fn(),
      close: vi.fn(),
    };

    // Mock the ws constructor
    vi.mock('ws', () => ({
      WebSocket: vi.fn(() => mockWs)
    }));
  });

  it('should subscribe to token trades', async () => {
    const listener = new PumpPortalListener();

    // Simulate WebSocket connection
    const onCall = mockWs.on.mock.calls.find(call => call[0] === 'open');
    onCall[1](); // Trigger 'open' callback

    expect(mockWs.send).toHaveBeenCalledWith(
      expect.stringContaining('subscribeTokenTrade')
    );
  });

  it('should parse incoming trade messages', async () => {
    const listener = new PumpPortalListener();
    const callback = vi.fn();
    listener.on('trade', callback);

    // Simulate incoming message
    const msgCall = mockWs.on.mock.calls.find(call => call[0] === 'message');
    msgCall[1](JSON.stringify({
      method: 'subscribeTokenTrade',
      tx: { mint: '...', tradeAmount: 1000000 }
    }));

    expect(callback).toHaveBeenCalledWith(expect.objectContaining({
      mint: '...'
    }));
  });
});
```

**What to Mock:**
- External API calls (Jupiter, RugCheck, Birdeye)
- WebSocket connections (PumpPortal, account subscriptions)
- Solana Connection RPC methods (for unit tests)
- Timers and intervals (`vi.useFakeTimers()`)
- File system (for database tests)

**What NOT to Mock:**
- Solana transaction building logic (test with real `@solana/web3.js` classes)
- Token validator logic (test with real validation rules)
- Error handling paths (test with real error conditions)
- Type conversions and utility functions (test with real implementations)

## Fixtures and Factories

**Test Data:**
```typescript
// test/fixtures/token-fixtures.ts
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const KNOWN_HONEYPOT_MINT = 'honey2tokenaddress...';

export const mockTokenMetadata = {
  mint: USDC_MINT,
  name: 'USD Coin',
  symbol: 'USDC',
  decimals: 6,
  freezeAuthority: null,
  mintAuthority: null,
};

export const mockSafetyResult = {
  score: 95,
  mustPass: true,
  flags: [],
  timedOut: false,
};

export const mockHighRiskToken = {
  score: 15,
  mustPass: false,
  flags: ['freeze_authority_active', 'low_liquidity'],
  timedOut: false,
};
```

```typescript
// test/fixtures/quote-fixtures.ts
export function mockJupiterQuote(overrides?: Partial<SwapQuote>) {
  return {
    inputMint: 'So11111111111111111111111111111111111111112',
    outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    inAmount: '1000000000', // 1 SOL
    outAmount: '6000000', // ~6 USDC
    priceImpactPct: '0.5',
    routePlan: [],
    ...overrides,
  };
}

export function mockPosition(overrides?: Partial<Position>) {
  return {
    mint: USDC_MINT,
    amount: 1000000,
    entryPrice: 1.0,
    enteredAt: new Date(),
    stopLoss: -30,
    takeProfit1: 100,
    takeProfit2: 200,
    ...overrides,
  };
}
```

**Location:**
- `test/fixtures/` directory with files named after modules
- Import fixtures at top of test files
- Reuse across multiple test suites

## Coverage

**Requirements:** Target 80%+ coverage for critical paths
- Core business logic (safety checks, exit conditions): aim for >90%
- API clients and network code: aim for >80%
- Utilities and helpers: aim for >75%
- Configuration and constants: not required

**View Coverage:**
```bash
npm run test:coverage
# View detailed report at coverage/index.html
```

**Coverage Config (in vitest.config.ts or jest.config.js):**
```typescript
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.test.ts',
        '**/index.ts' // Barrel files
      ],
      lines: 80,
      functions: 80,
      branches: 75,
      statements: 80,
    },
  },
});
```

## Test Types

**Unit Tests:**
- Scope: Single function or class method in isolation
- Mocks: External dependencies (APIs, RPC, file system)
- Location: `src/[module].test.ts`
- Speed: Should run in <10ms each
- Example: Testing `calculatePnlPercentage()` with different inputs

```typescript
describe('calculatePnlPercentage', () => {
  it('should calculate positive PnL correctly', () => {
    const pnl = calculatePnlPercentage(1.0, 1.5);
    expect(pnl).toBeCloseTo(50, 2); // 50%
  });

  it('should handle loss correctly', () => {
    const pnl = calculatePnlPercentage(2.0, 1.0);
    expect(pnl).toBeCloseTo(-50, 2); // -50%
  });
});
```

**Integration Tests:**
- Scope: Multiple modules working together
- Mocks: Only external APIs (not internal services)
- Location: `test/integration/[feature].integration.test.ts`
- Speed: <100ms per test
- Example: Testing full safety check pipeline with real validators

```typescript
describe('Safety Check Pipeline (Integration)', () => {
  let checker: SafetyChecker;
  let tokenValidator: TokenValidator;

  beforeEach(() => {
    tokenValidator = new TokenValidator(mockConnection);
    checker = new SafetyChecker(tokenValidator);
  });

  it('should block honeypot tokens in full pipeline', async () => {
    const result = await checker.runFullPipeline(HONEYPOT_MINT);

    expect(result.score).toBe(0);
    expect(result.flags).toContain('freeze_authority_active');
    expect(result.blocked).toBe(true);
  });
});
```

**E2E Tests:**
- Scope: Full user flow (detection → safety → execution → exit)
- Mocks: None (or only external paid APIs like RugCheck)
- Location: `test/e2e/[flow].e2e.test.ts`
- Speed: Can be slow (1-30 seconds)
- Environment: Mainnet simulation or devnet
- Example: Running a full buy→position tracking→sell cycle

```typescript
describe('Buy-Sell Flow (E2E)', () => {
  it.skip('should complete full trading flow on simulation mode', async () => {
    const bot = new SniperBot({
      mode: 'simulation',
      maxBuyAmount: 0.01, // SOL
      rpcUrl: HELIUS_RPC,
    });

    await bot.start();

    // Wait for a token detection
    const detectedToken = await bot.waitForToken(5000);
    expect(detectedToken).toBeDefined();

    // Run safety checks
    const safety = await bot.evaluateToken(detectedToken.mint);
    expect(safety.score).toBeGreaterThan(50);

    // Simulate buy
    const buyResult = await bot.simulateBuy(detectedToken.mint, 0.01);
    expect(buyResult.success).toBe(true);

    // Simulate exit
    const exitResult = await bot.simulateExit(
      detectedToken.mint,
      buyResult.tokenAmount,
      { reason: 'TAKE_PROFIT_1', pnl: 50 }
    );
    expect(exitResult.success).toBe(true);
  });
});
```

## Common Patterns

**Async Testing:**
```typescript
// Use async/await with proper error handling
it('should fetch Jupiter quote', async () => {
  const quote = await getJupiterQuote('mint1', 'mint2', 1000);
  expect(quote.outAmount).toBeDefined();
});

// Test Promise rejection
it('should handle quote fetch failure', async () => {
  vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'));

  await expect(getJupiterQuote('mint1', 'mint2', 1000))
    .rejects.toThrow('Network error');
});

// Test with timeout
it('should timeout after 5 seconds', async () => {
  vi.useFakeTimers();
  const promise = getJupiterQuote('mint1', 'mint2', 1000, 5000);

  vi.advanceTimersByTime(5000);
  await expect(promise).rejects.toThrow('timeout');

  vi.useRealTimers();
});
```

**Error Testing:**
```typescript
it('should throw SafetyCheckFailedError with correct flags', async () => {
  try {
    await runSafetyChecks(HONEYPOT_MINT);
    fail('Should have thrown');
  } catch (error) {
    expect(error).toBeInstanceOf(SafetyCheckFailedError);
    expect(error.flags).toContain('freeze_authority_active');
    expect(error.reason).toMatch(/safety check failed/i);
  }
});

// Alternative using toThrow matcher
it('should reject invalid mint format', async () => {
  await expect(
    runSafetyChecks('not-a-valid-mint')
  ).rejects.toThrow(ValidationError);
});

// Test error recovery/retry
it('should retry on transient error', async () => {
  const fn = vi.fn()
    .mockRejectedValueOnce(new Error('Temporary error'))
    .mockResolvedValueOnce({ success: true });

  const result = await retryWithBackoff(fn, 3, 10);

  expect(fn).toHaveBeenCalledTimes(2);
  expect(result.success).toBe(true);
});
```

**Testing with Timers:**
```typescript
it('should check positions every 3 seconds', async () => {
  vi.useFakeTimers();

  const checkAllSpy = vi.spyOn(monitor, 'checkAll');
  monitor.start(3000);

  // Fast-forward through time
  vi.advanceTimersByTime(9000); // 3 cycles

  expect(checkAllSpy).toHaveBeenCalledTimes(3);

  vi.useRealTimers();
});
```

---

*Testing analysis: 2026-02-20*
