import { useEffect, useState } from 'preact/hooks';

// ---- Types ------------------------------------------------------------------

type ComponentStatus = 'healthy' | 'degraded' | 'down';

interface HealthData {
  status: ComponentStatus;
  components: Record<string, { status: ComponentStatus; detail?: string }>;
  uptime: number;
  version: string;
  timestamp: number;
}

interface EndpointStats {
  count: number;
  errorRate: number;
  p50: number;
  p99: number;
}

interface MetricsResponse {
  endpoints: Record<string, EndpointStats>;
  windowMs: number;
}

interface AlertRecord {
  id: number;
  timestamp: number;
  type: string;
  severity: string;
  source: string;
  message: string;
}

interface AlertsResponse {
  alerts: AlertRecord[];
  total: number;
  page: number;
  limit: number;
}

// ---- Helpers ----------------------------------------------------------------

const STATUS_DOT_COLORS: Record<ComponentStatus, string> = {
  healthy:  'var(--green)',
  degraded: 'var(--yellow)',
  down:     'var(--red)',
};

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString();
}

function errorRateColor(rate: number): string {
  if (rate > 0.10) return 'var(--red)';
  if (rate > 0.05) return 'var(--yellow)';
  return 'var(--text)';
}

function alertBadgeStyle(type: string): Record<string, string> {
  if (type === 'rate_limit') {
    return { ...ALERT_TYPE_BADGE, background: 'rgba(255, 204, 0, 0.15)', color: 'var(--yellow)' };
  }
  // consecutive_failure and any other type
  return { ...ALERT_TYPE_BADGE, background: 'rgba(255, 68, 68, 0.15)', color: 'var(--red)' };
}

function alertBadgeLabel(type: string): string {
  if (type === 'rate_limit') return 'RATE LIMIT';
  return 'FAILURE';
}

// ---- Component --------------------------------------------------------------

