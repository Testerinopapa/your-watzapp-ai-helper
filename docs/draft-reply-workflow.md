# Draft Reply Workflow

_Last updated: 2026-06-10 — documents the end-to-end flow when a user drafts an AI reply from a flagged message card._

---

## Overview

The draft reply workflow is the core interaction loop of the FlaggedReviewSection. When a user opens a flagged WhatsApp message card and clicks the draft button, the system:

1. Classifies the message by intent category
2. Optionally enriches the user's instruction with calendar context or support knowledge
3. Calls an external AI edge function to generate a reply
4. Post-processes the draft for calendar mutations (create/update/cancel/reschedule events)

All of this happens inline within the card — the user never leaves the dashboard.

---

## Component Tree (Draft-Specific)

```
FlaggedReviewSection.tsx
├── DraggableFlaggedCard          ← drag wrapper, expand/collapse
│   └── FlaggedCardInner          ← card content (sender, subject, preview, intent badge)
│       └── DraftReplyFooter      ← the entire draft UI: instruction input, generate button, result display
```

---

## Phase 1: Card Activation

**Trigger:** User clicks the action button on a collapsed card footer.

### Entry Points (`DraftReplyFooter.tsx:95-142`)

The button label and color depend on the message's intent category:

| Intent Category | Button Label | Button Color | Auto-Filled Instruction |
|-----------------|-------------|-------------|------------------------|
| `appointment` / `booking` / `reservation` | "Manage Appointment" | Amber (`text-amber-400`) | `"Check calendar, reply and update google calendar"` |
| `support` / `help` / `faq` / `question` / `inquiry` | "Get support reply" | Blue (`text-blue-400`) | `"Answer using the support knowledge base. Only use documented information."` |
| `complaint` / `complaint_*` / `negative_feedback` / `refund_request` | "Handle complaint" | Red (`text-red-400`) | `"Acknowledge the customer's frustration. Apologize sincerely. Offer a clear next step. If refunds or serious issues are involved, escalate to human."` |
| `misc` (or any other) | "Draft reply" | Mint green (`text-[#2dd4a8]`) | _(empty)_ |

### State Update (`FlaggedReviewSection.tsx:894-925`)

```ts
updateDraft(it.thread_id, {
  open: true,
  instruction: draftState.instruction || autoFilledDefault,
});
```

The `DraftState` object (defined in `flagged-utils.ts:11-21`) tracks per-thread:

| Field | Type | Purpose |
|-------|------|---------|
| `open` | `boolean` | Whether the draft panel is expanded |
| `instruction` | `string` | User's instruction text (max 2000 chars) |
| `draft` | `string` | The AI-generated reply text |
| `loading` | `boolean` | Whether generation is in progress |
| `error` | `string \| null` | Error message if generation failed |
| `draftId` | `string \| null` | Server-assigned draft ID |
| `phase` | `"idle" \| "generating" \| "sent" \| "error"` | Lifecycle phase |
| `sentAt` | `string \| null` | ISO timestamp when draft was generated |
| `supportDocId` | `string \| null` | Selected support document ID (support cards only) |

---

## Phase 2: Instruction Enrichment

**Trigger:** User clicks "Generate & send" (or variant).

**Entry:** `callDraftFunction()` in `FlaggedReviewSection.tsx:151-297`

### Step 2a: Resolve Incoming Message Text

```ts
const incomingMessage = (
  enrichedMessageFor(item) ??   // from activity feed enrichment
  item.latest_message ??
  item.preview ??
  item.subject ??
  ""
).trim().slice(0, 4000);
```

The `enricher` (`src/lib/enrichment.ts`) cross-references the flagged message against the activity feed (`useSendSmartUsage`) via multiple lookup keys (thread_id, sender name, phone number). If a fresher or non-voice-stub version of the message exists in the activity stream, it replaces `latest_message`.

### Step 2b: Route to Enrichment Pipeline

```
┌─────────────────────────────────────────────────────┐
│              callDraftFunction()                     │
│                                                     │
│  needsSupportContext(item)?                          │
│    ├── YES → buildSupportInstruction()               │
│    │         (query support_doc_chunks,              │
│    │          build knowledge block,                 │
│    │          return enriched instruction)            │
│    │                                                │
│    └── NO  → needsCalendarContext(item, msg, instr)? │
│                ├── YES → buildCalendarInstruction()   │
│                │         (sync Google Calendar,       │
│                │          fetch agenda_events,        │
│                │          classify cancel/reschedule, │
│                │          build calendar block,       │
│                │          append hard rules)          │
│                │                                     │
│                └── NO  → use raw userInstruction      │
└─────────────────────────────────────────────────────┘
```

