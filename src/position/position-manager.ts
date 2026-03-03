/**
 * position-manager.ts — Autonomous position exit management (Phase 7).
 *
 * Polls Jupiter quotes for all MONITORING positions at a configured interval.
 * Fires exit triggers based on:
 *   - Stop-loss: position value drops below configured threshold
 *   - Tiered take-profit: position value reaches each multiplier tier
 *   - Trailing stop: price drops below high-watermark by configured percentage
 *
 * Priority: TP takes priority over SL when both would trigger in the same poll cycle.
 * Guard: sellsInFlight Set prevents double-sells on the same position.
 *
 * PumpPortal backfill: positions with missing amountTokens are backfilled via
 * on-chain balance query (same dual-program query as RecoveryManager).
 *
 * Uses recursive setTimeout (not setInterval) so each poll waits for the
 * previous evaluation to complete before scheduling the next.
 *
 * Dynamic interval: when JupiterClient is in a rate-limit cooldown, the poll
 * interval is stretched by cooldownRemainingMs so monitoring yields rate budget
 * to trade-critical buy/sell calls.
 */
import { PublicKey, Connection } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import type { TradeStore } from '../persistence/trade-store.js';
import type { SellLadder } from '../execution/sell/sell-ladder.js';
import type { JupiterClient } from '../execution/jupiter-client.js';
import type { TradingConfig } from '../config/trading.js';
import type { Trade } from '../types/index.js';
import { createModuleLogger } from '../core/logger.js';

const log = createModuleLogger('position-manager');

const SOL_MINT = 'So11111111111111111111111111111111111111112';

export class PositionManager {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  /** mint → SOL high watermark (initialized to entry price on first tick) */
  private readonly highWatermarks = new Map<string, number>();

  /** mint → next tier index (0 = first tier, tieredTp.length = all tiers exhausted) */
  private readonly tierIndices = new Map<string, number>();

  /** mints currently being sold — prevents double-sell on same position */
  private readonly sellsInFlight = new Set<string>();

  constructor(
    private readonly tradeStore: TradeStore,
    private readonly sellLadder: SellLadder,
    private readonly connection: Connection,
    private readonly walletPubKey: PublicKey,
    private readonly config: TradingConfig,
    private readonly jupiterClient: JupiterClient,
  ) {}

  /**
   * Starts the position monitoring loop.
   * Logs a rate-limit warning if projected Jupiter req/min exceeds 50 (free-tier threshold).
   */
  start(): void {
    if (this.running) {
      log.warn('PositionManager.start() called while already running — ignoring');
      return;
    }

    this.running = true;

    // Rate-limit warning: projected Jupiter API requests per minute
    const reqPerMinute =
      (60000 / this.config.positionManagement.pollIntervalMs) *
      this.config.maxConcurrentPositions;

    if (reqPerMinute > 50) {
      log.warn(
        { reqPerMinute, maxPositions: this.config.maxConcurrentPositions },
        'Jupiter rate-limit warning: projected req/min exceeds safe free-tier threshold (50). Consider a Jupiter API key.',
      );
    }

    log.info(
      {
        pollIntervalMs: this.config.positionManagement.pollIntervalMs,
        stopLossPct: this.config.positionManagement.stopLossPct,
        trailingStopPct: this.config.positionManagement.trailingStopPct,
        tieredTpTiers: this.config.positionManagement.tieredTp.length,
      },
      'PositionManager started',
    );

    this.scheduleTick();
  }

  /**
   * Stops the position monitoring loop.
   */
  stop(): void {
    this.running = false;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    log.info('PositionManager stopped');
  }

  /**
   * Schedules the next poll tick using recursive setTimeout.
   * When JupiterClient is in cooldown, stretches the interval by cooldownRemainingMs
   * so monitoring yields rate budget to trade-critical buy/sell calls.
   * Critical: NOT setInterval — each tick waits for the previous to complete.
   */
  private scheduleTick(): void {
    const cooldownMs = this.jupiterClient.cooldownRemainingMs();
    const intervalMs = cooldownMs > 0
      ? cooldownMs + this.config.positionManagement.pollIntervalMs
      : this.config.positionManagement.pollIntervalMs;

    this.timer = setTimeout(async () => {
      try {
        await this.tick();
      } catch (err) {
        log.error({ err }, 'PositionManager tick threw unexpectedly');
      } finally {
        if (this.running) this.scheduleTick();
      }
    }, intervalMs);
  }

