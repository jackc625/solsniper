import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Connection } from '@solana/web3.js';
import { PublicKey } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';

import { checkHolderConcentration } from './tier2-holder.js';

const MOCK_MINT = 'So11111111111111111111111111111111111111112';

// Pre-compute bonding curve PDA for MOCK_MINT for test assertions
const PUMP_FUN_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const [BONDING_CURVE_PDA] = PublicKey.findProgramAddressSync(
  [Buffer.from('bonding-curve'), new PublicKey(MOCK_MINT).toBuffer()],
  PUMP_FUN_PROGRAM_ID,
);
const BONDING_CURVE_ADDR = BONDING_CURVE_PDA.toBase58();
const SYSTEM_PROGRAM = '11111111111111111111111111111111';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const INCINERATOR = '1nc1nerator11111111111111111111111111111111';
// Regular user wallet addresses (valid base58)
const USER_WALLET_1 = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const USER_WALLET_2 = 'GThUX1Atko4tqhN2NaiTazFAcaPNtRDiMSCLDZPeHmKS';
const USER_WALLET_3 = 'HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH';
const USER_WALLET_4 = 'Fkc4FN7PPhyGsAcHPW3dBBsgxEmdSgZqdnBFxoMkjmQ';

const DEFAULT_CONFIG = {
  top1SoftBlockThreshold: 0.25,
  top10SoftBlockThreshold: 0.50,
  minUserHolders: 2,
};

/**
 * Creates a mock Connection with configurable responses.
 */
function makeMockConnection(opts: {
  largestAccounts?: Array<{ address: string; amount: string }>;
  totalSupply?: string;
  // Map from account address -> owner address
  accountOwners?: Record<string, string>;
  throwOnLargestAccounts?: Error;
}): Connection {
  const mockGetTokenLargestAccounts = vi.fn();
  const mockGetTokenSupply = vi.fn();
  const mockGetParsedAccountInfo = vi.fn();

  if (opts.throwOnLargestAccounts) {
    mockGetTokenLargestAccounts.mockRejectedValueOnce(opts.throwOnLargestAccounts);
  } else {
    const largestAccounts = opts.largestAccounts ?? [];
    mockGetTokenLargestAccounts.mockResolvedValueOnce({
      value: largestAccounts.map((a) => ({
        address: new PublicKey(a.address),
        amount: a.amount,
      })),
    });
  }

  mockGetTokenSupply.mockResolvedValueOnce({
    value: { amount: opts.totalSupply ?? '1000000000', decimals: 9 },
  });

  if (opts.accountOwners) {
    mockGetParsedAccountInfo.mockImplementation(
      (pubkey: PublicKey) => {
        const owner = opts.accountOwners![pubkey.toBase58()];
        if (owner) {
          return Promise.resolve({
            value: {
              data: { parsed: { info: { owner }, type: 'account' }, program: 'spl-token' },
            },
          });
        }
        return Promise.resolve({ value: null });
      },
    );
  }

  return {
    getTokenLargestAccounts: mockGetTokenLargestAccounts,
    getTokenSupply: mockGetTokenSupply,
    getParsedAccountInfo: mockGetParsedAccountInfo,
  } as unknown as Connection;
}

