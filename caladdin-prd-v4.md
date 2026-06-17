# Caladdin — PRD v4: Mutual Availability Completion + Conversational Intelligence Rebuild

Status: Draft for review
Owner: [you]
Scope: Two work streams. Stream A closes the gaps in the v3 mutual-availability implementation that Cursor's own audit flagged as incomplete. Stream B replaces the current rigid intent-matching layer with an actual LLM-driven assistant (Claude, via the Anthropic API) that can understand free-form scheduling requests, ask for whatever's missing, and execute against the calendar — instead of returning "I can only help with X."

---

## 0. Why this document exists

Two separate problems surfaced from testing the current build:

The mutual-availability feature (finding a time that works for both the host and an invitee) is real and partially working, but only inside one specific flow — the scoped invite-link grant. Every other path that should also produce a mutual slot (the host typing "invite John to a meeting" in chat, the host typing a preferred time and expecting it checked against both calendars) either silently falls back to host-only availability or isn't wired up at all.

Separately, and more urgently from a product-feel standpoint: the assistant itself is brittle. It's running on what looks like a closed-vocabulary intent classifier — a fixed list of phrases or regex patterns it matches against — so anything outside that list returns a canned "I can only help with X" deflection instead of the assistant doing the obviously correct thing, which is to recognize "book a slot on my calendar" as a scheduling request, figure out what's missing, ask, and act. This is the more damaging issue because it's what every user touches on every turn, regardless of which calendar feature is involved.

Both streams are described below as a single PRD because Stream B's redesign is what makes Stream A's remaining gaps actually reachable by users in the first place — there's limited value in fixing the host-chat-to-grant-flow gap if the chat layer that triggers it is too rigid to recognize the request.

---

## 1. Stream A — Closing the mutual-availability gaps

### 1.1 Current state (confirmed working)

Two paths already produce genuine two-calendar matching today, and the rebuild in Stream B must not regress either of them.

The invite-link path is solid: a host sends an invite, the invitee opens `/s/:token`, taps "Share your availability for this meeting only," completes a scoped Google OAuth limited to `calendar.freebusy`, and from that point `findMutualSlots()` in `mutual_slot_engine.ts` runs against both calendars' real free/busy data. The "find next common slot" action on that page (`POST /s/:token/next-slots`) correctly uses true two-calendar matching whenever a grant is active, and only falls back to host-only slots when it isn't.

Separately, when a host invites someone who is already a registered Caladdin user with their own Google Calendar connected, `generateSlots()` can pull that second person's busy time directly via `fetchRecipientBusy()` in `slot-scoring.ts`. This is a different code path from the invite-grant flow above, and it works independently of it.

### 1.2 Gaps to close

**Gap A1 — Initial offer is host-only, even when it doesn't need to be.**
When a host first creates an invite, the two slots offered up front are computed from the host's calendar alone, because the invitee hasn't granted access yet — by definition, at invite-creation time, there's nothing else to check. This is structurally fine *as a default*, but it currently has no escape hatch for the one case where it doesn't need to be a guess: if the invitee is already a known Caladdin user (the `fetchRecipientBusy()` case above), the system should use that real data for the initial offer instead of guessing, since the information already exists at invite-creation time and there's no reason to wait for a separate grant flow.

Fix: at invite creation, before falling back to host-only slot generation, check whether the invitee email matches an existing Caladdin user with calendar connected. If so, route through `fetchRecipientBusy()` + the existing scoring logic immediately, rather than only doing this cross-check later in the host-chat path. If not, fall back to host-only slots as today, and surface the grant-link path as the way to upgrade to mutual once the invitee opens the link.

**Gap A2 — Host chat path doesn't use the grant flow at all.**
The conversational "invite someone" command (OFFER_SPECIFIC intent) currently only checks the already-a-Caladdin-user case; it has no awareness of the v3 scoped-grant mechanism and can't trigger it, check its status, or react once a grant resolves. Practically, this means a host who says "find a time with someone who isn't on Caladdin" gets a host-only guess with no path to upgrade to real mutual availability unless they separately know to send an invite link and the invitee separately knows to click "share availability."

