# Cal.com Competitive Evaluation — Go/No-Go

**Date:** June 3, 2026  
**Evaluator:** Caladdin product team (pre-launch gate)  
**Decision:** **PROCEED** with Caladdin MVP build

## Summary

Cal.com is a strong open-source scheduling platform with polished availability grids, Cal.ai voice phone agents (paid add-on), and API v2 for agents. It does **not** deliver Caladdin's differentiated MVP: viral 2-slot fax invites, in-app voice scheduling with email read-back, read-only host calendar on invite pages, or post-accept viral signup attribution.

## UX findings

| Area | Cal.com | Caladdin target |
|------|---------|-----------------|
| Scheduling model | Host shares link; guest picks from full availability grid | Host offers **exactly 2** curated slots (fax effect) |
| Voice | Cal.ai phone calls via workflows (separate product, credits) | Native browser voice → plain English calendar commands |
| Email STT accuracy | N/A (typed booking forms) | Explicit email confirmation before invites |
| Recipient calendar view | Guest sees host's open slots only | Optional read-only host calendar + 2-slot accept |
| Viral loop | Standard product signup | Post-meeting-accept "Create your account" CTA with attribution |
| Personal blocks vs meetings | Working hours + OOO | Tiered protect blocks excluded from offers |

## Gaps vs Caladdin PRD

1. **No 2-slot viral fax model** — Cal.com optimizes for full availability browsing, not "Tomorrow 5pm OR day after 7pm."
2. **Voice is outbound phone (Cal.ai), not conversational calendar management** — Different use case and cost model.
3. **No email confirmation for misheard addresses** — Form-based email entry only.
4. **No read-only calendar grant on scheduling invite** — Closest is mutual availability via team features, not guest calendar view of host.
5. **Platform invite / waitlist pilot cap** — Generic SaaS signup, no 10–25 user pilot gate.

## Strengths of Cal.com (borrow, don't rebuild)

- Clean mobile booking pages
- Google Calendar sync reliability
- Workflow automation (reminders, follow-ups)
- Open API for integrations

## Decision rationale

Cal.com UX is **excellent for traditional link-based scheduling** but **does not cover** Caladdin's core differentiators: fax-effect 2-slot invites, voice-first calendar control with email confirmation, calendar-view-on-invite, and viral post-accept signup. Proceed with full Caladdin MVP implementation per PRD.

## Recommended Caladdin focus (unchanged)

1. Pilot cap + waitlist
2. GCal 2-week sync on connect
3. Voice email confirmation
4. Polished `/s/:token` with 2-slot accept + calendar view
5. Platform email invites