describe('checkHolderConcentration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns high score when no single holder dominates', async () => {
    // Well-distributed holders: top-1 is 10%, top-10 combined is 35%
    // Both under their respective thresholds (25% and 50%)
    const totalSupply = '1000000000';
    const connection = makeMockConnection({
      largestAccounts: [
        { address: USER_WALLET_1, amount: '100000000' }, // 10% — largest holder
        { address: USER_WALLET_2, amount: '80000000' },  // 8%
        { address: USER_WALLET_3, amount: '70000000' },  // 7%
        { address: USER_WALLET_4, amount: '100000000' }, // 10% (second wallet, different address)
      ],
      totalSupply,
      accountOwners: {
        [USER_WALLET_1]: USER_WALLET_1,
        [USER_WALLET_2]: USER_WALLET_2,
        [USER_WALLET_3]: USER_WALLET_3,
        [USER_WALLET_4]: USER_WALLET_4,
      },
    });

    const result = await checkHolderConcentration(MOCK_MINT, connection, DEFAULT_CONFIG);

    // top1 = 10% < 25% threshold, top10 = 35% < 50% threshold
    expect(result.pass).toBe(true);
    expect(result.score).toBeGreaterThan(0);
    expect(result.source).toBe('holder_concentration');
  });

  it('returns pass=false when top-1 holder exceeds 25% threshold (soft block)', async () => {
    const totalSupply = '1000000000';
    const connection = makeMockConnection({
      largestAccounts: [
        { address: USER_WALLET_1, amount: '300000000' }, // 30% — exceeds 25% threshold
        { address: USER_WALLET_2, amount: '100000000' },
        { address: USER_WALLET_3, amount: '100000000' },
      ],
      totalSupply,
      accountOwners: {
        [USER_WALLET_1]: USER_WALLET_1,
        [USER_WALLET_2]: USER_WALLET_2,
        [USER_WALLET_3]: USER_WALLET_3,
      },
    });

    const result = await checkHolderConcentration(MOCK_MINT, connection, DEFAULT_CONFIG);

    expect(result.pass).toBe(false);
    expect(result.source).toBe('holder_concentration');
    expect(result.detail).toContain('top1');
  });

  it('returns pass=false when top-10 holders exceed 50% threshold (soft block)', async () => {
    const totalSupply = '1000000000';
    // Top holder 20% (under top1 threshold), but combined top 10 > 50%
    // We'll use 2 users with 30% each = 60% combined (exceeds 50% top10 threshold)
    const connection = makeMockConnection({
      largestAccounts: [
        { address: USER_WALLET_1, amount: '300000000' }, // 30%
        { address: USER_WALLET_2, amount: '300000000' }, // 30% -> combined 60%
        { address: USER_WALLET_3, amount: '50000000' },
        { address: USER_WALLET_4, amount: '50000000' },
      ],
      totalSupply,
      accountOwners: {
        [USER_WALLET_1]: USER_WALLET_1,
        [USER_WALLET_2]: USER_WALLET_2,
        [USER_WALLET_3]: USER_WALLET_3,
        [USER_WALLET_4]: USER_WALLET_4,
      },
    });

    // Set top1 threshold high enough so top1 doesn't trigger, but top10 does
    const result = await checkHolderConcentration(MOCK_MINT, connection, {
      top1SoftBlockThreshold: 0.35, // 35% threshold — top1=30% passes
      top10SoftBlockThreshold: 0.50, // top10=60% fails
      minUserHolders: 2,
    });

    expect(result.pass).toBe(false);
    expect(result.source).toBe('holder_concentration');
    expect(result.detail).toContain('top10');
  });

  it('excludes system accounts from concentration calculation', async () => {
    const totalSupply = '1000000000';
    // System program holds 80%, user holds 20%
    // After exclusion: user holds 100% of non-system supply
    // But concentration is calculated against total supply, so: 20%
    const connection = makeMockConnection({
      largestAccounts: [
        { address: SYSTEM_PROGRAM, amount: '800000000' }, // 80% — system, excluded
        { address: USER_WALLET_1, amount: '200000000' }, // 20% — user
      ],
      totalSupply,
      accountOwners: {
        [SYSTEM_PROGRAM]: SYSTEM_PROGRAM, // system program owns itself
        [USER_WALLET_1]: USER_WALLET_1,
      },
    });

    const result = await checkHolderConcentration(MOCK_MINT, connection, DEFAULT_CONFIG);

    // System account excluded — user1 holds 20% of total which is under 25% threshold
    expect(result.pass).toBe(true);
    expect(result.source).toBe('holder_concentration');
  });

  it('returns pass=false with score=0 on RPC error (pessimistic)', async () => {
    const connection = makeMockConnection({
      throwOnLargestAccounts: new Error('RPC connection failed'),
    });

    const result = await checkHolderConcentration(MOCK_MINT, connection, DEFAULT_CONFIG);

    expect(result.pass).toBe(false);
    expect(result.score).toBe(0);
    expect(result.source).toBe('holder_concentration');
    expect(result.detail).toMatch(/error:/i);
  });

  it('returns pass=false with score=0 for zero total supply', async () => {
    const connection = makeMockConnection({
      largestAccounts: [{ address: USER_WALLET_1, amount: '0' }],
      totalSupply: '0',
      accountOwners: { [USER_WALLET_1]: USER_WALLET_1 },
    });

    const result = await checkHolderConcentration(MOCK_MINT, connection, DEFAULT_CONFIG);

    expect(result.pass).toBe(false);
    expect(result.score).toBe(0);
    expect(result.source).toBe('holder_concentration');
    expect(result.detail).toContain('zero total supply');
  });

  it('also excludes token program and incinerator as system accounts', async () => {
    const totalSupply = '1000000000';
    const connection = makeMockConnection({
      largestAccounts: [
        { address: TOKEN_PROGRAM, amount: '500000000' }, // excluded
        { address: INCINERATOR, amount: '300000000' }, // excluded
        { address: USER_WALLET_1, amount: '200000000' }, // 20% — passes
      ],
      totalSupply,
      accountOwners: {
        [TOKEN_PROGRAM]: TOKEN_PROGRAM,
        [INCINERATOR]: INCINERATOR,
        [USER_WALLET_1]: USER_WALLET_1,
      },
    });

    const result = await checkHolderConcentration(MOCK_MINT, connection, DEFAULT_CONFIG);

    // Only USER_WALLET_1 with 20% of total supply should be counted
    expect(result.pass).toBe(true);
  });

  it('excludes bonding curve PDA from concentration (standard path)', async () => {
    // Bonding curve PDA holds 90%, one user wallet holds 10%
    // After excluding bonding curve, only user wallet remains at 10% of total supply — passes
    const totalSupply = '1000000000';
    const connection = makeMockConnection({
      largestAccounts: [
        { address: BONDING_CURVE_ADDR, amount: '900000000' }, // 90% — bonding curve, excluded
        { address: USER_WALLET_1, amount: '100000000' },       // 10% — user, not excluded
      ],
      totalSupply,
      accountOwners: {
        [BONDING_CURVE_ADDR]: BONDING_CURVE_ADDR, // bonding curve PDA "owns" itself
        [USER_WALLET_1]: USER_WALLET_1,
      },
    });

    const result = await checkHolderConcentration(MOCK_MINT, connection, DEFAULT_CONFIG);

    // After PDA exclusion: user1 holds 10% of total supply — under 25% threshold
    expect(result.pass).toBe(true);
    expect(result.source).toBe('holder_concentration');
  });

  it('excludes bonding curve PDA from concentration (Token-2022 path)', async () => {
    // Bonding curve PDA holds 90%, one user wallet holds 10%
    const mintAccountData = Buffer.alloc(82);
    mintAccountData.writeBigUInt64LE(BigInt('1000000000'), 36);
    mintAccountData.writeUInt8(9, 44);
    mintAccountData.writeUInt8(1, 45);

    const mockGetParsedProgramAccounts = vi.fn().mockResolvedValue([
      {
        pubkey: new PublicKey(BONDING_CURVE_ADDR),
        account: {
          data: {
            parsed: {
              info: {
                owner: BONDING_CURVE_ADDR,
                tokenAmount: { amount: '900000000' }, // 90% — bonding curve, excluded
              },
            },
          },
        },
      },
      {
        pubkey: new PublicKey(USER_WALLET_1),
        account: {
          data: {
            parsed: {
              info: {
                owner: USER_WALLET_1,
                tokenAmount: { amount: '100000000' }, // 10% — user
              },
            },
          },
        },
      },
    ]);

    const mockGetAccountInfo = vi.fn().mockResolvedValue({
      owner: TOKEN_2022_PROGRAM_ID,
      data: mintAccountData,
    });

    const connection = {
      getParsedProgramAccounts: mockGetParsedProgramAccounts,
      getAccountInfo: mockGetAccountInfo,
    } as unknown as Connection;

    const result = await checkHolderConcentration(
      MOCK_MINT, connection, DEFAULT_CONFIG, TOKEN_2022_PROGRAM_ID,
    );

    // After PDA exclusion: user1 holds 10% of total supply — under 25% threshold
    expect(result.pass).toBe(true);
    expect(result.source).toBe('holder_concentration');
  });

  it('zero user holders with source=pumpportal and minUserHolders=2 returns pass=false, score=0', async () => {
    // All holders are bonding curve PDA (excluded) — no user holders remain.
    // With minUserHolders=2 (default), tokens below threshold are rejected.
    const totalSupply = '1000000000';
    const connection = makeMockConnection({
      largestAccounts: [
        { address: BONDING_CURVE_ADDR, amount: '1000000000' }, // 100% — bonding curve, excluded
      ],
      totalSupply,
      accountOwners: {
        [BONDING_CURVE_ADDR]: BONDING_CURVE_ADDR,
      },
    });

    const result = await checkHolderConcentration(MOCK_MINT, connection, DEFAULT_CONFIG, undefined, 'pumpportal');

    expect(result.pass).toBe(false);
    expect(result.score).toBe(0);
    expect(result.source).toBe('holder_concentration');
    expect(result.detail).toContain('below minimum holders');
  });

  it('pumpportal with 1 user holder and minUserHolders=2 returns pass=false', async () => {
    // One real user holder, but threshold requires 2 — should reject
    const totalSupply = '1000000000';
    const connection = makeMockConnection({
      largestAccounts: [
        { address: USER_WALLET_1, amount: '100000000' }, // 10% — one user holder
      ],
      totalSupply,
      accountOwners: {
        [USER_WALLET_1]: USER_WALLET_1,
      },
    });

    const result = await checkHolderConcentration(MOCK_MINT, connection, DEFAULT_CONFIG, undefined, 'pumpportal');

    expect(result.pass).toBe(false);
    expect(result.score).toBe(0);
    expect(result.source).toBe('holder_concentration');
    expect(result.detail).toContain('below minimum holders: 1 < 2 required');
  });

  it('pumpportal with 2 user holders and minUserHolders=2 proceeds to concentration check', async () => {
    // Exactly at threshold — proceeds to normal concentration check
    // Two holders at 10% each: top1=10% < 25%, top10=20% < 50% — passes
    const totalSupply = '1000000000';
    const connection = makeMockConnection({
      largestAccounts: [
        { address: USER_WALLET_1, amount: '100000000' }, // 10%
        { address: USER_WALLET_2, amount: '100000000' }, // 10%
      ],
      totalSupply,
      accountOwners: {
        [USER_WALLET_1]: USER_WALLET_1,
        [USER_WALLET_2]: USER_WALLET_2,
      },
    });

    const result = await checkHolderConcentration(MOCK_MINT, connection, DEFAULT_CONFIG, undefined, 'pumpportal');

    expect(result.pass).toBe(true);
    expect(result.source).toBe('holder_concentration');
  });

  it('pumpportal with 0 user holders and minUserHolders=0 returns pass=true, score=50', async () => {
    // When operator sets minUserHolders=0, original pass-through behavior is preserved
    const totalSupply = '1000000000';
    const connection = makeMockConnection({
      largestAccounts: [
        { address: BONDING_CURVE_ADDR, amount: '1000000000' }, // 100% — bonding curve, excluded
      ],
      totalSupply,
      accountOwners: {
        [BONDING_CURVE_ADDR]: BONDING_CURVE_ADDR,
      },
    });

    const configWithZeroThreshold = { ...DEFAULT_CONFIG, minUserHolders: 0 };
    const result = await checkHolderConcentration(MOCK_MINT, connection, configWithZeroThreshold, undefined, 'pumpportal');

    expect(result.pass).toBe(true);
    expect(result.score).toBe(50);
    expect(result.source).toBe('holder_concentration');
    expect(result.detail).toContain('insufficient data');
  });

  it('zero user holders with source=raydium still returns pass=false', async () => {
    // Same setup — only bonding curve holder — but source is raydium, not pumpportal
    const totalSupply = '1000000000';
    const connection = makeMockConnection({
      largestAccounts: [
        { address: BONDING_CURVE_ADDR, amount: '1000000000' }, // 100% — bonding curve, excluded
      ],
      totalSupply,
      accountOwners: {
        [BONDING_CURVE_ADDR]: BONDING_CURVE_ADDR,
      },
    });

    const result = await checkHolderConcentration(MOCK_MINT, connection, DEFAULT_CONFIG, undefined, 'raydium');

    expect(result.pass).toBe(false);
    expect(result.score).toBe(0);
    expect(result.source).toBe('holder_concentration');
  });

  it('uses getParsedProgramAccounts fallback for Token-2022 mints', async () => {
    // Simulate Token-2022 mint: supply = 1B, one user holds 10%
    const mintPubkey = new PublicKey(MOCK_MINT);

    // Mock mint account data for unpackMint — 82-byte SPL mint layout
    // supply at offset 36 (8 bytes LE), decimals at offset 44
    const mintAccountData = Buffer.alloc(82);
    // supply = 1_000_000_000 as u64 LE at offset 36
    mintAccountData.writeBigUInt64LE(BigInt('1000000000'), 36);
    // decimals = 9 at offset 44
    mintAccountData.writeUInt8(9, 44);
    // isInitialized = 1 at offset 45
    mintAccountData.writeUInt8(1, 45);

    const mockGetParsedProgramAccounts = vi.fn().mockResolvedValue([
      {
        pubkey: new PublicKey(USER_WALLET_1),
        account: {
          data: {
            parsed: {
              info: {
                owner: USER_WALLET_1,
                tokenAmount: { amount: '100000000' }, // 10%
              },
            },
          },
        },
      },
      {
        pubkey: new PublicKey(USER_WALLET_2),
        account: {
          data: {
            parsed: {
              info: {
                owner: USER_WALLET_2,
                tokenAmount: { amount: '50000000' }, // 5%
              },
            },
          },
        },
      },
    ]);

    const mockGetAccountInfo = vi.fn().mockResolvedValue({
      owner: TOKEN_2022_PROGRAM_ID,
      data: mintAccountData,
    });

    const connection = {
      getParsedProgramAccounts: mockGetParsedProgramAccounts,
      getAccountInfo: mockGetAccountInfo,
    } as unknown as Connection;

    const result = await checkHolderConcentration(
      MOCK_MINT, connection, DEFAULT_CONFIG, TOKEN_2022_PROGRAM_ID,
    );

    // top1=10% < 25%, top10=15% < 50% — should pass
    expect(result.pass).toBe(true);
    expect(result.score).toBeGreaterThan(0);
    expect(result.source).toBe('holder_concentration');
    // Verify it used getParsedProgramAccounts, not getTokenLargestAccounts
    expect(mockGetParsedProgramAccounts).toHaveBeenCalledWith(
      TOKEN_2022_PROGRAM_ID,
      { filters: [{ memcmp: { offset: 0, bytes: MOCK_MINT } }] },
    );
  });
});
