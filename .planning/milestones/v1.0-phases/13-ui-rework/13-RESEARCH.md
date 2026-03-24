# Phase 13: UI Rework - Research

**Researched:** 2026-03-03
**Domain:** Preact SPA dashboard — layout restructuring, rich feed cards, analytics charts, visual redesign
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Layout structure:**
- Sidebar + content layout (replacing current top tabs)
- Fixed sidebar on left with navigation items
- Main content area on right shows the selected view
- Feed, Performance, and Settings as sidebar nav items

**Feed cards:**
- Rich cards replacing current flat text log lines
- Each card shows: full token mint (clickable link), safety score, source (PumpPortal/Raydium), buy amount, current P&L, event type badge, timestamp
- Cards should be expandable for additional detail (sell ladder status, etc.)
- Keep existing SSE-driven real-time updates and auto-scroll behavior
- Keep DRY RUN badge on dry-run trades (Phase 12 decision)

**External links:**
- Mint addresses link to Solscan token page
- PumpPortal-sourced tokens also link to pump.fun token page
- Links open in new tab

**Performance/Analytics:**
- Charts AND table combined view
- P&L chart over time with completed trades
- Win rate trend visualization
- Trade history table with sort/filter capability
- Per-trade breakdown: entry price, exit price, duration held, P&L in SOL
- Include completed trades (not just active positions like current)

**Sidebar content:**
- Claude's Discretion — frontend-design skill decides whether sidebar includes status indicators (connection status, uptime, wallet balance) or stays nav-only

### Claude's Discretion (frontend-design skill handles these)
- Overall visual direction and aesthetic (dark theme is carried forward but specific style is up to the skill)
- CSS/styling approach (Tailwind, CSS Modules, or other — skill decides)
- P&L chart type and time granularity (per-trade dots, hourly buckets, etc.)
- Chart library selection
- Typography choices (monospace for data vs sans-serif for labels)
- Spacing, shadows, border radius, color palette refinement
- Card expand/collapse interaction design
- Settings page layout improvements
- Mobile/responsive behavior
- All component-level design decisions

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

---

## Summary

This phase is a full visual and structural rework of the existing Preact SPA dashboard located in `dashboard/`. The current dashboard uses a horizontal tab layout with flat text rows in the feed, and only shows active positions in the Performance view. The rework introduces a sidebar+content layout, rich expandable feed cards, a combined charts+table analytics view covering completed trades, and a visual overhaul driven by the `frontend-design` skill.

The key design constraint is that **all implementation must invoke the `frontend-design` skill** for every UI decision. The frontend-design skill is installed at `C:/Users/jackc/.claude/plugins/cache/claude-plugins-official/frontend-design/55b58ec6e564/skills/frontend-design/SKILL.md` and emphasizes bold aesthetic direction, distinctive typography, and production-grade polish — not generic AI aesthetics.

The tech stack is already established: **Preact 10.x + @preact/signals + Vite 7 + TypeScript**. No backend changes. The phase consumes existing API endpoints (`/api/trades`, `/api/stats`, `/api/config`, `/events` SSE). The primary technical challenge is: (1) adding a chart library compatible with Preact, (2) expanding the `/api/trades` response to include completed trades for analytics, and (3) restructuring the layout without breaking the signals-based state management.

**Primary recommendation:** Use `lightweight-charts` (TradingView) for the P&L chart — it is a pure JavaScript/canvas library with no React dependency, works identically in Preact via a `useEffect` ref-mount pattern, and is purpose-built for financial time series data. Use CSS Modules or inline styles extended with CSS variables for styling (no need to add Tailwind — the existing CSS variable system in `dashboard/index.html` can be extended). Let frontend-design skill own all aesthetic decisions.

---

## Standard Stack

### Core (Already Installed — No New Installs Required for Base Rework)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| preact | 10.28.4 | UI framework | Already installed, entire dashboard built on it |
| @preact/signals | 2.8.1 | Reactive state | Already used for feedEvents + configSignal |
| vite | 7.3.1 | Build tool | Already configured |
| @preact/preset-vite | 2.10.3 | Vite plugin | Auto-aliases react→preact/compat, JSX runtime |