**Priority rule:** Support takes precedence over calendar. If `intent_category` is `support`, the message will NOT enter the calendar pipeline even if it contains scheduling keywords (prevents false positives like "your booking page isn't working").

### Support Enrichment (`src/lib/support-draft.ts`)

1. **Build search query** — concatenates `incomingMessage + userInstruction`, strips stop words, limits to 500 chars
2. **Query support_doc_chunks** via Supabase:
   - If a specific document is selected → loads ALL chunks from that document (up to 16), relying on the LLM for semantic relevance
   - If "All documents" or `null` → uses PostgreSQL full-text search (`websearch` type) across all chunks, limits to 8
3. **Format knowledge block** — groups chunks by document, prepends a `SUPPORT_HEADER` that explicitly scopes the AI away from calendar/scheduling
4. **Anti-hallucination guard** — instructs the AI to only use the provided knowledge; if nothing matches, say "I don't have that specific information"

### Calendar Enrichment (`src/lib/calendar-draft.ts`)

1. **Sync Google Calendar** — invokes `google-calendar-sync` edge function to pull latest events
2. **Fetch agenda_events** — queries `agenda_events` for the next 180 days, excluding cancelled
3. **Split events** — separates "own events" (matching thread_id or contact name) from "other events"
4. **Format calendar block** — renders each event as a human-readable line with date, time, title, location, contact, description
5. **Classify intent** — checks if the combined text looks like a reschedule or cancellation using regex helpers from `extractDateTime.ts`
6. **Append hard rules** — context-sensitive rules (e.g., "don't confirm overlapping times", "the contact's existing appointment is NOT a conflict when rescheduling")
7. **Return enriched instruction** — `CALENDAR CONTEXT` block + user instruction + hard rules, sliced to 8000 chars

### Both Pipelines Return `null` on Failure

If calendar sync fails or the support knowledge query errors, the function returns `null`. The caller aborts the draft, sets an error state, and shows a toast — preventing the AI from generating a reply without the context it needs.

---

## Phase 3: AI Draft Generation

**Entry:** `callDraftFunction()` after enrichment (`FlaggedReviewSection.tsx:197-261`)

### Step 3a: Set Loading State

```ts
updateDraft(id, { loading: true, error: null, phase: "generating", sentAt: null });
```

The footer button shows a spinner and "Generating…" text.

### Step 3b: Call External Edge Function

```
POST {FLAGGED_SUPABASE_URL}/functions/v1/draft-whatsapp-manual
```

**Request headers:**
- `Content-Type: application/json`
- `apikey: FLAGGED_ANON_KEY`
- `Authorization: Bearer {session.access_token}`

**Request body:**
```json
{
  "thread_id": "wa:123456789",
  "provider": "whatsapp",
  "incomingMessage": "Hi, I'd like to book an appointment...",
  "incoming_message": "Hi, I'd like to book an appointment...",
  "instruction": "CALENDAR CONTEXT — freshly synced...\n\n---\n\nCheck calendar, reply and update google calendar\n\nHARD RULES...",
  "autoSend": true,
  "auto_send": true
}
```

Note: both `camelCase` and `snake_case` variants of `incomingMessage` and `autoSend` are sent for backend compatibility.

### Step 3c: Handle Errors

The `friendlyError()` helper maps HTTP status codes to user-facing messages:

| Status | Message |
|--------|---------|
| 401 | "Session expired — please sign in again." |
| 402 | "Plan limit reached. Upgrade to continue drafting." |
| 429 | "Too many requests — try again in a moment." |
| 502 | "AI service is unavailable right now. Please retry." |
| other | Raw error text or "Request failed (N)" |

On error: `updateDraft(id, { loading: false, error: msg, phase: "error" })` — the footer shows a red error banner with a "Retry" button.

### Step 3d: Parse Response

```ts
const draft = body?.draft ?? body?.reply ?? body?.text ?? body?.message ?? "";
const draftId = body?.draft_id ?? body?.draftId ?? null;
```

Multiple field names are tried for robustness against API changes.

### Step 3e: Set Success State

```ts
updateDraft(id, {
  loading: false,
  draft: String(draft),
  error: null,
  draftId,
  phase: "sent",
  sentAt: new Date().toISOString(),
});
```

