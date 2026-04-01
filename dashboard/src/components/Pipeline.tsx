import { useState, useMemo, useRef, useEffect } from 'preact/hooks';
import { feedEvents, type FeedEvent } from '../store/feed.js';

/* ---- Constants ---- */

const MAX_PIPELINE_EVENTS = 200; // Cap per Pitfall 4

/* ---- Helper functions (defined locally -- Performance.tsx does not export these) ---- */

function shortenMint(mint: string): string {
  return mint.length > 12 ? `${mint.slice(0, 8)}...` : mint;
}

function SourceBadge({ source }: { source: string | null }) {
  if (!source) return <span style={{ color: 'var(--gray)' }}>{'\u2014'}</span>;
  const colors: Record<string, string> = {
    pumpportal: 'var(--green)',
    raydium:    'var(--blue)',
    pumpswap:   'var(--yellow)',
  };
  const c = colors[source.toLowerCase()] ?? 'var(--gray)';
  return (
    <span style={{
      color: c,
      border: `1px solid ${c}`,
      padding: '0 4px',
      fontSize: '10px',
      letterSpacing: '0.04em',
      lineHeight: '1.4',
    }}>
      {source.toLowerCase()}
    </span>
  );
}

/* ---- Types ---- */

type SafetyEvent = FeedEvent & { safetyResult: NonNullable<FeedEvent['safetyResult']> };

/* ---- Sub-component: PipelineCard ---- */

