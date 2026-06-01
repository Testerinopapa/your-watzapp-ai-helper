# Calendar Pipeline Diagnostic: Reply → Google Calendar

## Scope

The pipeline from "Manage Appointment" click → AI draft → Google Calendar mutation is broken at multiple points. This document catalogs every break point found, ranked by severity.

## Pipeline Anatomy

```
User clicks "Manage Appointment"
  → callDraftFunction()
  → Pre-draft: sync Google Calendar, build CALENDAR CONTEXT + rules → instruction
  → POST to draft-whatsapp-manual (autoSend: true) → AI generates & sends reply
  → Post-draft: detect intent on AI's draft text
  → if cancellation → find agenda_events row → update status → push delete to Google
  → if reschedule → cancel old → create new → push upsert to Google
  → if confirmation → upsert agenda_events → push upsert to Google
```

---

## CRITICAL: `source_event_id` nullified BEFORE push — Google Calendar never updated

**Files:** `FlaggedReviewSection.tsx` + `google-calendar-push/index.ts`

### Cancellation path (lines 1194-1223)

The cancellation block does these steps in order:

```
A. UPDATE agenda_events SET source_event_id = NULL WHERE id = existing.id   ← NULLIFIED
B. invoke google-calendar-push { agenda_event_id: existing.id, action: "delete" }
   → push reads the row: source_event_id is NULL
   → push returns { ok: true, skipped: "no_google_event" }
   → GOOGLE CALENDAR IS NEVER TOUCHED
C. Frontend shows toast: "Cancelled & removed from Google Calendar" ← LIE
```

The `skipped` field in the push response is never inspected by the frontend. The code at line 1206 checks `existing.source_event_id` (in-memory, pre-nullification) and enters the push block — but the push function reads from the database where the row is already nullified.

**Same bug in reschedule path** (lines 1266-1282): old event is cancelled the same way — nullified before push, then push skips.

### Fix

Pass `source_event_id` explicitly in the push request body, and nullify AFTER the push succeeds:
```
await supabase.functions.invoke("google-calendar-push", {
  body: {
    agenda_event_id: existing.id,
    action: "delete",
    source_event_id: existing.source_event_id,  // ← pass explicitly
  },
});
// THEN nullify in the DB:
await supabase.from("agenda_events").update({ source_event_id: null }).eq("id", existing.id);
```

---

## HIGH: Duplicate events on repeat confirmations

**File:** `FlaggedReviewSection.tsx` lines 1374-1397 + `google-calendar-push/index.ts` lines 189-199

### Sequence

1. First confirmation: upsert row with `(source_type: "whatsapp", source_event_id: thread_id)` → push creates Google event
2. Push writes back `source_type: "google_calendar"`, `source_event_id: <google_event_id>` on the same row
3. Second confirmation for same thread: upsert tries `(source_type: "whatsapp", source_event_id: thread_id)` — but this row no longer exists (the original was rewritten to `source_type: "google_calendar"`)
4. **A second row is INSERTED** — duplicate in `agenda_events`, duplicate in Google Calendar

### Fix

Either: use `thread_id` alone as the deterministic key for WhatsApp-sourced events (separate from the upsert conflict clause), or preserve `source_type: "whatsapp"` on the original row while tracking the Google event ID in a different column.

---

## HIGH: `looksLikeCancellation` regex doesn't match AI draft language

**File:** `src/lib/extractDateTime.ts` lines 358-364

### Problem

The regex explicitly excludes bare "cancel":
```
// "not bare 'cancel'"
return /\b(cancelled|canceled|cancelling|...)\b/i.test(lower);
```

The AI's cancellation reply is empathetic: *"I understand you want to cancel your appointment."* — contains "cancel" but NOT "cancelled" or "cancelling". The regex returns `false`.

The cancellation block at line 1179 (`if (isScheduling && looksLikeCancellation(draftText))`) never enters. The post-draft intent check is performed on the **AI's draft text** (line 1171), not the **incoming message**. The pre-draft check (line 1076) correctly identifies cancellation from the incoming message and provides cancellation rules, but the AI writes a polite reply that doesn't contain the required conjugated forms.

### Fix

Change the regex to include `cancel` as a bare verb, or detect intent on the incoming message instead of the draft text, or use the pre-draft `isCancellation` variable (line 1077) to gate the post-draft block.

