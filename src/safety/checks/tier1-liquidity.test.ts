import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Connection } from '@solana/web3.js';
import type { CheckResult } from '../../types/index.js';

// ---------------------------------------------------------------------------
// Mock @solana/web3.js before importing the module under test.
// ---------------------------------------------------------------------------
const { mockGetAccountInfo, mockGetTokenAccountBalance } = vi.hoisted(() => {
  const mockGetAccountInfo = vi.fn();
  const mockGetTokenAccountBalance = vi.fn();
  return { mockGetAccountInfo, mockGetTokenAccountBalance };
});

// Connection mock
const mockConnection = {
  getAccountInfo: mockGetAccountInfo,
  getTokenAccountBalance: mockGetTokenAccountBalance,
} as unknown as Connection;

// Import after mocks — the module under test uses Connection methods
import { checkLiquidityDepth } from './tier1-liquidity.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_MINT = 'So11111111111111111111111111111111111111112';
const MOCK_QUOTE_VAULT = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

/**
 * Build a mock bonding curve account data buffer with the correct IDL signature
 * and realSolReserves at offset 0x20.
 */
function makeBondingCurveData(realSolReservesLamports: bigint): Buffer {
  const buf = Buffer.alloc(0x31);
  // Write bonding curve IDL signature at offset 0
  Buffer.from([0x17, 0xb7, 0xf8, 0x37, 0x60, 0xd8, 0xac, 0x60]).copy(buf, 0);
  // Write realSolReserves at offset 0x20
  buf.writeBigUInt64LE(realSolReservesLamports, 0x20);
  return buf;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('checkLiquidityDepth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Pumpportal source — bonding curve path
  // -------------------------------------------------------------------------

  it('pumpportal: bonding curve SOL reserves >= threshold returns pass=true', async () => {
    const solLamports = BigInt(5_000_000_000); // 5 SOL
    mockGetAccountInfo.mockResolvedValueOnce({ data: makeBondingCurveData(solLamports) });

    const result = await checkLiquidityDepth(MOCK_MINT, mockConnection, 2.0, 'pumpportal');

    expect(result.pass).toBe(true);
    expect(result.source).toBe('liquidity_depth');
    expect(result.detail).toContain('bonding_curve_sol=');
  });

  it('pumpportal: bonding curve SOL reserves < threshold returns pass=false', async () => {
    const solLamports = BigInt(500_000_000); // 0.5 SOL
    mockGetAccountInfo.mockResolvedValueOnce({ data: makeBondingCurveData(solLamports) });

    const result = await checkLiquidityDepth(MOCK_MINT, mockConnection, 2.0, 'pumpportal');

    expect(result.pass).toBe(false);
    expect(result.source).toBe('liquidity_depth');
    expect(result.detail).toContain('bonding_curve_sol=');
  });

  it('pumpportal: bonding curve account not found returns pass=false', async () => {
    mockGetAccountInfo.mockResolvedValueOnce(null);

    const result = await checkLiquidityDepth(MOCK_MINT, mockConnection, 2.0, 'pumpportal');

    expect(result.pass).toBe(false);
    expect(result.source).toBe('liquidity_depth');
    expect(result.detail).toContain('error');
  });

  it('pumpportal: invalid bonding curve signature returns pass=false', async () => {
    const badBuf = Buffer.alloc(0x31);
    // Write wrong signature
    Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]).copy(badBuf, 0);
    badBuf.writeBigUInt64LE(BigInt(5_000_000_000), 0x20);
    mockGetAccountInfo.mockResolvedValueOnce({ data: badBuf });

    const result = await checkLiquidityDepth(MOCK_MINT, mockConnection, 2.0, 'pumpportal');

    expect(result.pass).toBe(false);
    expect(result.source).toBe('liquidity_depth');
    expect(result.detail).toContain('invalid');
  });

  // -------------------------------------------------------------------------
  // Raydium source — quoteVault path
  // -------------------------------------------------------------------------

  it('raydium: quoteVault balance >= threshold returns pass=true', async () => {
    mockGetTokenAccountBalance.mockResolvedValueOnce({
      value: { uiAmount: 10.5 },
    });

    const result = await checkLiquidityDepth(MOCK_MINT, mockConnection, 2.0, 'raydium', MOCK_QUOTE_VAULT);

    expect(result.pass).toBe(true);
    expect(result.source).toBe('liquidity_depth');
    expect(result.detail).toContain('pool_sol=');
  });

  it('raydium: quoteVault balance < threshold returns pass=false', async () => {
    mockGetTokenAccountBalance.mockResolvedValueOnce({
      value: { uiAmount: 0.5 },
    });

    const result = await checkLiquidityDepth(MOCK_MINT, mockConnection, 2.0, 'raydium', MOCK_QUOTE_VAULT);

    expect(result.pass).toBe(false);
    expect(result.source).toBe('liquidity_depth');
    expect(result.detail).toContain('pool_sol=');
  });

  it('raydium: no poolQuoteVault returns pass=true (neutral skip)', async () => {
    const result = await checkLiquidityDepth(MOCK_MINT, mockConnection, 2.0, 'raydium');

    expect(result.pass).toBe(true);
    expect(result.source).toBe('liquidity_depth');
    expect(result.detail).toContain('skipped');
  });

  // -------------------------------------------------------------------------
  // Pumpswap source — neutral skip
  // -------------------------------------------------------------------------

  it('pumpswap: returns pass=true with neutral skip', async () => {
    const result = await checkLiquidityDepth(MOCK_MINT, mockConnection, 2.0, 'pumpswap');

    expect(result.pass).toBe(true);
    expect(result.source).toBe('liquidity_depth');
    expect(result.detail).toContain('pumpswap');
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  it('RPC error returns pass=false (pessimistic)', async () => {
    mockGetAccountInfo.mockRejectedValueOnce(new Error('RPC connection failed'));

    const result = await checkLiquidityDepth(MOCK_MINT, mockConnection, 2.0, 'pumpportal');

    expect(result.pass).toBe(false);
    expect(result.source).toBe('liquidity_depth');
    expect(result.detail).toContain('error');
  });
});
