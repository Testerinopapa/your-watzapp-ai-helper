# Flagged Messages — Frontend ↔ Backend

How the dashboard's "Flagged messages" feature connects to the send-smart backend.

## Overview

Flagged messages are inbound email threads that the extension's AI decided need
human review instead of an auto-reply. They live in the **send-smart-backend**
Supabase project (`ocpphyjkstvfespxrajk`), not in this dashboard's own Lovable
Cloud project. The dashboard reads and resolves them by calling the backend's
edge functions and subscribing to its `thread_states` table over Realtime.

## Two-project architecture

| Project | Role |
| --- | --- |
| Dashboard Cloud project (`zzqdzubykkglytjdecqe`) | Auth, profile, extension settings, usage counters. Issues the JWT. |
| send-smart-backend (`ocpphyjkstvfespxrajk`) | Stores `thread_states`, reply logs. Exposes edge functions consumed here. |

The backend trusts JWTs from the dashboard project (shared JWT secret), so the
same `session.access_token` works as the `Authorization: Bearer …` for backend
edge functions and for Realtime RLS. The backend client and URL/anon key live
in [`src/integrations/supabase/backend.ts`](../src/integrations/supabase/backend.ts).

## Data flow

```
extension ──► send-smart-backend (writes thread_states row, status = needs_review)
                     │
                     ├── REST: GET  /functions/v1/review-list      ──► useFlaggedEmails
                     ├── REST: POST /functions/v1/review-resolve   ──► useResolveFlagged / useResolveAllFlagged
                     └── Realtime: postgres_changes on thread_states ──► useThreadStatesRealtime
                                                                              │
                                                                              ▼
                                                            invalidates ["review-list"]
                                                            and ["send-smart-usage"]
```

## Frontend pieces

- **`src/hooks/useFlaggedEmails.ts`** — React Query (`["review-list"]`).
  - `GET ${SEND_SMART_URL}/functions/v1/review-list` with `apikey` + bearer JWT.
  - Polls every 10s and on focus; normalizes raw rows into `FlaggedEmail`.
  - Parses sender `"Name <email>"`, derives `createdAt` from
    `review_opened_at || createdAt || updated_at`, sorts newest first.
- **`src/hooks/useResolveFlagged.ts`** — single-item resolve.
  - `POST /functions/v1/review-resolve` with `{ id, thread_id, provider, resolution }`.
  - Optimistically removes the item from the `["review-list"]` cache, rolls back
    on error, then invalidates `["review-list"]` and `["send-smart-usage"]`.
- **`src/hooks/useResolveAllFlagged.ts`** — drain the entire queue.
  - The backend only returns the first 50 items and ignores offset paging, so
    it loops: fetch page → resolve up to 10 in parallel with `resolution: "dismissed"`
    → re-fetch → stop when a page comes back short or empty (max 100 passes).
  - Optimistically empties the cache and reports `{ cleared, failed, total }`.
- **`src/hooks/useThreadStatesRealtime.ts`** — keeps the UI live.
  - Bridges `session.access_token` into the backend client via
    `sendSmartBackend.realtime.setAuth(...)` so RLS sees the same user.
  - Subscribes to `postgres_changes` on `public.thread_states` filtered by
    `user_id=eq.<uid>`. On any change, invalidates `["review-list"]` and
    `["send-smart-usage"]` and dispatches a `thread-states:changed` window event.
- **UI**
  - [`FlaggedReviewSection.tsx`](../src/components/dashboard/FlaggedReviewSection.tsx)
    renders the section: count badge, Clear-all confirm dialog, refresh,
    skeleton, empty, and error states.
  - [`FlaggedEmailCard.tsx`](../src/components/dashboard/FlaggedEmailCard.tsx)
    renders each item with an age-based tone (fresh / warn after 1d / stale
    after 3d) and an "I replied" button wired to `useResolveFlagged`.

## Backend contracts

### `GET /functions/v1/review-list`
Headers: `apikey: <SEND_SMART_ANON_KEY>`, `Authorization: Bearer <jwt>`.
Optional query: `limit` (used by clear-all at 50).

Response:
```json
{
  "items": [
    {
      "id": "gmail:<thread_id>",
      "thread_id": "<thread_id>",
      "provider": "gmail",
      "subject": "...",
      "sender": "Name <a@b.com>",        // or senderEmail/senderName
      "snippet": "...",                  // or preview
      "reason": "...",                   // or review_reason
      "review_summary": "...",
      "review_opened_at": "ISO",
      "updated_at": "ISO",
      "status_value": "needs_review",
      "thread_url": "https://mail.google.com/..."
    }
  ]
}
```

### `POST /functions/v1/review-resolve`
Body: `{ id, thread_id, provider, resolution: "handled" | "dismissed" }`.
- `"handled"` — user marked it as replied (per-card button).
- `"dismissed"` — bulk clear.

Non-2xx responses with `{ error }` are surfaced through the toast.

## Auth & RLS notes

- Never call the backend without `session.access_token`; both hooks throw
  "Not signed in" early.
- Realtime requires `setAuth(access_token)` on the secondary client; without it
  the channel subscribes anonymously and RLS on `thread_states` returns nothing.
- The backend's anon key is safe to ship — it's the publishable key, gated by
  RLS on the user's JWT.

## Cache keys touched

- `["review-list"]` — list of flagged messages.
- `["send-smart-usage"]` — usage/activity panel, invalidated whenever a thread
  state changes since resolutions also bump usage counters server-side.
