# Why "Flagged messages" doesn't update like "Activity"

Both panels are wired the same way on the surface — `useQuery` against an
edge function on the external send-smart backend (`ocpphyjkstvfespxrajk`)
with the user's Supabase session bearer. The reason Activity stays fresh
and Flagged often shows nothing (or stale data) is **not** in the React
Query layer. It's in the write path that produces the rows each endpoint
reads, plus a few smaller client-side gaps.

## 1. Different write paths feed each endpoint

### Activity → `usage-get`
The send-smart pipeline writes a usage row **every time it processes an
inbound message** (sent, flagged, or skipped). That write is part of the
normal reply flow — if a reply happens, a row exists. `usage-get` then
returns the latest `recent[]` slice.

Result: as long as the extension is replying, Activity has new data on
the next refetch.

### Flagged → `flagged-list`
`flagged-list` reads `thread_states` rows where
`intent_category = 'misc'` OR
(`intent_category = 'support'` AND `intent_confidence < 0.6`).

Those `intent_*` columns are **only populated** when the extension /
voice pipeline calls:

```
POST /functions/v1/classify-intent
{ thread_id, provider, transcript|message, source }
```

with **both `thread_id` and `provider` present**. Without that call (or
without those two fields), the function classifies but doesn't persist,
so `thread_states.intent_category` stays NULL and the thread never shows
up in `flagged-list`.

**Most likely cause of "no updates":** the extension/voice client isn't
calling `classify-intent` with `thread_id` + `provider` on new inbounds
yet, so no rows ever become flagged. Activity, by contrast, doesn't
depend on that side-channel — usage rows are written by the main reply
flow.

### How to verify
- Query the external DB: `select count(*) from thread_states where intent_category is not null;`
  - If 0 → the extension isn't persisting classifications. Fix the
    extension call, not the panel.
- Hit the endpoint directly with the user's bearer:
  `GET /functions/v1/flagged-list?limit=20` — if `items: []`, same conclusion.
- Check `classify-intent` logs for recent invocations that include
  `thread_id` and `provider`.

## 2. Client-side refresh gaps (smaller, but real)

| Concern | Activity (`useSendSmartUsage`) | Flagged (`useFlaggedMessages`) |
|---|---|---|
| `staleTime` | 60s | 60s |
| `refetchOnWindowFocus` | true | true |
| Manual Refresh button | **Yes** (header button calls `refetch()`) | **No** |
| Polling (`refetchInterval`) | No | No |
| Realtime subscription | No | No |
| Cache invalidation on writes | n/a (read-only) | n/a (no client write path) |

So even when new flagged rows _do_ exist, the user has no way to force a
refresh short of switching tabs (window-focus refetch) or waiting for
the 60s stale window to expire on the next render. Activity at least
has an explicit Refresh button.

## 3. What would actually fix the perceived "no updates"

In order of impact:

1. **Make the extension/voice pipeline call `classify-intent` with
   `thread_id` + `provider` on every new inbound.** Without this, the
   panel is correctly showing "nothing flagged" because the backend has
   nothing flagged. This is the root cause.
2. **Add a Refresh button to `FlaggedReviewSection`** mirroring
   `ActivitySection`'s header button, so users can force a refetch.
3. **Add `refetchInterval`** (e.g. 30–60s) to `useFlaggedMessages` for
   passive freshness without user action.
4. **(Optional) Subscribe to realtime updates** on `thread_states` from
   the external project and invalidate the
   `["flagged-messages", limit]` query key on change. This requires the
   external project to expose realtime on that table to the signed-in
   user.

## TL;DR
Activity updates because the send pipeline writes usage rows as a side
effect of normal replying. Flagged depends on a **separate** write
(`classify-intent` with `thread_id`+`provider`) that the extension
likely isn't making yet, so `flagged-list` returns an empty set. The
React Query setup is fine; the missing data is upstream.
