# Smoke Test Protocol

Run before inviting the 10-user cohort.

## 1. OAuth

- [ ] Visit `/auth/start`
- [ ] Complete Google consent with test account
- [ ] Land on chat UI with session cookie

## 2. Twelve utterances (minimum)

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

## 3. OFFER_SPECIFIC E2E

- [ ] Host receives scheduling link
- [ ] Recipient opens `/s/:token`, selects slot
- [ ] Host calendar shows confirmed event

## 4. Confirmation

- [ ] Destructive flush triggers ntfy
- [ ] Approve via `/confirm/:token/approve` with API key
- [ ] Double approve returns 409

## 5. Degradation

- [ ] Invalid Supabase URL → 503 with Retry-After (staging test)

## 6. Automated

```bash
npm test
```