export function SystemStatus() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [alerts, setAlerts] = useState<AlertRecord[]>([]);
  const [alertsTotal, setAlertsTotal] = useState(0);
  const [alertsPage, setAlertsPage] = useState(1);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [allAlertsLoaded, setAllAlertsLoaded] = useState(false);
  const [healthError, setHealthError] = useState('');
  const [metricsError, setMetricsError] = useState('');
  const [alertsError, setAlertsError] = useState('');

  const ALERT_PAGE_SIZE = 50;

  // ---- Data fetching with polling -------------------------------------------

  useEffect(() => {
    const loadHealth = async () => {
      try {
        const res = await fetch('/api/health');
        if (res.ok) { setHealth(await res.json() as HealthData); setHealthError(''); }
        else setHealthError('Unable to load system status');
      } catch { setHealthError('Unable to load system status'); }
    };

    const loadMetrics = async () => {
      try {
        const res = await fetch('/api/metrics');
        if (res.ok) { setMetrics(await res.json() as MetricsResponse); setMetricsError(''); }
        else setMetricsError('Unable to load RPC metrics');
      } catch { setMetricsError('Unable to load RPC metrics'); }
    };

    const loadAlerts = async () => {
      try {
        const res = await fetch(`/api/alerts?page=1&limit=${ALERT_PAGE_SIZE}`);
        if (res.ok) {
          const data = await res.json() as AlertsResponse;
          setAlerts(data.alerts);
          setAlertsTotal(data.total);
          setAlertsPage(1);
          setAllAlertsLoaded(data.alerts.length >= data.total);
          setAlertsError('');
        } else { setAlertsError('Unable to load alert history'); }
      } catch { setAlertsError('Unable to load alert history'); }
    };

    void loadHealth();
    void loadMetrics();
    void loadAlerts();
    const id = setInterval(() => { void loadHealth(); void loadMetrics(); }, 10000);
    return () => clearInterval(id);
  }, []);

  // ---- Load more alerts -----------------------------------------------------

  const loadMoreAlerts = async () => {
    setAlertsLoading(true);
    try {
      const nextPage = alertsPage + 1;
      const res = await fetch(`/api/alerts?page=${nextPage}&limit=${ALERT_PAGE_SIZE}`);
      if (res.ok) {
        const data = await res.json() as AlertsResponse;
        setAlerts(prev => [...prev, ...data.alerts]);
        setAlertsPage(nextPage);
        if (alerts.length + data.alerts.length >= data.total) {
          setAllAlertsLoaded(true);
        }
      }
    } catch { /* ignore */ }
    setAlertsLoading(false);
  };

  // ---- Section 1: Component Health ------------------------------------------

  const healthComponents = health ? Object.entries(health.components) : [];

  const renderHealthSection = () => (
    <section style={SECTION}>
      <div style={SECTION_HEADER}>COMPONENT HEALTH</div>
      {healthError ? (
        <div style={ERROR_TEXT}>{healthError}</div>
      ) : !health ? (
        <div style={LOADING_TEXT}>Loading...</div>
      ) : healthComponents.length === 0 ? (
        <div style={EMPTY_TEXT}>No components registered</div>
      ) : (
        <div style={HEALTH_GRID}>
          {healthComponents.map(([name, comp]) => (
            <div key={name} style={HEALTH_CARD}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: '4px' }}>
                <span style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: STATUS_DOT_COLORS[comp.status] ?? 'var(--gray)',
                  display: 'inline-block',
                  flexShrink: '0',
                }} />
                <span style={HEALTH_NAME}>{name.toUpperCase()}</span>
              </div>
              <div style={HEALTH_STATUS}>{comp.status}</div>
              {comp.detail && <div style={HEALTH_DETAIL}>{comp.detail}</div>}
              <div style={HEALTH_TIME}>Last check: {formatTime(health.timestamp)}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );

  // ---- Section 2: RPC Metrics -----------------------------------------------

  const metricsEntries = metrics ? Object.entries(metrics.endpoints) : [];

  const renderMetricsSection = () => (
    <section style={SECTION}>
      <div style={SECTION_HEADER}>RPC PERFORMANCE</div>
      {metricsError ? (
        <div style={ERROR_TEXT}>{metricsError}</div>
      ) : !metrics ? (
        <div style={LOADING_TEXT}>Loading...</div>
      ) : metricsEntries.length === 0 ? (
        <div style={EMPTY_TEXT}>No RPC metrics recorded</div>
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid var(--border)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={M_TH}>ENDPOINT</th>
                <th style={M_TH}>P50 (MS)</th>
                <th style={M_TH}>P99 (MS)</th>
                <th style={M_TH}>ERROR RATE</th>
                <th style={M_TH}>REQUESTS</th>
              </tr>
            </thead>
            <tbody>
              {metricsEntries.map(([endpoint, stats]) => (
                <tr key={endpoint}>
                  <td style={M_TD}>{endpoint}</td>
                  <td style={M_TD}>{stats.p50.toFixed(0)}</td>
                  <td style={M_TD}>{stats.p99.toFixed(0)}</td>
                  <td style={{ ...M_TD, color: errorRateColor(stats.errorRate) }}>
                    {(stats.errorRate * 100).toFixed(1)}%
                  </td>
                  <td style={M_TD}>{stats.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );

  // ---- Section 3: Alert History ---------------------------------------------

  const renderAlertsSection = () => (
    <section style={SECTION}>
      <div style={{ ...SECTION_HEADER, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>ALERT HISTORY</span>
        {alertsTotal > 0 && (
          <span style={{ fontSize: '10px', color: 'var(--text-dim)', fontWeight: '400', letterSpacing: '0' }}>
            {alerts.length} / {alertsTotal}
          </span>
        )}
      </div>
      {alertsError ? (
        <div style={ERROR_TEXT}>{alertsError}</div>
      ) : alerts.length === 0 ? (
        <div style={EMPTY_TEXT}>No alerts recorded</div>
      ) : (
        <div>
          {alerts.map(alert => (
            <div key={alert.id} style={ALERT_CARD}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: '4px' }}>
                <span style={alertBadgeStyle(alert.type)}>{alertBadgeLabel(alert.type)}</span>
                <span style={ALERT_SOURCE}>{alert.source}</span>
                <span style={ALERT_TIMESTAMP}>{formatTime(alert.timestamp)}</span>
              </div>
              <div style={ALERT_MESSAGE}>{alert.message}</div>
            </div>
          ))}

          {!allAlertsLoaded && (
            <button
              onClick={() => void loadMoreAlerts()}
              disabled={alertsLoading}
              style={{
                ...LOAD_MORE_BTN,
                opacity: alertsLoading ? '0.5' : '1',
                cursor: alertsLoading ? 'not-allowed' : 'pointer',
              }}
            >
              {alertsLoading ? 'Loading...' : 'Load more'}
            </button>
          )}
        </div>
      )}
    </section>
  );

  // ---- Render ---------------------------------------------------------------

  return (
    <div style={PAGE}>
      <div style={PAGE_HEADER}>
        <span style={PAGE_TITLE}>SYSTEM STATUS</span>
        <span style={PAGE_SUB}>Infrastructure health and monitoring</span>
      </div>
      <div style={CONTENT}>
        {renderHealthSection()}
        {renderMetricsSection()}
        {renderAlertsSection()}
      </div>
    </div>
  );
}

// ---- Styles -----------------------------------------------------------------

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

const CONTENT: Record<string, string> = {
  flex:       '1',
  overflowY:  'auto',
  padding:    'var(--sp-6)',
  display:    'flex',
  flexDirection: 'column',
  gap:        'var(--sp-5)',
};

const SECTION: Record<string, string> = {};

const SECTION_HEADER: Record<string, string> = {
  fontSize:      '10px',
  letterSpacing: '0.12em',
  color:         'var(--amber)',
  fontWeight:    '700',
  marginBottom:  'var(--sp-3)',
};

// ---- Health card styles -----------------------------------------------------

const HEALTH_GRID: Record<string, string> = {
  display:             'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
  gap:                 'var(--sp-3)',
};

const HEALTH_CARD: Record<string, string> = {
  background:   'var(--bg2)',
  border:       '1px solid var(--border)',
  padding:      'var(--sp-3)',
  borderRadius: 'var(--r-sm)',
};

const HEALTH_NAME: Record<string, string> = {
  fontSize:      '10px',
  fontWeight:    '700',
  letterSpacing: '0.1em',
  color:         'var(--text-bright)',
};

const HEALTH_STATUS: Record<string, string> = {
  fontSize:      '13px',
  color:         'var(--text)',
  marginBottom:  '2px',
};

const HEALTH_DETAIL: Record<string, string> = {
  fontSize: '10px',
  color:    'var(--text-dim)',
};

const HEALTH_TIME: Record<string, string> = {
  fontSize:  '10px',
  color:     'var(--text-dim)',
  marginTop: 'var(--sp-2)',
};

// ---- RPC metrics table styles -----------------------------------------------

const M_TH: Record<string, string> = {
  padding:       '0.5rem 0.75rem',
  textAlign:     'left',
  borderBottom:  '1px solid var(--border)',
  color:         'var(--gray)',
  background:    'var(--bg2)',
  fontWeight:    'normal',
  fontSize:      '10px',
  letterSpacing: '0.08em',
};

const M_TD: Record<string, string> = {
  padding:      '0.4rem 0.75rem',
  borderBottom: '1px solid var(--border)',
  fontSize:     '13px',
};

// ---- Alert history styles ---------------------------------------------------

const ALERT_TYPE_BADGE: Record<string, string> = {
  padding:       '2px 6px',
  fontSize:      '10px',
  fontWeight:    '700',
  letterSpacing: '0.1em',
  borderRadius:  'var(--r-sm)',
};

const ALERT_CARD: Record<string, string> = {
  background:   'var(--bg2)',
  border:       '1px solid var(--border)',
  padding:      'var(--sp-3)',
  borderRadius: 'var(--r-sm)',
  marginBottom: 'var(--sp-2)',
};

const ALERT_SOURCE: Record<string, string> = {
  fontSize:      '10px',
  color:         'var(--text)',
  letterSpacing: '0.05em',
};

const ALERT_TIMESTAMP: Record<string, string> = {
  fontSize:   '10px',
  color:      'var(--text-dim)',
  marginLeft: 'auto',
};

const ALERT_MESSAGE: Record<string, string> = {
  fontSize: '13px',
  color:    'var(--text)',
};

const LOAD_MORE_BTN: Record<string, string> = {
  background:    'var(--bg4)',
  border:        '1px solid var(--border)',
  color:         'var(--text-dim)',
  width:         '100%',
  padding:       'var(--sp-2)',
  marginTop:     'var(--sp-3)',
  cursor:        'pointer',
  fontSize:      '10px',
  letterSpacing: '0.1em',
  fontWeight:    '700',
  fontFamily:    'var(--font-mono)',
  textAlign:     'center',
};

// ---- Shared status styles ---------------------------------------------------

const ERROR_TEXT: Record<string, string> = {
  color:    'var(--red)',
  fontSize: '13px',
  padding:  'var(--sp-3)',
};

const LOADING_TEXT: Record<string, string> = {
  color:    'var(--text-dim)',
  fontSize: '13px',
  padding:  'var(--sp-3)',
};

const EMPTY_TEXT: Record<string, string> = {
  color:    'var(--gray)',
  fontSize: '13px',
  padding:  'var(--sp-3)',
};
