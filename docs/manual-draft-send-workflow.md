# Manual Draft Send — Workflow & Known Issues

_Last updated: 2026-06-11 — documents the full path from "Generate & send" button click to WhatsApp message delivery, and the current instability._

---

## Flow Overview

```
User clicks "Generate & send" on a flagged card
  │
  ▼
callDraftFunction(item)
  │
  ├── resolve incomingMessage (enriched or latest_message or preview)
  ├── resolve userInstruction (from DraftState, max 2000 chars)
  │
  ├── if support → buildSupportInstruction()
  │                 (query support_doc_chunks, format knowledge block)
  │                 return null → abort
  │
  ├── if calendar → buildCalendarInstruction()
  │                   (sync Google Calendar, fetch agenda_events,
  │                    classify cancel/reschedule, build rules block)
  │                   return null → abort
  │
  ├── set phase: "generating"
  │
  ├── POST {FLAGGED_SUPABASE_URL}/functions/v1/draft-whatsapp-manual
  │     { thread_id, provider, incomingMessage, instruction, autoSend: true }
  │
  ├── parse response → draft text, draftId
  │     set phase: "sent", sentAt: timestamp
  │
  └── if calendar → handleCalendarAfterDraft()
                    (confirmAppointment / cancelAppointment / rescheduleAppointment)
```

---

## The `thread_id` Problem — How Messages Go to the Wrong Chat

### Card Grouping (FlaggedReviewSection.tsx:821-850)

The dashboard groups flagged cards in **two passes**:

1. **Pass 1 — Group by `thread_id`** (line 822-830):
   All cards with the same `thread_id` stack together.  
   Synthetic recent-message cards (`wa:12345#recent:ts:idx:me`) each have unique `thread_id`s, so they don't group here.

2. **Pass 2 — Merge by sender** (line 832-850):
   Thread groups that share the same `contactKeyForItem` are **merged** into one deck.  
   `contactKeyForItem` strips phone numbers from sender labels, then normalizes:

```ts
// flagged-utils.ts:109-124
contactKeyForItem(item) {
  const label = senderLabelForItem(item);   // sender || subject || phone from thread_id
  if (label) {
    const stripped = label.replace(/[\s]*[+\d][\s\d\-+()]{6,}$/, "").trim();
    if (stripped) return normalizeLookup(stripped);  // e.g. "Emma Thompson"
    return normalizeLookup(label);
  }
  // Fallback: phone digits from thread_id
  const phone = (item.thread_id ?? "").replace(/\D/g, "");
  return phone || item.thread_id;  // ← DANGER: empty string ""
}
```

### When This Breaks

| Scenario | Cause | Result |
|----------|-------|--------|
| Two contacts both have `sender: null` and thread_ids with no phone digits | `contactKeyForItem` returns `""` for both | All null-sender threads merged into one deck — generating from one card sends to a different contact's chat |
| "Emma Thompson +447911223346" and "Emma Thompson" (different thread_ids) | Phone strip normalizes both to `"emma thompson"` | Cards from two different Emma Thompson threads merge — user may not realize they're replying to the wrong Emma |
| Phone-only contacts with similar prefixes | `normalizeLookup` collapses whitespace/diacritics but phone numbers differ | Should usually work, but edge cases exist |

### The `#recent:` Suffix Issue

Synthetic recent-message cards have thread_ids like `wa:12345#recent:2026-06-11T...:0:me`.  
`callDraftFunction` sends this **full** ID to `draft-whatsapp-manual`:

```ts
// FlaggedReviewSection.tsx:222
body: JSON.stringify({
  thread_id: item.thread_id,  // ← could be "wa:12345#recent:..."
  ...
})
```

The `baseThreadId()` helper strips `#recent:` but is **only used for dismissals and dedup** — NOT for the actual thread_id sent to the edge function. If the edge function doesn't strip `#recent:`, it may fail to match the WhatsApp thread or match the wrong one.

### The Decoupling Gap

The card the user is viewing and the thread_id used in the API call are tied together through `current.thread_id` (DraggableFlaggedCard.tsx:64-68). When the user cycles through a stacked deck using the ←/→ arrows, the `activeIndex` changes, `current` changes, and the footers re-render with the new `item`. But there's **no visual indicator** showing WHICH thread_id the current card represents — the user only sees the sender name and message text.

If pass 2 merged two different contacts into one deck, the user could be looking at card 1/2 (Contact A) while the footer is for card 2/2 (Contact B), and the arrow nav might not be obvious.

---

## The `autoSend` Parameter — Why It Sends Immediately

```ts
// FlaggedReviewSection.tsx:227-228
autoSend: true,
auto_send: true,  // both camelCase and snake_case for compatibility
```

