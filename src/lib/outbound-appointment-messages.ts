import type { FlaggedMessage } from "@/hooks/useFlaggedMessages";
import type { CalendarMutationPayload } from "@/lib/calendar-response";
import { needsCalendarContext } from "./calendar-draft";

export interface OutboundAppointmentMessage {
  key: string;
  item: FlaggedMessage;
  text: string;
  incomingMessage: string;
  capturedAt: string;
  calendarPayload: CalendarMutationPayload | null;
}

function messageKey(
  item: FlaggedMessage,
  body: string,
  capturedAt: string | null,
  calendarPayload: CalendarMutationPayload | null,
) {
  const stableMessagePart = capturedAt || body.toLowerCase();
  const payloadPart = calendarPayload ? JSON.stringify(calendarPayload) : "";
  return `${item.thread_id}|${stableMessagePart}|${body}|${payloadPart}`;
}

type UnknownRecord = Record<string, unknown>;

const PAYLOAD_KEYS = [
  "appointment_payload",
  "calendar_payload",
  "appointmentPayload",
  "calendarPayload",
  "appointment",
  "calendar",
  "calendar_event",
  "calendarEvent",
  "appointment_event",
  "appointmentEvent",
  "schedule",
  "event",
  "payload",
  "data",
  "result",
];

const INTENT_KEYS = [
  "intent",
  "calendar_intent",
  "calendarIntent",
  "appointment_intent",
  "appointmentIntent",
  "appointment_action",
  "appointmentAction",
  "calendar_action",
  "calendarAction",
  "action",
  "type",
];

const START_KEYS = [
  "start_time",
  "startTime",
  "starts_at",
  "startsAt",
  "start_at",
  "startAt",
  "start",
  "date_time",
  "dateTime",
  "datetime",
  "appointment_start",
  "appointmentStart",
  "proposed_start_time",
  "proposedStartTime",
  "new_start_time",
  "newStartTime",
];

const END_KEYS = [
  "end_time",
  "endTime",
  "ends_at",
  "endsAt",
  "end_at",
  "endAt",
  "end",
  "appointment_end",
  "appointmentEnd",
  "proposed_end_time",
  "proposedEndTime",
  "new_end_time",
  "newEndTime",
];

const TIMEZONE_KEYS = ["timezone", "timeZone", "tz"];
const TITLE_KEYS = ["title", "summary", "event_title", "eventTitle"];
const CONFIDENCE_KEYS = ["confidence", "calendar_confidence", "calendarConfidence"];

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validIsoString(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function dateValue(value: unknown): string | null {
  if (typeof value === "string") return validIsoString(value);
  if (!isRecord(value)) return null;
  return (
    dateValue(value.dateTime) ??
    dateValue(value.datetime) ??
    dateValue(value.date) ??
    null
  );
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function firstString(record: UnknownRecord, keys: string[]) {
  for (const key of keys) {
    const value = stringValue(record[key]);
    if (value) return value;
  }
  return null;
}

function firstDate(record: UnknownRecord, keys: string[]) {
  for (const key of keys) {
    const value = dateValue(record[key]);
    if (value) return value;
  }
  return null;
}

function normalizeIntent(
  value: string | null,
): CalendarMutationPayload["intent"] | null {
  if (!value) return null;
  const normalized = value.toLowerCase().replace(/[_-]+/g, " ");
  if (/\b(noop|none|ignore|unknown)\b/.test(normalized)) return "none";
  if (/\b(reschedul|move|moved|change|changed)\b/.test(normalized)) {
    return "reschedule";
  }
  if (/\b(cancel|cancelled|canceled|delete|deleted|remove|removed)\b/.test(normalized)) {
    return "cancellation";
  }
  if (/\b(confirm|confirmed|book|booked|create|created|schedule|scheduled|upsert|add|added)\b/.test(normalized)) {
    return "confirmation";
  }
  return null;
}

function payloadFromRecord(record: UnknownRecord): CalendarMutationPayload | null {
  const startTime = firstDate(record, START_KEYS);
  const endTime = firstDate(record, END_KEYS);
  const intent = normalizeIntent(firstString(record, INTENT_KEYS));
  if (!intent && !startTime && !endTime) return null;

  return {
    intent: intent ?? (startTime ? "confirmation" : "none"),
    start_time: startTime,
    end_time: endTime,
    timezone: firstString(record, TIMEZONE_KEYS),
    title: firstString(record, TITLE_KEYS),
    confidence: firstString(record, CONFIDENCE_KEYS),
  };
}

export function extractCalendarMutationPayload(
  value: unknown,
  depth = 0,
): CalendarMutationPayload | null {
  if (!isRecord(value) || depth > 3) return null;

  for (const key of PAYLOAD_KEYS) {
    const nested = extractCalendarMutationPayload(value[key], depth + 1);
    if (nested) return nested;
  }

  return payloadFromRecord(value);
}

/**
 * Converts WhatsApp messages authored by the account owner (`from_me`) into
 * inputs for the existing post-draft appointment mutation pipeline.
 */
export function collectOutboundAppointmentMessages(
  items: FlaggedMessage[],
): OutboundAppointmentMessage[] {
  const candidates: OutboundAppointmentMessage[] = [];

  for (const item of items) {
    const messages = (item.recent_messages ?? [])
      .map((message, index) => ({ message, index }))
      .sort((a, b) => {
        const aTime = a.message.captured_at
          ? new Date(a.message.captured_at).getTime()
          : Number.MAX_SAFE_INTEGER;
        const bTime = b.message.captured_at
          ? new Date(b.message.captured_at).getTime()
          : Number.MAX_SAFE_INTEGER;
        return aTime - bTime || a.index - b.index;
      });

    let latestInbound = "";
    for (const { message } of messages) {
      const text = (message.body ?? "").trim();
      if (!text) continue;

      if (message.from_me !== true) {
        latestInbound = text;
        continue;
      }

      const capturedAt = message.captured_at ?? item.updated_at;
      const calendarPayload =
        extractCalendarMutationPayload(message) ??
        extractCalendarMutationPayload(item);

      // Text-only fallback: when no structured payload exists, check if the
      // outbound message reads like a calendar action (confirmation, reschedule,
      // etc.) so plain-text "booked for Thursday" replies still update the agenda.
      const textLooksCalendar =
        !calendarPayload &&
        needsCalendarContext(item, text, latestInbound);

      const collected = !!(calendarPayload || textLooksCalendar);
      console.log("[flagged][outbound-collect] from_me message", {
        thread_id: item.thread_id,
        sender: item.sender,
        intent_category: item.intent_category,
        has_calendar_payload: !!calendarPayload,
        payload_intent: calendarPayload?.intent ?? null,
        payload_start_time: calendarPayload?.start_time ?? null,
        text_preview: text.slice(0, 200),
        latest_inbound_preview: latestInbound.slice(0, 200),
        text_looks_calendar: textLooksCalendar,
        collected,
      });

      if (!collected) continue;

      candidates.push({
        key: messageKey(item, text, message.captured_at, calendarPayload),
        item,
        text,
        incomingMessage: latestInbound,
        capturedAt,
        calendarPayload,
      });
    }
  }

  return candidates.sort(
    (a, b) =>
      new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime(),
  );
}
