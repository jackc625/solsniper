import { Connection, PublicKey } from '@solana/web3.js';
import { createModuleLogger } from '../core/logger.js';
import type { TokenEvent } from '../types/index.js';

const log = createModuleLogger('raydium-listener');

// Program addresses
const RAYDIUM_V4_PROGRAM = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';
const PUMPSWAP_PROGRAM = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';

// Wrapped SOL mint -- not a real token
const WRAPPED_SOL_MINT = 'So11111111111111111111111111111111111111112';

// Default silence threshold: 2 minutes without any log event triggers health check
const DEFAULT_SILENCE_THRESHOLD_MS = 120_000;

// Health check interval: run every 60 seconds
const HEALTH_CHECK_INTERVAL_MS = 60_000;

export interface RaydiumListenerConfig {
  silenceThresholdMs?: number;
}

/**
 * RaydiumListener wraps Solana connection.onLogs() to detect:
 *  - Raydium V4 pool creation via 'initialize2' instruction log
 *  - PumpSwap pool creation via 'CreatePool' or 'Instruction: CreatePool' log
 *
 * Does NOT extend ResilientWebSocket because onLogs() uses @solana/web3.js's
 * internal WebSocket management. Instead, implements its own health-check
 * mechanism to handle silent subscription death (research Pitfall 2): the
 * @solana/web3.js client may reconnect internally after network disruption
 * but will NOT replay subscriptions, causing silent gaps in detection.
 *
 * The health check recreates subscriptions if no log events are received
 * within silenceThresholdMs (default 2 minutes).
 */
export class RaydiumListener {
  private readonly connection: Connection;
  private readonly onToken: (event: TokenEvent) => void;
  private readonly silenceThresholdMs: number;

  // Subscription IDs for cleanup
  private raydiumSubId: number | null = null;
  private pumpSwapSubId: number | null = null;

  // Health check state
  private lastEventAt: number = Date.now();
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;

  // Debug logging: log first detection of each type to validate filter strings
  private firstRaydiumDetected = false;
  private firstPumpSwapDetected = false;

  constructor(
    connection: Connection,
    onToken: (event: TokenEvent) => void,
    config: RaydiumListenerConfig = {}
  ) {
    this.connection = connection;
    this.onToken = onToken;
    this.silenceThresholdMs = config.silenceThresholdMs ?? DEFAULT_SILENCE_THRESHOLD_MS;
  }

  /**
   * Creates onLogs subscriptions for Raydium V4 and PumpSwap programs,
   * and starts the health check interval.
   */
  start(): void {
    this.subscribe();
    this.startHealthCheck();
    log.info(
      { raydiumProgram: RAYDIUM_V4_PROGRAM, pumpSwapProgram: PUMPSWAP_PROGRAM },
      'RaydiumListener started -- monitoring Raydium V4 and PumpSwap pool creation'
    );
  }

  /**
   * Removes onLogs subscriptions and stops the health check.
   */
  async stop(): Promise<void> {
    this.stopHealthCheck();
    await this.unsubscribe();
    log.debug('RaydiumListener stopped');
  }

  // ---------------------------------------------------------------------------
  // Subscription management
  // ---------------------------------------------------------------------------

  private subscribe(): void {
    // Raydium V4 subscription: watch for 'initialize2' in logs
    this.raydiumSubId = this.connection.onLogs(
      new PublicKey(RAYDIUM_V4_PROGRAM),
      (logs, ctx) => {
        this.lastEventAt = Date.now();

        if (logs.err) return; // Failed transaction -- skip

        const hasInitialize2 = logs.logs.some((l) => l.includes('initialize2'));
        if (!hasInitialize2) return;

        if (!this.firstRaydiumDetected) {
          this.firstRaydiumDetected = true;
          log.debug({ signature: logs.signature, logs: logs.logs }, 'First Raydium V4 pool creation detected -- validating filter');
        }

        void this.handleRaydiumPool(logs.signature, ctx.slot);
      },
      'processed'
    );

    // PumpSwap subscription: watch for 'CreatePool' or 'Instruction: CreatePool' in logs
    this.pumpSwapSubId = this.connection.onLogs(
      new PublicKey(PUMPSWAP_PROGRAM),
      (logs, ctx) => {
        this.lastEventAt = Date.now();

        if (logs.err) return; // Failed transaction -- skip

        const hasCreatePool = logs.logs.some(
          (l) => l.includes('CreatePool') || l.includes('Instruction: CreatePool')
        );
        if (!hasCreatePool) return;

        if (!this.firstPumpSwapDetected) {
          this.firstPumpSwapDetected = true;
          log.debug({ signature: logs.signature, logs: logs.logs }, 'First PumpSwap pool creation detected -- validating filter');
        }

        void this.handlePumpSwapPool(logs.signature, ctx.slot);
      },
      'processed'
    );

    log.debug(
      { raydiumSubId: this.raydiumSubId, pumpSwapSubId: this.pumpSwapSubId },
      'onLogs subscriptions created'
    );
  }

  private async unsubscribe(): Promise<void> {
    const promises: Promise<void>[] = [];

    if (this.raydiumSubId !== null) {
      promises.push(
        this.connection.removeOnLogsListener(this.raydiumSubId).catch((err: unknown) => {
          log.warn({ err }, 'Failed to remove Raydium onLogs listener');
        })
      );
      this.raydiumSubId = null;
    }

    if (this.pumpSwapSubId !== null) {
      promises.push(
        this.connection.removeOnLogsListener(this.pumpSwapSubId).catch((err: unknown) => {
          log.warn({ err }, 'Failed to remove PumpSwap onLogs listener');
        })
      );
      this.pumpSwapSubId = null;
    }

    await Promise.all(promises);
  }

