---
name: Quick Task 260416-imd Context
description: Locked decisions for README.md rewrite from codebase inspection
type: quick-context
quick_id: 260416-imd
---

# Quick Task 260416-imd: Write brand-new README.md reverse-engineered from codebase - Context

**Gathered:** 2026-04-16
**Status:** Ready for planning

<domain>
## Task Boundary

Reverse-engineer the entire SolSniper codebase and produce a brand-new `README.md` at the project root. Replace the existing 30KB README (treat as outdated — do not use as a source of truth). Audience: engineers, technical interviewers, hiring managers. Tone: polished, credible, technically strong, not buzzwordy. Must reflect actually-implemented features only — no roadmap aspirations presented as current, no invented features.

Full requirements in `TASK.md` at repo root.

</domain>

<decisions>
## Implementation Decisions

### README Length & Depth
- **Comprehensive** — hit all 13 sections from TASK.md with substantive depth (~8–15KB). The depth is intentional: this README is an interview showcase, not a quickstart.

### Architecture Diagrams
- **Mermaid diagrams** — include a high-level architecture diagram and a sniping pipeline flow diagram. GitHub renders Mermaid natively. Shows visual-systems thinking.

### Badges
- **No shields.io badges** — TASK.md explicitly warns against "template filler." Keep the top of the README clean and content-first.

### Code Samples
- **Selective snippets** — include CLI command examples, env-var stubs, and 2–3 short TypeScript excerpts that illustrate notable patterns (e.g., tiered safety check shape, fee-estimator logic, or kill-switch interface). Not a code dump.

### Claude's Discretion
- Section ordering within the 13 TASK.md sections — free to merge/split where it reads better.
- Whether to include a short intro tagline under the title.
- Whether to add a "Glossary" for Solana-specific terms (holder concentration, bonding curve, etc.) if it helps non-Solana reviewers.
- Specific wording, example commands, and which exact code excerpts to showcase.
- Whether to cite specific file paths inline (recommended for credibility with engineers).

</decisions>

<specifics>
## Specific Ideas

- Existing `README.md` at repo root is 30KB (dated Mar 31) — DO NOT read it as a source of truth per TASK.md constraints.
- TASK.md is explicit about tone: professional, technically confident, no exaggeration, no cheesy buzzwords, strong markdown hierarchy.
- Deliverable is ONLY `README.md` at the repo root. No sidecar docs, no ADRs, no changelog updates.
- End-of-task chat summary must list: what was found, major sections included, ambiguities that required care.

</specifics>

<canonical_refs>
## Canonical References

- `TASK.md` (repo root) — authoritative task specification
- Codebase itself — source of truth for every factual claim in the README

</canonical_refs>
