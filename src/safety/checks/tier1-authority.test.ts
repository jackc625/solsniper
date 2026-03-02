import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CheckResult } from '../../types/index.js';

// ---------------------------------------------------------------------------
// Mock @solana/spl-token before importing the module under test.
// vi.mock is hoisted, so the factory runs before any imports.
// ---------------------------------------------------------------------------
const { mockGetAccountInfo, mockUnpackMint, TOKEN_PROGRAM_ID_MOCK, TOKEN_2022_PROGRAM_ID_MOCK } = vi.hoisted(() => {
  // Real-looking pubkey strings for token programs
  const TOKEN_PROGRAM_ID_MOCK = {
    toBase58: () => 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    equals: (other: { toBase58: () => string }) => other.toBase58() === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  };
  const TOKEN_2022_PROGRAM_ID_MOCK = {
    toBase58: () => 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
    equals: (other: { toBase58: () => string }) => other.toBase58() === 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  };
  const mockGetAccountInfo = vi.fn();
  const mockUnpackMint = vi.fn();
  return { mockGetAccountInfo, mockUnpackMint, TOKEN_PROGRAM_ID_MOCK, TOKEN_2022_PROGRAM_ID_MOCK };
});

vi.mock('@solana/spl-token', () => ({
  unpackMint: mockUnpackMint,
  TOKEN_PROGRAM_ID: TOKEN_PROGRAM_ID_MOCK,
  TOKEN_2022_PROGRAM_ID: TOKEN_2022_PROGRAM_ID_MOCK,
  TokenAccountNotFoundError: class TokenAccountNotFoundError extends Error {
    constructor() { super(''); this.name = 'TokenAccountNotFoundError'; }
  },
  TokenInvalidAccountOwnerError: class TokenInvalidAccountOwnerError extends Error {
    constructor() { super(''); this.name = 'TokenInvalidAccountOwnerError'; }
  },
}));

