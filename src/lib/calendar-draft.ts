import { supabase } from "@/integrations/supabase/client";
import type { FlaggedMessage } from "@/hooks/useFlaggedMessages";
import type { DraftState } from "./flagged-utils";
import {
  senderLabelForItem,
  normalizeEventText,
} from "./flagged-utils";
import {
  looksLikeCancellation,
  looksLikeReschedule,
} from "./extractDateTime";

// Matches scheduling-related text across English, Portuguese, Italian, and Spanish.
// Grouped by language for maintainability — each | clause is one language's lexicon.
const CALENDAR_CONTEXT_RE = new RegExp(
  [
    // ── English ──
    "appointment|calendar|schedule|scheduled|booking|booked|meeting|meet|call|slot",
    "available|availability|confirm|confirmed|tomorrow|today",
    "monday|tuesday|wednesday|thursday|friday|saturday|sunday",

    // ── Portuguese ──
    // Days (full + abbreviated)
    "segunda[- ]feira|terça[- ]feira|quarta[- ]feira|quinta[- ]feira|sexta[- ]feira",
    "\\bsábado\\b|\\bdomingo\\b",
    "\\bsegunda\\b|\\bterça\\b|\\bquarta\\b|\\bquinta\\b|\\bsexta\\b|\\bsabado\\b",
    // Scheduling verbs / nouns
    "\\bmarcar\\b|\\bmarcado\\b|\\bremarcar\\b|\\bagendar\\b|\\bagendado\\b|\\bagendamento\\b",
    "\\bconfirmar\\b|\\bconfirmado\\b|\\bconfirmação\\b|\\bconfirmacao\\b",
    "\\breservar\\b|\\breservado\\b|\\breserva\\b",
    "\\bdispon[íi]vel\\b|\\bdisponibilidade\\b",
    "\\bfunciona\\b|\\bcombinar\\b|\\bcombinado\\b",
    "\\bconsulta\\b|\\bconsultas\\b",

    // ── Italian ──
    "luned[ìi']|marted[ìi']|mercoled[ìi']|gioved[ìi']|venerd[ìi']",
    "\\bsabato\\b|\\bdomenica\\b",
    "\\bappuntamento\\b|\\bprenotare\\b|\\bprenotato\\b|\\bprenotazione\\b",
    "\\bconfermare\\b|\\bconfermato\\b|\\bdisponibile\\b|\\bdisponibilit[àa]\\b",
    "\\bspostare\\b|\\brinviare\\b|\\bannullare\\b|\\bannullamento\\b",

    // ── Spanish ──
    "\\blunes\\b|\\bmartes\\b|\\bmi[eé]rcoles\\b|\\bjueves\\b|\\bviernes\\b",
    "\\bs[aá]bado\\b|\\bdomingo\\b",
    "\\bcita\\b|\\bcitas\\b|\\breservar\\b|\\breservado\\b|\\breservaci[oó]n\\b",
    "\\bconfirmar\\b|\\bconfirmado\\b|\\bconfirmaci[oó]n\\b",
    "\\bdisponible\\b|\\bdisponibilidad\\b|\\bagendar\\b|\\bagendado\\b",
    "\\breprogramar\\b|\\bcancelar\\b|\\bcancelaci[oó]n\\b",

    // ── Multi-language time formats ──
    // English-style: 10am, 2:30pm, 10 AM
    "\\b\\d{1,2}(:\\d{2})?\\s?(am|pm)\\b",
    // Portuguese/Italian/Spanish: 5h30, 17h, às 5h, alle 10:00
    "\\b\\d{1,2}[h:]\\d{2}\\b",
    "\\bàs?\\s+\\d{1,2}[h:]",
    "\\balle?\\s+\\d{1,2}[:h]",
    // Numeric date: 04/06, 4/6, 11-06
    "\\b\\d{1,2}[/-]\\d{1,2}\\b",
  ].join("|"),
  "i",
);

