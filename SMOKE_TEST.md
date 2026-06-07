# Smoke Test Protocol

Run before inviting the 10-user cohort or recording CEO demo. **Staging URL required** for sections 1–5.

Set environment:

```bash
export CALADDIN_BASE_URL=https://your-staging.onrender.com
export CALADDIN_API_KEY=your-api-key   # for cron / confirm tests
```

Run automated checks:

```bash
npm test
bash scripts/smoke-staging.sh
```

---

## 1. OAuth

- [ ] Visit `$CALADDIN_BASE_URL/auth/start`
- [ ] Complete Google consent with test account
- [ ] Land on chat UI with session cookie (`caladdin_session`) and CSRF cookie (`caladdin_csrf`)

**Automated:** `smoke-staging.sh` checks `/health` and `/auth/start` redirect.

---

## 2. Twelve utterances (minimum)

Manual — use staging chat after OAuth:

| Utterance | Expected intent |
|-----------|-----------------|
| Block Tuesday mornings for deep work | PROTECT_BLOCK |
| Find 2 slots for Alex next week | OFFER_SPECIFIC |
| Put dinner with Sarah at 7pm Friday | CREATE_EVENT |
| Cancel tomorrow | FLUSH_RANGE (confirm) |
| Move my 3pm to 4pm | MODIFY_EVENT |
| Decline the call from Sarah | PIVOT_ASYNC |
| No meetings before 9am | SHAPE_RULES |
| Treat test@example.com as high priority | GATEKEEP_RULE |
| What's on my calendar today | QUERY_CALENDAR |
| Undo that | UNDO |
| My week is a mess help | RESOLVE_MANUAL |
| The weather is great | warm redirect |

---

## 3. OFFER_SPECIFIC E2E

- [ ] Host receives scheduling link
- [ ] Recipient opens `/s/:token`, selects slot
- [ ] Host calendar shows confirmed event

---

## 4. Confirmation

- [ ] Destructive flush triggers ntfy
- [ ] Approve via `/confirm/:token/approve` with API key
- [ ] Double approve returns 409

**Automated:** `smoke-staging.sh` verifies `/jobs/session-expiry` with API key.

---

## 5. Degradation

- [ ] Invalid Supabase URL → 503 with Retry-After (staging test only — revert immediately)

**Warning:** Only in dedicated staging; never on production.

---

## 6. GDPR endpoints

After OAuth session:

```bash
# Export (requires session cookie from browser — or use curl with exported cookies)
curl -sS "$CALADDIN_BASE_URL/api/user/data" -b cookies.txt | jq .exportedAt

# Delete (staging test account only)
curl -sS -X DELETE "$CALADDIN_BASE_URL/api/user/data" \
  -b cookies.txt -H "Content-Type: application/json" \
  -H "x-csrf-token: YOUR_CSRF_TOKEN" \
  -d '{"confirm":"DELETE"}'
```

- [ ] GET `/api/user/data` returns JSON export
- [ ] DELETE with `{ "confirm": "DELETE" }` removes test account

---

## 7. Automated (required)

```bash
npm test
npm run build
npm run audit:deps
bash scripts/smoke-staging.sh
```

**Sign-off:** All `[PASS]` from smoke script + manual OAuth/E2E items checked.

---

## Completion record

| Field | Value |
|-------|-------|
| Staging URL | |
| Commit SHA | |
| Date | |
| Tester | |
| `npm test` | pass / fail |
| `smoke-staging.sh` | pass / fail |
| OAuth + E2E | pass / fail |
