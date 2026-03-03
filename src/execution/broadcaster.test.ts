import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type VersionedTransaction, type Connection, type Keypair } from '@solana/web3.js';
import { broadcastAndConfirm, broadcastWithRetry, BroadcastError } from './broadcaster.js';

// Mock trading config so we can control dryRun flag
vi.mock('../config/trading.js', () => ({
  getRuntimeConfig: vi.fn().mockReturnValue({ dryRun: false }),
}));

import { getRuntimeConfig } from '../config/trading.js';

// Minimal VersionedTransaction stub — sign() and serialize() are mocked.
function makeMockTx(): VersionedTransaction {
  return {
    message: { recentBlockhash: '' },
    sign: vi.fn(),
    serialize: vi.fn().mockReturnValue(new Uint8Array([1, 2, 3])),
  } as unknown as VersionedTransaction;
}

// Wallet stub — tx.sign() is mocked so wallet internals are not called.
const mockWallet = { publicKey: {} } as unknown as Keypair;

// Helper to build a mock Connection with configurable behavior.
function makeMockConnection(options: {
  sendResult?: string | Error;
  confirmResult?: { value: { err: unknown } } | Error;
} = {}): Connection {
  const sendResult = options.sendResult ?? 'test-sig-abc';
  const confirmResult = options.confirmResult ?? { value: { err: null } };

  return {
    getLatestBlockhash: vi.fn().mockResolvedValue({
      blockhash: 'test-blockhash',
      lastValidBlockHeight: 1000,
    }),
    sendRawTransaction: vi.fn().mockImplementation(() =>
      sendResult instanceof Error ? Promise.reject(sendResult) : Promise.resolve(sendResult)
    ),
    confirmTransaction: vi.fn().mockImplementation(() =>
      confirmResult instanceof Error
        ? Promise.reject(confirmResult)
        : Promise.resolve(confirmResult)
    ),
    getSignatureStatuses: vi.fn().mockResolvedValue({ value: [] }),
  } as unknown as Connection;
}

