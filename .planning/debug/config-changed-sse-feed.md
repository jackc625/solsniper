---
status: diagnosed
trigger: "After applying a config change via Dashboard Settings, the Live Feed does not show any events at all. Expected: an amber CFG badge CONFIG_CHANGED card appears in the feed."
created: 2026-03-22T00:00:00Z
updated: 2026-03-22T00:00:00Z
---

## Current Focus

hypothesis: CONFIRMED -- SSE connection is destroyed when user navigates away from Feed tab to Settings tab, so CONFIG_CHANGED event emitted during settings save has no connected client to receive it
test: Traced full lifecycle: key={view} on <main> forces remount, LiveFeed unmount closes EventSource, event emitted to zero listeners is dropped
expecting: N/A -- root cause confirmed
next_action: Return diagnosis

## Symptoms

expected: After changing config in Settings, an amber "CFG" badge CONFIG_CHANGED card appears in the Live Feed
actual: Live Feed does not show any events at all after config change
errors: None reported (silent failure)
reproduction: Open dashboard, go to Settings, change a value, submit -- feed stays empty
started: Phase 15 implementation (new feature, never worked)

## Eliminated

- hypothesis: Event type string mismatch between backend and frontend
  evidence: Both use exact string 'CONFIG_CHANGED' -- backend BotEventType union (bot-event-bus.ts:13), config route emit (config.ts:62), frontend listener (feed.ts:37), badge/label maps (FeedCard.tsx:15,29)
  timestamp: 2026-03-22

- hypothesis: SSE route path mismatch
  evidence: Backend registers GET /events (events.ts:8, no prefix in dashboard-server.ts:53), frontend connects to /events (feed.ts:19)
  timestamp: 2026-03-22

- hypothesis: TypeScript compilation error
  evidence: tsc --noEmit passes clean
  timestamp: 2026-03-22

- hypothesis: Frontend missing CONFIG_CHANGED in typed listener list
  evidence: feed.ts:37 includes 'CONFIG_CHANGED' in eventTypes array
  timestamp: 2026-03-22

## Evidence

- timestamp: 2026-03-22
  checked: bot-event-bus.ts
  found: BotEventType includes CONFIG_CHANGED. Bus uses eventemitter3, single 'event' channel with BotEvent payload.
  implication: Emission side is correctly typed.

- timestamp: 2026-03-22
  checked: config.ts POST /api/config handler
  found: Lines 61-66 emit CONFIG_CHANGED via botEventBus.emit('event', {...}) with mint='', detail showing changed keys.
  implication: Backend emission looks correct.

- timestamp: 2026-03-22
  checked: events.ts SSE route
  found: Uses reply.sse.send({ event: event.type, data: event }) on botEventBus 'event' listener. SSE plugin formats as typed event (event: CONFIG_CHANGED\ndata: {...}\n\n).
  implication: Wire format uses typed SSE events (event field set).

- timestamp: 2026-03-22
  checked: @fastify/sse v0.4.0 source (index.js)
  found: Plugin wraps handler, checks Accept header for text/event-stream, creates SSEContext on reply.sse. formatSSEMessage serializes data via JSON.stringify.
  implication: SSE context only created when Accept header matches. EventSource sends this by default.

- timestamp: 2026-03-22
  checked: feed.ts frontend
  found: Two listener types: generic 'message' (line 21) and typed per-event (lines 35-49). Generic 'message' only fires for events WITHOUT event: field. Typed listeners fire for events WITH matching event: field.
  implication: Since backend sets event: field, only typed listeners will fire -- this is correct.

## Resolution

root_cause: SSE EventSource connection is destroyed when user navigates away from the Feed tab. In app.tsx:27, `<main key={view}>` forces a full unmount/remount of all children when the view changes. LiveFeed.tsx:10-12 calls connectFeed() in a useEffect that closes the EventSource on cleanup. When user navigates to Settings, the EventSource is closed. CONFIG_CHANGED events emitted by POST /api/config (config.ts:61-66) are dropped because botEventBus has zero listeners (bot-event-bus.ts:36 comment confirms: "If no SSE clients are connected, emitted events are simply dropped").
fix: Move connectFeed() call from LiveFeed component to App component so the SSE connection persists across tab navigation. The feedEvents signal is already module-scoped in feed.ts so LiveFeed will read it reactively regardless of where connectFeed() is called.
verification:
files_changed: [dashboard/src/app.tsx, dashboard/src/components/LiveFeed.tsx]
