import { useState } from 'preact/hooks';
import type { FeedEvent } from '../store/feed.js';

// Event type to accent color mapping — these map to CSS variable values
const BADGE_COLORS: Record<string, string> = {
  TOKEN_DETECTED: 'var(--gray)',
  BUY_SENT:       'var(--blue)',
  BUY_CONFIRMED:  'var(--green)',
  BUY_FAILED:     'var(--red)',
  SELL_TRIGGERED: 'var(--yellow)',
  SELL_PARTIAL:    'var(--green)',
  SELL_CONFIRMED: 'var(--green)',
  SELL_FAILED:    'var(--red)',
  ERROR:          'var(--red)',
  CONFIG_CHANGED:  'var(--amber)',
};

// More readable event type labels
const EVENT_LABELS: Record<string, string> = {
  TOKEN_DETECTED: 'DETECTED',
  BUY_SENT:       'BUY SENT',
  BUY_CONFIRMED:  'BUY OK',
  BUY_FAILED:     'BUY FAIL',
  SELL_TRIGGERED: 'SELL TRIG',
  SELL_PARTIAL:    'PARTIAL',
  SELL_CONFIRMED: 'SELL OK',
  SELL_FAILED:    'SELL FAIL',
  ERROR:          'ERROR',
  CONFIG_CHANGED:  'CFG',
};

function formatTs(ts: number): string {
  return new Date(ts).toTimeString().slice(0, 8); // HH:MM:SS
}

function formatPnl(pnlSol: number | undefined): { text: string; color: string } {
  if (pnlSol === undefined || pnlSol === null) {
    return { text: '\u2014', color: 'var(--gray)' }; // em-dash
  }
  if (pnlSol >= 0) {
    return { text: `+${pnlSol.toFixed(4)} SOL`, color: 'var(--green)' };
  }
  return { text: `${pnlSol.toFixed(4)} SOL`, color: 'var(--red)' };
}

function formatScore(score: number): { label: string; color: string } {
  if (score >= 70) return { label: `${score}`, color: 'var(--green)' };
  if (score >= 40) return { label: `${score}`, color: 'var(--yellow)' };
  return { label: `${score}`, color: 'var(--red)' };
}

function formatSource(source: string): string {
  const map: Record<string, string> = {
    pumpportal: 'PUMP',
    raydium: 'RAY',
    pumpswap: 'PSWAP',
  };
  return map[source.toLowerCase()] ?? source.toUpperCase();
}

interface FeedCardProps {
  event: FeedEvent;
}

