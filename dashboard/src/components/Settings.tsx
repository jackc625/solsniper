import { useEffect, useState } from 'preact/hooks';
import { configSignal, fetchConfig, saveConfig } from '../store/config.js';

const INPUT_STYLE: Record<string, string> = {
  background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)',
  padding: '0.25rem 0.5rem', fontFamily: 'var(--mono)', width: '120px',
};
const LABEL_STYLE: Record<string, string> = {
  color: 'var(--gray)', fontSize: '0.85rem', display: 'flex',
  justifyContent: 'space-between', alignItems: 'center',
  padding: '0.4rem 0', borderBottom: '1px solid var(--border)',
};

export function Settings() {
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    void fetchConfig();
  }, []);

  useEffect(() => {
    // Sync draft from signal when config loads
    setDraft(configSignal.value as Record<string, unknown>);
  }, [configSignal.value]);

  const set = (path: string[], value: unknown) => {
    setDraft((prev) => {
      const next = { ...prev };
      let obj: Record<string, unknown> = next;
      for (let i = 0; i < path.length - 1; i++) {
        const key = path[i]!;
        obj[key] = { ...(obj[key] as Record<string, unknown>) };
        obj = obj[key] as Record<string, unknown>;
      }
      obj[path[path.length - 1]!] = value;
      return next;
    });
  };

  const handleSave = async () => {
    setStatus('saving');
    // Build patch: only include fields the dashboard can change
    const patch = {
      dryRun:                 Boolean(draft['dryRun']),
      minSafetyScore:         Number(draft['minSafetyScore'] ?? 0),
      buyAmountSol:           Number(draft['buyAmountSol'] ?? 0),
      maxConcurrentPositions: Number(draft['maxConcurrentPositions'] ?? 1),
      maxSlippageBps:         Number(draft['maxSlippageBps'] ?? 500),
      positionManagement: {
        stopLossPct:     Number((draft['positionManagement'] as Record<string, unknown>)?.['stopLossPct'] ?? -50),
        trailingStopPct: Number((draft['positionManagement'] as Record<string, unknown>)?.['trailingStopPct'] ?? 0),
      },
    };
    const result = await saveConfig(patch);
    if (result.ok) {
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 2000);
    } else {
      setStatus('error');
      setErrorMsg(result.error ?? 'Unknown error');
    }
  };

  const pm = (draft['positionManagement'] as Record<string, unknown>) ?? {};

  return (
    <div style={{ padding: '1.5rem', maxWidth: '600px' }}>
      <h2 style={{ fontSize: '1rem', marginBottom: '1rem' }}>Runtime Settings</h2>
      <p style={{ color: 'var(--gray)', fontSize: '0.8rem', marginBottom: '1rem' }}>
        Changes are in-memory only — restart reverts to config file values.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ color: 'var(--yellow)', fontSize: '0.9rem', marginBottom: '0.5rem' }}>Mode</h3>
        <label style={{
          ...LABEL_STYLE,
          cursor: 'pointer',
        }}>
          Dry Run Mode
          <input type="checkbox"
            checked={Boolean(draft['dryRun'])}
            onChange={(e) => set(['dryRun'], (e.target as HTMLInputElement).checked)}
            style={{ width: 'auto', cursor: 'pointer' }}
          />
        </label>
        <p style={{ color: 'var(--gray)', fontSize: '0.75rem', margin: '0.25rem 0 0 0' }}>
          When enabled, bot runs full pipeline but does not sign or broadcast transactions.
        </p>
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ color: 'var(--blue)', fontSize: '0.9rem', marginBottom: '0.5rem' }}>Safety</h3>
        <label style={LABEL_STYLE}>Min Safety Score (0-100)
          <input style={INPUT_STYLE} type="number" min="0" max="100"
            value={String(draft['minSafetyScore'] ?? '')}
            onChange={(e) => set(['minSafetyScore'], (e.target as HTMLInputElement).value)} />
        </label>
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ color: 'var(--blue)', fontSize: '0.9rem', marginBottom: '0.5rem' }}>Execution</h3>
        <label style={LABEL_STYLE}>Buy Amount (SOL)
          <input style={INPUT_STYLE} type="number" min="0.001" max="10" step="0.001"
            value={String(draft['buyAmountSol'] ?? '')}
            onChange={(e) => set(['buyAmountSol'], (e.target as HTMLInputElement).value)} />
        </label>
        <label style={LABEL_STYLE}>Max Slippage (bps)
          <input style={INPUT_STYLE} type="number" min="50" max="4900" step="50"
            value={String(draft['maxSlippageBps'] ?? '')}
            onChange={(e) => set(['maxSlippageBps'], (e.target as HTMLInputElement).value)} />
        </label>
        <label style={LABEL_STYLE}>Max Concurrent Positions
          <input style={INPUT_STYLE} type="number" min="1" max="50"
            value={String(draft['maxConcurrentPositions'] ?? '')}
            onChange={(e) => set(['maxConcurrentPositions'], (e.target as HTMLInputElement).value)} />
        </label>
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ color: 'var(--blue)', fontSize: '0.9rem', marginBottom: '0.5rem' }}>Position Management</h3>
        <label style={LABEL_STYLE}>Stop-Loss % (negative, e.g. -50)
          <input style={INPUT_STYLE} type="number" max="0" step="1"
            value={String(pm['stopLossPct'] ?? '')}
            onChange={(e) => set(['positionManagement', 'stopLossPct'], (e.target as HTMLInputElement).value)} />
        </label>
        <label style={LABEL_STYLE}>Trailing Stop % (0 = disabled)
          <input style={INPUT_STYLE} type="number" min="0" max="100" step="1"
            value={String(pm['trailingStopPct'] ?? '')}
            onChange={(e) => set(['positionManagement', 'trailingStopPct'], (e.target as HTMLInputElement).value)} />
        </label>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <button
          onClick={() => void handleSave()}
          disabled={status === 'saving'}
          style={{ background: 'var(--green)', color: '#000', border: 'none', padding: '0.5rem 1.5rem', cursor: 'pointer', fontFamily: 'var(--mono)', fontWeight: 'bold' }}
        >
          {status === 'saving' ? 'Saving...' : 'Save'}
        </button>
        {status === 'saved' && <span style={{ color: 'var(--green)' }}>Saved.</span>}
        {status === 'error' && <span style={{ color: 'var(--red)' }}>Error: {errorMsg}</span>}
      </div>
    </div>
  );
}