// Import after mocks are registered
import { checkAuthorities } from './tier1-authority.js';
import type { Connection } from '@solana/web3.js';
import { PublicKey } from '@solana/web3.js';
import { TokenAccountNotFoundError, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_MINT = 'So11111111111111111111111111111111111111112';
const MOCK_AUTHORITY = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

// Connection mock — we mock getAccountInfo per test
const mockConnection = {
  getAccountInfo: mockGetAccountInfo,
} as unknown as Connection;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('checkAuthorities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Token-2022 (Pattern A)
  // -------------------------------------------------------------------------

  it('Token-2022 mint: returns pass=true for null authorities, programId=TOKEN_2022_PROGRAM_ID', async () => {
    // info.owner = TOKEN_2022_PROGRAM_ID → unpackMint called with TOKEN_2022_PROGRAM_ID
    const accountInfo = { owner: TOKEN_2022_PROGRAM_ID };
    mockGetAccountInfo.mockResolvedValueOnce(accountInfo);
    mockUnpackMint.mockReturnValueOnce({ mintAuthority: null, freezeAuthority: null });

    const [mintAuth, freezeAuth, programId] = await checkAuthorities(MOCK_MINT, mockConnection);

    expect(mintAuth.pass).toBe(true);
    expect(mintAuth.source).toBe('mint_authority');
    expect(mintAuth.detail).toBe('revoked');

    expect(freezeAuth.pass).toBe(true);
    expect(freezeAuth.source).toBe('freeze_authority');
    expect(freezeAuth.detail).toBe('revoked');

    expect(programId.toBase58()).toBe('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
    // unpackMint must be called with TOKEN_2022_PROGRAM_ID
    expect(mockUnpackMint).toHaveBeenCalledWith(
      expect.anything(),
      accountInfo,
      TOKEN_2022_PROGRAM_ID,
    );
  });

  // -------------------------------------------------------------------------
  // Legacy SPL (Pattern A)
  // -------------------------------------------------------------------------

  it('Legacy SPL mint: returns pass=true for null authorities, programId=TOKEN_PROGRAM_ID', async () => {
    const accountInfo = { owner: TOKEN_PROGRAM_ID };
    mockGetAccountInfo.mockResolvedValueOnce(accountInfo);
    mockUnpackMint.mockReturnValueOnce({ mintAuthority: null, freezeAuthority: null });

    const [mintAuth, freezeAuth, programId] = await checkAuthorities(MOCK_MINT, mockConnection);

    expect(mintAuth.pass).toBe(true);
    expect(freezeAuth.pass).toBe(true);
    expect(programId.toBase58()).toBe('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
    expect(mockUnpackMint).toHaveBeenCalledWith(
      expect.anything(),
      accountInfo,
      TOKEN_PROGRAM_ID,
    );
  });

  // -------------------------------------------------------------------------
  // Authority checks
  // -------------------------------------------------------------------------

  it('returns pass=false for mint authority when mintAuthority is a PublicKey', async () => {
    const accountInfo = { owner: TOKEN_PROGRAM_ID };
    mockGetAccountInfo.mockResolvedValueOnce(accountInfo);
    mockUnpackMint.mockReturnValueOnce({ mintAuthority: MOCK_AUTHORITY, freezeAuthority: null });

    const [mintAuth, freezeAuth] = await checkAuthorities(MOCK_MINT, mockConnection);

    expect(mintAuth.pass).toBe(false);
    expect(mintAuth.source).toBe('mint_authority');
    expect(mintAuth.detail).toContain(MOCK_AUTHORITY.toBase58());

    expect(freezeAuth.pass).toBe(true);
    expect(freezeAuth.source).toBe('freeze_authority');
    expect(freezeAuth.detail).toBe('revoked');
  });

  it('returns pass=false for freeze authority when freezeAuthority is a PublicKey', async () => {
    const accountInfo = { owner: TOKEN_PROGRAM_ID };
    mockGetAccountInfo.mockResolvedValueOnce(accountInfo);
    mockUnpackMint.mockReturnValueOnce({ mintAuthority: null, freezeAuthority: MOCK_AUTHORITY });

    const [mintAuth, freezeAuth] = await checkAuthorities(MOCK_MINT, mockConnection);

    expect(mintAuth.pass).toBe(true);
    expect(freezeAuth.pass).toBe(false);
    expect(freezeAuth.detail).toContain(MOCK_AUTHORITY.toBase58());
  });

  // -------------------------------------------------------------------------
  // Account not found (instanceof TokenAccountNotFoundError)
  // -------------------------------------------------------------------------

  it('retries on account not found (info=null) via instanceof TokenAccountNotFoundError check', async () => {
    // All retries fail — account not found via null info
    mockGetAccountInfo.mockResolvedValue(null);

    const [mintAuth, freezeAuth] = await checkAuthorities(MOCK_MINT, mockConnection);

    // Should have called getAccountInfo 3 times (1 initial + 2 retries)
    expect(mockGetAccountInfo).toHaveBeenCalledTimes(3);
    expect(mintAuth.pass).toBe(false);
    expect(freezeAuth.pass).toBe(false);
  });

  it('succeeds after retry if first getAccountInfo returns null, second returns valid info', async () => {
    const accountInfo = { owner: TOKEN_PROGRAM_ID };
    mockGetAccountInfo
      .mockResolvedValueOnce(null)      // First attempt: account not found
      .mockResolvedValueOnce(accountInfo); // Retry: success
    mockUnpackMint.mockReturnValueOnce({ mintAuthority: null, freezeAuthority: null });

    const [mintAuth, freezeAuth, programId] = await checkAuthorities(MOCK_MINT, mockConnection);

    expect(mockGetAccountInfo).toHaveBeenCalledTimes(2);
    expect(mintAuth.pass).toBe(true);
    expect(freezeAuth.pass).toBe(true);
    expect(programId.toBase58()).toBe('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
  });

  it('does NOT retry when getAccountInfo throws a non-account-not-found error', async () => {
    // Non-retryable error (e.g., invalid public key, bad RPC)
    mockGetAccountInfo.mockRejectedValueOnce(new Error('RPC connection failed'));

    const [mintAuth, freezeAuth] = await checkAuthorities(MOCK_MINT, mockConnection);

    // Should only have called getAccountInfo once — no retry on non-ANFE errors
    expect(mockGetAccountInfo).toHaveBeenCalledTimes(1);
    expect(mintAuth.pass).toBe(false);
    expect(freezeAuth.pass).toBe(false);
  });

  it('returns pessimistic result (both pass=false, default programId) when all retries fail', async () => {
    mockGetAccountInfo.mockResolvedValue(null);

    const [mintAuth, freezeAuth, programId] = await checkAuthorities(MOCK_MINT, mockConnection);

    expect(mintAuth.pass).toBe(false);
    expect(freezeAuth.pass).toBe(false);
    expect(mintAuth.detail).toMatch(/error:/i);
    expect(freezeAuth.detail).toMatch(/error:/i);
    // Default conservative programId returned on error
    expect(programId).toBeDefined();
  });
});