The footer renders:
- The generated draft text in a bordered box
- A "Copy" button (writes to clipboard via `navigator.clipboard.writeText`)
- A green "Sent · X minutes ago" badge

---

## Phase 4: Post-Draft Calendar Processing

**Trigger:** Immediately after a successful draft, if the message is calendar-relevant.

**Entry:** `FlaggedReviewSection.tsx:278-288`

```ts
if (needsCalendarContext(item, incomingMessage, userInstruction)) {
  await handleCalendarAfterDraft({
    item, incomingMessage, userInstruction,
    draftText: String(draft),
    toast,
  });
}
```

**Note:** Support and complaint messages skip this step entirely (they only log to console).

### Calendar Response Pipeline (`src/lib/calendar-response.ts`)

```
handleCalendarAfterDraft()
  │
  ├── classifyDraftIntent()
  │     Checks: intent_reason, draft text, incoming message, user instruction
  │     Produces: { cancel: bool, reschedule: bool }
  │
  ├── cancel path → cancelAppointment()
  │     • Find event by thread_id → user_id
  │     • If not found: fallback by date window + contact name
  │     • If still not found: fallback by contact name only (broad search)
  │     • For each matched event:
  │       - If Google-linked → invoke google-calendar-push (delete)
  │       - Mark status="cancelled", clear source_event_id
  │     • Handles stale cancelled rows (cleans up Google if needed)
  │     • Handles ambiguous matches (>1 event → "Cancellation needs review")
  │
  ├── reschedule path → rescheduleAppointment()
  │     • Extract NEW date (not the cancellation date)
  │       - Tries structured calendar_payload first
  │       - Then extractNewDateForReschedule() (post-marker, post-cancel-clause,
  │         reverse sentence walk, full-text fallback)
  │     • Match against existing events by thread_id, then contact fallback
  │     • PATCH path (existing Google-linked event):
  │       - Guard: if new time matches existing, re-extract from draft only
  │       - Invoke google-calendar-push (upsert) with new time
  │       - On success: update start_time/end_time/status in agenda_events
  │     • DELETE+CREATE path (no existing Google link):
  │       - Insert new agenda_event with source_event_id = thread_id:rescheduled:N
  │       - Invoke google-calendar-push (upsert)
  │       - On success: cancel old events, notify
  │       - On failure: delete the inserted row, show error
  │
  └── confirmation path → confirmAppointment()
        • Extract date from payload, then instruction, then draft+subject
        • Look up existing event by thread_id (upsert if exists, insert if new)
        • If date extracted → invoke google-calendar-push (upsert)
        • If no date → save with null start_time ("Needs time" in Agenda)
```

### Intent Classification Details (`classifyDraftIntent`)

The classifier uses THREE independent signal sources, each checked for both cancel and reschedule keywords:

1. **`intent_reason`** — the AI's original classification reason from the flagged message (checked with Italian/Spanish regex support)
2. **Draft text** — the AI-generated reply
3. **Incoming message + user instruction** — the contact's text and the user's directive

**Key logic:** A reschedule signal always suppresses a cancel signal. If the text says "cancel" AND proposes a new time, it's treated as a reschedule. Only when no reschedule signal exists does cancellation take effect.

### Date Extraction for Reschedules (`extractNewDateForReschedule`)

Reschedule drafts almost always mention the OLD date first ("cancel Thursday 4 June") and the NEW date second ("let's do Thursday 11 June at 10am"). Standard `extractDateTime()` returns the first date found, which is wrong. The reschedule-aware extraction uses:

1. **Post-marker extraction** — finds text after reschedule-marker patterns ("move to", "how about", "could we do") and extracts from there
2. **Post-cancel-clause extraction** — strips everything up through the first sentence containing cancellation language
3. **Reverse sentence walk** — processes sentences from the END backwards, since the new date is typically mentioned last
4. **Full-text fallback** — standard `extractDateTime()` on the full draft

---

## Phase 5: Outbound Message Processing (Background)

**Separate from the manual draft flow** — runs automatically as a side effect.

**Entry:** `useOutboundAppointmentMessages` hook (`src/hooks/useOutboundAppointmentMessages.ts`)

This hook watches all flagged messages for **"You" (from_me=true)** messages that contain calendar payloads. When it finds new ones (tracked via a localStorage receipt set), it routes them through the same `handleCalendarAfterDraft()` pipeline with an empty `userInstruction`. This handles the case where the WhatsApp extension/backend already sent a calendar-related reply before the dashboard saw it.

---

## Error Handling Summary

