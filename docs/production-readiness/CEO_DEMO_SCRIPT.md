# Caladdin CEO Demo Script — 5 Minutes (Staging)

**Audience:** CEO · **Environment:** Render staging (OAuth + GCal test account)  
**Prerequisites:** Staging deployed per [STAGING_DEPLOY.md](../ops/STAGING_DEPLOY.md); host account with connected Google Calendar and at least one event type.

Replace `STAGING` below with your URL (e.g. `https://caladdin-staging.onrender.com`).

---

## Pre-demo checklist (5 min before)

- [ ] `/health` returns `200` with `"status":"complete"`
- [ ] Host logged in on laptop; guest flow ready on phone (or second browser, incognito)
- [ ] Event type exists: `/book/{username}/30-min-intro` (or your slug)
- [ ] ntfy or email visible for host notifications (optional but impressive)

---

## Minute 0:00–0:45 — Hook: voice scheduling (differentiator)

**Screen:** Host chat at `STAGING/`

**Say:** *"Caladdin is scheduling you talk to — not another link-in-bio form."*

**Do:**

1. Type or use mic: **"Find 2 slots for Alex next week for a 30-minute intro"**
2. Point out the **fax effect** — exactly **two** curated slots, not a overwhelming grid.
3. Copy the scheduling link Caladdin returns (`/s/:token`).

**Show:** Host calendar policy respected (working hours, protected blocks if configured).

---

## Minute 0:45–1:45 — Guest books (voice path)

**Screen:** Guest device — open the `/s/:token` link

**Say:** *"Guests get a focused, mobile-first page — no account required."*

**Do:**

1. Select a slot → fill name + email → confirm.
2. Show **timezone selector** (guest local time vs host time on permanent booking page).
3. Confirm success toast / confirmation screen.

**Show:** Host Google Calendar now has the event (refresh GCal or host “What's on my calendar today” in chat).

---

## Minute 1:45–2:45 — Cal.com parity: permanent booking URL

**Screen:** `STAGING/book/{username}/{slug}`

**Say:** *"Every host gets a persistent public page — like Cal.com — without leaving the voice-first product."*

**Do:**

1. Open permanent URL (not ephemeral token).
2. Pick slot → guest intake → book.
3. Mention **round-robin / team** scaffold (if enabled on event type): *"Team routing is in schema; single-host demo today."*

---

## Minute 2:45–3:30 — Guest self-service + host alert

**Screen:** Guest confirmation / manage link

**Do:**

1. **Reschedule** or **cancel** from guest manage link (signed token).
2. Optional: on voice-path session, **propose alternative** → show host gets notified (B08 path).

**Say:** *"Guests fix their own mistakes; hosts stay in control."*

---

## Minute 3:30–4:15 — Trust & safety (30 seconds)

**Screen:** Host chat

**Do:**

1. Type: **"Clear my Friday afternoon"** → show **destructive confirmation** (ntfy / approve flow).
2. One line: RLS, rate limits, kill switch documented in ops runbooks.

**Say:** *"Destructive actions always confirm. We can pause the whole product with one env var if needed."*

---

## Minute 4:15–5:00 — Close: roadmap honesty

**Say (script):**

> *"Today you saw voice scheduling, public booking pages, guest lifecycle, and calendar sync. Before production cohort we're finishing staging smoke sign-off, Lighthouse performance proof, 80% test coverage, and live monitoring. Team scheduling and embeds are Phase 2. Caladdin wins on conversational scheduling; we're at parity on the booking basics CEOs expect."*

**Optional backup clips if live fails:**

- `tests/integration/ceo-handoff-smoke.test.ts` — in-process full journey (CI green)
- Screen recording from dry-run stored in ops ticket

---

## Timing cheat sheet

| Segment | Duration | URL / action |
|---------|----------|--------------|
| Voice OFFER_SPECIFIC | 45s | `/` chat |
| Guest token book | 60s | `/s/:token` |
| Permanent book page | 60s | `/book/:user/:slug` |
| Reschedule / propose | 45s | Guest manage link |
| Confirmation safety | 45s | Flush + approve |
| Close | 45s | — |

---

## Post-demo

- [ ] Log staging URL + commit in [CEO_PROGRESS_TRACKER.md](./CEO_PROGRESS_TRACKER.md) Staging Smoke section
- [ ] File any bugs as B-list items before IC-8 sign-off
- [ ] Attach Lighthouse HTML to `docs/production-readiness/lighthouse/` when perf gate runs

---

## Related docs

- [SMOKE_TEST.md](../../SMOKE_TEST.md) — full staging protocol
- [CEO_HANDOFF_PLAN.md](./CEO_HANDOFF_PLAN.md) — sprint scope
- [FINAL_READINESS_REPORT.md](./FINAL_READINESS_REPORT.md) — handoff verdict