describe('broadcastAndConfirm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: dryRun=false for all tests unless explicitly overridden
    vi.mocked(getRuntimeConfig).mockReturnValue({ dryRun: false } as ReturnType<typeof getRuntimeConfig>);
  });

  it('happy path — two connections, both succeed — returns BroadcastResult', async () => {
    const tx = makeMockTx();
    const conn1 = makeMockConnection({ sendResult: 'sig-abc' });
    const conn2 = makeMockConnection({ sendResult: 'sig-abc' });

    const result = await broadcastAndConfirm(tx, mockWallet, [conn1, conn2]);

    expect(result.signature).toBe('sig-abc');
    expect(result.blockhash).toBe('test-blockhash');
    expect(result.lastValidBlockHeight).toBe(1000);

    // Blockhash must be set on the message before signing (EXE-04)
    expect(tx.message.recentBlockhash).toBe('test-blockhash');
    expect(tx.sign).toHaveBeenCalledWith([mockWallet]);

    // Both connections must receive the transaction (EXE-05)
    expect(conn1.sendRawTransaction).toHaveBeenCalledOnce();
    expect(conn2.sendRawTransaction).toHaveBeenCalledOnce();
  });

  it('one RPC fails, one succeeds — still returns success', async () => {
    const tx = makeMockTx();
    const failing = makeMockConnection({ sendResult: new Error('RPC timeout') });
    const succeeding = makeMockConnection({ sendResult: 'sig-xyz' });

    const result = await broadcastAndConfirm(tx, mockWallet, [failing, succeeding]);

    expect(result.signature).toBe('sig-xyz');
    expect(result.blockhash).toBe('test-blockhash');
  });

  it('all RPCs fail — throws BroadcastError with landed=false', async () => {
    const tx = makeMockTx();
    const conn1 = makeMockConnection({ sendResult: new Error('conn1 error') });
    const conn2 = makeMockConnection({ sendResult: new Error('conn2 error') });

    await expect(broadcastAndConfirm(tx, mockWallet, [conn1, conn2])).rejects.toThrow(
      'All RPC connections rejected transaction'
    );

    try {
      await broadcastAndConfirm(makeMockTx(), mockWallet, [
        makeMockConnection({ sendResult: new Error('fail') }),
      ]);
    } catch (err) {
      expect(err).toBeInstanceOf(BroadcastError);
      expect((err as BroadcastError).landed).toBe(false);
    }
  });

  it('on-chain error — broadcast succeeds but confirmTransaction reports err — throws BroadcastError with landed=true', async () => {
    const tx = makeMockTx();
    const conn = makeMockConnection({
      sendResult: 'sig-err',
      confirmResult: { value: { err: 'InstructionError' } },
    });

    await expect(broadcastAndConfirm(tx, mockWallet, [conn])).rejects.toThrow(
      'Transaction confirmed but failed on-chain'
    );

    try {
      await broadcastAndConfirm(makeMockTx(), mockWallet, [
        makeMockConnection({
          sendResult: 'sig-err2',
          confirmResult: { value: { err: 'InstructionError' } },
        }),
      ]);
    } catch (err) {
      expect(err).toBeInstanceOf(BroadcastError);
      expect((err as BroadcastError).landed).toBe(true);
      expect((err as BroadcastError).signature).toBe('sig-err2');
    }
  });

  it('empty connections array — throws "no RPC connections provided"', async () => {
    const tx = makeMockTx();

    await expect(broadcastAndConfirm(tx, mockWallet, [])).rejects.toThrow(
      'broadcastAndConfirm: no RPC connections provided'
    );
  });

  it('blockhash is fetched from first connection and applied to tx message (EXE-04)', async () => {
    const tx = makeMockTx();
    const conn1 = makeMockConnection({ sendResult: 'sig-1' });
    // conn2 has a different blockhash but should NOT be used for getLatestBlockhash
    const conn2 = {
      ...makeMockConnection({ sendResult: 'sig-2' }),
      getLatestBlockhash: vi.fn().mockResolvedValue({
        blockhash: 'should-not-be-used',
        lastValidBlockHeight: 999,
      }),
    } as unknown as Connection;

    const result = await broadcastAndConfirm(tx, mockWallet, [conn1, conn2]);

    // Only the first connection's blockhash should be used
    expect(tx.message.recentBlockhash).toBe('test-blockhash');
    expect(result.blockhash).toBe('test-blockhash');
    expect(conn2.getLatestBlockhash).not.toHaveBeenCalled();
  });

  it('sendRawTransaction uses skipPreflight=true and maxRetries=0 by default', async () => {
    const tx = makeMockTx();
    const conn = makeMockConnection({ sendResult: 'sig-opts' });

    await broadcastAndConfirm(tx, mockWallet, [conn]);

    expect(conn.sendRawTransaction).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      { skipPreflight: true, maxRetries: 0 }
    );
  });

  it('sendMaxRetries option overrides maxRetries on sendRawTransaction', async () => {
    const tx = makeMockTx();
    const conn = makeMockConnection({ sendResult: 'sig-retry' });

    await broadcastAndConfirm(tx, mockWallet, [conn], { sendMaxRetries: 2 });

    expect(conn.sendRawTransaction).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      { skipPreflight: true, maxRetries: 2 }
    );
  });

  it('confirmTimeoutMs fires before slow confirmation', async () => {
    const tx = makeMockTx();
    const conn = makeMockConnection({ sendResult: 'sig-slow' });
    // Make confirmTransaction hang for 5 seconds
    (conn.confirmTransaction as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ value: { err: null } }), 5000))
    );

    const err = await broadcastAndConfirm(tx, mockWallet, [conn], { confirmTimeoutMs: 50 })
      .catch((e) => e);

    expect(err).toBeInstanceOf(BroadcastError);
    expect(err.landed).toBe(false);
    expect(err.signature).toBe('sig-slow');
    expect(err.message).toContain('timed out');
  });

  // DRY-RUN GATE 1 TESTS
  it('dry-run: returns synthetic BroadcastResult without calling tx.sign', async () => {
    vi.mocked(getRuntimeConfig).mockReturnValue({ dryRun: true } as ReturnType<typeof getRuntimeConfig>);

    const tx = makeMockTx();
    const conn = makeMockConnection({ sendResult: 'sig-should-not-be-used' });

    const result = await broadcastAndConfirm(tx, mockWallet, [conn]);

    // Signature should start with DRY_RUN_
    expect(result.signature).toMatch(/^DRY_RUN_/);
    // Blockhash is still fetched (real blockhash from connection)
    expect(result.blockhash).toBe('test-blockhash');
    expect(result.lastValidBlockHeight).toBe(1000);
    // tx.sign must NOT have been called
    expect(tx.sign).not.toHaveBeenCalled();
    // sendRawTransaction must NOT have been called
    expect(conn.sendRawTransaction).not.toHaveBeenCalled();
  });

  it('dry-run: false proceeds normally (existing behavior unchanged)', async () => {
    vi.mocked(getRuntimeConfig).mockReturnValue({ dryRun: false } as ReturnType<typeof getRuntimeConfig>);

    const tx = makeMockTx();
    const conn = makeMockConnection({ sendResult: 'sig-normal' });

    const result = await broadcastAndConfirm(tx, mockWallet, [conn]);

    expect(result.signature).toBe('sig-normal');
    expect(tx.sign).toHaveBeenCalledWith([mockWallet]);
    expect(conn.sendRawTransaction).toHaveBeenCalledOnce();
  });
});