### Chart Library (New Install Required)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| lightweight-charts | ^5.1.0 | P&L/win-rate charts | Pure JS canvas, no React dependency, 45KB, built for financial time series, v5 is ESM-only (matches project type:module) |

**Why lightweight-charts over recharts:**
- lightweight-charts has zero React/Preact dependency — mounted imperatively via `container.appendChild(chart)` in `useEffect`
- recharts 3.x technically works via `preact/compat` aliases (which `@preact/preset-vite` enables automatically), but is SVG-based and heavier (~200KB) for what is just one line chart
- recharts/react-chartjs-2 are overkill and add surface area; lightweight-charts is exactly what financial dashboards use
- `precharts` wrapper (jason miller's) is 8+ years stale, do not use

**Alternative:** If the frontend-design skill determines a different chart aesthetic (e.g., SVG sparklines, pure CSS bar charts for win rate), chart library may not be needed at all. Research covers the case where a proper chart is required.

**Installation (if chart library needed):**
```bash
pnpm add lightweight-charts
```

### CSS Approach Options for Frontend-Design Skill
| Approach | Tradeoff | When to Use |
|----------|----------|-------------|
| Extended CSS variables (current) | Zero install, full control, but verbose for complex styles | Simple redesign that extends existing palette |
| CSS Modules (.module.css) | Zero install (Vite native), scoped classes, good for component isolation | Moderate complexity with many class variants |
| Tailwind CSS v4 | Requires `@tailwindcss/vite` plugin install + config, most powerful for rapid iteration | Complex layout with many utility combinations |

**Research finding:** The existing `dashboard/index.html` already defines 9 CSS variables (`--bg`, `--bg2`, `--border`, `--green`, `--red`, `--blue`, `--yellow`, `--gray`, `--text`, `--mono`). CSS Modules with extended CSS variables is the zero-install path. Tailwind requires `pnpm add -D @tailwindcss/vite tailwindcss` and a `tailwind.css` entry. The frontend-design skill should decide — both are valid and Vite supports both natively.

---

## Architecture Patterns

### Recommended Project Structure (After Rework)
```
dashboard/
├── index.html              # CSS variables + base styles (extend, don't replace)
├── src/
│   ├── main.tsx            # Entry — unchanged
│   ├── app.tsx             # Layout shell: sidebar + content area
│   ├── components/
│   │   ├── Sidebar.tsx     # NEW: Fixed nav sidebar
│   │   ├── LiveFeed.tsx    # REWORK: Rich expandable cards
│   │   ├── FeedCard.tsx    # NEW: Individual card component
│   │   ├── Performance.tsx # REWORK: Charts + completed trade table
│   │   ├── PnlChart.tsx    # NEW: lightweight-charts wrapper
│   │   ├── Header.tsx      # KEEP or fold into Sidebar
│   │   ├── Settings.tsx    # REWORK: Better layout
│   │   └── [design-driven] # Additional components per frontend-design skill
│   └── store/
│       ├── feed.ts         # KEEP: SSE feed store (signals)
│       └── config.ts       # KEEP: config signal
```

### Pattern 1: Sidebar + Content Layout (CSS Grid)
**What:** Two-column grid: fixed-width sidebar, flex-1 content area.
**When to use:** This is the locked decision — must be implemented.
**Example:**
```typescript
// app.tsx — CSS Grid sidebar + content (inline styles matching current pattern)
export function App() {
  const [view, setView] = useState<View>('feed');
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', height: '100vh' }}>
      <Sidebar activeView={view} onNavigate={setView} />
      <main style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {view === 'feed'        && <LiveFeed />}
        {view === 'performance' && <Performance />}
        {view === 'settings'    && <Settings />}
      </main>
    </div>
  );
}
```

### Pattern 2: Expandable Feed Card (Preact Signals + useState)
**What:** Card with collapsed/expanded state. Collapsed shows key event info; expanded reveals trade detail (sell ladder, etc.).
**When to use:** All feed entries in the reworked LiveFeed.
**Key insight:** Use local `useState` for per-card expand state — signals are for shared/global state (feedEvents, configSignal). Per-card expand is local component state.
**Example:**
```typescript
function FeedCard({ event }: { event: FeedEvent }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div onClick={() => setExpanded(!expanded)} style={{ cursor: 'pointer' }}>
      {/* collapsed: badge, mint link, P&L, timestamp */}
      {expanded && <div>{/* sell ladder status, additional detail */}</div>}
    </div>
  );
}
```

### Pattern 3: lightweight-charts Mount via useEffect
**What:** Chart library that mounts imperatively to a DOM ref. Framework-agnostic.
**When to use:** P&L over time, win rate trend.
**Example:**
```typescript
// Source: https://tradingview.github.io/lightweight-charts/docs
import { createChart } from 'lightweight-charts';
import { useEffect, useRef } from 'preact/hooks';

function PnlChart({ data }: { data: PnlDataPoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 200,
      layout: { background: { color: 'var(--bg)' }, textColor: 'var(--text)' },
      grid: { vertLines: { color: 'var(--border)' }, horzLines: { color: 'var(--border)' } },
    });
    const series = chart.addLineSeries({ color: 'var(--green)' });
    series.setData(data);
    // Cleanup
    return () => chart.remove();
  }, [data]);

  return <div ref={containerRef} />;
}
```

### Pattern 4: Preact Signals — Auto-Subscription in Render
**What:** Reading `signal.value` inside a Preact component body causes automatic re-render on change. No useEffect needed.
**When to use:** Header stats, dry-run banner, feed event count badge in sidebar.
**Example:**
```typescript
// Source: established pattern from Header.tsx (Phase 12 decision)
// configSignal.value?.dryRun is read directly — Preact auto-subscribes
const isDryRun = Boolean(configSignal.value?.dryRun);
```

### Pattern 5: External Links (Solscan + pump.fun)
**What:** Clickable mint addresses linking to block explorers.
**When to use:** All feed cards + performance table.
**Example:**
```typescript
const SOLSCAN_TOKEN = (mint: string) => `https://solscan.io/token/${mint}`;
const PUMPFUN_TOKEN = (mint: string) => `https://pump.fun/coin/${mint}`;

// In card:
<a href={SOLSCAN_TOKEN(event.mint)} target="_blank" rel="noopener noreferrer">
  {event.mint}
</a>
{event.source === 'pumpportal' && (
  <a href={PUMPFUN_TOKEN(event.mint)} target="_blank" rel="noopener noreferrer">
    pump.fun
  </a>
)}
```

### Anti-Patterns to Avoid
- **Removing existing signal stores:** `feedEvents` and `configSignal` work well; rework the rendering layer, not the store layer.
- **Fetching chart data on every SSE event:** Only fetch completed trade history once on mount + periodic refresh (same pattern as Performance.tsx currently does with 5s interval).
- **Using recharts or chart.js:** Heavier bundles, unnecessary React compatibility layer required. lightweight-charts is the correct choice for financial data.
- **Relying on precharts package:** It is 8+ years stale and targets an ancient Preact version. Do not install it.
- **Replacing CSS variables:** The existing `--bg`, `--green`, `--red` etc. are used throughout all components. Extend them in `index.html`, don't remove them — components not yet reworked still reference them.
- **Routing library:** This is a simple 3-view SPA. useState for active view is sufficient. No need for a router (react-router, wouter, etc.).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Financial time series chart | Custom SVG/canvas P&L chart | `lightweight-charts` | Handles time axis, crosshairs, resize, theme, performance-optimized for financial data |
| SSE reconnection | Custom retry/backoff logic | Browser EventSource (already implemented) | Browser auto-reconnects after ~3s natively; `connectFeed()` in feed.ts already handles this correctly |
| Per-component CSS scoping | Manual BEM class naming or style deduplication | CSS Modules (`.module.css`) or inline styles | Vite handles CSS Modules natively; no conflict risk |
| P&L calculation | Frontend math on raw trade data | Already calculated server-side in `/api/stats` (`total_pnl_sol`) and per-trade in `/api/trades` | Server has the DB; frontend should display, not compute |

**Key insight:** The backend already does the heavy lifting. The `/api/stats` endpoint returns `totalPnlSol`, `winRate`, `completedTrades`, `failedTrades`. The `/api/trades` endpoint returns `MONITORING` trades with `entryPriceSol`, `stopLossTarget`, `takeProfitTarget`. For the analytics view's **completed trade history** (new requirement), a new backend endpoint or an extension of `/api/trades` to include completed trades is needed — this is the only backend-touching requirement in this phase.

---

## Common Pitfalls

### Pitfall 1: `/api/trades` Only Returns MONITORING Trades
**What goes wrong:** The Performance analytics view needs completed trade history (entry price, exit price, duration, P&L), but `GET /api/trades` currently only returns `getMonitoringTrades()`.
**Why it happens:** The route was built for the active positions view in Phase 8. Completed trades were not needed then.
**How to avoid:** Add a new endpoint `GET /api/trades/history` (or add `?state=completed` query param) that queries `SELECT * FROM trades WHERE state = 'COMPLETED' ORDER BY updated_at DESC LIMIT 100`. This is a one-file backend change in `src/dashboard/routes/trades.ts`.
**Warning signs:** Performance view shows empty table even after trades complete.

### Pitfall 2: lightweight-charts CSS Variable Resolution Timing
**What goes wrong:** `createChart` is called before CSS variables are computed, so `getComputedStyle` returns empty strings for `var(--bg)`.
**Why it happens:** CSS variables are resolved at paint time; chart options passed as strings with `var(--...)` syntax work in DOM CSS but NOT when passed directly to lightweight-charts options (it uses raw color values, not CSS).
**How to avoid:** Use `getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()` to resolve variable values before passing to chart options. Or use hardcoded hex values in chart options (`#0d0d0d` instead of `var(--bg)`).
**Warning signs:** Chart renders with default white/black theme regardless of theme settings.

### Pitfall 3: Chart Resize on Layout Change
**What goes wrong:** When switching to Performance view for the first time, chart container has zero dimensions.
**Why it happens:** Preact doesn't mount Performance until `view === 'performance'` — the container has no size yet when the chart is created.
**How to avoid:** Use a `ResizeObserver` in the `useEffect` to re-call `chart.resize()` when container dimensions change, or call `chart.timeScale().fitContent()` after mount.
**Warning signs:** Chart shows as zero-height or zero-width strip.

### Pitfall 4: Losing Auto-Scroll on Feed Card Expansion
**What goes wrong:** Auto-scroll to bottom breaks when cards expand, because `scrollHeight` changes unpredictably.
**Why it happens:** The current LiveFeed auto-scroll fires on `feedEvents.value` change. Card expansion changes `scrollHeight` without a new feed event.
**How to avoid:** Auto-scroll only triggers on new events (track previous length). Card expand/collapse does NOT trigger auto-scroll. Keep the existing `isLive` / scroll-detection logic intact.
**Warning signs:** Expanding a card at the bottom causes the view to jump.

### Pitfall 5: FeedEvent Missing Data Fields for Rich Cards
**What goes wrong:** Cards are supposed to show safety score, source, buy amount, current P&L — but `BotEvent` / `FeedEvent` only carries `type`, `mint`, `ts`, `detail`, `isDryRun`.
**Why it happens:** The SSE feed was designed as a lightweight event bus, not a full trade state snapshot.
**How to avoid:** Two options — (a) enrich `BotEvent` in `bot-event-bus.ts` with additional optional fields (`safetyScore?`, `source?`, `buyAmountSol?`, `pnlSol?`), or (b) treat the feed cards as "event + live lookup" where clicking/expanding a card fetches trade detail from `/api/trades?mint=...`. Option (a) is simpler and keeps SSE self-contained.
**Warning signs:** Feed cards display `—` for all enriched fields.

### Pitfall 6: vite.config.ts Root vs. Dashboard Config Confusion
**What goes wrong:** `dashboard/vite.config.ts` has `root: './dashboard'` which is incorrect when the config IS inside `dashboard/`. This means relative paths need careful attention.
**Why it happens:** This is actually the root-level `vite.config.ts`, not `dashboard/vite.config.ts`. The `root: './dashboard'` in the root config means Vite serves `dashboard/` as its web root. The `dashboard/vite.config.ts` shown in the context IS the root config.
**How to avoid:** Keep `vite.config.ts` at repo root. Build via `pnpm build:dashboard` which calls `vite build --config dashboard/vite.config.ts` — this config points `outDir` to `./dist` (relative to `dashboard/`).
**Warning signs:** CSS module imports fail, assets not found.

---

## Code Examples

Verified patterns from existing codebase and official sources:

### Signals Auto-Subscription (Already Established in This Project)
```typescript
// Source: dashboard/src/components/Header.tsx (Phase 12 pattern)
// Reading configSignal.value inside render body = auto-subscription
const isDryRun = Boolean(configSignal.value?.dryRun);
// No useEffect needed — Preact re-renders on signal change
```

### SSE Feed Connection (Keep As-Is)
```typescript
// Source: dashboard/src/store/feed.ts
// connectFeed() handles both 'message' and typed event names
// feedEvents signal updated on every event
// MAX_FEED_SIZE=200 enforced
export const feedEvents = signal<FeedEvent[]>([]);
```

### External Link Pattern (Solscan + pump.fun)
```typescript
// Source: locked decision from CONTEXT.md
const mintUrl = (mint: string) => `https://solscan.io/token/${mint}`;
const pumpUrl = (mint: string) => `https://pump.fun/coin/${mint}`;
// All links: target="_blank" rel="noopener noreferrer"
```

### Completed Trades Backend Query (Needed for Analytics)
```typescript
// Source: existing pattern in src/dashboard/routes/trades.ts (raw DB cast)
// Extend trades route or add new endpoint:
const history = db.prepare(`
  SELECT id, mint, source, amount_sol, buy_price_sol, sell_price_sol,
         created_at, updated_at, dry_run,
         (sell_price_sol - buy_price_sol) as pnl_sol,
         (updated_at - created_at) as duration_ms
  FROM trades
  WHERE state = 'COMPLETED'
    AND (dry_run IS NULL OR dry_run = 0)
  ORDER BY updated_at DESC
  LIMIT 500
`).all() as CompletedTradeRow[];
```

### lightweight-charts Imperative Mount
```typescript
// Source: https://tradingview.github.io/lightweight-charts/docs (verified)
import { createChart, LineData } from 'lightweight-charts';
import { useEffect, useRef } from 'preact/hooks';

export function PnlChart({ data }: { data: LineData[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, { /* options */ });
    const series = chart.addLineSeries();
    series.setData(data);
    return () => chart.remove();
  }, [data]);
  return <div ref={ref} style={{ width: '100%', height: '200px' }} />;
}
```

### CSS Modules Pattern (Vite-native, zero install)
```typescript
// dashboard/src/components/Sidebar.module.css
.sidebar { width: 220px; background: var(--bg2); ... }
.navItem { ... }
.navItem.active { color: var(--green); }

