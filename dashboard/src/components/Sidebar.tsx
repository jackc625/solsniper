import { useEffect, useState } from 'preact/hooks';
import { configSignal } from '../store/config.js';
import { pausedSignal, estopDialogOpen, fetchPausedState } from '../store/controls.js';

export type View = 'feed' | 'performance' | 'pipeline' | 'controls' | 'status' | 'settings';

interface SidebarProps {
  activeView: View;
  onNavigate: (view: View) => void;
}

interface Stats {
  openPositions: number;
  winRate: number;
  totalPnlSol: number;
}

const NAV_ITEMS: { view: View; label: string; abbr: string }[] = [
  { view: 'feed',        label: 'Live Feed',        abbr: 'FEED' },
  { view: 'performance', label: 'Performance',      abbr: 'PERF' },
  { view: 'pipeline',    label: 'Safety Pipeline',  abbr: 'PIPE' },
  { view: 'controls',    label: 'Controls',         abbr: 'CTRL' },
  { view: 'status',      label: 'System Status',    abbr: 'STAT' },
  { view: 'settings',    label: 'Settings',         abbr: 'CONF' },
];

export function Sidebar({ activeView, onNavigate }: SidebarProps) {
  const [stats, setStats]           = useState<Stats | null>(null);
  const [connected, setConnected]   = useState(true);
  const [lastTick, setLastTick]     = useState(Date.now());
  const [hoveredView, setHovered]   = useState<View | null>(null);
  const [healthStatus, setHealthStatus] = useState<'healthy' | 'degraded' | 'down'>('healthy');

  // Poll /api/stats + /api/health + paused state every 5 s
  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/stats');
        if (res.ok) {
          setStats(await res.json() as Stats);
          setConnected(true);
          setLastTick(Date.now());
        } else {
          setConnected(false);
        }
      } catch {
        setConnected(false);
      }

      // Health status for STAT nav dot (D-02)
      try {
        const healthRes = await fetch('/api/health');
        if (healthRes.ok) {
          const healthData = await healthRes.json() as { status: string };
          setHealthStatus(healthData.status as 'healthy' | 'degraded' | 'down');
        }
      } catch { /* ignore */ }
    };
    void load();
    void fetchPausedState();
    const id = setInterval(() => { void load(); void fetchPausedState(); }, 5000);
    return () => clearInterval(id);
  }, []);

  // Connection staleness check — mark disconnected if no successful poll in 15s
  useEffect(() => {
    const id = setInterval(() => {
      if (Date.now() - lastTick > 15_000) setConnected(false);
    }, 5000);
    return () => clearInterval(id);
  }, [lastTick]);

  const pnl      = stats?.totalPnlSol ?? 0;
  const pnlPos   = pnl >= 0;
  const pnlColor = pnlPos ? 'var(--green)' : 'var(--red)';
  const pnlSign  = pnlPos ? '+' : '';

  const isDryRun = Boolean(configSignal.value?.dryRun);

  // Connection bar state (D-04): priority: not connected -> NO SIGNAL, paused -> PAUSED, else -> CONNECTED
  const isPaused = pausedSignal.value;
  const connState = !connected ? 'disconnected' : isPaused ? 'paused' : 'connected';
  const connDotColor = connState === 'connected' ? 'var(--green)' : connState === 'paused' ? 'var(--yellow)' : 'var(--red)';
  const connLabel = connState === 'connected' ? 'CONNECTED' : connState === 'paused' ? 'PAUSED' : 'NO SIGNAL';
  const connLabelColor = connState === 'connected' ? 'var(--text-dim)' : connState === 'paused' ? 'var(--yellow)' : 'var(--red)';

  return (
    <aside style={SIDEBAR}>
      {/* ---- Brand ---- */}
      <div style={BRAND_AREA}>
        <div style={BRAND_MARK}>SS</div>
        <div>
          <div style={BRAND_NAME}>SOLSNIPER</div>
          <div style={BRAND_SUB}>v1.0 // MAINNET</div>
        </div>
      </div>

      {/* ---- DRY RUN indicator ---- */}
      {isDryRun && (
        <div style={DRY_RUN_BADGE}>
          <span style={DRY_RUN_DOT} />
          DRY RUN
        </div>
      )}

      {/* ---- Nav ---- */}
      <nav style={NAV_CONTAINER} aria-label="Main navigation">
        <div style={NAV_SECTION_LABEL}>NAVIGATION</div>
        {NAV_ITEMS.map(({ view, label, abbr }) => {
          const isActive  = activeView === view;
          const isHovered = hoveredView === view;
          return (
            <button
              key={view}
              onClick={() => onNavigate(view)}
              onMouseEnter={() => setHovered(view)}
              onMouseLeave={() => setHovered(null)}
              aria-current={isActive ? 'page' : undefined}
              style={{
                ...NAV_ITEM,
                background: isActive
                  ? 'var(--amber-glow)'
                  : isHovered
                  ? 'rgba(255,255,255,0.03)'
                  : 'transparent',
                color: isActive ? 'var(--text-bright)' : 'var(--gray)',
              }}
            >
              <span style={{
                ...NAV_ABBR,
                color: isActive
                  ? 'var(--amber)'
                  : isHovered
                  ? 'var(--text)'
                  : 'var(--text-dim)',
              }}>
                {abbr}
              </span>
              <span style={NAV_LABEL}>{label}</span>
              {/* Health dot next to STAT nav item (D-02) */}
              {view === 'status' && (
                <span style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: healthStatus === 'healthy' ? 'var(--green)' : healthStatus === 'degraded' ? 'var(--yellow)' : 'var(--red)',
                  flexShrink: '0',
                }} />
              )}
              {isActive && <span style={NAV_INDICATOR} />}
            </button>
          );
        })}
      </nav>

      {/* ---- Spacer ---- */}
      <div style={{ flex: '1' }} />

      {/* ---- Stats panel ---- */}
      <div style={STATS_PANEL}>
        <div style={STATS_HEADER}>SYSTEM READOUT</div>

        <div style={STAT_ROW}>
          <span style={STAT_KEY}>P&amp;L</span>
          <span style={{ ...STAT_VAL, color: pnlColor }}>
            {pnlSign}{pnl.toFixed(4)}&nbsp;<span style={{ fontSize: '10px', opacity: 0.7 }}>SOL</span>
          </span>
        </div>

        <div style={STAT_DIVIDER} />

        <div style={STAT_ROW}>
          <span style={STAT_KEY}>WIN RATE</span>
          <span style={{ ...STAT_VAL, color: 'var(--teal)' }}>
            {stats?.winRate != null ? `${stats.winRate}%` : '\u2014'}
          </span>
        </div>

        <div style={STAT_DIVIDER} />

        <div style={STAT_ROW}>
          <span style={STAT_KEY}>OPEN POS</span>
          <span style={{ ...STAT_VAL, color: 'var(--blue)' }}>
            {stats?.openPositions ?? '\u2014'}
          </span>
        </div>
      </div>

      {/* ---- E-Stop button (D-03) ---- */}
      <button
        onClick={() => { estopDialogOpen.value = true; }}
        style={ESTOP_BTN}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = '0 0 12px rgba(255, 68, 68, 0.4)'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = 'none'; }}
      >
        EMERGENCY STOP
      </button>

      {/* ---- Connection status (D-04: 3-state) ---- */}
      <div style={CONN_BAR}>
        <span style={{
          ...CONN_DOT,
          background: connDotColor,
          animation: connState === 'connected' ? 'pulse-dot 2s ease-in-out infinite' : 'none',
        }} />
        <span style={{ color: connLabelColor, fontSize: '10px', letterSpacing: '0.1em' }}>
          {connLabel}
        </span>
      </div>
    </aside>
  );
}

