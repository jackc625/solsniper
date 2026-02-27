import { useState } from 'preact/hooks';
import { Header } from './components/Header.js';
import { LiveFeed } from './components/LiveFeed.js';
import { Performance } from './components/Performance.js';
import { Settings } from './components/Settings.js';

type Tab = 'feed' | 'performance' | 'settings';

const TAB_STYLE = (active: boolean): Record<string, string> => ({
  padding: '0.5rem 1.25rem', cursor: 'pointer',
  background: active ? 'var(--bg)' : 'var(--bg2)',
  color: active ? 'var(--green)' : 'var(--gray)',
  border: 'none', borderBottom: active ? '2px solid var(--green)' : '2px solid transparent',
  fontFamily: 'var(--mono)', fontSize: '0.9rem',
});

export function App() {
  const [tab, setTab] = useState<Tab>('feed');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <Header />
      <nav style={{ display: 'flex', background: 'var(--bg2)', borderBottom: '1px solid var(--border)' }}>
        <button style={TAB_STYLE(tab === 'feed')}        onClick={() => setTab('feed')}>Live Feed</button>
        <button style={TAB_STYLE(tab === 'performance')} onClick={() => setTab('performance')}>Performance</button>
        <button style={TAB_STYLE(tab === 'settings')}    onClick={() => setTab('settings')}>Settings</button>
      </nav>
      <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {tab === 'feed'        && <LiveFeed />}
        {tab === 'performance' && <Performance />}
        {tab === 'settings'    && <Settings />}
      </main>
    </div>
  );
}