  /**
   * One poll cycle: evaluate all MONITORING positions in parallel.
   * Uses Promise.allSettled so one failure does not block others.
   */
  async tick(): Promise<void> {
    const positions = this.tradeStore.getMonitoringTrades();

    if (positions.length > 0) {
      log.debug({ count: positions.length }, 'PositionManager tick: evaluating positions');
    }

    await Promise.allSettled(positions.map(p => this.evaluatePosition(p)));
  }

  /**
   * Evaluates a single position for exit triggers.
   *
   * Order of checks:
   * 1. sellsInFlight guard (double-sell prevention)
   * 2. PumpPortal backfill if amountTokens is missing
   * 3. Jupiter quote fetch (returns null → skip tick)
   * 4. Exit evaluation: tiered TP > trailing stop > stop-loss (TP takes priority)
   */
  private async evaluatePosition(trade: Trade): Promise<void> {
    const { mint } = trade;

    // 1. Double-sell guard
    if (this.sellsInFlight.has(mint)) {
      log.debug({ mint }, 'evaluatePosition: sell in flight, skipping');
      return;
    }

    // 2. PumpPortal backfill: amountTokens may be undefined for PumpPortal trades
    let amountTokens = trade.amountTokens;
    if (amountTokens == null) {
      log.warn({ mint }, 'evaluatePosition: amountTokens missing — backfilling via on-chain query');
      const balance = await this.getWalletTokenBalance(mint);
      if (balance === 0n) {
        log.warn({ mint }, 'evaluatePosition: on-chain balance is 0 — cannot monitor, skipping');
        return;
      }
      this.tradeStore.updateMonitoringAmount(mint, Number(balance));
      amountTokens = Number(balance);
    }

    // 3. Jupiter quote fetch
    const tokenAmountRaw = BigInt(Math.round(amountTokens));
    const currentValueSol = await this.getPositionValueSol(mint, tokenAmountRaw);

    if (currentValueSol === null) {
      log.warn({ mint }, 'evaluatePosition: Jupiter quote failed — skipping tick');
      return;
    }

    // Guard: no entry price to compare against
    if (trade.amountSol == null) {
      log.debug({ mint }, 'evaluatePosition: amountSol missing — cannot evaluate exit triggers');
      return;
    }

    const ratio = currentValueSol / trade.amountSol;

    // Update high watermark (initialized to entry price on first tick)
    const prevWatermark = this.highWatermarks.get(mint) ?? trade.amountSol;
    const newWatermark = Math.max(prevWatermark, currentValueSol);
    this.highWatermarks.set(mint, newWatermark);

    log.debug(
      {
        mint,
        currentValueSol,
        entryValueSol: trade.amountSol,
        ratio: ratio.toFixed(3),
        highWatermark: newWatermark,
      },
      'evaluatePosition: tick',
    );

    // 4. Exit evaluation — TP takes priority over SL per locked decision

    const { tieredTp, stopLossPct, trailingStopPct } = this.config.positionManagement;

    // --- Tiered take-profit ---
    const tierIndex = this.tierIndices.get(mint) ?? 0;
    const activeTier = tierIndex < tieredTp.length ? tieredTp[tierIndex] : null;

    if (activeTier !== null && ratio >= activeTier.at) {
      // Tiered TP fires
      const tokensToSell = this.calcTieredTpTokens(tokenAmountRaw, activeTier.pct);
      const nextTierIndex = tierIndex + 1;

      log.info(
        {
          mint,
          tier: tierIndex,
          at: activeTier.at,
          pct: activeTier.pct,
          ratio: ratio.toFixed(3),
          tokensToSell: tokensToSell.toString(),
        },
        'PositionManager: tiered TP triggered',
      );

      if (trade.dryRun) {
        log.info(
          { dryRun: true, mint, trigger: 'TIERED_TP', tier: tierIndex, at: activeTier.at, pct: activeTier.pct, ratio: ratio.toFixed(3) },
          '[DRY RUN] take-profit would have triggered'
        );
        this.tradeStore.transition(mint, 'MONITORING', 'COMPLETED', {
          errorMessage: `DRY_RUN_TRIGGER: TIERED_TP tier=${tierIndex}`,
        });
        return;
      }
      this.fireSell(mint, tokensToSell);
      this.tierIndices.set(mint, nextTierIndex);
      return;
    }

    // --- Trailing stop ---
    if (trailingStopPct > 0) {
      const trailingThreshold = newWatermark * (1 - trailingStopPct / 100);
      if (currentValueSol < trailingThreshold) {
        log.info(
          {
            mint,
            currentValueSol,
            highWatermark: newWatermark,
            trailingThreshold,
            trailingStopPct,
          },
          'PositionManager: trailing stop triggered',
        );
        if (trade.dryRun) {
          log.info(
            { dryRun: true, mint, trigger: 'TRAILING_STOP', highWatermark: newWatermark, currentValueSol, trailingStopPct },
            '[DRY RUN] trailing stop would have triggered'
          );
          this.tradeStore.transition(mint, 'MONITORING', 'COMPLETED', {
            errorMessage: `DRY_RUN_TRIGGER: TRAILING_STOP`,
          });
          return;
        }
        this.fireSell(mint, tokenAmountRaw);
        return;
      }
    }

    // --- Stop-loss ---
    const slThreshold = 1 + stopLossPct / 100;
    if (ratio < slThreshold) {
      log.info(
        {
          mint,
          currentValueSol,
          entryValueSol: trade.amountSol,
          ratio: ratio.toFixed(3),
          stopLossPct,
        },
        'PositionManager: stop-loss triggered',
      );
      if (trade.dryRun) {
        log.info(
          { dryRun: true, mint, trigger: 'STOP_LOSS', ratio: ratio.toFixed(3), stopLossPct },
          '[DRY RUN] stop-loss would have triggered'
        );
        this.tradeStore.transition(mint, 'MONITORING', 'COMPLETED', {
          errorMessage: `DRY_RUN_TRIGGER: STOP_LOSS`,
        });
        return;
      }
      this.fireSell(mint, tokenAmountRaw);
      return;
    }
  }

