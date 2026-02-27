import { EventEmitter } from 'eventemitter3';

export type BotEventType =
  | 'TOKEN_DETECTED'
  | 'BUY_SENT'
  | 'BUY_CONFIRMED'
  | 'BUY_FAILED'
  | 'SELL_TRIGGERED'
  | 'SELL_CONFIRMED'
  | 'SELL_FAILED'
  | 'ERROR';

export interface BotEvent {
  type: BotEventType;
  mint: string;
  ts: number;       // Unix ms — Date.now()
  detail?: string;  // Brief human-readable description for feed row
}

// Typed EventEmitter3 — only one event name ('event') with BotEvent payload.
// Using named import (not default import) per project convention (avoids TS2507).
type BotEventBusEvents = {
  event: (e: BotEvent) => void;
};

class BotEventBusCls extends EventEmitter<BotEventBusEvents> {}

// Singleton — one instance shared across the entire process.
// If no SSE clients are connected, emitted events are simply dropped.
export const botEventBus = new BotEventBusCls();
