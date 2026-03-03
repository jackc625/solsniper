import { useEffect, useState } from 'preact/hooks';
import { PnlChart, type PnlDataPoint } from './PnlChart.js';

// ---- Types ----------------------------------------------------------------

interface ActiveTrade {
  id: number;
  mint: string;
  state: string;
  amountSol?: number;
  entryPriceSol?: number;
  stopLossTarget?: number;
  takeProfitTarget?: number;
}

interface HistoryTrade {
  id: number;
  mint: string;
  state: string;
  source: string | null;
  amount_sol: number | null;
  buy_price_sol: number | null;
  sell_price_sol: number | null;
  created_at: number;
  updated_at: number;
  dry_run: number | null;
  pnl_sol: number | null;
}

interface Stats {
  openPositions: number;
  activeSells: number;
  pendingBuys: number;
  totalTrades: number;
  completedTrades: number;
  failedTrades: number;
  winRate: number;
  totalPnlSol: number;
}

type SortField = 'updated_at' | 'pnl_sol' | 'duration' | 'source';
type SortDir = 'asc' | 'desc';

// ---- Helpers ---------------------------------------------------------------

const SOLSCAN_TOKEN = (mint: string) => `https://solscan.io/token/${mint}`;

function shortenMint(mint: string): string {
  return mint.length > 12 ? `${mint.slice(0, 8)}...` : mint;
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

function pnlColor(pnl: number | null): string {
  if (pnl === null) return 'var(--gray)';
  return pnl >= 0 ? 'var(--green)' : 'var(--red)';
}

function winRateColor(rate: number): string {
  if (rate >= 50) return 'var(--green)';
  if (rate >= 30) return 'var(--yellow)';
  return 'var(--red)';
}

function buildChartData(history: HistoryTrade[]): PnlDataPoint[] {
  const sorted = [...history]
    .filter(t => t.pnl_sol !== null)
    .sort((a, b) => a.updated_at - b.updated_at);

  let cumulative = 0;
  return sorted.map(t => {
    cumulative += t.pnl_sol ?? 0;
    return {
      time: Math.floor(t.updated_at / 1000), // ms -> seconds
      value: Math.round(cumulative * 1e8) / 1e8, // avoid floating point drift
    };
  });
}

// ---- Sub-components --------------------------------------------------------

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{
      background: 'var(--bg2)',
      border: '1px solid var(--border)',
      padding: '0.75rem 1rem',
      minWidth: '110px',
      flex: '1 1 110px',
    }}>
      <div style={{ fontSize: '0.65rem', color: 'var(--gray)', letterSpacing: '0.08em', marginBottom: '0.3rem' }}>
        {label}
      </div>
      <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: color || 'var(--text)' }}>
        {value}
      </div>
    </div>
  );
}

function WinRateGauge({ rate }: { rate: number }) {
  const color = winRateColor(rate);
  const pct = Math.min(100, Math.max(0, rate));
  return (
    <div style={{
      background: 'var(--bg2)',
      border: '1px solid var(--border)',
      padding: '0.75rem 1rem',
    }}>
      <div style={{ fontSize: '0.65rem', color: 'var(--gray)', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>
        WIN RATE
      </div>
      <div style={{ fontSize: '1.6rem', fontWeight: 'bold', color, marginBottom: '0.4rem' }}>
        {rate.toFixed(1)}%
      </div>
      <div style={{ background: 'var(--border)', height: '4px', borderRadius: '2px' }}>
        <div style={{
          width: `${pct}%`,
          height: '100%',
          background: color,
          borderRadius: '2px',
          transition: 'width 0.4s ease',
        }} />
      </div>
    </div>
  );
}

function SortArrow({ dir }: { dir: SortDir }) {
  return <span style={{ marginLeft: '0.25rem', opacity: 0.7 }}>{dir === 'asc' ? '↑' : '↓'}</span>;
}

function SourceBadge({ source }: { source: string | null }) {
  if (!source) return <span style={{ color: 'var(--gray)' }}>—</span>;
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
      padding: '0 0.3rem',
      fontSize: '0.75rem',
    }}>
      {source.toLowerCase()}
    </span>
  );
}

// ---- Main component --------------------------------------------------------

