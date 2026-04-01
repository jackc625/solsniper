import { useEffect, useState } from 'preact/hooks';
import { Sidebar } from './components/Sidebar.js';
import type { View } from './components/Sidebar.js';
import { LiveFeed } from './components/LiveFeed.js';
import { Performance } from './components/Performance.js';
import { Pipeline } from './components/Pipeline.js';
import { Controls } from './components/Controls.js';
import { SystemStatus } from './components/SystemStatus.js';
import { Settings } from './components/Settings.js';
import { configSignal, fetchConfig } from './store/config.js';
import { connectFeed } from './store/feed.js';
import { estopDialogOpen, triggerEmergencyStop } from './store/controls.js';

export function App() {
  const [view, setView] = useState<View>('feed');

  // SSE connection lives at App level so it persists across tab navigation
  useEffect(() => {
    const disconnect = connectFeed();
    void fetchConfig();
    return disconnect;
  }, []);

  const isDryRun = Boolean(configSignal.value?.dryRun);

  return (
    <div style={LAYOUT}>
      <Sidebar activeView={view} onNavigate={setView} />
      <div style={CONTENT_COL}>
        {/* DRY RUN banner — full-width, prominent in content area */}
        {isDryRun && (
          <div style={DRY_RUN_BANNER}>
            <span style={{ opacity: 0.6 }}>&#9670;</span>
            &nbsp;DRY RUN MODE — No real SOL at risk&nbsp;
            <span style={{ opacity: 0.6 }}>&#9670;</span>
          </div>
        )}
        <main style={MAIN}>
          {view === 'feed'        && <LiveFeed />}
          {view === 'performance' && <Performance />}
          {view === 'pipeline'    && <Pipeline />}
          {view === 'controls'    && <Controls />}
          {view === 'status'      && <SystemStatus />}
          {view === 'settings'    && <Settings />}
        </main>
        <EmergencyStopDialog />
      </div>
    </div>
  );
}

/* ---- Emergency Stop Confirmation Dialog (D-13) ---- */

function EmergencyStopDialog() {
  const [input, setInput] = useState('');
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState('');

  if (!estopDialogOpen.value) return null;

  const canConfirm = input === 'STOP';

  const handleConfirm = async () => {
    setExecuting(true);
    const result = await triggerEmergencyStop();
    if (!result.ok) {
      setError(result.error ?? 'Emergency stop failed -- manually check bot status');
      setExecuting(false);
    }
    // On success, triggerEmergencyStop closes the dialog via estopDialogOpen.value = false
  };

  const handleDismiss = () => {
    estopDialogOpen.value = false;
    setInput('');
    setError('');
  };

  return (
    <div style={OVERLAY} onClick={handleDismiss}>
      <div style={DIALOG} onClick={(e) => e.stopPropagation()}>
        <div style={DIALOG_TITLE}>CONFIRM EMERGENCY STOP</div>
        <div style={DIALOG_BODY}>
          This will pause all detection and force-sell every open position. Type STOP to confirm.
        </div>
        <input
          type="text"
          placeholder="Type STOP to confirm"
          value={input}
          onInput={(e) => setInput((e.target as HTMLInputElement).value)}
          style={DIALOG_INPUT}
          autoFocus
        />
        {error && <div style={DIALOG_ERROR}>{error}</div>}
        <div style={DIALOG_ACTIONS}>
          <button style={DISMISS_BTN} onClick={handleDismiss}>DISMISS</button>
          <button
            style={{ ...EXECUTE_BTN, opacity: canConfirm && !executing ? '1' : '0.3', cursor: canConfirm && !executing ? 'pointer' : 'not-allowed' }}
            disabled={!canConfirm || executing}
            onClick={() => void handleConfirm()}
          >
            {executing ? 'EXECUTING...' : 'EXECUTE STOP'}
          </button>
        </div>
      </div>
    </div>
  );
}

const LAYOUT: Record<string, string> = {
  display:             'grid',
  gridTemplateColumns: 'var(--sidebar-w) 1fr',
  height:              '100vh',
  overflow:            'hidden',
};

const CONTENT_COL: Record<string, string> = {
  display:       'flex',
  flexDirection: 'column',
  overflow:      'hidden',
  background:    'var(--bg)',
};

const DRY_RUN_BANNER: Record<string, string> = {
  background:    'rgba(255, 204, 0, 0.08)',
  borderBottom:  '1px solid rgba(255, 204, 0, 0.3)',
  color:         'var(--yellow)',
  textAlign:     'center',
  padding:       '6px var(--sp-4)',
  fontFamily:    'var(--font-display)',
  fontWeight:    '600',
  fontSize:      '12px',
  letterSpacing: '0.15em',
  flexShrink:    '0',
};

const MAIN: Record<string, string> = {
  flex:           '1',
  overflow:       'hidden',
  display:        'flex',
  flexDirection:  'column',
  animation:      'fade-in 180ms ease',
};

/* ---- Emergency Stop Dialog Styles ---- */

const OVERLAY: Record<string, string> = {
  position:       'fixed',
  inset:          '0',
  background:     'rgba(0, 0, 0, 0.8)',
  zIndex:         '1000',
  display:        'flex',
  alignItems:     'center',
  justifyContent: 'center',
};

const DIALOG: Record<string, string> = {
  maxWidth:      '420px',
  width:         '100%',
  background:    'var(--bg2)',
  border:        '2px solid var(--red)',
  padding:       'var(--sp-6)',
  borderRadius:  'var(--r-sm)',
};

const DIALOG_TITLE: Record<string, string> = {
  fontFamily:    'var(--font-display)',
  fontSize:      '20px',
  fontWeight:    '700',
  color:         'var(--red)',
  letterSpacing: '0.15em',
  marginBottom:  'var(--sp-4)',
};

const DIALOG_BODY: Record<string, string> = {
  fontSize:      '13px',
  color:         'var(--text)',
  lineHeight:    '1.5',
  marginBottom:  'var(--sp-4)',
};

const DIALOG_INPUT: Record<string, string> = {
  width:         '100%',
  border:        '1px solid var(--red)',
  background:    'var(--bg4)',
  color:         'var(--text)',
  padding:       'var(--sp-2) var(--sp-3)',
  fontFamily:    'var(--font-mono)',
  fontSize:      '13px',
  borderRadius:  'var(--r-sm)',
  marginBottom:  'var(--sp-4)',
};

const DIALOG_ERROR: Record<string, string> = {
  fontSize:      '10px',
  color:         'var(--red)',
  marginBottom:  'var(--sp-3)',
};

const DIALOG_ACTIONS: Record<string, string> = {
  display:       'flex',
  gap:           'var(--sp-3)',
  justifyContent: 'flex-end',
};

const DISMISS_BTN: Record<string, string> = {
  background:    'transparent',
  border:        '1px solid var(--border)',
  color:         'var(--text-dim)',
  padding:       '8px var(--sp-4)',
  fontFamily:    'var(--font-display)',
  fontWeight:    '700',
  fontSize:      '13px',
  letterSpacing: '0.1em',
  borderRadius:  'var(--r-sm)',
  cursor:        'pointer',
};

const EXECUTE_BTN: Record<string, string> = {
  background:    'var(--red)',
  color:         '#000',
  border:        'none',
  padding:       '8px var(--sp-4)',
  fontFamily:    'var(--font-display)',
  fontWeight:    '700',
  fontSize:      '13px',
  letterSpacing: '0.1em',
  borderRadius:  'var(--r-sm)',
};