/* ---- Styles ---- */

const SIDEBAR: Record<string, string> = {
  display:        'flex',
  flexDirection:  'column',
  width:          'var(--sidebar-w)',
  minWidth:       'var(--sidebar-w)',
  height:         '100vh',
  background:     'var(--bg0)',
  borderRight:    '1px solid var(--border)',
  overflow:       'hidden',
  position:       'relative',
};

const BRAND_AREA: Record<string, string> = {
  display:      'flex',
  alignItems:   'center',
  gap:          'var(--sp-3)',
  padding:      'var(--sp-5) var(--sp-4) var(--sp-4)',
  borderBottom: '1px solid var(--border)',
};

const BRAND_MARK: Record<string, string> = {
  width:          '32px',
  height:         '32px',
  background:     'var(--amber)',
  color:          '#000',
  fontFamily:     'var(--font-display)',
  fontWeight:     '700',
  fontSize:       '14px',
  display:        'flex',
  alignItems:     'center',
  justifyContent: 'center',
  flexShrink:     '0',
  letterSpacing:  '0.05em',
};

const BRAND_NAME: Record<string, string> = {
  fontFamily:    'var(--font-display)',
  fontWeight:    '700',
  fontSize:      '16px',
  letterSpacing: '0.12em',
  color:         'var(--text-bright)',
  lineHeight:    '1',
};

