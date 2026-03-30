import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Connection } from '@solana/web3.js';

// ---------------------------------------------------------------------------
// Mock @solana/web3.js Connection methods
// ---------------------------------------------------------------------------
const { mockGetTokenLargestAccounts, mockGetParsedAccountInfo } = vi.hoisted(() => {
  const mockGetTokenLargestAccounts = vi.fn();
  const mockGetParsedAccountInfo = vi.fn();
  return { mockGetTokenLargestAccounts, mockGetParsedAccountInfo };
});

const mockConnection = {
  getTokenLargestAccounts: mockGetTokenLargestAccounts,
  getParsedAccountInfo: mockGetParsedAccountInfo,
} as unknown as Connection;

import { checkLpLock } from './tier2-lp-lock.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_MINT = 'So11111111111111111111111111111111111111112';
const MOCK_LP_MINT = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

function makeRugCheckData(lpLockedPct: number, risksCount: number) {
  return {
    lpLockedPct,
    risks: Array.from({ length: risksCount }, (_, i) => ({ name: `risk_${i}` })),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('checkLpLock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // RugCheck path
  // -------------------------------------------------------------------------

  it('lpLockedPct >= 90 returns score=100 (fully locked)', async () => {
    const result = await checkLpLock(
      MOCK_MINT, mockConnection, makeRugCheckData(95, 0), 'raydium',
    );

    expect(result.pass).toBe(true);
    expect(result.score).toBe(100);
    expect(result.source).toBe('lp_lock');
  });

  it('lpLockedPct = 0 with non-empty risks returns score=0 (confirmed unlocked)', async () => {
    const result = await checkLpLock(
      MOCK_MINT, mockConnection, makeRugCheckData(0, 3), 'raydium',
    );

    expect(result.pass).toBe(true);
    expect(result.score).toBe(0);
    expect(result.source).toBe('lp_lock');
  });

  it('lpLockedPct = 0 with empty risks returns score=50 (data unavailable, neutral)', async () => {
    const result = await checkLpLock(
      MOCK_MINT, mockConnection, makeRugCheckData(0, 0), 'raydium',
    );

    expect(result.pass).toBe(true);
    expect(result.score).toBe(50);
    expect(result.source).toBe('lp_lock');
  });

  it('lpLockedPct = 50 returns proportional score=50', async () => {
    const result = await checkLpLock(
      MOCK_MINT, mockConnection, makeRugCheckData(50, 2), 'raydium',
    );

    expect(result.pass).toBe(true);
    expect(result.score).toBe(50);
    expect(result.source).toBe('lp_lock');
  });

  // -------------------------------------------------------------------------
  // Pumpportal source — neutral skip
  // -------------------------------------------------------------------------

  it('pumpportal source returns pass=true, score=50 (neutral skip)', async () => {
    const result = await checkLpLock(
      MOCK_MINT, mockConnection, null, 'pumpportal',
    );

    expect(result.pass).toBe(true);
    expect(result.score).toBe(50);
    expect(result.source).toBe('lp_lock');
    expect(result.detail).toContain('pumpportal');
  });

  // -------------------------------------------------------------------------
  // On-chain fallback
  // -------------------------------------------------------------------------

  it('RugCheck unavailable (null) with LP tokens at incinerator returns score=100', async () => {
    // Mock getTokenLargestAccounts for LP mint
    const { PublicKey } = await import('@solana/web3.js');
    mockGetTokenLargestAccounts.mockResolvedValueOnce({
      value: [{ address: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'), amount: '1000000' }],
    });
    // Mock getParsedAccountInfo to return the incinerator as owner
    mockGetParsedAccountInfo.mockResolvedValueOnce({
      value: {
        data: {
          parsed: { info: { owner: '1nc1nerator11111111111111111111111111111111' } },
        },
      },
    });

    const result = await checkLpLock(
      MOCK_MINT, mockConnection, null, 'raydium', undefined, MOCK_LP_MINT,
    );

    expect(result.pass).toBe(true);
    expect(result.score).toBe(100);
    expect(result.source).toBe('lp_lock');
  });

  it('RugCheck unavailable with LP tokens at UNCX locker returns score=100', async () => {
    const { PublicKey } = await import('@solana/web3.js');
    mockGetTokenLargestAccounts.mockResolvedValueOnce({
      value: [{ address: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'), amount: '1000000' }],
    });
    mockGetParsedAccountInfo.mockResolvedValueOnce({
      value: {
        data: {
          parsed: { info: { owner: 'GsSCS3vPWrtJ5Y9aEVVT65fmrex5P5RGHXdZvsdbWgfo' } },
        },
      },
    });

    const result = await checkLpLock(
      MOCK_MINT, mockConnection, null, 'raydium', undefined, MOCK_LP_MINT,
    );

    expect(result.pass).toBe(true);
    expect(result.score).toBe(100);
    expect(result.source).toBe('lp_lock');
  });

  it('RugCheck unavailable with LP tokens at unknown address returns score=0', async () => {
    const { PublicKey } = await import('@solana/web3.js');
    mockGetTokenLargestAccounts.mockResolvedValueOnce({
      value: [{ address: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'), amount: '1000000' }],
    });
    mockGetParsedAccountInfo.mockResolvedValueOnce({
      value: {
        data: {
          parsed: { info: { owner: 'SomeRandomOwner11111111111111111111111111111' } },
        },
      },
    });

    const result = await checkLpLock(
      MOCK_MINT, mockConnection, null, 'raydium', undefined, MOCK_LP_MINT,
    );

    expect(result.pass).toBe(true);
    expect(result.score).toBe(0);
    expect(result.source).toBe('lp_lock');
  });

  it('both RugCheck and on-chain fail returns score=0 (pessimistic)', async () => {
    mockGetTokenLargestAccounts.mockRejectedValueOnce(new Error('RPC error'));

    const result = await checkLpLock(
      MOCK_MINT, mockConnection, null, 'raydium', undefined, MOCK_LP_MINT,
    );

    expect(result.pass).toBe(true);
    expect(result.score).toBe(0);
    expect(result.source).toBe('lp_lock');
  });

  it('RugCheck unavailable with no LP mint returns score=0', async () => {
    const result = await checkLpLock(
      MOCK_MINT, mockConnection, null, 'raydium',
    );

    expect(result.pass).toBe(true);
    expect(result.score).toBe(0);
    expect(result.source).toBe('lp_lock');
    expect(result.detail).toContain('no LP mint');
  });
});
