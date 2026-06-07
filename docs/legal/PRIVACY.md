# Privacy Policy (Draft)

**Caladdin** — AI calendar assistant  
**Status:** Stub for legal review — not yet effective  
**Last updated:** 2026-06-07

> This document is a placeholder. Have qualified counsel review before production launch.

---

## 1. Who we are

Caladdin ("we", "us") operates an AI-assisted scheduling service. Contact: **privacy@caladdin.app** (update before launch).

---

## 2. Data we collect

| Category | Examples | Purpose |
|----------|----------|---------|
| Account | Email, display name, timezone | Authentication and preferences |
| Calendar | Google Calendar events (via OAuth) | Scheduling and availability |
| Usage | Voice utterances, intent outcomes | Product improvement and support |
| Booking | Guest email, selected slots | Meeting coordination |
| Technical | Session IDs, IP (via host), logs | Security and reliability |

We do **not** sell personal data.

---

## 3. Legal bases (GDPR)

Where GDPR applies, we rely on:

- **Contract** — providing the service you signed up for
- **Legitimate interest** — fraud prevention, security logging
- **Consent** — where required for optional features

---

## 4. Your rights

You may:

- **Access / export** — `GET /api/user/data` (authenticated)
- **Delete** — `DELETE /api/user/data` with `{ "confirm": "DELETE" }`
- **Correct** — update profile via the app or `PATCH /api/profile`
- **Object / restrict** — contact privacy@caladdin.app

We respond within **30 days** unless law requires otherwise.

---

## 5. Retention

- Active account data: retained while account is active
- Audit logs: retained per compliance needs (typically ≤ 90 days after deletion request processing)
- Backups: may persist up to 30 days after deletion

---

## 6. Processors

| Processor | Role |
|-----------|------|
| Supabase | Database hosting |
| Google | OAuth + Calendar API |
| Anthropic | LLM inference |
| Resend | Transactional email |
| Render | Application hosting |

Subprocessor list to be finalized before launch.

---

## 7. International transfers

Data may be processed in the United States. Appropriate safeguards (SCCs, DPA) to be documented with counsel.

---

## 8. Changes

We will post updates here and notify active users of material changes via email or in-app notice.

---

## 9. Contact

**privacy@caladdin.app**