  /**
   * Fires a sell for the given mint/amount.
   * - Adds mint to sellsInFlight
   * - Fire-and-forget: SellLadder handles MONITORING→SELLING transition internally
   * - Removes from sellsInFlight when the sell settles (via .finally())
   */
  private fireSell(mint: string, tokensToSell: bigint): void {
    this.sellsInFlight.add(mint);
    const p = this.sellLadder.sell(mint, tokensToSell);
    // Discard the promise for the caller (fire-and-forget), but clean up on settle
    void p;
    p.finally(() => {
      this.sellsInFlight.delete(mint);
    });
  }

  /**
   * Calculates the token amount to sell for a tiered TP tier.
   * Uses integer division (bigint) to avoid float precision issues.
   * Minimum 1n as a safety guard against rounding to 0.
   */
  private calcTieredTpTokens(tokenAmountRaw: bigint, pct: number): bigint {
    let tokensToSell = (tokenAmountRaw * BigInt(pct)) / 100n;
    if (tokensToSell === 0n) tokensToSell = 1n;
    return tokensToSell;
  }

  /**
   * Fetches the current SOL value of a position via Jupiter quote.
   * Returns null on any failure (caller skips the tick).
   *
   * Uses the centralized JupiterClient for authenticated, rate-limit-aware requests.
   * Response: { outAmount: string } — raw lamports, divide by 1e9 for SOL
   */
  private async getPositionValueSol(mint: string, tokenAmountRaw: bigint): Promise<number | null> {
    const params = new URLSearchParams({
      inputMint: mint,
      outputMint: SOL_MINT,
      amount: tokenAmountRaw.toString(),
      slippageBps: '50',
      maxAccounts: '64',
    });

    try {
      const data = (await this.jupiterClient.quote(params)) as { outAmount: string };
      return Number(data.outAmount) / 1e9;
    } catch {
      return null;
    }
  }

  /**
   * Queries on-chain token balance for `mint` across both TOKEN_PROGRAM_ID
   * (legacy SPL) and TOKEN_2022_PROGRAM_ID (pump.fun create_v2, Nov 2025+).
   * Returns total balance as bigint (sum of all token accounts).
   *
   * Identical dual-program query to RecoveryManager.getWalletTokenBalance().
   */
  private async getWalletTokenBalance(mint: string): Promise<bigint> {
    const mintPubKey = new PublicKey(mint);

    const [legacyResult, token2022Result] = await Promise.all([
      // Legacy SPL: filter by mint directly
      this.connection.getParsedTokenAccountsByOwner(this.walletPubKey, { mint: mintPubKey }),
      // Token-2022 (pump.fun create_v2): filter by programId, then client-side by mint
      this.connection
        .getParsedTokenAccountsByOwner(this.walletPubKey, { programId: TOKEN_2022_PROGRAM_ID })
        .then(res => ({
          value: res.value.filter(a => a.account.data.parsed?.info?.mint === mint),
        })),
    ]);

    let total = 0n;

    for (const acct of legacyResult.value) {
      const amount: string | undefined = acct.account.data.parsed?.info?.tokenAmount?.amount;
      if (amount) total += BigInt(amount);
    }

    for (const acct of token2022Result.value) {
      const amount: string | undefined = acct.account.data.parsed?.info?.tokenAmount?.amount;
      if (amount) total += BigInt(amount);
    }

    return total;
  }
}
