import { useEffect, useState } from 'preact/hooks';
import { configSignal } from '../store/config.js';

interface Stats {
  openPositions: number;
  winRate: number;
  totalPnlSol: number;
}

const HEADER_STYLE: Record<string, string> = {
  display: 'flex', alignItems: 'center', gap: '2rem',
  padding: '0.75rem 1.5rem', background: 'var(--bg2)',
  borderBottom: '1px solid var(--border)',
};

export function Header() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/stats');
        if (res.ok) setStats(await res.json() as Stats);
      } catch { /* ignore */ }
    };
    void load();
    const id = setInterval(() => void load(), 5000);
    return () => clearInterval(id);
  }, []);

  const pnl = stats?.totalPnlSol ?? 0;
  const pnlColor = pnl >= 0 ? 'var(--green)' : 'var(--red)';
  const pnlSign = pnl >= 0 ? '+' : '';

  const isDryRun = Boolean(configSignal.value?.dryRun);

  return (
    <div>
      <header style={HEADER_STYLE}>
        <span style={{ fontWeight: 'bold', fontSize: '1.1rem', letterSpacing: '0.1em' }}>
          SOLSNIPER
        </span>
        <span>
          P&amp;L:{' '}
          <span style={{ color: pnlColor, fontWeight: 'bold' }}>
            {pnlSign}{pnl.toFixed(4)} SOL
          </span>
        </span>
        <span>
          Win Rate:{' '}
          <span style={{ color: 'var(--green)' }}>
            {stats?.winRate ?? '—'}%
          </span>
        </span>
        <span>
          Open:{' '}
          <span style={{ color: 'var(--blue)' }}>
            {stats?.openPositions ?? '—'}
          </span>
        </span>
      </header>
      {isDryRun && (
        <div style={{
          background: 'var(--yellow)',
          color: '#000',
          textAlign: 'center',
          padding: '0.4rem',
          fontFamily: 'var(--mono)',
          fontWeight: 'bold',
          letterSpacing: '0.1em',
        }}>
          DRY RUN MODE — No real SOL at risk
        </div>
      )}
    </div>
  );
}
