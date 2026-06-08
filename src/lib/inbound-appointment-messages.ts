import type { FlaggedMessage } from "@/hooks/useFlaggedMessages";
import { extractDateTime } from "@/lib/extractDateTime";

export interface InboundAppointmentMessage {
  key: string;
  item: FlaggedMessage;
  text: string;
  capturedAt: string;
  extractedAt: string; // ISO of extracted booking date/time
}

function messageKey(item: FlaggedMessage, body: string, capturedAt: string | null, extractedAt: string) {
  const stable = capturedAt || body.toLowerCase();
  return `${item.thread_id}|${stable}|${extractedAt}|${body.slice(0, 80)}`;
}

/**
 * Inbound counterpart to collectOutboundAppointmentMessages. Walks recent
 * messages chronologically; any inbound (from_me !== true) message whose body
 * yields a high-confidence date+time via extractDateTime is queued for the
 * same handleCalendarAfterDraft pipeline that outbound and AI-drafted
 * appointment replies run through.
 *
 * Medium-confidence extractions (e.g. "tomorrow" with no time) are skipped to
 * avoid silently creating wrong calendar events.
 */
export function collectInboundAppointmentMessages(
  items: FlaggedMessage[],
): InboundAppointmentMessage[] {
  const candidates: InboundAppointmentMessage[] = [];

  for (const item of items) {
    const messages = (item.recent_messages ?? [])
      .map((message, index) => ({ message, index }))
      .sort((a, b) => {
        const aT = a.message.captured_at ? new Date(a.message.captured_at).getTime() : Number.MAX_SAFE_INTEGER;
        const bT = b.message.captured_at ? new Date(b.message.captured_at).getTime() : Number.MAX_SAFE_INTEGER;
        return aT - bT || a.index - b.index;
      });

    // Also consider the parent's latest_message when it's inbound and not in recent.
    const seenBodies = new Set(messages.map((m) => (m.message.body ?? "").trim()));
    const parentText = (item.latest_message ?? item.preview ?? "").trim();
    const parentFromMe = (item as FlaggedMessage & { from_me?: boolean | null }).from_me;
    const includeParent =
      parentText &&
      parentFromMe !== true &&
      !seenBodies.has(parentText);

    const walk: Array<{ body: string; from_me: boolean | null | undefined; captured_at: string | null }> = [
      ...messages.map((m) => ({
        body: (m.message.body ?? "").trim(),
        from_me: m.message.from_me,
        captured_at: m.message.captured_at ?? null,
      })),
      ...(includeParent
        ? [{ body: parentText, from_me: parentFromMe ?? null, captured_at: item.updated_at ?? null }]
        : []),
    ];

    for (const entry of walk) {
      if (!entry.body) continue;
      if (entry.from_me === true) continue;

      const extracted = extractDateTime(entry.body, item.subject);
      if (!extracted || extracted.confidence !== "high") continue;

      const capturedAt = entry.captured_at ?? item.updated_at ?? new Date().toISOString();
      candidates.push({
        key: messageKey(item, entry.body, entry.captured_at, extracted.date.toISOString()),
        item,
        text: entry.body,
        capturedAt,
        extractedAt: extracted.date.toISOString(),
      });
    }
  }

  return candidates.sort(
    (a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime(),
  );
}
