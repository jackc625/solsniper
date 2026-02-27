import { Connection, type Commitment } from '@solana/web3.js';
import { EventEmitter } from 'eventemitter3';
import type { RpcManagerEvents } from '../types/index.js';
import { createModuleLogger } from './logger.js';

const log = createModuleLogger('rpc-manager');

type RpcState = 'primary' | 'backup';

export class RpcManager extends EventEmitter<RpcManagerEvents> {
  private readonly primary: Connection;
  private readonly backup: Connection;
  private state: RpcState = 'primary';
  private consecutiveFailures: number = 0;
  private recoveryTimer: ReturnType<typeof setInterval> | null = null;

  private readonly FAILURE_THRESHOLD = 3;
  private readonly RECOVERY_INTERVAL_MS = 10_000;

  constructor(primaryUrl: string, backupUrl: string, commitment: Commitment = 'confirmed') {
    super();
    this.primary = new Connection(primaryUrl, { commitment });
    this.backup = new Connection(backupUrl, { commitment });

    // Mask API keys in RPC URLs before logging (keys often appear in query params)
    const maskUrl = (url: string) => url.replace(/api-key=[^&]*/gi, 'api-key=***');
    log.info(
      { primaryUrl: maskUrl(primaryUrl), backupUrl: maskUrl(backupUrl), commitment },
      'RPC manager initialized'
    );
  }

  /**
   * Returns the currently active connection (primary or backup).
   */
  getConnection(): Connection {
    return this.state === 'primary' ? this.primary : this.backup;
  }

  /**
   * Returns all configured connections for parallel broadcast.
   * Both primary and backup receive the transaction simultaneously.
   */
  getAllConnections(): Connection[] {
    return [this.primary, this.backup];
  }

  /**
   * Returns the current state for logging/monitoring.
   */
  getState(): string {
    return this.state;
  }

  /**
   * Records a successful RPC call, resetting the consecutive failure count.
   */
  recordSuccess(): void {
    this.consecutiveFailures = 0;
  }

  /**
   * Records a failed RPC call. Emits 'degraded' on each failure.
   * After FAILURE_THRESHOLD consecutive failures on primary, triggers failover.
   */
  recordFailure(reason: string): void {
    this.consecutiveFailures++;

    this.emit('degraded', {
      endpoint: this.state,
      consecutiveFailures: this.consecutiveFailures,
    });

    log.warn(
      { consecutiveFailures: this.consecutiveFailures, threshold: this.FAILURE_THRESHOLD },
      'RPC failure recorded'
    );

    if (this.state === 'primary' && this.consecutiveFailures >= this.FAILURE_THRESHOLD) {
      this.switchToBackup(reason);
    }
  }

  private switchToBackup(reason: string): void {
    this.state = 'backup';
    const failureCount = this.consecutiveFailures;
    this.consecutiveFailures = 0;

    this.emit('failover', {
      from: 'primary',
      to: 'backup',
      reason,
      consecutiveFailures: failureCount,
    });

    log.warn({ reason }, 'Switched to backup RPC');

    this.startRecoveryPolling();
  }

  private startRecoveryPolling(): void {
    if (this.recoveryTimer !== null) return;

    this.recoveryTimer = setInterval(async () => {
      try {
        await this.primary.getSlot();
        // Primary is back online
        this.state = 'primary';
        this.consecutiveFailures = 0;
        this.stopRecoveryPolling();
        this.emit('recovered', { endpoint: 'primary' });
        log.info('RPC primary recovered — switched back to primary');
      } catch {
        // Primary still down — keep polling
      }
    }, this.RECOVERY_INTERVAL_MS);
  }

  private stopRecoveryPolling(): void {
    if (this.recoveryTimer !== null) {
      clearInterval(this.recoveryTimer);
      this.recoveryTimer = null;
    }
  }

  /**
   * Stops recovery polling and releases resources.
   * Call on shutdown to prevent lingering timers.
   */
  close(): void {
    this.stopRecoveryPolling();
    log.debug('RPC manager closed');
  }
}
