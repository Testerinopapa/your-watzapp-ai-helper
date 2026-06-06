# Reschedule & Booking Time Accuracy — Bug Analysis & Fix Plan

## Bug C: Time extraction fails when punctuation separates date from time

### Root cause

`extractDateTime` uses strict regexes that require the time to be **immediately adjacent**
to the date reference with only whitespace in between. Any punctuation or filler text
between date and time causes ALL time-based extractors to fail, and the function falls
through to a date-only extractor (which defaults to **9am**).

### Concrete example

AI draft: `"I'll move it to Monday, 2pm."`

1. `extractDayNameTime`: regex expects `Monday\s+2pm`. Actual text is `Monday,\s2pm`.
   The comma between "Monday" and the space breaks the `\s+` requirement. **FAILS.**
2. `extractMonthDayTime`: no month name present. **FAILS.**
3. `extractRelativeDayTime`: no "tomorrow"/"today". **FAILS.**
4. ...all the way down to...
5. `extractDayName`: matches "Monday" with **default 9am**.

**Result:** Date correct (Monday), time wrong (9am instead of 2pm).

The same pattern applies to:
- `"June 16, 2pm"` — comma breaks `extractMonthDayTime` → falls to `extractMonthDay` → 9am
- `"Thursday. Let's do 3pm."` — period/sentence break → day-only fallback → 9am
- `"See you on Tuesday! 10am works"` — exclamation + sentence break → 9am

### Affected regex locations in `src/lib/extractDateTime.ts`

| Extractor | Line | Strictt portion |
|---|---|---|
| `extractDayNameTime` | ~184 | `day\s+(?:at\s+)?(\d{1,2}…)` — requires `\s+` after day name |
| `extractMonthDayTime` | ~158 | `day(?:ordinal)?\s*(?:year)?\s*(?:at\s+)?time` — `\s*` is too tight after day |
| `extractRelativeDayTime` | ~210 | Less prone but still strict about adjacency |

### Fix approach (two options)

#### Option A: Relax regex punctuation tolerance (quick)

Insert `[,.]?\s*` or `[^\d]?` between the date component and the time component
in each extractor. For example in `extractDayNameTime`:

```
// Before
day\s+(?:at\s+|...)?(\d{1,2}…)

// After  
day[,.]?\s+(?:at\s+|...)?(\d{1,2}…)
```

**Pro:** Small change, low risk.
**Con:** Still fragile — "Monday (June 16) at 2pm" would still fail because of the parenthetical.

#### Option B: Two-pass date+time pairing (robust)

1. Pass 1: Find ALL date references regardless of time adjacency (use existing date-only extractors expanded to return multiple matches)
2. Pass 2: Find ALL time references in the text (new standalone time extraction)
3. Pair the closest date to each time, or pair the chronologically nearest match

**Pro:** Handles any separation, any punctuation.
**Con:** More code, more edge cases.

**Recommendation:** Option A first (quick win), with an escape hatch in `extractDateTime`
that also searches for standalone times and pairs them with the nearest date when all
time-based extractors fail.

### Implementation steps (Option A+)

1. Relax `\s+` → `[,.]?\s+` in `extractDayNameTime` regex (line ~184)
2. Relax `\s*` → `[^\d]*?` in `extractMonthDayTime` after day component (line ~158)
3. Add a **fallback pass** at the end of `extractDateTime`: if a date was found but no
   time (i.e., we're returning a 9am-default fallthrough), scan the entire text for
   standalone times and apply the first one found to the date.

### Files changed
- `src/lib/extractDateTime.ts` — regex relaxation + fallback pass

---

## Bug D: AI incorrectly marks free slots as already booked

### Root cause

The calendar context fed to the AI includes BOTH human-readable local times AND ISO
UTC timestamps on the same line:

```
- Tue, Jun 16 10:00–11:00 (2026-06-16T08:00:00.000Z to 2026-06-16T09:00:00.000Z) — Meeting with Bob
```

For a user in UTC+2, the local time shows **10:00–11:00** but the ISO shows
**08:00:00Z–09:00:00Z**. The AI model can easily confuse which is the "real" time,
especially when comparing against a contact's proposed time like "2pm."

The AI is explicitly told:
> "The user is ALREADY BUSY at these times in the next 30 days. Treat each block as fully booked"

If the AI misreads the ISO timestamps as local times, it will block wrong slots.

### Additionally

The filter `.filter((e) => e.start_time && e.end_time)` **excludes all WhatsApp-booked
events** from the calendar context (they have `end_time: null`). This means the AI
doesn't see existing app-booked appointments, which could lead to double-booking.

### Fix approach

1. **Remove ISO timestamps** from the calendar context lines. Show only the
   human-readable local time with the timezone clearly stated. The ISO timestamps
   provide no value to the AI and only create confusion.

2. **Include WhatsApp-booked events** by treating `end_time: null` as a 1-hour
   default duration for context purposes only. Change the filter to:
   ```js
   .filter((e) => e.start_time)  // still need a start_time at minimum
   ```
   And when `end_time` is null, compute it as `start_time + 1 hour` for the display line.

### Implementation steps

1. In `FlaggedReviewSection.tsx` (~line 1081-1100): change the calendar context
   builder to:
   - Drop ISO timestamps from the formatted lines
   - Treat `end_time: null` as `start_time + 1 hour`
   - Show timezone prominently at the top: `"All times below are in ${tz}"`
2. Update the calendar rules prompt to reference "local time" not ISO

### Files changed
- `src/components/dashboard/FlaggedReviewSection.tsx` — calendar context builder

---

## Execution order

1. **Bug C** (time extraction) — most impactful, fixes the "wrong time" problem
2. **Bug D** (calendar context) — fixes the AI confusion about busy slots

These are independent and can be done in either order, but Bug C first because
it directly causes the "correct date, wrong time" symptom which is the more
obvious user-facing bug.

---

## Verification

After implementing both fixes, test with these scenarios:

1. AI draft: "Monday, 2pm" → extracted time should be Monday at 14:00 (not 09:00)
2. AI draft: "June 16, 3pm" → extracted time should be June 16 at 15:00 (not 09:00)
3. View calendar context in console log → no ISO timestamps, only local times
4. WhatsApp-booked events visible in calendar context alongside Google Calendar events
