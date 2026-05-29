# Caladdin — Product Vision v2.0
# Date: April 22, 2026
# Source: Full conversation synthesis + GPT + Grok + Gemini brutal review
# Status: Frozen foundational vision document.

---

## WHAT CALADDIN IS

A personal intelligence layer that starts with time.

The calendar is the most honest behavioral signal we have — not about what
people say they value, but about how they actually spend their time. Every
meeting, block, cancellation, and reschedule is a data point that compounds
into understanding over time.

Caladdin starts as a scheduling assistant and grows into a chief of staff.
But it earns that trust one interaction at a time. No timeline promises.
Each layer is built only when the previous layer is independently loved.

---

## THE ONE-LINE PITCH

"Talk to your calendar like you talk to a smart friend."

---

## HOW PEOPLE USE IT

Users speak or type in plain English — Cal-language. A narrow, natural subset
of English that people use when talking about their time.

Wispr Flow converts voice to text. Caladdin sees text either way.

Examples of Cal-language:
- "Block Tuesday mornings for deep work"
- "Find time for Alex next week"
- "Cancel tomorrow"
- "Am I free Thursday at 2?"
- "No meetings before 9am ever"
- "Tell John I can't do a call — send a Loom instead"

Non-calendar English gets a warm redirect:
"Good to know! Anything I can help you with? Your calendar? Setting up
a time with a friend?"

RESOLVE_MANUAL is for ambiguous Cal-language only. Never for off-topic input.

---

## THE FAX EFFECT

Named after the original fax machine — which was worthless with one user
and essential with a million.

When Kanth sends Alex a scheduling invitation, Alex receives a beautiful,
warm, personal page with exactly 2 specific time options. Not a grid.
Not a Calendly link. Two thoughtful choices that feel like Kanth picked
them personally.

Alex clicks one. Done. He's delighted. He signs up. He sends his own
invitations. Those recipients sign up. The loop compounds.

**The Fax Effect is the value of the network:**
Every new user adds n new instant-scheduling relationships to every
existing user. Value grows as n². Automatic. Passive. Cannot be
engineered faster. Happens by mathematics, not by effort.

**This is why scheduling is the perfect viral surface:**
Every meeting invitation is a marketing touchpoint delivered at the exact
moment of maximum relevance. The product IS the distribution channel.

---

## VIRALITY (DIFFERENT FROM FAX EFFECT)

Virality is how new users arrive. It must be designed, engineered,
measured, and improved constantly. It never stops being worked on.

k = viral coefficient (new users per existing user per month)
k < 1 = network shrinks
k = 1 = flatlines
k > 1 = exponential growth

The recipient scheduling page is the primary viral mechanism.
Every pixel, word, and moment is a virality engineering decision.

**The viral loop:**
User sends invite → recipient gets beautiful page → picks slot →
sees "Want this for your calendar?" → signs up → sends their own invites → repeat

**The anti-spam condition:**
The Fax Effect only works if the recipient feels personally addressed.
The moment it feels like "another AI scheduling tool" — the viral
coefficient turns negative.
- No visible AI branding on recipient page
- No signup prompt before slot selection
- "Want this?" appears after confirmed selection only
- Feels like the sender chose those times, not an algorithm

**Realistic MVP expectation:**
Do not assume k > 1 from day 1. Measure from day 1.
Target: at least 1-2 organic signups from 10-user test.
Proves the loop works. Optimize from there.

---

## THE NETWORK EFFECT (n²)

Every user is equal. No node is more important than another.
Kanth is just one node. Every user is both sender and receiver.

When both parties use Caladdin: zero back and forth. Caladdin reads
both calendars, finds the mutual optimal slot, books it. Done.

When only one party uses Caladdin: beautiful one-sided experience.
Recipient picks from 2 slots. Simple and delightful.

**Value compounds in dense relationship clusters:**
Work teams. Founder networks. Families. Service providers.
Not universal Metcalfe's Law — clustered network compounding.

Within a team of 10 all using Caladdin: near-instant scheduling for
all 45 pairs. That team tells other teams. That is the real compounding.

**Contact upload accelerates this (like WhatsApp):**
When you join, Caladdin shows you which contacts are already on Caladdin.
Scheduling with them is instant. Creates pull pressure — people join
because their network is already there.

