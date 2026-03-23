import { useEffect, useState } from 'preact/hooks';
import { configSignal, fetchConfig, saveConfig } from '../store/config.js';

export function Settings() {
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    void fetchConfig();
  }, []);

  useEffect(() => {
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
    const patch = {
      dryRun:                 Boolean(draft['dryRun']),
      minSafetyScore:         Number(draft['minSafetyScore'] ?? 0),
      buyAmountSol:           Number(draft['buyAmountSol'] ?? 0),
      maxConcurrentPositions: Number(draft['maxConcurrentPositions'] ?? 1),
      maxSlippageBps:         Number(draft['maxSlippageBps'] ?? 500),
      positionManagement: {
        stopLossPct:     Number((draft['positionManagement'] as Record<string, unknown>)?.['stopLossPct'] ?? -50),
        trailingStopPct: Number((draft['positionManagement'] as Record<string, unknown>)?.['trailingStopPct'] ?? 0),
        pollIntervalMs:  Number((draft['positionManagement'] as Record<string, unknown>)?.['pollIntervalMs'] ?? 5000),
      },
      execution: {
        buy: {
          slippageBps: Number(((draft['execution'] as Record<string, unknown>)?.['buy'] as Record<string, unknown>)?.['slippageBps'] ?? 1000),
        },
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
  const exec = (draft['execution'] as Record<string, unknown>) ?? {};
  const execBuy = (exec['buy'] as Record<string, unknown>) ?? {};

  return (
    <div style={PAGE}>
      <div style={PAGE_HEADER}>
        <span style={PAGE_TITLE}>CONFIGURATION</span>
        <span style={PAGE_SUB}>Runtime settings — changes revert on restart</span>
      </div>

      <div style={GRID}>

        {/* ---- Mode ---- */}
        <section style={CARD}>
          <div style={CARD_HEADER}>
            <span style={CARD_LABEL}>MODE</span>
            <span style={{ ...STATUS_PILL, background: Boolean(draft['dryRun']) ? 'rgba(255,204,0,0.12)' : 'rgba(0,212,170,0.1)', color: Boolean(draft['dryRun']) ? 'var(--yellow)' : 'var(--teal)' }}>
              {Boolean(draft['dryRun']) ? 'DRY RUN' : 'LIVE'}
            </span>
          </div>
          <label style={TOGGLE_ROW}>
            <div>
              <div style={FIELD_NAME}>Dry Run Mode</div>
              <div style={FIELD_DESC}>Bot runs full pipeline but does not sign or broadcast transactions.</div>
            </div>
            <div style={TOGGLE_WRAP}>
              <input
                type="checkbox"
                id="dryRun"
                checked={Boolean(draft['dryRun'])}
                onChange={(e) => set(['dryRun'], (e.target as HTMLInputElement).checked)}
                style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }}
              />
              <label
                htmlFor="dryRun"
                style={{
                  ...TOGGLE_TRACK,
                  background: Boolean(draft['dryRun']) ? 'var(--yellow)' : 'var(--bg4)',
                  borderColor: Boolean(draft['dryRun']) ? 'var(--yellow)' : 'var(--border-strong)',
                }}
              >
                <span style={{
                  ...TOGGLE_THUMB,
                  transform: Boolean(draft['dryRun']) ? 'translateX(18px)' : 'translateX(2px)',
                  background: Boolean(draft['dryRun']) ? '#000' : 'var(--text-dim)',
                }} />
              </label>
            </div>
          </label>
        </section>

        {/* ---- Safety ---- */}
        <section style={CARD}>
          <div style={CARD_HEADER}>
            <span style={CARD_LABEL}>SAFETY</span>
          </div>
          <FieldRow
            label="Min Safety Score"
            desc="Tokens below this score are rejected (0–100)"
          >
            <input
              style={INPUT}
              type="number"
              min="0"
              max="100"
              value={String(draft['minSafetyScore'] ?? '')}
              onChange={(e) => set(['minSafetyScore'], (e.target as HTMLInputElement).value)}
            />
          </FieldRow>
        </section>

        {/* ---- Execution ---- */}
        <section style={CARD}>
          <div style={CARD_HEADER}>
            <span style={CARD_LABEL}>EXECUTION</span>
          </div>
          <FieldRow label="Buy Amount" desc="SOL per trade">
            <input
              style={INPUT}
              type="number"
              min="0.001"
              max="10"
              step="0.001"
              value={String(draft['buyAmountSol'] ?? '')}
              onChange={(e) => set(['buyAmountSol'], (e.target as HTMLInputElement).value)}
            />
          </FieldRow>
          <FieldRow label="Max Slippage" desc="Basis points (100 bps = 1%)">
            <input
              style={INPUT}
              type="number"
              min="50"
              max="4900"
              step="50"
              value={String(draft['maxSlippageBps'] ?? '')}
              onChange={(e) => set(['maxSlippageBps'], (e.target as HTMLInputElement).value)}
            />
          </FieldRow>
          <FieldRow label="Max Concurrent Positions" desc="Open positions cap">
            <input
              style={INPUT}
              type="number"
              min="1"
              max="50"
              value={String(draft['maxConcurrentPositions'] ?? '')}
              onChange={(e) => set(['maxConcurrentPositions'], (e.target as HTMLInputElement).value)}
            />
          </FieldRow>
          <FieldRow label="Buy Slippage" desc="Basis points for buy transactions (100 = 1%)">
            <input
              style={INPUT}
              type="number"
              min="50"
              max="4900"
              step="50"
              value={String(execBuy['slippageBps'] ?? '')}
              onChange={(e) => set(['execution', 'buy', 'slippageBps'], (e.target as HTMLInputElement).value)}
            />
          </FieldRow>
        </section>

        {/* ---- Position Management ---- */}
        <section style={CARD}>
          <div style={CARD_HEADER}>
            <span style={CARD_LABEL}>POSITION MANAGEMENT</span>
          </div>
          <FieldRow label="Stop-Loss %" desc="Negative value triggers exit (e.g. -50 = -50%)">
            <input
              style={INPUT}
              type="number"
              max="0"
              step="1"
              value={String(pm['stopLossPct'] ?? '')}
              onChange={(e) => set(['positionManagement', 'stopLossPct'], (e.target as HTMLInputElement).value)}
            />
          </FieldRow>
          <FieldRow label="Trailing Stop %" desc="0 disables trailing stop">
            <input
              style={INPUT}
              type="number"
              min="0"
              max="100"
              step="1"
              value={String(pm['trailingStopPct'] ?? '')}
              onChange={(e) => set(['positionManagement', 'trailingStopPct'], (e.target as HTMLInputElement).value)}
            />
          </FieldRow>
          <FieldRow label="Poll Interval (ms)" desc="Price check interval in milliseconds">
            <input
              style={INPUT}
              type="number"
              min="1000"
              max="60000"
              step="1000"
              value={String(pm['pollIntervalMs'] ?? '')}
              onChange={(e) => set(['positionManagement', 'pollIntervalMs'], (e.target as HTMLInputElement).value)}
            />
          </FieldRow>
        </section>

      </div>

      {/* ---- Save bar ---- */}
      <div style={SAVE_BAR}>
        <button
          onClick={() => void handleSave()}
          disabled={status === 'saving'}
          style={{
            ...SAVE_BTN,
            opacity: status === 'saving' ? 0.6 : 1,
            cursor: status === 'saving' ? 'not-allowed' : 'pointer',
          }}
        >
          {status === 'saving' ? 'WRITING...' : 'APPLY CHANGES'}
        </button>
        {status === 'saved' && (
          <span style={{ color: 'var(--teal)', fontSize: '11px', letterSpacing: '0.1em', animation: 'fade-in 200ms ease' }}>
            SAVED &#10003;
          </span>
        )}
        {status === 'error' && (
          <span style={{ color: 'var(--red)', fontSize: '11px', letterSpacing: '0.08em' }}>
            ERR: {errorMsg}
          </span>
        )}
      </div>
    </div>
  );
}

/* ---- Sub-component ---- */
function FieldRow({ label, desc, children }: { label: string; desc: string; children: preact.ComponentChildren }) {
  return (
    <div style={FIELD_ROW}>
      <div style={FIELD_META}>
        <div style={FIELD_NAME}>{label}</div>
        <div style={FIELD_DESC}>{desc}</div>
      </div>
      <div style={FIELD_INPUT}>{children}</div>
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
  fontSize:      '11px',
  color:         'var(--text-dim)',
  letterSpacing: '0.05em',
};

const GRID: Record<string, string> = {
  display:             'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
  gap:                 'var(--sp-4)',
  padding:             'var(--sp-6)',
  overflowY:           'auto',
  flex:                '1',
};

const CARD: Record<string, string> = {
  background:   'var(--bg2)',
  border:       '1px solid var(--border)',
  borderRadius: 'var(--r-md)',
  padding:      'var(--sp-4)',
};

const CARD_HEADER: Record<string, string> = {
  display:       'flex',
  justifyContent: 'space-between',
  alignItems:    'center',
  marginBottom:  'var(--sp-4)',
  paddingBottom: 'var(--sp-3)',
  borderBottom:  '1px solid var(--border)',
};

const CARD_LABEL: Record<string, string> = {
  fontFamily:    'var(--font-display)',
  fontWeight:    '700',
  fontSize:      '13px',
  letterSpacing: '0.15em',
  color:         'var(--amber)',
};

const STATUS_PILL: Record<string, string> = {
  fontSize:      '9px',
  letterSpacing: '0.15em',
  padding:       '2px 8px',
  border:        '1px solid currentColor',
};

const FIELD_ROW: Record<string, string> = {
  display:        'flex',
  justifyContent: 'space-between',
  alignItems:     'center',
  gap:            'var(--sp-4)',
  padding:        'var(--sp-3) 0',
  borderBottom:   '1px solid var(--border-subtle)',
};

const FIELD_META: Record<string, string> = {
  flex: '1',
};

const FIELD_NAME: Record<string, string> = {
  fontSize:    '12px',
  color:       'var(--text)',
  marginBottom: '2px',
};

const FIELD_DESC: Record<string, string> = {
  fontSize: '10px',
  color:    'var(--text-dim)',
};

const FIELD_INPUT: Record<string, string> = {
  flexShrink: '0',
};

const INPUT: Record<string, string> = {
  background:   'var(--bg4)',
  color:        'var(--amber)',
  border:       '1px solid var(--border-strong)',
  borderRadius: 'var(--r-sm)',
  padding:      '4px var(--sp-2)',
  fontFamily:   'var(--font-mono)',
  fontSize:     '13px',
  width:        '100px',
  textAlign:    'right',
  transition:   'border-color var(--tx-fast)',
};

const TOGGLE_ROW: Record<string, string> = {
  display:        'flex',
  justifyContent: 'space-between',
  alignItems:     'center',
  gap:            'var(--sp-4)',
  cursor:         'pointer',
};

const TOGGLE_WRAP: Record<string, string> = {
  flexShrink: '0',
  position:   'relative',
};

const TOGGLE_TRACK: Record<string, string> = {
  display:       'block',
  width:         '40px',
  height:        '22px',
  borderRadius:  '11px',
  border:        '1px solid',
  position:      'relative',
  cursor:        'pointer',
  transition:    'background var(--tx-med), border-color var(--tx-med)',
};

const TOGGLE_THUMB: Record<string, string> = {
  position:     'absolute',
  top:          '3px',
  width:        '14px',
  height:       '14px',
  borderRadius: '50%',
  transition:   'transform var(--tx-med), background var(--tx-med)',
  display:      'block',
};

const SAVE_BAR: Record<string, string> = {
  display:       'flex',
  alignItems:    'center',
  gap:           'var(--sp-4)',
  padding:       'var(--sp-4) var(--sp-6)',
  borderTop:     '1px solid var(--border)',
  flexShrink:    '0',
};

const SAVE_BTN: Record<string, string> = {
  fontFamily:    'var(--font-display)',
  fontWeight:    '700',
  fontSize:      '14px',
  letterSpacing: '0.12em',
  background:    'var(--amber)',
  color:         '#000',
  border:        'none',
  padding:       '8px var(--sp-6)',
  borderRadius:  'var(--r-sm)',
  transition:    'opacity var(--tx-fast)',
};
