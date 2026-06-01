# Dashboard Panel Architecture

_Last updated: 2026-06-01 — initial wiring doc. Edit alongside panel changes._

## Component Tree

```
Dashboard.tsx
├── ActivitySection.tsx          ← useSendSmartUsage (read-only activity stream)
├── FlaggedReviewSection.tsx     ← useFlaggedMessages + activity merge + draft/reply
├── AppointmentsSection.tsx      ← tabs: "Appointments" + "Agenda"
│   ├── AppointmentCard          ← filtered from flagged messages (appointment/booking/reservation intent)
│   ├── AppointmentDrawer.tsx    ← sheet: calendar picker, time, status, "Add to agenda"
│   ├── PersonalAgendaPanel.tsx  ← usePersonalAgenda + useAgendaEvents (merged view)
│   │   └── AgendaCard           ← calendar tile, conflict badge, delete
│   └── ConnectCalendarModal.tsx ← Google OAuth connect/disconnect UI
```

## Data Sources

| Source | Hook | Storage | Purpose |
|--------|------|---------|---------|
| Flagged messages (remote) | `useFlaggedMessages` | FLAGGED_SUPABASE_URL (external DB) | WhatsApp messages flagged by AI with intent classification |
| Activity stream | `useSendSmartUsage` | Same external DB via `usage-get` | Recent SendSmart decisions/threads |
| Local agenda entries | `usePersonalAgenda` | `localStorage` key `lovable.personalAgenda.v1` | User-managed appointments (legacy, phase 1) |
| Synced agenda events | `useAgendaEvents` | `public.agenda_events` (local Supabase) | Google Calendar synced events + manual DB entries |
| Google OAuth tokens | `useGoogleCalendar` | `public.google_oauth_tokens` | OAuth connection state, connect/sync/disconnect |

## Merge Logic (FlaggedReviewSection)

1. `flaggedFromList` — raw results from `useFlaggedMessages` query
2. `flaggedFromActivity` — activity rows filtered for flagged intent, grouped by sender, converted to synthetic `FlaggedMessage` objects
3. `all` — both arrays concatenated
4. **Deduplication**: grouped by normalized sender key. Newest message wins. Older messages become `backlog_count` on the pill.
5. Sorted by recency (latest classified_at or updated_at)

## Merge Logic (PersonalAgendaPanel)

1. `dbEntries` from `useAgendaEvents` (server-side `agenda_events` table)
2. `localEntries` from `usePersonalAgenda` (localStorage)
3. Merged by ID dedup: `dbEntries` first, then `localEntries` (DB takes precedence on ID collision)
4. Sections split by time: Today, Upcoming, Past, Needs time (no start_time)

## Google Calendar Flow

### OAuth Connection
```
User clicks "Connect" in ConnectCalendarModal
  → useGoogleCalendar.connect()
  → supabase.functions.invoke("google-oauth-start")
    → Creates google_oauth_states row (CSRF state, user_id, expires in 10min)
    → Returns Google OAuth URL with calendar scopes
  → Browser redirects to Google
  → Google redirects to SUPABASE_URL/functions/v1/google-oauth-callback?code=...&state=...
  → google-oauth-callback:
      - Validates state, exchanges code for tokens
      - Verifies calendar.readonly scope
      - Upserts google_oauth_tokens
      - Redirects to /dashboard?gcal=ok|error|scope_missing
```

### Calendar Sync (inbound: Google → agenda_events)
```
google-calendar-sync:
  - Auth: user's Supabase JWT
  - Reads google_oauth_tokens for user
  - Refreshes access token if expired
  - Fetches primary calendar events (now → +30 days) from Google Calendar API
  - Upserts into agenda_events (onConflict: user_id, source_type, source_event_id)
  - Returns { synced: N }
```

### Calendar Push (outbound: agenda_events → Google)
```
google-calendar-push:
  - Auth: user's Supabase JWT
  - Reads agenda_event row by ID
  - Reads google_oauth_tokens, validates write scopes
  - action="upsert": POST or PATCH to Google Calendar API
  - action="delete": DELETE from Google Calendar API
  - Writes back source_event_id, html_link to agenda_events
```

### Calendar Query (for AI context)
```
calendar-query:
  - Auth: user's Supabase JWT
  - Reads agenda_events for user in time window
  - op="events" → list events
  - op="freebusy" → { busy: bool, conflicts: [...] }
```

## Reply/Draft Flow (FlaggedReviewSection)

