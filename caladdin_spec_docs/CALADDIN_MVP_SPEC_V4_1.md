# Caladdin — MVP Specification v4.1
# Date: April 22, 2026
# Status: FROZEN. Single source of truth for 10-user MVP.
# Integrated: Claude analysis + Grok review (selective)
# What changed from v4.0: stronger safety language, honest onboarding,
# error handling added, first-win defined, recipient page anti-sales hardened,
# build order tightened to core loop first.

---

## 1. WHAT CALADDIN IS (MVP)

A scheduling assistant that speaks plain English and protects your time.

**MVP goal:** 10 friends click a link, connect their Google Calendar, manage
their schedule in plain English, and set up 1:1 appointments with each other.
Nothing bad happens to their calendars. They are delighted. They tell others.

**What it is not in MVP:**
- Not an autonomous agent
- Not a financial advisor
- Not a social network
- Not Calendly with AI
- No admin panel, no billing, no subscriptions

---

## 2. THE 6 MVP REQUIREMENTS

| # | Requirement | Built? |
|---|-------------|--------|
| 1 | Click a link, sign in with Google, start using — no downloads, no tech setup | ⬜ Frontend needed |
| 2 | Connect Google Calendar (urged to use test account, protected either way) | ✅ OAuth built |
| 3 | Speak or type normal English to manage calendar | ✅ Backend built |
| 4 | Manage their own calendar | ✅ Backend built |
| 5 | Set up 1:1 appointments with friends | ⬜ Recipient page needed |
| 6 | Nothing bad happens to their calendars — even if they used their real one | ✅ Safety layer built |

---

## 3. HONEST ONBOARDING REALITY

**What "no tech setup" actually means:**

Users click a link. They see a web page. They click "Sign in with Google."
Google's OAuth consent screen appears — this is a Google screen, not ours.
It asks for calendar access. They approve. They're in.

This IS technical for some people. We make it as smooth as possible:

- Clear, warm instructions on what to expect at each step
- "Why does Caladdin need calendar access?" — answered proactively
- If OAuth fails: clear human message, not a technical error
- If they decline calendar access: "No problem. You'll need calendar access
  for Caladdin to work. Want to try again?"

**We urge users to connect a test Gmail account, not their main one.**
But we build as if they connected their main one. The safety layer must
protect real calendars. No exceptions. No assumptions.

**First win definition:**
A user has had their first win when they complete one calendar action
successfully — a block created, an event moved, or a scheduling link sent.
This must happen within 5 minutes of connecting their calendar.
If it doesn't, onboarding has failed.

---

## 4. CAL-LANGUAGE

Users speak a natural subset of English about their time and calendar.
We call this Cal-language.

**Cal-language — Caladdin handles:**
"Block Tuesday mornings for deep work"
"Find time for Alex next week"
"Cancel tomorrow"
"Am I free Thursday at 2?"
"Put dinner with Sarah at 7pm Friday"
"Move my 3pm to 4pm"

**Non-Cal-language — warm redirect, never an error:**
"The weather is great today" →
"Good to know! Anything I can help you with?
Your calendar? Setting up a time with a friend?"

**RESOLVE_MANUAL is for ambiguous Cal-language only.**
Not for off-topic English. Off-topic gets a warm redirect, not an escalation.

---

## 5. CANONICAL INTENTS (10)

The LLM maps all Cal-language to one of these 10.
Non-Cal-language gets a warm redirect — never RESOLVE_MANUAL.
One LLM API call per utterance. No keyword gates.

| # | Intent | Description | Example |
|---|--------|-------------|---------|
| 1 | PROTECT_BLOCK | Create or protect time blocks | "Block Tuesday mornings", "Protect my lunch" |
| 2 | OFFER_SPECIFIC | Find 2 optimal slots, generate scheduling link | "Find time for Alex", "Book a haircut" |
| 3 | CREATE_EVENT | Place a specific event at a known time | "Put dinner with Sarah at 7pm Friday" |
| 4 | FLUSH_RANGE | Clear events in a time range | "Cancel tomorrow", "Clear Friday except board call" |
| 5 | MODIFY_EVENT | Change an existing event — single or series | "Move my 3pm to 4pm", "Change standup to Thursdays" |
| 6 | PIVOT_ASYNC | Decline meeting, propose async alternative | "Tell John I can't do a call, send Loom instead" |
| 7 | SHAPE_RULES | Update scheduling preferences | "No meetings before 9am", "Always 15 min buffer" |
| 8 | GATEKEEP_RULE | Update contact priority tiers | "Treat sarah@company.com as high priority" |
| 9 | QUERY_CALENDAR | Read and summarize calendar — read only | "What's on my calendar today", "Am I free Thursday?" |
| 10 | UNDO | Revert last single-event action within 10 minutes | "Undo that", "Never mind" |
| — | RESOLVE_MANUAL | Ambiguous Cal-language — log and ask one clarifying question | "My week is a mess, help" |

