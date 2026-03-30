import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock env.js first — logger.ts imports env for LOG_LEVEL/NODE_ENV
// ---------------------------------------------------------------------------
vi.mock('../config/env.js', () => ({
  env: {
    LOG_LEVEL: 'error',
    NODE_ENV: 'development',
  },
}));

// ---------------------------------------------------------------------------
// Mock config/trading.js — avoid loading real config.jsonc during tests
// ---------------------------------------------------------------------------
vi.mock('../config/trading.js', () => ({
  getRuntimeConfig: vi.fn(),
  tradingConfig: {},
}));

import { BalanceGuard } from './balance-guard.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeMockConnection(balanceLamports: number) {
  return {
    getBalance: vi.fn().mockResolvedValue(balanceLamports),
  } as unknown as import('@solana/web3.js').Connection;
}

function makeMockWallet() {
  // Use a valid base58 Solana pubkey
  return {} as unknown as import('@solana/web3.js').PublicKey;
}

describe('BalanceGuard', () => {
  const wallet = makeMockWallet();

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns sufficient=true when balance >= buyAmountSol + minBufferSol', async () => {
    // 0.1 SOL = 100_000_000 lamports; threshold = 0.05 + 0.01 = 0.06
    const connection = makeMockConnection(100_000_000);
    const guard = new BalanceGuard(5000);

    const result = await guard.check(connection, wallet, 0.05, 0.01);

    expect(result.sufficient).toBe(true);
    expect(result.balanceSol).toBe(0.1);
    expect(result.thresholdSol).toBeCloseTo(0.06, 10);
  });

  it('returns sufficient=false when balance < buyAmountSol + minBufferSol', async () => {
    // 0.04 SOL = 40_000_000 lamports; threshold = 0.05 + 0.01 = 0.06
    const connection = makeMockConnection(40_000_000);
    const guard = new BalanceGuard(5000);

    const result = await guard.check(connection, wallet, 0.05, 0.01);

    expect(result.sufficient).toBe(false);
    expect(result.balanceSol).toBe(0.04);
    expect(result.thresholdSol).toBeCloseTo(0.06, 10);
  });

  it('caches getBalance within TTL (does not call again)', async () => {
    const connection = makeMockConnection(100_000_000);
    const guard = new BalanceGuard(5000);

    // First call — should call getBalance
    await guard.check(connection, wallet, 0.05, 0.01);
    expect(connection.getBalance).toHaveBeenCalledTimes(1);

    // Second call within TTL — should NOT call getBalance
    await guard.check(connection, wallet, 0.05, 0.01);
    expect(connection.getBalance).toHaveBeenCalledTimes(1);
  });

  it('refetches after cache TTL expires', async () => {
    const connection = makeMockConnection(100_000_000);
    const guard = new BalanceGuard(5000);

    // First call
    await guard.check(connection, wallet, 0.05, 0.01);
    expect(connection.getBalance).toHaveBeenCalledTimes(1);

    // Advance past TTL
    vi.advanceTimersByTime(5001);

    // Second call — should fetch again
    await guard.check(connection, wallet, 0.05, 0.01);
    expect(connection.getBalance).toHaveBeenCalledTimes(2);
  });

  it('invalidateCache forces fresh getBalance on next check', async () => {
    const connection = makeMockConnection(100_000_000);
    const guard = new BalanceGuard(5000);

    // First call
    await guard.check(connection, wallet, 0.05, 0.01);
    expect(connection.getBalance).toHaveBeenCalledTimes(1);

    // Invalidate
    guard.invalidateCache();

    // Next call should fetch again even within TTL
    await guard.check(connection, wallet, 0.05, 0.01);
    expect(connection.getBalance).toHaveBeenCalledTimes(2);
  });
});
