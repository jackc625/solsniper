import { useState } from 'preact/hooks';
import { Sidebar } from './components/Sidebar.js';
import type { View } from './components/Sidebar.js';
import { LiveFeed } from './components/LiveFeed.js';
import { Performance } from './components/Performance.js';
import { Settings } from './components/Settings.js';
import { configSignal } from './store/config.js';

export function App() {
  const [view, setView] = useState<View>('feed');

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
          {view === 'settings'    && <Settings />}
        </main>
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