const BRAND_SUB: Record<string, string> = {
  fontSize:      '9px',
  color:         'var(--text-dim)',
  letterSpacing: '0.15em',
  marginTop:     '3px',
};

const DRY_RUN_BADGE: Record<string, string> = {
  display:        'flex',
  alignItems:     'center',
  gap:            '6px',
  margin:         'var(--sp-2) var(--sp-4)',
  padding:        '4px var(--sp-3)',
  background:     'rgba(255, 204, 0, 0.1)',
  border:         '1px solid rgba(255, 204, 0, 0.35)',
  color:          'var(--yellow)',
  fontSize:       '10px',
  letterSpacing:  '0.15em',
  fontWeight:     'bold',
};

const DRY_RUN_DOT: Record<string, string> = {
  width:       '6px',
  height:      '6px',
  borderRadius: '50%',
  background:  'var(--yellow)',
  animation:   'pulse-dot 1.2s ease-in-out infinite',
  flexShrink:  '0',
};

const NAV_CONTAINER: Record<string, string> = {
  display:       'flex',
  flexDirection: 'column',
  padding:       'var(--sp-4) 0 var(--sp-2)',
};

const NAV_SECTION_LABEL: Record<string, string> = {
  padding:       '0 var(--sp-4) var(--sp-2)',
  fontSize:      '9px',
  letterSpacing: '0.2em',
  color:         'var(--text-muted)',
};

const NAV_ITEM: Record<string, string> = {
  display:        'flex',
  alignItems:     'center',
  gap:            'var(--sp-3)',
  width:          '100%',
  padding:        'var(--sp-3) var(--sp-4)',
  border:         'none',
  cursor:         'pointer',
  textAlign:      'left',
  fontFamily:     'var(--font-mono)',
  fontSize:       '12px',
  transition:     'background var(--tx-fast), color var(--tx-fast)',
  position:       'relative',
};

const NAV_ABBR: Record<string, string> = {
  fontFamily:    'var(--font-display)',
  fontWeight:    '700',
  fontSize:      '11px',
  letterSpacing: '0.1em',
  minWidth:      '34px',
  transition:    'color var(--tx-fast)',
};

const NAV_LABEL: Record<string, string> = {
  flex: '1',
};

const NAV_INDICATOR: Record<string, string> = {
  position:     'absolute',
  right:        '0',
  top:          '25%',
  bottom:       '25%',
  width:        '2px',
  background:   'var(--amber)',
  borderRadius: '2px 0 0 2px',
};

const STATS_PANEL: Record<string, string> = {
  margin:        'var(--sp-2) var(--sp-3) 0',
  padding:       'var(--sp-3)',
  background:    'var(--bg3)',
  border:        '1px solid var(--border)',
  borderRadius:  'var(--r-sm)',
};

const STATS_HEADER: Record<string, string> = {
  fontSize:      '9px',
  letterSpacing: '0.2em',
  color:         'var(--text-muted)',
  marginBottom:  'var(--sp-3)',
};

const STAT_ROW: Record<string, string> = {
  display:        'flex',
  justifyContent: 'space-between',
  alignItems:     'baseline',
  padding:        '4px 0',
};

const STAT_KEY: Record<string, string> = {
  fontSize:      '10px',
  letterSpacing: '0.12em',
  color:         'var(--text-dim)',
};

const STAT_VAL: Record<string, string> = {
  fontFamily: 'var(--font-mono)',
  fontSize:   '13px',
  fontWeight: 'bold',
};

const STAT_DIVIDER: Record<string, string> = {
  height:     '1px',
  background: 'var(--border-subtle)',
  margin:     '2px 0',
};

const ESTOP_BTN: Record<string, string> = {
  background:    'var(--red)',
  color:         '#000',
  fontFamily:    'var(--font-display)',
  fontSize:      '13px',
  fontWeight:    '700',
  letterSpacing: '0.15em',
  padding:       '8px var(--sp-4)',
  width:         'calc(100% - 2 * var(--sp-3))',
  margin:        '0 var(--sp-3) var(--sp-3)',
  border:        'none',
  borderRadius:  'var(--r-sm)',
  cursor:        'pointer',
  minHeight:     '44px',
  textAlign:     'center',
};

const CONN_BAR: Record<string, string> = {
  display:     'flex',
  alignItems:  'center',
  gap:         '6px',
  padding:     'var(--sp-3) var(--sp-4)',
  borderTop:   '1px solid var(--border)',
  marginTop:   'var(--sp-3)',
};

const CONN_DOT: Record<string, string> = {
  width:        '6px',
  height:       '6px',
  borderRadius: '50%',
  flexShrink:   '0',
};
