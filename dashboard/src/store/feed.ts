import { signal } from '@preact/signals';

export interface FeedEvent {
  type: string;
  mint: string;
  ts: number;
  detail?: string;
  isDryRun?: boolean;     // Phase 12: true for dry-run trades
  safetyScore?: number;   // Aggregate safety score 0-100 (present on TOKEN_DETECTED)
  source?: string;        // Detection source: 'pumpportal' | 'raydium' | 'pumpswap'
  buyAmountSol?: number;  // Configured or actual buy amount in SOL
  pnlSol?: number;        // Realized P&L in SOL (present on SELL_CONFIRMED/SELL_FAILED when known)
}

export const feedEvents = signal<FeedEvent[]>([]);
const MAX_FEED_SIZE = 200;

export function connectFeed(): () => void {
  const es = new EventSource('/events');

  es.addEventListener('message', (e) => {
    try {
      const event = JSON.parse(e.data as string) as FeedEvent;
      const current = feedEvents.value;
      const next = [...current, event];
      feedEvents.value = next.length > MAX_FEED_SIZE
        ? next.slice(next.length - MAX_FEED_SIZE)
        : next;
    } catch {
      // Ignore malformed events
    }
  });

  // Also handle typed events (SSE event field matches BotEventType)
  const eventTypes = ['TOKEN_DETECTED','BUY_SENT','BUY_CONFIRMED','BUY_FAILED',
                      'SELL_TRIGGERED','SELL_PARTIAL','SELL_CONFIRMED','SELL_FAILED','ERROR',
                      'CONFIG_CHANGED'] as const;
  eventTypes.forEach((type) => {
    es.addEventListener(type, (e) => {
      try {
        const event = JSON.parse((e as MessageEvent).data as string) as FeedEvent;
        const current = feedEvents.value;
        const next = [...current, event];
        feedEvents.value = next.length > MAX_FEED_SIZE
          ? next.slice(next.length - MAX_FEED_SIZE)
          : next;
      } catch { /* ignore */ }
    });
  });

  es.onerror = () => {
    // EventSource auto-reconnects after ~3s (browser native behavior) — no manual retry needed
  };

  return () => es.close();
}
