# Flagged Messages Panel — Bugs

## Bug 1: Activity-sourced messages hardcode `intent_category: "misc"`

**File:** `src/components/dashboard/FlaggedReviewSection.tsx`, line 451

```ts
intent_category: "misc",
```

Every message assembled from the Activity stream (`useSendSmartUsage` → `usage-get` endpoint) gets `intent_category: "misc"` regardless of its actual classified intent. This means:

- A real appointment message coming through the activity path shows as a plain "misc" card — no amber accent, no `CalendarCheck` icon, no "Manage Appointment" CTA
- The `APPOINTMENT_CATEGORIES` check on the card (in `FlaggedCardInner`) and the draft footer (in `DraftReplyFooter`) both check `intent_category`, so the card is rendered as generic
- Messages that arrive exclusively via the Activity stream (not the `flagged-list` endpoint) lose their real classification

**Impact:** A user who relies on the activity stream as a fallback (e.g., the polling refresh that replaces voice stubs) sees appointment messages as misc. This is especially bad for mock data where the `flagged-list` endpoint may not return the message at all.

**Root cause:** The activity pipeline was designed as a supplement/enrichment layer and never wired to carry the original `intent_category` from the source data. The `SendSmartUsageRecent` type does not carry an `intent_category` field either — the `usage-get` endpoint doesn't return it.

**Fix:** Two options:
1. Add `intent_category` to `SendSmartUsageRecent` in the backend endpoint and pass it through here
2. Classify the message intent client-side from the text + metadata before building the `activityGroups` entry

---

## Bug 2: Sender grouping falls through to subject when `sender` is null

**File:** `src/lib/flagged-utils.ts`, line 89–94 (`senderLabelForItem`)

```ts
export const senderLabelForItem = (item) =>
  cleanSenderLabel(item.sender) ||
  cleanSenderLabel(item.subject) ||
  senderFromThreadId(item.thread_id);
```

When `sender` is null (common in mock and WhatsApp data), `senderLabelForItem` falls through to `subject`. Two messages from the same contact with different subjects ("Reschedule appointment" vs "Make appointment") produce **different labels**, so the two-pass grouping merge cannot identify them as the same contact.

**The `contactKeyForItem` fix (commit `2813ef8`):** The newly added function extracts phone digits from `thread_id` as a stable fallback. But this fix only applies to the **render grouping** (line 756 in `FlaggedReviewSection.tsx`). The **dedup/merge pipeline** (lines 400–460) and the **dismissal lookup** (line 323) still use `senderLabelForItem` or `normalizeLookup` directly, which means:

- Activity-sourced messages from the same contact can still produce separate `activityGroups` entries (different `fallbackId` keys)
- The `flaggedFromList` + `flaggedFromActivity` merge can still produce duplicate cards for the same contact
- Dismissal only uses `thread_id` now (our fix), so that path is clean

**Impact:** Mock appointment data from the same contact with varying subjects appears as separate standalone cards rather than stacking into one deck with the `1/2` paginator.

**Fix:** Apply `contactKeyForItem` consistently across all grouping/merging code paths, not just the render layer. Specifically:
- `activityGroups` building (line 422) should prefer `contactKeyForItem` over `explicitThreadId`
- The `flaggedFromList` + `flaggedFromActivity` merge should dedup by `contactKeyForItem` not just `messageFingerprint`

---

## Bug 3: Folders are localStorage-only — no server persistence

**File:** `src/components/dashboard/FlaggedReviewSection.tsx`, lines 546–550 (persistence effect) and `src/lib/flagged-utils.ts`, lines 157–172 (`loadFolders`)

```ts
useEffect(() => {
  localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
}, [folders]);
```

```ts
export function loadFolders(): FolderDef[] {
  const raw = localStorage.getItem(FOLDERS_KEY);
  if (!raw) return DEFAULT_FOLDERS;
  // ...
}
```

**Issues:**

1. **Different browsers = different folders.** localStorage is per-origin, per-browser. A user who organizes flagged messages into folders on one machine sees no folders on another.

2. **Silent data loss.** If `localStorage.getItem(FOLDERS_KEY)` returns invalid JSON (quota exceeded, partial write, browser extension interference), `loadFolders` silently returns `DEFAULT_FOLDERS` — all custom folders vanish with no error or toast.

3. **No sync between tabs.** Two browser tabs with the dashboard open each maintain their own in-memory `folders` state. Only the tab that last writes to localStorage "wins." Changes in one tab are invisible in the other until a page refresh.

