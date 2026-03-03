# Phase 13: UI Rework - Context

**Gathered:** 2026-03-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Complete visual and functional rework of the existing Preact web dashboard. Covers layout restructuring, feed card redesign, performance/analytics enhancement, and visual overhaul. All implementation must use the `frontend-design` skill for design decisions and code generation. No new backend capabilities — this phase consumes existing API endpoints and SSE events.

</domain>

<decisions>
## Implementation Decisions

### Layout structure
- Sidebar + content layout (replacing current top tabs)
- Fixed sidebar on left with navigation items
- Main content area on right shows the selected view
- Feed, Performance, and Settings as sidebar nav items

### Feed cards
- Rich cards replacing current flat text log lines
- Each card shows: full token mint (clickable link), safety score, source (PumpPortal/Raydium), buy amount, current P&L, event type badge, timestamp
- Cards should be expandable for additional detail (sell ladder status, etc.)
- Keep existing SSE-driven real-time updates and auto-scroll behavior
- Keep DRY RUN badge on dry-run trades (Phase 12 decision)

### External links
- Mint addresses link to Solscan token page
- PumpPortal-sourced tokens also link to pump.fun token page
- Links open in new tab

### Performance/Analytics
- Charts AND table combined view
- P&L chart over time with completed trades
- Win rate trend visualization
- Trade history table with sort/filter capability
- Per-trade breakdown: entry price, exit price, duration held, P&L in SOL
- Include completed trades (not just active positions like current)

### Sidebar content
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

</decisions>

<specifics>
## Specific Ideas

- "The ENTIRE POINT of this phase is to utilize the official claude code frontend-design skill" — every UI change must go through the skill
- Sidebar + content is the chosen layout structure (Linear/Vercel admin dashboard pattern)
- Keep the existing dark terminal color scheme as a starting point (Phase 8 decision), but the frontend-design skill can evolve it
- Feed should feel like a real trading dashboard, not a text log

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `dashboard/src/store/feed.ts`: Preact signals-based SSE feed store (MAX_FEED_SIZE=200, typed FeedEvent)
- `dashboard/src/store/config.ts`: Config signal with fetchConfig/saveConfig
- `src/dashboard/bot-event-bus.ts`: Backend SSE event emitter
- `src/dashboard/routes/`: API routes for /api/trades, /api/stats, /api/config, /events (SSE)
- `src/dashboard/auth.ts`: Optional API key auth

### Established Patterns
- Preact + Vite SPA in `dashboard/` directory (separate from bot source in `src/`)
- Separate tsconfig: `dashboard/tsconfig.json` targets browser (ES2020 DOM) with moduleResolution=bundler
- CSS variables defined in `dashboard/index.html` (--bg, --bg2, --border, --green, --red, --blue, --yellow, --gray, --text, --mono)
- Pre-built dist/ served by in-process Fastify server
- All styling is currently inline — no CSS framework installed

### Integration Points
- `dashboard/src/app.tsx`: Main app component — needs layout restructuring
- `dashboard/src/components/`: Header, LiveFeed, Performance, Settings — all need redesign
- `dashboard/index.html`: CSS variables and base styles — may need updating for new styling approach
- `dashboard/vite.config.ts`: Build config — may need plugins for new CSS approach
- API endpoints remain unchanged: GET/POST /api/config, GET /api/trades, GET /api/stats, GET /events (SSE)

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 13-ui-rework*
*Context gathered: 2026-03-03*