**Why we kept all 10 (Grok suggested cutting to 6):**
"No meetings before 9am" (SHAPE_RULES) and "Treat Sarah as high priority"
(GATEKEEP_RULE) are the most natural things users will say. Removing them
makes the product feel broken. UNDO prevents frustration on simple mistakes.
The complexity of these intents is low — the handlers are simple DB writes.

**MODIFY_EVENT scope param:**
scope: 'single' | 'this_and_future' | 'series'
Default: 'single' unless user says "always", "from now on", "all"

**PIVOT_ASYNC modes:**
- Mode A: Decline + offer new slots
- Mode B: Decline only
- Mode C: Block contact + silent

**GATEKEEP_RULE always extracts:**
contact (email or domain) + tier (0=sacred, 1=high, 2=standard, 3=flexible)

**UNDO hard limits:**
- Only for: MODIFY_EVENT (single), CREATE_EVENT, PROTECT_BLOCK
- Never for: FLUSH_RANGE, OFFER_SPECIFIC (link already sent)
- Window: 10 minutes
- Social context check: if external party notified, warn before undoing

---

## 6. AMBIGUITY HANDLING

When intent is clear but params are ambiguous — ask ONE precise question.
Never a help menu. Never "please rephrase."

Examples:
- "Clear Friday" → "Just this coming Friday, or every Friday?"
- "Move that" → "Which event — your 3pm standup or the Alex call?"
- "Next week" → "Monday through Friday next week?"

The standard: a human assistant who understood you would ask one precise
question. That is exactly what Caladdin does.

---

## 7. TIER SYSTEM

| Tier | Label | Example | Rule |
|------|-------|---------|------|
| 0 | Sacred | Family, meditation | NEVER touch without explicit confirmation |
| 1 | High-stakes | Investor calls, board meetings | Confirmation for destructive ops |
| 2 | Standard | Regular meetings | Allow with audit log |
| 3 | Flexible | Tentative holds | Allow with audit log |

Default for all imported Google Calendar events: Tier 2.
User promotes to Tier 0/1 via SHAPE_RULES.
Blast radius rule: any operation affecting more than 5 events requires
confirmation regardless of tier.

---

## 8. DESTRUCTIVE INTENT SAFETY (PARANOID BY DESIGN)

This is the most critical section. One trust-breaking bug ends the MVP.

**Two mandatory layers — both must work:**

**Layer 1 — Parser pre-filter (before LLM):**
DESTRUCTIVE_VERB_RE = /\b(delete|cancel|remove|clear|drop|erase|wipe)\b/i
If matched: set _destructivePreFilter=true, log to failure_logs, continue to LLM.
Flag travels to orchestrator → forces requiresConfirmation=true.

**Layer 2 — Orchestrator preflight (before handler):**
- Tier 0 → always block, requiresConfirmation=true, handler never called
- Tier 1 + destructive → requiresConfirmation=true
- Blast radius > 5 events → requiresConfirmation=true
- _destructivePreFilter=true → requiresConfirmation=true

**THE INVARIANT — must never break:**
"delete" is NEVER re-interpreted as "create."
If classification is ambiguous on a destructive utterance → RESOLVE_MANUAL.
When in doubt → ask. Never assume.

**Confirmation must be explicit:**
User must type "yes", "confirm", or tap Approve.
"ok" and "sure" count. Silence does not count.
Expired confirmations (10 min) are rejected automatically.

---

## 9. AUTONOMY LADDER

| Level | Behavior | Default for |
|-------|----------|------------|
| 1 | Read only | QUERY_CALENDAR |
| 2 | Suggests, waits | — |
| 3 | Drafts, user reviews before send | OFFER_SPECIFIC, PIVOT_ASYNC |
| 4 | Executes with confirmation | All mutations |
| 5 | Executes within user policy | User-promoted only |
| 6 | Full delegation | NOT in MVP |

