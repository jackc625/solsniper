import { useEffect, useRef, useState } from 'preact/hooks';
import { feedEvents, connectFeed, type FeedEvent } from '../store/feed.js';
import { useSignal } from '@preact/signals';

const BADGE_COLORS: Record<string, string> = {
  TOKEN_DETECTED: 'var(--gray)',
  BUY_SENT:       'var(--blue)',
  BUY_CONFIRMED:  'var(--green)',
  BUY_FAILED:     'var(--red)',
  SELL_TRIGGERED: 'var(--yellow)',
  SELL_CONFIRMED: 'var(--green)',
  SELL_FAILED:    'var(--red)',
  ERROR:          'var(--red)',
};

function formatTs(ts: number): string {
  return new Date(ts).toTimeString().slice(0, 8); // HH:MM:SS
}

function shortenMint(mint: string): string {
  return mint.length > 12 ? `${mint.slice(0, 6)}...${mint.slice(-4)}` : mint;
}

function FeedRow({ event }: { event: FeedEvent }) {
  const color = BADGE_COLORS[event.type] ?? 'var(--gray)';
  return (
    <div style={{ padding: '0.25rem 1rem', borderBottom: '1px solid var(--border)', fontSize: '0.85rem' }}>
      <span style={{ color: 'var(--gray)' }}>[{formatTs(event.ts)}]</span>{' '}
      <span style={{ color, fontWeight: 'bold', padding: '0 0.25rem', border: `1px solid ${color}` }}>
        {event.type}
      </span>{' '}
      <span style={{ color: 'var(--text)' }}>{shortenMint(event.mint)}</span>
      {event.detail && <span style={{ color: 'var(--gray)', marginLeft: '0.5rem' }}>{event.detail}</span>}
    </div>
  );
}

export function LiveFeed() {
  const listRef = useRef<HTMLDivElement>(null);
  const [isLive, setIsLive] = useState(true);
  const events = useSignal(feedEvents);

  // Connect SSE on mount
  useEffect(() => {
    const disconnect = connectFeed();
    return disconnect;
  }, []);

  // Auto-scroll to bottom when new events arrive and user hasn't manually scrolled
  useEffect(() => {
    if (isLive && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [events.value, isLive]);

  const handleScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    setIsLive(atBottom);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '0.5rem 1rem', background: 'var(--bg2)' }}>
        {!isLive && (
          <button
            onClick={() => {
              setIsLive(true);
              if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
            }}
            style={{ background: 'var(--blue)', color: '#fff', border: 'none', padding: '0.25rem 0.75rem', cursor: 'pointer' }}
          >
            Resume Live
          </button>
        )}
        {isLive && <span style={{ color: 'var(--green)', fontSize: '0.8rem' }}>LIVE</span>}
      </div>
      <div
        ref={listRef}
        onScroll={handleScroll}
        style={{ flex: 1, overflowY: 'auto', fontFamily: 'var(--mono)' }}
      >
        {events.value.length === 0 && (
          <div style={{ padding: '2rem', color: 'var(--gray)', textAlign: 'center' }}>
            Waiting for events...
          </div>
        )}
        {events.value.map((e, i) => <FeedRow key={`${e.ts}-${i}`} event={e} />)}
      </div>
    </div>
  );
}