export function needsCalendarContext(
  item: FlaggedMessage,
  incomingMessage: string,
  userInstruction: string,
) {
  const text =
    `${item.intent_category ?? ""} ${incomingMessage} ${userInstruction}`.toLowerCase();
  const matches = CALENDAR_CONTEXT_RE.test(text);
  if (!matches) {
    console.log("[flagged][calendar-context] needsCalendarContext → false", {
      thread_id: item.thread_id,
      sender: item.sender,
      intent_category: item.intent_category,
      incoming_preview: incomingMessage.slice(0, 200),
      instruction_preview: userInstruction.slice(0, 200),
      combined_preview: text.slice(0, 300),
    });
  }
  return matches;
}

export async function buildCalendarInstruction({
  item,
  incomingMessage,
  userInstruction,
  updateDraft,
  toast,
}: {
  item: FlaggedMessage;
  incomingMessage: string;
  userInstruction: string;
  updateDraft: (id: string, patch: Partial<DraftState>) => void;
  toast: (opts: {
    title: string;
    description: string;
    variant?: "default" | "destructive";
  }) => void;
}): Promise<string | null> {
  let instruction = userInstruction;

  try {
    const { error: syncError } = await supabase.functions.invoke(
      "google-calendar-sync",
      { body: {} },
    );
    if (syncError) {
      throw new Error(syncError.message || "Calendar sync failed");
    }

    const nowIso = new Date().toISOString();
    const horizonIso = new Date(
      Date.now() + 180 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const { data: events } = await supabase
      .from("agenda_events")
      .select(
        "id, source_type, source_event_id, thread_id, contact_name, contact_channel, title, description, location, start_time, end_time, timezone, status, notes",
      )
      .or(`end_time.gte.${nowIso},end_time.is.null`)
      .lte("start_time", horizonIso)
      .neq("status", "cancelled")
      .order("start_time", { ascending: true })
      .limit(500);

    if (events === null) {
      throw new Error("Calendar events could not be loaded");
    }

    const tz =
      Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
    const fmt = new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: tz,
    });
    const fmtTime = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: tz,
    });

    const currentThreadId = item.thread_id;
    const currentContact = senderLabelForItem(item);

    const ownEvents: typeof events = [];
    const otherEvents: typeof events = [];
    for (const e of events ?? []) {
      if (!e.start_time) continue;
      const isOwn =
        (currentThreadId && e.thread_id === currentThreadId) ||
        (currentContact &&
          e.contact_name &&
          normalizeEventText(e.contact_name).includes(
            normalizeEventText(currentContact),
          ));
      (isOwn ? ownEvents : otherEvents).push(e);
    }

    function formatEventLine(
      e: NonNullable<typeof events>[number],
    ): string {
      const startDate = new Date(e.start_time as string);
      const endDate = e.end_time
        ? new Date(e.end_time as string)
        : new Date(startDate.getTime() + 60 * 60 * 1000);
      const start = fmt.format(startDate);
      const end = fmtTime.format(endDate);
      const loc = e.location ? ` @ ${e.location}` : "";
      const title = e.title?.trim() || "(busy)";
      const contact = e.contact_name?.trim()
        ? ` [contact: ${e.contact_name.trim()}${e.contact_channel ? ` via ${e.contact_channel}` : ""}]`
        : "";
      const desc = e.description?.trim()
        ? ` — ${e.description.trim().slice(0, 140)}`
        : "";
      const note = e.notes?.trim()
        ? ` (notes: ${e.notes.trim().slice(0, 140)})`
        : "";
      return `- ${start}–${end} — ${title}${loc}${contact}${desc}${note}`;
    }

    const ownSection =
      ownEvents.length > 0
        ? `YOUR APPOINTMENT WITH THIS CONTACT (this is the event being moved — it is NOT a conflict, it will change time):\n${ownEvents.map(formatEventLine).join("\n")}`
        : "";

    const otherSection =
      otherEvents.length > 0
        ? `OTHER SCHEDULED EVENTS (these are REAL conflicts — the new time must NOT overlap):\n${otherEvents.map(formatEventLine).join("\n")}`
        : "OTHER SCHEDULED EVENTS: None — the rest of your calendar is clear.";

    const hasEvents =
      ownEvents.length > 0 || otherEvents.length > 0;
    const calendarBlock = hasEvents
      ? `CALENDAR CONTEXT — freshly synced. All times below are in ${tz} (your local timezone).\n\n${ownSection}\n\n${otherSection}`
      : `CALENDAR CONTEXT — freshly synced from Google Calendar. User has no scheduled events (${tz}).`;

    const intentText = `${incomingMessage}\n${userInstruction}`;
    const isReschedule = looksLikeReschedule(intentText);
    const isCancellation =
      !isReschedule && looksLikeCancellation(intentText);

    let calendarRules = "";
    if (isReschedule) {
      calendarRules = `\n\nHARD RULES FOR THIS REPLY (must follow):\n1. DO NOT say the contact's current appointment slot is "free" — it is occupied BY the appointment being moved (see YOUR APPOINTMENT WITH THIS CONTACT above). Say "your current appointment at [time] will be moved."\n2. Check the proposed new time only against OTHER SCHEDULED EVENTS — never against YOUR APPOINTMENT WITH THIS CONTACT.\n3. If the proposed new time does NOT overlap any OTHER SCHEDULED EVENTS, approve the reschedule. Example: "I can move your appointment to [new time]. The old slot at [old time] opens up."\n4. If no specific new time is proposed, suggest one based on gaps between OTHER SCHEDULED EVENTS.\n5. The customer's reschedule request is NOT itself a calendar event — do not block the new time because of it.`;
    } else if (isCancellation) {
      calendarRules = `\n\nHARD RULES FOR THIS REPLY (must follow):\n1. ACKNOWLEDGE the cancellation directly and empathetically in your reply.\n2. Confirm you've noted they want to cancel — mention specifically what's being cancelled (reference the appointment from CALENDAR CONTEXT if identifiable).\n3. Offer to reschedule if appropriate (e.g. "let me know if you'd like to set another time").\n4. Do NOT propose new times unless they explicitly ask to reschedule.`;
    } else if (hasEvents) {
      calendarRules = `\n\nHARD RULES FOR THIS REPLY (must follow):\n1. NEVER confirm, accept, or propose any time that overlaps an event listed above — those slots are already booked.\n2. If the incoming message proposes a specific time, first check it against OTHER SCHEDULED EVENTS and YOUR APPOINTMENT WITH THIS CONTACT. If it conflicts with ANY event (even partially), DO NOT confirm. Politely say that slot is taken and offer the nearest free alternative.\n3. If unsure whether a slot is free, ask the contact for an alternative instead of guessing.\n4. Only confirm a time when you can verify it does NOT overlap any listed event.`;
    } else {
      calendarRules = `\n\nBOOKING REPLY RULES:\n1. Any reasonable time can be proposed — the user has no scheduled events.\n2. If the contact proposes a specific time, confirm with warmth and clarity.`;
    }

    instruction =
      `${calendarBlock}\n\n---\n\n${userInstruction}${calendarRules}`.slice(
        0,
        8000,
      );

    return instruction;
  } catch (err) {
    console.warn("[flagged] failed to load calendar context", err);
    const message =
      err instanceof Error && err.message
        ? err.message
        : "Calendar could not be verified.";
    updateDraft(item.thread_id, {
      loading: false,
      error: `Calendar could not be verified, so I stopped before drafting: ${message}`,
      phase: "error",
    });
    toast({
      title: "Calendar not verified",
      description:
        "I stopped the draft so we don't confirm an already-booked slot.",
      variant: "destructive",
    });
    return null;
  }
}