| Stage | Failure Mode | Behavior |
|-------|-------------|----------|
| Enrichment (calendar) | Google sync fails, DB query fails | Abort draft, show error toast ("Calendar not verified"), set error phase |
| Enrichment (support) | DB query fails | Abort draft, show error toast ("Support search failed"), set error phase |
| AI Generation | Network error, 4xx/5xx | Show friendly error message, set error phase, show Retry button |
| AI Generation | Empty draft returned | Set error phase ("No draft returned") |
| Calendar post-processing | Google push fails | Save locally only, toast: "Saved to agenda (Google sync skipped)" |
| Calendar post-processing | Ambiguous contacts (>1 match) | Toast: "needs review" — user must manually resolve |
| Calendar post-processing | Reschedule with unchanged time | Toast: "new time unclear" — no calendar change |

---

## Key Files

| File | Role |
|------|------|
| `src/components/dashboard/FlaggedReviewSection.tsx` | Orchestrator: state management, `callDraftFunction()`, card rendering |
| `src/components/dashboard/DraftReplyFooter.tsx` | UI: instruction input, generate button, draft display, copy, error/retry |
| `src/lib/calendar-draft.ts` | Builds calendar-enriched instruction with synced events and hard rules |
| `src/lib/support-draft.ts` | Builds support-enriched instruction with knowledge base chunks |
| `src/lib/calendar-response.ts` | Post-draft calendar mutations: confirm, cancel, reschedule |
| `src/lib/extractDateTime.ts` | Natural language date/time extraction (EN/IT/ES, 7 priority levels) |
| `src/lib/enrichment.ts` | Cross-references flagged messages with activity feed for fresher text |
| `src/lib/flagged-utils.ts` | `DraftState` type, category constants, sender/contact utilities |
| `src/hooks/useOutboundAppointmentMessages.ts` | Background processor for extension-sent "You" messages |

---

## Data Flow Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                         FLAGGED MESSAGE CARD                         │
│                                                                      │
│  ┌─────────────┐    ┌──────────────────┐    ┌────────────────────┐  │
│  │ Card Footer │    │  Draft Reply UI  │    │   AI Edge Function │  │
│  │ (collapsed) │    │  (expanded)      │    │   (external DB)    │  │
│  │             │    │                  │    │                    │  │
│  │ [Manage     │───▶│ Incoming message │    │ draft-whatsapp-    │  │
│  │  Appoint..] │    │ ┌──────────────┐ │    │ manual             │  │
│  │             │    │ │ "Hi, I'd     │ │    │                    │  │
│  │             │    │ │  like to..." │ │    │ ◀── instruction    │  │
│  │             │    │ └──────────────┘ │    │ ◀── incomingMessage│  │
│  │             │    │                  │    │ ◀── thread_id      │  │
│  │             │    │ Instruction:     │    │                    │  │
│  │             │    │ ┌──────────────┐ │    │ ───▶ draft text    │  │
│  │             │    │ │ Check cal... │ │    │                    │  │
│  │             │    │ └──────────────┘ │    └────────────────────┘  │
│  │             │    │                  │              │              │
│  │             │    │ [Generate & send]│              ▼              │
│  │             │    │                  │    ┌────────────────────┐  │
│  │             │    │ Suggested draft: │    │  Calendar Response │  │
│  │             │    │ ┌──────────────┐ │    │  (local DB)        │  │
│  │             │    │ │ "I've conf.."│ │    │                    │  │
│  │             │    │ └──────────────┘ │    │ agenda_events      │  │
│  │             │    │ [Copy]  ✅ Sent  │    │ ◀── upsert/update  │  │
│  │             │    │                  │    │ ◀── cancel         │  │
│  └─────────────┘    └──────────────────┘    │                    │  │
│                                              │ google-calendar-   │  │
│  ┌──────────────────┐                       │ push               │  │
│  │   Enrichment     │                       │ ◀── upsert/delete  │  │
│  │                  │                       └────────────────────┘  │
│  │ calendar-draft.ts│                                                │
│  │ ◀── sync Google  │                                                │
│  │ ◀── fetch events │                                                │
│  │ ──▶ enriched     │                                                │
│  │     instruction   │                                                │
│  │                  │                                                │
│  │ support-draft.ts │                                                │
│  │ ◀── search KB    │                                                │
│  │ ──▶ enriched     │                                                │
│  │     instruction   │                                                │
│  └──────────────────┘                                                │
└──────────────────────────────────────────────────────────────────────┘
```
