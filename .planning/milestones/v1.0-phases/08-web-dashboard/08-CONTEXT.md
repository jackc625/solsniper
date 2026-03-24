# Phase 8: Web Dashboard - Context

**Gathered:** 2026-02-27
**Status:** Ready for planning

<domain>
## Phase Boundary

In-process HTTP server that serves a web dashboard for monitoring bot activity in real-time and adjusting runtime configuration. The dashboard is a read-write observer layered on top of the running bot — it does not control trade execution. No separate deployment, no IPC, no new bot processes.

</domain>

<decisions>
## Implementation Decisions

### Frontend approach
- Preact or React SPA built with Vite
- Production: serve pre-built `dist/` folder from the in-process HTTP server
- Dev: Vite dev server proxies API/SSE to the bot process
- Auth: Claude's Discretion (simple API key in header recommended given VPS exposure risk)

### Dashboard layout
- Tabbed navigation: **Live Feed | Performance | Settings**
- Persistent header bar across all tabs showing: Total P&L, win rate, open positions count
- Dark theme, monospace/terminal aesthetic — dark background, green/red for P&L

### Trade feed & events
- SSE stream surfaces all bot lifecycle events: token detected, buy sent, buy confirmed, sell triggered, sell confirmed, errors
- Each feed row shows: `[HH:MM:SS] EVENT_TYPE_BADGE  ABC...XYZ  brief description`
- Auto-scroll to latest; pauses when operator manually scrolls up; "Resume live" button re-enables
- Browser retains last 200 events; older entries are trimmed from the DOM

### Config editing UX
- Edit-then-Save pattern: operator edits any fields, clicks Save → single POST applies all changes atomically
- Changes are **in-memory only** — restart reverts to config file values
- Adjustable via Settings tab:
  - Safety score threshold and scoring weights
  - Buy amount (SOL)
  - Max concurrent positions
  - Stop-loss %
  - Take-profit tiers (amounts and targets)
  - Slippage tolerance
- New limits apply **forward-only**: in-flight trades are never forcibly closed by a config change

### Claude's Discretion
- Authentication implementation (recommend simple configurable API key in .env)
- HTTP server library choice (Fastify / Express / Node built-in)
- SSE event schema and wire format
- Exact tab layout and spacing within the dark theme
- How take-profit tiers are represented in the Settings UI (table rows vs separate fields)
- Error display / toast notifications for save failures

</decisions>

<specifics>
## Specific Ideas

- Terminal/trading-bot aesthetic: dark background, monospace font for numbers and mint addresses, green for profit/confirmed events, red for losses/errors
- Feed badges should be color-coded by event type so the operator can scan at a glance (e.g. DETECTED=gray, BUY=blue, SELL=yellow, ERROR=red)

</specifics>

<deferred>
## Deferred Ideas

- None — discussion stayed within phase scope

</deferred>

---

*Phase: 08-web-dashboard*
*Context gathered: 2026-02-27*
