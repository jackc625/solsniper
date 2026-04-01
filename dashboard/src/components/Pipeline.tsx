export function Pipeline() {
  return (
    <div style={PAGE}>
      <div style={PAGE_HEADER}>
        <span style={PAGE_TITLE}>SAFETY PIPELINE</span>
        <span style={PAGE_SUB}>Live safety evaluation stream</span>
      </div>
      <div style={EMPTY_STATE}>
        <div style={EMPTY_HEADING}>Waiting for evaluations</div>
        <div style={EMPTY_BODY}>Safety pipeline evaluations will appear here in real-time as tokens are detected.</div>
      </div>
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
  flexDirection:  'column',
  alignItems:     'center',
  justifyContent: 'center',
  flex:           '1',
  padding:        'var(--sp-6)',
  color:          'var(--gray)',
  textAlign:      'center',
};

const EMPTY_HEADING: Record<string, string> = {
  fontFamily:    'var(--font-display)',
  fontWeight:    '700',
  fontSize:      '16px',
  letterSpacing: '0.1em',
  marginBottom:  'var(--sp-3)',
};

const EMPTY_BODY: Record<string, string> = {
  fontSize:      '13px',
  lineHeight:    '1.5',
  maxWidth:      '360px',
};