---

## MEDIUM: Calendar context silently overflows 8000-char limit

**File:** `FlaggedReviewSection.tsx` lines 1089-1092

```typescript
instruction = `${calendarBlock}\n\n---\n\n${userInstruction}${calendarRules}`.slice(0, 8000);
```

Each event line includes verbose ISO timestamps (~100+ chars per event). With ~50 busy blocks:
- `calendarBlock` = 5000 chars (preserved in full — comes first)
- Header + calendar rules = ~500 chars
- Remaining budget for `userInstruction` = ~2500 chars — silently truncated at end

No warning, no error. The AI never sees the latter part of the instruction.

### Fix

Truncate `calendarBlock` first (limit events to top N), not the instruction at the end. Add a warning toast if truncation occurs.

---

## MEDIUM: Timezone — sync stores null when Google omits timeZone

**File:** `supabase/functions/google-calendar-sync/index.ts` line 139

```typescript
timezone: it.start?.timeZone ?? null,
```

Google Calendar API doesn't always return `start.timeZone` (IANA name). When absent, `timezone` is stored as `null`. PostgreSQL normalizes `TIMESTAMPTZ` to UTC. A 10am America/New_York event becomes `14:00 UTC` in the DB with `timezone = NULL`. Every downstream consumer that falls back to browser timezone (UTC on many servers/CI environments) displays 2pm instead of 10am.

### Fix

Fall back to extracting the offset from `start.dateTime` (e.g., `-04:00` → `"America/New_York"`), or the user's default timezone from their profile, or the calendar's primary timezone from the Google Calendar list API.

---

## MEDIUM: PersonalAgendaPanel falls back to browser timezone

**File:** `src/components/dashboard/PersonalAgendaPanel.tsx` line 104

```typescript
const tz = entry.timezone || undefined;  // null → undefined
// ...
new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(start);
```

`timeZone: undefined` means "use browser timezone." If the browser is UTC and the event is Eastern, 10am shows as 2pm. This is the direct symptom the user reported.

### Fix

When `timezone` is null, parse the UTC offset from the ISO string: `/([+-]\d{2}:\d{2})$/`. Map common offsets to IANA names as a fallback.

---

## LOW: AI context block uses single browser timezone for all events

**File:** `FlaggedReviewSection.tsx` lines 1039-1066

The `tz` variable is the browser's timezone, applied to ALL events regardless of each event's `timezone` field. The query selects `timezone` from the DB but never uses it. The AI sees all events translated to the browser's timezone, which may shift times by hours.

---

## LOW: Calendar sync overwrites event status to "imported"

**File:** `supabase/functions/google-calendar-sync/index.ts` line 140

```typescript
status: "imported",
```

Every sync resets status to `"imported"`, overwriting any manual `"confirmed"` or `"cancelled"` status. Syncs happen before every "Manage Appointment" click.

---

## LOW: Cancelled Google events never deleted from local DB

**File:** `supabase/functions/google-calendar-sync/index.ts` line 129

```typescript
.filter((it) => it.status !== "cancelled")
```

Cancelled events are filtered out of the upsert, but there's no DELETE pass. A user who cancels on Google Calendar directly will still see the event in their agenda forever.

---

## Summary

| # | Severity | Symptom | Root Cause |
|---|----------|---------|------------|
| 1 | **CRITICAL** | Google Calendar never updated on cancel/reschedule | `source_event_id` nullified in DB before push reads it |
| 2 | **HIGH** | Duplicate events on repeat confirmations | Push overwrites `source_type` → upsert unique key no longer matches |
| 3 | **HIGH** | Cancellation block never executes for AI drafts | `looksLikeCancellation` rejects bare "cancel", AI writes polite drafts |
| 4 | **MEDIUM** | User instruction silently truncated | 8000-char slice chops from the end |
| 5 | **MEDIUM** | 10am shows as 2pm | Sync stores null timezone; frontend falls back to browser timezone |
| 6 | **MEDIUM** | Same timezone: AI sees wrong times | Context block uses browser tz, not each event's tz |
| 7 | **LOW** | Manual status changes lost on sync | Sync sets status to "imported" unconditionally |
| 8 | **LOW** | Cancelled Google events never cleaned up | Sync filters out cancelled, no DELETE pass |