4. **Storage key version mismatch.** `FOLDERS_KEY = "flagged.folders.v2"` while `ASSIGNMENTS_KEY = "flagged.assignments.v3"` and `DISMISSED_KEY = "flagged.dismissed.v2"`. The flush-on-mount effect (lines 115–130) checks for legacy v2 assignments and v1 dismissed keys but does not version-check folders. If a future migration bumps other keys without bumping folders, the data model silently diverges.

**Impact:** Folders appear to "disappear" when the user switches browsers, clears site data, or encounters a JSON parse error.

**Fix:** Short-term: add error reporting when JSON parse fails. Long-term: persist folders (and assignments) to the backend so they follow the user across devices.

---

## Bug 4: Assignments and dismissed items also localStorage-only

**Files:** Same as Bug 3 — `ASSIGNMENTS_KEY` and `DISMISSED_KEY` use identical localStorage patterns.

Same cross-browser and multi-tab issues as Bug 3. Additionally:

**Stale assignments after deletion:** When a flagged message is dismissed (deleted), the `deepDeleteItem` function clears the assignment for that `thread_id`. But if the message re-appears later (e.g., the contact sends a new message that gets flagged again), the assignment stays cleared. This is correct behavior, but the user has no way to know whether a message was "un-assigned" or "never assigned."

**Dismissed set grows indefinitely.** There is no TTL or eviction for the `dismissed` set. Every thread_id ever dismissed stays in localStorage forever, consuming storage. This also means the `isDismissed` check scans a growing set on every render cycle.

**Impact:** Same as Bug 3 — state is browser-local, not portable. Dismissed set also leaks memory.

---

## Bug 5: The flush-on-mount effect has a logical gap

**File:** `src/components/dashboard/FlaggedReviewSection.tsx`, lines 115–130

```ts
useEffect(() => {
  const hasFreshState =
    localStorage.getItem(ASSIGNMENTS_KEY) ||
    localStorage.getItem(DISMISSED_KEY);
  const hasLegacyHiddenState =
    localStorage.getItem("flagged.assignments.v2") ||
    localStorage.getItem("flagged.dismissed.v1");
  if (!hasFreshState && hasLegacyHiddenState) {
    setAssignments({});
    setDismissed(new Set());
  }
}, []);
```

The intent is: if the user has data from an old version (v2 assignments, v1 dismissed) but no data from the new version (v3 assignments, v2 dismissed), reset the state so the user sees all flagged messages again.

**Problem:** This effect runs **on mount only** (`[]` dependency). If the user:
1. Opens dashboard → flush runs (clears state) → sees all messages
2. Organizes messages into folders / dismisses some
3. Refreshes the page
4. The new state is written to localStorage (v3/v2 keys) → `hasFreshState` is now true → flush does NOT run → state preserved ✓

But if the page hot-reloads (Vite HMR), the effect re-runs. During HMR the component re-mounts but localStorage state persists — `hasFreshState` is still true, so no flush. This is fine.

**The real edge case:** If `DISMISSED_KEY` exists but `ASSIGNMENTS_KEY` doesn't (user dismissed messages but never created folders), `hasFreshState` is truthy (`||` short-circuits). The flush skips. But if `DISMISSED_KEY` data was written by an old client and is stale... wait, `DISMISSED_KEY` is now v2. This should be fine since the flush specifically checks for v1 (`flagged.dismissed.v1`).

**Actual gap:** The flush never clears `FOLDERS_KEY`. If a migration changes the folders schema, there's no mechanism to reset them.

**Impact:** Minor — this is a one-time migration helper and works correctly for the v2→v3 assignment and v1→v2 dismissal migrations. But it's fragile: any future key version changes require updating this effect in sync.

---

## Bug 6: `isFlaggedActivity` gate excludes non-flagged/non-review activity rows

**File:** `src/lib/enrichment.ts`, lines 92–95

```ts
export const isFlaggedActivity = (r: SendSmartUsageRecent) => {
  const decision = (r.decision ?? "").toLowerCase();
  return decision.includes("flagged") || decision.includes("review");
};
```

Only activity rows with `decision` containing "flagged" or "review" pass this filter. Any message whose `decision` is something else (e.g., `"auto_replied"`, `"needs_human_review: false"`) is excluded from both the activity-sourced card list AND the enrichment map.

**Impact:** If the `usage-get` endpoint returns appointment messages with a `decision` that doesn't match "flagged" or "review", those messages never appear in the panel at all — not as cards, not as enrichment for existing cards. The user mentioned mock appointments were being sent with `needs_human_review: false` — those would be silently dropped.

**Fix:** The filter should be broader, or the backend should ensure flagged-for-review messages always have `decision: "flagged"` or `decision: "review"`.
