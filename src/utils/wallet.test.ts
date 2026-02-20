import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

// Generate a known test keypair
// These must be defined at module scope (before vi.mock is hoisted)
const TEST_KEYPAIR = Keypair.generate();
const TEST_PRIVATE_KEY_B58 = bs58.encode(TEST_KEYPAIR.secretKey);
const TEST_PUBLIC_KEY_B58 = TEST_KEYPAIR.publicKey.toBase58();

// vi.mock is hoisted — the factory runs with the top-level TEST_PRIVATE_KEY_B58
vi.mock('../config/env.js', () => ({
  env: {
    SOLSNIPER_PRIVATE_KEY: TEST_PRIVATE_KEY_B58,
    NODE_ENV: 'development',
    LOG_LEVEL: 'debug',
  },
}));

// Mock logger to avoid needing the full env chain
vi.mock('../core/logger.js', () => ({
  createModuleLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('wallet (valid key)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('loads keypair from valid base58 private key', async () => {
    const { getWallet } = await import('./wallet.js');
    const keypair = getWallet();
    expect(keypair.publicKey.toBase58()).toBe(TEST_PUBLIC_KEY_B58);
  });

  it('getWalletPublicKey returns a valid base58 public key string', async () => {
    const { getWalletPublicKey } = await import('./wallet.js');
    const publicKey = getWalletPublicKey();
    // Solana public keys in base58 are 32-44 characters
    expect(publicKey).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  });

  it('caches keypair after first load — returns same reference', async () => {
    const { getWallet } = await import('./wallet.js');
    const first = getWallet();
    const second = getWallet();
    expect(first).toBe(second);
  });
});

describe('wallet (invalid key)', () => {
  beforeEach(() => {
    vi.resetModules();
    // Override the env mock with an invalid key
    vi.doMock('../config/env.js', () => ({
      env: {
        SOLSNIPER_PRIVATE_KEY: 'this-is-not-a-valid-key!!!',
        NODE_ENV: 'development',
        LOG_LEVEL: 'debug',
      },
    }));
    vi.doMock('../core/logger.js', () => ({
      createModuleLogger: () => ({
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      }),
    }));
  });

  it('throws on invalid private key format without exposing key value', async () => {
    const { getWallet } = await import('./wallet.js');

    let caughtError: Error | null = null;
    try {
      getWallet();
    } catch (err) {
      caughtError = err as Error;
    }

    expect(caughtError).not.toBeNull();
    expect(caughtError?.message).toContain('invalid private key format');
    // Verify the actual invalid key is NOT in the error message
    expect(caughtError?.message).not.toContain('this-is-not-a-valid-key');
  });
});