Fix: OFFER_SPECIFIC's slot-generation step needs to call the same gap-A1 check (is this email a known user?) and, if not, needs to know that an invite link with a grant option is the correct artifact to produce — and needs to be able to tell the host that's what happened ("I've sent Jane a link — once she shares her availability I'll find a time that works for both of you," not silence or a flat host-only slot presented as if it were already mutual). This is as much a conversational-honesty fix as a backend fix: the assistant should never imply two-calendar matching happened when it didn't.

**Gap A3 — No conversational confirm/reject loop against both calendars.**
The original v3 spec describes a host being able to type a preferred time in chat and have the system check that specific time against both calendars, then confirm or reject and offer alternatives — not just receive a pre-computed list. That loop isn't clearly wired through `mutual_slot_engine.ts` today; the engine can produce a list of mutual slots, but there's no clean entry point for "is 3pm Tuesday open for both of us" as a single targeted check.

Fix: add a targeted-slot-check function alongside `findMutualSlots()` — same underlying free/busy data, but answering a yes/no-plus-reason question for one candidate time rather than enumerating a list. This is what Stream B's tool-calling layer will actually invoke when a host says "does 3pm Tuesday work," so it needs to exist as a callable unit, not just as a byproduct of the list-generation path.

**Gap A4 — Production readiness.**
Phase 10 (full end-to-end QA, pilot feature flag) was never completed, and `{BASE_URL}/s/grant/callback` needs to be registered in the Google OAuth console for the grant flow to function outside of local/dev testing. Until both are done, the parts of Stream A that already work in code haven't been verified working in a real deployed environment, and the grant flow will hard-fail in production regardless of how correct the code is.

Fix: this is tracked as its own milestone (1.4 below) rather than folded into the other gaps, since it's verification and configuration work rather than new logic.

### 1.3 Out of scope for this PRD

Multi-invitee mutual availability (three or more calendars at once) is not addressed here — current scope is one host plus one invitee. Non-Google calendar providers remain out of scope, consistent with the existing Google-only architecture. Recurring-meeting mutual availability (finding a slot that recurs weekly for both parties) is also out of scope; this PRD covers single-instance meetings only.

### 1.4 Stream A milestones

The OAuth callback URL registration and the host-known-user shortcut (Gap A1) are pure backend/config work and can ship independently of Stream B. Gap A2 (wiring the grant flow into host chat) depends on Stream B's tool-calling architecture being in place, since "tell the invitee a grant link is the next step and explain that to the host in plain language" is exactly the kind of response Stream B is meant to generate — building it against the old rigid layer would mean rebuilding it again immediately after. Gap A3 (targeted slot-check) is backend logic that Stream B's tool layer will call, so the function itself can be built in parallel with Stream B but its only real caller is the new conversational layer. Phase 10 production QA happens last, after both streams are integrated, since it's meant to validate the whole system rather than either piece in isolation.

---

## 2. Stream B — Making the assistant actually intelligent

### 2.1 What's wrong today

Based on the reported behavior ("book a slot on my calendar" returning "I can only help with X, not this"), the current conversational layer is almost certainly built as a closed intent classifier: a fixed set of recognized phrasings or patterns (OFFER_SPECIFIC, PROTECT_BLOCK, and whatever else exists), each mapped to a hardcoded handler, with anything that doesn't match closely enough falling through to a generic refusal. That architecture is the actual root cause, not a tuning problem — no amount of adding more regex patterns or example phrases will make a closed classifier handle the open-ended range of ways people actually ask to schedule things. The fix is architectural: replace the classification step with an LLM (Claude) that does real natural-language understanding, decides what to do, asks for what's missing, and calls backend functions to act — rather than matching against a fixed list.

This matters because the product's own design philosophy (confirmed in the original spec work) was always conversational-first: voice or typed natural language as the primary interface, with screens and forms as fallback. The current intent-classifier implementation doesn't deliver on that philosophy; it just looks conversational on the surface while behaving like a form underneath.