export function FeedCard({ event }: FeedCardProps) {
  const [expanded, setExpanded] = useState(false);
  const accentColor = BADGE_COLORS[event.type] ?? 'var(--gray)';
  const label = EVENT_LABELS[event.type] ?? event.type;
  const pnl = formatPnl(event.pnlSol);
  const isPumpPortal = event.source?.toLowerCase() === 'pumpportal';

  const cardStyle: Record<string, string | number> = {
    position: 'relative',
    background: 'var(--bg2)',
    borderLeft: `3px solid ${accentColor}`,
    marginBottom: '2px',
    cursor: 'pointer',
    transition: 'background 0.1s',
    opacity: event.isDryRun ? 0.75 : 1,
    fontFamily: 'var(--mono)',
  };

  // -----------------------------------------------------------------------
  // Collapsed header row
  // -----------------------------------------------------------------------
  const headerStyle: Record<string, string | number> = {
    display: 'grid',
    gridTemplateColumns: '72px 1fr auto',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.35rem 0.75rem 0.35rem 0.6rem',
    fontSize: '0.78rem',
  };

  const badgeStyle: Record<string, string | number> = {
    display: 'inline-block',
    background: accentColor,
    color: '#000',
    fontWeight: 700,
    fontSize: '0.65rem',
    padding: '1px 5px',
    letterSpacing: '0.04em',
    whiteSpace: 'nowrap',
    lineHeight: '1.4',
  };

  const mintStyle: Record<string, string | number> = {
    color: 'var(--text)',
    fontFamily: 'var(--mono)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: '0.72rem',
    letterSpacing: '0.02em',
  };

  const rightColStyle: Record<string, string | number> = {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    flexShrink: 0,
  };

  // -----------------------------------------------------------------------
  // Expanded detail panel
  // -----------------------------------------------------------------------
  const expandedStyle: Record<string, string | number> = {
    overflow: 'hidden',
    maxHeight: expanded ? '200px' : '0',
    transition: 'max-height 0.15s ease',
    background: 'rgba(0,0,0,0.25)',
    borderTop: expanded ? '1px solid var(--border)' : 'none',
  };

  const detailRowStyle: Record<string, string | number> = {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.4rem 1rem',
    padding: '0.5rem 0.75rem',
    fontSize: '0.72rem',
    color: 'var(--gray)',
  };

  const detailFieldStyle: Record<string, string | number> = {
    display: 'flex',
    gap: '0.3rem',
  };

  const detailLabelStyle: Record<string, string | number> = {
    color: 'var(--gray)',
    textTransform: 'uppercase',
    fontSize: '0.62rem',
    letterSpacing: '0.06em',
  };

  return (
    <div
      style={cardStyle}
      onClick={() => setExpanded(prev => !prev)}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = '#1f1f1f';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = 'var(--bg2)';
      }}
    >
      {/* ---- Collapsed header ---- */}
      <div style={headerStyle}>
        {/* Col 1: event badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', flexShrink: 0 }}>
          <span style={badgeStyle}>{label}</span>
        </div>

        {/* Col 2: mint + links */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0 }}>
          {/* DRY RUN badge */}
          {event.isDryRun && (
            <span style={{
              flexShrink: 0,
              color: 'var(--yellow)',
              border: '1px solid var(--yellow)',
              padding: '0 4px',
              fontSize: '0.62rem',
              letterSpacing: '0.05em',
              lineHeight: '1.4',
            }}>
              DRY
            </span>
          )}
          {/* Source badge */}
          {event.source && (
            <span style={{
              flexShrink: 0,
              color: 'var(--gray)',
              border: '1px solid var(--border)',
              padding: '0 4px',
              fontSize: '0.62rem',
              letterSpacing: '0.04em',
              lineHeight: '1.4',
            }}>
              {formatSource(event.source)}
            </span>
          )}
          {/* Mint link */}
          <a
            href={`https://solscan.io/token/${event.mint}`}
            target="_blank"
            rel="noopener noreferrer"
            title={event.mint}
            onClick={(e) => e.stopPropagation()}
            style={{ ...mintStyle, color: 'var(--blue)', textDecoration: 'none' }}
          >
            {event.mint}
          </a>
          {/* pump.fun link for PumpPortal */}
          {isPumpPortal && (
            <a
              href={`https://pump.fun/coin/${event.mint}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{
                flexShrink: 0,
                fontSize: '0.62rem',
                color: 'var(--yellow)',
                textDecoration: 'none',
                border: '1px solid rgba(255,204,0,0.35)',
                padding: '0 4px',
                lineHeight: '1.4',
              }}
            >
              pump
            </a>
          )}
        </div>

        {/* Col 3: P&L + safety score + timestamp */}
        <div style={rightColStyle}>
          {/* Safety score */}
          {event.safetyScore !== undefined && (
            <span style={{ ...formatScore(event.safetyScore), fontSize: '0.7rem', fontWeight: 600 }}>
              {formatScore(event.safetyScore).label}
            </span>
          )}
          {/* Buy amount */}
          {event.buyAmountSol !== undefined && (
            <span style={{ color: 'var(--gray)', fontSize: '0.7rem' }}>
              {event.buyAmountSol.toFixed(3)}&thinsp;◎
            </span>
          )}
          {/* P&L */}
          <span style={{ color: pnl.color, fontSize: '0.72rem', fontWeight: pnl.text !== '\u2014' ? 700 : 400, minWidth: '4.5rem', textAlign: 'right' }}>
            {pnl.text}
          </span>
          {/* Timestamp */}
          <span style={{ color: 'var(--gray)', fontSize: '0.68rem', whiteSpace: 'nowrap' }}>
            {formatTs(event.ts)}
          </span>
          {/* Expand indicator */}
          <span style={{ color: 'var(--gray)', fontSize: '0.65rem', marginLeft: '0.1rem' }}>
            {expanded ? '\u25B4' : '\u25BE'}
          </span>
        </div>
      </div>

      {/* ---- Expanded detail ---- */}
      <div style={expandedStyle}>
        <div style={detailRowStyle}>
          {/* Full mint */}
          <div style={detailFieldStyle}>
            <span style={detailLabelStyle}>mint</span>
            <span style={{ color: 'var(--text)', wordBreak: 'break-all', fontFamily: 'var(--mono)', fontSize: '0.7rem' }}>
              {event.mint}
            </span>
          </div>

          {/* Source (full) */}
          {event.source && (
            <div style={detailFieldStyle}>
              <span style={detailLabelStyle}>source</span>
              <span style={{ color: 'var(--text)' }}>{event.source}</span>
            </div>
          )}

          {/* Safety score full */}
          {event.safetyScore !== undefined && (
            <div style={detailFieldStyle}>
              <span style={detailLabelStyle}>safety</span>
              <span style={{ color: formatScore(event.safetyScore).color, fontWeight: 600 }}>
                {event.safetyScore}/100
              </span>
            </div>
          )}

          {/* Buy amount */}
          {event.buyAmountSol !== undefined && (
            <div style={detailFieldStyle}>
              <span style={detailLabelStyle}>buy</span>
              <span style={{ color: 'var(--text)' }}>{event.buyAmountSol} SOL</span>
            </div>
          )}

          {/* P&L */}
          <div style={detailFieldStyle}>
            <span style={detailLabelStyle}>p&amp;l</span>
            <span style={{ color: pnl.color }}>{pnl.text}</span>
          </div>

          {/* Links */}
          <div style={detailFieldStyle}>
            <span style={detailLabelStyle}>links</span>
            <span style={{ display: 'flex', gap: '0.5rem' }}>
              <a
                href={`https://solscan.io/token/${event.mint}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                style={{ color: 'var(--blue)' }}
              >
                Solscan
              </a>
              {isPumpPortal && (
                <a
                  href={`https://pump.fun/coin/${event.mint}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  style={{ color: 'var(--yellow)' }}
                >
                  pump.fun
                </a>
              )}
            </span>
          </div>

          {/* Detail text */}
          {event.detail && (
            <div style={{ width: '100%', ...detailFieldStyle }}>
              <span style={detailLabelStyle}>detail</span>
              <span style={{ color: 'var(--text)', wordBreak: 'break-word' }}>{event.detail}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
