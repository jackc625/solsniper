import { EventEmitter } from 'eventemitter3';

export type BotEventType =
  | 'TOKEN_DETECTED'
  | 'BUY_SENT'
  | 'BUY_CONFIRMED'
  | 'BUY_FAILED'
  | 'SELL_TRIGGERED'
  | 'SELL_PARTIAL'      // Emitted per tiered TP tier fire
  | 'SELL_CONFIRMED'
  | 'SELL_FAILED'
  | 'ERROR'
  | 'CONFIG_CHANGED'
  | 'LOW_BALANCE';     // EXE-12: emitted when wallet balance below buy threshold

export interface BotEvent {
  type: BotEventType;
  mint: string;
  ts: number;             // Unix ms -- Date.now()
  detail?: string;        // Brief human-readable description for feed row
  isDryRun?: boolean;     // Phase 12: true for dry-run trades
  safetyScore?: number;   // Aggregate safety score 0-100 (present on TOKEN_DETECTED)
  source?: string;        // Detection source: 'pumpportal' | 'raydium' | 'pumpswap'
  buyAmountSol?: number;  // Configured or actual buy amount in SOL
  pnlSol?: number;        // Realized P&L in SOL (present on SELL_CONFIRMED/SELL_FAILED when known)
}

// Typed EventEmitter3 -- only one event name ('event') with BotEvent payload.
// Using named import (not default import) per project convention (avoids TS2507).
type BotEventBusEvents = {
  event: (e: BotEvent) => void;
};

class BotEventBusCls extends EventEmitter<BotEventBusEvents> {}

// Singleton -- one instance shared across the entire process.
// If no SSE clients are connected, emitted events are simply dropped.
export const botEventBus = new BotEventBusCls();