FLUSH_RANGE and Tier 0 events: Level 4 always. Never promotable to 5.

---

## 10. SHADOW BLOCKS

When OFFER_SPECIFIC generates 2 slots:

1. Both slots soft-blocked on host's calendar immediately
   Status: 'proposed' — visible as "[Proposed] Slot for [Name]"

2. Recipient selects a slot:
   Selected → confirmed, GCal event created
   Other → released

3. Session expires (72 hours):
   Both slots released, host notified

4. Host tries to book over a proposed slot:
   Warning: "You offered this time to [Name]. Book anyway?"

**Why shadow blocks are not confusing (Grok concern):**
The "[Proposed]" label is explicit. Users see exactly what it is.
Without shadow blocks, double-booking is inevitable. Shadow blocks
prevent a worse confusion — two people showing up at the same time.

---

## 11. ERROR HANDLING AND GRACEFUL DEGRADATION

**When Google Calendar API fails:**
- Supabase write succeeds first (source of truth)
- GCal sync goes to compensation_queue for retry
- User sees: "Saved to Caladdin. Your Google Calendar will sync shortly."
- Never: a 500 error exposed to the user

**When Anthropic LLM is unavailable:**
- System switches to DEGRADED_LLM mode automatically
- Keyword-based fallback parser handles basic intents
- User sees: "I'm running in limited mode right now. Basic commands still work."

**When Supabase is unavailable:**
- 503 returned: "Caladdin is temporarily unavailable. Try again in 30 seconds."
- Never: expose DB errors, stack traces, or internal details

**When OAuth access is revoked:**
- Detected on next GCal API call
- User notified: "Your calendar connection needs to be refreshed."
- Link to reconnect shown prominently
- No data lost — Supabase records remain intact

**When utterance times out (LLM slow):**
- 10 second timeout on LLM call
- Graceful: "Taking a moment longer than usual. Try again?"

---

## 12. THE RECIPIENT EXPERIENCE (FAX EFFECT PAGE)

When User A says "Find 2 slots for Alex next week":
1. Caladdin reads User A's calendar, scores slots, picks top 2
2. Shadow blocks both slots
3. Generates link: caladdin.app/s/TOKEN
4. User A sends via SMS, WhatsApp, or any channel

**What Alex sees:**
- Beautiful, warm, personal page — no AI branding anywhere
- User A's name, optional personal note, meeting length
- Exactly 2 specific time options — never a grid, never more than 2
- One click to select
- Green confirmation panel after selection
- Bottom of confirmation — one soft line: "Want this for your own calendar?"
  One button: "Join Caladdin" — no pressure, no popup, no modal

**What Alex must never feel:**
- Processed by an algorithm
- Sold to before he's picked a time
- That he's a lead in someone's marketing funnel

**Design principles:**
- DM Sans body, Fraunces serif headings
- Stone/amber palette — warm, not corporate
- Mobile-first — most recipients open on iPhone
- No "powered by Caladdin" badge
- No AI language anywhere on the page
- Feels like User A chose those times personally

**If slots are taken before Alex responds:**
- Graceful message: "These times are no longer available. [User A] will send
  new options shortly."
- Host notified automatically

---

## 13. FAX EFFECT AND VIRALITY

**Fax Effect — automatic, passive, n²**
Every new user makes the network more valuable for all existing users.
Cannot be engineered faster. Just needs the product to work well enough
that people stay. Happens by mathematics, not by effort.

**Virality — designed, engineered, measured, improved constantly**
k < 1 = network shrinks. k = 1 = flatlines. k > 1 = grows.

For MVP: measure k factor. Do not optimize yet.
Track: invitation acceptance rate, conversion rate after selection,
time to first scheduling win, weekly k factor per cohort.

**Realistic MVP expectation (Grok is right here):**
Do not assume k > 1 from day 1. Target: at least 1-2 organic signups
from recipients in the 10-user test. That proves the loop works.
Optimize from there.

**The viral moment must feel like a gift:**
"Want this for your calendar?" after slot confirmation — one line, one button.
No countdown. No modal. No FOMO language. Warm and optional.

---

## 14. PRIVACY