// Sidebar.tsx
import styles from './Sidebar.module.css';
<div class={styles.sidebar}>
  <button class={`${styles.navItem} ${active ? styles.active : ''}`}>
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Horizontal tab nav | Sidebar + content layout | Phase 13 | More scalable for future nav items |
| Flat text rows in feed | Rich expandable cards | Phase 13 | Actionable per-event detail without modal |
| Active positions only | Completed trade history + analytics | Phase 13 | True P&L accountability |
| Inline style-only | CSS Modules or extended CSS vars | Phase 13 | Maintainable, design-system-friendly |
| No charts | lightweight-charts time series | Phase 13 | Visual P&L and win rate trend |

**Deprecated/outdated:**
- `precharts` (developit): Last updated 8 years ago, targets Preact v7/8. Do not use.
- `preact-compat` (npm package): Replaced by `preact/compat` (built into Preact 10). Do not install separately.

---

## Open Questions

1. **BotEvent enrichment scope**
   - What we know: Feed cards need safetyScore, source, buyAmountSol, pnlSol — not currently in BotEvent
   - What's unclear: Whether to enrich BotEvent (emit more data from backend) or do live lookups from frontend on expand
   - Recommendation: Enrich BotEvent with optional fields (`safetyScore?`, `source?`, `buyAmountSol?`). P&L (live) stays as a `/api/trades` poll rather than SSE payload. This is decided by the planner based on how rich the collapsed card view needs to be.

