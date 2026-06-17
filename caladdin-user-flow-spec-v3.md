# Caladdin — User Flow & Screen Specification
*(v3 — incorporates client's follow-up answers after the June 16 call review)*

A combined scheduling assistant: it finds common meeting time with other people, and also helps you block recurring personal time (meds, workouts, etc.) on your own calendar. Built on Google Calendar integration. Primary interaction model is conversational (typed or voice), not form-driven — see Design Philosophy below.

**Naming note:** the call transcript transcribes the app name inconsistently — "Kaladin," "Caladdin," "Collided," "Skyladen," "Kalendee" — these are all the same app, mangled by call transcription/auto-caption. This doc keeps the spelling from the original sketches, **Caladdin**, but confirm the canonical spelling with the client before it goes anywhere user-facing.

---

## 0. Design Philosophy (from client call — governs every screen below)

The client was explicit and emphatic about a few constraints that should override default instincts when building any screen:

Extreme minimalism is the goal, not a nice-to-have. No unnecessary chrome, navigation, or settings. The client's direct reaction to an early build was that it felt too much like Calendly, and that comparison was raised as a problem to avoid, not a benchmark to hit. Concretely: the invitee-facing screen should show two time slots and nothing else — no app branding, no "Caladdin" wordmark, no chat icon, no settings, no sign-out, nothing in the top bar at all. The client said he'd eventually like to remove settings from the main app too, and that the team should "think about it like that" as a standing design bias even where settings exist for now.

The primary input method is conversation, not forms. The client described wanting to use something like a voice-dictation tool ("whisper flow") to talk to his calendar directly — "block 30 minutes for meditation," "invite info@topicart.co to a meeting with me," "add daily meditation for the next 10 days." Voice input is already integrated on the existing build, so this isn't a future feature to design from scratch — it's an existing input path that the structured screens below need to support as a first-class trigger, not just typed text. Structured screens and form fields (the ones detailed below) should be understood as the fallback/confirmation layer underneath the natural-language command layer, not the primary UX. Forms are acceptable for now strictly for MVP testing purposes ("we can test with temp[late users]"), with the explicit expectation that they get replaced or minimized later.

Setup questions should be asked contextually, not front-loaded. Rather than a blocking onboarding form, the client wants the app to ask for timezone, working hours, default meeting length, etc. in the moment they're actually needed (e.g., the first time the user tries to invite someone and the app doesn't yet know their timezone) — ideally inferred from how the user talks, with explicit Q&A as a fallback when it can't be inferred.

Standard B2C session expectations apply: sign in once, stay signed in. Don't make the user repeatedly authenticate.

---

## 1. High-Level User Flow

```
[Sign Up / Sign In]  (first visit only — persistent session after)
        |
        v
[Connect Google Calendar]  (OAuth — "connect to email and you're done")
        |
        v
[Home: Conversational Interface]  (chat or voice input — primary surface)
        |
        +-- "When the app doesn't yet know something it needs
        |    (timezone, working hours, default meeting length,
        |    when you normally set up appointments), it asks
        |    in-context, once, and remembers the answer."
        |
   +----+--------------------------------------+
   |                                            |
   v                                            v
[Schedule a Meeting Flow]               [Block Personal Time Flow]
   |                                            |
   v                                            v
1. "Invite [email] to a meeting with me"    1. "Block [duration] for [label]"
2. App asks duration if unknown              2. App asks time/duration only
   (e.g. "30 min, or longer?")                  if not already stated
3. App finds common slot(s)                  3. App asks: repeat? if yes,
4. Sends minimal email link to invitee           with end date or without
        |                                            |
        v                                            v
[Invitee Response — bare-minimum screen]    [Confirm action — plain-language
   - Two slots shown, dark background           restatement of what will
   - "Find next common slot" button             be created, before writing
   - Free-text "type preferred time" +          to calendar]
     send/"present" button                            |
   - (Optional) invitee instead shares                v
     scoped, free/busy-only access for     [Appears on calendar — visually
     this invite only (auto-expires) +       distinct from regular events
     a rough hour range, so Caladdin          and from meeting-with-others
     can match against the host's real       events]
     calendar instead of guessing
        |
        v
[System checks proposed/typed time
 against both calendars]
        |
        v
[Confirmation: "Friday 10am is a common
 slot — send it?"] → repeats "find next"
 loop until accepted → Sent → "Cool, done."
        |
        v
[Confirmed — event written to both calendars,
 visually distinct from personal blocks]
```

