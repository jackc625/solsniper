import { useEffect, useState } from 'preact/hooks';

interface TradeRow {
  id: number;
  mint: string;
  state: string;
  amountSol?: number;
  amountTokens?: number;
  buyPriceSol?: number;
  entryPriceSol?: number;
  stopLossTarget?: number;
  takeProfitTarget?: number;
}

const TH: Record<string, string> = {
  padding: '0.5rem 1rem', textAlign: 'left', borderBottom: '1px solid var(--border)',
  color: 'var(--gray)', fontWeight: 'normal',
};
const TD: Record<string, string> = {
  padding: '0.4rem 1rem', borderBottom: '1px solid var(--border)',
};

export function Performance() {
  const [trades, setTrades] = useState<TradeRow[]>([]);

  const load = async () => {
    try {
      const res = await fetch('/api/trades');
      if (res.ok) setTrades(await res.json() as TradeRow[]);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 5000);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{ padding: '1rem', overflowX: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1rem' }}>Active Positions</h2>
        <button onClick={() => void load()} style={{ background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--border)', padding: '0.25rem 0.75rem', cursor: 'pointer' }}>
          Refresh
        </button>
      </div>
      {trades.length === 0 ? (
        <p style={{ color: 'var(--gray)' }}>No active positions.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead>
            <tr>
              <th style={TH}>Mint</th>
              <th style={TH}>State</th>
              <th style={TH}>Entry (SOL)</th>
              <th style={TH}>Amount</th>
              <th style={TH}>Stop-Loss</th>
              <th style={TH}>Take-Profit</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((t) => (
              <tr key={t.id}>
                <td style={TD} title={t.mint}>{t.mint.slice(0, 8)}...</td>
                <td style={TD}>{t.state}</td>
                <td style={TD}>{t.entryPriceSol?.toFixed(6) ?? '—'}</td>
                <td style={TD}>{t.amountSol?.toFixed(4) ?? '—'} SOL</td>
                <td style={{ ...TD, color: 'var(--red)' }}>{t.stopLossTarget?.toFixed(6) ?? '—'}</td>
                <td style={{ ...TD, color: 'var(--green)' }}>{t.takeProfitTarget?.toFixed(6) ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