function PipelineCard({ event }: { event: SafetyEvent }) {
  const [expanded, setExpanded] = useState(false);
  const { safetyResult } = event;
  const borderColor = safetyResult.pass ? 'var(--green)' : 'var(--red)';

  return (
    <div
      style={{ ...PIPE_CARD, borderLeft: `3px solid ${borderColor}` }}
      onClick={() => setExpanded(v => !v)}
    >
      {/* Collapsed header: mint, source, PASS/FAIL badge, score, time */}
      <div style={CARD_ROW}>
        <span style={MINT_TEXT}>{shortenMint(event.mint)}</span>
        <SourceBadge source={event.source ?? null} />
        <span style={{
          ...BADGE,
          background: borderColor,
          color: '#000',
        }}>
          {safetyResult.pass ? 'PASS' : 'FAIL'}
        </span>
        <span style={SCORE_TEXT}>{safetyResult.aggregateScore}/100</span>
        <span style={TIME_TEXT}>{safetyResult.durationMs}ms</span>
        <span style={CHEVRON}>{expanded ? '\u25BE' : '\u25B8'}</span>
      </div>

      {/* Expanded: per-check detail table */}
      <div style={{
        maxHeight: expanded ? '300px' : '0',
        overflow: 'hidden',
        transition: 'max-height 150ms ease',
      }}>
        <table style={DETAIL_TABLE}>
          <thead>
            <tr>
              <th style={DETAIL_TH}>Check</th>
              <th style={DETAIL_TH}>Tier</th>
              <th style={DETAIL_TH}>Result</th>
              <th style={DETAIL_TH}>Score</th>
              <th style={DETAIL_TH}>Detail</th>
            </tr>
          </thead>
          <tbody>
            {safetyResult.checks.map((check, i) => (
              <tr key={i}>
                <td style={DETAIL_TD}>{check.source}</td>
                <td style={DETAIL_TD}>{check.tier}</td>
                <td style={{ ...DETAIL_TD, color: check.pass ? 'var(--green)' : 'var(--red)' }}>
                  {check.pass ? 'PASS' : 'FAIL'}
                </td>
                <td style={DETAIL_TD}>{check.score ?? '\u2014'}</td>
                <td style={{ ...DETAIL_TD, maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {check.detail}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {safetyResult.rejectionReasons.length > 0 && (
          <div style={REJECTION_BOX}>
            <div style={REJECTION_LABEL}>REJECTION REASONS</div>
            {safetyResult.rejectionReasons.map((r, i) => (
              <div key={i} style={REJECTION_TEXT}>{r}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---- Main component ---- */

export function Pipeline() {
  const listRef = useRef<HTMLDivElement>(null);
  const [isLive, setIsLive] = useState(true);

  // Filter SAFETY_EVALUATION events from the shared feed signal
  const pipelineEvents = useMemo(() => {
    return feedEvents.value
      .filter((e): e is SafetyEvent =>
        e.type === 'SAFETY_EVALUATION' && e.safetyResult !== undefined
      )
      .slice(-MAX_PIPELINE_EVENTS);
  }, [feedEvents.value]);

  // Compute stats with rolling accumulator (per D-10, client-side)
  const stats = useMemo(() => {
    if (pipelineEvents.length === 0) return { passRate: 0, avgScore: 0, evalsPerMin: 0 };
    const passes = pipelineEvents.filter(e => e.safetyResult.pass).length;
    const passRate = Math.round((passes / pipelineEvents.length) * 100);
    const avgScore = Math.round(pipelineEvents.reduce((s, e) => s + e.safetyResult.aggregateScore, 0) / pipelineEvents.length);
    // evals/min: count events in last 60s
    const now = Date.now();
    const recentCount = pipelineEvents.filter(e => e.ts > now - 60_000).length;
    return { passRate, avgScore, evalsPerMin: recentCount };
  }, [pipelineEvents]);

  // Auto-scroll to bottom when new events arrive and user is at bottom (LiveFeed pattern)
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

  return (
    <div style={PAGE}>
      <div style={PAGE_HEADER}>
        <span style={PAGE_TITLE}>SAFETY PIPELINE</span>
        <span style={PAGE_SUB}>Live safety evaluation stream</span>
      </div>

      {/* Stats header -- row of 3 stat cards */}
      <div style={STATS_ROW}>
        <div style={STAT_CARD}>
          <div style={STAT_LABEL}>PASS RATE</div>
          <div style={{ ...STAT_VALUE, color: stats.passRate >= 50 ? 'var(--green)' : stats.passRate >= 30 ? 'var(--yellow)' : 'var(--red)' }}>
            {stats.passRate}%
          </div>
        </div>
        <div style={STAT_CARD}>
          <div style={STAT_LABEL}>AVG SCORE</div>
          <div style={STAT_VALUE}>{stats.avgScore}/100</div>
        </div>
        <div style={STAT_CARD}>
          <div style={STAT_LABEL}>EVALS/MIN</div>
          <div style={STAT_VALUE}>{stats.evalsPerMin}</div>
        </div>
      </div>

      {/* Toolbar -- event count + LIVE indicator (LiveFeed pattern) */}
      <div style={TOOLBAR}>
        <span style={{ color: 'var(--gray)', fontFamily: 'var(--font-mono)', fontSize: '10px', letterSpacing: '0.08em' }}>
          {pipelineEvents.length > 0
            ? <span><span style={{ color: 'var(--text)' }}>{pipelineEvents.length}</span> evaluations</span>
            : <span>pipeline</span>
          }
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
          {!isLive && (
            <button
              onClick={() => {
                setIsLive(true);
                if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
              }}
              style={RESUME_BTN}
            >
              RESUME LIVE
            </button>
          )}
          {isLive && (
            <span style={LIVE_INDICATOR}>
              <span style={LIVE_DOT} />
              LIVE
            </span>
          )}
        </div>
      </div>

      {/* Pipeline card list */}
      <div
        ref={listRef}
        onScroll={handleScroll}
        style={LIST_CONTAINER}
      >
        {pipelineEvents.length === 0 && (
          <div style={EMPTY_STATE}>
            <div style={EMPTY_HEADING}>Waiting for evaluations</div>
            <div style={EMPTY_BODY}>Safety pipeline evaluations will appear here in real-time as tokens are detected.</div>
          </div>
        )}
        {pipelineEvents.map((e, i) => (
          <PipelineCard key={`${e.ts}-${i}`} event={e} />
        ))}
      </div>
    </div>
  );
}

/* ---- Styles ---- */

const PAGE: Record<string, string> = {
  display:       'flex',
  flexDirection: 'column',
  height:        '100%',
  overflow:      'hidden',
};

const PAGE_HEADER: Record<string, string> = {
  display:       'flex',
  alignItems:    'baseline',
  gap:           'var(--sp-4)',
  padding:       'var(--sp-5) var(--sp-6)',
  borderBottom:  '1px solid var(--border)',
  flexShrink:    '0',
};

const PAGE_TITLE: Record<string, string> = {
  fontFamily:    'var(--font-display)',
  fontWeight:    '700',
  fontSize:      '20px',
  letterSpacing: '0.15em',
  color:         'var(--text-bright)',
};

const PAGE_SUB: Record<string, string> = {
  fontSize:      '10px',
  color:         'var(--text-dim)',
  letterSpacing: '0.1em',
};

const STATS_ROW: Record<string, string> = {
  display:       'flex',
  gap:           'var(--sp-2)',
  padding:       'var(--sp-3) var(--sp-6)',
  flexShrink:    '0',
  borderBottom:  '1px solid var(--border)',
};

const STAT_CARD: Record<string, string> = {
  background:    'var(--bg2)',
  border:        '1px solid var(--border)',
  padding:       '10px 16px',
  minWidth:      '110px',
  flex:          '1 1 110px',
};

const STAT_LABEL: Record<string, string> = {
  fontSize:      '10px',
  color:         'var(--gray)',
  letterSpacing: '0.08em',
  marginBottom:  '4px',
  fontWeight:    '700',
};

const STAT_VALUE: Record<string, string> = {
  fontSize:   '18px',
  fontWeight: '700',
  color:      'var(--text)',
};

const TOOLBAR: Record<string, string> = {
  display:        'flex',
  justifyContent: 'space-between',
  alignItems:     'center',
  padding:        '6px var(--sp-6)',
  background:     'var(--bg2)',
  borderBottom:   '1px solid var(--border)',
  flexShrink:     '0',
};

const RESUME_BTN: Record<string, string> = {
  background:    'var(--blue)',
  color:         '#000',
  border:        'none',
  padding:       '3px 10px',
  cursor:        'pointer',
  fontSize:      '10px',
  fontFamily:    'var(--font-mono)',
  fontWeight:    '700',
  letterSpacing: '0.05em',
};

const LIVE_INDICATOR: Record<string, string> = {
  display:       'flex',
  alignItems:    'center',
  gap:           '5px',
  color:         'var(--green)',
  fontSize:      '10px',
  letterSpacing: '0.06em',
};

const LIVE_DOT: Record<string, string> = {
  display:      'inline-block',
  width:        '6px',
  height:       '6px',
  borderRadius: '50%',
  background:   'var(--green)',
  animation:    'pulse-dot 1.4s ease-in-out infinite',
};

const LIST_CONTAINER: Record<string, string> = {
  flex:      '1',
  overflowY: 'auto',
  padding:   'var(--sp-2) var(--sp-6)',
};

const PIPE_CARD: Record<string, string> = {
  background:    'var(--bg2)',
  border:        '1px solid var(--border)',
  padding:       'var(--sp-3)',
  marginBottom:  'var(--sp-2)',
  cursor:        'pointer',
  borderRadius:  'var(--r-sm)',
};

const CARD_ROW: Record<string, string> = {
  display:    'flex',
  alignItems: 'center',
  gap:        'var(--sp-2)',
  flexWrap:   'wrap',
};

const MINT_TEXT: Record<string, string> = {
  fontFamily:    'var(--font-mono)',
  fontSize:      '13px',
  color:         'var(--text)',
  letterSpacing: '0.02em',
};

const BADGE: Record<string, string> = {
  padding:       '2px 6px',
  fontSize:      '10px',
  fontWeight:    '700',
  letterSpacing: '0.1em',
  borderRadius:  'var(--r-sm)',
};

const SCORE_TEXT: Record<string, string> = {
  fontSize:      '13px',
  fontWeight:    '700',
  color:         'var(--text)',
  fontFamily:    'var(--font-mono)',
};

const TIME_TEXT: Record<string, string> = {
  fontSize:   '10px',
  color:      'var(--text-dim)',
  fontFamily: 'var(--font-mono)',
};

const CHEVRON: Record<string, string> = {
  fontSize:   '10px',
  color:      'var(--gray)',
  marginLeft: 'auto',
};

const DETAIL_TABLE: Record<string, string> = {
  width:          '100%',
  borderCollapse: 'collapse',
  fontSize:       '13px',
  marginTop:      'var(--sp-2)',
};

const DETAIL_TH: Record<string, string> = {
  padding:      '4px 8px',
  textAlign:    'left',
  borderBottom: '1px solid var(--border)',
  color:        'var(--gray)',
  fontWeight:   'normal',
  fontSize:     '10px',
  letterSpacing: '0.08em',
};

const DETAIL_TD: Record<string, string> = {
  padding:      '4px 8px',
  borderBottom: '1px solid var(--border-subtle)',
  fontSize:     '13px',
  color:        'var(--text)',
  whiteSpace:   'nowrap',
};

const REJECTION_BOX: Record<string, string> = {
  marginTop:    'var(--sp-2)',
  padding:      'var(--sp-2) var(--sp-3)',
  background:   'rgba(255, 68, 68, 0.05)',
  border:       '1px solid rgba(255, 68, 68, 0.2)',
  borderRadius: 'var(--r-sm)',
};

const REJECTION_LABEL: Record<string, string> = {
  fontSize:      '10px',
  fontWeight:    '700',
  letterSpacing: '0.1em',
  color:         'var(--red)',
  marginBottom:  '4px',
};

const REJECTION_TEXT: Record<string, string> = {
  fontSize:   '13px',
  color:      'var(--text-dim)',
  lineHeight: '1.5',
};

const EMPTY_STATE: Record<string, string> = {
  display:        'flex',
  flexDirection:  'column',
  alignItems:     'center',
  justifyContent: 'center',
  flex:           '1',
  padding:        'var(--sp-6)',
  color:          'var(--gray)',
  textAlign:      'center',
  minHeight:      '200px',
};

const EMPTY_HEADING: Record<string, string> = {
  fontFamily:    'var(--font-display)',
  fontWeight:    '700',
  fontSize:      '16px',
  letterSpacing: '0.1em',
  marginBottom:  'var(--sp-3)',
};

const EMPTY_BODY: Record<string, string> = {
  fontSize:   '13px',
  lineHeight: '1.5',
  maxWidth:   '360px',
};
