# "Reply sent (no event found)" — Cancellation Finding Bug

## What the log reveals

```
db lookup {count: 4, existingRows: Array(4), rowErr: null}
           ↓
thread lookup empty; trying date/contact fallback
           ↓
date/contact fallback {matchedCount: 0}    ← 0 of 3 events in time window match
           ↓
contact-only fallback {contactCount: 41, matched: []}  ← 0 of 41 events match contact
           ↓
nothing to cancel for thread
```

**Root cause:** The `thread_id` lookup finds 4 rows, but ALL have `status: 'cancelled'`
(from prior test runs). After filtering out cancelled rows, `toCancel` is empty.
The date/contact fallback searches 41 non-cancelled events but none have
`contact_name` matching `"Lisa Chen"` → **no match**.

**Why contact matching fails:** `eventMatchesContact` requires both tokens `["lisa", "chen"]`
to appear in the event's `title + contact_name + description`. If the 41 events were
created via Google Calendar sync (not WhatsApp), their `contact_name` may be `null`
or formatted differently, so the token match fails.

## Key insight

The cancellation **did work** on the first run (see first DevDocs: found 1 event by
date/contact and cancelled it). On the second run with the same mock data, all
thread events are already cancelled — there's nothing left to cancel.

The toast "reply sent (no event found)" is **technically correct** but misleading:
the user expects cancel to do something, but the event was already cancelled.

## What changes are needed

### E.1 Already-cancelled detection (already in code, needs deployment)

Lines 1289–1296 already handle this case with a dedicated "Already cancelled" toast.
The deployed version (`WhatsappAgent - Copy/dist2/`) doesn't have this code yet.

### E.2 Google Calendar cleanup for already-cancelled events

When the thread lookup finds rows that are ALL cancelled, **check if any still have
a `source_event_id`** (the event survived on Google Calendar even though the DB
says cancelled). If so, push a delete to Google Calendar. This handles the case
where a previous cancellation failed to sync to Google.

### E.3 Widen the fallback search to include cancelled events

When the date/contact fallback runs, include events with `status: 'cancelled'`
that still have a `source_event_id`. These are events that were cancelled in DB
but might still exist in Google Calendar (failed sync). Match them and push a
delete to Google Calendar.

### E.4 Loosen contact name matching

Split the contact name into first+last and try matching just the first name
(or just the last name) as a second-chance fallback. Currently it requires ALL
tokens to match, which fails when `contact_name` on the agenda_event only has
a first name or a different format.

## Implementation order

1. **E.2 + E.3** — Most impactful: when thread lookup finds cancelled events with
   source_event_ids, try Google Calendar cleanup
2. **E.4** — Makes the fallback actually find events when contact names don't
   perfectly align
3. **E.1** — Already done, just needs deployment

## Files changed
- `src/components/dashboard/FlaggedReviewSection.tsx` — cancellation search & fallback logic
