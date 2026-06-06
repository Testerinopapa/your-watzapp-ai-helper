# Pipeline Convergence Point: `draft-whatsapp-manual`

```
                  Flagged Message Arrives
                           │
                           ▼
              ┌─────────────────────────┐
              │   intent_category?       │
              │   (checked client-side)  │
              └───────────┬─────────────┘
                          │
     ┌──────────┬─────────┼─────────┬──────────┐
     ▼          ▼         ▼         ▼          ▼
┌────────┐ ┌────────┐ ┌──────┐ ┌─────────┐ ┌──────────┐
│complaint│ │support │ │misc  │ │appoint- │ │(other/   │
│         │ │        │ │      │ │ment     │ │unknown)  │
└────┬────┘ └───┬────┘ └──┬───┘ └────┬────┘ └────┬─────┘
     │          │         │          │           │
     │          ▼         │          ▼           │
     │ ┌───────────────┐  │ ┌─────────────────┐  │
     │ │buildSupport   │  │ │buildCalendar    │  │
     │ │Instruction()  │  │ │Instruction()    │  │
     │ │               │  │ │                 │  │
     │ │• DB: support_ │  │ │• Edge fn: sync  │  │
     │ │  doc_chunks   │  │ │  Google Calendar│  │
     │ │• Selected doc │  │ │• DB: agenda_    │  │
     │ │  → all chunks │  │ │  events (180d)  │  │
     │ │• Cross-doc    │  │ │• Format busy    │  │
     │ │  → FTS search │  │ │  slots + rules  │  │
     │ │• Prepend      │  │ │• Prepend        │  │
     │ │  SUPPORT_     │  │ │  calendar ctx   │  │
     │ │  HEADER       │  │ │  + HARD RULES   │  │
     │ │  + knowledge  │  │ │                 │  │
     │ │  block        │  │ │                 │  │
     │ └───────┬───────┘  │ └────────┬────────┘  │
     │         │          │          │           │
     │         │ instruction          │           │ instruction
     │         │ (enriched)          │           │ (raw)
     │         │          │          │           │
     instruction          │          │           │
     (raw +               │          │           │
     empathy prompt)      │          │           │
     │         │          │          │           │
     └─────────┼──────────┴──────────┼───────────┘
               │                     │
               └─────────────────────┘
                         │
                instruction text
                (up to 8000 chars)
                         │
                         ▼
     ╔═══════════════════════════════════════╗
     ║   POST /draft-whatsapp-manual          ║
     ║                                        ║
     ║   External Supabase Project:            ║
     ║   ocpphyjkstvfespxrajk.supabase.co     ║
     ║                                        ║
     ║   ┌─────────────────────────┐          ║
     ║   │   AI Model (black box)   │          ║
     ║   │                         │          ║
     ║   │   Sees only:            │          ║
     ║   │   • incomingMessage     │          ║
     ║   │   • instruction (text)  │          ║
     ║   │   • provider            │          ║
     ║   │   • thread_id           │          ║
     ║   │                         │          ║
     ║   │   Does NOT see:         │          ║
     ║   │   • workflow type       │          ║
     ║   │   • intent_category     │          ║
     ║   │   • which pipeline      │          ║
     ║   └───────────┬─────────────┘          ║
     ║               │                        ║
     ║               ▼                        ║
     ║   ┌─────────────────────────┐          ║
     ║   │   draft text returned    │          ║
     ║   └───────────┬─────────────┘          ║
     ╚═══════════════╪════════════════════════╝
                     │
                draft text
                     │
                     ▼
          ┌─────────────────────┐
          │   Post-draft handler │
          │   (FlaggedReview     │
          │    Section.tsx)      │
          └─────────┬───────────┘
                    │
  ┌────────┬────────┼────────┬────────┐
  ▼        ▼        ▼        ▼        ▼
┌─────┐ ┌─────┐ ┌──────┐ ┌──────┐ ┌──────┐
│comp-│ │supp-│ │misc  │ │appt  │ │other │
│laint│ │ort  │ │      │ │      │ │      │
│     │ │     │ │      │ │      │ │      │
│con- │ │con- │ │(noth-│ │calen-│ │(noth-│
│sole │ │sole │ │ing)  │ │dar   │ │ing)  │
│.log │ │.log │ │      │ │resp- │ │      │
│     │ │     │ │      │ │onse  │ │      │
│"[fla│ │"[fla│ │      │ │.ts   │ │      │
│gged]│ │gged]│ │      │ │      │ │      │
│[comp│ │[supp│ │      │ │class-│ │      │
│laint│ │ort] │ │      │ │ify   │ │      │
│]    │ │draft│ │      │ │Intent│ │      │
│draft│ │sent"│ │      │ │→conf │ │      │
│sent"│ │     │ │      │ │→canc │ │      │
│     │ │     │ │      │ │→resc │ │      │
│     │ │     │ │      │ │      │ │      │
│     │ │     │ │      │ │DB    │ │      │
│     │ │     │ │      │ │upsert│ │      │
│     │ │     │ │      │ │+     │ │      │
│     │ │     │ │      │ │Google│ │      │
│     │ │     │ │      │ │Cal   │ │      │
└─────┘ └─────┘ └──────┘ └──────┘ └──────┘
```

## Intent Categories (client-side routing)

| Intent | Category set | Icon | Color | Pre-draft injection | Post-draft handler |
|---|---|---|---|---|---|
| complaint | `COMPLAINT_CATEGORIES` | `AlertTriangle` | Red `#ef4444` | Empathy prompt in instruction | `console.log("[flagged][complaint]")` |
| support | `SUPPORT_CATEGORIES` | `LifeBuoy` | Blue `#3b82f6` | Support knowledge chunks | `console.log("[flagged][support]")` |
| appointment | `APPOINTMENT_CATEGORIES` | `CalendarCheck` | Amber `#f59e0b` | Calendar context + hard rules | `handleCalendarAfterDraft()` |
| misc / other | (none) | `MessageCircle` | Default gray/teal | Nothing | Nothing |

## The problem

The AI model has no concept of "pipelines." All four intent types send their
instructions to the same endpoint, formatted as plain text. The appointment
pipeline sends calendar slots and scheduling rules inside `instruction`. The
support pipeline sends knowledge chunks and a "this is support" header. The
complaint pipeline sends an empathy-first prompt. If those headers and
instruction prefixes weren't there, the AI would treat every message the
same way — which is why each pipeline injects its own context and constraints.

## Why not add a `workflow` field?

The external project's `draft-whatsapp-manual` function doesn't know about
the field. It would ignore it. We'd need to deploy a new version of that
function to parse `workflow: "complaint" | "support" | "appointment" | "misc"`
and branch the system prompt accordingly. That's the long-term fix, but it
requires touching a project outside this repo.