```
User clicks "Draft reply" (or "Manage Appointment" for appointment messages)
  → Opens inline form: instruction textarea + button
  → For appointment messages (intent_category = appointment|booking|reservation):
      - Label: "Appointment instructions"
      - Placeholder/auto-fill: "Check calendar, reply and update google calendar"
      - Button: "Manage Appointment" / "Regenerate & manage"
      - Amber-500 styling on button, amber left border on card
  → For non-appointment messages:
      - Label: "How should we reply?"
      - Placeholder: "e.g. Politely confirm and propose Tuesday at 10am."
      - Button: "Generate & send" / "Regenerate & send"
      - Mint green (#2dd4a8) styling
  → callDraftFunction():
    1. If scheduling-related (detected by needsCalendarContext regex):
       a. Sync Google Calendar via google-calendar-sync
       b. Fetch agenda_events for next 30 days
       c. Build CALENDAR CONTEXT block (busy slots formatted as list)
       d. Append HARD RULES (don't confirm overlapping times)
       e. Prepend to instruction
    2. POST to FLAGGED_SUPABASE_URL/functions/v1/draft-whatsapp-manual
       { thread_id, provider, incomingMessage, instruction, autoSend: true }
    3. Display returned draft text in UI, mark phase as "sent"
    4. IF scheduling-related AND draft looks like a confirmation:
       a. Extract date/time from draft + instruction + subject
          via extractDateTime() in @/lib/extractDateTime
       b. Upsert into agenda_events (whatsapp, source_event_id=thread_id)
          → onConflict: user_id, source_type, source_event_id
       c. If date extracted → invoke google-calendar-push (upsert)
       d. If no date → event saved with null start_time (appears in "Needs time")
       e. Toast feedback: synced / saved-locally / needs-time
```

### Date/Time Extraction (`src/lib/extractDateTime.ts`)

Heuristic parser that checks combined draft + instruction + subject text for:
| Priority | Pattern | Example | Confidence |
|----------|---------|---------|------------|
| 1 | Month + day + time | "June 3rd at 2pm" | high |
| 2 | Day name + time | "Tuesday at 10am", "next monday at 3pm" | high |
| 3 | Relative day + time | "tomorrow at 3pm" | high |
| 4 | Numeric date + time | "3/6 at 2pm", "2026-06-03 14:00" | high |
| 5 | Month + day only | "June 3rd" → defaults to 9am | medium |
| 6 | Day name only | "Tuesday" → defaults to 9am | medium |
| 7 | Relative day only | "tomorrow" → defaults to 9am | medium |

`looksLikeConfirmation(text)` gates the calendar push — only fires when the draft reads like a confirmation (e.g. "confirmed", "booked", "see you there").

## Database Tables (local Supabase)

| Table | Key columns | Purpose |
|-------|-------------|---------|
| `google_oauth_tokens` | user_id (unique), access_token, refresh_token, scope, expires_at | Per-user Google OAuth tokens |
| `google_oauth_states` | state (PK), user_id, redirect_to, expires_at (10min) | CSRF protection for OAuth flow |
| `agenda_events` | user_id + source_type + source_event_id (unique), title, start_time, end_time, status | Normalized calendar events |

All tables have RLS policies scoped to `auth.uid() = user_id`.

## Key IDs and Foreign Relations

- `FlaggedMessage.thread_id` → links flagged messages across the system
- `AgendaEntry.thread_id` → links agenda entries back to WhatsApp threads
- `AgendaEntry.source_event_id` → Google Calendar event ID
- `agenda_events(user_id, source_type, source_event_id)` → unique constraint prevents duplicate imports

## Conflicts

- `detectConflicts()` in PersonalAgendaPanel: O(n²) loop, 30-minute collision window
- `conflicts` in AppointmentDrawer: same logic, computed per-selected-date
- Only checks entries within same origin (local + DB merged). Google Calendar's own conflict detection is separate.

## Known Gaps

1. **No `gcal=ok` validation**: Anyone navigating to `/dashboard?gcal=ok` triggers a sync attempt (harmless but noisy — sync requires auth).
2. **useMemo for side effects**: AppointmentDrawer uses `useMemo` to reset state on thread_id change (should be `useEffect`).
3. **LocalStorage vs DB split**: `usePersonalAgenda` (localStorage) and `useAgendaEvents` (DB) are separate hooks with ad-hoc merge in the component. ID collision is mitigated by `wa-` prefix convention but not guaranteed.