---

## 2. Screen-by-Screen Specification

### 2.1 Sign Up / Sign In
- First-time visit: shows both "Sign up" and "Sign in" as standard, equally-weighted options — client explicitly wants this to follow normal B2C app convention rather than inventing a custom pattern.
- Returning visit (already authenticated): skip straight to Home. No repeated sign-in prompts.

### 2.2 Connect Calendar
- Single screen, single action: connect Google Calendar via OAuth.
- Client's framing: "you connect to email and you're done" — this should feel like one tap, not a multi-step wizard.
- On success → routes straight into the conversational Home screen, **not** into a setup form.

### 2.3 Home — Conversational Interface
- This is the primary surface, not a dashboard of cards. Chat-style (typed) and/or voice input, where the user issues natural-language commands like:
  - "Invite info@topicart.co to a meeting with me"
  - "Block 30 minutes for meditation"
  - "Add daily meditation for the next 10 days"
  - "Plan my day" / "Plan for today"
- The app parses the command and either (a) acts directly if it has enough information, or (b) asks a short, specific follow-up question if something's missing (see 2.4).
- A read-only weekly calendar view can sit alongside or below the conversation surface so the user can see the result of their commands land on the calendar.

### 2.4 Contextual Setup Questions (no longer a separate onboarding screen)
Triggered the first time the app needs information it doesn't have yet — not shown upfront. Once answered, the app should remember the answer and not ask again. The questions, as specified by the client:
1. **Timezone**
2. **Normal working hours** ("when you set up appointments")
3. **When you normally prefer to set up appointments** (e.g., a time-of-day preference)
4. **Default meeting length** (e.g., 30 minutes vs. 1 hour) — the client's own example: app asks, defaults to suggesting 30 minutes, user can instead say "I want a 90 minute meeting."

For MVP/testing purposes only, these can be presented as an explicit short form rather than fully inferred from conversation — the client was clear this is acceptable as a temporary simplification, not the long-term target.

### 2.5 Schedule-a-Meeting Command Flow
- Triggered by a natural-language command (e.g., "invite [email] to a meeting with me") rather than a dedicated "new invite" screen/button.
- If meeting duration isn't specified in the command, the app asks once (defaulting to the user's stored default length, e.g. 30 minutes) and accepts an override (e.g. "90 minutes").
- App computes a common time slot (or a short list, per the sketches — two slots) between the host and invitee, then sends a minimal email link to the invitee. No invitee account is required — the client confirmed explicitly that an invited person is "not technically a member of Caladdin yet."

### 2.6 Invitee Response Screen — must be the most stripped-down screen in the product
Per the client's direct critique of an earlier build, this screen must contain **only**:
- A header line identifying who's inviting them (e.g., "Kanth is inviting you to a meeting").
- Exactly two suggested time slots, shown as simple selectable options (e.g., "Tue, 10:00 AM" / "Wed, 11:00 AM").
- A **"Find next common slot"** button, for when neither offered time works.
- A free-text field to type a preferred time (e.g., "Friday"), with a send/"present" action.
- **Nothing else.** No app name/logo, no chat, no settings, no booking-link-style page, no sign-out. The client was explicit that this list is exhaustive, not a starting point.
- Visual style: client's stated preference is a **dark background**, not light, for this screen specifically.

Flow once the invitee acts: if they pick one of the two offered slots, it's accepted directly. If neither works, the invitee has two options: type a different preferred time (checked against both calendars, with the confirm/reject loop described below), or share lighter-weight availability so the system can match properly — in which case the invitee grants the scoped, single-invite calendar access described in 2.7, then specifies a rough window they're generally okay with (e.g., "between 9am and 2pm"), and Caladdin matches that window against the host's actual calendar to propose a real common slot. Either path ends the same way: the system responds with a plain-language confirmation (e.g., "Friday 10am is a common slot — send it?"), which the invitee can accept ("send it") or reject in favor of another suggestion ("find next"). This confirm/reject loop repeats until a time is accepted, ending in a simple acknowledgment ("Cool, done").