### 2.2 Target architecture: Claude as the scheduling agent, via tool use

Replace the existing intent-matching step with a Claude-powered agent loop using the Anthropic Messages API with tool use (function calling). Concretely:

Every user message (voice-transcribed or typed) goes to Claude along with a system prompt describing Caladdin's role, the user's known context (timezone, working hours, default meeting length, today's date, a summary of the current week's calendar), and a set of tool definitions that map to the backend's actual capabilities: finding available slots (host-only or mutual, per Stream A), checking whether a specific candidate time is free for one or both calendars, creating a calendar event, creating a recurring block, sending an invite (with or without a grant link), looking up whether an email belongs to an existing Caladdin user, and updating stored user preferences (timezone, working hours, default meeting length).

Claude decides, per message, whether it has enough information to call a tool directly, needs to ask one clarifying question first, or is handling something conversational that needs no tool at all (e.g., "what's on my calendar tomorrow" is a read, not a write). This replaces the rigid OFFER_SPECIFIC / PROTECT_BLOCK keyword matching with the model actually reasoning about intent — "book a slot in my calendar" is unambiguous enough that Claude should recognize it as a scheduling request immediately and ask the one or two questions actually needed (what's the event, when, how long) rather than refusing.

The system prompt should explicitly tell Claude what NOT to do: never confirm an event was created without having actually called the create-event tool and received success back, never claim mutual availability was checked unless the mutual-slot tool was actually invoked, and never silently fall back to host-only slots without telling the user that's what happened (this directly serves Gap A2's honesty requirement above). This matters more here than in a typical chatbot integration, since a scheduling assistant that hallucinates a successful booking is actively harmful, not just unhelpful.

### 2.3 Conversational design requirements

The replacement layer needs to actually behave the way the original product spec intended, which the current build doesn't:

When information is missing, Claude asks one short, specific follow-up question, not a list of questions or a form. If the user says "schedule a meeting with Jane," and there's no duration or proposed time, Claude asks for the one most useful piece of missing information first (typically: when, since duration can default to the stored preference) rather than interrogating the user across multiple turns.

When the user supplies a default-eligible field (duration not specified), Claude uses the stored default rather than asking, and only surfaces that default in its response if it's not obvious from context ("I'll set this for 30 minutes, your usual length — let me know if you'd rather make it longer").

Once Claude has enough information to act, it should act, not ask for confirmation on something the user already specified clearly. Asking "are you sure you want to book Tuesday at 3pm" when the user already said exactly that is the wrong instinct and contradicts the minimalism design goal; confirmation should be reserved for cases involving real ambiguity, a conflict with an existing event, or actions with consequences the user might not anticipate (e.g., a recurring block running indefinitely).