| What | What Caladdin sees |
|------|--------------------|
| Calendar events | Titles, times, participants via OAuth |
| Email body | Never |
| Attachments | Never |
| Contact list | Only if user explicitly uploads |
| LLM input | Utterance text only — no calendar data sent to LLM |

**Three privacy modes (one tap at signup):**
1. Private — only you see your data
2. Trusted — people you've scheduled with see availability
3. Open — anyone with your link sees free/busy

No-visibility list available from day one.

---

## 15. FEEDBACK MECHANISM

**After each completed action:**
Subtle thumbs up/down — optional, one tap, no friction.

**Weekly:**
One question: "How is Caladdin doing for you this week?"
Star rating 1-5. Optional comment. One tap to skip.

All feedback stored in feedback_logs.
Reviewed weekly by Kanth during 10-user test period.

---

## 16. WHAT CALADDIN WILL NOT DO (MVP)

- Will not send messages to external parties without confirmation
- Will not delete Tier 0 events without explicit approval
- Will not access email body, attachments, or financial accounts
- Will not build contact graphs without explicit permission
- Will not give financial, medical, or legal advice
- Will not act at autonomy Level 6
- Will not share one user's data with another
- Will not harvest contacts without explicit opt-in
- Will not handle 3+ person scheduling
- Will not handle timezone ambiguity silently — always ask
- Will not expose stack traces or internal errors to users
- Will not proceed on expired confirmation tokens

---

## 17. SUCCESS CRITERIA (MVP)

| # | Criterion | Target |
|---|-----------|--------|
| 1 | Users complete onboarding without help from Kanth | 10/10 |
| 2 | First win within 5 minutes of connecting calendar | 10/10 |
| 3 | At least one 1:1 appointment scheduled per user | 10/10 |
| 4 | Zero Tier 0 events mutated without confirmation | 0 violations |
| 5 | Zero "delete → create" class bugs | 0 violations |
| 6 | RESOLVE_MANUAL rate below 10% by week 2 | < 10% |
| 7 | Cal-language redirect working for off-topic input | verified |
| 8 | At least 1 organic signup from recipients | k > 0 |
| 9 | Average satisfaction >= 4/5 stars | >= 4.0 |
| 10 | Schema validator green on every merge | 100% |
| 11 | All tests pass before every push | 100% |

---

## 18. BUILD ORDER (CORE LOOP FIRST)

Prove the core loop before building the viral layer.

**Phase 1 — Core loop (user alone, no recipients):**
| # | What | Why first |
|---|------|-----------|
| 1 | Calendar sync (GCal → Supabase events) | Safety layer needs real events |
| 2 | QUERY_CALENDAR handler | "What's on my calendar" is the daily habit |
| 3 | CREATE_EVENT handler | "Put dinner at 7pm Friday" |
| 4 | Cal-language redirect for off-topic | Core UX before any user touches it |
| 5 | Ambiguity handling in LLM prompt | One precise clarifying question |
| 6 | Chat frontend — Kanth uses it alone first | Prove pipeline works as a product |
| 7 | Onboarding flow (signup → OAuth → first win) | Gate to 10 users |

**Phase 2 — Viral layer (add recipient experience):**
| # | What | Why second |
|---|------|-----------|
| 8 | Shadow blocks implementation | Required before scheduling links |
| 9 | Real slot generation (OFFER_SPECIFIC with free/busy) | Core of 1:1 scheduling |
| 10 | Recipient scheduling page (Fax Effect) | The product friends will see |
| 11 | Viral loop (post-selection signup prompt) | Growth mechanism |
| 12 | Feedback mechanism | Learn from 10 users |

**Phase 3 — Invite 10 users:**
| # | What |
|---|------|
| 13 | Kanth tests every intent personally — 12 utterances minimum |
| 14 | Fix everything that breaks |
| 15 | Send invites to 10 friends |

---

## 19. POST-MVP (DO NOT BUILD NOW)

- Admin panel and stats dashboard
- Subscription and billing
- Caladdin-to-Caladdin invitation processing
- 3+ person scheduling
- CONDITIONAL_RULE
- Full UNDO for FLUSH_RANGE
- Email integration
- Mobile and desktop apps
- Agent layer (prep, debrief, learning curation)
- Financial analysis integration
- Contact upload and graph features
- Tool use API (reliability improvement — v1.1)