### 2.7 Alternate Path: Scoped Availability-Sharing Grant (research-backed recommendation)
New flow surfaced in the transcript, not present in the original sketches. If the two auto-suggested slots don't work for the host, instead of continuing to cycle through suggestions, the host can let the invitee see real availability directly and pick a time themselves, rather than choosing between a short list.

The client's instinct — "maybe it's per-instance access" — turns out to be the right one, and it matches how established scheduling and calendar-API tools actually solve this problem. The recommendation below avoids two bad extremes: asking the invitee to grant full, permanent OAuth access to their calendar (way too much trust and friction for a one-off meeting), and trying to do this with no security model at all (a guessable or reusable link that exposes calendar data to anyone who gets it).

**Recommended approach: a scoped, single-purpose, expiring access token tied to one invite, not a standing account-level OAuth grant.**

Concretely, this means three things. First, free/busy only, never full calendar read. The invitee should never be granting "read my whole calendar," only a free/busy signal — i.e., which time ranges are open or busy, with no event titles, descriptions, or attendees exposed. This is a well-established lower-trust tier; Google's own Calendar API and comparable tools like Cronofy explicitly separate "full calendar access" from a "free/busy only" access mode for exactly this reason — it gives users meaningfully less to be nervous about granting, which matters a lot for a non-technical invitee clicking a link from someone they may not know well.

Second, scope the grant to one invite, not one person. Rather than the invitee creating any kind of standing Caladdin account or OAuth connection, the access token generated when they click "let me see their availability" should be tied to that specific invite only — single-purpose, automatically invalid once that invite is resolved (accepted, expired, or cancelled), and not reusable for any other invite even from the same host. This is the "per-instance" model the client proposed, and it's also what dedicated lightweight scheduling tools do for one-off meetings: generate a scoped, time-limited link rather than a durable account-level grant, with everything tied to that single transaction expiring automatically afterward.

Third, the invitee still needs their own lightweight calendar connection to make this work — but it should be presented and scoped as "share your availability for this meeting," not "connect your calendar to Caladdin." Practically: if the invitee's calendar is Google Calendar, this is a standard Google OAuth consent screen, but requested with the narrowest possible scope (free/busy, not full calendar read/write) and explicitly framed in Caladdin's own UI copy as a one-time, single-meeting share rather than an account connection — incremental, least-privilege scope requests are exactly what Google's own OAuth guidance recommends, and it directly addresses the trust concern non-technical users have about what they're "signing up for."

What this means for the invitee's screen (2.6): a new third option alongside the two suggested slots and the "type a preferred time" box — something like "Or let me check your real availability" — which kicks off the scoped OAuth consent described above, then shows the invitee their own open slots (computed against the host's calendar) to pick from directly.

What this means for revocation/expiry: the token tied to the invite should expire automatically once the invite resolves (accepted/declined/cancelled) or after a short fixed window (e.g., 24–48 hours) if the invitee never acts on it, so there's no lingering access sitting around to forget about or audit later — this also matches the failure mode security researchers flag most often with OAuth in general: standing grants nobody remembers exist months or years later.

### 2.8 Block Personal Time — Command Flow
- Triggered conversationally: "Block 30 minutes for meditation," "Block one hour for planning," etc.
- The app asks only for whatever wasn't already stated in the command:
  - **When** (if not given)
  - **How long** (if not given)
  - **Repeat or not** — if recurring, **with an end date** or **without an end** (open-ended).
- Important interaction detail from the transcript: if the user already specified time and/or duration in their command, the app must **not** ask again — re-asking for information already given was specifically the kind of confusing redundancy the client was frustrated by.
- Any time the app is about to take an action based on a parsed natural-language command, it should show a plain-language confirmation of exactly what it's about to do (e.g., "Add daily meditation reminder, 7:00 AM, for the next 10 days?") before committing it. The client hit a confirmation dialog during testing that didn't clearly state what it was confirming — confirmation copy needs to restate the parsed action in full, ordinary language, not a vague "Please confirm this action."

### 2.9 Calendar Display
- Personal blocks (meditation, workouts, etc.) and meetings-with-others should both appear on the calendar, but **visually distinct from each other** as well as from ordinary external events — the client wants to be able to glance at his calendar and tell at a sight whether something is a personal block or a meeting with another person.