2. **Sidebar status indicators**
   - What we know: Connection status, uptime, wallet balance are candidates per CONTEXT.md (Claude's Discretion)
   - What's unclear: Wallet balance requires a new backend endpoint (Solana RPC call) — out of phase scope per "no new backend capabilities" boundary
   - Recommendation: Sidebar shows connection status (derived from SSE EventSource readyState — available client-side, no backend needed) and static nav items. Wallet balance and uptime are deferred unless a `/api/status` endpoint already exists.

3. **Chart time granularity for P&L chart**
   - What we know: "P&L chart over time with completed trades" — per-trade dots vs hourly buckets vs cumulative
   - What's unclear: Depends on how many trades a user typically has (could be dozens or hundreds)
   - Recommendation: Cumulative P&L line chart, one data point per completed trade (x = completion timestamp, y = cumulative P&L SOL). lightweight-charts handles this natively as a time series with `time` (unix seconds) + `value`.

4. **`/api/trades` extension vs new endpoint**
   - What we know: Current `/api/trades` returns monitoring trades. Analytics needs completed trades.
   - What's unclear: Whether to extend with `?state=completed` query param or add `/api/trades/history`
   - Recommendation: Add `GET /api/trades/history` — cleaner separation, avoids ambiguity with the existing active-positions consumer.

---

## Frontend-Design Skill Integration

This phase mandates use of the `frontend-design` skill installed at:
`C:/Users/jackc/.claude/plugins/cache/claude-plugins-official/frontend-design/55b58ec6e564/skills/frontend-design/SKILL.md`

**Key directives from the skill:**
- Choose a **bold, committed aesthetic direction** — "retro-futuristic", "industrial/utilitarian", "brutalist/raw" all fit a trading terminal context
- Avoid generic choices: Inter/Roboto fonts, purple gradients on white, predictable layouts
- Dark theme is the starting point (locked decision), but the skill evolves it
- Typography: pair a distinctive display font with a refined body font; monospace for data values is natural here but the skill may break that expectation creatively
- Motion: CSS-only animations for load reveals and hover states; no heavy animation libraries needed

**How to invoke in planning:**
Each plan that implements a new visual component (Sidebar, FeedCard, PnlChart, Performance redesign, Settings redesign) should include a task step: "Apply frontend-design skill to implement [component] — commit to aesthetic direction before writing code."

The skill does not require a separate install — it is a prompt discipline applied when writing code.

---

## Sources

### Primary (HIGH confidence)
- Existing codebase — `dashboard/src/` read directly, all patterns verified against actual code
- `@preact/preset-vite` GitHub source (`preset-vite/src/index.ts`) — confirmed auto-aliases `react → preact/compat` by default
- `lightweight-charts` npm / GitHub — confirmed v5.1.0, pure JS, ESM, 45KB, canvas-based, no framework dependency
- CONTEXT.md — locked decisions read directly

### Secondary (MEDIUM confidence)
- WebFetch of `@preact/preset-vite` source — confirmed `reactAliasesEnabled: true` default
- TradingView lightweight-charts docs — imperative mount pattern via `createChart(container, options)`
- Vite CSS Modules docs — native support, zero install required

### Tertiary (LOW confidence — verify before relying)
- recharts 3.x + preact/compat compatibility: Multiple sources suggest it works via auto-aliases, but no direct test in this project's stack. The lightweight-charts recommendation avoids this uncertainty entirely.
- `precharts` package: Confirmed stale (8 years, v1.4.0). Do not use.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — verified from actual package.json, existing code, and official docs
- Architecture: HIGH — patterns derived from existing code (Header.tsx, LiveFeed.tsx, feed.ts) with minimal new surface
- Chart library: HIGH for lightweight-charts recommendation; MEDIUM for recharts-via-compat as alternative
- Pitfalls: HIGH — CSS variable resolution timing and completed-trades API gap are verified gaps from reading the actual code
- Frontend-design skill: HIGH — plugin confirmed installed, SKILL.md read

**Research date:** 2026-03-03
**Valid until:** 2026-06-01 (Preact 10.x + Vite 7 + lightweight-charts v5 are stable; frontend-design skill is installed)
