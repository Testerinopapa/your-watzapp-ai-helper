# MiniChat — Dashboard Assistant

Lower-right floating AI copilot for the WhatsReply dashboard.

**File:** `src/components/MiniChat.tsx`
**Endpoint:** `POST https://ocpphyjkstvfespxrajk.supabase.co/functions/v1/dashboard-chat`

## What it does

The widget is a **read-only** dashboard analyst. It cannot modify cards, send replies, move folders, or change appointments. It only reads and reports.

### How it works

1. Collects all visible text from `<main data-dashboard-root>` (capped at 15,000 characters).
2. Sends the user's message + conversation history + dashboard text to the `dashboard-chat` edge function.
3. The edge function passes the dashboard context to an Anthropic model (Claude Haiku 4.5) with a hardcoded system prompt that scopes it as a dashboard analyst.
4. The assistant's reply is rendered in the chat panel.

### Capabilities

- **Dashboard overview:** "Analyze this dashboard for me" or "What needs my attention today?"
- **Flagged messages:** Count by intent (support, complaint, appointment, misc), identify unresolved items, check folder assignments.
- **Complaint cards:** Count by risk level (high/medium/low), identify escalated or unhandled complaints.
- **Appointment cards:** Count booked-by-agent appointments, identify those missing agenda events or time confirmation.
- **Support cards:** Check which support cards have a document selected, which are using "All documents," and whether the knowledge base has content.
- **Activity stream:** Summarize recent voice replies and usage quotas from the visible usage meters.
- **Support knowledge panel:** Count uploaded documents, check if any are missing.

### Limitations

- The assistant **only sees text** rendered on the dashboard — it has no direct access to the database, React state, or API responses.
- If text is scrolled out of view or inside a collapsed element, the DOM snapshot may not include it.
- It **cannot** modify data — no card actions, no replies, no calendar mutations.
- Response quality depends on how much dashboard data is currently visible on screen.

## UI

| State | Description |
|---|---|
| **Collapsed** | Floating circular `Bot` icon in the lower-right corner with a subtle pulse. |
| **Expanded** | 380×520px panel with header ("Dashboard Assistant"), scrollable message list, input field, and send button. |
| **Empty** | Welcome message: "I can analyze your dashboard — flagged messages, appointments, complaints, and more." + "Analyze this dashboard" quick-action button. |
| **Loading** | Animated `Loader2` spinner bubble. |
| **Error** | "Something went wrong reaching the assistant. Please try again." |
| **User message** | Right-aligned, `bg-primary/10` bubble. |
| **Assistant reply** | Left-aligned, `bg-muted` bubble. |

### Keyboard

- **Enter** — send message
- **Esc** — close the panel (via X button or clicking outside)

### Context collection fallback chain

```
document.querySelector("[data-dashboard-root]")
  ?? document.querySelector("main")
  ?? document.body
```

## Files

| File | Role |
|---|---|
| `src/components/MiniChat.tsx` | Full component — button, panel, DOM collector, API caller |
| `src/pages/Dashboard.tsx` | Provides `data-dashboard-root` on `<main>`, renders `<MiniChat />` |

## Dependencies

None added. Uses only existing project libraries: React, shadcn/ui `Button` + `Input`, lucide-react icons, Tailwind CSS utilities.