The assistant must distinguish between read operations (what's on my calendar, am I free Tuesday) and write operations (book this, block this time), and must always state plainly when a write actually happened ("Booked: 30 min with Jane, Tuesday 3pm") rather than a vague acknowledgment that leaves the user unsure whether anything was actually saved to the calendar.

### 2.4 Tool definitions (first pass)

This is a starting set; the engineering team should refine exact parameter shapes against the existing backend functions named in Stream A, but the intent-to-tool mapping should look roughly like this. A `find_available_slots` tool wraps the existing slot-generation logic (host-only or mutual depending on whether the invitee is known, per Gap A1) and takes a duration, optional date range, and optional invitee email. A `check_specific_slot` tool wraps the new targeted-check function from Gap A3 and takes a candidate datetime plus optional invitee email, returning whether it's free for one or both calendars. A `create_event` tool wraps actual calendar write logic and takes title, start time, duration, and optional attendee email. A `create_recurring_block` tool wraps the personal-block creation logic (medication, workouts, etc.) and takes title, time, duration, recurrence rule, and end condition. A `send_invite` tool wraps the existing invite-creation and grant-link logic and takes invitee email, duration, and optionally a specific proposed time versus "let them pick from mutual slots." A `lookup_user` tool checks whether an email belongs to an existing Caladdin user with calendar connected, used internally before deciding whether `find_available_slots` can run mutual matching immediately or needs the grant flow. A `get_calendar_summary` tool returns a read-only view of a given day or week, used for "what's on my calendar" style requests that need no write action at all. A `update_preferences` tool handles the contextual-setup fields (timezone, working hours, meeting-time preference, default duration) the first time they're needed, consistent with the original spec's "ask once, remember after" requirement.

### 2.5 What changes for the user, concretely

Today: user says "book a slot in my calendar," gets "I can only help with X, not this."

After this change: user says "book a slot in my calendar," Claude recognizes this as an event-creation request with two pieces of information missing (what the event is, and when), asks the single most useful clarifying question — most naturally "what's the meeting about, and when works for you?" or, if the user already gave a time but no title, just "what should I call this?" — and once it has enough, calls `create_event` and confirms with the specific details that were actually saved.

Today: user invites someone who isn't a Caladdin user, gets a host-only guess presented with no indication it's a guess.

After this change: Claude calls `lookup_user`, finds no match, calls `send_invite` with the grant-link path, and tells the user plainly: "I've sent an invite to [email]. Once they share their availability, I'll find a time that works for both of you — for now, here's a time that works on your end" (paired with the same host-only offer as today, but now honestly framed).

### 2.6 Things to get right that are easy to get wrong

Latency matters for a conversational interface — every message round-tripping through an LLM call plus one or more tool calls needs to feel fast enough for chat or voice, which likely means streaming the response and keeping the system prompt lean (passing a calendar summary, not the user's entire calendar history, for instance).

The model should not be allowed to invent tool results. If a tool call fails (calendar API error, OAuth token expired), Claude needs to tell the user honestly that something didn't work rather than improvising a plausible-sounding success message — this is a known failure mode for tool-calling agents and needs explicit handling in the system prompt and in how tool errors are passed back to the model.

Voice input specifically needs the same intelligence applied to transcription artifacts — a voice transcript saying "book a thirty minute call with jane tomorrow at free" (a mis-transcribed time) should prompt a clarifying question about the actual time rather than either failing silently or guessing at a time that wasn't said.

The existing PROTECT_BLOCK rules (no re-asking about a recurring personal block once set, confirmation gating, calendar-source metadata for styling) need to be preserved as behavior, even though the mechanism producing that behavior is changing — these should become part of the system prompt's instructions and the tool layer's validation logic, not be lost in the rebuild.

### 2.7 Suggested rollout

Build the tool layer first against the backend functions that already exist (most of Stream A's working paths plus the standard create/read calendar operations), with the new targeted-slot-check function from Gap A3 added alongside. Get Claude calling those tools correctly in a test harness before touching the live chat UI. Then swap the chat endpoint over behind a feature flag, running side by side with the existing intent classifier for an internal pilot, specifically testing the exact phrasings that currently fail ("book a slot in my calendar" and similar open-ended requests) alongside the existing OFFER_SPECIFIC and PROTECT_BLOCK test cases to confirm no regression. Once that pilot looks solid, retire the old classifier rather than keeping both running indefinitely — maintaining two parallel intent-handling systems long-term is its own source of bugs.

---

## 3. Summary of what ships, and in what order

First, register the OAuth grant callback URL in production and ship the host-known-user shortcut for initial mutual slots (Gap A1) — independent backend work, no dependencies. Second, build the targeted-slot-check function (Gap A3) and the full tool-calling layer around Claude (Stream B section 2.2–2.4) together, since the tool layer is what will actually call the targeted-check function. Third, wire the grant-flow-awareness into the new conversational layer (Gap A2), which is now straightforward once Stream B exists, since it's just another tool the agent can call and another fact pattern for it to explain honestly to the user. Fourth, run the pilot rollout (section 2.7) and complete Phase 10 production QA (Gap A4) against the fully integrated system, not against the old pieces in isolation.