### 2.10 Existing Settings: Calendar Visibility / Sharing (flagged for simplification)
Surfaced during the call as an existing feature the client found confusing and couldn't parse from the labels alone. Current options appear to be:
- A general visibility mode (e.g., "Private" — only the user sees their own events).
- Friends can see events.
- "Close contacts can see more context on shared links" — i.e., a higher-trust tier sees more detail than a general shared link would show.
- "Guests see titles on your public availability view" — i.e., people viewing a shared availability link see event titles, not just busy/free blocks.

This is existing functionality, not something to build from scratch, but it's explicitly flagged: the current copy/labels did not make sense to the client in testing ("nobody will get it"). See section 4 for a concrete recommendation on simplifying this down to three plain-language tiers rather than four jargon-heavy ones, while keeping the existing permission logic underneath intact.

---

## 3. Data Model Notes (for Cursor implementation)

Suggested core objects:

- **User**: id, email, timezone, working_hours_start, working_hours_end, default_meeting_length, meeting_time_preference, google_oauth_token
- **Invite**: id, host_user_id, invitee_email, duration_minutes, status (pending / accepted / declined / expired), proposed_slots[], confirmed_slot, created_at
- **InviteCalendarGrant** (new — backs the 2.7 flow): id, invite_id (one-to-one with a single Invite, never reused across invites), invitee_oauth_token (scoped to free/busy only), preferred_window_start, preferred_window_end, status (active / expired / revoked), expires_at (auto-set on creation, e.g. now + 48h, and also force-expired the moment the parent invite resolves)
- **PersonalBlock**: id, user_id, label, start_time, duration_minutes, repeat_rule (none / daily / weekly / custom), repeat_end_date (nullable for "no end"), google_event_id
- **CalendarEvent** (synced from Google): id, google_event_id, source (caladdin_invite / caladdin_block / external), start_time, end_time
- **CalendarSharingSetting**: user_id, visibility_tier (private / friends / close_contacts / guests_public), tier_detail_level — corresponds to 2.10, included here since it already exists in some form
- **CommandLog** (new, given the NL-command-first model): id, user_id, raw_input (text or transcribed voice), parsed_intent, parsed_params, confirmed (bool), resulting_action_id — useful both for the confirm-before-acting step in 2.8 and for debugging "the app didn't understand me" cases like the one in the call

## 4. Open Questions (updated again after client follow-up)

**Resolved in the original transcript pass:**
- Invitee account requirement → No account needed; explicitly confirmed by the client.
- Whether common-slot-finding is meant to be genuinely two-way → Yes — the client's own example command is "find the next common slot between [invitee] and me," confirming true mutual availability matching is intended.
- The "Talks/chats" label from the original sketch → Refers to the conversational interface itself (voice or chat), the primary way the user interacts with the whole app.

**Resolved by the client's latest answers:**
- Secure mechanism for invitee calendar access (2.7) → Resolved with a researched recommendation: a free/busy-only, single-invite-scoped, auto-expiring access grant — not a standing OAuth connection or full calendar read. Full reasoning and implementation shape are in section 2.7.
- Voice input integration → Already built into the existing app; not an open design question, just something the spec needs to treat as a first-class input path alongside typed chat.
- Two-way matching mechanism (2.6/2.7) → The invitee shares lighter-weight availability (via the scoped grant in 2.7) and specifies a rough hour range they're generally okay with; Caladdin matches that range against the host's real calendar to propose an actual common slot.
- Calendar-sharing-tier settings (2.10) → Client deferred to "whichever is most efficient yet best UX." Recommendation: collapse the four current tiers (private / friends / close contacts / guests-public) down to three plain-language options that map to the same underlying permission levels but read clearly to a non-technical user — something like "Just me," "People I share a link with see times only," and "People I share a link with see full event details." This keeps the existing permission logic intact (no backend rework needed) while fixing the actual problem the client hit, which was the labels, not the underlying model. Worth a quick confirmation with the client once mocked up, but doesn't need to block the rest of the build.

**Still genuinely open:**
- What exactly the hatched/crossed-out column in the page-3 weekly grid sketch represents — client chose to skip this one for now; revisit if it becomes relevant once the weekly grid view is actually built.
