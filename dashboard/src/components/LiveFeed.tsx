import { useEffect, useRef, useState } from 'preact/hooks';
import { feedEvents, connectFeed } from '../store/feed.js';
import { FeedCard } from './FeedCard.js';

export function LiveFeed() {
  const listRef = useRef<HTMLDivElement>(null);
  const [isLive, setIsLive] = useState(true);

  // Connect SSE on mount
  useEffect(() => {
    const disconnect = connectFeed();
    return disconnect;
  }, []);

  // Auto-scroll to bottom when new events arrive and user hasn't manually scrolled.
  // Depends only on feedEvents.value — card expansion must NOT trigger this effect.
  useEffect(() => {
    if (isLive && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [feedEvents.value, isLive]);

  const handleScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    setIsLive(atBottom);
  };

  const eventCount = feedEvents.value.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* ---- Toolbar ---- */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '0.4rem 0.75rem',
        background: 'var(--bg2)',
        borderBottom: '1px solid var(--border)',
        fontSize: '0.72rem',
        flexShrink: 0,
      }}>
        {/* Event count */}
        <span style={{ color: 'var(--gray)', fontFamily: 'var(--mono)' }}>
          {eventCount > 0
            ? <span><span style={{ color: 'var(--text)' }}>{eventCount}</span> events</span>
            : <span style={{ color: 'var(--gray)' }}>feed</span>
          }
        </span>

        {/* Live status / Resume button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {!isLive && (
            <button
              onClick={() => {
                setIsLive(true);
                if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
              }}
              style={{
                background: 'var(--blue)',
                color: '#000',
                border: 'none',
                padding: '0.2rem 0.6rem',
                cursor: 'pointer',
                fontSize: '0.7rem',
                fontFamily: 'var(--mono)',
                fontWeight: 700,
                letterSpacing: '0.05em',
              }}
            >
              RESUME LIVE
            </button>
          )}
          {isLive && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: 'var(--green)', fontSize: '0.7rem', letterSpacing: '0.06em' }}>
              <span style={{
                display: 'inline-block',
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: 'var(--green)',
                animation: 'livePulse 1.4s ease-in-out infinite',
              }} />
              LIVE
            </span>
          )}
        </div>
      </div>

      {/* ---- Feed list ---- */}
      <div
        ref={listRef}
        onScroll={handleScroll}
        style={{ flex: 1, overflowY: 'auto', fontFamily: 'var(--mono)' }}
      >
        {eventCount === 0 && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            gap: '0.5rem',
            color: 'var(--gray)',
            fontSize: '0.8rem',
            userSelect: 'none',
          }}>
            <span>waiting for events</span>
            <span style={{
              display: 'inline-block',
              width: '8px',
              height: '1em',
              background: 'var(--gray)',
              animation: 'cursorBlink 1s step-end infinite',
              verticalAlign: 'text-bottom',
            }} />
          </div>
        )}
        {feedEvents.value.map((e, i) => (
          <FeedCard key={`${e.ts}-${i}`} event={e} />
        ))}
      </div>

      {/* Keyframe animations injected once via a style tag */}
      <style>{`
        @keyframes livePulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
        @keyframes cursorBlink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