describe('broadcastWithRetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: dryRun=false for all retry tests
    vi.mocked(getRuntimeConfig).mockReturnValue({ dryRun: false } as ReturnType<typeof getRuntimeConfig>);
  });

  it('first attempt succeeds — returns immediately', async () => {
    const tx = makeMockTx();
    const conn = makeMockConnection({ sendResult: 'sig-first' });

    const result = await broadcastWithRetry(tx, mockWallet, [conn]);

    expect(result.signature).toBe('sig-first');
    // Only one call to getLatestBlockhash (one attempt)
    expect(conn.getLatestBlockhash).toHaveBeenCalledOnce();
  });

  it('first attempt times out, second succeeds — returns second result', async () => {
    vi.useFakeTimers();
    const tx = makeMockTx();
    const conn = makeMockConnection({ sendResult: 'sig-second' });

    let callCount = 0;
    (conn.confirmTransaction as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // First attempt: hang forever (timeout will fire)
        return new Promise(() => {});
      }
      // Second attempt: succeed immediately
      return Promise.resolve({ value: { err: null } });
    });

    // No prior signatures land between retries
    (conn.getSignatureStatuses as ReturnType<typeof vi.fn>).mockResolvedValue({
      value: [null],
    });

    const resultPromise = broadcastWithRetry(tx, mockWallet, [conn]);
    // Advance past the 15s confirmation timeout (attempt 1)
    await vi.advanceTimersByTimeAsync(16_000);

    const result = await resultPromise;

    expect(result.signature).toBe('sig-second');
    expect(conn.getLatestBlockhash).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('prior signature lands between retries — detected via getSignatureStatuses', async () => {
    vi.useFakeTimers();
    const tx = makeMockTx();
    const conn = makeMockConnection({ sendResult: 'sig-late-lander' });

    // First attempt: hang forever (timeout will fire)
    (conn.confirmTransaction as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => new Promise(() => {})
    );

    // Between retries: getSignatureStatuses detects the prior signature
    (conn.getSignatureStatuses as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      value: [{ confirmationStatus: 'confirmed' }],
    });

    const resultPromise = broadcastWithRetry(tx, mockWallet, [conn]);
    // Advance past the 15s confirmation timeout
    await vi.advanceTimersByTimeAsync(16_000);

    const result = await resultPromise;

    expect(result.signature).toBe('sig-late-lander');
    // Should have only called broadcastAndConfirm once (second attempt was skipped)
    expect(conn.getLatestBlockhash).toHaveBeenCalledOnce();
    expect(conn.getSignatureStatuses).toHaveBeenCalledWith(['sig-late-lander']);
    vi.useRealTimers();
  });

  it('on-chain error — immediate throw, no retry', async () => {
    const tx = makeMockTx();
    const conn = makeMockConnection({
      sendResult: 'sig-onchain-fail',
      confirmResult: { value: { err: 'InstructionError' } },
    });

    const err = await broadcastWithRetry(tx, mockWallet, [conn]).catch((e) => e);

    expect(err).toBeInstanceOf(BroadcastError);
    expect(err.landed).toBe(true);
    // Only one attempt — should not retry on-chain failures
    expect(conn.getLatestBlockhash).toHaveBeenCalledOnce();
  });

  it('all attempts exhausted — throws last error', async () => {
    vi.useFakeTimers();
    const tx = makeMockTx();
    const conn = makeMockConnection({ sendResult: 'sig-exhaust' });

    // All 3 attempts: hang forever (timeout will fire)
    (conn.confirmTransaction as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {})
    );

    // No prior signatures land
    (conn.getSignatureStatuses as ReturnType<typeof vi.fn>).mockResolvedValue({
      value: [null],
    });

    const errPromise = broadcastWithRetry(tx, mockWallet, [conn]).catch((e) => e);
    // Advance past all 3 attempts (15s each)
    await vi.advanceTimersByTimeAsync(16_000);
    await vi.advanceTimersByTimeAsync(16_000);
    await vi.advanceTimersByTimeAsync(16_000);

    const err = await errPromise;

    expect(err).toBeInstanceOf(BroadcastError);
    expect(err.landed).toBe(false);
    // All 3 attempts made
    expect(conn.getLatestBlockhash).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });
});