  // ---------------------------------------------------------------------------
  // Pool handlers
  // ---------------------------------------------------------------------------

  /**
   * Fetches and parses a Raydium V4 pool creation transaction to extract the token mint.
   * Account indices 8 and 9 contain the token mints; we pick the non-SOL one.
   */
  private async handleRaydiumPool(signature: string, slot: number): Promise<void> {
    const detectedAt = Date.now();

    try {
      const tx = await this.connection.getParsedTransaction(signature, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed',
      });

      if (!tx?.transaction?.message) {
        log.warn({ signature }, 'Raydium: failed to fetch transaction');
        return;
      }

      // Find the Raydium V4 instruction
      const instructions = tx.transaction.message.instructions;
      const raydiumIx = instructions.find((ix) => {
        if ('programId' in ix) {
          return ix.programId.toBase58() === RAYDIUM_V4_PROGRAM;
        }
        return false;
      });

      if (!raydiumIx || !('accounts' in raydiumIx)) {
        log.warn({ signature }, 'Raydium: initialize2 instruction not found in transaction');
        return;
      }

      const accounts = raydiumIx.accounts;
      if (accounts.length < 10) {
        log.warn({ signature, accountCount: accounts.length }, 'Raydium: insufficient accounts in instruction');
        return;
      }

      // Indices 8 and 9 are the two token mints; pick the non-SOL mint
      const mint8 = accounts[8].toBase58();
      const mint9 = accounts[9].toBase58();
      const mint = mint8 === WRAPPED_SOL_MINT ? mint9 : mint8;

      if (!mint || mint === WRAPPED_SOL_MINT) {
        log.warn({ signature, mint8, mint9 }, 'Raydium: could not identify non-SOL token mint');
        return;
      }

      // Extract poolQuoteVault (accounts[11] = pcVault/quoteVault) for liquidity depth check
      // Only set if quoteMint (accounts[9]) is WSOL -- confirms vault holds SOL
      const quoteMint = accounts[9].toBase58();
      const poolQuoteVault = accounts.length >= 12 && quoteMint === WRAPPED_SOL_MINT
        ? accounts[11].toBase58()
        : undefined;

      const event: TokenEvent = {
        mint,
        source: 'raydium',
        detectedAt,
        signature,
        ...(poolQuoteVault ? { poolQuoteVault } : {}),
      };

      log.debug({ mint, signature, slot }, 'Raydium V4 pool creation parsed');
      this.onToken(event);
    } catch (err) {
      log.error({ err, signature }, 'Raydium: error parsing pool creation transaction');
    }
  }

  /**
   * Fetches and parses a PumpSwap pool creation transaction to extract the token mint.
   * Logs instruction accounts at debug level on first detection to identify correct indices.
   */
  private async handlePumpSwapPool(signature: string, slot: number): Promise<void> {
    const detectedAt = Date.now();

    try {
      const tx = await this.connection.getParsedTransaction(signature, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed',
      });

      if (!tx?.transaction?.message) {
        log.warn({ signature }, 'PumpSwap: failed to fetch transaction');
        return;
      }

      // Find the PumpSwap instruction
      const instructions = tx.transaction.message.instructions;
      const pumpSwapIx = instructions.find((ix) => {
        if ('programId' in ix) {
          return ix.programId.toBase58() === PUMPSWAP_PROGRAM;
        }
        return false;
      });

      if (!pumpSwapIx || !('accounts' in pumpSwapIx)) {
        log.warn({ signature }, 'PumpSwap: CreatePool instruction not found in transaction');
        return;
      }

      const accounts = pumpSwapIx.accounts;

      // Log accounts on first detection to identify correct indices (research Open Question 1)
      log.debug(
        { signature, accounts: accounts.map((a: { toBase58: () => string }) => a.toBase58()), accountCount: accounts.length },
        'PumpSwap CreatePool instruction accounts -- identifying token mint index'
      );

      if (accounts.length < 3) {
        log.warn({ signature, accountCount: accounts.length }, 'PumpSwap: insufficient accounts in instruction');
        return;
      }

      // Defensive: find the non-SOL mint by scanning all accounts
      // PumpSwap account layout may differ from Raydium; scan rather than hardcode
      const accountBases = accounts.map((a: { toBase58: () => string }) => a.toBase58());
      const mint = accountBases.find(
        (addr: string) => addr !== WRAPPED_SOL_MINT && addr !== PUMPSWAP_PROGRAM
      );

      if (!mint) {
        log.warn({ signature, accounts: accountBases }, 'PumpSwap: could not identify token mint from accounts');
        return;
      }

      const event: TokenEvent = {
        mint,
        source: 'pumpswap',
        detectedAt,
        signature,
      };

      log.debug({ mint, signature, slot }, 'PumpSwap pool creation parsed');
      this.onToken(event);
    } catch (err) {
      log.error({ err, signature }, 'PumpSwap: error parsing pool creation transaction');
    }
  }

  // ---------------------------------------------------------------------------
  // Health check (research Pitfall 2: silent onLogs death)
  // ---------------------------------------------------------------------------

  private startHealthCheck(): void {
    this.healthCheckTimer = setInterval(async () => {
      const silenceMs = Date.now() - this.lastEventAt;

      if (silenceMs > this.silenceThresholdMs) {
        log.warn(
          { silenceMs, silenceThresholdMs: this.silenceThresholdMs },
          'RaydiumListener: no log events received -- subscription may have died, recreating'
        );

        // Remove stale subscriptions and recreate
        await this.unsubscribe();
        this.subscribe();
      }
    }, HEALTH_CHECK_INTERVAL_MS);
  }

  private stopHealthCheck(): void {
    if (this.healthCheckTimer !== null) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }
}
