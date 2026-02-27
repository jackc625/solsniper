import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type VersionedTransaction, type Connection, type Keypair } from '@solana/web3.js';
import { broadcastAndConfirm } from './broadcaster.js';

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
  } as unknown as Connection;
}

describe('broadcastAndConfirm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('all RPCs fail — throws "All RPC connections rejected"', async () => {
    const tx = makeMockTx();
    const conn1 = makeMockConnection({ sendResult: new Error('conn1 error') });
    const conn2 = makeMockConnection({ sendResult: new Error('conn2 error') });

    await expect(broadcastAndConfirm(tx, mockWallet, [conn1, conn2])).rejects.toThrow(
      'All RPC connections rejected transaction'
    );
  });

  it('on-chain error — broadcast succeeds but confirmTransaction reports err — throws', async () => {
    const tx = makeMockTx();
    const conn = makeMockConnection({
      sendResult: 'sig-err',
      confirmResult: { value: { err: 'InstructionError' } },
    });

    await expect(broadcastAndConfirm(tx, mockWallet, [conn])).rejects.toThrow(
      'Transaction confirmed but failed on-chain'
    );
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

  it('sendRawTransaction uses skipPreflight=true and maxRetries=0', async () => {
    const tx = makeMockTx();
    const conn = makeMockConnection({ sendResult: 'sig-opts' });

    await broadcastAndConfirm(tx, mockWallet, [conn]);

    expect(conn.sendRawTransaction).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      { skipPreflight: true, maxRetries: 0 }
    );
  });
});