The `draft-whatsapp-manual` edge function receives `autoSend: true`. This means:
- The AI generates a draft
- The draft is **immediately sent** to the WhatsApp thread
- The draft text is returned to the frontend for display

There is **no "review before send" gap**. The `"Suggested draft"` box in the UI is informational — the message has already been sent. This is why when `thread_id` is wrong, the message silently goes to the wrong person with no chance to catch it.

---

## Card Activation (DraftReplyFooter.tsx:95-142)

When the user clicks the action button on a collapsed card:

```
"Manage Appointment"  (amber)   → appointment/booking/reservation
"Get support reply"   (blue)    → support/help/faq/question/inquiry
"Handle complaint"    (red)     → complaint*/negative_feedback/refund_request
"Draft reply"         (mint)    → misc or any other category
```

If the card already had a prior instruction, clicking again preserves it. Otherwise, a default instruction is auto-filled based on category. The `DraftState` is keyed by `thread_id` — so cycling through stacked cards while one is expanded **preserves** the previous card's instruction when you cycle back.

### Cycling While Expanded (DraggableFlaggedCard.tsx:111-122)

```ts
const goNext = () =>
  setActiveIndex((idx) => {
    const next = (idx + 1) % items.length;
    if (expanded) window.requestAnimationFrame(() => onActivate?.(items[next]));
    return next;
  });
```

When the user presses ←/→ while a card is expanded, `onActivate` is called on the next card. This opens the next card's draft panel. But the **previous card's draft panel is NOT closed** — both remain open simultaneously. Both footers are mounted in the DOM, each with its own `thread_id`. The user sees the last-activated card (e.g., card 2/4), but card 1/4's footer is still rendering behind it. If the user scrolls down and sees card 1's "Generate & send" button, they could accidentally generate on the wrong card.

---

## Current Version & Patch State

| File | Relevant Function | Key Lines | Issue |
|------|------------------|-----------|-------|
| `FlaggedReviewSection.tsx` | `callDraftFunction` | 151-297 | Sends `item.thread_id` (may include `#recent:` suffix) to edge function; always `autoSend: true` |
| `FlaggedReviewSection.tsx` | grouping logic | 821-850 | Pass 2 merges by `contactKeyForItem` — same sender label → same deck, even across different thread_ids |
| `DraggableFlaggedCard.tsx` | `goNext` / `goPrev` | 111-122 | Cycling while expanded opens next card's footer without closing the previous one |
| `DraggableFlaggedCard.tsx` | `current` selection | 63-68 | `current = items[activeIndex]` — determines which `thread_id` gets sent |
| `flagged-utils.ts` | `contactKeyForItem` | 109-124 | Returns `""` when both sender and phone digits are absent — all null-sender threads merge |
| `flagged-utils.ts` | `baseThreadId` | 168-172 | Strips `#recent:` suffix, but unused in `callDraftFunction` |
| `calendar-draft.ts` | `needsCalendarContext` | 13-35 | Expanded to PT/IT/ES days, verbs, and `[h:]` time format |
| `calendar-draft.ts` | `buildCalendarInstruction` | 37-190 | Syncs Google Calendar, fetches agenda_events, builds rules |
| `support-draft.ts` | `buildSupportInstruction` | 40-270 | Queries support_doc_chunks, builds knowledge block with anti-hallucination guard |
| `calendar-response.ts` | `handleCalendarAfterDraft` | 1225-1290 | Post-draft calendar mutation entry point |
| `extractDateTime.ts` | all functions | 1-530 | Portuguese days/months/h-time/verbs added to all regexes and classifiers |

---

## Priority Fixes

1. **Strip `#recent:` before sending to edge function** — in `callDraftFunction`, use `baseThreadId(item.thread_id)` instead of `item.thread_id` for the API call. The draft state can still be keyed by the full ID for UI purposes, but the edge function should receive the real WhatsApp thread ID.

2. **Close previous card when cycling while expanded** — in `goNext`/`goPrev`, close the current card's draft before opening the next one. Or at minimum, only render one footer at a time.

3. **Hard-deck contacts** — when `contactKeyForItem` returns `""` (no sender, no phone), don't merge those cards. A `Map` key of `""` silently groups everything. Add a guard: if the contact key is empty, use `item.thread_id` as the grouping key to prevent cross-contact merging.

4. **Sender grouping should be scoped to same thread_id prefix** — merging two threads from the same contact is fine (they're the same person). Merging threads from different contacts because they share a sender label is dangerous. At minimum, log a warning when this happens so operators can spot wrong-chat incidents.

5. **Consider a "review before send" toggle** — currently `autoSend` is always `true`. Even just adding a checkbox in the UI ("Send immediately" / "Review first") would catch wrong-thread sends before they reach WhatsApp.
