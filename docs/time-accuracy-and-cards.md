# Fix Log — Manage Appointment Workflow

## Status: All branches working, timezone fix deployed

Booking, cancelling, and rescheduling all push correctly to Google Calendar.
The edge function timezone guard is deployed and the "Booked by agent" cards
show real appointment data from `agenda_events`.

---

## Bugs fixed

### A–B: Cancel + reschedule cascading failures
- **A:** `source_event_id` was nulled in DB *before* the Google delete call
  → fixed by passing it explicitly and deleting Google first
- **B:** Reschedule created a `start_time: null` stub when no time was parsed
  → fixed by bailing early with "time unclear" toast
- **C:** `extractDateTime` breakpoint: punctuation between date and time
  → relaxed regexes (`[,.]?`) + added `findStandaloneTime` fallback
- **D–F:** AI polluted by ISO timestamps, same-contact events, and
  `item.subject` ("Reschedule appointment") leaking into Google Calendar
  → split calendar context into two sections; PATCH events in-place;
  keep existing title
- **G–H:** Two-pass extraction priority wrong per workflow:
  - **Booking** → contact message first, draft fallback
  - **Reschedule** → draft first (AI states new time upfront), contact fallback
  - **Same-as-existing guard** → re-extracts from draft when extracted time
    matches the old event
- **I:** Cards showed WhatsApp timestamps instead of real appointment times
  → `AppointmentCard` cross-references `agenda_events` for real date/time
- **J:** `thread_id` mismatch on reschedule (mock tests change thread_id)
  → contact-name fallback with ±14-day time window
- **K:** Duplicate "no event found" toast after "already cancelled"
  → added missing `return`

## Edge function (`google-calendar-push`)

- Requests now carry `start_time` and `timezone` explicitly from the frontend
- Date validation: `isNaN` guard on both `startDate` and `endDate`
- `endDate > startDate` guarantee prevents Google's `timeRangeEmpty` 400
- Logging: delete action, API payload (start/end fields), API response
  (what Google actually stored)

## What still needs attention

- The `google-calendar-push` edge function **must be redeployed** after every
  change to `supabase/functions/google-calendar-push/index.ts`. The frontend
  commits and edge function commits deploy separately.
- Run a full test cycle after redeploy: booking → verify Google Calendar time;
  cancellation → verify Google Calendar deletion; reschedule → verify old
  deleted, new created with correct time.