**Privacy of contacts:**
Users control visibility granularity.
Contacts default to view-only access.
No-visibility list for specific people or domains available from day one.
User owns the key. Caladdin only sees what they unlock.

---

## THE LOAMG LAYER (Law of Aggregation of Marginal Gains)

Each small improvement compounds. Borrowed from Atomic Habits.

The calendar is the entry point into sensible, safe agentification of life.
It knows what's happening. Agents act on that context.

**The progression (no timeline promises):**
- Today: scheduling
- When scheduling is beloved: energy pattern learning
- When patterns are trusted: meeting prep and debrief
- When prep is valuable: weekly learning curation
- When curation is loved: AI agents orchestrated by calendar context
- When agents are trusted: chief of staff across bounded domains

**What "calendar as key" means:**
The calendar shows what people actually do, not what they say they value.
A recurring meeting someone dreads still appears as a "commitment."
An hour of deep thinking with no calendar block is invisible.
This is signal, not truth. Caladdin treats it as the best early signal
and refines understanding through behavior, corrections, and explicit preferences.

**Agent vision (when it comes):**
Not tools. What people are doing and what helps them do it better.
User blocks time to invest in stocks — Caladdin surfaces relevant market
data with appropriate disclaimers. Not advice. Information.
User has board meeting tomorrow — Caladdin prepares the three agenda
items most likely to come up based on last quarter's notes.

Every agent output in high-stakes domains:
- Labeled as information, not recommendation
- User-initiated only, never proactive in early versions
- Bounded scope — never "act on my behalf" without explicit permission

---

## PRIVACY (ARCHITECTURALLY PRECISE)

| What | What Caladdin sees |
|------|--------------------|
| Calendar events | Titles, times, participants via OAuth |
| Email body | Never |
| Attachments | Never |
| Contact list | Only if user explicitly uploads |
| LLM input | Utterance text only — no calendar data sent to LLM |

**Three privacy modes (one tap at signup):**
1. Private — only you see your data
2. Trusted — people you've scheduled with see your availability
3. Open — anyone with your link sees free/busy

Progressive refinement available. Preferences revealed naturally as
the product is used. Zero cognitive overload at signup.

**What we will never do:**
- Store raw calendar data beyond what features require
- Send calendar content to LLM without explicit user trigger
- Build behavioral profiles without user awareness
- Use contact graph for anything other than scheduling
- Share one user's patterns with another user
- Harvest contacts without explicit opt-in

---

## THE MOAT (why not Google)

Google and Microsoft have tried calendar intelligence. They have failed
to make it social. Caladdin's defensible position:

1. **Cross-platform** — works across Google Calendar, Outlook, Apple Calendar.
   Google's intelligence only works inside Google.

2. **Social coordination UX** — the recipient experience requires product
   obsession that platform companies cannot sustain.

3. **Trust architecture** — tier system, shadow blocks, social context checks,
   autonomy ladder. A dedicated layer can build these primitives.
   A general-purpose assistant cannot prioritize them.

4. **Dense relationship graph** — accumulates scheduling relationship data
   across platforms and organizations. Google only sees Google users.

**What could still kill us:**
- Apple builds this natively into iOS
- We build the agent layer before the scheduling layer is beloved
- One high-profile trust failure on a destructive or socially costly action
- Recipient experience feeling like AI marketing instead of a personal gesture

---

## ECONOMICS

**Token cost per user per year:**

| User type | Utterances/day | LLM cost/year | Total/year |
|-----------|---------------|---------------|-----------|
| Light (50%) | 3 | $0.72 | ~$2.00 |
| Median (40%) | 10 | $2.41 | ~$5.00 |
| Heavy (10%) | 30 | $7.23 | ~$12.00 |

Blended: ~$5.50/user/year

**Pricing:**
- MVP prototype: free (10 users)
- v2 public beta: $10-20/month
- $10/year is below sustainable unit economics
- Heavy users are evangelists — subsidize them intentionally

**Gross margin at $10/month:** ~83% on median user. Business works.

---

## WHAT CALADDIN IS NOT (ever)

- A general-purpose AI assistant
- A financial advisor
- A replacement for human judgment
- A surveillance system
- A social network
- Calendly with AI

---

## THE VISION IN ONE SENTENCE

Caladdin is the scheduling layer that turns every calendar interaction
into a compounding asset — for the user's time, for their relationships,
and for the network that makes everyone's scheduling effortless.