export function Performance() {
  const [stats, setStats]     = useState<Stats | null>(null);
  const [history, setHistory] = useState<HistoryTrade[]>([]);
  const [active, setActive]   = useState<ActiveTrade[]>([]);
  const [sortField, setSortField] = useState<SortField>('updated_at');
  const [sortDir, setSortDir]     = useState<SortDir>('desc');
  const [filter, setFilter]       = useState('');
  const [showActive, setShowActive] = useState(false);

  // ---- Data fetching -------------------------------------------------------

  const loadHistory = async () => {
    try {
      const res = await fetch('/api/trades/history');
      if (res.ok) setHistory(await res.json() as HistoryTrade[]);
    } catch { /* ignore */ }
  };

  const loadStats = async () => {
    try {
      const res = await fetch('/api/stats');
      if (res.ok) setStats(await res.json() as Stats);
    } catch { /* ignore */ }
  };

  const loadActive = async () => {
    try {
      const res = await fetch('/api/trades');
      if (res.ok) setActive(await res.json() as ActiveTrade[]);
    } catch { /* ignore */ }
  };

  const refreshAll = () => {
    void loadHistory();
    void loadStats();
    void loadActive();
  };

  useEffect(() => {
    refreshAll();
    const historyId = setInterval(() => void loadHistory(), 30000);
    const statsId   = setInterval(() => { void loadStats(); void loadActive(); }, 5000);
    return () => { clearInterval(historyId); clearInterval(statsId); };
  }, []);

  // ---- Derived data --------------------------------------------------------

  const chartData = buildChartData(history);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const filteredHistory = history
    .filter(t => !filter || t.mint.toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => {
      let cmp = 0;
      if (sortField === 'updated_at') {
        cmp = a.updated_at - b.updated_at;
      } else if (sortField === 'pnl_sol') {
        cmp = (a.pnl_sol ?? -Infinity) - (b.pnl_sol ?? -Infinity);
      } else if (sortField === 'duration') {
        const durA = a.updated_at - a.created_at;
        const durB = b.updated_at - b.created_at;
        cmp = durA - durB;
      } else if (sortField === 'source') {
        cmp = (a.source ?? '').localeCompare(b.source ?? '');
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

  // ---- Styles --------------------------------------------------------------

  const TH = (field: SortField): Record<string, string> => ({
    padding: '0.5rem 0.75rem',
    textAlign: 'left',
    borderBottom: '1px solid var(--border)',
    color: sortField === field ? 'var(--text)' : 'var(--gray)',
    fontWeight: 'normal',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    userSelect: 'none',
    background: 'var(--bg2)',
    position: 'sticky',
    top: '0',
  });

  const TD: Record<string, string> = {
    padding: '0.4rem 0.75rem',
    borderBottom: '1px solid var(--border)',
    fontSize: '0.82rem',
  };

  // ---- Render --------------------------------------------------------------

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: '0.9rem', letterSpacing: '0.1em', color: 'var(--gray)' }}>PERFORMANCE</h2>
        <button
          onClick={refreshAll}
          style={{ background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--border)', padding: '0.25rem 0.75rem', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '0.8rem' }}
        >
          Refresh
        </button>
      </div>

      {/* Stats row */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <StatCard
          label="TOTAL P&L"
          value={stats ? `${stats.totalPnlSol >= 0 ? '+' : ''}${stats.totalPnlSol.toFixed(4)} SOL` : '—'}
          color={stats ? pnlColor(stats.totalPnlSol) : undefined}
        />
        <WinRateGauge rate={stats?.winRate ?? 0} />
        <StatCard label="COMPLETED" value={stats?.completedTrades.toString() ?? '—'} />
        <StatCard label="FAILED" value={stats?.failedTrades.toString() ?? '—'} color="var(--red)" />
        <StatCard label="OPEN" value={stats?.openPositions.toString() ?? '—'} color="var(--blue)" />
      </div>

      {/* P&L Chart */}
      {chartData.length === 0 ? (
        <div style={{
          background: 'var(--bg2)',
          border: '1px solid var(--border)',
          height: '220px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--gray)',
          fontSize: '0.85rem',
          letterSpacing: '0.05em',
        }}>
          No completed trades yet — chart will appear here
        </div>
      ) : (
        <PnlChart data={chartData} />
      )}

      {/* Trade History Table */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
          <h3 style={{ fontSize: '0.8rem', letterSpacing: '0.1em', color: 'var(--gray)' }}>
            TRADE HISTORY
            {filteredHistory.length > 0 && (
              <span style={{ marginLeft: '0.5rem', color: 'var(--gray)', fontWeight: 'normal' }}>
                ({filteredHistory.length})
              </span>
            )}
          </h3>
          <input
            type="text"
            placeholder="filter by mint..."
            value={filter}
            onInput={(e) => setFilter((e.target as HTMLInputElement).value)}
            style={{
              background: 'var(--bg2)',
              border: '1px solid var(--border)',
              color: 'var(--text)',
              padding: '0.2rem 0.5rem',
              fontFamily: 'var(--mono)',
              fontSize: '0.8rem',
              width: '200px',
            }}
          />
        </div>

        {filteredHistory.length === 0 ? (
          <div style={{
            background: 'var(--bg2)',
            border: '1px solid var(--border)',
            padding: '2rem',
            textAlign: 'center',
            color: 'var(--gray)',
            fontSize: '0.85rem',
          }}>
            {history.length === 0 ? 'No completed trades yet.' : 'No trades match filter.'}
          </div>
        ) : (
          <div style={{ overflowX: 'auto', border: '1px solid var(--border)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr>
                  <th style={{ ...TH('updated_at'), cursor: 'default' }}>Mint</th>
                  <th style={TH('source')} onClick={() => handleSort('source')}>
                    Source{sortField === 'source' && <SortArrow dir={sortDir} />}
                  </th>
                  <th style={{ ...TH('updated_at'), cursor: 'default' }}>Entry SOL</th>
                  <th style={{ ...TH('updated_at'), cursor: 'default' }}>Exit SOL</th>
                  <th style={TH('duration')} onClick={() => handleSort('duration')}>
                    Duration{sortField === 'duration' && <SortArrow dir={sortDir} />}
                  </th>
                  <th style={TH('pnl_sol')} onClick={() => handleSort('pnl_sol')}>
                    P&amp;L SOL{sortField === 'pnl_sol' && <SortArrow dir={sortDir} />}
                  </th>
                  <th style={TH('updated_at')} onClick={() => handleSort('updated_at')}>
                    Closed{sortField === 'updated_at' && <SortArrow dir={sortDir} />}
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredHistory.map((t, i) => {
                  const duration = t.updated_at - t.created_at;
                  const rowBg = i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)';
                  return (
                    <tr
                      key={t.id}
                      style={{ background: rowBg, transition: 'background 0.1s' }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = rowBg; }}
                    >
                      <td style={TD}>
                        <a
                          href={SOLSCAN_TOKEN(t.mint)}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={t.mint}
                          style={{ color: 'var(--blue)' }}
                        >
                          {shortenMint(t.mint)}
                        </a>
                      </td>
                      <td style={TD}><SourceBadge source={t.source} /></td>
                      <td style={TD}>{t.buy_price_sol != null ? t.buy_price_sol.toFixed(6) : '—'}</td>
                      <td style={TD}>{t.sell_price_sol != null ? t.sell_price_sol.toFixed(6) : '—'}</td>
                      <td style={{ ...TD, color: 'var(--gray)' }}>{formatDuration(duration)}</td>
                      <td style={{ ...TD, color: pnlColor(t.pnl_sol), fontWeight: 'bold' }}>
                        {t.pnl_sol != null
                          ? `${t.pnl_sol >= 0 ? '+' : ''}${t.pnl_sol.toFixed(4)}`
                          : '—'}
                      </td>
                      <td style={{ ...TD, color: 'var(--gray)' }}>
                        {new Date(t.updated_at).toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Active Positions (toggle) */}
      <div>
        <button
          onClick={() => setShowActive(v => !v)}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--gray)',
            cursor: 'pointer',
            fontFamily: 'var(--mono)',
            fontSize: '0.8rem',
            letterSpacing: '0.1em',
            padding: 0,
            marginBottom: showActive ? '0.5rem' : 0,
          }}
        >
          {showActive ? '▼' : '▶'} ACTIVE POSITIONS ({active.length})
        </button>

        {showActive && (
          active.length === 0 ? (
            <div style={{
              background: 'var(--bg2)',
              border: '1px solid var(--border)',
              padding: '1rem',
              textAlign: 'center',
              color: 'var(--gray)',
              fontSize: '0.85rem',
            }}>
              No active positions.
            </div>
          ) : (
            <div style={{ overflowX: 'auto', border: '1px solid var(--border)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr>
                    {['Mint', 'State', 'Entry SOL', 'Amount', 'Stop-Loss', 'Take-Profit'].map(h => (
                      <th key={h} style={{
                        padding: '0.5rem 0.75rem',
                        textAlign: 'left',
                        borderBottom: '1px solid var(--border)',
                        color: 'var(--gray)',
                        fontWeight: 'normal',
                        background: 'var(--bg2)',
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {active.map(t => (
                    <tr key={t.id}>
                      <td style={TD} title={t.mint}>{shortenMint(t.mint)}</td>
                      <td style={TD}>{t.state}</td>
                      <td style={TD}>{t.entryPriceSol?.toFixed(6) ?? '—'}</td>
                      <td style={TD}>{t.amountSol?.toFixed(4) ?? '—'} SOL</td>
                      <td style={{ ...TD, color: 'var(--red)' }}>{t.stopLossTarget?.toFixed(6) ?? '—'}</td>
                      <td style={{ ...TD, color: 'var(--green)' }}>{t.takeProfitTarget?.toFixed(6) ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
    </div>
  );
}
