import { useState, useEffect } from 'preact/hooks';
import {
  pausedSignal,
  estopDialogOpen,
  setDetectionPaused,
  forceSell,
  fetchPausedState,
} from '../store/controls.js';

/* ---- Helpers (defined locally -- Performance.tsx does not export these) ---- */

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

function formatDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m ${rs}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm}m`;
}

/* ---- Types ---- */

interface Position {
  id: number;
  mint: string;
  state: string;
  amountSol?: number;
  entryPriceSol?: number;
  source?: string;
  createdAt?: number;
}

/* ---- Sub-component: ActionCell ---- */

function ActionCell({ pos, sellingIds, setSellingIds }: {
  pos: Position;
  sellingIds: Set<number>;
  setSellingIds: (fn: (prev: Set<number>) => Set<number>) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');

  // Auto-dismiss confirmation after 5s
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 5000);
    return () => clearTimeout(t);
  }, [confirming]);

  if (sellingIds.has(pos.id) || pos.state === 'SELLING') {
    return <span style={SELLING_BADGE}>SELLING...</span>;
  }

  if (confirming) {
    return (
      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
        <span style={{ fontSize: '10px', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>SELL {shortenMint(pos.mint)}?</span>
        <button style={CONFIRM_SELL_BTN} onClick={async (e) => {
          e.stopPropagation();
          const result = await forceSell(pos.id);
          if (result.ok || result.status === 409) {
            setSellingIds(prev => new Set([...prev, pos.id]));
          } else {
            setError(result.error ?? 'Force sell failed -- check bot logs for details');
            setTimeout(() => setError(''), 5000);
          }
          setConfirming(false);
        }}>CONFIRM SELL</button>
        <button style={KEEP_BTN} onClick={(e) => { e.stopPropagation(); setConfirming(false); }}>KEEP POSITION</button>
      </div>
    );
  }

  return (
    <div>
      <button style={FORCE_SELL_BTN} onClick={() => setConfirming(true)}>FORCE SELL</button>
      {error && <div style={ERROR_TEXT}>{error}</div>}
    </div>
  );
}

/* ---- Main component ---- */

export function Controls() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [sellingIds, setSellingIds] = useState<Set<number>>(new Set());
  const [error, setError] = useState('');

  const isPaused = pausedSignal.value;

  // Fetch initial paused state and poll positions every 5s
  useEffect(() => {
    void fetchPausedState();
    void loadPositions();
    const id = setInterval(() => {
      void fetchPausedState();
      void loadPositions();
    }, 5000);
    return () => clearInterval(id);
  }, []);

  const loadPositions = async () => {
    try {
      const res = await fetch('/api/trades');
      if (res.ok) {
        const data = await res.json() as Position[];
        setPositions(data);
      }
    } catch { /* ignore network errors */ }
  };

  // Toggle handler with optimistic update + revert on error
  const handleToggle = async () => {
    const target = !isPaused;
    const result = await setDetectionPaused(target);
    if (!result.ok) {
      setError('Could not update detection state -- try again');
      setTimeout(() => setError(''), 5000);
    }
  };

  return (
    <div style={PAGE}>
      <div style={PAGE_HEADER}>
        <span style={PAGE_TITLE}>CONTROLS</span>
        <span style={PAGE_SUB}>Detection and position management</span>
      </div>

      <div style={CONTENT}>
        {/* ---- Detection Controls section ---- */}
        <section style={SECTION}>
          <div style={SECTION_LABEL}>DETECTION</div>

          <div style={CARD}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--sp-4)' }}>
              <div>
                <div style={{ fontSize: '13px', color: 'var(--text)', marginBottom: '4px' }}>
                  Detection is currently <span style={{ fontWeight: '700', color: isPaused ? 'var(--yellow)' : 'var(--green)' }}>{isPaused ? 'PAUSED' : 'ACTIVE'}</span>
                </div>
                {error && <div style={ERROR_TEXT}>{error}</div>}
              </div>
              <button
                onClick={() => void handleToggle()}
                style={{
                  ...TOGGLE_BTN,
                  background: isPaused ? 'var(--yellow)' : 'var(--green)',
                }}
              >
                {isPaused ? 'RESUME DETECTION' : 'PAUSE DETECTION'}
              </button>
            </div>
          </div>

          {/* Emergency stop card */}
          <div style={{ ...CARD, borderColor: 'var(--red)' }}>
            <div style={{ ...CARD_LABEL_STYLE, color: 'var(--red)' }}>EMERGENCY STOP</div>
            <div style={CARD_DESC}>Pause all detection and force-sell every open position.</div>
            <button
              onClick={() => { estopDialogOpen.value = true; }}
              style={ESTOP_PAGE_BTN}
            >
              EMERGENCY STOP
            </button>
          </div>
        </section>

        {/* ---- Open Positions section ---- */}
        <section style={SECTION}>
          <div style={SECTION_LABEL}>OPEN POSITIONS</div>

          {positions.length === 0 ? (
            <div style={EMPTY_STATE}>No open positions</div>
          ) : (
            <div style={{ overflowX: 'auto', border: '1px solid var(--border)' }}>
              <table style={TABLE}>
                <thead>
                  <tr>
                    {['Mint', 'Source', 'Entry SOL', 'Duration', 'Action'].map(h => (
                      <th key={h} style={TH}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {positions.map((pos) => {
                    const duration = pos.createdAt ? Date.now() - pos.createdAt : 0;
                    return (
                      <tr key={pos.id} style={TR}>
                        <td style={TD}>
                          <a
                            href={`https://solscan.io/token/${pos.mint}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={pos.mint}
                            style={{ color: 'var(--blue)', textDecoration: 'none' }}
                          >
                            {shortenMint(pos.mint)}
                          </a>
                        </td>
                        <td style={TD}><SourceBadge source={pos.source ?? null} /></td>
                        <td style={TD}>{pos.entryPriceSol?.toFixed(6) ?? '\u2014'}</td>
                        <td style={{ ...TD, color: 'var(--text-dim)' }}>{duration > 0 ? formatDuration(duration) : '\u2014'}</td>
                        <td style={TD}>
                          <ActionCell pos={pos} sellingIds={sellingIds} setSellingIds={setSellingIds} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
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

