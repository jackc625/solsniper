import { ResilientWebSocket } from '../core/resilient-ws.js';
import { createModuleLogger } from '../core/logger.js';
import type { TokenEvent, ResilientWsConfig } from '../types/index.js';

const log = createModuleLogger('pump-portal-listener');

/**
 * PumpPortalListener listens to the PumpPortal WebSocket for new token creation events.
 *
 * Extends ResilientWebSocket for:
 *  - Exponential backoff reconnection (DET-03)
 *  - Heartbeat-based silent connection detection (DET-04)
 *  - Excessive reconnect alerting (DET-05)
 *
 * Emits TokenEvent for each subscribeNewToken message with txType === 'create'.
 * Latency stamping (detectedAt = Date.now()) is the very first operation in onMessage
 * per research Pitfall 4 — measurement must precede any parsing.
 *
 * One connection, one subscription: never open multiple connections to PumpPortal.
 * subscribeMigration is intentionally omitted — migration events are duplicate mints
 * that the dedup layer would drop anyway, and opening a second subscription would
 * violate PumpPortal's connection policies.
 */
export class PumpPortalListener extends ResilientWebSocket {
  private readonly onToken: (event: TokenEvent) => void;
  private firstMessageReceived = false;

  constructor(config: ResilientWsConfig, onToken: (event: TokenEvent) => void) {
    super(config);
    this.onToken = onToken;
  }

  protected getSubscriptions(): object[] {
    return [{ method: 'subscribeNewToken' }];
  }

  protected onMessage(data: string): void {
    // IMPORTANT: capture latency timestamp before ANY parsing (research Pitfall 4)
    const detectedAt = Date.now();

    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(data) as Record<string, unknown>;
    } catch (err) {
      log.warn({ err, dataSnippet: data.slice(0, 100) }, 'Failed to parse PumpPortal message');
      return;
    }

    // Log first message at debug level to validate PumpPortal field presence (research Open Question 2)
    if (!this.firstMessageReceived) {
      this.firstMessageReceived = true;
      log.debug({ raw }, 'First PumpPortal message received — validating field structure');
    }

    if (raw['txType'] !== 'create') {
      // Non-create messages (trades, etc.) — ignore silently
      return;
    }

    const mint = raw['mint'];
    if (typeof mint !== 'string' || !mint) {
      log.warn({ raw }, 'PumpPortal create event missing mint field — skipping');
      return;
    }

    const event: TokenEvent = {
      mint,
      source: 'pumpportal',
      detectedAt,
      signature: typeof raw['signature'] === 'string' ? raw['signature'] : undefined,
      name: typeof raw['name'] === 'string' ? raw['name'] : undefined,
      symbol: typeof raw['symbol'] === 'string' ? raw['symbol'] : undefined,
      uri: typeof raw['uri'] === 'string' ? raw['uri'] : undefined,
      creator: typeof raw['traderPublicKey'] === 'string' ? raw['traderPublicKey'] : undefined,
      bondingCurveKey: typeof raw['bondingCurveKey'] === 'string' ? raw['bondingCurveKey'] : undefined,
      initialBuyAmount: typeof raw['initialBuy'] === 'number' ? raw['initialBuy'] : undefined,
      marketCapSol: typeof raw['marketCapSol'] === 'number' ? raw['marketCapSol'] : undefined,
      vSolInBondingCurve: typeof raw['vSolInBondingCurve'] === 'number' ? raw['vSolInBondingCurve'] : undefined,
      vTokensInBondingCurve: typeof raw['vTokensInBondingCurve'] === 'number' ? raw['vTokensInBondingCurve'] : undefined,
    };

    this.onToken(event);
  }
}
