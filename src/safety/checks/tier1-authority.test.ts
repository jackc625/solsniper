import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CheckResult } from '../../types/index.js';

// ---------------------------------------------------------------------------
// Mock @solana/spl-token before importing the module under test.
// vi.mock is hoisted, so the factory runs before any imports.
// ---------------------------------------------------------------------------
const { mockGetMint } = vi.hoisted(() => {
  const mockGetMint = vi.fn();
  return { mockGetMint };
});

vi.mock('@solana/spl-token', () => ({
  getMint: mockGetMint,
}));

// Import after mocks are registered
import { checkAuthorities } from './tier1-authority.js';
import type { Connection } from '@solana/web3.js';
import { PublicKey } from '@solana/web3.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_MINT = 'So11111111111111111111111111111111111111112';
// Valid base58 Solana public key (44 chars)
const MOCK_AUTHORITY = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const mockConnection = {} as Connection;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('checkAuthorities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns pass=true for both when mintAuthority and freezeAuthority are null', async () => {
    mockGetMint.mockResolvedValueOnce({ mintAuthority: null, freezeAuthority: null });

    const [mintAuth, freezeAuth] = await checkAuthorities(MOCK_MINT, mockConnection);

    expect(mintAuth.pass).toBe(true);
    expect(mintAuth.source).toBe('mint_authority');
    expect(mintAuth.detail).toBe('revoked');

    expect(freezeAuth.pass).toBe(true);
    expect(freezeAuth.source).toBe('freeze_authority');
    expect(freezeAuth.detail).toBe('revoked');
  });

  it('returns pass=false for mint authority when mintAuthority is a PublicKey', async () => {
    mockGetMint.mockResolvedValueOnce({
      mintAuthority: MOCK_AUTHORITY,
      freezeAuthority: null,
    });

    const [mintAuth, freezeAuth] = await checkAuthorities(MOCK_MINT, mockConnection);

    expect(mintAuth.pass).toBe(false);
    expect(mintAuth.source).toBe('mint_authority');
    expect(mintAuth.detail).toContain(MOCK_AUTHORITY.toBase58());

    expect(freezeAuth.pass).toBe(true);
    expect(freezeAuth.source).toBe('freeze_authority');
    expect(freezeAuth.detail).toBe('revoked');
  });

  it('returns pass=false for freeze authority when freezeAuthority is a PublicKey', async () => {
    mockGetMint.mockResolvedValueOnce({
      mintAuthority: null,
      freezeAuthority: MOCK_AUTHORITY,
    });

    const [mintAuth, freezeAuth] = await checkAuthorities(MOCK_MINT, mockConnection);

    expect(mintAuth.pass).toBe(true);
    expect(mintAuth.source).toBe('mint_authority');
    expect(mintAuth.detail).toBe('revoked');

    expect(freezeAuth.pass).toBe(false);
    expect(freezeAuth.source).toBe('freeze_authority');
    expect(freezeAuth.detail).toContain(MOCK_AUTHORITY.toBase58());
  });

  it('returns pass=false for both when getMint throws (pessimistic)', async () => {
    // Throw on all retries
    mockGetMint.mockRejectedValue(new Error('Account not found'));

    const [mintAuth, freezeAuth] = await checkAuthorities(MOCK_MINT, mockConnection);

    expect(mintAuth.pass).toBe(false);
    expect(mintAuth.source).toBe('mint_authority');
    expect(mintAuth.detail).toMatch(/error:/i);

    expect(freezeAuth.pass).toBe(false);
    expect(freezeAuth.source).toBe('freeze_authority');
    expect(freezeAuth.detail).toMatch(/error:/i);
  });

  it('retries on account not found before returning pessimistic result', async () => {
    // First 2 calls throw account not found, 3rd also throws (exceeds retry limit)
    mockGetMint
      .mockRejectedValueOnce(new Error('could not find account'))
      .mockRejectedValueOnce(new Error('could not find account'))
      .mockRejectedValueOnce(new Error('could not find account'));

    const [mintAuth, freezeAuth] = await checkAuthorities(MOCK_MINT, mockConnection);

    // Should have called getMint 3 times (1 initial + 2 retries)
    expect(mockGetMint).toHaveBeenCalledTimes(3);
    expect(mintAuth.pass).toBe(false);
    expect(freezeAuth.pass).toBe(false);
  });

  it('succeeds after retry if first attempt fails with account not found', async () => {
    mockGetMint
      .mockRejectedValueOnce(new Error('could not find account'))
      .mockResolvedValueOnce({ mintAuthority: null, freezeAuthority: null });

    const [mintAuth, freezeAuth] = await checkAuthorities(MOCK_MINT, mockConnection);

    expect(mockGetMint).toHaveBeenCalledTimes(2);
    expect(mintAuth.pass).toBe(true);
    expect(freezeAuth.pass).toBe(true);
  });
});
