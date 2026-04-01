export function SystemStatus() {
  return (
    <div style={PAGE}>
      <div style={PAGE_HEADER}>
        <span style={PAGE_TITLE}>SYSTEM STATUS</span>
        <span style={PAGE_SUB}>Infrastructure health and monitoring</span>
      </div>
      <div style={EMPTY_STATE}>System status loading...</div>
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

const EMPTY_STATE: Record<string, string> = {
  display:        'flex',
  alignItems:     'center',
  justifyContent: 'center',
  flex:           '1',
  padding:        'var(--sp-6)',
  color:          'var(--gray)',
  fontSize:       '13px',
};