const CONTENT: Record<string, string> = {
  flex:      '1',
  overflowY: 'auto',
  padding:   'var(--sp-6)',
};

const SECTION: Record<string, string> = {
  marginBottom: 'var(--sp-6)',
};

const SECTION_LABEL: Record<string, string> = {
  fontFamily:    'var(--font-display)',
  fontWeight:    '700',
  fontSize:      '13px',
  letterSpacing: '0.15em',
  color:         'var(--amber)',
  marginBottom:  'var(--sp-3)',
};

const CARD: Record<string, string> = {
  background:    'var(--bg2)',
  border:        '1px solid var(--border)',
  borderRadius:  'var(--r-sm)',
  padding:       'var(--sp-4)',
  marginBottom:  'var(--sp-3)',
};

const CARD_LABEL_STYLE: Record<string, string> = {
  fontFamily:    'var(--font-display)',
  fontWeight:    '700',
  fontSize:      '13px',
  letterSpacing: '0.15em',
  marginBottom:  'var(--sp-2)',
};

const CARD_DESC: Record<string, string> = {
  fontSize:      '13px',
  color:         'var(--text-dim)',
  marginBottom:  'var(--sp-3)',
  lineHeight:    '1.5',
};

const TOGGLE_BTN: Record<string, string> = {
  fontFamily:    'var(--font-display)',
  fontWeight:    '700',
  fontSize:      '13px',
  letterSpacing: '0.12em',
  color:         '#000',
  border:        'none',
  padding:       '10px var(--sp-6)',
  borderRadius:  'var(--r-sm)',
  cursor:        'pointer',
  whiteSpace:    'nowrap',
  minHeight:     '44px',
};

const ESTOP_PAGE_BTN: Record<string, string> = {
  fontFamily:    'var(--font-display)',
  fontWeight:    '700',
  fontSize:      '13px',
  letterSpacing: '0.15em',
  background:    'var(--red)',
  color:         '#000',
  border:        'none',
  padding:       '10px var(--sp-6)',
  borderRadius:  'var(--r-sm)',
  cursor:        'pointer',
  minHeight:     '44px',
};

const EMPTY_STATE: Record<string, string> = {
  background:     'var(--bg2)',
  border:         '1px solid var(--border)',
  padding:        'var(--sp-8)',
  textAlign:      'center',
  color:          'var(--gray)',
  fontSize:       '13px',
  borderRadius:   'var(--r-sm)',
};

const TABLE: Record<string, string> = {
  width:          '100%',
  borderCollapse: 'collapse',
  fontSize:       '13px',
};

const TH: Record<string, string> = {
  padding:       '8px 12px',
  textAlign:     'left',
  borderBottom:  '1px solid var(--border)',
  color:         'var(--gray)',
  fontWeight:    'normal',
  fontSize:      '10px',
  letterSpacing: '0.08em',
  background:    'var(--bg2)',
  position:      'sticky',
  top:           '0',
};

const TD: Record<string, string> = {
  padding:      '8px 12px',
  borderBottom: '1px solid var(--border-subtle)',
  fontSize:     '13px',
  color:        'var(--text)',
};

const TR: Record<string, string> = {
  transition: 'background 0.1s',
};

const FORCE_SELL_BTN: Record<string, string> = {
  border:        '1px solid var(--red)',
  color:         'var(--red)',
  background:    'transparent',
  padding:       '4px 10px',
  fontSize:      '10px',
  fontWeight:    '700',
  fontFamily:    'var(--font-mono)',
  letterSpacing: '0.08em',
  cursor:        'pointer',
  borderRadius:  'var(--r-sm)',
  whiteSpace:    'nowrap',
};

const CONFIRM_SELL_BTN: Record<string, string> = {
  background:    'var(--red)',
  color:         '#000',
  border:        'none',
  padding:       '4px 8px',
  fontSize:      '10px',
  fontWeight:    '700',
  fontFamily:    'var(--font-mono)',
  letterSpacing: '0.06em',
  cursor:        'pointer',
  borderRadius:  'var(--r-sm)',
  whiteSpace:    'nowrap',
};

const KEEP_BTN: Record<string, string> = {
  background:    'transparent',
  border:        '1px solid var(--border)',
  color:         'var(--text-dim)',
  padding:       '4px 8px',
  fontSize:      '10px',
  fontWeight:    '700',
  fontFamily:    'var(--font-mono)',
  letterSpacing: '0.06em',
  cursor:        'pointer',
  borderRadius:  'var(--r-sm)',
  whiteSpace:    'nowrap',
};

const SELLING_BADGE: Record<string, string> = {
  background:    'rgba(240, 165, 0, 0.15)',
  color:         'var(--amber)',
  padding:       '4px 8px',
  fontSize:      '10px',
  fontWeight:    '700',
  fontFamily:    'var(--font-mono)',
  letterSpacing: '0.08em',
  borderRadius:  'var(--r-sm)',
  animation:     'pulse-dot 2s ease-in-out infinite',
};

const ERROR_TEXT: Record<string, string> = {
  fontSize:    '10px',
  color:       'var(--red)',
  marginTop:   '4px',
};
